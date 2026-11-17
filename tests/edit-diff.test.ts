import { describe, expect, test } from "bun:test";
import { applyPatch } from "diff";
import { generateDiffString, generateUnifiedPatch } from "@earendil-works/pi-coding-agent";
import { generateEditDiff } from "../extensions/lib/edit-diff.js";
import { applyPartialEdits } from "../extensions/lib/edit.js";

describe("windowed partial edit diff", () => {
	test("matches native whole-file helpers across distant insertions and deletions", () => {
		const original = Array.from({ length: 250 }, (_, i) => `line ${i}`).join("\n");
		const outcome = applyPartialEdits(original, [
			{ oldText: "line 220\n", newText: "" },
			{ oldText: "line 10\n", newText: "inserted A\ninserted B\n" },
			{ oldText: "missing", newText: "ignored" },
		]);
		const result = generateEditDiff("sample.txt", original, outcome.newContent, outcome.replacements);
		expect(result).toEqual({
			...generateDiffString(original, outcome.newContent),
			patch: generateUnifiedPatch("sample.txt", original, outcome.newContent),
		});
		expect(applyPatch(original, result.patch)).toBe(outcome.newContent);
		expect(outcome.rejected[0].index).toBe(2);
	});

	test("maps fuzzy offsets to the original snapshot and merges edits on the same line", () => {
		const original = 'prefix ﬃ untouched  \nconst a = “hello”; const b = “bye”;   \ntail  \n';
		const outcome = applyPartialEdits(original, [
			{ oldText: 'a = "hello"', newText: 'a = "world"' },
			{ oldText: 'b = "bye"', newText: 'b = "later"' },
		]);
		const result = generateEditDiff("fuzzy.txt", original, outcome.newContent, outcome.replacements);
		expect(outcome.newContent).toBe('prefix ﬃ untouched  \nconst a = "world"; const b = "later";\ntail  \n');
		expect(applyPatch(original, result.patch)).toBe(outcome.newContent);
		expect(result.diff).not.toContain("-1 prefix");
		expect(result.firstChangedLine).toBe(2);
	});

	test("only emits accepted changes on a large file", () => {
		const original = Array.from({ length: 200_000 }, (_, i) => `record-${i}: unchanged payload`).join("\n") + "\n";
		const outcome = applyPartialEdits(original, [
			{ oldText: "record-100: unchanged payload", newText: "record-100: changed\nnew record" },
			{ oldText: "record-199900: unchanged payload", newText: "record-199900: changed" },
			{ oldText: "record-100: unchanged", newText: "overlap" },
		]);
		const result = generateEditDiff("large.txt", original, outcome.newContent, outcome.replacements);
		expect(outcome.applied).toEqual([{ index: 1 }]);
		expect(outcome.rejected.map((edit) => edit.code)).toEqual(["overlap", "overlap"]);
		expect(result.firstChangedLine).toBe(199901);
		expect(result.patch.length).toBeLessThan(1500);
		expect(result.diff.length).toBeLessThan(1500);
		expect(applyPatch(original, result.patch)).toBe(outcome.newContent);
	});

	test("all rejected edits produce an empty display diff and no patch hunks", () => {
		const outcome = applyPartialEdits("alpha\n", [{ oldText: "absent", newText: "x" }]);
		const result = generateEditDiff("sample.txt", "alpha\n", outcome.newContent, outcome.replacements);
		expect(result.diff).toBe("");
		expect(result.firstChangedLine).toBeUndefined();
		expect(result.patch).not.toContain("@@");
	});
});
