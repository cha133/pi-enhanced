import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import { StringEnum, type Usage } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import {
	createAgentSession,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
	truncateHead,
	type AgentSession,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createEnhancedEditTool } from "./edit.js";
import { bindMcpTools, type McpManager } from "./mcp.js";
import { createEnhancedReadTool } from "./read.js";
import { createEnhancedShell } from "./shell.js";
import { loadModelRoute } from "./settings.js";
import { OneLine } from "./one-line.js";

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
export type SubagentTier = "peer" | "advisor";
export type SubagentPhase = "starting" | "tool" | "reasoning" | "replying" | "finished" | "failed" | "cancelled";

export interface SubagentStatus {
	phase: SubagentPhase;
	summary: string;
}

export interface SubagentDetails {
	tier: SubagentTier;
	provider: string;
	model: string;
	status: SubagentStatus;
	transcriptPath?: string;
	fullOutputPath?: string;
	truncated?: boolean;
}

export function formatSubagentStatus(status: SubagentStatus): string {
	if (status.phase === "finished") return `finished · ${status.summary}`;
	return `${status.phase}: ${status.summary}`;
}

interface SessionEvent {
	type?: string;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	message?: {
		role?: string;
		content?: unknown;
		stopReason?: string;
		errorMessage?: string;
		usage?: Usage;
	};
	assistantMessageEvent?: { type?: string; delta?: string };
}

interface RunResult {
	output: string;
	stopReason?: string;
	errorMessage?: string;
	usage: Usage;
	transcriptPath?: string;
	transcriptError?: string;
}

const SUBAGENT_SYSTEM_PROMPT = `You are an independent coding subagent working for a parent coding agent.

Investigate the delegated task autonomously using the available tools. Inspect primary evidence. Modify files only
when the task explicitly authorizes implementation; otherwise remain read-only. Never invoke or spawn another agent.

Return a self-contained report to the parent agent, not the end user. Lead with conclusions, cite concrete evidence,
distinguish fact from inference, and call out important uncertainty.`;

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function addUsage(target: Usage, value: Usage | undefined): void {
	if (!value) return;
	target.input += value.input;
	target.output += value.output;
	target.cacheRead += value.cacheRead;
	target.cacheWrite += value.cacheWrite;
	target.totalTokens += value.totalTokens;
	target.cost.input += value.cost.input;
	target.cost.output += value.cost.output;
	target.cost.cacheRead += value.cost.cacheRead;
	target.cost.cacheWrite += value.cost.cacheWrite;
	target.cost.total += value.cost.total;
	if (value.reasoning !== undefined) target.reasoning = (target.reasoning ?? 0) + value.reasoning;
	if (value.cacheWrite1h !== undefined) target.cacheWrite1h = (target.cacheWrite1h ?? 0) + value.cacheWrite1h;
}

function modelIs(left: { provider: string; id: string } | undefined, right: { provider: string; id: string } | undefined): boolean {
	return !!left && !!right && left.provider === right.provider && left.id === right.id;
}

function advisorModel(ctx: ExtensionContext): Model<any> | undefined {
	const route = loadModelRoute(ctx, "advisor", false);
	if (!route) return undefined;
	return ctx.modelRegistry.find(route.provider, route.model);
}

export function isAdvisorAvailable(ctx: ExtensionContext): boolean {
	try {
		const advisor = advisorModel(ctx);
		return !!advisor && !modelIs(ctx.model, advisor);
	} catch {
		return false;
	}
}

function resolveModel(ctx: ExtensionContext, tier: SubagentTier): Model<any> {
	if (!ctx.model) throw new Error("No current model is selected.");
	if (tier === "peer") return ctx.model;
	const advisor = advisorModel(ctx);
	if (!advisor) throw new Error("Advisor is not configured or its model is unavailable.");
	if (modelIs(ctx.model, advisor)) throw new Error("Advisor is the same as the current model.");
	return advisor;
}

function compact(value: string | undefined, fallback: string): string {
	return value?.trim().split(/\r?\n/).filter(Boolean).at(-1)?.replace(/\s+/g, " ") ?? fallback;
}

