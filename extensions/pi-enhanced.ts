import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activateEnhancedTools } from "./lib/activation.js";
import { bindMcpTools, McpManager } from "./lib/mcp.js";
import { registerSessionInfo } from "./lib/session-info.js";
import { registerSessionTitle } from "./lib/session-title.js";
import { createSubagentTool, isAdvisorAvailable } from "./lib/subagent.js";
import {
	refreshModelAwareCodingSurface,
	registerEnhancedCodingSurface,
	type EnhancedCodingSurface,
} from "./lib/tool-surface.js";

export default function piEnhanced(pi: ExtensionAPI): void {
	registerSessionInfo(pi);
	registerSessionTitle(pi);

	let codingSurface: EnhancedCodingSurface | undefined;
	let cwd: string | undefined;
	let mcpManager: McpManager | undefined;
	let unbindMcp: (() => void) | undefined;

	const registerSubagent = (ctx: ExtensionContext) => {
		pi.registerTool(createSubagentTool(
			isAdvisorAvailable(ctx),
			() => pi.getThinkingLevel(),
			() => mcpManager,
			() => pi.getActiveTools(),
		));
	};

	const activateSurface = () => {
		if (!codingSurface) return;
		activateEnhancedTools(pi, {
			shellName: codingSurface.shell.name,
			toolNames: codingSurface.toolNames,
			additionalToolNames: ["subagent"],
		});
	};

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
		codingSurface = registerEnhancedCodingSurface(pi, ctx);
		registerSubagent(ctx);
		activateSurface();

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
		if (!codingSurface || cwd !== ctx.cwd) return;
		refreshModelAwareCodingSurface(pi, ctx);
		registerSubagent(ctx);
		activateSurface();
	});

	pi.on("session_shutdown", async () => {
		unbindMcp?.();
		unbindMcp = undefined;
		const manager = mcpManager;
		mcpManager = undefined;
		await manager?.close();
	});
}
