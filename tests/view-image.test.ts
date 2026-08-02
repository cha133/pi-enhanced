import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createViewImageTool } from "../extensions/lib/view-image.js";

const ONE_PIXEL_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

describe("view_image", () => {
	test("returns pi-processed image content directly to a multimodal model", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-image-"));
		await writeFile(join(cwd, "pixel.png"), ONE_PIXEL_PNG);
		const ctx = {
			cwd,
			model: { provider: "test", id: "vision", input: ["text", "image"] },
			isProjectTrusted: () => false,
		} as any;
		const tool = createViewImageTool(cwd, ctx);
		try {
			const result = await tool.execute(
				"call",
				{ path: "pixel.png", query: "What is visible?", detail: "brief" },
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
});
