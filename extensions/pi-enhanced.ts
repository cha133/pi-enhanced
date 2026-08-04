import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activateEnhancedTools } from "./lib/activation.js";
import { bindMcpTools, type McpToolSource } from "./lib/mcp-binding.js";
import type { McpManager } from "./lib/mcp.js";
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
	let mcpManager: (McpManager & McpToolSource) | undefined;
	let unbindMcp: (() => void) | undefined;
	let mcpInitialization: Promise<void> | undefined;
	let mcpLifecycle: object | undefined;

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

		const lifecycle = {};
		mcpLifecycle = lifecycle;
		const reportMcpError = (message: string) => {
			if (ctx.hasUI) ctx.ui.notify(`MCP: ${message}`, "error");
			else console.error(`[pi-enhanced MCP] ${message}`);
		};
		mcpInitialization = (async () => {
			const startedAt = performance.now();
			const { McpManager } = await import("./lib/mcp.js");
			if (process.env.PI_TIMING === "1") {
				console.error(`[pi-enhanced timing] MCP module import: ${Math.round(performance.now() - startedAt)}ms`);
			}
			if (mcpLifecycle !== lifecycle) return;

			const reservedNames = pi.getAllTools().map((tool) => tool.name);
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
		})().catch((error: unknown) => {
			if (mcpLifecycle === lifecycle) reportMcpError(error instanceof Error ? error.message : String(error));
		});
	});

	pi.on("model_select", (_event, ctx) => {
		if (!codingSurface || cwd !== ctx.cwd) return;
		refreshModelAwareCodingSurface(pi, ctx);
		registerSubagent(ctx);
		activateSurface();
	});

	pi.on("session_shutdown", async () => {
		mcpLifecycle = undefined;
		const initialization = mcpInitialization;
		mcpInitialization = undefined;
		await initialization;
		unbindMcp?.();
		unbindMcp = undefined;
		const manager = mcpManager;
		mcpManager = undefined;
		await manager?.close();
	});
}
