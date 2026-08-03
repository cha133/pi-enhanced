import { describe, expect, test } from "bun:test";
import { activateEnhancedTools } from "../extensions/lib/activation.js";

describe("tool activation", () => {
	test("replaces bash with pwsh, keeps enhanced read, and preserves unrelated tools", () => {
		let active = ["read", "bash", "edit", "write", "third_party"];
		const pi = {
			getActiveTools: () => active,
			setActiveTools: (names: string[]) => {
				active = names;
			},
		} as any;
		activateEnhancedTools(pi, "pwsh");
		expect(active).toEqual(["read", "edit", "write", "third_party", "pwsh", "subagent"]);
	});

	test("keeps an already disabled bash disabled in fallback mode", () => {
		let active = ["read", "write", "third_party"];
		const pi = {
			getActiveTools: () => active,
			setActiveTools: (names: string[]) => {
				active = names;
			},
		} as any;
		activateEnhancedTools(pi, "bash");
		expect(active).toContain("read");
		expect(active).not.toContain("bash");
		expect(active).toContain("third_party");
	});
});
