import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function activateEnhancedTools(pi: ExtensionAPI, shellName: "bash" | "pwsh"): void {
	const active = new Set(pi.getActiveTools());
	if (shellName === "pwsh") {
		active.delete("bash");
		active.add("pwsh");
	} else {
		active.delete("pwsh");
	}
	active.add("edit");
	active.add("read");
	active.add("subagent");
	pi.setActiveTools([...active]);
}
