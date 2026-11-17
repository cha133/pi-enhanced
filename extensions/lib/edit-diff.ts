/*
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// Adapted from earendil-works/pi v1.5.2, packages/coding-agent/src/core/tools/edit-diff.ts (MIT).
// generateEditDiff is not exported by the public package entry. Keep this pure
// windowed diff implementation synchronized when upgrading pi.
import * as Diff from "diff";

export interface TextReplacement {
	matchIndex: number;
	matchLength: number;
	newText: string;
}

function countLines(text: string): number {
	return countLineFeeds(text, 0, text.length) + 1;
}

function countLineFeeds(text: string, start: number, end: number): number {
	let count = 0;
	for (let index = text.indexOf("\n", start); index !== -1 && index < end; index = text.indexOf("\n", index + 1)) {
		count++;
	}
	return count;
}

/** Format jsdiff line parts as display diff lines, numbering from the given 1-based old and new lines. */
function formatDisplayDiff(
	parts: Diff.ChangeObject<string>[],
	oldStartLine: number,
	newStartLine: number,
	lineNumWidth: number,
	contextLines: number,
): { output: string[]; firstChangedLine: number | undefined } {
	const output: string[] = [];

	let oldLineNum = oldStartLine;
	let newLineNum = newStartLine;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") {
			raw.pop();
		}

		if (part.added || part.removed) {
			// Capture the first changed line (in the new file)
			if (firstChangedLine === undefined) {
				firstChangedLine = newLineNum;
			}

			// Show the change
			for (const line of raw) {
				if (part.added) {
					const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
					output.push(`+${lineNum} ${line}`);
					newLineNum++;
				} else {
					// removed
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(`-${lineNum} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
		} else {
			// Context lines - only show a few before/after changes
			const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
			const hasLeadingChange = lastWasChange;
			const hasTrailingChange = nextPartIsChange;

			if (hasLeadingChange && hasTrailingChange) {
				if (raw.length <= contextLines * 2) {
					for (const line of raw) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}
				} else {
					const leadingLines = raw.slice(0, contextLines);
					const trailingLines = raw.slice(raw.length - contextLines);
					const skippedLines = raw.length - leadingLines.length - trailingLines.length;

					for (const line of leadingLines) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}

					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;

					for (const line of trailingLines) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}
				}
			} else if (hasLeadingChange) {
				const shownLines = raw.slice(0, contextLines);
				const skippedLines = raw.length - shownLines.length;

				for (const line of shownLines) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}

				if (skippedLines > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;
				}
			} else if (hasTrailingChange) {
				const skippedLines = Math.max(0, raw.length - contextLines);
				if (skippedLines > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;
				}

				for (const line of raw.slice(skippedLines)) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
			} else {
				// Skip these context lines entirely
				oldLineNum += raw.length;
				newLineNum += raw.length;
			}

			lastWasChange = false;
		}
	}

	return { output, firstChangedLine };
}

/** Display diff and unified patch of an edit, as returned in the edit tool's details. */
export interface EditDiff {
	diff: string;
	patch: string;
	firstChangedLine: number | undefined;
}

/**
 * Unchanged lines diffed on each side of a replacement. Well above the 4 context lines shown, so jsdiff
 * aligns a change within its window as it would over the whole file.
 */
const DIFF_WINDOW_MARGIN_LINES = 32;

/**
 * Diff an edit only around its replacements, so time and memory follow the size of the change instead of
 * the file. The result matches generateDiffString and generateUnifiedPatch over the whole contents, except
 * that jsdiff may align runs of repeated lines differently within a window.
 */
export function generateEditDiff(
	path: string,
	baseContent: string,
	newContent: string,
	replacements: TextReplacement[],
	contextLines = 4,
): EditDiff {
	const lineNumWidth = String(Math.max(countLines(baseContent), countLines(newContent))).length;
	const skipMarker = ` ${"".padStart(lineNumWidth, " ")} ...`;
	const output: string[] = [];
	const hunks: Diff.StructuredPatchHunk[] = [];
	let firstChangedLine: number | undefined;
	for (const window of getDiffWindows(baseContent, replacements)) {
		const oldText = baseContent.slice(window.oldStart, window.oldEnd);
		const newText = newContent.slice(window.newStart, window.newEnd);
		const shown = formatDisplayDiff(
			Diff.diffLines(oldText, newText),
			window.oldLine + 1,
			window.newLine + 1,
			lineNumWidth,
			contextLines,
		);
		firstChangedLine ??= shown.firstChangedLine;
		// Both windows around a run of unchanged lines mark it as skipped; the whole-file diff shows one marker.
		if (output.at(-1) === skipMarker && shown.output[0] === skipMarker) shown.output.shift();
		// A loop, not push(...lines): spreading a replacement of many lines overflows the call stack.
		for (const line of shown.output) output.push(line);
		const patch = Diff.structuredPatch(path, path, oldText, newText, undefined, undefined, { context: contextLines });
		for (const hunk of patch.hunks) {
			hunks.push({ ...hunk, oldStart: hunk.oldStart + window.oldLine, newStart: hunk.newStart + window.newLine });
		}
	}
	const patch = Diff.formatPatch(
		{ oldFileName: path, newFileName: path, oldHeader: undefined, newHeader: undefined, hunks },
		Diff.FILE_HEADERS_ONLY,
	);
	return { diff: output.join("\n"), patch, firstChangedLine };
}

/** Matching ranges of the old and new contents around one or more replacements: offsets and 0-based first lines. */
interface DiffWindow {
	oldStart: number;
	oldEnd: number;
	oldLine: number;
	newStart: number;
	newEnd: number;
	newLine: number;
}

/** Start of the line that contains `offset`. */
function lineStartBefore(text: string, offset: number): number {
	// lastIndexOf treats a negative position as 0 and would find a line feed at offset 0.
	return offset === 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
}

/** Whole-line windows with margin around the replacements, which are sorted and disjoint; overlapping windows merge. */
function getDiffWindows(baseContent: string, replacements: TextReplacement[]): DiffWindow[] {
	const windows: DiffWindow[] = [];
	// Offset and line deltas of the replacements before the current one, and a line-counting cursor.
	let offsetDelta = 0;
	let lineDelta = 0;
	let cursorOffset = 0;
	let cursorLine = 0;
	for (const replacement of replacements) {
		const matchEnd = replacement.matchIndex + replacement.matchLength;
		let start = lineStartBefore(baseContent, replacement.matchIndex);
		for (let i = 0; i < DIFF_WINDOW_MARGIN_LINES && start > 0; i++) {
			start = lineStartBefore(baseContent, start - 1);
		}
		let end = matchEnd;
		for (let i = 0; i <= DIFF_WINDOW_MARGIN_LINES && end < baseContent.length; i++) {
			const lineFeed = baseContent.indexOf("\n", i === 0 ? Math.max(matchEnd - 1, replacement.matchIndex) : end);
			end = lineFeed === -1 ? baseContent.length : lineFeed + 1;
		}
		const replacementOffsetDelta = replacement.newText.length - replacement.matchLength;
		const replacementLineDelta =
			countLineFeeds(replacement.newText, 0, replacement.newText.length) -
			countLineFeeds(baseContent, replacement.matchIndex, matchEnd);
		const previous = windows.at(-1);
		if (previous && start <= previous.oldEnd) {
			previous.oldEnd = Math.max(previous.oldEnd, end);
			previous.newEnd = previous.oldEnd + offsetDelta + replacementOffsetDelta;
		} else {
			cursorLine += countLineFeeds(baseContent, cursorOffset, start);
			cursorOffset = start;
			windows.push({
				oldStart: start,
				oldEnd: end,
				oldLine: cursorLine,
				newStart: start + offsetDelta,
				newEnd: end + offsetDelta + replacementOffsetDelta,
				newLine: cursorLine + lineDelta,
			});
		}
		offsetDelta += replacementOffsetDelta;
		lineDelta += replacementLineDelta;
	}
	return windows;
}

