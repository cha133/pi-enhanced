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
			expect(result.structuredContent).toMatchObject(result.content.find((part) => part.type === "image")!);
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
			expect(result.structuredContent).toBe("two\n\n[2 more lines in file. Use offset=3 to continue.]");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	for (const stopReason of ["stop", "error", "aborted"] as const) {
		test(`returns codemode text for delegated vision ${stopReason} without model access`, async () => {
			const cwd = await mkdtemp(join(tmpdir(), "pi-enhanced-vision-output-"));
			const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
			process.env.PI_CODING_AGENT_DIR = cwd;
			const model = { provider: "test", id: "vision", input: ["text", "image"] };
			const ctx = {
				cwd,
				model: { provider: "test", id: "text", input: ["text"] },
				isProjectTrusted: () => false,
				modelRegistry: {
					find: () => model,
					getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test" }),
				},
			} as any;
			const usage = {
				input: 10, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 13,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			const controller = new AbortController();
			const request = (selected: unknown, context: any, options: any) => {
				expect(selected).toBe(model);
				expect(options.signal).toBe(controller.signal);
				expect(context.messages[0].content[1].type).toBe("image");
				return {
					async *[Symbol.asyncIterator]() {
						const message = { content: [{ type: "text", text: "A single pixel." }], stopReason, usage, errorMessage: "test failure" };
						yield stopReason === "stop" ? { type: "done", message } : { type: "error", error: message };
					},
				};
			};
			try {
				await writeFile(join(cwd, "settings.json"), JSON.stringify({ vision: { provider: "test", model: "vision" } }));
				await writeFile(join(cwd, "pixel.png"), ONE_PIXEL_PNG);
				const tool = createEnhancedReadTool(cwd, ctx, request as any);
				const result = await tool.execute("call", { path: "pixel.png" }, controller.signal, undefined, ctx);
				expect(typeof result.structuredContent).toBe("string");
				expect(result.content).toEqual([{ type: "text", text: String(result.structuredContent) }]);
				if (stopReason === "stop") {
					expect(result.structuredContent).toBe("A single pixel.");
					expect(result.usage).toBe(usage);
				} else {
					expect(result.structuredContent).toContain(stopReason === "aborted" ? "cancelled" : "test failure");
				}
			} finally {
				if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
				else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
				await rm(cwd, { recursive: true, force: true });
			}
		});
	}
});
