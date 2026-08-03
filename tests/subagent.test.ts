import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentChildExtension } from "../extensions/lib/subagent.js";

describe("subagent child tool surface", () => {
	test("uses the shared coding surface, excludes recursion, and preserves a disabled parent shell", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-child-"));
		const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
		const tools = new Map<string, unknown>();
		let active = ["read", "bash", "edit", "write", "subagent"];
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
		} as any;
		const ctx = {
			cwd,
			model: { provider: "test", id: "text", name: "Text Model", input: ["text"] },
			isProjectTrusted: () => false,
			modelRegistry: { find: () => undefined },
		} as any;

		try {
			createSubagentChildExtension(undefined, [])(pi);
			for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);

			expect([...tools.keys()]).toContain("read");
			expect([...tools.keys()]).toContain("edit");
			expect([...tools.keys()]).toContain("write");
			const shellName = tools.has("pwsh") ? "pwsh" : "bash";
			expect(tools.has(shellName)).toBe(true);
			expect(tools.has("subagent")).toBe(false);
			expect(active).not.toContain("subagent");
			expect(active).not.toContain(shellName);
		} finally {
			for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
