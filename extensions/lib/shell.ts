import { createPinnedPowerShellOperations } from "./powershell-process.js";
import { execFileSync } from "node:child_process";
import {
	createBashToolDefinition,
	createLocalPowerShellOperations,
	createPowerShellToolDefinition,
	getPowerShellConfig,
	type PowerShellOperations,
	type PowerShellToolOptions,
} from "@earendil-works/pi-coding-agent";

export const COMMON_SHELL_GUIDELINES = [
	"Prefer rg for search: use `rg --files` for file discovery and `rg -n PATTERN PATH` for recursive content search. Never use grep-style `rg -r` or `rg -rn`; in ripgrep, `-r` means `--replace`.",
	"Keep simple commands and pipelines in the shell. For branching, loops, structured-data processing, or fragile quoting, write a temporary TypeScript script outside the repository and run it with Bun.",
];

export const POWERSHELL_GUIDELINES = [
	"The powershell tool runs PowerShell, not bash/sh. Set environment variables with `$env:NAME = 'x'`, test paths with `Test-Path`, and invoke quoted executable paths with `& 'C:\\path\\app.exe' arg`.",
	"The command field is PowerShell source after JSON decoding, not a quoted shell argument. Encode JSON once: JSON {\"command\":\"Write-Output \\\"hello\\\"\"} must decode to Write-Output \"hello\". Never leave bash/C-style \\\" in PowerShell source to escape a quote; backslash is a literal path character. Do not wrap the whole command in another quoted string or nested pwsh -Command.",
	"Prefer single quotes for literal arguments: 'C:\\path with spaces\\file.txt', 'don''t', and 'say \"hello\"; $env:TERM' (literal dollar sign). Single quotes inside a single-quoted string are doubled. For interpolation use \"term=$env:TERM\"; for a literal double quote or dollar sign inside double quotes use a backtick: \"say `\"hello`\"; `$env:TERM\". Prefer natural multiline syntax over fragile backtick line continuations.",
	"Avoid nested expandable strings and quote-heavy $() expressions. Compute values first or use formatting: Get-Command mise -All | ForEach-Object { '{0}: {1}' -f $_.CommandType, $_.Source }. Use native read/write/edit for file content; put complex code in a temporary script using write, then invoke the script with separate arguments instead of inline bun -e/python -c or generated command strings. Native executable argument passing is a separate quoting layer and differs across shell versions; do not assume correct PowerShell string syntax guarantees embedded quotes arrive unchanged.",
	"Before any destructive file operation, validate the fully resolved absolute target against the user-authorized directory; reject empty paths, drive/share roots, and unexpected targets. Use Remove-Item/Move-Item with -LiteralPath and -ErrorAction Stop; quoting alone does not disable -Path wildcards. Keep validation and mutation in the same PowerShell scope with explicit throw on failure. Never pass generated paths through cmd /c, Invoke-Expression, or another shell for deletion. After a quoting/parsing error, inspect and correct the source before retrying; never experiment with destructive commands.",
	"PowerShell pipelines pass objects rather than text. Limit output with `Select-Object -First N` or `-Last N`, and locate commands with `(Get-Command name).Source`.",
	"For multiline native arguments, use a real multiline here-string: `@'` followed by a newline, the content, another newline, then `'@`. The opening marker must end its line and the closing marker must be alone at the start of a line.",
	"Do not build a complete command string and pass it to `Invoke-Expression`; invoke executables directly and pass arguments separately.",
	"For rg file filters on Windows, pass a directory (or `.`) as PATH and use `--glob` (e.g. `rg -n PATTERN dir --glob '*.go'` or `--glob '!*_test.go'`). Never put shell wildcards in PATH like `dir/*.go`: PowerShell often leaves them literal, and Windows rejects `*` in pathnames.",
];

export const POWERSHELL_7_GUIDELINES = [
	"This tool runs PowerShell 7 or newer. Use `&&` when a later command depends on an earlier command succeeding, and `||` for failure handling. Use `;` only for unconditional steps; never join validation and destructive mutation with `;`.",
];

export const POWERSHELL_5_GUIDELINES = [
	"This tool runs Windows PowerShell 5.1. Do not use `&&` or `||`; they are unsupported. Check `$?` immediately after a command or `$LASTEXITCODE` after a native executable, and use explicit `if` / `throw` / `exit` for dependent steps. `$ErrorActionPreference = 'Stop'` stops cmdlet errors but does not reliably stop native executable failures. Use `;` only for unconditional steps; never join validation and destructive mutation with `;`.",
];

export function getPowerShellGuidelines(major: number | undefined): string[] {
	const version = major !== undefined && major >= 7
		? POWERSHELL_7_GUIDELINES
		: major === 5
			? POWERSHELL_5_GUIDELINES
			: ["PowerShell version detection was unavailable. Use PowerShell 5.1-compatible syntax until `$PSVersionTable.PSVersion.Major` confirms 7 or newer.", ...POWERSHELL_5_GUIDELINES.map((rule) => rule.replace("This tool runs Windows PowerShell 5.1. ", "").replace("Do not use `&&` or `||`; they are unsupported.", "Until the version is confirmed, avoid `&&` and `||`."))];
	return [...POWERSHELL_GUIDELINES, ...version];
}

