import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Tool } from "@modelcontextprotocol/client";
import type { LoadedMcpConfig } from "./mcp-config.js";
import type { McpManager } from "./mcp.js";
import { renderMcpCall, renderMcpResult } from "./mcp-rendering.js";

type Definition = Parameters<ExtensionAPI["registerTool"]>[0];
export interface McpSearchInput {
	server?: string;
	query?: string;
	tool?: string;
	full?: boolean;
	limit?: number;
	offset?: number;
}

export function mcpDirectory(config: LoadedMcpConfig): string {
	return [...config.servers].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
		.map(([name]) => JSON.stringify(name)).join("\n");
}

function words(text: string): string[] {
	return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function scoreMcpTool(tool: Tool, query: string): number {
	const terms = words(query);
	const name = words(tool.name);
	const title = words(tool.title ?? "");
	const description = words(tool.description ?? "");
	const parameters = words(Object.keys(tool.inputSchema.properties ?? {}).join(" "));
	return (tool.name.toLowerCase() === query.toLowerCase() ? 100 : 0) + terms.reduce((sum, term) => sum
		+ (name.includes(term) ? 10 : 0) + (title.includes(term) ? 5 : 0)
		+ (description.includes(term) ? 2 : 0) + (parameters.includes(term) ? 1 : 0), 0);
}

export async function searchMcp(config: LoadedMcpConfig, manager: McpManager, input: McpSearchInput, signal?: AbortSignal) {
	const { server, tool } = input;
	const query = input.query?.trim();
	if (tool && !server) throw new Error("An exact tool lookup requires server.");
	if (server && !config.servers.has(server)) throw new Error(`Unknown MCP server: ${server}`);
	const offset = input.offset ?? 0;
	const limit = input.limit ?? (query ? 5 : 20);
	if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
		throw new Error("offset must be a non-negative integer; limit must be between 1 and 50.");
	}
	if (!server && !query && !input.full) {
		const servers = [...config.servers].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
		return { servers: servers.slice(offset, offset + limit).map(([name]) => ({ name, status: manager.status(name) })), total: servers.length,
			...(offset + limit < servers.length ? { nextOffset: offset + limit } : {}) };
	}
	const unavailable: { server: string; error: string }[] = [];
	const groups = await Promise.all((server ? [server] : [...config.servers.keys()].sort()).map(async (name) => {
		try { return (await manager.catalog(name, signal)).map((definition) => ({ server: name, definition })); }
		catch (error) {
			signal?.throwIfAborted();
			if (server) throw error;
			unavailable.push({ server: name, error: error instanceof Error ? error.message : String(error) });
			return [];
		}
	}));
	const matches = groups.flat().filter((item) => !tool || item.definition.name === tool)
		.map((item) => ({ ...item, score: query ? scoreMcpTool(item.definition, query) : 0 }))
		.filter((item) => !query || item.score > 0);
	matches.sort((a, b) => b.score - a.score || a.server.localeCompare(b.server) || a.definition.name.localeCompare(b.definition.name));
	if (tool && matches.length === 0) throw new Error(`Unknown MCP tool ${server}/${tool}. Browse this server with mcp_search.`);
	const full = Boolean(tool || (input.full ?? Boolean(query)));
	const results: unknown[] = [];
	let bytes = 0;
	for (const item of matches.slice(offset, offset + limit)) {
		const entry = full ? { server: item.server, ...item.definition } : {
			server: item.server, name: item.definition.name, description: (item.definition.description ?? item.definition.title ?? "").slice(0, 240),
		};
		const size = Buffer.byteLength(JSON.stringify(entry));
		// Always return an individual definition intact, even if it alone exceeds the page budget.
		if (results.length > 0 && bytes + size > 24_000) break;
		results.push(entry);
		bytes += size;
	}
	const next = offset + results.length;
	return { tools: results, total: matches.length, ...(next < matches.length ? { nextOffset: next } : {}),
		...(unavailable.length ? { unavailable: unavailable.sort((a, b) => a.server.localeCompare(b.server)) } : {}),
		...(matches.length === 0 ? { suggestion: "Try English keywords, another term, or omit query to browse a server's tools." } : {}) };
}

export function createMcpTools(config: LoadedMcpConfig, getManager: () => Promise<McpManager>): Definition[] {
	return [{
		name: "mcp_search", label: "MCP search",
		description: "Discover MCP tools. No arguments lists servers; server alone browses compact tool descriptions. query searches names/descriptions/parameter names (prefer English keywords) and returns matching full schemas. server + tool retrieves an exact definition. full requests complete definitions while browsing. Follow nextOffset for more results; omit query to avoid keyword misses. Use mcp_call after inspecting the schema.\nConfigured MCP servers (static session snapshot):\n" + (mcpDirectory(config) || "(none)"),
		parameters: { type: "object", properties: {
			server: { type: "string" }, query: { type: "string" }, tool: { type: "string" }, full: { type: "boolean" },
			limit: { type: "integer", minimum: 1, maximum: 50 }, offset: { type: "integer", minimum: 0 },
		}, additionalProperties: false },
		async execute(_id, input, signal) {
			const result = await searchMcp(config, await getManager(), input as McpSearchInput, signal);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
		}, renderResult: renderMcpResult,
	}, {
		name: "mcp_call", label: "MCP call",
		renderCall: renderMcpCall,
		description: "Call a configured MCP server tool using its original name and arguments. Discover the current schema with mcp_search first unless already known. Arguments are validated against the live tool schema before sending.",
		parameters: { type: "object", properties: {
			server: { type: "string" }, tool: { type: "string" }, arguments: { type: "object", additionalProperties: true },
		}, required: ["server", "tool", "arguments"], additionalProperties: false },
		async execute(_id, input, signal) {
			const args = input as { server: string; tool: string; arguments: Record<string, unknown> };
			return (await getManager()).call(args.server, args.tool, args.arguments, signal);
		}, renderResult: renderMcpResult,
	}];
}
