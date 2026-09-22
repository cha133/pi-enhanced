import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
	Client,
	StreamableHTTPClientTransport,
	type CallToolResult,
	type Tool as McpSdkTool,
} from "@modelcontextprotocol/client";
import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { loadMcpConfig, type LoadedMcpConfig, type McpServerConfig, type StdioMcpServerConfig } from "./mcp-config.js";

export { loadMcpConfig, type McpServerConfig } from "./mcp-config.js";
export { McpResultView } from "./mcp-rendering.js";

export interface McpToolDetails {
	server: string;
	tool: string;
	truncation?: McpOutputTruncation;
}

export interface McpOutputTruncation {
	originalBytes: number;
	originalLines: number;
	returnedBytes: number;
	returnedLines: number;
	fullOutputPath?: string;
	writeError?: string;
}

type PiToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];

interface McpClientLike {
	connect(transport: unknown): Promise<void>;
	close(): Promise<void>;
	listTools(params?: undefined, options?: { signal?: AbortSignal }): Promise<{ tools: McpSdkTool[] }>;
	callTool(
		params: { name: string; arguments?: Record<string, unknown> },
		options?: { signal?: AbortSignal; toolDefinition?: McpSdkTool },
	): Promise<CallToolResult>;
}

interface McpConnection {
	client: McpClientLike;
	close(): Promise<void>;
}

export type McpConnector = (
	serverName: string,
	config: McpServerConfig,
	onToolsChanged: (tools: McpSdkTool[]) => void,
	signal: AbortSignal,
	cwd: string,
) => Promise<McpConnection>;

interface ServerState {
	connection: McpConnection;
	tools: Map<string, McpSdkTool>;
}

type PiContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const MCP_STDERR_MAX_CHARS = 8_192;

function inheritedEnvironment(): Record<string, string> {
	return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

export function createStdioMcpTransport(config: StdioMcpServerConfig, cwd: string): {
	transport: StdioClientTransport;
	readStderr: () => string;
} {
	const transport = new StdioClientTransport({
		command: config.command,
		args: config.args ?? [],
		env: { ...inheritedEnvironment(), ...(config.env ?? {}) },
		cwd,
		stderr: "pipe",
	});
	const decoder = new StringDecoder("utf8");
	let stderr = "";
	const append = (text: string) => {
		stderr = `${stderr}${text}`.slice(-MCP_STDERR_MAX_CHARS);
	};
	transport.stderr?.on("data", (chunk: Buffer | string) => {
		append(typeof chunk === "string" ? chunk : decoder.write(chunk));
	});
	transport.stderr?.on("end", () => append(decoder.end()));
	return { transport, readStderr: () => stderr.trim() };
}

async function connectMcpServer(
	_serverName: string,
	config: McpServerConfig,
	onToolsChanged: (tools: McpSdkTool[]) => void,
	signal: AbortSignal,
	cwd: string,
): Promise<McpConnection> {
	const client = new Client(
		{ name: "pi-enhanced", version: "0.1.0" },
		{
			listChanged: {
				tools: {
					onChanged(error, tools) {
						if (!error && tools) onToolsChanged(tools);
					},
				},
			},
		},
	);
	const stdio = "command" in config ? createStdioMcpTransport(config, cwd) : undefined;
	const transport = "url" in config
		? new StreamableHTTPClientTransport(new URL(config.url))
		: stdio!.transport;
	try {
		await client.connect(transport, { signal });
	} catch (error: unknown) {
		await client.close().catch(() => undefined);
		const stderr = stdio?.readStderr();
		if (stderr && (!(error instanceof DOMException) || error.name !== "AbortError")) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`${message}\nMCP server stderr (tail):\n${stderr}`, { cause: error });
		}
		throw error;
	}
	return {
		client,
		async close() {
			if (transport instanceof StreamableHTTPClientTransport) {
				try {
					await transport.terminateSession();
				} catch {
					// Stateless servers and already-closed sessions may reject termination.
				}
			}
			await client.close();
		},
	};
}

