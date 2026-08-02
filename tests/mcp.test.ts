import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Tool as McpSdkTool } from "@modelcontextprotocol/client";
import {
	bindMcpTools,
	guardMcpOutput,
	loadMcpConfig,
	McpManager,
	McpResultView,
	type McpServerConfig,
} from "../extensions/lib/mcp.js";

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
							if (params.arguments?.query === "structured") {
								return {
									content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
									structuredContent: { hits: 2 },
								};
							}
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
			expect(result.details).toEqual({ server: "exa", tool: "web.search" });

			const structured = await registered.get("mcp_exa_web_search").execute(
				"call-2",
				{ query: "structured" },
				undefined,
				undefined,
				{},
			);
			expect(structured.content).toEqual([
				{ type: "text", text: "{\n  \"hits\": 2\n}" },
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
			]);
			expect(structured.details).toEqual({ server: "exa", tool: "web.search" });

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

describe("MCP output guard", () => {
	test("bounds a single oversized line by UTF-8 bytes and saves the full text", async () => {
		const raw = `prefix-${"🙂".repeat(2_000)}-suffix`;
		const guarded = await guardMcpOutput([{ type: "text", text: raw }], 1024, 20);
		const text = guarded.content.find((part) => part.type === "text")?.text ?? "";
		const path = guarded.truncation?.fullOutputPath;

		try {
			expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(1024);
			expect(text.startsWith("prefix-🙂")).toBe(true);
			expect(text).toContain("[MCP output truncated:");
			expect(guarded.truncation?.originalBytes).toBe(Buffer.byteLength(raw, "utf8"));
			expect(path).toBeTruthy();
			expect(await readFile(path!, "utf8")).toBe(raw);
		} finally {
			if (path) await rm(dirname(path), { recursive: true, force: true });
		}
	});

	test("applies one shared budget across all text blocks while preserving images", async () => {
		const first = "a".repeat(700);
		const second = "b".repeat(700);
		const guarded = await guardMcpOutput([
			{ type: "text", text: first },
			{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
			{ type: "text", text: second },
		], 1024, 20);
		const path = guarded.truncation?.fullOutputPath;

		try {
			expect(guarded.content.filter((part) => part.type === "text")).toHaveLength(1);
			expect(guarded.content.filter((part) => part.type === "image")).toHaveLength(1);
			expect(guarded.truncation?.originalBytes).toBe(1401);
		} finally {
			if (path) await rm(dirname(path), { recursive: true, force: true });
		}
	});

	test("enforces the shared line limit including the truncation notice", async () => {
		const raw = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n");
		const guarded = await guardMcpOutput([{ type: "text", text: raw }], 10_000, 10);
		const text = guarded.content.find((part) => part.type === "text")?.text ?? "";
		const path = guarded.truncation?.fullOutputPath;

		try {
			expect(text.split("\n").length).toBeLessThanOrEqual(10);
			expect(text).toContain("original 50 lines");
			expect(guarded.truncation?.returnedLines).toBeLessThanOrEqual(10);
		} finally {
			if (path) await rm(dirname(path), { recursive: true, force: true });
		}
	});
});

describe("MCP result rendering", () => {
	test("collapses long output to three content rows and expands on demand", () => {
		const text = "result ".repeat(400);
		const collapsed = new McpResultView("MCP exa/search", text, false).render(80);
		const expanded = new McpResultView("MCP exa/search", text, true).render(80);

		expect(collapsed).toHaveLength(5);
		expect(collapsed.at(-1)).toContain("Ctrl+O to expand");
		expect(expanded.length).toBeGreaterThan(collapsed.length);
		expect(expanded.join("\n")).not.toContain("Ctrl+O to expand");
	});
});
