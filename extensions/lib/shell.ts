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
	"Prefer single quotes for literal arguments. In double-quoted strings, PowerShell uses the backtick, not `\\`, for escaping. Prefer natural multiline syntax over fragile backtick line continuations.",
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

function probePowerShellVersion(): string {
	const config = getPowerShellConfig();
	return execFileSync(config.shell, [...config.args, "$PSVersionTable.PSVersion.Major"], {
		encoding: "utf8",
		timeout: 5000,
		maxBuffer: 1024,
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

// Cache both success and failure; a new extension instance (reload) gets a fresh probe.
export function createPowerShellVersionDetector(probe: () => string = probePowerShellVersion): () => number | undefined {
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

const defaultVersionDetector = createPowerShellVersionDetector();

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
	detectVersion: () => number | undefined = defaultVersionDetector,
): ShellRegistration {
	if (platform !== "win32") {
		const base = createBashToolDefinition(cwd);
		return {
			name: "bash",
			tool: { ...base, promptGuidelines: mergeGuidelines(base.promptGuidelines) },
		};
	}

	const base = createPowerShellToolDefinition(cwd, {
		...options,
		operations: createProfilePowerShellOperations(options?.operations),
		spawnHook: (context) => {
			const resolved = options?.spawnHook ? options.spawnHook(context) : context;
			return { ...resolved, env: { ...resolved.env, TERM: "dumb" } };
		},
	});
	return {
		name: "powershell",
		tool: {
			...base,
			description: `${base.description} Prefers PowerShell 7, falls back to Windows PowerShell 5.1, loads standard profiles, and sets TERM=dumb.`,
			promptGuidelines: mergeGuidelines(base.promptGuidelines, getPowerShellGuidelines(detectVersion())),
		},
	};
}