function textForUnsupportedContent(content: CallToolResult["content"][number]): string {
	if (content.type === "audio") return `[MCP audio result: ${content.mimeType}, ${content.data.length} base64 characters]`;
	if (content.type === "resource_link") {
		return `[MCP resource: ${content.name}${content.description ? ` — ${content.description}` : ""}] ${content.uri}`;
	}
	if (content.type === "resource") {
		const resource = content.resource;
		if ("text" in resource) return `[MCP resource: ${resource.uri}]\n${resource.text}`;
		return `[MCP binary resource: ${resource.uri}${resource.mimeType ? ` (${resource.mimeType})` : ""}]`;
	}
	return `[Unsupported MCP content: ${content.type}]`;
}

function convertToolResult(result: CallToolResult): PiContent[] {
	const content = result.content.map((part) => {
		if (part.type === "text") return { type: "text" as const, text: part.text };
		if (part.type === "image") return { type: "image" as const, data: part.data, mimeType: part.mimeType };
		return { type: "text" as const, text: textForUnsupportedContent(part) };
	});
	const hasNativeText = result.content.some((part) => {
		return part.type === "text" || (part.type === "resource" && "text" in part.resource);
	});
	if (!hasNativeText && result.structuredContent !== undefined) {
		content.unshift({ type: "text", text: JSON.stringify(result.structuredContent, null, 2) });
	}
	return content.length > 0 ? content : [{ type: "text", text: "(MCP tool returned no content)" }];
}

