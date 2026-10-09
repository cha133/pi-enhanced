import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activateEnhancedTools } from "./lib/activation.js";
import { createEnhancedEditTool } from "./lib/edit.js";
import { registerSessionInfo } from "./lib/session-info.js";
import { registerSessionTitle } from "./lib/session-title.js";
import { createEnhancedShell, createPowerShellVersionDetector, type ShellRegistration } from "./lib/shell.js";

export default function piEnhanced(pi: ExtensionAPI): void {
	registerSessionInfo(pi);
	registerSessionTitle(pi);

	const detectPowerShellVersion = createPowerShellVersionDetector();
	let shell: ShellRegistration | undefined;
	let enhancedToolNames: string[] = [];

	const activateSurface = () => {
		if (!shell) return;
		activateEnhancedTools(pi, {
			shellName: shell.name,
			toolNames: enhancedToolNames,
		});
	};

	pi.on("session_start", (_event, ctx) => {
		shell = createEnhancedShell(ctx.cwd, process.platform, undefined, detectPowerShellVersion);
		const edit = createEnhancedEditTool(ctx.cwd);
		pi.registerTool(shell.tool);
		pi.registerTool(edit);
		enhancedToolNames = [shell.tool.name, edit.name];
		activateSurface();
	});
}
