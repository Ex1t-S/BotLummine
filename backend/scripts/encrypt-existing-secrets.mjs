import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
	encryptSecret,
	hasSecretEncryptionKey,
	isEncryptedSecret,
	validateSecretEncryptionConfig,
} from '../src/lib/secret-crypto.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const TARGETS = [
	{
		label: 'WhatsAppChannel',
		model: prisma.whatsAppChannel,
		fields: ['accessToken', 'verifyToken'],
	},
	{
		label: 'CommerceConnection',
		model: prisma.commerceConnection,
		fields: ['accessToken', 'refreshToken'],
	},
	{
		label: 'StoreInstallation',
		model: prisma.storeInstallation,
		fields: ['accessToken'],
	},
	{
		label: 'LogisticsConnection',
		model: prisma.logisticsConnection,
		fields: ['password'],
	},
];

function createStats() {
	return {
		found_plaintext: 0,
		already_encrypted: 0,
		empty: 0,
		updated: 0,
	};
}

function getPrintableLength(value) {
	return String(value || '').length;
}

function logCandidate({ label, row, field, value }) {
	console.log(JSON.stringify({
		table: label,
		id: row.id,
		workspaceId: row.workspaceId || null,
		field,
		length: getPrintableLength(value),
		action: APPLY ? 'encrypt' : 'would_encrypt',
	}));
}

async function processTarget(target) {
	const statsByField = Object.fromEntries(target.fields.map((field) => [field, createStats()]));
	const select = {
		id: true,
		workspaceId: true,
		...Object.fromEntries(target.fields.map((field) => [field, true])),
	};

	const rows = await target.model.findMany({ select });

	for (const row of rows) {
		const updateData = {};

		for (const field of target.fields) {
			const stats = statsByField[field];
			const value = row[field];
			const normalized = value === null || value === undefined ? '' : String(value);

			if (!normalized) {
				stats.empty += 1;
				continue;
			}

			if (isEncryptedSecret(normalized)) {
				stats.already_encrypted += 1;
				continue;
			}

			stats.found_plaintext += 1;
			logCandidate({ label: target.label, row, field, value: normalized });

			if (APPLY) {
				updateData[field] = encryptSecret(normalized);
				stats.updated += 1;
			}
		}

		if (APPLY && Object.keys(updateData).length) {
			await target.model.update({
				where: { id: row.id },
				data: updateData,
			});
		}
	}

	return statsByField;
}

function printStats(label, statsByField) {
	for (const [field, stats] of Object.entries(statsByField)) {
		console.log(`${label}.${field}: ${JSON.stringify(stats)}`);
	}
}

async function main() {
	validateSecretEncryptionConfig();
	if (!hasSecretEncryptionKey()) {
		throw new Error('SECRET_ENCRYPTION_KEY es obligatorio para cifrar secretos existentes.');
	}

	console.log(APPLY ? 'Mode: apply' : 'Mode: dry-run');

	for (const target of TARGETS) {
		const statsByField = await processTarget(target);
		printStats(target.label, statsByField);
	}

	if (!APPLY) {
		console.log('Dry run: ejecuta `node scripts/encrypt-existing-secrets.mjs --apply` para cifrar los valores plaintext.');
	}
}

main()
	.catch((error) => {
		console.error(error?.message || error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
