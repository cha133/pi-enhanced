import { describe, expect, test } from "bun:test";
import { activateEnhancedTools } from "../extensions/lib/activation.js";

describe("tool activation", () => {
	test("replaces bash and legacy pwsh with powershell, keeps native read and write, and preserves unrelated tools", () => {
		let active = ["read", "bash", "pwsh", "powershell", "edit", "write", "third_party"];
		const pi = {
			getActiveTools: () => active,
			setActiveTools: (names: string[]) => {
				active = names;
			},
		} as any;
		activateEnhancedTools(pi, {
			shellName: "powershell",
			toolNames: ["powershell", "edit"],
		});
		expect(active).toEqual(["read", "edit", "write", "third_party", "powershell"]);
	});

	test("activates bash and removes Windows shells on non-Windows", () => {
		let active = ["read", "write", "third_party", "powershell", "pwsh"];
		const pi = {
			getActiveTools: () => active,
			setActiveTools: (names: string[]) => {
				active = names;
			},
		} as any;
		activateEnhancedTools(pi, {
			shellName: "bash",
			toolNames: ["bash", "edit"],
		});
		expect(active).toContain("read");
		expect(active).toContain("bash");
		expect(active).not.toContain("powershell");
		expect(active).not.toContain("pwsh");
		expect(active).toContain("third_party");
	});

	test("preserves already disabled native read and write", () => {
		let active = ["bash", "edit", "third_party"];
		const pi = {
			getActiveTools: () => active,
			setActiveTools: (names: string[]) => {
				active = names;
			},
		} as any;
		activateEnhancedTools(pi, {
			shellName: "bash",
			toolNames: ["bash", "edit"],
		});
		expect(active).toEqual(["edit", "third_party", "bash"]);
	});
});
