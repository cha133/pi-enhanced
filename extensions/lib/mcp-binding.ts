import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type PiToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];

export interface McpToolSource {
	readonly tools: PiToolDefinition[];
	subscribe(listener: (tools: PiToolDefinition[]) => void): () => void;
}

export function bindMcpTools(pi: ExtensionAPI, manager: McpToolSource): () => void {
	let previous = new Set<string>();
	return manager.subscribe((tools) => {
		for (const tool of tools) pi.registerTool(tool);
		const next = new Set(tools.map((tool) => tool.name));
		if (previous.size === 0 && next.size === 0) return;
		const active = pi.getActiveTools().filter((name) => !previous.has(name));
		pi.setActiveTools([...new Set([...active, ...next])]);
		previous = next;
	});
}