function toolActivity(name: string | undefined, args: unknown): string {
	if (!name) return "Using tool...";
	if (args && typeof args === "object") {
		const values = args as Record<string, unknown>;
		const subject = values.path ?? values.command ?? values.query ?? values.title;
		if (typeof subject === "string" && subject.trim()) return `${name}: ${compact(subject, "")}`;
	}
	return name;
}

export class SubagentProgressTracker {
	private active = new Map<string, string>();
	private thinking = "";
	private reply = "";
	private status: SubagentStatus = { phase: "starting", summary: "subagent..." };

	get current(): SubagentStatus {
		return this.status;
	}

	handle(event: SessionEvent): SubagentStatus | undefined {
		let next: SubagentStatus | undefined;
		if (event.type === "message_start" && event.message?.role === "assistant") {
			next = { phase: "starting", summary: "model..." };
		}
		if (event.type === "tool_execution_start") {
			const summary = toolActivity(event.toolName, event.args);
			this.active.set(event.toolCallId ?? String(this.active.size), summary);
			next = { phase: "tool", summary };
		}
		if (event.type === "tool_execution_end") {
			if (event.toolCallId) this.active.delete(event.toolCallId);
			next = this.active.size > 0
				? { phase: "tool", summary: [...this.active.values()].at(-1)! }
				: { phase: "starting", summary: "continuing..." };
		}
		const delta = event.assistantMessageEvent?.delta;
		if (event.type === "message_update" && delta) {
			if (event.assistantMessageEvent?.type === "thinking_delta") {
				this.thinking += delta;
				next = { phase: "reasoning", summary: compact(this.thinking, "model...") };
			}
			if (event.assistantMessageEvent?.type === "text_delta") {
				this.reply += delta;
				next = { phase: "replying", summary: compact(this.reply, "model...") };
			}
		}
		if (!next || (next.phase === this.status.phase && next.summary === this.status.summary)) return undefined;
		this.status = next;
		return next;
	}
}

function messageText(event: SessionEvent): string {
	if (!Array.isArray(event.message?.content)) return "";
	return event.message.content
		.filter((part): part is { type: string; text: string } => {
			return !!part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string";
		})
		.map((part) => part.text)
		.join("\n")
		.trim();
}

async function createChildSession(
	cwd: string,
	model: Model<any>,
	thinkingLevel: ThinkingLevel,
	projectTrusted: boolean,
	mcpManager: McpManager | undefined,
): Promise<AgentSession> {
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
	const shell = createEnhancedShell(cwd);
	const childExtension = (pi: ExtensionAPI) => {
		let unbindMcp: (() => void) | undefined;
		pi.on("session_start", (_event, ctx) => {
			pi.registerTool(shell.tool);
			pi.registerTool(createEnhancedEditTool(ctx.cwd));
			pi.registerTool(createEnhancedReadTool(ctx.cwd, ctx));
			const active = new Set(pi.getActiveTools());
			active.delete("subagent");
			if (shell.name === "pwsh") {
				active.delete("bash");
				active.add("pwsh");
			} else {
				active.delete("pwsh");
			}
			active.add("write");
			active.add("edit");
			active.add("read");
			pi.setActiveTools([...active]);
			if (mcpManager) unbindMcp = bindMcpTools(pi, mcpManager);
		});
		pi.on("session_shutdown", () => unbindMcp?.());
	};
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		extensionFactories: [{ name: "pi-enhanced-child", hidden: true, factory: childExtension }],
		appendSystemPrompt: [SUBAGENT_SYSTEM_PROMPT],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel,
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.inMemory(cwd),
	});
	await session.bindExtensions({});
	return session;
}

async function shutdown(session: AgentSession): Promise<void> {
	try {
		await session.abort();
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	} finally {
		session.dispose();
	}
}

