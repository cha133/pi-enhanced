import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEnhancedWriteTool, ensureDirectory } from "../extensions/lib/write.js";

function errorWithCode(code: string): Error & { code: string } {
	return Object.assign(new Error(code), { code });
}

describe("enhanced write", () => {
	test("accepts EEXIST when the parent path is an existing directory", async () => {
		await expect(ensureDirectory("parent", {
			mkdir: async () => {
				throw errorWithCode("EEXIST");
			},
			stat: async () => ({ isDirectory: () => true }),
		})).resolves.toBeUndefined();
	});

	test("preserves EEXIST when the parent path is not a directory", async () => {
		const error = errorWithCode("EEXIST");
		await expect(ensureDirectory("parent", {
			mkdir: async () => {
				throw error;
			},
			stat: async () => ({ isDirectory: () => false }),
		})).rejects.toBe(error);
	});

	test("preserves unrelated mkdir failures", async () => {
		const error = errorWithCode("EACCES");
		await expect(ensureDirectory("parent", {
			mkdir: async () => {
				throw error;
			},
			stat: async () => ({ isDirectory: () => true }),
		})).rejects.toBe(error);
	});

	test("keeps the native write contract while using the safe directory operation", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-write-"));
		const tool = createEnhancedWriteTool(cwd);
		try {
			const result = await tool.execute(
				"call",
				{ path: "nested/sample.txt", content: "hello\n" },
				undefined,
				undefined,
				{} as any,
			);
			expect(await readFile(join(cwd, "nested", "sample.txt"), "utf8")).toBe("hello\n");
			expect(result.content).toEqual([{
				type: "text",
				text: "Successfully wrote 6 bytes to nested/sample.txt",
			}]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
