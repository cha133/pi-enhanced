import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface EnhancedToolActivation {
	shellName: "bash" | "powershell";
	toolNames: Iterable<string>;
}

export function activateEnhancedTools(pi: ExtensionAPI, options: EnhancedToolActivation): void {
	const active = new Set(pi.getActiveTools());
	active.delete("bash");
	active.delete("powershell");
	active.delete("pwsh");
	active.add(options.shellName);
	for (const name of options.toolNames) {
		if (name !== "bash" && name !== "powershell" && name !== "pwsh") active.add(name);
	}
	pi.setActiveTools([...active]);
}
