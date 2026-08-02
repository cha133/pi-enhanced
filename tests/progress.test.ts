import { describe, expect, test } from "bun:test";
import { SubagentProgressTracker } from "../extensions/lib/subagent.js";
import { VisionProgressTracker } from "../extensions/lib/view-image.js";

describe("nested model progress", () => {
	test("reduces vision stream events to one current status", () => {
		const tracker = new VisionProgressTracker();
		expect(tracker.handle({ type: "start", partial: {} } as any)).toEqual({
			phase: "thinking",
			summary: "Vision model is thinking...",
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
			summary: "Continuing...",
		});
	});
});
