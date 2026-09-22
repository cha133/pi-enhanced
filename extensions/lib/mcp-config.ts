import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface HttpMcpServerConfig {
	url: string;
	hint?: string;
}

export interface StdioMcpServerConfig {
	command: string;
	hint?: string;
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
	sources: Map<string, string>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateServerConfig(value: unknown): McpServerConfig | string {
	if (!isRecord(value)) return "configuration must be an object";
	if (value.hint !== undefined && typeof value.hint !== "string") return "hint must be a string";
	const hint = typeof value.hint === "string" ? { hint: value.hint.trim() } : {};
	const hasUrl = "url" in value;
	const hasCommand = "command" in value;
	if (hasUrl === hasCommand) return "exactly one of url or command is required";

	if (hasUrl) {
		const unsupported = Object.keys(value).filter((key) => key !== "url" && key !== "hint");
		if (unsupported.length > 0) return `unsupported field(s): ${unsupported.join(", ")}`;
		if (typeof value.url !== "string" || value.url.trim().length === 0) return "url must be a non-empty string";
		try {
			const url = new URL(value.url);
			if (url.protocol !== "http:" && url.protocol !== "https:") return "url must use http or https";
		} catch {
			return "url must be a valid absolute HTTP URL";
		}
		return { url: value.url, ...hint };
	}

	if (typeof value.command !== "string" || value.command.trim().length === 0) {
		return "command must be a non-empty string";
	}
	const unsupported = Object.keys(value).filter((key) => key !== "command" && key !== "args" && key !== "env" && key !== "hint");
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
		...hint,
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
	const sources = new Map<string, string>();
	const issues: McpConfigIssue[] = [];

	for (const path of paths) {
		const loaded = await readConfigFile(path);
		issues.push(...loaded.issues);
		if (!loaded.entries) continue;
		for (const [server, value] of Object.entries(loaded.entries)) {
			servers.delete(server);
			sources.delete(server);
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
			sources.set(server, path);
		}
	}

	return { servers, issues, sources };
}