function probePowerShellVersion(config: ReturnType<typeof getPowerShellConfig>): string {
	return execFileSync(config.shell, [...config.args, "$PSVersionTable.PSVersion.Major"], {
		encoding: "utf8",
		timeout: 5000,
		maxBuffer: 1024,
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

// Cache both success and failure; a new extension instance (reload) gets a fresh probe.
export function createPowerShellVersionDetector(probe: () => string): () => number | undefined {
	let detected = false;
	let major: number | undefined;
	return () => {
		if (!detected) {
			detected = true;
			try {
				const output = probe().trim();
				const parsed = /^\d+$/.test(output) ? Number(output) : undefined;
				if (parsed !== undefined && Number.isSafeInteger(parsed) && parsed > 0) major = parsed;
			} catch {
				// Shell discovery, timeout and process failures leave compatible guidance available.
			}
		}
		return major;
	};
}

export interface PowerShellRuntime {
	config?: ReturnType<typeof getPowerShellConfig>;
	major?: number;
	error?: Error;
}

export function createPowerShellRuntimeResolver(
	resolveConfig: () => ReturnType<typeof getPowerShellConfig> = getPowerShellConfig,
	probe: (config: ReturnType<typeof getPowerShellConfig>) => string = probePowerShellVersion,
): () => PowerShellRuntime {
	let runtime: PowerShellRuntime | undefined;
	return () => {
		if (!runtime) {
			try {
				const selected = resolveConfig();
				const config = { ...selected, args: [...selected.args] };
				runtime = { config, major: createPowerShellVersionDetector(() => probe(config))() };
			} catch (error) {
				runtime = { error: error instanceof Error ? error : new Error(String(error)) };
			}
		}
		return runtime;
	};
}

const defaultRuntimeResolver = createPowerShellRuntimeResolver();

// Native PowerShell starts with -NoProfile. Load the standard profiles explicitly,
// in the same scope as the user command, while keeping native process flags and UTF-8 setup.
export const POWERSHELL_PROFILE_PREFIX = [
	"if (Test-Path -LiteralPath $PROFILE.AllUsersAllHosts -PathType Leaf) { . $PROFILE.AllUsersAllHosts }",
	"if (Test-Path -LiteralPath $PROFILE.AllUsersCurrentHost -PathType Leaf) { . $PROFILE.AllUsersCurrentHost }",
	"if (Test-Path -LiteralPath $PROFILE.CurrentUserAllHosts -PathType Leaf) { . $PROFILE.CurrentUserAllHosts }",
	"if (Test-Path -LiteralPath $PROFILE.CurrentUserCurrentHost -PathType Leaf) { . $PROFILE.CurrentUserCurrentHost }",
].join("\n");

export function createProfilePowerShellOperations(
	operations: PowerShellOperations = createLocalPowerShellOperations(),
): PowerShellOperations {
	return {
		exec: (command, cwd, options) => operations.exec(`${POWERSHELL_PROFILE_PREFIX}\n${command}`, cwd, options),
	};
}

function mergeGuidelines(base: readonly string[] | undefined, extra: readonly string[] = []): string[] {
	return [...(base ?? []), ...COMMON_SHELL_GUIDELINES, ...extra];
}

export type ShellRegistration = {
	name: "bash" | "powershell";
	tool: ReturnType<typeof createBashToolDefinition>;
};

export function createEnhancedShell(
	cwd: string,
	platform: NodeJS.Platform = process.platform,
	options?: PowerShellToolOptions,
	resolveRuntime: () => PowerShellRuntime = defaultRuntimeResolver,
): ShellRegistration {
	if (platform !== "win32") {
		const base = createBashToolDefinition(cwd);
		return {
			name: "bash",
			tool: { ...base, promptGuidelines: mergeGuidelines(base.promptGuidelines) },
		};
	}

	const runtime = resolveRuntime();
	const operations = options?.operations ?? (runtime.config
		? createPinnedPowerShellOperations(runtime.config)
		: { exec: async () => { throw runtime.error ?? new Error("No PowerShell executable resolved."); } });
	const version = runtime.major !== undefined ? (runtime.major >= 7 ? `PowerShell ${runtime.major}` : `Windows PowerShell ${runtime.major === 5 ? "5.1" : runtime.major}`) : "PowerShell (version unknown)";
	const base = createPowerShellToolDefinition(cwd, {
		...options,
		operations: createProfilePowerShellOperations(operations),
		spawnHook: (context) => {
			const resolved = options?.spawnHook ? options.spawnHook(context) : context;
			return { ...resolved, env: { ...resolved.env, TERM: "dumb" } };
		},
	});
	return {
		name: "powershell",
		tool: {
			...base,
			description: `${base.description} This session uses ${version}${runtime.config ? ` at ${runtime.config.shell}` : ""}. Use ${version} syntax. Standard profiles are loaded and TERM=dumb is set.`,
			promptSnippet: `Execute ${version} commands`,
			promptGuidelines: mergeGuidelines(base.promptGuidelines, getPowerShellGuidelines(runtime.major)),
		},
	};
}
