import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createEnhancedEditTool } from "./edit.js";
import { createEnhancedReadTool } from "./read.js";
import { createEnhancedShell, type ShellRegistration } from "./shell.js";
import { createEnhancedWriteTool } from "./write.js";

export interface EnhancedCodingSurface {
	shell: ShellRegistration;
	toolNames: string[];
}

export function registerEnhancedCodingSurface(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	shell: ShellRegistration = createEnhancedShell(ctx.cwd),
): EnhancedCodingSurface {
	const edit = createEnhancedEditTool(ctx.cwd);
	const read = createEnhancedReadTool(ctx.cwd, ctx);
	const write = createEnhancedWriteTool(ctx.cwd);
	pi.registerTool(shell.tool);
	pi.registerTool(edit);
	pi.registerTool(read);
	pi.registerTool(write);
	return { shell, toolNames: [shell.tool.name, edit.name, read.name, write.name] };
}

export function refreshModelAwareCodingSurface(pi: ExtensionAPI, ctx: ExtensionContext): void {
	pi.registerTool(createEnhancedReadTool(ctx.cwd, ctx));
}
