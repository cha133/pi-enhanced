import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool as McpSdkTool } from "@modelcontextprotocol/client";
import { bindMcpTools, loadMcpConfig, McpManager, type McpServerConfig } from "../extensions/lib/mcp.js";

const firstTool: McpSdkTool = {
	name: "web.search",
	description: "Search the web",
	inputSchema: {
		type: "object",
		properties: { query: { type: "string" } },
		required: ["query"],
	},
};

describe("MCP configuration", () => {
	test("merges global and trusted project files with project servers replacing by name", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-enhanced-mcp-config-"));
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		await Promise.all([mkdir(agentDir), mkdir(cwd)]);
		await Bun.write(join(agentDir, "mcp.json"), JSON.stringify({
			mcpServers: {
				exa: { url: "https://global.example/mcp" },
				local: { command: "node", args: ["server.js"], env: { TOKEN: "global" } },
			},
		}));
		await Bun.write(join(cwd, ".mcp.json"), JSON.stringify({
			mcpServers: {
				exa: { url: "https://project.example/mcp" },
				broken: { url: "not a url" },
			},
		}));

		try {
			const loaded = await loadMcpConfig(cwd, agentDir, true);
			expect([...loaded.servers]).toEqual([
				["local", { command: "node", args: ["server.js"], env: { TOKEN: "global" } }],
				["exa", { url: "https://project.example/mcp" }],
			]);
			expect(loaded.issues).toEqual([
				expect.objectContaining({ server: "broken", message: "url must be a valid absolute HTTP URL" }),
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("ignores project configuration when the project is untrusted", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-enhanced-mcp-untrusted-"));
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		await Promise.all([mkdir(agentDir), mkdir(cwd)]);
		await Bun.write(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { global: { command: "global-server" } } }));
		await Bun.write(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { project: { command: "project-server" } } }));

		try {
			const loaded = await loadMcpConfig(cwd, agentDir, false);
			expect([...loaded.servers.keys()]).toEqual(["global"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("MCP manager", () => {
	test("registers direct tools, forwards calls and cancellation, and refreshes the active surface", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-enhanced-mcp-manager-"));
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		await Promise.all([mkdir(agentDir), mkdir(cwd)]);
		await Bun.write(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { exa: { url: "https://mcp.example/mcp" } } }));

		let changed: ((tools: McpSdkTool[]) => void) | undefined;
		let closed = false;
		let receivedSignal: AbortSignal | undefined;
		let receivedArguments: Record<string, unknown> | undefined;
		const configs: McpServerConfig[] = [];
		const manager = new McpManager(
			cwd,
			agentDir,
			true,
			(message) => { throw new Error(message); },
			["read", "bash"],
			async (_server, config, onToolsChanged) => {
				configs.push(config);
				changed = onToolsChanged;
				return {
					client: {
						async connect() {},
						async close() {},
						async listTools() { return { tools: [firstTool] }; },
						async callTool(params, options) {
							receivedArguments = params.arguments;
							receivedSignal = options?.signal;
							return { content: [{ type: "text", text: "found it" }], structuredContent: { hits: 1 } };
						},
					},
					async close() { closed = true; },
				};
			},
		);

		const registered = new Map<string, any>();
		let active = ["bash", "write"];
		let activeUpdates = 0;
		const pi = {
			registerTool(tool: { name: string }) { registered.set(tool.name, tool); },
			getActiveTools: () => active,
			setActiveTools(names: string[]) {
				active = names;
				activeUpdates += 1;
			},
		} as any;
		const unbind = bindMcpTools(pi, manager);

		try {
			await manager.start();
			expect(configs).toEqual([{ url: "https://mcp.example/mcp" }]);
			expect([...registered.keys()]).toEqual(["mcp_exa_web_search"]);
			expect(active).toContain("mcp_exa_web_search");

			const signal = new AbortController().signal;
			const result = await registered.get("mcp_exa_web_search").execute(
				"call-1",
				{ query: "pi" },
				signal,
				undefined,
				{},
			);
			expect(receivedArguments).toEqual({ query: "pi" });
			expect(receivedSignal).toBe(signal);
			expect(result.content).toEqual([{ type: "text", text: "found it" }]);
			expect(result.details.structuredContent).toEqual({ hits: 1 });

			const updatesBeforeNoop = activeUpdates;
			changed?.([{ ...firstTool }]);
			expect(activeUpdates).toBe(updatesBeforeNoop);

			changed?.([{ ...firstTool, name: "answer" }]);
			expect(active).not.toContain("mcp_exa_web_search");
			expect(active).toContain("mcp_exa_answer");
		} finally {
			unbind();
			await manager.close();
			await rm(root, { recursive: true, force: true });
		}
		expect(closed).toBe(true);
	});

	test("aborts and awaits an in-progress connection during shutdown", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-enhanced-mcp-shutdown-"));
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		await Promise.all([mkdir(agentDir), mkdir(cwd)]);
		await Bun.write(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { slow: { command: "slow-server" } } }));

		let connectorStarted!: () => void;
		const started = new Promise<void>((resolve) => { connectorStarted = resolve; });
		let aborted = false;
		const manager = new McpManager(
			cwd,
			agentDir,
			true,
			() => {},
			[],
			async (_server, _config, _changed, signal) => {
				connectorStarted();
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => {
						aborted = true;
						reject(new DOMException("aborted", "AbortError"));
					}, { once: true });
				});
				throw new Error("unreachable");
			},
		);

		try {
			void manager.start();
			await started;
			await manager.close();
			expect(aborted).toBe(true);
		} finally {
			await manager.close();
			await rm(root, { recursive: true, force: true });
		}
	});
});
