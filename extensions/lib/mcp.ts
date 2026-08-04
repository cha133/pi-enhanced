import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Client,
	StreamableHTTPClientTransport,
	type CallToolResult,
	type Tool as McpSdkTool,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";

export interface HttpMcpServerConfig {
	url: string;
}

export interface StdioMcpServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export type McpServerConfig = HttpMcpServerConfig | StdioMcpServerConfig;

export interface McpConfigIssue {
	path: string;
	server?: string;
	message: string;
}

export interface LoadedMcpConfig {
	servers: Map<string, McpServerConfig>;
	issues: McpConfigIssue[];
}

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
	fingerprint?: string;
}

type PiContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const MCP_COLLAPSED_MAX_LINES = 3;
const MCP_COLLAPSED_MAX_CHARS = 800;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateServerConfig(value: unknown): McpServerConfig | string {
	if (!isRecord(value)) return "configuration must be an object";
	const hasUrl = "url" in value;
	const hasCommand = "command" in value;
	if (hasUrl === hasCommand) return "exactly one of url or command is required";

	if (hasUrl) {
		const unsupported = Object.keys(value).filter((key) => key !== "url");
		if (unsupported.length > 0) return `unsupported field(s): ${unsupported.join(", ")}`;
		if (typeof value.url !== "string" || value.url.trim().length === 0) return "url must be a non-empty string";
		try {
			const url = new URL(value.url);
			if (url.protocol !== "http:" && url.protocol !== "https:") return "url must use http or https";
		} catch {
			return "url must be a valid absolute HTTP URL";
		}
		return { url: value.url };
	}

	if (typeof value.command !== "string" || value.command.trim().length === 0) {
		return "command must be a non-empty string";
	}
	const unsupported = Object.keys(value).filter((key) => key !== "command" && key !== "args" && key !== "env");
	if (unsupported.length > 0) return `unsupported field(s): ${unsupported.join(", ")}`;
	if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((item) => typeof item !== "string"))) {
		return "args must be an array of strings";
	}
	if (value.env !== undefined) {
		if (!isRecord(value.env) || Object.values(value.env).some((item) => typeof item !== "string")) {
			return "env must be an object whose values are strings";
		}
	}
	return {
		command: value.command,
		args: value.args as string[] | undefined,
		env: value.env as Record<string, string> | undefined,
	};
}

async function readConfigFile(path: string): Promise<{ entries?: Record<string, unknown>; issues: McpConfigIssue[] }> {
	let text: string;
	try {
		text = await fs.readFile(path, "utf8");
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { issues: [] };
		return { issues: [{ path, message: `could not read file: ${error instanceof Error ? error.message : String(error)}` }] };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error: unknown) {
		return { issues: [{ path, message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }] };
	}
	if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
		return { issues: [{ path, message: "top-level mcpServers object is required" }] };
	}
	return { entries: parsed.mcpServers, issues: [] };
}

export async function loadMcpConfig(cwd: string, agentDir: string, projectTrusted: boolean): Promise<LoadedMcpConfig> {
	const paths = [join(agentDir, "mcp.json"), ...(projectTrusted ? [join(cwd, ".mcp.json")] : [])];
	const servers = new Map<string, McpServerConfig>();
	const issues: McpConfigIssue[] = [];

	for (const path of paths) {
		const loaded = await readConfigFile(path);
		issues.push(...loaded.issues);
		if (!loaded.entries) continue;
		for (const [server, value] of Object.entries(loaded.entries)) {
			servers.delete(server);
			if (server.trim().length === 0) {
				issues.push({ path, server, message: "server name must not be empty" });
				continue;
			}
			const config = validateServerConfig(value);
			if (typeof config === "string") {
				issues.push({ path, server, message: config });
				continue;
			}
			servers.set(server, config);
		}
	}

	return { servers, issues };
}

