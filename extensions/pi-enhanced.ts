import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activateEnhancedTools } from "./lib/activation.js";
import { createEnhancedEditTool } from "./lib/edit.js";
import { createEnhancedShell, type ShellRegistration } from "./lib/shell.js";
import { registerSessionInfo } from "./lib/session-info.js";
import { registerSessionTitle } from "./lib/session-title.js";
import { createSubagentTool, isAdvisorAvailable } from "./lib/subagent.js";
import { createViewImageTool } from "./lib/view-image.js";

export default function piEnhanced(pi: ExtensionAPI): void {
	registerSessionInfo(pi);
	registerSessionTitle(pi);

	let shell: ShellRegistration | undefined;
	let cwd: string | undefined;

	const registerModelAwareTools = (ctx: ExtensionContext) => {
		pi.registerTool(createViewImageTool(ctx.cwd, ctx));
		pi.registerTool(createSubagentTool(isAdvisorAvailable(ctx), () => pi.getThinkingLevel()));
	};

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
		shell = createEnhancedShell(ctx.cwd);
		pi.registerTool(shell.tool);
		pi.registerTool(createEnhancedEditTool(ctx.cwd));
		registerModelAwareTools(ctx);
		activateEnhancedTools(pi, shell.name);
	});

	pi.on("model_select", (_event, ctx) => {
		if (!shell || cwd !== ctx.cwd) return;
		registerModelAwareTools(ctx);
		activateEnhancedTools(pi, shell.name);
	});
}
