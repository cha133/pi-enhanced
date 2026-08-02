import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activateEnhancedTools } from "./lib/activation.js";
import { createEnhancedEditTool } from "./lib/edit.js";
import { bindMcpTools, McpManager } from "./lib/mcp.js";
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
	let mcpManager: McpManager | undefined;
	let unbindMcp: (() => void) | undefined;

	const registerModelAwareTools = (ctx: ExtensionContext) => {
		pi.registerTool(createViewImageTool(ctx.cwd, ctx));
		pi.registerTool(createSubagentTool(isAdvisorAvailable(ctx), () => pi.getThinkingLevel(), () => mcpManager));
	};

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
		shell = createEnhancedShell(ctx.cwd);
		pi.registerTool(shell.tool);
		pi.registerTool(createEnhancedEditTool(ctx.cwd));
		registerModelAwareTools(ctx);
		activateEnhancedTools(pi, shell.name);

		const reservedNames = pi.getAllTools().map((tool) => tool.name);
		const reportMcpError = (message: string) => {
			if (ctx.hasUI) ctx.ui.notify(`MCP: ${message}`, "error");
			else console.error(`[pi-enhanced MCP] ${message}`);
		};
		const manager = new McpManager(
			ctx.cwd,
			getAgentDir(),
			ctx.isProjectTrusted(),
			(message) => {
				if (mcpManager !== manager) return;
				reportMcpError(message);
			},
			reservedNames,
		);
		mcpManager = manager;
		unbindMcp = bindMcpTools(pi, manager);
		void manager.start().catch((error: unknown) => {
			if (mcpManager === manager) reportMcpError(error instanceof Error ? error.message : String(error));
		});
	});

	pi.on("model_select", (_event, ctx) => {
		if (!shell || cwd !== ctx.cwd) return;
		registerModelAwareTools(ctx);
		activateEnhancedTools(pi, shell.name);
	});

	pi.on("session_shutdown", async () => {
		unbindMcp?.();
		unbindMcp = undefined;
		const manager = mcpManager;
		mcpManager = undefined;
		await manager?.close();
	});
}
