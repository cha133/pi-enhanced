import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { applyPartialEdits, createEnhancedEditTool } from "../extensions/lib/edit.js";

beforeAll(() => {
	initTheme("dark");
});

const quietTui = { requestRender() {} } as TUI;

describe("partial edit", () => {
	test("applies valid entries while returning an independent not-found error", () => {
		const result = applyPartialEdits("alpha\nbeta\ngamma\n", [
			{ oldText: "alpha", newText: "ALPHA" },
			{ oldText: "missing", newText: "present" },
			{ oldText: "gamma", newText: "GAMMA" },
		]);
		expect(result.newContent).toBe("ALPHA\nbeta\nGAMMA\n");
		expect(result.applied).toEqual([{ index: 0 }, { index: 2 }]);
		expect(result.rejected.map(({ index, code }) => ({ index, code }))).toEqual([
			{ index: 1, code: "not_found" },
		]);
	});

	test("rejects every member of an overlap group but applies disjoint entries", () => {
		const result = applyPartialEdits("0123456789\nseparate\n", [
			{ oldText: "2345", newText: "A" },
			{ oldText: "4567", newText: "B" },
			{ oldText: "separate", newText: "done" },
		]);
		expect(result.newContent).toBe("0123456789\ndone\n");
		expect(result.applied).toEqual([{ index: 2 }]);
		expect(result.rejected.map(({ index, code, conflictsWith }) => ({ index, code, conflictsWith }))).toEqual([
			{ index: 0, code: "overlap", conflictsWith: [1] },
			{ index: 1, code: "overlap", conflictsWith: [0] },
		]);
	});

	test("rejects duplicate, empty, and no-op entries without blocking a valid edit", () => {
		const result = applyPartialEdits("same same\nvalue\n", [
			{ oldText: "same", newText: "one" },
			{ oldText: "", newText: "bad" },
			{ oldText: "value", newText: "value" },
			{ oldText: "value", newText: "VALUE" },
		]);
		expect(result.newContent).toBe("same same\nVALUE\n");
		expect(result.applied).toEqual([{ index: 3 }]);
		expect(result.rejected.map(({ code }) => code)).toEqual(["duplicate", "empty", "no_change"]);
	});

	test("uses pi-compatible fuzzy normalization while preserving untouched line bytes", () => {
		const result = applyPartialEdits("const label = “hello”;   \nuntouched  \n", [
			{ oldText: 'const label = "hello";', newText: 'const label = "world";' },
		]);
		expect(result.newContent).toBe('const label = "world";\nuntouched  \n');
		expect(result.applied).toEqual([{ index: 0 }]);
	});

	test("marks long previews as incomplete and bounded", () => {
		const oldText = Array.from({ length: 20 }, (_, index) => `missing-${index}`).join("\n");
		const result = applyPartialEdits("other\n", [{ oldText, newText: "x" }]);
		expect(result.rejected[0].preview).toMatchObject({ truncated: true, omittedLines: 16 });
		expect(result.rejected[0].preview.head).toContain("missing-0");
		expect(result.rejected[0].preview.tail).toContain("missing-19");
	});

	test("writes accepted edits once while preserving BOM and CRLF", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-edit-"));
		const path = join(cwd, "sample.txt");
		await writeFile(path, "\uFEFFalpha\r\nbeta\r\n", "utf8");
		const tool = createEnhancedEditTool(cwd);
		try {
			const result = await tool.execute(
				"call",
				{
					path: "sample.txt",
					edits: [
						{ oldText: "alpha", newText: "ALPHA" },
						{ oldText: "missing", newText: "x" },
					],
				},
				undefined,
				undefined,
				{} as any,
			);
			expect(await readFile(path, "utf8")).toBe("\uFEFFALPHA\r\nbeta\r\n");
			expect((result.details as any).applied).toEqual([{ index: 0 }]);
			expect((result.details as any).rejected[0].index).toBe(1);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("uses the native boxed call renderer and settles the applied diff into it", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-edit-render-"));
		const path = join(cwd, "sample.txt");
		await writeFile(path, "alpha\nbeta\n", "utf8");
		const tool = createEnhancedEditTool(cwd);
		const args = {
			path: "sample.txt",
			edits: [{ oldText: "alpha", newText: "ALPHA" }],
		};
		try {
			const component = new ToolExecutionComponent("edit", "call", args, {}, tool, quietTui, cwd);
			const result = await tool.execute("call", args, undefined, undefined, {} as any);
			component.updateResult({ ...result, isError: false });

			const rendered = component.render(80).join("\n");
			expect(rendered).toContain("edit");
			expect(rendered).toContain("sample.txt");
			expect(rendered).toContain("ALPHA");
			expect(rendered).not.toContain("Applied 1");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("adds compact and expanded rejection details below the native diff", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-edit-render-"));
		const path = join(cwd, "sample.txt");
		await writeFile(path, "alpha\nbeta\n", "utf8");
		const tool = createEnhancedEditTool(cwd);
		const args = {
			path: "sample.txt",
			edits: [
				{ oldText: "alpha", newText: "ALPHA" },
				{ oldText: "missing", newText: "present" },
			],
		};
		try {
			const component = new ToolExecutionComponent("edit", "call", args, {}, tool, quietTui, cwd);
			const result = await tool.execute("call", args, undefined, undefined, {} as any);
			component.updateResult({ ...result, isError: false });

			const collapsed = component.render(80).join("\n");
			expect(collapsed).toContain("ALPHA");
			expect(collapsed).toContain("Applied 1; rejected 1");
			expect(collapsed).toContain("Ctrl+O to expand");
			expect(collapsed).not.toContain("oldText was not found");

			component.setExpanded(true);
			const expanded = component.render(80).join("\n");
			expect(expanded).toContain("edits[1] (not_found): oldText was not found.");
			expect(expanded).not.toContain("Ctrl+O to expand");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
