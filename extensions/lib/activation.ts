import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface EnhancedToolActivation {
	shellName: "bash" | "pwsh";
	toolNames: Iterable<string>;
	additionalToolNames?: Iterable<string>;
	excludedToolNames?: Iterable<string>;
}

export function activateEnhancedTools(pi: ExtensionAPI, options: EnhancedToolActivation): void {
	const active = new Set(pi.getActiveTools());
	if (options.shellName === "pwsh") {
		active.delete("bash");
		active.add("pwsh");
	} else {
		active.delete("pwsh");
	}
	for (const name of options.toolNames) {
		if (name !== "bash" && name !== "pwsh") active.add(name);
	}
	for (const name of options.additionalToolNames ?? []) active.add(name);
	for (const name of options.excludedToolNames ?? []) active.delete(name);
	pi.setActiveTools([...active]);
}
