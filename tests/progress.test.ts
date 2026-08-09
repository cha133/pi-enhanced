import { describe, expect, test } from "bun:test";
import { formatVisionStatus, VisionProgressTracker } from "../extensions/lib/read.js";
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
		expect(formatVisionStatus({ phase: "finished", summary: "kimi-k3" })).toBe("finished · kimi-k3");
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
});
