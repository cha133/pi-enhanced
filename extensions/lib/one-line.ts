import { sliceByColumn, type Component, visibleWidth } from "@earendil-works/pi-tui";

export interface StyledSegment {
	text: string;
	style: (text: string) => string;
}

/** Render styled text as exactly one viewport-clipped terminal line. */
export class OneLine implements Component {
	constructor(private readonly segments: readonly StyledSegment[]) {}

	invalidate(): void {}

	render(width: number): string[] {
		let remaining = Math.max(0, width);
		let line = "";
		for (const segment of this.segments) {
			if (remaining === 0) break;
			const text = sliceByColumn(segment.text, 0, remaining, true);
			const textWidth = visibleWidth(text);
			if (textWidth > 0) line += segment.style(text);
			remaining -= textWidth;
			if (textWidth < visibleWidth(segment.text)) break;
		}
		return [line];
	}
}
