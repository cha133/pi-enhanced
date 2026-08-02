/** Persist and inject fixed first-message time and first-turn model metadata. */

import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const SESSION_INFO_ENTRY_TYPE = "session-info";

interface SessionInfoState {
	sessionId: string;
	prompt: string;
}

interface CustomSessionInfoEntry {
	type: "custom";
	customType: string;
	data?: SessionInfoState;
}

function isSessionInfoEntry(entry: unknown): entry is CustomSessionInfoEntry {
	if (typeof entry !== "object" || entry === null) return false;
	const candidate = entry as Partial<CustomSessionInfoEntry>;
	return candidate.type === "custom" && candidate.customType === SESSION_INFO_ENTRY_TYPE;
}

function formatDatetime(timestamp: string, timeZone: string): string | undefined {
	const instant = new Date(timestamp);
	if (Number.isNaN(instant.getTime())) return undefined;
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const parts = Object.fromEntries(
		formatter
			.formatToParts(instant)
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value]),
	);
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} (${timeZone}; ${instant.toISOString()})`;
}

export function formatSessionInfo(timestamp: string, timeZone: string, model: Model<any>): string | undefined {
	const datetime = formatDatetime(timestamp, timeZone);
	if (!datetime) return undefined;
	return [
		"## Session info",
		"",
		`The first user message in this session was submitted at ${datetime}.`,
		`The model selected for the first turn is ${model.provider}/${model.id} (${model.name}).`,
		"Treat the first-message datetime and first-turn model as fixed session metadata. They intentionally do not update on later turns, after model switches, or after resume.",
	].join("\n");
}

function restorePrompt(ctx: ExtensionContext): string | undefined {
	const sessionId = ctx.sessionManager.getSessionId();
	const entries = ctx.sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isSessionInfoEntry(entry)) continue;
		if (entry.data?.sessionId === sessionId && typeof entry.data.prompt === "string") return entry.data.prompt;
	}
	return undefined;
}

export function registerSessionInfo(
	pi: ExtensionAPI,
	now: () => Date = () => new Date(),
	getTimeZone: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): void {
	let prompt: string | undefined;
	let sessionId: string | undefined;

	const initializePrompt = (model: Model<any> | undefined) => {
		if (prompt || !model || !sessionId) return;
		const value = formatSessionInfo(now().toISOString(), getTimeZone(), model);
		if (!value) return;
		prompt = value;
		pi.appendEntry<SessionInfoState>(SESSION_INFO_ENTRY_TYPE, { sessionId, prompt: value });
	};

	pi.on("session_start", (_event, ctx) => {
		prompt = restorePrompt(ctx);
		sessionId = ctx.sessionManager.getSessionId();
	});

	pi.on("before_agent_start", (event, ctx) => {
		initializePrompt(ctx.model);
		if (!prompt) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${prompt}` };
	});
}
