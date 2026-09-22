import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activateEnhancedTools } from "./lib/activation.js";
import { createEnhancedEditTool } from "./lib/edit.js";
import { loadMcpConfig, type LoadedMcpConfig } from "./lib/mcp-config.js";
import { createMcpTools } from "./lib/mcp-tools.js";
import { registerMcpHintCommand } from "./lib/mcp-hints.js";
import { collectHistoricalMcpToolNames, createHistoricalMcpToolDefinition } from "./lib/mcp-rendering.js";
import type { McpManager } from "./lib/mcp.js";
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
	let mcpManager: McpManager | undefined;
	let mcpConfig: LoadedMcpConfig | undefined;
	let mcpInitialization: Promise<void> | undefined;
	let mcpLifecycle: object | undefined;

	const getMcpManager = async () => {
		await mcpInitialization;
		if (!mcpManager) throw new Error("MCP initialization failed or session closed.");
		return mcpManager;
	};
	registerMcpHintCommand(pi, getMcpManager, () => mcpConfig, getAgentDir());

	const activateSurface = () => {
		if (!shell) return;
		activateEnhancedTools(pi, {
			shellName: shell.name,
			toolNames: enhancedToolNames,
		});
	};

	pi.on("session_start", async (_event, ctx) => {
		mcpLifecycle = undefined;
		await mcpInitialization;
		await mcpManager?.close();
		mcpManager = undefined;
		mcpConfig = await loadMcpConfig(ctx.cwd, getAgentDir(), ctx.isProjectTrusted());
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

		const registeredNames = new Set(pi.getAllTools().map((tool) => tool.name));
		const historicalMcpNames = collectHistoricalMcpToolNames(ctx.sessionManager.buildContextEntries());

		for (const name of historicalMcpNames) {
			if (registeredNames.has(name)) continue;
			pi.registerTool(createHistoricalMcpToolDefinition(name));
		}

		for (const tool of createMcpTools(mcpConfig, getMcpManager)) pi.registerTool(tool);
		pi.setActiveTools([...new Set([...pi.getActiveTools(), "mcp_search", "mcp_call"])]);

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

			const manager = new McpManager(
				ctx.cwd,
				getAgentDir(),
				ctx.isProjectTrusted(),
				(message) => {
					if (mcpManager !== manager) return;
					reportMcpError(message);
				},
				undefined,
				mcpConfig,
			);
			mcpManager = manager;
			void manager.start().catch((error: unknown) => {
				if (mcpManager === manager) reportMcpError(error instanceof Error ? error.message : String(error));
			});
		})().catch((error: unknown) => {
			if (mcpLifecycle === lifecycle) reportMcpError(error instanceof Error ? error.message : String(error));
		});
	});

	pi.on("model_select", (_event, ctx) => {
		if (!shell || cwd !== ctx.cwd) return;
		pi.registerTool(createEnhancedReadTool(ctx.cwd, ctx));
		activateSurface();
	});

	pi.on("session_shutdown", async () => {
		mcpLifecycle = undefined;
		const initialization = mcpInitialization;
		mcpInitialization = undefined;
		await initialization;
		const manager = mcpManager;
		mcpManager = undefined;
		await manager?.close();
	});
}
