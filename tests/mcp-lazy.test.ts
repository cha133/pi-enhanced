import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/client";
import { loadMcpConfig, validateServerConfig, type LoadedMcpConfig } from "../extensions/lib/mcp-config.js";
import { createMcpTools, mcpDirectory, scoreMcpTool, searchMcp } from "../extensions/lib/mcp-tools.js";
import { generateMcpHints, saveMcpHint, registerMcpHintCommand } from "../extensions/lib/mcp-hints.js";
import { McpManager, waitForMcp } from "../extensions/lib/mcp.js";

const tool = (name: string, description = "Browser automation"): Tool => ({ name, description, inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } });
const config: LoadedMcpConfig = { servers: new Map([["z", { command: "z" }], ["exa", { url: "https://example.test", hint: "Web search" }]]), sources: new Map(), issues: [] };
function fakeManager(tools: Tool[]): McpManager {
	return { catalog: async () => tools, status: () => "ready" } as unknown as McpManager;
}
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "pi-mcp-lazy-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	await Promise.all([mkdir(cwd), mkdir(agentDir)]);
	return { root, cwd, agentDir, global: join(agentDir, "mcp.json"), project: join(cwd, ".mcp.json") };
}

describe("MCP lazy discovery", () => {
	test("static directory uses only configured names and hints in a stable order", () => {
		expect(mcpDirectory(config)).toBe('"exa" — "Web search"\n"z"');
		const definitions = createMcpTools(config, async () => fakeManager([tool("secret_tool")]));
		expect(definitions.map((item) => item.name)).toEqual(["mcp_search", "mcp_call"]);
		expect(JSON.stringify(definitions)).not.toContain("secret_tool");
		expect(validateServerConfig({ command: "test", hint: 3 })).toBe("hint must be a string");
	});

	test("call header exposes server and original tool name, including partial streamed arguments", () => {
		const definition = createMcpTools(config, async () => fakeManager([])).find((item) => item.name === "mcp_call")!;
		const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as any;
		const render = (args: unknown) => definition.renderCall!(args, theme, {} as any).render(100).map((line) => line.trimEnd()).join("\n");
		expect(render({ server: "exa", tool: "web_search_exa", arguments: { query: "secret input" } })).toBe("mcp_call exa / web_search_exa");
		expect(render({})).toBe("mcp_call … / …");
		expect(render({ server: "exa" })).toBe("mcp_call exa / …");
		expect(render({ server: "cua-driver", tool: "browser_click" })).toBe("mcp_call cua-driver / browser_click");
	});

	test("browse is compact and paginated; exact and keyword lookups return intact schemas", async () => {
		const manager = fakeManager([tool("browser_click"), tool("browser_navigate")]);
		const browse = await searchMcp(config, manager, { server: "z", limit: 1 });
		expect(browse).toMatchObject({ total: 2, nextOffset: 1, tools: [{ name: "browser_click" }] });
		expect(JSON.stringify(browse)).not.toContain("inputSchema");
		expect(await searchMcp(config, manager, { server: "z", offset: 1 })).toMatchObject({ tools: [{ name: "browser_navigate" }] });
		expect(await searchMcp(config, manager, { server: "z", query: "click" })).toMatchObject({ tools: [{ inputSchema: tool("x").inputSchema, name: "browser_click" }] });
		expect(await searchMcp(config, manager, { server: "z", tool: "browser_click" })).toMatchObject({ tools: [{ inputSchema: tool("x").inputSchema }] });
		expect(await searchMcp(config, manager, { server: "z", query: "missing" })).toMatchObject({ total: 0, suggestion: expect.any(String) });
		await expect(searchMcp(config, manager, { tool: "browser_click" })).rejects.toThrow("requires server");
		await expect(searchMcp(config, manager, { server: "unknown" })).rejects.toThrow("Unknown MCP server");
	});

	test("word boundaries and exact names outrank description-only matches", () => {
		expect(scoreMcpTool(tool("browser_click"), "browser_click")).toBeGreaterThan(scoreMcpTool(tool("other", "browser click"), "browser_click"));
		expect(scoreMcpTool(tool("browserClick"), "click")).toBeGreaterThan(0);
		expect(scoreMcpTool(tool("browser_click"), "target")).toBeGreaterThan(0);
	});

	test("page budget never cuts an individual schema and full browsing remains traversable", async () => {
		const large = tool("large", "x".repeat(30_000));
		const manager = fakeManager([large, tool("next")]);
		expect(await searchMcp(config, manager, { server: "z", full: true })).toMatchObject({ nextOffset: 1, tools: [{ description: large.description, inputSchema: large.inputSchema }] });
		expect(await searchMcp(config, manager, { server: "z", full: true, offset: 1 })).toMatchObject({ tools: [{ name: "next" }] });
	});

	test("global search reports failed servers without losing healthy results", async () => {
		const manager = { status: () => "failed", catalog: async (server: string) => { if (server === "z") throw new Error("offline"); return [tool("search")]; } } as unknown as McpManager;
		expect(await searchMcp(config, manager, { query: "search" })).toMatchObject({ tools: [{ server: "exa", name: "search" }], unavailable: [{ server: "z", error: "offline" }] });
		expect(await searchMcp(config, manager, { limit: 1 })).toMatchObject({ servers: [{ name: "exa", hint: "Web search", status: "failed" }], nextOffset: 1 });
	});

	test("waiting for discovery is cancellable without cancelling shared discovery", async () => {
		let resolve!: (value: number) => void;
		const pending = new Promise<number>((done) => { resolve = done; });
		const controller = new AbortController();
		const waiting = waitForMcp(pending, controller.signal);
		controller.abort(new Error("cancelled"));
		await expect(waiting).rejects.toThrow("cancelled");
		resolve(42);
		expect(await pending).toBe(42);
	});
});

