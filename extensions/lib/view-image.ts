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

export interface ViewImageInput {
	path: string;
	query?: string;
	detail?: ImageDetail;
}

export type VisionPhase = "sending" | "thinking" | "reasoning" | "replying";

export interface VisionStatus {
	phase: VisionPhase;
	summary: string;
}

export interface ViewImageDetails extends ReadToolDetails {
	visionStatus?: VisionStatus;
	delegated?: boolean;
	provider?: string;
	model?: string;
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
	private status: VisionStatus = { phase: "sending", summary: "Sending image to vision model..." };

	get current(): VisionStatus {
		return this.status;
	}

	handle(event: AssistantMessageEvent): VisionStatus | undefined {
		let next: VisionStatus | undefined;
		if (event.type === "start") next = { phase: "thinking", summary: "Vision model is thinking..." };
		if (event.type === "thinking_delta") {
			this.thinking = appendBounded(this.thinking, event.delta);
			next = { phase: "reasoning", summary: compactLine(this.thinking, "Vision model is thinking...") };
		}
		if (event.type === "text_delta") {
			this.reply = appendBounded(this.reply, event.delta);
			next = { phase: "replying", summary: compactLine(this.reply, "Vision model is replying...") };
		}
		if (!next || (next.phase === this.status.phase && next.summary === this.status.summary)) return undefined;
		this.status = next;
		return next;
	}
}

function failure(message: string) {
	return {
		content: [{ type: "text" as const, text: `[Vision fallback failed: ${message}]` }],
		details: undefined,
	};
}

function findImage(content: Array<{ type: string }>): ImageContent | undefined {
	return content.find((part): part is ImageContent => part.type === "image");
}

function queryFor(input: ViewImageInput): string {
	return input.query?.trim() || "Describe this image accurately.";
}

async function delegateVision(
	image: ImageContent,
	input: ViewImageInput,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
	onUpdate: AgentToolUpdateCallback<ViewImageDetails | undefined> | undefined,
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
	const detailsFor = (visionStatus: VisionStatus): ViewImageDetails => ({
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
			{ systemPrompt: SYSTEM_PROMPTS[input.detail ?? "standard"], messages: [message] },
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
				delegated: true,
				provider: model.provider,
				model: model.id,
				truncation: truncation.truncated ? truncation : undefined,
			} satisfies ViewImageDetails,
			usage: response.usage,
		};
	} catch (error: unknown) {
		return failure(signal?.aborted ? "cancelled" : error instanceof Error ? error.message : String(error));
	}
}

export function createViewImageTool(
	cwd: string,
	ctx: ExtensionContext,
): Parameters<ExtensionAPI["registerTool"]>[0] {
	const nativeMode = supportsImages(ctx.model);
	const manager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
	const nativeRead = createReadToolDefinition(cwd, { autoResizeImages: manager.getImageAutoResize() });
	const parameters = Type.Object({
		path: Type.String({ description: "Path to a local image, relative to the working directory or absolute" }),
		query: Type.Optional(Type.String({ description: "Question or instruction about the image" })),
		detail: Type.Optional(
			StringEnum(["brief", "standard", "detailed"] as const, {
				description: "Requested analysis depth; defaults to standard",
			}),
		),
	});
	return {
		name: "view_image",
		label: "view_image",
		description: nativeMode
			? "Load a local image for you to inspect directly with your native image understanding. Images are automatically resized using pi's image settings; detail changes analysis depth, not resolution."
			: "Inspect a local image through the configured external vision model. You cannot see the image directly: this tool returns that model's visual description. Images are automatically resized using pi's image settings.",
		promptSnippet: nativeMode
			? "Load a local image for direct visual inspection"
			: "Ask the configured external vision model to inspect a local image",
		promptGuidelines: nativeMode
			? [
					"Use view_image for local images. The returned image is attached for you to inspect directly.",
					"Pass the user's visual question in query; detail controls response depth and does not request original resolution.",
				]
			: [
					"Use view_image for local images. You do not see the image directly; the returned text is an external vision model's description and should be treated as delegated evidence.",
					"Pass a precise question in query so the external vision model focuses on what the task needs.",
				],
		parameters,
		async execute(toolCallId, input: ViewImageInput, signal, onUpdate, toolCtx) {
			const result = await nativeRead.execute(toolCallId, { path: input.path }, signal, undefined, toolCtx);
			const image = findImage(result.content);
			if (!image) {
				throw new Error(`Path is not a supported image or image processing failed: ${input.path}`);
			}
			if (supportsImages(toolCtx.model)) return result;
			return delegateVision(image, input, signal, toolCtx, onUpdate);
		},
		renderCall(rawInput: unknown, theme) {
			const input = rawInput as { path?: string } | undefined;
			return new OneLine([
				{
					text: `view_image ${input?.path ?? ""}`,
					style: (text) => theme.fg("toolTitle", theme.bold(text)),
				},
			]);
		},
		renderResult(result, options, theme) {
			const details = result.details as ViewImageDetails | undefined;
			if (options.isPartial && details?.visionStatus) {
				return new OneLine([
					{ text: details.visionStatus.summary, style: (text) => theme.fg("muted", text) },
				]);
			}
			return new OneLine([
				{
					text: details?.delegated ? `Vision response · ${details.model}` : "Image attached",
					style: (text) => theme.fg("success", text),
				},
			]);
		},
	};
}