function textStats(text: string): { bytes: number; lines: number } {
	if (text.length === 0) return { bytes: 0, lines: 0 };
	return {
		bytes: Buffer.byteLength(text, "utf8"),
		lines: text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length,
	};
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateUtf8Head(text: string, maxBytes: number): string {
	if (maxBytes <= 0) return "";
	const buffer = Buffer.from(text, "utf8");
	if (buffer.length <= maxBytes) return text;
	let end = Math.min(maxBytes, buffer.length);
	while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
	return buffer.subarray(0, end).toString("utf8");
}

async function saveFullMcpOutput(text: string): Promise<{ path?: string; error?: string }> {
	try {
		const directory = await fs.mkdtemp(join(tmpdir(), "pi-mcp-"));
		const path = join(directory, "output.txt");
		await fs.writeFile(path, text, { encoding: "utf8", mode: 0o600 });
		return { path };
	} catch (error: unknown) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function truncationNotice(
	stats: { bytes: number; lines: number },
	artifact: { path?: string; error?: string },
): string {
	const base = `[MCP output truncated: original ${stats.lines.toLocaleString()} lines / ${formatBytes(stats.bytes)}.`;
	if (artifact.path) return `${base} Full text: ${artifact.path}]`;
	return `${base} Full text could not be saved: ${artifact.error ?? "unknown error"}]`;
}

export async function guardMcpOutput(
	content: PiContent[],
	maxBytes = DEFAULT_MAX_BYTES,
	maxLines = DEFAULT_MAX_LINES,
): Promise<{ content: PiContent[]; truncation?: McpOutputTruncation }> {
	const images = content.filter((part): part is Extract<PiContent, { type: "image" }> => part.type === "image");
	const text = content
		.filter((part): part is Extract<PiContent, { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	const original = textStats(text);
	if (original.bytes <= maxBytes && original.lines <= maxLines) return { content };

	const artifact = await saveFullMcpOutput(text);
	const notice = truncationNotice(original, artifact);
	const separator = "\n\n";
	const noticeStats = textStats(`${separator}${notice}`);
	const previewBytes = Math.max(0, maxBytes - noticeStats.bytes);
	const previewLines = Math.max(0, maxLines - noticeStats.lines);
	const truncated = truncateHead(text, { maxBytes: previewBytes, maxLines: previewLines });
	const preview = truncated.firstLineExceedsLimit
		? truncateUtf8Head(text.split("\n", 1)[0], previewBytes)
		: truncated.content;
	const finalText = `${preview}${separator}${notice}`;
	const returned = textStats(finalText);

	return {
		content: [{ type: "text", text: finalText }, ...images],
		truncation: {
			originalBytes: original.bytes,
			originalLines: original.lines,
			returnedBytes: returned.bytes,
			returnedLines: returned.lines,
			...(artifact.path ? { fullOutputPath: artifact.path } : {}),
			...(artifact.error ? { writeError: artifact.error } : {}),
		},
	};
}

export class McpManager {
	private readonly states = new Map<string, ServerState>();
	private readonly errors = new Map<string, string>();
	private readonly pending = new Map<string, Promise<void>>();
	private readonly abortController = new AbortController();
	private starting: Promise<void> | undefined;
	private closed = false;
	private loaded?: LoadedMcpConfig;

	constructor(
		private readonly cwd: string,
		private readonly agentDir: string,
		private readonly projectTrusted: boolean,
		private readonly report: (message: string) => void,
		private readonly connector: McpConnector = connectMcpServer,
		loaded?: LoadedMcpConfig,
	) { this.loaded = loaded; }

	start(): Promise<void> {
		this.starting ??= this.loadAndConnect();
		return this.starting;
	}

	status(server: string): string {
		return this.closed ? "closed" : this.states.has(server) ? "ready" : this.errors.has(server) ? "failed" : "connecting";
	}

	async catalog(server: string, signal?: AbortSignal): Promise<McpSdkTool[]> {
		signal?.throwIfAborted();
		if (!this.loaded?.servers.has(server)) throw new Error(`Unknown MCP server: ${server}`);
		const pending = this.pending.get(server);
		if (pending) await waitForMcp(pending, signal);
		signal?.throwIfAborted();
		const state = this.states.get(server);
		if (!state || this.closed) throw new Error(`MCP ${server}: ${this.errors.get(server) ?? "not connected"}`);
		return [...state.tools.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	}

	private async loadAndConnect(): Promise<void> {
		this.loaded ??= await loadMcpConfig(this.cwd, this.agentDir, this.projectTrusted);
		if (this.closed) return;
		for (const issue of this.loaded.issues) this.report(`${issue.path} (${issue.server ?? "config"}): ${issue.message}`);
		for (const [server, config] of this.loaded.servers) this.pending.set(server, this.connect(server, config));
		await Promise.all(this.pending.values());
	}

	private async connect(server: string, config: McpServerConfig): Promise<void> {
		let connection: McpConnection | undefined;
		const signal = AbortSignal.any([this.abortController.signal, AbortSignal.timeout(30_000)]);
		try {
			let pendingTools: McpSdkTool[] | undefined;
			connection = await this.connector(server, config, (tools) => {
				if (this.closed) return;
				const state = this.states.get(server);
				if (state) state.tools = new Map(tools.map((tool) => [tool.name, tool]));
				else pendingTools = tools;
			}, signal, this.cwd);
			signal.throwIfAborted();
			const listed = pendingTools ?? (await connection.client.listTools(undefined, { signal })).tools;
			signal.throwIfAborted();
			this.states.set(server, { connection, tools: new Map((pendingTools ?? listed).map((tool) => [tool.name, tool])) });
		} catch (error: unknown) {
			if (connection) await connection.close().catch(() => undefined);
			const message = error instanceof Error ? error.message : String(error);
			this.errors.set(server, message);
			if (!this.closed) this.report(`${server}: ${message}`);
		}
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.abortController.abort();
		await this.starting?.catch(() => undefined);
		const connections = [...this.states.values()].map((state) => state.connection);
		this.states.clear();
		await Promise.allSettled(connections.map((connection) => connection.close()));
	}

	async call(server: string, name: string, input: Record<string, unknown>, signal?: AbortSignal) {
		const tools = await this.catalog(server, signal);
		const tool = tools.find((item) => item.name === name);
		if (!tool) throw new Error(`Unknown MCP tool ${server}/${name}. Use mcp_search to inspect the current catalog.`);
		const parameters = tool.inputSchema as PiToolDefinition["parameters"];
		const args = validateToolArguments({ name, description: tool.description ?? "", parameters },
			{ type: "toolCall", id: "mcp", name, arguments: input as ToolCall["arguments"] }) as Record<string, unknown>;
		const result = await this.states.get(server)!.connection.client.callTool(
			{ name, arguments: args }, { signal, toolDefinition: tool },
		);
		const guarded = await guardMcpOutput(convertToolResult(result));
		if (result.isError) throw new Error(guarded.content.map((part) => part.type === "text" ? part.text : `[image: ${part.mimeType}]`).join("\n"));
		return { content: guarded.content, details: { server, tool: name, ...(guarded.truncation ? { truncation: guarded.truncation } : {}) } satisfies McpToolDetails };
	}
}

export async function waitForMcp<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	signal.throwIfAborted();
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}
