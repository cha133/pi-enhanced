import { describe, expect, test } from "bun:test";
import { mergeModelRoute } from "../extensions/lib/settings.js";

describe("model route settings", () => {
	test("merges trusted project fields over global fields", () => {
		expect(
			mergeModelRoute("vision", { provider: "openai", model: "global" }, { model: "project" }, { required: true }),
		).toEqual({ provider: "openai", model: "project" });
	});

	test("allows an omitted optional advisor but validates configured routes", () => {
		expect(mergeModelRoute("advisor", undefined, undefined, { required: false })).toBeUndefined();
		expect(() => mergeModelRoute("advisor", { provider: "openai" }, undefined, { required: false })).toThrow(
			'non-empty string "model"',
		);
	});
});
