import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";

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

export class McpResultView implements Component {
	private readonly fullText: Text;

	constructor(
		private readonly text: string,
		private readonly expanded: boolean,
		private readonly outputStyle: (text: string) => string = (value) => value,
		private readonly mutedStyle: (text: string) => string = (value) => value,
	) {
		this.fullText = new Text(this.outputStyle(text), 0, 0);
	}

	render(width: number): string[] {
		if (this.expanded) return this.fullText.render(width);

		const prefix = this.text.slice(0, MCP_COLLAPSED_MAX_CHARS);
		const rendered = new Text(this.outputStyle(prefix), 0, 0).render(width);
		const clipped = prefix.length < this.text.length || rendered.length > MCP_COLLAPSED_MAX_LINES;
		return clipped
			? [
					...rendered.slice(0, MCP_COLLAPSED_MAX_LINES),
					this.mutedStyle("… (Ctrl+O to expand)"),
				]
			: rendered;
	}

	invalidate(): void {}
}

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