describe("MCP hint generation", () => {
	test("fills only missing effective entries, preserves unrelated fields and writes to original files", async () => {
		const f = await fixture();
		try {
			await writeFile(f.global, JSON.stringify({ custom: "keep", mcpServers: { exa: { command: "global" }, keep: { command: "keep", hint: "Handwritten" }, other: { command: "other" } } }, null, 2));
			await writeFile(f.project, JSON.stringify({ mcpServers: { exa: { command: "project", hint: " " } } }));
			const loaded = await loadMcpConfig(f.cwd, f.agentDir, true);
			const before = mcpDirectory(loaded);
			const calls: string[] = [];
			const summary = await generateMcpHints(loaded, undefined, async (server) => { calls.push(server); return `Purpose of ${server}.`; }, new AbortController().signal, () => {});
			expect(calls).toEqual(["exa", "other"]);
			expect(summary.saved).toEqual(["exa", "other"]);
			expect(JSON.parse(await readFile(f.global, "utf8"))).toEqual({ custom: "keep", mcpServers: { exa: { command: "global" }, keep: { command: "keep", hint: "Handwritten" }, other: { command: "other", hint: "Purpose of other." } } });
			expect(JSON.parse(await readFile(f.project, "utf8")).mcpServers.exa.hint).toBe("Purpose of exa.");
			expect(mcpDirectory(loaded)).toBe(before);
		} finally { await rm(f.root, { recursive: true, force: true }); }
	});

	test("does not overwrite a hint or changed endpoint edited while generation runs", async () => {
		const f = await fixture();
		try {
			await writeFile(f.global, JSON.stringify({ mcpServers: { exa: { command: "exa" } } }));
			const loaded = await loadMcpConfig(f.cwd, f.agentDir, false);
			const summary = await generateMcpHints(loaded, undefined, async () => {
				await writeFile(f.global, JSON.stringify({ mcpServers: { exa: { command: "exa", hint: "Manual edit" } } }));
				return "Generated";
			}, new AbortController().signal, () => {});
			expect(summary.skipped).toEqual(["exa"]);
			expect(JSON.parse(await readFile(f.global, "utf8")).mcpServers.exa.hint).toBe("Manual edit");
			await writeFile(f.global, JSON.stringify({ mcpServers: { exa: { command: "replacement" } } }));
			expect(await saveMcpHint(f.global, "exa", loaded.servers.get("exa")!, "wrong server")).toBe(false);
		} finally { await rm(f.root, { recursive: true, force: true }); }
	});

	test("continues after failure and preserves completed writes on cancellation", async () => {
		const f = await fixture();
		try {
			await writeFile(f.global, JSON.stringify({ mcpServers: { a: { command: "a" }, b: { command: "b" }, c: { command: "c" }, d: { command: "d" } } }));
			const loaded = await loadMcpConfig(f.cwd, f.agentDir, false);
			const controller = new AbortController();
			const calls: string[] = [];
			const summary = await generateMcpHints(loaded, undefined, async (server) => {
				calls.push(server);
				if (server === "a") throw new Error("offline");
				if (server === "c") controller.abort();
				return "A useful capability.";
			}, controller.signal, () => {});
			expect(calls).toEqual(["a", "b", "c"]);
			expect(summary).toEqual({ saved: ["b"], skipped: [], failed: ["a: offline"], cancelled: true });
			const saved = JSON.parse(await readFile(f.global, "utf8")).mcpServers;
			expect(saved.b.hint).toBe("A useful capability.");
			expect(saved.c.hint).toBeUndefined();
		} finally { await rm(f.root, { recursive: true, force: true }); }
	});

	test("slash command saves long text without output limits or thinking content", async () => {
		const f = await fixture();
		try {
			await writeFile(f.global, JSON.stringify({ mcpServers: { exa: { command: "exa" } } }));
			const loaded = await loadMcpConfig(f.cwd, f.agentDir, false);
			let handler: any;
			const notices: string[] = [];
			const usage: unknown[] = [];
			let requestedModel: unknown;
			const longHint = "Search the web and retrieve content. ".repeat(30).trim();
			const model = { id: "test", provider: "local" };
			registerMcpHintCommand({ on() {}, registerCommand(name: string, options: any) { expect(name).toBe("mcp-gen-hints"); handler = options.handler; }, appendEntry(_type: string, data: unknown) { usage.push(data); } } as any, async () => fakeManager([tool("search")]), () => loaded, f.agentDir);
			await handler("", { cwd: f.cwd, model, hasUI: true, isProjectTrusted: () => false,
				modelRegistry: { async complete(selected: unknown, context: any, options: any) {
					requestedModel = selected;
					expect(context.messages).toHaveLength(1);
					expect(context.tools).toBeUndefined();
					expect(options.signal).toBeInstanceOf(AbortSignal);
					expect(options.maxTokens).toBeUndefined();
					expect(context.systemPrompt).not.toContain("300");
					return { content: [{ type: "thinking", thinking: "Internal reasoning. ".repeat(500) }, { type: "text", text: longHint }], stopReason: "stop", usage: { input: 10, output: 4 } };
				} }, ui: { notify: (message: string) => notices.push(message), custom: (factory: any) => new Promise((resolve) => {
					const loader = factory({ requestRender() {} }, { fg: (_color: string, text: string) => text }, {}, (result: unknown) => { loader.dispose(); resolve(result); });
				}) },
			});
			expect(requestedModel).toBe(model);
			expect(notices.at(-1)).toContain("Saved 1 MCP hints");
			expect(usage).toHaveLength(1);
			expect(JSON.parse(await readFile(f.global, "utf8")).mcpServers.exa.hint).toBe(longHint);
		} finally { await rm(f.root, { recursive: true, force: true }); }
	});
});

