import { describe, expect, test } from "bun:test";
import {
	hasMeaningfulTitleSource,
	incrementForkTitle,
	normalizeGeneratedTitle,
	registerSessionTitle,
} from "../extensions/lib/session-title.js";

type Handler = (...args: any[]) => any;

function assistant(text: string) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
		timestamp: Date.now(),
	};
}

function harness(options: { entries?: unknown[]; name?: string } = {}) {
	const handlers = new Map<string, Handler[]>();
	const names: string[] = [];
	let currentName = options.name;
	const pi = {
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		getSessionName: () => currentName,
		setSessionName(name: string) {
			currentName = name;
			names.push(name);
		},
	} as any;
	const ctx = {
		model: { provider: "test", id: "model", name: "Test Model" },
		signal: undefined,
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }),
		},
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => options.entries ?? [],
		},
	} as any;

	return {
		pi,
		ctx,
		handlers,
		names,
		get currentName() {
			return currentName;
		},
		setName(name: string) {
			currentName = name;
		},
	};
}

async function flushPromises(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("session title helpers", () => {
	test("normalizes and bounds generated titles", () => {
		expect(normalizeGeneratedTitle('标题： **"修复登录流程"**\nextra')).toBe("修复登录流程");
		expect(normalizeGeneratedTitle("x".repeat(80))).toBe("x".repeat(60));
		expect(normalizeGeneratedTitle("  ")).toBeUndefined();
	});

	test("increments only a trailing numeric fork suffix", () => {
		expect(incrementForkTitle("Refactor auth")).toBe("Refactor auth (1)");
		expect(incrementForkTitle("Refactor auth (1)")).toBe("Refactor auth (2)");
		expect(incrementForkTitle("Refactor (draft)")).toBe("Refactor (draft) (1)");
	});

	test("skips pure-image absolute paths but keeps image prompts with instructions", () => {
		const images = [{ type: "image", data: "abc", mimeType: "image/png" }] as any;
		expect(hasMeaningfulTitleSource("C:\\images\\screen.png", images)).toBe(false);
		expect(hasMeaningfulTitleSource("请分析 C:\\images\\screen.png", images)).toBe(true);
		expect(hasMeaningfulTitleSource("C:\\images\\screen.png", undefined)).toBe(true);
	});
});

describe("session title lifecycle", () => {
	test("requests the first-turn model asynchronously and applies the result", async () => {
		const h = harness();
		let resolveRequest!: (value: any) => void;
		let requestOptions: any;
		const request = (_model: any, _context: any, options: any) => {
			requestOptions = options;
			return new Promise((resolve) => {
				resolveRequest = resolve;
			});
		};
		registerSessionTitle(h.pi, request as any);
		h.handlers.get("session_start")![0]({ reason: "startup" }, h.ctx);
		const result = h.handlers.get("before_agent_start")![0]({ prompt: "请修复登录超时", images: undefined }, h.ctx);

		expect(result).toBeUndefined();
		expect(h.names).toEqual([]);
		await flushPromises();
		resolveRequest(assistant("修复登录超时"));
		await flushPromises();
		expect(requestOptions.maxTokens).toBeUndefined();
		expect(h.names).toEqual(["修复登录超时"]);
	});

	test("does not overwrite a manual name while generation is pending", async () => {
		const h = harness();
		let resolveRequest!: (value: any) => void;
		const request = () => new Promise((resolve) => (resolveRequest = resolve));
		registerSessionTitle(h.pi, request as any);
		h.handlers.get("session_start")![0]({ reason: "startup" }, h.ctx);
		h.handlers.get("before_agent_start")![0]({ prompt: "Fix auth", images: undefined }, h.ctx);
		await flushPromises();
		h.setName("Manual title");
		resolveRequest(assistant("Generated title"));
		await flushPromises();
		expect(h.currentName).toBe("Manual title");
		expect(h.names).toEqual([]);
	});

	test("aborts a pending request on session shutdown", async () => {
		const h = harness();
		let requestSignal: AbortSignal | undefined;
		const request = (_model: any, _context: any, options: any) => {
			requestSignal = options.signal;
			return new Promise(() => {});
		};
		registerSessionTitle(h.pi, request as any);
		h.handlers.get("session_start")![0]({ reason: "startup" }, h.ctx);
		h.handlers.get("before_agent_start")![0]({ prompt: "Fix auth", images: undefined }, h.ctx);
		await flushPromises();
		h.handlers.get("session_shutdown")![0]({ reason: "quit" }, h.ctx);
		expect(requestSignal?.aborted).toBe(true);
	});

	test("isolates title request failures from the main turn", async () => {
		const h = harness();
		registerSessionTitle(h.pi, (() => Promise.reject(new Error("provider failed"))) as any);
		h.handlers.get("session_start")![0]({ reason: "startup" }, h.ctx);
		const result = h.handlers.get("before_agent_start")![0]({ prompt: "Fix auth", images: undefined }, h.ctx);
		await flushPromises();
		expect(result).toBeUndefined();
		expect(h.names).toEqual([]);
	});

	test("increments an inherited title on fork", () => {
		const h = harness({ name: "Refactor auth (1)" });
		registerSessionTitle(h.pi);
		h.handlers.get("session_start")![0]({ reason: "fork" }, h.ctx);
		expect(h.names).toEqual(["Refactor auth (2)"]);
	});

	test("does not alter an unnamed fork", () => {
		const h = harness();
		registerSessionTitle(h.pi);
		h.handlers.get("session_start")![0]({ reason: "fork" }, h.ctx);
		expect(h.names).toEqual([]);
	});

	test("does not generate for a session with prior user history", () => {
		const h = harness({ entries: [{ type: "message", message: { role: "user" } }] });
		registerSessionTitle(h.pi);
		h.handlers.get("session_start")![0]({ reason: "resume" }, h.ctx);
		h.handlers.get("before_agent_start")![0]({ prompt: "second", images: undefined }, h.ctx);
		expect(h.names).toEqual([]);
	});

	test("a skipped pure-image first message does not name from the second message", () => {
		const h = harness();
		registerSessionTitle(h.pi);
		h.handlers.get("session_start")![0]({ reason: "startup" }, h.ctx);
		const before = h.handlers.get("before_agent_start")![0];
		before({ prompt: "C:\\images\\screen.png", images: [{ type: "image" }] }, h.ctx);
		before({ prompt: "Please fix the bug", images: undefined }, h.ctx);
		expect(h.names).toEqual([]);
	});

	test("session shutdown is safe with no pending request", () => {
		const h = harness();
		registerSessionTitle(h.pi);
		h.handlers.get("session_start")![0]({ reason: "startup" }, h.ctx);
		h.handlers.get("session_shutdown")![0]({ reason: "quit" }, h.ctx);
		expect(h.names).toEqual([]);
	});
});
