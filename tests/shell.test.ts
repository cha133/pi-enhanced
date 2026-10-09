import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createPowerShellToolDefinition, getPowerShellConfig } from "@earendil-works/pi-coding-agent";
import { createEnhancedShell, createPowerShellVersionDetector, createPowerShellRuntimeResolver, getPowerShellGuidelines, POWERSHELL_PROFILE_PREFIX } from "../extensions/lib/shell.js";
import { createPinnedPowerShellOperations } from "../extensions/lib/powershell-process.js";

const runFile = promisify(execFile);
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

describe("platform shell adaptation", () => {
	for (const platform of ["darwin", "linux"] as const) {
		test(`uses native bash with search guidance on ${platform}`, () => {
			const shell = createEnhancedShell("/repo", platform);
			expect(shell.name).toBe("bash");
			expect(shell.tool.promptGuidelines?.join("\n")).toContain("rg --files");
			expect(shell.tool.promptGuidelines?.join("\n")).not.toContain("PowerShell 5.1");
		});
	}

	test("preserves the native powershell schema and prompt metadata", () => {
		const shell = createEnhancedShell(process.cwd(), "win32");
		const native = createPowerShellToolDefinition(process.cwd());
		expect(shell.name).toBe("powershell");
		expect(shell.tool.parameters).toEqual(native.parameters);
		expect(shell.tool.outputSchema).toEqual(native.outputSchema);
		expect(shell.tool.promptSnippet).toContain("PowerShell");
		expect(shell.tool.description).not.toContain("falls back");
		expect(shell.tool.renderCall).toBeDefined();
		expect(shell.tool.promptGuidelines).toEqual(expect.arrayContaining(native.promptGuidelines ?? []));
	});

	test("passes context, profiles, TERM, cancellation and streaming to operations", async () => {
		const controller = new AbortController();
		let observed: any;
		let updates = 0;
		const shell = createEnhancedShell("/initial", "win32", {
			operations: { exec: async (command, cwd, options) => {
				observed = { command, cwd, options };
				options.onData(Buffer.from("done"));
				return { exitCode: 0 };
			} },
			spawnHook: (context) => ({ ...context, env: { ...context.env, CUSTOM: "kept", TERM: "ansi" } }),
		});
		const result = await shell.tool.execute("call", { command: "Write-Output 'done'", timeout: 3 }, controller.signal,
			() => { updates++; }, { cwd: "/current", sessionManager: { getSessionId: () => "session", getSessionFile: () => undefined } } as any);
		expect(observed.command).toBe(`${POWERSHELL_PROFILE_PREFIX}\nWrite-Output 'done'`);
		expect(observed.cwd).toBe("/current");
		expect(observed.options.env).toMatchObject({ TERM: "dumb", CUSTOM: "kept", PI_SESSION_ID: "session" });
		expect(observed.options.signal).toBe(controller.signal);
		expect(observed.options.timeout).toBe(3);
		expect(updates).toBeGreaterThan(0);
		expect(result.structuredContent).toMatchObject({ output: "done", exit_code: 0 });
	});

	test("guidance covers 5.1 conditionals and Windows rg globs", () => {
		const text = getPowerShellGuidelines(5).join("\n");
		for (const term of ["PowerShell 5.1", "Do not use `&&` or `||`", "$LASTEXITCODE", "$?", "--glob", "Never put shell wildcards in PATH", "Invoke-Expression"]) expect(text).toContain(term);
	});

	test("quoting and destructive-path guidance reaches every Windows runtime", () => {
		for (const major of [5, 7, undefined]) {
			const tool = createEnhancedShell("/repo", "win32", undefined, () => ({ major })).tool;
			const text = tool.promptGuidelines?.join("\n") ?? "";
			for (const term of ["after JSON decoding", "Encode JSON once", "'don''t'", "'{0}: {1}' -f", "-LiteralPath", "explicit throw", "Never pass generated paths through cmd /c", "never experiment with destructive commands"]) expect(text).toContain(term);
		}
	});

	test.skipIf(process.platform !== "win32")("JSON-decoded quoting examples execute as data on 7 and 5.1", async () => {
		const config = getPowerShellConfig();
		const legacy = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
		const command = [
			"Write-Output 'don''t'",
			'Write-Output \'say "hello"; $env:TERM; Remove-Item C:\\ -Recurse\'',
			'Write-Output "say `"hello`"; `$env:TERM"',
			"[pscustomobject]@{ CommandType = 'Function'; Source = 'example' } | ForEach-Object { '{0}: {1}' -f $_.CommandType, $_.Source }",
			"$bytes = [byte[]](65, 66)\n'decode UTF-8: ' + [Text.Encoding]::UTF8.GetString($bytes)",
			"$data = @'\n{\"name\":\"don't\",\"literal\":\"$env:TERM\"}\n'@\nWrite-Output $data",
		].join("\n");
		const decoded = JSON.parse(JSON.stringify({ command }));
		for (const executable of new Set([config.shell, legacy])) {
			const selected = { ...config, shell: executable };
			const tool = createEnhancedShell(process.cwd(), "win32", {
				operations: createPinnedPowerShellOperations(selected),
			}, () => ({ config: selected, major: executable === legacy ? 5 : 7 })).tool;
			const result = await tool.execute("quoting", { ...decoded, timeout: 10 }, undefined, undefined,
				{ cwd: process.cwd(), sessionManager: { getSessionId: () => "quoting-test", getSessionFile: () => undefined } } as any);
			expect(result.structuredContent).toMatchObject({ exit_code: 0 });
			const output = (result.structuredContent as { output: string }).output;
			expect(output.trim().split(/\r?\n/)).toEqual([
				"don't",
				'say "hello"; $env:TERM; Remove-Item C:\\ -Recurse',
				'say "hello"; $env:TERM',
				"Function: example",
				"decode UTF-8: AB",
				'{"name":"don\'t","literal":"$env:TERM"}',
			]);
		}
	}, 30000);

	test("7+ receives modern chaining guidance without compatibility restrictions", () => {
		for (const major of [7, 8]) {
			const shell = createEnhancedShell("/repo", "win32", undefined, () => ({ major }));
			const text = shell.tool.promptGuidelines?.join("\n") ?? "";
			expect(text).toContain("Use `&&`");
			expect(shell.tool.description).toContain(`This session uses PowerShell ${major}`);
			expect(shell.tool.description).not.toContain("5.1");
			expect(shell.tool.promptSnippet).toBe(`Execute PowerShell ${major} commands`);
			expect(text).not.toContain("5.1");
			expect(text).not.toContain("Do not use `&&`");
			expect(text).toContain("--glob");
		}
	});

	test("unknown version receives compatible guidance without claiming 5.1", () => {
		const text = getPowerShellGuidelines(undefined).join("\n");
		expect(text).toContain("version detection was unavailable");
		expect(text).not.toContain("This tool runs Windows PowerShell 5.1");
		expect(text).toContain("$LASTEXITCODE");
	});

	test("version detector parses and caches successful probes", () => {
		let calls = 0;
		const detect = createPowerShellVersionDetector(() => { calls++; return "7\r\n"; });
		expect(detect()).toBe(7);
		expect(detect()).toBe(7);
		expect(calls).toBe(1);
		expect(createPowerShellVersionDetector(() => "5\r\n")()).toBe(5);
	});

	test("version detector caches failures and rejects malformed output", () => {
		let calls = 0;
		const detect = createPowerShellVersionDetector(() => { calls++; throw new Error("timeout"); });
		expect(detect()).toBeUndefined();
		expect(detect()).toBeUndefined();
		expect(calls).toBe(1);
		for (const output of ["", "noise\n7", "7.1", "0", "-1"]) expect(createPowerShellVersionDetector(() => output)()).toBeUndefined();
	});

	test("non-Windows construction never probes PowerShell", () => {
		createEnhancedShell("/repo", "linux", undefined, () => { throw new Error("unexpected probe"); });
	});

	test("runtime resolver caches the exact probed executable and retains it when probing fails", () => {
		let resolutions = 0;
		let probes = 0;
		const config = { shell: "C:\\PowerShell\\pwsh.exe", args: ["-NoProfile", "-Command"] };
		const resolve = createPowerShellRuntimeResolver(() => { resolutions++; return config; }, (selected) => {
			probes++;
			expect(selected.shell).toBe(config.shell);
			return "7";
		});
		const runtime = resolve();
		expect(runtime).toMatchObject({ config, major: 7 });
		expect(resolve()).toBe(runtime);
		expect(resolutions).toBe(1);
		expect(probes).toBe(1);
		const unknown = createPowerShellRuntimeResolver(() => config, () => { throw new Error("timeout"); })();
		expect(unknown.config?.shell).toBe(config.shell);
		expect(unknown.major).toBeUndefined();
	});

	test("discovery failure is cached and does not silently select another shell", () => {
		let calls = 0;
		const resolve = createPowerShellRuntimeResolver(() => { calls++; throw new Error("missing shell"); });
		expect(resolve().error?.message).toBe("missing shell");
		expect(resolve().config).toBeUndefined();
		expect(calls).toBe(1);
	});

	test.skipIf(process.platform !== "win32")("concurrent calls stay on the probed executable after PATH changes", async () => {
		const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
		const script = `import { createEnhancedShell } from './extensions/lib/shell.ts';
			const tool = createEnhancedShell(process.cwd()).tool;
			for (const key of Object.keys(process.env)) if (key.toLowerCase() === 'path') delete process.env[key];
			process.env.PATH = ${JSON.stringify(system32 + ";" + join(system32, "WindowsPowerShell", "v1.0"))};
			const results = await Promise.all([0,1].map(() => tool.execute('pinned', {command: '$PSVersionTable.PSVersion.Major; (Get-Process -Id $PID).Path',timeout:10})));
			console.log(JSON.stringify({ description: tool.description, snippet: tool.promptSnippet, results }));`;
		const result = await runFile(process.execPath, ["-e", script], { cwd: process.cwd(), timeout: 20000, windowsHide: true });
		const parsed = JSON.parse(result.stdout.trim());
		const config = getPowerShellConfig();
		for (const call of parsed.results) {
			expect(call.structuredContent.exit_code).toBe(0);
			expect(call.structuredContent.output).toContain(config.shell);
		}
		expect(parsed.description).toContain(config.shell);
		expect(parsed.description).not.toContain("falls back");
		expect(parsed.snippet).toContain("PowerShell");
	}, 30000);

	test.skipIf(process.platform !== "win32")("pinned execution preserves timeout and cancellation", async () => {
		const tool = createEnhancedShell(process.cwd()).tool;
		const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "test", getSessionFile: () => undefined } } as any;
		await expect(tool.execute("timeout", { command: "Start-Sleep -Seconds 30", timeout: 0.2 }, undefined, undefined, ctx)).rejects.toThrow("Command timed out after 0.2 seconds");
		const controller = new AbortController();
		const cancellation = tool.execute("abort", { command: "Write-Output 'ready'; Start-Sleep -Seconds 30", timeout: 10 }, controller.signal,
			(update) => { if (update.content.some((part) => part.type === "text" && part.text.includes("ready"))) controller.abort(); }, ctx);
		await expect(cancellation).rejects.toThrow("Command aborted");
	}, 30000);

	test.skipIf(process.platform !== "win32")("native execution preserves UTF-8, cwd and nonzero exits", async () => {
		const result = await createEnhancedShell(process.cwd()).tool.execute("call", {
			command: "Write-Output ('term=' + $env:TERM); Write-Output '中文 héllo €'; (Get-Location).Path; exit 9", timeout: 10,
		}, undefined, undefined, { cwd: process.cwd(), sessionManager: { getSessionId: () => "test", getSessionFile: () => undefined } } as any);
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({ exit_code: 9 });
		const text = result.content.map((part) => part.type === "text" ? part.text : "").join("");
		for (const value of ["term=dumb", "中文 héllo €", process.cwd()]) expect(text).toContain(value);
	});

	test.skipIf(process.platform !== "win32")("falls back to 5.1 through the native resolver when 7 is absent from PATH", async () => {
		const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
		const legacyDirectory = join(system32, "WindowsPowerShell", "v1.0");
		const env = { ...process.env };
		for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
		env.PATH = `${system32};${legacyDirectory}`;
		const script = `import { createEnhancedShell } from './extensions/lib/shell.ts';
			const shell = createEnhancedShell(process.cwd());
			const result = await shell.tool.execute('fallback', { command: "Write-Output ('version=' + $PSVersionTable.PSVersion.Major); Write-Output ('term=' + $env:TERM); Write-Output '中文 héllo €'", timeout: 10 });
			console.log(JSON.stringify({ ...result, guidelines: shell.tool.promptGuidelines }));`;
		const result = await runFile(process.execPath, ["-e", script], { cwd: process.cwd(), env, timeout: 20000, windowsHide: true });
		const parsed = JSON.parse(result.stdout.trim());
		expect(parsed.structuredContent.exit_code).toBe(0);
		expect(parsed.guidelines.join("\n")).toContain("This tool runs Windows PowerShell 5.1");
		for (const value of ["version=5", "term=dumb", "中文 héllo €"]) expect(parsed.structuredContent.output).toContain(value);
	}, 30000);

	test.skipIf(process.platform !== "win32")("loads profiles in order and command scope on 7 and 5.1", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-shell-profiles-"));
		try {
			const names = ["AllUsersAllHosts", "AllUsersCurrentHost", "CurrentUserAllHosts", "CurrentUserCurrentHost"];
			const paths = names.map((_, index) => join(directory, `profile ${index}.ps1`));
			for (let i = 0; i < paths.length; i++) await writeFile(paths[i]!, `$global:profileOrder += '${i}'; function Get-ProfileValue { 'profile-${i}' }`);
			const setup = `$global:profileOrder = ''\n$PROFILE = [pscustomobject]@{ ${names.map((name, i) => `${name} = ${quote(paths[i]!)}`).join("; ")} }`;
			const command = `${setup}\n${POWERSHELL_PROFILE_PREFIX}\nWrite-Output $global:profileOrder; Get-ProfileValue`;
			const config = getPowerShellConfig();
			const legacy = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
			for (const executable of new Set([config.shell, legacy])) {
				const result = await runFile(executable, [...config.args, command], { cwd: directory, timeout: 10000, windowsHide: true });
				expect(result.stdout).toContain("0123");
				expect(result.stdout).toContain("profile-3");
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30000);
});
