import { describe, expect, test } from "bun:test";
import { mergeVisionRoute } from "../extensions/lib/settings.js";

describe("model route settings", () => {
	test("merges trusted project fields over global fields", () => {
		expect(
			mergeVisionRoute({ provider: "openai", model: "global" }, { model: "project" }, { required: true }),
		).toEqual({ provider: "openai", model: "project" });
	});

	test("validates configured vision routes", () => {
		expect(() => mergeVisionRoute({ provider: "openai" }, undefined, { required: false })).toThrow(
			'non-empty string "model"',
		);
	});
});