async function runSubagent(
	cwd: string,
	model: Model<any>,
	thinkingLevel: ThinkingLevel,
	projectTrusted: boolean,
	mcpManager: McpManager | undefined,
	task: string,
	signal: AbortSignal | undefined,
	onStatus: ((status: SubagentStatus) => void) | undefined,
): Promise<RunResult> {
	const session = await createChildSession(cwd, model, thinkingLevel, projectTrusted, mcpManager);
	const usage = emptyUsage();
	const tracker = new SubagentProgressTracker();
	let output = "";
	let stopReason: string | undefined;
	let errorMessage: string | undefined;
	let transcriptPath: string | undefined;
	let transcriptError: string | undefined;
	let pending: SubagentStatus | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastUpdate = 0;
	const flush = () => {
		if (!pending || !onStatus) return;
		onStatus(pending);
		pending = undefined;
		lastUpdate = Date.now();
	};
	const publish = (status: SubagentStatus, immediate = false) => {
		if (!onStatus) return;
		pending = status;
		const remaining = 100 - (Date.now() - lastUpdate);
		if (immediate || remaining <= 0) {
			if (timer) clearTimeout(timer);
			timer = undefined;
			flush();
		} else if (!timer) {
			timer = setTimeout(() => {
				timer = undefined;
				flush();
			}, remaining);
		}
	};
	publish(tracker.current, true);
	const unsubscribe = session.subscribe((event) => {
		const typed = event as SessionEvent;
		const status = tracker.handle(typed);
		if (status) publish(status, typed.type === "tool_execution_start" || typed.type === "tool_execution_end");
		if (typed.type !== "message_end" || typed.message?.role !== "assistant") return;
		output = messageText(typed) || output;
		stopReason = typed.message.stopReason;
		errorMessage = typed.message.errorMessage;
		addUsage(usage, typed.message.usage);
	});
	let abortPromise: Promise<void> | undefined;
	const abort = () => {
		abortPromise ??= session.abort();
		void abortPromise.catch(() => undefined);
	};
	try {
		if (signal?.aborted) abort();
		else signal?.addEventListener("abort", abort, { once: true });
		if (!signal?.aborted) await session.prompt(task);
		if (abortPromise) await abortPromise;
	} catch (error: unknown) {
		stopReason = "error";
		errorMessage = error instanceof Error ? error.message : String(error);
	} finally {
		signal?.removeEventListener("abort", abort);
		unsubscribe();
		if (timer) clearTimeout(timer);
		flush();
		try {
			transcriptPath = session.exportToJsonl(join(tmpdir(), `pi-subagent-${session.sessionId}.jsonl`));
		} catch (error: unknown) {
			transcriptError = error instanceof Error ? error.message : String(error);
		}
		await shutdown(session);
	}
	if (signal?.aborted) stopReason = "aborted";
	return { output, stopReason, errorMessage, usage, transcriptPath, transcriptError };
}

async function truncateOutput(output: string): Promise<{ text: string; truncated: boolean; fullOutputPath?: string }> {
	const truncated = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	if (!truncated.truncated) return { text: truncated.content, truncated: false };
	const directory = await fs.mkdtemp(join(tmpdir(), "pi-subagent-"));
	const fullOutputPath = join(directory, "output.txt");
	await fs.writeFile(fullOutputPath, output, { encoding: "utf8", mode: 0o600 });
	return {
		text: `${truncated.content}\n\n[Output truncated. Full output: ${fullOutputPath}]`,
		truncated: true,
		fullOutputPath,
	};
}

function createParameters(advisorAvailable: boolean) {
	return Type.Object({
		title: Type.String({ description: "Concise human-readable task title", maxLength: 80 }),
		task: Type.String({ description: "Self-contained delegated task, including whether edits are authorized" }),
		...(advisorAvailable
			? { tier: Type.Optional(StringEnum(["peer", "advisor"] as const, { default: "peer" })) }
			: {}),
	});
}

