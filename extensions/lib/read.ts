import type { AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	stream,
	type AssistantMessage,
	type AssistantMessageEvent,
	type ImageContent,
	type UserMessage,
} from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import {
	createReadToolDefinition,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	getAgentDir,
	SettingsManager,
	truncateHead,
	type ExtensionAPI,
	type ExtensionContext,
	type ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import { loadModelRoute } from "./settings.js";
import { OneLine } from "./one-line.js";

const SYSTEM_PROMPTS = {
	brief: "Answer the visual request in one or two concise sentences. Mention only directly visible evidence.",
	standard:
		"Answer the visual request accurately with enough visible detail to be useful. Cover relevant objects, layout, spatial relationships, colors, and visible text without unsupported inference.",
	detailed:
		"Give a thorough, precise answer grounded in the image. Cover all relevant foreground and background details, layout, colors, textures, spatial relationships, and exact visible text.",
} as const;

type ImageDetail = keyof typeof SYSTEM_PROMPTS;

export interface EnhancedReadInput {
	path: string;
	offset?: number;
	limit?: number;
	image?: {
		query?: string;
		detail?: ImageDetail;
	};
}

export type VisionPhase = "sending" | "thinking" | "reasoning" | "replying" | "finished" | "failed" | "cancelled";

export interface VisionStatus {
	phase: VisionPhase;
	summary: string;
}

export interface EnhancedReadDetails extends ReadToolDetails {
	visionStatus?: VisionStatus;
	delegated?: boolean;
	provider?: string;
	model?: string;
}

export function formatVisionStatus(status: VisionStatus): string {
	if (status.phase === "finished") return `finished · ${status.summary}`;
	return `${status.phase}: ${status.summary}`;
}

interface ModelWithInputs {
	input?: readonly string[];
}

function supportsImages(model: ModelWithInputs | undefined): boolean {
	return model?.input?.includes("image") ?? false;
}

function compactLine(value: string, fallback: string): string {
	const paragraph = value.trim().split(/\r?\n\s*\r?\n/).at(-1) ?? "";
	return paragraph.split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim() || fallback;
}

function appendBounded(current: string, delta: string): string {
	const combined = current + delta;
	if (Buffer.byteLength(combined, "utf8") <= DEFAULT_MAX_BYTES) return combined;
	return Buffer.from(combined, "utf8").subarray(-DEFAULT_MAX_BYTES).toString("utf8");
}

export class VisionProgressTracker {
	private thinking = "";
	private reply = "";
	private status: VisionStatus = { phase: "sending", summary: "image to vision model..." };

	get current(): VisionStatus {
		return this.status;
	}

	handle(event: AssistantMessageEvent): VisionStatus | undefined {
		let next: VisionStatus | undefined;
		if (event.type === "start") next = { phase: "thinking", summary: "vision model..." };
		if (event.type === "thinking_delta") {
			this.thinking = appendBounded(this.thinking, event.delta);
			next = { phase: "reasoning", summary: compactLine(this.thinking, "vision model...") };
		}
		if (event.type === "text_delta") {
			this.reply = appendBounded(this.reply, event.delta);
			next = { phase: "replying", summary: compactLine(this.reply, "vision model...") };
		}
		if (!next || (next.phase === this.status.phase && next.summary === this.status.summary)) return undefined;
		this.status = next;
		return next;
	}
}

function failure(message: string) {
	const phase: VisionPhase = message === "cancelled" ? "cancelled" : "failed";
	return {
		content: [{ type: "text" as const, text: `[Vision fallback failed: ${message}]` }],
		details: { visionStatus: { phase, summary: message }, delegated: true } satisfies EnhancedReadDetails,
	};
}

function findImage(content: Array<{ type: string }>): ImageContent | undefined {
	return content.find((part): part is ImageContent => part.type === "image");
}

export function needsVisionFallback(
	content: Array<{ type: string }>,
	model: ModelWithInputs | undefined,
): boolean {
	return !supportsImages(model) && findImage(content) !== undefined;
}

function queryFor(input: EnhancedReadInput): string {
	return input.image?.query?.trim() || "Describe this image accurately.";
}

async function delegateVision(
	image: ImageContent,
	input: EnhancedReadInput,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
	onUpdate: AgentToolUpdateCallback<EnhancedReadDetails | undefined> | undefined,
) {
	let route;
	try {
		route = loadModelRoute(ctx, "vision", true)!;
	} catch (error: unknown) {
		return failure(error instanceof Error ? error.message : String(error));
	}
	const modelName = `${route.provider}/${route.model}`;
	const model = ctx.modelRegistry.find(route.provider, route.model);
	if (!model) return failure(`configured model "${modelName}" is not registered in pi`);
	if (!supportsImages(model)) return failure(`configured model "${modelName}" does not support image input`);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) return failure(`could not authenticate "${modelName}": ${auth.error}`);

	const message: UserMessage = {
		role: "user",
		content: [{ type: "text", text: queryFor(input) }, image],
		timestamp: Date.now(),
	};
	const progress = new VisionProgressTracker();
	let pending: VisionStatus | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastUpdate = 0;
	const detailsFor = (visionStatus: VisionStatus): EnhancedReadDetails => ({
		visionStatus,
		delegated: true,
		provider: model.provider,
		model: model.id,
	});
	const flush = () => {
		if (!pending || !onUpdate) return;
		onUpdate({ content: [], details: detailsFor(pending) });
		pending = undefined;
		lastUpdate = Date.now();
	};
	const publish = (status: VisionStatus, immediate = false) => {
		if (!onUpdate) return;
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
	publish(progress.current, true);

	try {
		const responseStream = stream(
			model,
			{ systemPrompt: SYSTEM_PROMPTS[input.image?.detail ?? "standard"], messages: [message] },
			{ apiKey: auth.apiKey, headers: auth.headers, env: auth.env, signal },
		);
		let response: AssistantMessage | undefined;
		try {
			for await (const event of responseStream) {
				const status = progress.handle(event);
				if (status) publish(status);
				if (event.type === "done") response = event.message;
				if (event.type === "error") response = event.error;
			}
		} finally {
			if (timer) clearTimeout(timer);
			flush();
		}
		if (!response) return failure(`model "${modelName}" ended without a response`);
		if (response.stopReason === "aborted") return failure("cancelled");
		if (response.stopReason === "error") {
			return failure(`model "${modelName}" returned an error: ${response.errorMessage ?? "unknown error"}`);
		}
		const description = response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		if (!description) return failure(`model "${modelName}" returned no text`);
		const truncation = truncateHead(description, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
		return {
			content: [{ type: "text" as const, text: truncation.content }],
			details: {
				visionStatus: { phase: "finished", summary: model.id },
				delegated: true,
				provider: model.provider,
				model: model.id,
				truncation: truncation.truncated ? truncation : undefined,
			} satisfies EnhancedReadDetails,
			usage: response.usage,
		};
	} catch (error: unknown) {
		return failure(signal?.aborted ? "cancelled" : error instanceof Error ? error.message : String(error));
	}
}

export function createEnhancedReadTool(
	cwd: string,
	ctx: ExtensionContext,
): Parameters<ExtensionAPI["registerTool"]>[0] {
	const nativeMode = supportsImages(ctx.model);
	const manager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
	const nativeRead = createReadToolDefinition(cwd, { autoResizeImages: manager.getImageAutoResize() });
	const parameters = Type.Object({
		...nativeRead.parameters.properties,
		image: Type.Optional(Type.Object({
			query: Type.Optional(Type.String({ description: "Question or instruction about an image" })),
			detail: Type.Optional(
				StringEnum(["brief", "standard", "detailed"] as const, {
					description: "Requested visual analysis depth; defaults to standard",
				}),
			),
		})),
	});
	return {
		...nativeRead,
		name: "read",
		label: "read",
		description: nativeMode
			? nativeRead.description.replace("Images are sent as attachments.", "Images are sent as attachments for direct inspection.")
			: nativeRead.description.replace("Images are sent as attachments.", "Images are inspected by the configured external vision model and returned as text."),
		promptSnippet: nativeMode
			? "Read file contents and inspect images directly"
			: "Read file contents with automatic vision fallback",
		promptGuidelines: nativeMode
			? [
					...(nativeRead.promptGuidelines ?? []),
					"Use read for both text files and local images; images are attached for you to inspect directly.",
					"Pass a visual question in image.query; image.detail controls response depth, not resolution.",
				]
			: [
					...(nativeRead.promptGuidelines ?? []),
					"Use read for both text files and local images; image reads return the configured external vision model's description as delegated evidence.",
					"Pass a precise visual question in image.query and use image.detail when response depth matters.",
				],
		parameters,
		async execute(toolCallId, input: EnhancedReadInput, signal, onUpdate, toolCtx) {
			const { image: _image, ...nativeInput } = input;
			const result = await nativeRead.execute(toolCallId, nativeInput, signal, onUpdate, toolCtx);
			if (!needsVisionFallback(result.content, toolCtx.model)) return result;
			const image = findImage(result.content)!;
			return delegateVision(image, input, signal, toolCtx, onUpdate);
		},
		renderCall(rawInput: unknown, theme, context) {
			return nativeRead.renderCall!(rawInput as any, theme, context as any);
		},
		renderResult(result, options, theme, context) {
			const details = result.details as EnhancedReadDetails | undefined;
			if (options.isPartial && details?.visionStatus) {
				return new OneLine([
					{ text: formatVisionStatus(details.visionStatus), style: (text) => theme.fg("muted", text) },
				]);
			}
			if (!details?.delegated) return nativeRead.renderResult!(result as any, options, theme, context as any);
			const status: VisionStatus = details.visionStatus ?? { phase: "finished", summary: "vision model" };
			const color = status.phase === "failed" ? "error" : status.phase === "cancelled" ? "warning" : "success";
			return new OneLine([
				{
					text: formatVisionStatus(status),
					style: (text) => theme.fg(color, text),
				},
			]);
		},
	};
}