function inheritedEnvironment(): Record<string, string> {
	return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
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
	const transport = "url" in config
		? new StreamableHTTPClientTransport(new URL(config.url))
		: new StdioClientTransport({
				command: config.command,
				args: config.args ?? [],
				env: { ...inheritedEnvironment(), ...(config.env ?? {}) },
				cwd,
			});
	try {
		await client.connect(transport, { signal });
	} catch (error: unknown) {
		await client.close().catch(() => undefined);
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

function normalizeName(value: string): string {
	const normalized = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
	return normalized || "tool";
}

function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function boundedToolName(value: string): string {
	if (value.length <= 64) return value;
	const suffix = shortHash(value);
	return `${value.slice(0, 55)}_${suffix}`;
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

function resultDisplayText(content: PiContent[]): string {
	const lines = content.flatMap((part) => part.type === "text" ? [part.text] : [`[image: ${part.mimeType}]`]);
	return lines.length > 0 ? lines.join("\n") : "(empty result)";
}

export class McpResultView implements Component {
	private readonly identityText: Text;
	private readonly fullText: Text;

	constructor(
		identity: string,
		private readonly text: string,
		private readonly expanded: boolean,
		private readonly identityStyle: (text: string) => string = (value) => value,
		private readonly outputStyle: (text: string) => string = (value) => value,
		private readonly mutedStyle: (text: string) => string = (value) => value,
	) {
		this.identityText = new Text(this.identityStyle(identity), 0, 0);
		this.fullText = new Text(this.outputStyle(text), 0, 0);
	}

	render(width: number): string[] {
		const identity = this.identityText.render(width);
		if (this.expanded) return [...identity, ...this.fullText.render(width)];

		const prefix = this.text.slice(0, MCP_COLLAPSED_MAX_CHARS);
		const rendered = new Text(this.outputStyle(prefix), 0, 0).render(width);
		const clipped = prefix.length < this.text.length || rendered.length > MCP_COLLAPSED_MAX_LINES;
		return clipped
			? [
					...identity,
					...rendered.slice(0, MCP_COLLAPSED_MAX_LINES),
					this.mutedStyle("… (Ctrl+O to expand)"),
				]
			: [...identity, ...rendered];
	}

	invalidate(): void {}
}

export class McpManager {
	private readonly states = new Map<string, ServerState>();
	private readonly listeners = new Set<(tools: PiToolDefinition[]) => void>();
	private readonly assignedNames = new Map<string, string>();
	private readonly usedNames: Set<string>;
	private readonly abortController = new AbortController();
	private starting: Promise<void> | undefined;
	private closed = false;

	constructor(
		private readonly cwd: string,
		private readonly agentDir: string,
		private readonly projectTrusted: boolean,
		private readonly report: (message: string) => void,
		reservedNames: Iterable<string> = [],
		private readonly connector: McpConnector = connectMcpServer,
	) {
		this.usedNames = new Set(reservedNames);
	}

	get tools(): PiToolDefinition[] {
		const definitions: PiToolDefinition[] = [];
		for (const [server, state] of [...this.states].sort(([left], [right]) => left.localeCompare(right))) {
			for (const tool of [...state.tools.values()].sort((left, right) => left.name.localeCompare(right.name))) {
				definitions.push(this.createToolDefinition(server, state.connection.client, tool));
			}
		}
		return definitions;
	}

	subscribe(listener: (tools: PiToolDefinition[]) => void): () => void {
		this.listeners.add(listener);
		listener(this.tools);
		return () => this.listeners.delete(listener);
	}

	start(): Promise<void> {
		this.starting ??= this.loadAndConnect();
		return this.starting;
	}

	private async loadAndConnect(): Promise<void> {
		const loaded = await loadMcpConfig(this.cwd, this.agentDir, this.projectTrusted);
		if (this.closed) return;
		for (const issue of loaded.issues) {
			this.report(`${issue.path}${issue.server !== undefined ? ` (${issue.server})` : ""}: ${issue.message}`);
		}
		await Promise.all(
			[...loaded.servers].map(async ([server, config]) => {
				let connection: McpConnection | undefined;
				try {
					let pendingTools: McpSdkTool[] | undefined;
					connection = await this.connector(server, config, (tools) => {
						const state = this.states.get(server);
						if (state) this.updateServerTools(server, state, tools);
						else pendingTools = tools;
					}, this.abortController.signal, this.cwd);
					if (this.closed) {
						await connection.close();
						return;
					}
					const listed = pendingTools ?? (await connection.client.listTools(undefined, { signal: this.abortController.signal })).tools;
					if (this.closed) {
						await connection.close();
						return;
					}
					const state = { connection, tools: new Map<string, McpSdkTool>(), fingerprint: undefined };
					this.states.set(server, state);
					this.updateServerTools(server, state, listed);
				} catch (error: unknown) {
					if (connection) await connection.close().catch(() => undefined);
					if (!this.closed) this.report(`${server}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}),
		);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.abortController.abort();
		await this.starting?.catch(() => undefined);
		this.listeners.clear();
		const connections = [...this.states.values()].map((state) => state.connection);
		this.states.clear();
		await Promise.allSettled(connections.map((connection) => connection.close()));
	}

	private updateServerTools(server: string, state: ServerState, tools: McpSdkTool[]): void {
		if (this.closed) return;
		const fingerprint = createHash("sha256")
			.update(stableJson([...tools].sort((left, right) => left.name.localeCompare(right.name))))
			.digest("hex");
		if (state.fingerprint === fingerprint) return;
		state.fingerprint = fingerprint;
		state.tools = new Map(tools.map((tool) => [tool.name, tool]));
		for (const listener of this.listeners) listener(this.tools);
	}

	private toolName(server: string, tool: string): string {
		const key = `${server}\0${tool}`;
		const assigned = this.assignedNames.get(key);
		if (assigned) return assigned;

		const base = boundedToolName(`mcp_${normalizeName(server)}_${normalizeName(tool)}`);
		let candidate = base;
		if (this.usedNames.has(candidate)) candidate = boundedToolName(`${base}_${shortHash(key)}`);
		this.assignedNames.set(key, candidate);
		this.usedNames.add(candidate);
		return candidate;
	}

	private createToolDefinition(server: string, client: McpClientLike, tool: McpSdkTool): PiToolDefinition {
		return {
			name: this.toolName(server, tool.name),
			label: `${server} · ${tool.title ?? tool.name}`,
			description: tool.description
				? `MCP server "${server}": ${tool.description}`
				: `Call ${tool.name} on MCP server "${server}".`,
			parameters: tool.inputSchema as PiToolDefinition["parameters"],
			async execute(_toolCallId, input, signal) {
				const result = await client.callTool(
					{ name: tool.name, arguments: input as Record<string, unknown> },
					{ signal, toolDefinition: tool },
				);
				const guarded = await guardMcpOutput(convertToolResult(result));
				if (result.isError) {
					const message = guarded.content.map((part) => part.type === "text" ? part.text : `[image: ${part.mimeType}]`).join("\n");
					throw new Error(message || `MCP tool ${server}/${tool.name} failed.`);
				}
				return {
					content: guarded.content,
					details: {
						server,
						tool: tool.name,
						...(guarded.truncation ? { truncation: guarded.truncation } : {}),
					} satisfies McpToolDetails,
				};
			},
			renderResult(result, options, theme) {
				if (options.isPartial) return new Text(theme.fg("warning", `MCP ${server}/${tool.name}…`), 0, 0);
				const details = result.details as McpToolDetails | undefined;
				const identity = `MCP ${details?.server ?? server}/${details?.tool ?? tool.name}`;
				return new McpResultView(
					identity,
					resultDisplayText(result.content as PiContent[]),
					options.expanded,
					(text) => theme.fg("muted", text),
					(text) => theme.fg("toolOutput", text),
					(text) => theme.fg("muted", text),
				);
			},
		};
	}
}
