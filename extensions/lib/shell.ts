import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { win32 } from "node:path";
import {
	createBashToolDefinition,
} from "@earendil-works/pi-coding-agent";

type FileExists = (path: string) => boolean;
type VerifyPwsh = (path: string) => boolean;

export const COMMON_SHELL_GUIDELINES = [
	"Prefer rg for search: use `rg --files` for file discovery and `rg -n PATTERN PATH` for recursive content search. Never use grep-style `rg -r` or `rg -rn`; in ripgrep, `-r` means `--replace`.",
	"Keep simple commands and pipelines in the shell. For branching, loops, structured-data processing, or fragile quoting, write a temporary TypeScript script outside the repository and run it with Bun.",
];

export const BASH_FILE_GUIDELINES = [
	"The read tool is unavailable. Read small text files with `cat -- PATH`; do not emit an unbounded file of unknown size.",
	"Read an inclusive 1-based line range with `sed -n 'START,ENDp' -- PATH`. Read COUNT lines starting at 1-based START with `tail -n +START -- PATH | head -n COUNT`.",
	"Prefer a command's own output limit. Otherwise bound large output with `head -n N` or `tail -n N`.",
];

export const PWSH_GUIDELINES = [
	"The pwsh tool runs PowerShell 7, not bash/sh. Set environment variables with `$env:NAME = 'x'`, test paths with `Test-Path`, and invoke quoted executable paths with `& 'C:\\path\\app.exe' arg`.",
	"Prefer single quotes for literal arguments. In double-quoted strings, PowerShell uses the backtick, not `\\`, for escaping. Prefer natural multiline syntax over fragile backtick line continuations.",
	"PowerShell pipelines pass objects rather than text. Limit output with `Select-Object -First N` or `-Last N`, and locate commands with `(Get-Command name).Source`.",
	"The read tool is unavailable. Read a text file with `Get-Content -LiteralPath 'path'`; add `-Raw` only when a single unbroken string is required.",
	"Read COUNT lines after skipping zero-based SKIP lines with `Get-Content -LiteralPath 'path' | Select-Object -Skip SKIP -First COUNT`. User-facing line numbers are normally 1-based, so SKIP is START - 1.",
	"For multiline native arguments, use a real multiline here-string: `@'` followed by a newline, the content, another newline, then `'@`. The opening marker must end its line and the closing marker must be alone at the start of a line.",
	"Do not build a complete command string and pass it to `Invoke-Expression`; invoke executables directly and pass arguments separately.",
];

function getEnv(environment: NodeJS.ProcessEnv, name: string): string | undefined {
	const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
	return key ? environment[key] : undefined;
}

function defaultVerifyPwsh(path: string): boolean {
	try {
		const result = spawnSync(
			path,
			["-NoLogo", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"],
			{ encoding: "utf8", timeout: 5_000, windowsHide: true },
		);
		return result.status === 0 && Number.parseInt(result.stdout.trim(), 10) >= 7;
	} catch {
		return false;
	}
}

export function resolvePwsh7Path(
	environment: NodeJS.ProcessEnv = process.env,
	fileExists: FileExists = existsSync,
	verify: VerifyPwsh = defaultVerifyPwsh,
): string | undefined {
	const candidates: string[] = [];
	const pathValue = getEnv(environment, "PATH");
	if (pathValue) {
		for (const entry of pathValue.split(";")) {
			const directory = entry.trim().replace(/^"(.*)"$/, "$1");
			if (directory) candidates.push(win32.join(directory, "pwsh.exe"));
		}

	}
	const addKnownPath = (rootName: string, ...segments: string[]) => {
		const root = getEnv(environment, rootName);
		if (root) candidates.push(win32.join(root, ...segments));
	};
	addKnownPath("ProgramFiles", "PowerShell", "7", "pwsh.exe");
	addKnownPath("LOCALAPPDATA", "Microsoft", "WindowsApps", "pwsh.exe");
	addKnownPath("LOCALAPPDATA", "Microsoft", "WinGet", "Links", "pwsh.exe");
	addKnownPath("SCOOP", "shims", "pwsh.exe");
	addKnownPath("USERPROFILE", "scoop", "shims", "pwsh.exe");
	addKnownPath("ProgramData", "scoop", "shims", "pwsh.exe");

	const seen = new Set<string>();
	for (const candidate of candidates) {
		const normalized = win32.normalize(candidate);
		const key = normalized.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		if (fileExists(normalized) && verify(normalized)) return normalized;
	}
	return undefined;
}

function mergeGuidelines(base: readonly string[] | undefined, extra: readonly string[]): string[] {
	return [...(base ?? []), ...COMMON_SHELL_GUIDELINES, ...extra];
}

export type ShellRegistration = {
	name: "bash" | "pwsh";
	tool: ReturnType<typeof createBashToolDefinition>;
};

export function createEnhancedShell(
	cwd: string,
	platform: NodeJS.Platform = process.platform,
	environment: NodeJS.ProcessEnv = process.env,
): ShellRegistration {
	const pwshPath = platform === "win32" ? resolvePwsh7Path(environment) : undefined;
	if (!pwshPath) {
		const base = createBashToolDefinition(cwd);
		return {
			name: "bash",
			tool: {
				...base,
				name: "bash",
				promptGuidelines: mergeGuidelines(base.promptGuidelines, BASH_FILE_GUIDELINES),
			},
		};
	}

	const base = createBashToolDefinition(cwd, {
		shellPath: pwshPath,
		spawnHook: ({ command, cwd: commandCwd, env }) => ({
			command,
			cwd: commandCwd,
			env: { ...env, TERM: "dumb" },
		}),
	});
	return {
		name: "pwsh",
		tool: {
			...base,
			name: "pwsh",
			label: "pwsh",
			description:
				"Run a PowerShell 7 command in the current working directory. Output is truncated to the last 2,000 lines or 50 KB, with complete overflow saved to a temporary file. The user profile is loaded and TERM=dumb is set.",
			promptSnippet: "Run PowerShell 7 commands and read text files",
			promptGuidelines: mergeGuidelines(base.promptGuidelines, PWSH_GUIDELINES),
		},
	};
}