test("hint command Escape cancels the model request without saving its late response", async () => {
	const f = await fixture();
	try {
		await writeFile(f.global, JSON.stringify({ mcpServers: { exa: { command: "exa" } } }));
		const loaded = await loadMcpConfig(f.cwd, f.agentDir, false);
		let handler: any;
		let loader: any;
		let signal: AbortSignal | undefined;
		const notices: string[] = [];
		registerMcpHintCommand({ on() {}, registerCommand(_name: string, options: any) { handler = options.handler; }, appendEntry() {} } as any,
			async () => fakeManager([tool("search")]), () => loaded, f.agentDir);
		await handler("exa", {
			cwd: f.cwd, hasUI: true, model: { id: "test", provider: "local" }, isProjectTrusted: () => false,
			modelRegistry: { async complete(_model: unknown, _context: unknown, options: any) {
				signal = options.signal;
				loader.handleInput("\x1b");
				return { content: [{ type: "text", text: "Late generated hint." }], stopReason: "stop", usage: {} };
			} },
			ui: { notify: (message: string) => notices.push(message), custom: (factory: any) => new Promise((resolve) => {
				loader = factory({ requestRender() {} }, { fg: (_color: string, text: string) => text }, {}, (result: unknown) => { loader.dispose(); resolve(result); });
			}) },
		});
		expect(signal?.aborted).toBe(true);
		expect(notices.at(-1)).toContain("Cancelled. Saved 0");
		expect(JSON.parse(await readFile(f.global, "utf8")).mcpServers.exa.hint).toBeUndefined();
	} finally { await rm(f.root, { recursive: true, force: true }); }
});
