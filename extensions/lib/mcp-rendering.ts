import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { OneLine } from "./one-line.js";

type PiToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];
type PiContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const MCP_COLLAPSED_MAX_LINES = 3;
const MCP_COLLAPSED_MAX_CHARS = 800;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resultDisplayText(content: PiContent[]): string {
	const lines = content.flatMap((part) => part.type === "text" ? [part.text] : [`[image: ${part.mimeType}]`]);
	return lines.length > 0 ? lines.join("\n") : "(empty result)";
}

function compactJsonForCollapsed(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
	try {
		const compact = JSON.stringify(JSON.parse(trimmed));
		return compact.length < trimmed.length ? compact : text;
	} catch {
		return text;
	}
}

export class McpResultView implements Component {
	private readonly fullText: Text;
	private readonly collapsedSource: string;

	constructor(
		private readonly text: string,
		private readonly expanded: boolean,
		private readonly outputStyle: (text: string) => string = (value) => value,
		private readonly mutedStyle: (text: string) => string = (value) => value,
	) {
		this.fullText = new Text(this.outputStyle(text), 0, 0);
		this.collapsedSource = compactJsonForCollapsed(text);
	}

	render(width: number): string[] {
		if (this.expanded) return this.fullText.render(width);

		const prefix = this.collapsedSource.slice(0, MCP_COLLAPSED_MAX_CHARS);
		const rendered = new Text(this.outputStyle(prefix), 0, 0).render(width);
		const clipped = prefix.length < this.collapsedSource.length || rendered.length > MCP_COLLAPSED_MAX_LINES;
		return clipped
			? [
					...rendered.slice(0, MCP_COLLAPSED_MAX_LINES),
					this.mutedStyle("… (Ctrl+O to expand)"),
				]
			: rendered;
	}

	invalidate(): void {}
}

export const renderMcpCall: NonNullable<PiToolDefinition["renderCall"]> = (args, theme) => {
	// Streaming arguments may be incomplete; keep the target visible as it arrives.
	const input = isRecord(args) ? args : {};
	const displayName = (value: unknown) => typeof value === "string" && value.length > 0
		? value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
		: "…";
	return new Text(
		theme.fg("toolTitle", theme.bold("mcp_call")) + " "
			+ theme.fg("accent", `${displayName(input.server)} / ${displayName(input.tool)}`),
		0, 0,
	);
};

export const renderMcpSearch: NonNullable<PiToolDefinition["renderCall"]> = (args, theme) => {
	const input = isRecord(args) ? args : {};
	const fields = ["server", "tool", "query", "full", "limit", "offset"]
		.flatMap((key) => {
			const value = input[key];
			if (typeof value === "string") return [`${key}=${JSON.stringify(value)}`];
			if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return [`${key}=${value}`];
			return [];
		});
	return new OneLine([
		{ text: "mcp_search", style: (text) => theme.fg("toolTitle", theme.bold(text)) },
		{ text: fields.length > 0 ? ` ${fields.join(" ")}` : "", style: (text) => theme.fg("accent", text) },
	]);
};

export const renderMcpResult: NonNullable<PiToolDefinition["renderResult"]> = (result, options, theme) => {
	if (options.isPartial) return new Text(theme.fg("warning", "Running…"), 0, 0);
	return new McpResultView(
		resultDisplayText(result.content as PiContent[]),
		options.expanded,
		(text) => theme.fg("toolOutput", text),
		(text) => theme.fg("muted", text),
	);
};

export function collectHistoricalMcpToolNames(entries: readonly unknown[]): Set<string> {
	const names = new Set<string>();
	for (const entry of entries) {
		if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
		const message = entry.message;
		if (message.role !== "toolResult" || typeof message.toolName !== "string") continue;
		if (!message.toolName.startsWith("mcp_")) continue;
		names.add(message.toolName);
	}
	return names;
}

export function createHistoricalMcpToolDefinition(name: string): PiToolDefinition {
	return {
		name,
		label: name,
		description: "Historical MCP tool placeholder used only to render resumed session output.",
		parameters: { type: "object", additionalProperties: true },
		async execute() {
			throw new Error(`MCP tool ${name} is not connected yet.`);
		},
		renderResult: renderMcpResult,
	};
}
