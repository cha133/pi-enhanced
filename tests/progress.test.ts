import { describe, expect, test } from "bun:test";
import { formatSubagentStatus, SubagentProgressTracker } from "../extensions/lib/subagent.js";
import { formatVisionStatus, VisionProgressTracker } from "../extensions/lib/view-image.js";
import { OneLine } from "../extensions/lib/one-line.js";

describe("nested model progress", () => {
	test("clips streamed status to exactly one terminal line", () => {
		const component = new OneLine([{ text: "1234567890", style: (text) => text }]);
		expect(component.render(6)).toEqual(["123456"]);
	});

	test("formats nested-model phases with lowercase labels", () => {
		expect(formatVisionStatus({ phase: "reasoning", summary: "checking pixels" })).toBe(
			"reasoning: checking pixels",
		);
		expect(formatVisionStatus({ phase: "finished", summary: "Vision response · kimi-k3" })).toBe(
			"finished: Vision response · kimi-k3",
		);
		expect(formatSubagentStatus({ phase: "replying", summary: "writing report" })).toBe(
			"replying: writing report",
		);
		expect(formatSubagentStatus({ phase: "finished", summary: "glm-5.2" })).toBe("finished: glm-5.2");
	});

	test("reduces vision stream events to one current status", () => {
		const tracker = new VisionProgressTracker();
		expect(tracker.handle({ type: "start", partial: {} } as any)).toEqual({
			phase: "thinking",
			summary: "vision model...",
		});
		expect(tracker.handle({ type: "text_delta", delta: "First line\nSecond line", partial: {} } as any)).toEqual({
			phase: "replying",
			summary: "First line",
		});
	});

	test("tracks subagent tool activity and replies", () => {
		const tracker = new SubagentProgressTracker();
		expect(tracker.handle({ type: "tool_execution_start", toolCallId: "1", toolName: "edit", args: { path: "a.ts" } })).toEqual({
			phase: "tool",
			summary: "edit: a.ts",
		});
		expect(tracker.handle({ type: "tool_execution_end", toolCallId: "1" })).toEqual({
			phase: "starting",
			summary: "continuing...",
		});
	});
});
