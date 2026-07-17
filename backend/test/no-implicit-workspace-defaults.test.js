import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const SOURCE_ROOT = new URL('../src/', import.meta.url);

async function collectJavaScriptFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const target = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
			if (entry.isDirectory()) {
				return collectJavaScriptFiles(target);
			}
			return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
		})
	);
	return files.flat();
}

describe('Workspace boundary regression guard', () => {
	it('does not allow implicit default workspaces in backend source', async () => {
		const files = await collectJavaScriptFiles(SOURCE_ROOT);
		const forbiddenPatterns = [
			/workspaceId\s*=\s*DEFAULT_WORKSPACE_ID/,
			/normalizeWorkspaceId\([^)]*\)\s*\|\|\s*DEFAULT_WORKSPACE_ID/
		];
		const violations = [];

		for (const file of files) {
			const source = await readFile(file, 'utf8');
			for (const pattern of forbiddenPatterns) {
				if (pattern.test(source)) {
					violations.push(`${file.pathname}: ${pattern}`);
				}
			}
		}

		assert.deepEqual(
			violations,
			[],
			`Se encontraron workspaces por defecto implícitos:\n${violations.join('\n')}`
		);
	});
});
