import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import {
	downloadWhatsAppMediaBuffer,
	getWhatsAppMediaMetadata,
	saveRecoveredInboxMediaBuffer,
} from '../src/services/whatsapp/whatsapp-media.service.js';
import {
	assertR2StorageConfig,
	headPrivateObject,
} from '../src/services/storage/r2-storage.service.js';

const apply = process.argv.includes('--apply');
const definitiveMissing = process.argv.includes('--mark-missing-unrecoverable');
const sourceArg = process.argv.find((value) => value.startsWith('--source-dir='));
const sourceDir = path.resolve(sourceArg?.split('=').slice(1).join('=') || process.env.LEGACY_MEDIA_SOURCE_DIR || 'storage/inbox-media');
const batchSize = Math.max(10, Math.min(500, Number(process.env.MEDIA_MIGRATION_BATCH_SIZE || 100)));

function fileNameFromMessage(message) {
	const storageKey = String(message.attachmentStorageKey || '').trim();
	if (storageKey) return path.basename(storageKey);
	try {
		return path.basename(new URL(String(message.attachmentUrl || ''), 'https://bladeia.invalid').pathname);
	} catch {
		return '';
	}
}

function phoneNumberIdFromPayload(rawPayload = null) {
	const direct = String(rawPayload?.attachment?.phoneNumberId || '').trim();
	if (direct) return direct;
	for (const entry of Array.isArray(rawPayload?.webhook?.entry) ? rawPayload.webhook.entry : []) {
		for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
			const phoneNumberId = String(change?.value?.metadata?.phone_number_id || '').trim();
			if (phoneNumberId) return phoneNumberId;
		}
	}
	return '';
}

function isMissingObject(error) {
	return ['NoSuchKey', 'NotFound'].includes(String(error?.name || '')) ||
		Number(error?.$metadata?.httpStatusCode || 0) === 404;
}

function isDefinitiveMetaMissing(error) {
	const status = Number(error?.response?.status || 0);
	const code = Number(error?.response?.data?.error?.code || 0);
	return status === 404 || (status === 400 && code === 100);
}

async function objectAlreadyExists(storageKey) {
	if (!String(storageKey || '').startsWith('chat/')) return false;
	try {
		await headPrivateObject(storageKey);
		return true;
	} catch (error) {
		if (isMissingObject(error)) return false;
		throw error;
	}
}

async function readLegacyFile(fileName) {
	if (!fileName) return null;
	const target = path.join(sourceDir, path.basename(fileName));
	return fs.readFile(target).catch((error) => {
		if (error?.code === 'ENOENT') return null;
		throw error;
	});
}

async function updateAvailable(message, stored, buffer, mimeType) {
	if (!apply) return;
	const fileName = path.basename(stored.storageKey);
	await prisma.message.update({
		where: { id: message.id },
		data: {
			attachmentStorageKey: stored.storageKey,
			attachmentUrl: `/api/media/inbox/${encodeURIComponent(fileName)}`,
			attachmentMimeType: mimeType || message.attachmentMimeType || 'application/octet-stream',
			attachmentSha256: crypto.createHash('sha256').update(buffer).digest('hex'),
			attachmentStatus: 'AVAILABLE',
		},
	});
}

async function migrateMessage(message, counters) {
	if (await objectAlreadyExists(message.attachmentStorageKey)) {
		counters.alreadyStored += 1;
		return;
	}

	const fileName = fileNameFromMessage(message) || `media-${message.id}.bin`;
	let buffer = await readLegacyFile(fileName);
	let mimeType = message.attachmentMimeType || 'application/octet-stream';

	if (buffer) {
		counters.fromDisk += 1;
	} else if (message.attachmentMetaId) {
		try {
			const phoneNumberId = phoneNumberIdFromPayload(message.rawPayload);
			const metadata = await getWhatsAppMediaMetadata({
				workspaceId: message.workspaceId,
				attachmentId: message.attachmentMetaId,
				mimeType,
				phoneNumberId,
			});
			buffer = await downloadWhatsAppMediaBuffer(metadata.url, {
				workspaceId: message.workspaceId,
				phoneNumberId,
			});
			mimeType = metadata.mimeType || mimeType;
			counters.fromMeta += 1;
		} catch (error) {
			counters.failed += 1;
			if (apply) {
				await prisma.message.update({
					where: { id: message.id },
					data: {
						attachmentStatus: isDefinitiveMetaMissing(error) || definitiveMissing
							? 'UNRECOVERABLE'
							: 'DOWNLOAD_FAILED',
					},
				});
			}
			return;
		}
	}

	if (!buffer) {
		counters.missing += 1;
		if (apply && definitiveMissing) {
			await prisma.message.update({
				where: { id: message.id },
				data: { attachmentStatus: 'UNRECOVERABLE' },
			});
		}
		return;
	}

	if (!apply) {
		counters.ready += 1;
		return;
	}

	const stored = await saveRecoveredInboxMediaBuffer({
		workspaceId: message.workspaceId,
		buffer,
		fileName,
		mimeType,
		sha256: message.attachmentSha256 || '',
	});
	await updateAvailable(message, stored, buffer, mimeType);
	counters.uploaded += 1;
}

async function main() {
	const storage = assertR2StorageConfig();
	if (!storage.configured) throw new Error('R2 debe estar habilitado para ejecutar la migración.');

	const counters = {
		scanned: 0,
		alreadyStored: 0,
		fromDisk: 0,
		fromMeta: 0,
		ready: 0,
		uploaded: 0,
		missing: 0,
		failed: 0,
	};
	let cursor = null;

	do {
		const rows = await prisma.message.findMany({
			where: {
				OR: [
					{ attachmentUrl: { not: null } },
					{ attachmentMetaId: { not: null } },
					{ attachmentStorageKey: { not: null } },
				],
			},
			select: {
				id: true,
				workspaceId: true,
				attachmentUrl: true,
				attachmentMimeType: true,
				attachmentMetaId: true,
				attachmentStorageKey: true,
				attachmentSha256: true,
				rawPayload: true,
			},
			orderBy: { id: 'asc' },
			take: batchSize,
			...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
		});

		for (const row of rows) {
			await migrateMessage(row, counters);
			counters.scanned += 1;
		}
		cursor = rows.at(-1)?.id || null;
		if (rows.length < batchSize) cursor = null;
	} while (cursor);

	console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', sourceDir, ...counters }, null, 2));
}

main()
	.catch((error) => {
		console.error(error?.message || error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());

