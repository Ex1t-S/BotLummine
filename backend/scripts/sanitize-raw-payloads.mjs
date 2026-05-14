import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const SECRET_PAYLOAD_KEY_PATTERN = /(access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie|client[_-]?secret|verify[_-]?token)/i;

function sanitizeSecretPayload(value, depth = 0) {
	if (value === null || value === undefined) return value;
	if (depth > 8) return '[truncated]';
	if (Array.isArray(value)) return value.map((item) => sanitizeSecretPayload(item, depth + 1));
	if (typeof value !== 'object') return value;

	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !SECRET_PAYLOAD_KEY_PATTERN.test(key))
			.map(([key, item]) => [key, sanitizeSecretPayload(item, depth + 1)])
	);
}

function isObject(value) {
	return value && typeof value === 'object';
}

async function sanitizeModel({ label, model, idField = 'id' }) {
	const rows = await model.findMany({
		select: {
			[idField]: true,
			rawPayload: true,
		},
	});

	let changed = 0;
	for (const row of rows) {
		if (!isObject(row.rawPayload)) continue;
		const sanitized = sanitizeSecretPayload(row.rawPayload);
		if (JSON.stringify(sanitized) === JSON.stringify(row.rawPayload)) continue;
		changed += 1;

		if (APPLY) {
			await model.update({
				where: { [idField]: row[idField] },
				data: { rawPayload: sanitized },
			});
		}
	}

	console.log(`${label}: ${changed} rawPayload${changed === 1 ? '' : 's'} ${APPLY ? 'limpiados' : 'para limpiar'}`);
	return changed;
}

async function main() {
	const totals = [];
	totals.push(await sanitizeModel({ label: 'CommerceConnection', model: prisma.commerceConnection }));
	totals.push(await sanitizeModel({ label: 'WhatsAppChannel', model: prisma.whatsAppChannel }));

	const total = totals.reduce((sum, value) => sum + value, 0);
	console.log(`Total: ${total}`);
	if (!APPLY && total > 0) {
		console.log('Dry run: ejecuta `node scripts/sanitize-raw-payloads.mjs --apply` para aplicar la limpieza.');
	}
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
