import { describe, expect, test } from "bun:test";
import { activateEnhancedTools } from "../extensions/lib/activation.js";

describe("tool activation", () => {
	test("replaces bash with pwsh, keeps native read and write, and preserves unrelated tools", () => {
		let active = ["read", "bash", "edit", "write", "third_party"];
		const pi = {
			getActiveTools: () => active,
			setActiveTools: (names: string[]) => {
				active = names;
			},
		} as any;
		activateEnhancedTools(pi, {
			shellName: "pwsh",
			toolNames: ["pwsh", "edit"],
		});
		expect(active).toEqual(["read", "edit", "write", "third_party", "pwsh"]);
	});

	test("keeps an already disabled bash disabled in fallback mode", () => {
		let active = ["read", "write", "third_party"];
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
		expect(active).not.toContain("bash");
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
		expect(active).toEqual(["bash", "edit", "third_party"]);
	});
});
