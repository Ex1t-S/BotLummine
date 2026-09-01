import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
	assertR2StorageConfig,
	putPublicObject,
} from '../src/services/storage/r2-storage.service.js';

const apply = process.argv.includes('--apply');
const sourceArg = process.argv.find((value) => value.startsWith('--source='));
const prefixArg = process.argv.find((value) => value.startsWith('--prefix='));
const manifestArg = process.argv.find((value) => value.startsWith('--manifest='));
const sourceDir = path.resolve(sourceArg?.slice('--source='.length) || 'frontend/src/assets');
const prefix = String(prefixArg?.slice('--prefix='.length) || 'marketing').replace(/^\/+|\/+$/g, '');
const manifestPath = manifestArg ? path.resolve(manifestArg.slice('--manifest='.length)) : null;

const MIME_TYPES = {
	'.gif': 'image/gif',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.pdf': 'application/pdf',
};

async function walk(directory) {
	const output = [];
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) output.push(...await walk(absolutePath));
		else if (entry.isFile()) output.push(absolutePath);
	}
	return output;
}

function normalizeRelativePath(absolutePath) {
	return path.relative(sourceDir, absolutePath).split(path.sep).join('/');
}

function buildObjectKey(relativePath, digest) {
	const extension = path.posix.extname(relativePath).toLowerCase();
	const stem = relativePath.slice(0, relativePath.length - extension.length)
		.replace(/[^a-zA-Z0-9/_-]+/g, '-')
		.replace(/-+/g, '-');
	return `${prefix}/${stem}-${digest.slice(0, 12)}${extension}`;
}

async function main() {
	if (apply) assertR2StorageConfig();
	const files = await walk(sourceDir);
	const manifest = {};

	for (const absolutePath of files) {
		const relativePath = normalizeRelativePath(absolutePath);
		const extension = path.extname(absolutePath).toLowerCase();
		const contentType = MIME_TYPES[extension];
		if (!contentType) continue;

		const body = await fs.readFile(absolutePath);
		const sha256 = crypto.createHash('sha256').update(body).digest('hex');
		const key = buildObjectKey(relativePath, sha256);
		const stored = apply
			? await putPublicObject({ key, body, contentType, metadata: { sha256 } })
			: { url: `https://assets.bladeia.com/${encodeURI(key)}` };

		manifest[relativePath] = {
			url: stored.url,
			sha256,
			size: body.length,
		};
	}

	const serialized = `${JSON.stringify({ source: path.basename(sourceDir), prefix, files: manifest }, null, 2)}\n`;
	if (manifestPath) {
		await fs.mkdir(path.dirname(manifestPath), { recursive: true });
		await fs.writeFile(manifestPath, serialized, 'utf8');
	} else {
		process.stdout.write(serialized);
	}
}

main().catch((error) => {
	console.error(error?.message || error);
	process.exitCode = 1;
});
