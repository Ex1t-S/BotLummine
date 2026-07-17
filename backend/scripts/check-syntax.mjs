import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const roots = ['src', 'scripts'];
const supportedExtensions = new Set(['.js', '.mjs']);

async function collectSourceFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...await collectSourceFiles(entryPath));
		} else if (supportedExtensions.has(path.extname(entry.name))) {
			files.push(entryPath);
		}
	}

	return files;
}

const sourceFiles = (await Promise.all(roots.map(collectSourceFiles))).flat().sort();
const failures = [];

for (const sourceFile of sourceFiles) {
	const result = spawnSync(process.execPath, ['--check', sourceFile], {
		encoding: 'utf8',
	});

	if (result.status !== 0) {
		failures.push({
			file: sourceFile,
			output: String(result.stderr || result.stdout || '').trim(),
		});
	}
}

if (failures.length) {
	for (const failure of failures) {
		console.error(`\n${failure.file}\n${failure.output}`);
	}

	console.error(`\nSyntax check failed for ${failures.length} of ${sourceFiles.length} files.`);
	process.exit(1);
}

console.log(`Syntax check passed for ${sourceFiles.length} files.`);
