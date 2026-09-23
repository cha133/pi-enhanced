import { describe, expect, test } from "bun:test";
import type { Tool } from "@modelcontextprotocol/client";
import { validateServerConfig, type LoadedMcpConfig } from "../extensions/lib/mcp-config.js";
import { createMcpTools, mcpDirectory, scoreMcpTool, searchMcp } from "../extensions/lib/mcp-tools.js";
import { McpManager, waitForMcp } from "../extensions/lib/mcp.js";

const tool = (name: string, description = "Browser automation"): Tool => ({ name, description, inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } });
const config: LoadedMcpConfig = { servers: new Map([["z", { command: "z" }], ["exa", { url: "https://example.test" }]]), issues: [] };
function fakeManager(tools: Tool[]): McpManager {
	return { catalog: async () => tools, status: () => "ready" } as unknown as McpManager;
}
describe("MCP lazy discovery", () => {
	test("static directory uses only configured names in a stable order", () => {
		expect(mcpDirectory(config)).toBe('"exa"\n"z"');
		const definitions = createMcpTools(config, async () => fakeManager([tool("secret_tool")]));
		expect(definitions.map((item) => item.name)).toEqual(["mcp_search", "mcp_call"]);
		expect(JSON.stringify(definitions)).not.toContain("secret_tool");
		expect(validateServerConfig({ command: "test", hint: "obsolete" })).toBe("unsupported field(s): hint");
		expect(validateServerConfig({ url: "https://example.test", hint: "obsolete" })).toBe("unsupported field(s): hint");
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
		const large = tool("large", "x".repeat(60_000));
		const manager = fakeManager([large, tool("next")]);
		expect(await searchMcp(config, manager, { server: "z", full: true })).toMatchObject({ nextOffset: 1, tools: [{ description: large.description, inputSchema: large.inputSchema }] });
		expect(await searchMcp(config, manager, { server: "z", full: true, offset: 1 })).toMatchObject({ tools: [{ name: "next" }] });
	});

	test("search header shows supplied filters on one line", () => {
		const definition = createMcpTools(config, async () => fakeManager([])).find((item) => item.name === "mcp_search")!;
		const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as any;
		const render = (args: unknown, width = 100) => definition.renderCall!(args, theme, {} as any).render(width);
		expect(render({})).toEqual(["mcp_search"]);
		expect(render({ server: "exa", query: "web search" })).toEqual(['mcp_search server="exa" query="web search"']);
		expect(render({ server: "exa", tool: "web_search_exa", full: true, limit: 5, offset: 10 })).toEqual([
			'mcp_search server="exa" tool="web_search_exa" full=true limit=5 offset=10',
		]);
		expect(render({ query: "line\nbreak" })).toEqual(['mcp_search query="line\\nbreak"']);
		expect(render({ server: "exa", query: "web search" }, 24)).toHaveLength(1);
		expect(render({ server: "exa", query: "web search" }, 24)[0]!.length).toBeLessThanOrEqual(24);
	});

	test("full search fits two 25 KB definitions in one 50 KiB page", async () => {
		const manager = fakeManager([tool("first", "x".repeat(25_000)), tool("second", "x".repeat(25_000)), tool("third", "x".repeat(2_000))]);
		const first = await searchMcp(config, manager, { server: "z", full: true, limit: 3 });
		expect(first).toMatchObject({ total: 3, nextOffset: 2, tools: [{ name: "first" }, { name: "second" }] });
		expect(await searchMcp(config, manager, { server: "z", full: true, offset: 2 })).toMatchObject({ tools: [{ name: "third" }] });
	});

	test("global search reports failed servers without losing healthy results", async () => {
		const manager = { status: () => "failed", catalog: async (server: string) => { if (server === "z") throw new Error("offline"); return [tool("search")]; } } as unknown as McpManager;
		expect(await searchMcp(config, manager, { query: "search" })).toMatchObject({ tools: [{ server: "exa", name: "search" }], unavailable: [{ server: "z", error: "offline" }] });
		expect(await searchMcp(config, manager, { limit: 1 })).toEqual({ servers: [{ name: "exa", status: "failed" }], total: 2, nextOffset: 1 });
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
