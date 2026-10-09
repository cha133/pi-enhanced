import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piEnhanced from "../extensions/pi-enhanced.js";

describe("single extension entry", () => {
	test("registers the enhanced surface and preserves native read and write on session start", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-entry-"));
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = cwd;
		const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
		const tools = new Map<string, unknown>();
		const entries: unknown[] = [{
			type: "message",
			message: {
				role: "toolResult",
				toolName: "mcp_unity_get_editor_state",
				details: {},
			},
		}];
		let active = ["read", "bash", "edit", "write", "third_party", "codemode", "tool_search", "mcp__exa__web_search_exa"];
		const pi = {
			on(name: string, handler: (...args: any[]) => unknown) {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			},
			registerCommand() {},
			registerTool(tool: { name: string }) {
				tools.set(tool.name, tool);
			},
			getActiveTools: () => active,
			getAllTools: () => [...tools.keys()].map((name) => ({ name })),
			setActiveTools(names: string[]) {
				active = names;
			},
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
				buildContextEntries: () => entries,
			},
		} as any;

		try {
			piEnhanced(pi);
			for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
			expect([...tools.keys()]).toContain("edit");
			expect([...tools.keys()]).not.toContain("read");
			expect([...tools.keys()]).not.toContain("write");
			expect([...tools.keys()].some((name) => name === "bash" || name === "pwsh")).toBe(true);
			expect(active).toContain("read");
			expect(active).toContain("write");
			expect(active).not.toContain("view_image");
			expect(active).toContain("third_party");
			expect(active).toContain("codemode");
			expect(active).toContain("tool_search");
			expect(active).toContain("mcp__exa__web_search_exa");
			expect([...tools.keys()].some((name) => name.startsWith("mcp_"))).toBe(false);
			const promptEvent = {
				systemPrompt: "base",
				systemPromptOptions: { sections: {} as Record<string, string> },
			};
			const promptResult = await handlers.get("before_agent_start")?.[0]?.(promptEvent, ctx);
			expect(promptResult).toBeUndefined();
			expect(promptEvent.systemPromptOptions.sections.session_info).toContain("The first user message");
			expect(promptEvent.systemPromptOptions.sections.session_info).not.toContain("model");

			ctx.model = { provider: "test", id: "vision", name: "Vision Model", input: ["text", "image"] };
			for (const handler of handlers.get("model_select") ?? []) await handler({}, ctx);
			expect([...tools.keys()]).not.toContain("read");
			expect(active).toContain("read");
			expect(active).toContain("mcp__exa__web_search_exa");
			expect(active).toContain("codemode");
			expect(active).toContain("tool_search");
			expect(active).not.toContain("mcp_search");
			expect(active).not.toContain("mcp_call");

			active = active.filter((name) => name !== "read" && name !== "write");
			for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
			expect([...tools.keys()]).not.toContain("write");
			expect(active).not.toContain("read");
			expect(active).not.toContain("write");
			expect(active).toContain("third_party");
		} finally {
			for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
