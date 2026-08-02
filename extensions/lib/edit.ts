import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	createEditToolDefinition,
	generateDiffString,
	generateUnifiedPatch,
	renderDiff,
	withFileMutationQueue,
	type EditToolInput,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export type RejectionCode = "empty" | "not_found" | "duplicate" | "overlap" | "no_change";

export interface EditPreview {
	head: string;
	tail?: string;
	omittedLines: number;
	truncated: boolean;
}

export interface RejectedEdit {
	index: number;
	code: RejectionCode;
	message: string;
	preview: EditPreview;
	conflictsWith?: number[];
}

export interface EnhancedEditDetails {
	diff: string;
	patch: string;
	firstChangedLine?: number;
	applied: Array<{ index: number }>;
	rejected: RejectedEdit[];
}

interface Replacement {
	index: number;
	matchIndex: number;
	matchLength: number;
	newText: string;
}

interface ReplacementInput {
	oldText: string;
	newText: string;
}

function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeForFuzzyMatch(text: string): string {
	return text
		.normalize("NFKC")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function detectLineEnding(text: string): "\r\n" | "\n" {
	const crlf = text.indexOf("\r\n");
	const lf = text.indexOf("\n");
	return crlf !== -1 && (lf === -1 || crlf <= lf) ? "\r\n" : "\n";
}

function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

function resolvePath(path: string, cwd: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return resolve(cwd, path);
}

function countOccurrences(content: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let offset = 0;
	while (true) {
		const index = content.indexOf(needle, offset);
		if (index === -1) return count;
		count++;
		offset = index + needle.length;
	}
}

function boundedPreview(oldText: string): EditPreview {
	const lines = normalizeToLF(oldText).split("\n");
	const clip = (value: string) => (value.length > 160 ? `${value.slice(0, 157)}…` : value);
	if (lines.length <= 4) {
		const joined = lines.join("\n");
		if (joined.length <= 320) return { head: joined, omittedLines: 0, truncated: false };
		return {
			head: clip(joined),
			tail: joined.length > 160 ? `…${joined.slice(-157)}` : undefined,
			omittedLines: 0,
			truncated: true,
		};
	}
	return {
		head: clip(lines.slice(0, 2).join("\n")),
		tail: clip(lines.slice(-2).join("\n")),
		omittedLines: lines.length - 4,
		truncated: true,
	};
}

function applyReplacements(content: string, replacements: Replacement[], offset = 0): string {
	let result = content;
	for (const replacement of [...replacements].sort((a, b) => b.matchIndex - a.matchIndex)) {
		const index = replacement.matchIndex - offset;
		result = result.slice(0, index) + replacement.newText + result.slice(index + replacement.matchLength);
	}
	return result;
}

function splitLinesWithEndings(content: string): string[] {
	return content.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function applyPreservingUnchangedLines(
	originalContent: string,
	matchContent: string,
	replacements: Replacement[],
): string {
	const originalLines = splitLinesWithEndings(originalContent);
	const matchLines = splitLinesWithEndings(matchContent);
	if (originalLines.length !== matchLines.length) {
		throw new Error("Cannot preserve unchanged lines after fuzzy normalization.");
	}
	const spans: Array<{ start: number; end: number }> = [];
	let offset = 0;
	for (const line of matchLines) {
		spans.push({ start: offset, end: offset + line.length });
		offset += line.length;
	}
	const groups: Array<{ startLine: number; endLine: number; replacements: Replacement[] }> = [];
	for (const replacement of [...replacements].sort((a, b) => a.matchIndex - b.matchIndex)) {
		const startLine = spans.findIndex(
			(span) => replacement.matchIndex >= span.start && replacement.matchIndex < span.end,
		);
		if (startLine === -1) throw new Error("Replacement range is outside the file.");
		let endLine = startLine;
		const replacementEnd = replacement.matchIndex + replacement.matchLength;
		while (endLine < spans.length && spans[endLine].end < replacementEnd) endLine++;
		if (endLine >= spans.length) throw new Error("Replacement range is outside the file.");
		const previous = groups.at(-1);
		if (previous && startLine < previous.endLine) {
			previous.endLine = Math.max(previous.endLine, endLine + 1);
			previous.replacements.push(replacement);
		} else {
			groups.push({ startLine, endLine: endLine + 1, replacements: [replacement] });
		}
	}
	let result = "";
	let originalLine = 0;
	for (const group of groups) {
		result += originalLines.slice(originalLine, group.startLine).join("");
		const start = spans[group.startLine].start;
		const end = spans[group.endLine - 1].end;
		result += applyReplacements(matchContent.slice(start, end), group.replacements, start);
		originalLine = group.endLine;
	}
	return result + originalLines.slice(originalLine).join("");
}

export function applyPartialEdits(content: string, edits: ReplacementInput[]): {
	newContent: string;
	applied: Array<{ index: number }>;
	rejected: RejectedEdit[];
} {
	const normalizedEdits = edits.map((edit: ReplacementInput) => ({
		oldText: normalizeToLF(edit.oldText),
		newText: normalizeToLF(edit.newText),
	}));
	const requiresFuzzy = normalizedEdits.some(
		(edit: ReplacementInput) => edit.oldText && content.indexOf(edit.oldText) === -1 && normalizeForFuzzyMatch(content).includes(normalizeForFuzzyMatch(edit.oldText)),
	);
	const matchContent = requiresFuzzy ? normalizeForFuzzyMatch(content) : content;
	const rejected: RejectedEdit[] = [];
	const candidates: Replacement[] = [];

	for (let index = 0; index < normalizedEdits.length; index++) {
		const edit = normalizedEdits[index];
		const preview = boundedPreview(edit.oldText);
		if (!edit.oldText) {
			rejected.push({ index, code: "empty", message: "oldText must not be empty.", preview });
			continue;
		}
		const target = requiresFuzzy ? normalizeForFuzzyMatch(edit.oldText) : edit.oldText;
		const occurrences = countOccurrences(matchContent, target);
		if (occurrences === 0) {
			rejected.push({ index, code: "not_found", message: "oldText was not found.", preview });
			continue;
		}
		if (occurrences > 1) {
			rejected.push({
				index,
				code: "duplicate",
				message: `oldText matched ${occurrences} locations; add context to make it unique.`,
				preview,
			});
			continue;
		}
		const matchIndex = matchContent.indexOf(target);
		if (edit.oldText === edit.newText) {
			rejected.push({ index, code: "no_change", message: "replacement would not change the file.", preview });
			continue;
		}
		candidates.push({ index, matchIndex, matchLength: target.length, newText: edit.newText });
	}

	const conflicts = new Map<number, Set<number>>();
	for (let left = 0; left < candidates.length; left++) {
		for (let right = left + 1; right < candidates.length; right++) {
			const a = candidates[left];
			const b = candidates[right];
			if (a.matchIndex < b.matchIndex + b.matchLength && b.matchIndex < a.matchIndex + a.matchLength) {
				if (!conflicts.has(a.index)) conflicts.set(a.index, new Set());
				if (!conflicts.has(b.index)) conflicts.set(b.index, new Set());
				conflicts.get(a.index)!.add(b.index);
				conflicts.get(b.index)!.add(a.index);
			}
		}
	}
	const accepted = candidates.filter((candidate) => !conflicts.has(candidate.index));
	for (const candidate of candidates) {
		const conflict = conflicts.get(candidate.index);
		if (!conflict) continue;
		rejected.push({
			index: candidate.index,
			code: "overlap",
			message: `replacement overlaps edits[${[...conflict].join("], edits[")}]; the entire overlap group was rejected.`,
			preview: boundedPreview(normalizedEdits[candidate.index].oldText),
			conflictsWith: [...conflict].sort((a, b) => a - b),
		});
	}

	const newContent = accepted.length === 0
		? content
		: requiresFuzzy
			? applyPreservingUnchangedLines(content, matchContent, accepted)
			: applyReplacements(matchContent, accepted);
	return {
		newContent,
		applied: accepted.map(({ index }) => ({ index })).sort((a, b) => a.index - b.index),
		rejected: rejected.sort((a, b) => a.index - b.index),
	};
}

function formatRejected(rejected: RejectedEdit[]): string {
	return rejected
		.map((item) => {
			const preview = item.preview.truncated
				? `${JSON.stringify(item.preview.head)} … ${JSON.stringify(item.preview.tail ?? "")} (${item.preview.omittedLines} omitted line(s); incomplete preview)`
				: JSON.stringify(item.preview.head);
			return `- edits[${item.index}] (${item.code}): ${item.message} Preview: ${preview}`;
		})
		.join("\n");
}

export function createEnhancedEditTool(cwd: string): Parameters<ExtensionAPI["registerTool"]>[0] {
	const base = createEditToolDefinition(cwd);
	return {
		name: "edit",
		label: "edit",
		description:
			"Edit one file with independent exact-text replacements. Valid non-overlapping edits are applied even when other entries are rejected. All entries match the same original snapshot; overlapping groups are rejected together.",
		promptSnippet: "Apply multiple independent text replacements with partial success",
		promptGuidelines: [
			"Use edit for precise changes. Each edits[].oldText must identify one unique region.",
			"Put disjoint replacements for one file in a single call. Every entry matches the original file snapshot, not the output of earlier entries.",
			"Do not submit overlapping or nested entries. If some entries are rejected, retry only those indexes after inspecting the returned errors and applied diff.",
			"Keep oldText small but unique; do not pad it with large unchanged regions.",
		],
		parameters: base.parameters,
		prepareArguments: base.prepareArguments,
		async execute(_toolCallId, input: EditToolInput, signal?: AbortSignal) {
			if (!Array.isArray(input.edits) || input.edits.length === 0) {
				throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
			}
			const absolutePath = resolvePath(input.path, cwd);
			return withFileMutationQueue(absolutePath, async () => {
				const throwIfAborted = () => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};
				throwIfAborted();
				await access(absolutePath, constants.R_OK | constants.W_OK);
				const raw = await readFile(absolutePath, "utf8");
				throwIfAborted();
				const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
				const withoutBom = bom ? raw.slice(1) : raw;
				const ending = detectLineEnding(withoutBom);
				const original = normalizeToLF(withoutBom);
				const outcome = applyPartialEdits(original, input.edits);
				if (outcome.applied.length > 0) {
					await writeFile(absolutePath, bom + restoreLineEndings(outcome.newContent, ending), "utf8");
					throwIfAborted();
				}
				const diffResult = generateDiffString(original, outcome.newContent);
				const details: EnhancedEditDetails = {
					diff: diffResult.diff,
					patch: generateUnifiedPatch(input.path, original, outcome.newContent),
					firstChangedLine: diffResult.firstChangedLine,
					applied: outcome.applied,
					rejected: outcome.rejected,
				};
				const summary = `Applied ${outcome.applied.length} of ${input.edits.length} replacement(s) to ${input.path}.`;
				return {
					content: [{
						type: "text" as const,
						text: outcome.rejected.length > 0
							? `${summary}\nRejected edits:\n${formatRejected(outcome.rejected)}\nRetry only rejected entries.`
							: summary,
					}],
					details,
				};
			});
		},
		renderCall(rawArgs: unknown, theme) {
			const args = rawArgs as { path?: unknown } | undefined;
			const path = typeof args?.path === "string" ? args.path : "(invalid path)";
			return new Text(theme.fg("toolTitle", theme.bold(`edit ${path}`)), 0, 0);
		},
		renderResult(result, _options, theme, context) {
			const details = result.details as EnhancedEditDetails | undefined;
			const applied = details?.applied.length ?? 0;
			const rejected = details?.rejected.length ?? 0;
			const color = rejected > 0 ? "warning" : "success";
			const container = new Container();
			container.addChild(new Text(theme.fg(color, `Applied ${applied}; rejected ${rejected}`), 0, 0));
			if (details?.diff) {
				const path = (context.args as { path?: string } | undefined)?.path;
				container.addChild(new Spacer(1));
				container.addChild(new Text(renderDiff(details.diff, { filePath: path }), 0, 0));
			}
			return container;
		},
	};
}
