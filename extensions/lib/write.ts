import { mkdir, stat, writeFile } from "node:fs/promises";
import {
	createWriteToolDefinition,
	type WriteOperations,
} from "@earendil-works/pi-coding-agent";

interface DirectoryOperations {
	mkdir: (path: string) => Promise<void>;
	stat: (path: string) => Promise<{ isDirectory: () => boolean }>;
}

const localDirectoryOperations: DirectoryOperations = {
	mkdir: (path) => mkdir(path, { recursive: true }).then(() => {}),
	stat,
};

/**
 * Work around Bun on Windows reporting EEXIST for an existing directory with
 * the read-only attribute. Remove this wrapper once Bun or pi handles that
 * case correctly.
 */
export async function ensureDirectory(
	directory: string,
	operations: DirectoryOperations = localDirectoryOperations,
): Promise<void> {
	try {
		await operations.mkdir(directory);
	} catch (error: unknown) {
		if (
			typeof error !== "object" ||
			error === null ||
			!("code" in error) ||
			error.code !== "EEXIST"
		) {
			throw error;
		}
		const metadata = await operations.stat(directory);
		if (!metadata.isDirectory()) throw error;
	}
}

export function createEnhancedWriteTool(cwd: string): ReturnType<typeof createWriteToolDefinition> {
	const operations: WriteOperations = {
		mkdir: ensureDirectory,
		writeFile: (path, content) => writeFile(path, content, "utf8"),
	};
	return createWriteToolDefinition(cwd, { operations });
}
