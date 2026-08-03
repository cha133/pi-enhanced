import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEnhancedReadTool, needsVisionFallback } from "../extensions/lib/read.js";

const ONE_PIXEL_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

describe("enhanced read", () => {
	test("delegates only image results for text-only models", () => {
		const image = [{ type: "image" }];
		expect(needsVisionFallback(image, { input: ["text"] })).toBe(true);
		expect(needsVisionFallback(image, { input: ["text", "image"] })).toBe(false);
		expect(needsVisionFallback([{ type: "text" }], { input: ["text"] })).toBe(false);
	});

	test("preserves pi-processed image content for a multimodal model", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-image-"));
		await writeFile(join(cwd, "pixel.png"), ONE_PIXEL_PNG);
		const ctx = {
			cwd,
			model: { provider: "test", id: "vision", input: ["text", "image"] },
			isProjectTrusted: () => false,
		} as any;
		const tool = createEnhancedReadTool(cwd, ctx);
		try {
			const result = await tool.execute(
				"call",
				{ path: "pixel.png", image: { query: "What is visible?", detail: "brief" } },
				undefined,
				undefined,
				ctx,
			);
			expect(result.content.some((part) => part.type === "image")).toBe(true);
			expect(result).not.toHaveProperty("usage");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("preserves native text reads and pagination", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-read-"));
		await writeFile(join(cwd, "sample.txt"), "one\ntwo\nthree\n");
		const ctx = {
			cwd,
			model: { provider: "test", id: "text", input: ["text"] },
			isProjectTrusted: () => false,
		} as any;
		const tool = createEnhancedReadTool(cwd, ctx);
		try {
			const result = await tool.execute("call", { path: "sample.txt", offset: 2, limit: 1 }, undefined, undefined, ctx);
			expect(result.content).toEqual([{ type: "text", text: "two\n\n[2 more lines in file. Use offset=3 to continue.]" }]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
