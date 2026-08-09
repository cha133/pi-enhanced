import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface EnhancedToolActivation {
	shellName: "bash" | "pwsh";
	toolNames: Iterable<string>;
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
	pi.setActiveTools([...active]);
}
