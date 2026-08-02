import { describe, expect, test } from "bun:test";
import {
	formatSessionInfo,
	registerSessionInfo,
	SESSION_INFO_ENTRY_TYPE,
} from "../extensions/lib/session-info.js";

type Handler = (...args: any[]) => any;

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
	test("formats fixed datetime and first-turn model metadata", () => {
		const prompt = formatSessionInfo(
			"2026-08-02T04:05:06.000Z",
			"Asia/Shanghai",
			{ provider: "test", id: "model", name: "Test Model" } as any,
		);
		expect(prompt).toContain("2026-08-02 12:05:06 (Asia/Shanghai; 2026-08-02T04:05:06.000Z)");
		expect(prompt).toContain("test/model (Test Model)");
	});

	test("captures once before the first turn and remains stable after a model switch", () => {
		const { pi, ctx, handlers, appended } = harness();
		registerSessionInfo(pi, () => new Date("2026-08-02T04:05:06.000Z"), () => "Asia/Shanghai");
		handlers.get("session_start")![0]({}, ctx);
		const first = handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, ctx);
		ctx.model = { provider: "provider-b", id: "model-b", name: "Model B" };
		const second = handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, ctx);

		expect(appended).toHaveLength(1);
		expect(appended[0]?.customType).toBe(SESSION_INFO_ENTRY_TYPE);
		expect(first.systemPrompt).toBe(second.systemPrompt);
		expect(second.systemPrompt).toContain("provider-a/model-a (Model A)");
		expect(second.systemPrompt).not.toContain("provider-b/model-b");
	});

	test("restores persisted metadata when a session resumes", () => {
		const persistedPrompt = "## Session info\n\npersisted";
		const { pi, ctx, handlers, appended } = harness([
			{
				type: "custom",
				customType: SESSION_INFO_ENTRY_TYPE,
				data: { sessionId: "session-1", prompt: persistedPrompt },
			},
		]);
		registerSessionInfo(pi);
		handlers.get("session_start")![0]({}, ctx);
		const result = handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, ctx);

		expect(result.systemPrompt).toBe(`base\n\n${persistedPrompt}`);
		expect(appended).toHaveLength(0);
	});
});
