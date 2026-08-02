import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	SettingsManager,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export interface ModelRoute {
	provider: string;
	model: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeModelRoute(
	name: "vision" | "advisor",
	globalValue: unknown,
	projectValue: unknown,
	options: { required: boolean; globalSource?: string; projectSource?: string },
): ModelRoute | undefined {
	const read = (value: unknown, source: string): Record<string, unknown> | undefined => {
		if (value === undefined) return undefined;
		if (!isRecord(value)) throw new Error(`The "${name}" setting in ${source} must be a JSON object.`);
		return value;
	};
	const globalRoute = read(globalValue, options.globalSource ?? "global settings");
	const projectRoute = read(projectValue, options.projectSource ?? "project settings");
	if (!globalRoute && !projectRoute) {
		if (options.required) throw new Error(`${name} model is not configured.`);
		return undefined;
	}
	const merged = { ...(globalRoute ?? {}), ...(projectRoute ?? {}) };
	if (typeof merged.provider !== "string" || !merged.provider.trim()) {
		throw new Error(`The "${name}" setting must contain a non-empty string "provider".`);
	}
	if (typeof merged.model !== "string" || !merged.model.trim()) {
		throw new Error(`The "${name}" setting must contain a non-empty string "model".`);
	}
	return { provider: merged.provider.trim(), model: merged.model.trim() };
}

export function loadModelRoute(
	ctx: ExtensionContext,
	name: "vision" | "advisor",
	required: boolean,
): ModelRoute | undefined {
	const agentDir = getAgentDir();
	const manager = SettingsManager.create(ctx.cwd, agentDir, { projectTrusted: ctx.isProjectTrusted() });
	const errors = manager.drainErrors();
	if (errors.length > 0) {
		throw new Error(errors.map(({ scope, error }) => `${scope}: ${error.message}`).join("; "));
	}
	const globalSettings = manager.getGlobalSettings() as Record<string, unknown>;
	const projectSettings = manager.getProjectSettings() as Record<string, unknown>;
	return mergeModelRoute(name, globalSettings[name], projectSettings[name], {
		required,
		globalSource: join(agentDir, "settings.json"),
		projectSource: join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"),
	});
}
