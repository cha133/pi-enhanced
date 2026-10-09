/** Persist and inject fixed first-message time and timezone metadata. */

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

function formatDatetimePrompt(datetime: string): string {
	return [
		`The first user message in this session was submitted at ${datetime}.`,
		"Treat the first-message datetime and timezone as fixed session metadata. They intentionally do not update on later turns or after resume.",
	].join("\n");
}

export function formatSessionInfo(timestamp: string, timeZone: string): string | undefined {
	const datetime = formatDatetime(timestamp, timeZone);
	if (!datetime) return undefined;
	return formatDatetimePrompt(datetime);
}

function restorePrompt(ctx: ExtensionContext): string | undefined {
	const sessionId = ctx.sessionManager.getSessionId();
	const entries = ctx.sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isSessionInfoEntry(entry)) continue;
		if (entry.data?.sessionId !== sessionId || typeof entry.data.prompt !== "string") continue;
		// Older entries also contain model metadata. Reuse only their original datetime.
		const match = /^The first user message in this session was submitted at (.+)\.$/m.exec(entry.data.prompt);
		if (match) return formatDatetimePrompt(match[1]!);
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

	const initializePrompt = () => {
		if (prompt || !sessionId) return;
		const value = formatSessionInfo(now().toISOString(), getTimeZone());
		if (!value) return;
		prompt = value;
		pi.appendEntry<SessionInfoState>(SESSION_INFO_ENTRY_TYPE, { sessionId, prompt: value });
	};

	pi.on("session_start", (_event, ctx) => {
		prompt = restorePrompt(ctx);
		sessionId = ctx.sessionManager.getSessionId();
	});

	pi.on("before_agent_start", (event) => {
		initializePrompt();
		if (!prompt) return;
		event.systemPromptOptions.sections.session_info = prompt;
	});
}
