import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activateEnhancedTools } from "./lib/activation.js";
import { createEnhancedEditTool } from "./lib/edit.js";
import { createEnhancedReadTool } from "./lib/read.js";
import { registerSessionInfo } from "./lib/session-info.js";
import { registerSessionTitle } from "./lib/session-title.js";
import { createEnhancedShell, type ShellRegistration } from "./lib/shell.js";
import { createEnhancedWriteTool } from "./lib/write.js";

export default function piEnhanced(pi: ExtensionAPI): void {
	registerSessionInfo(pi);
	registerSessionTitle(pi);

	let shell: ShellRegistration | undefined;
	let enhancedToolNames: string[] = [];
	let cwd: string | undefined;

	const activateSurface = () => {
		if (!shell) return;
		activateEnhancedTools(pi, {
			shellName: shell.name,
			toolNames: enhancedToolNames,
		});
	};

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
		shell = createEnhancedShell(ctx.cwd);
		const edit = createEnhancedEditTool(ctx.cwd);
		const read = createEnhancedReadTool(ctx.cwd, ctx);
		const write = createEnhancedWriteTool(ctx.cwd);
		pi.registerTool(shell.tool);
		pi.registerTool(edit);
		pi.registerTool(read);
		pi.registerTool(write);
		enhancedToolNames = [shell.tool.name, edit.name, read.name, write.name];
		activateSurface();
	});

	pi.on("model_select", (_event, ctx) => {
		if (!shell || cwd !== ctx.cwd) return;
		pi.registerTool(createEnhancedReadTool(ctx.cwd, ctx));
		activateSurface();
	});
}
