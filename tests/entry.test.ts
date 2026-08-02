import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piEnhanced from "../extensions/pi-enhanced.js";

describe("single extension entry", () => {
	test("registers the enhanced surface and disables read on session start", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-entry-"));
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const tools = new Map<string, unknown>();
		let active = ["read", "bash", "edit", "write", "third_party"];
		const pi = {
			on(name: string, handler: (...args: any[]) => unknown) {
				handlers.set(name, handler);
			},
			registerTool(tool: { name: string }) {
				tools.set(tool.name, tool);
			},
			getActiveTools: () => active,
			setActiveTools(names: string[]) {
				active = names;
			},
			getThinkingLevel: () => "medium",
		} as any;
		const ctx = {
			cwd,
			model: { provider: "test", id: "text", input: ["text"] },
			isProjectTrusted: () => false,
			modelRegistry: { find: () => undefined },
		} as any;

		try {
			piEnhanced(pi);
			await handlers.get("session_start")?.({}, ctx);
			expect([...tools.keys()]).toContain("edit");
			expect([...tools.keys()]).toContain("view_image");
			expect([...tools.keys()]).toContain("subagent");
			expect([...tools.keys()].some((name) => name === "bash" || name === "pwsh")).toBe(true);
			expect(active).not.toContain("read");
			expect(active).toContain("third_party");
			expect((tools.get("view_image") as { description: string }).description).toContain("external vision model");

			ctx.model = { provider: "test", id: "vision", input: ["text", "image"] };
			await handlers.get("model_select")?.({}, ctx);
			expect((tools.get("view_image") as { description: string }).description).toContain("inspect directly");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
