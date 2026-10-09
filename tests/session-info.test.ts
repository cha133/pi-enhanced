import { describe, expect, test } from "bun:test";
import {
	formatSessionInfo,
	registerSessionInfo,
	SESSION_INFO_ENTRY_TYPE,
} from "../extensions/lib/session-info.js";

type Handler = (...args: any[]) => any;

function promptEvent() {
	return {
		systemPrompt: "base",
		systemPromptOptions: {
			cwd: "/project",
			sections: { other_extension: "preserved" } as Record<string, string>,
		},
	};
}

function harness(entries: unknown[] = []) {
	const handlers = new Map<string, Handler[]>();
	const appended: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		appendEntry(customType: string, data: unknown) {
			appended.push({ customType, data });
		},
	} as any;
	const ctx = {
		model: { provider: "provider-a", id: "model-a", name: "Model A" },
		sessionManager: {
			getSessionId: () => "session-1",
			getEntries: () => entries,
		},
	} as any;
	return { pi, ctx, handlers, appended };
}

describe("session info", () => {
	test("formats fixed datetime and timezone without model metadata", () => {
		const prompt = formatSessionInfo("2026-08-02T04:05:06.000Z", "Asia/Shanghai")!;
		expect(prompt).toContain("2026-08-02 12:05:06 (Asia/Shanghai; 2026-08-02T04:05:06.000Z)");
		expect(prompt).not.toContain("model");
		expect(formatSessionInfo("invalid", "Asia/Shanghai")).toBeUndefined();
	});

	test("captures once before the first turn and remains stable after a model switch", () => {
		const { pi, ctx, handlers, appended } = harness();
		let now = new Date("2026-08-02T04:05:06.000Z");
		let timeZone = "Asia/Shanghai";
		registerSessionInfo(pi, () => now, () => timeZone);
		handlers.get("session_start")![0]({}, ctx);
		expect(appended).toHaveLength(0);
		const first = promptEvent();
		expect(handlers.get("before_agent_start")![0](first, ctx)).toBeUndefined();
		ctx.model = { provider: "provider-b", id: "model-b", name: "Model B" };
		now = new Date("2026-08-03T04:05:06.000Z");
		timeZone = "UTC";
		const second = promptEvent();
		handlers.get("before_agent_start")![0](second, ctx);

		expect(appended).toHaveLength(1);
		expect(appended[0]?.customType).toBe(SESSION_INFO_ENTRY_TYPE);
		const prompt = formatSessionInfo("2026-08-02T04:05:06.000Z", "Asia/Shanghai")!;
		expect(first.systemPromptOptions.sections.session_info).toBe(prompt);
		expect(second.systemPromptOptions.sections.session_info).toBe(prompt);
		expect(first.systemPromptOptions.sections.other_extension).toBe("preserved");
		expect(first.systemPromptOptions).not.toHaveProperty("forceSystemPrompt");
		expect(first.systemPrompt).toBe("base");
		expect(appended[0]?.data).toEqual({ sessionId: "session-1", prompt });
	});

	test("restores persisted metadata when a session resumes", () => {
		const persistedPrompt = formatSessionInfo("2026-08-02T04:05:06.000Z", "Asia/Shanghai")!;
		const { pi, ctx, handlers, appended } = harness([
			{
				type: "custom",
				customType: SESSION_INFO_ENTRY_TYPE,
				data: { sessionId: "session-1", prompt: persistedPrompt },
			},
		]);
		registerSessionInfo(pi);
		handlers.get("session_start")![0]({}, ctx);
		const event = promptEvent();
		handlers.get("before_agent_start")![0](event, ctx);

		expect(event.systemPromptOptions.sections.session_info).toBe(persistedPrompt);
		expect(appended).toHaveLength(0);
	});

	test("restores legacy datetime but removes all first-turn model metadata", () => {
		const datetime = "2026-08-02 12:05:06 (Asia/Shanghai; 2026-08-02T04:05:06.000Z)";
		const { pi, ctx, handlers, appended } = harness([{
			type: "custom",
			customType: SESSION_INFO_ENTRY_TYPE,
			data: {
				sessionId: "session-1",
				prompt: [
					"## Session info",
					"",
					`The first user message in this session was submitted at ${datetime}.`,
					"The model selected for the first turn is provider-a/model-a (Model A).",
					"Treat the first-message datetime and first-turn model as fixed session metadata. They intentionally do not update on later turns, after model switches, or after resume.",
				].join("\n"),
			},
		}]);
		registerSessionInfo(pi, () => { throw new Error("must not recapture time"); });
		handlers.get("session_start")![0]({}, ctx);
		const event = promptEvent();
		handlers.get("before_agent_start")![0](event, ctx);
		expect(event.systemPromptOptions.sections.session_info).toBe(
			formatSessionInfo("2026-08-02T04:05:06.000Z", "Asia/Shanghai")!,
		);
		expect(appended).toHaveLength(0);
	});

	test("captures time without a selected model and resets when switching sessions", () => {
		const { pi, ctx, handlers, appended } = harness();
		ctx.model = undefined;
		let now = new Date("2026-08-02T04:05:06.000Z");
		registerSessionInfo(pi, () => now, () => "UTC");
		handlers.get("session_start")![0]({}, ctx);
		handlers.get("before_agent_start")![0](promptEvent(), ctx);
		ctx.sessionManager.getSessionId = () => "session-2";
		now = new Date("2026-08-03T04:05:06.000Z");
		handlers.get("session_start")![0]({}, ctx);
		const event = promptEvent();
		handlers.get("before_agent_start")![0](event, ctx);
		expect(event.systemPromptOptions.sections.session_info).toBe(formatSessionInfo(now.toISOString(), "UTC")!);
		expect(appended).toHaveLength(2);
		expect(appended[1]?.data).toEqual({
			sessionId: "session-2",
			prompt: event.systemPromptOptions.sections.session_info,
		});
	});
});
