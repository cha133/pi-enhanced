import { describe, expect, test } from "bun:test";
import { createEnhancedShell, resolvePwsh7Path } from "../extensions/lib/shell.js";

describe("PowerShell detection", () => {
	test("deduplicates candidates and returns the first existing pwsh executable", () => {
		const checked: string[] = [];
		const path = resolvePwsh7Path(
			{ PATH: "C:\\Tools;C:\\TOOLS", ProgramFiles: "C:\\Program Files" },
			(candidate) => {
				checked.push(candidate);
				return candidate.toLowerCase().includes("tools\\pwsh.exe");
			},
		);
		expect(path?.toLowerCase()).toBe("c:\\tools\\pwsh.exe");
		expect(checked).toHaveLength(1);
	});

	test("falls back to an enhanced bash definition outside Windows", () => {
		const shell = createEnhancedShell("C:\\repo", "linux", {});
		expect(shell.name).toBe("bash");
		expect(shell.tool.promptGuidelines?.join("\n")).toContain("rg --files");
		expect(shell.tool.promptGuidelines?.join("\n")).not.toContain("cat -- PATH");
		expect(shell.tool.promptGuidelines?.join("\n")).not.toContain("sed -n");
	});

	test("executes through PowerShell 7 with TERM=dumb when available", async () => {
		const shell = createEnhancedShell(process.cwd());
		if (shell.name !== "pwsh") return;
		expect(shell.tool.promptSnippet).toBe("Run PowerShell 7 commands");
		expect(shell.tool.promptGuidelines?.join("\n")).not.toContain("Get-Content");
		const result = await (shell.tool.execute as any)(
			"call",
			{ command: "Write-Output \"$($PSVersionTable.PSVersion.Major)|$env:TERM\"", timeout: 10 },
			undefined,
			undefined,
			undefined,
		);
		const text = result.content.find((part: { type: string }) => part.type === "text")?.text ?? "";
		expect(text).toContain("7|dumb");
	});
});