export function createSubagentTool(
	available: boolean,
	getThinkingLevel: () => ThinkingLevel,
	getMcpManager: () => McpManager | undefined = () => undefined,
): Parameters<ExtensionAPI["registerTool"]>[0] {
	return {
		name: "subagent",
		label: "subagent",
		description: available
			? "Delegate an independent investigation, implementation, or review to an isolated peer or configured advisor. The child inherits this platform's effective pi-enhanced toolset but cannot spawn agents."
			: "Delegate an independent investigation, implementation, or review to an isolated peer using the current model. The child inherits this platform's effective pi-enhanced toolset but cannot spawn agents.",
		promptSnippet: "Delegate focused independent work to a tool-using subagent",
		promptGuidelines: [
			"Delegate only focused work that can proceed autonomously; keep routine work in the main agent.",
			"Provide a concise title and a self-contained task with objective, context, constraints, deliverable, and explicit edit authorization.",
			"Use peer by default. Use advisor only for difficult judgments or important audits that materially benefit from the configured model.",
			"Treat the report as evidence to reconcile with primary sources. Keep transcript paths internal unless the user requests them.",
		],
		executionMode: "parallel",
		parameters: createParameters(available),
		async execute(
			_toolCallId,
			input: { title: string; task: string; tier?: SubagentTier },
			signal,
			onUpdate: AgentToolUpdateCallback<SubagentDetails | undefined> | undefined,
			ctx,
		) {
			const tier = input.tier ?? "peer";
			if (tier === "advisor" && !isAdvisorAvailable(ctx)) {
				return { content: [{ type: "text", text: "[Subagent failed: advisor is unavailable]" }], details: undefined };
			}
			let model: Model<any>;
			try {
				model = resolveModel(ctx, tier);
			} catch (error: unknown) {
				return { content: [{ type: "text", text: `[Subagent failed: ${error instanceof Error ? error.message : String(error)}]` }], details: undefined };
			}
			const makeDetails = (status: SubagentStatus): SubagentDetails => ({
				tier,
				provider: model.provider,
				model: model.id,
				status,
			});
			const result = await runSubagent(
				ctx.cwd,
				model,
				getThinkingLevel(),
				ctx.isProjectTrusted(),
				getMcpManager(),
				input.task,
				signal,
				onUpdate ? (status) => onUpdate({ content: [], details: makeDetails(status) }) : undefined,
			);
			const failed = result.stopReason === "error" || result.stopReason === "aborted";
			const raw = result.output || result.errorMessage || "(subagent returned no text)";
			const output = await truncateOutput(raw);
			const status: SubagentStatus = failed
				? {
						phase: result.stopReason === "aborted" ? "cancelled" : "failed",
						summary: compact(result.errorMessage, result.stopReason === "aborted" ? "aborted" : "subagent failed"),
					}
				: { phase: "finished", summary: model.id };
			const transcript = result.transcriptPath
				? `\n\n[Full subagent transcript: ${result.transcriptPath}]`
				: result.transcriptError
					? `\n\n[Subagent transcript unavailable: ${result.transcriptError}]`
					: "";
			return {
				content: [{ type: "text", text: `${failed ? "[Subagent failed]\n" : ""}${output.text}${transcript}` }],
				details: {
					...makeDetails(status),
					transcriptPath: result.transcriptPath,
					truncated: output.truncated,
					fullOutputPath: output.fullOutputPath,
				},
				usage: result.usage,
			};
		},
		renderCall(rawInput: unknown, theme) {
			const input = rawInput as { tier?: SubagentTier; title?: string } | undefined;
			return new OneLine([
				{
					text: `subagent · ${input?.tier ?? "peer"} · ${input?.title ?? ""}`,
					style: (text) => theme.fg("toolTitle", theme.bold(text)),
				},
			]);
		},
		renderResult(result, options, theme, context) {
			const details = result.details as SubagentDetails | undefined;
			const resultText = result.content.find((part) => part.type === "text")?.text;
			const status = details?.status ?? {
				phase: options.isPartial ? "starting" : context.isError || resultText?.startsWith("[Subagent failed") ? "failed" : "finished",
				summary: options.isPartial ? "subagent..." : resultText?.startsWith("[Subagent failed") ? compact(resultText, "subagent failed") : "subagent",
			} satisfies SubagentStatus;
			const color = status.phase === "failed" ? "error" : status.phase === "cancelled" ? "warning" : status.phase === "finished" ? "success" : "muted";
			return new OneLine([
				{
					text: formatSubagentStatus(status),
					style: (text) => theme.fg(color, text),
				},
			]);
		},
	};
}
