import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piEnhanced from "../extensions/pi-enhanced.js";

describe("single extension entry", () => {
	test("registers the enhanced surface and disables read on session start", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-entry-"));
		const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
		const tools = new Map<string, unknown>();
		const entries: unknown[] = [];
		let active = ["read", "bash", "edit", "write", "third_party"];
		const pi = {
			on(name: string, handler: (...args: any[]) => unknown) {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			},
			registerTool(tool: { name: string }) {
				tools.set(tool.name, tool);
			},
			getActiveTools: () => active,
			setActiveTools(names: string[]) {
				active = names;
			},
			getThinkingLevel: () => "medium",
			getSessionName: () => undefined,
			setSessionName: () => {},
			appendEntry(customType: string, data: unknown) {
				entries.push({ type: "custom", customType, data });
			},
		} as any;
		const ctx = {
			cwd,
			model: { provider: "test", id: "text", name: "Text Model", input: ["text"] },
			isProjectTrusted: () => false,
			modelRegistry: { find: () => undefined },
			sessionManager: {
				getSessionId: () => "session-1",
				getEntries: () => entries,
				getBranch: () => entries,
			},
		} as any;

		try {
			piEnhanced(pi);
			for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
			expect([...tools.keys()]).toContain("edit");
			expect([...tools.keys()]).toContain("view_image");
			expect([...tools.keys()]).toContain("subagent");
			expect([...tools.keys()].some((name) => name === "bash" || name === "pwsh")).toBe(true);
			expect(active).not.toContain("read");
			expect(active).toContain("third_party");
			expect((tools.get("view_image") as { description: string }).description).toContain("external vision model");

			const promptResult = await handlers.get("before_agent_start")?.[0]?.({ systemPrompt: "base" }, ctx) as
				| { systemPrompt: string }
				| undefined;
			expect(promptResult?.systemPrompt).toContain("## Session info");
			expect(promptResult?.systemPrompt).toContain("test/text (Text Model)");

			ctx.model = { provider: "test", id: "vision", name: "Vision Model", input: ["text", "image"] };
			for (const handler of handlers.get("model_select") ?? []) await handler({}, ctx);
			expect((tools.get("view_image") as { description: string }).description).toContain("inspect directly");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
