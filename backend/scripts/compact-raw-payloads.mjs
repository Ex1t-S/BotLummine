import dotenv from 'dotenv';
import { prisma } from '../src/lib/prisma.js';

dotenv.config();

const retentionDays = Math.max(1, Number(process.env.RAW_PAYLOAD_RETENTION_DAYS || 180));
const batchSize = Math.max(1, Math.min(Number(process.env.RAW_PAYLOAD_RETENTION_BATCH_SIZE || 500), 5000));
const mode = process.argv.includes('--apply') ? 'apply' : 'dry-run';
const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

const targets = [
	{ table: 'CommerceConnection', dateColumn: 'installedAt', rawColumn: 'rawPayload' },
	{ table: 'WhatsAppChannel', dateColumn: 'createdAt', rawColumn: 'rawPayload' },
	{ table: 'Message', dateColumn: 'createdAt', rawColumn: 'rawPayload' },
	{ table: 'CatalogProduct', dateColumn: 'syncedAt', rawColumn: 'rawPayload' },
	{ table: 'AbandonedCart', dateColumn: 'updatedAt', rawColumn: 'rawPayload' },
	{ table: 'CustomerProfile', dateColumn: 'syncedAt', rawColumn: 'rawCustomerPayload' },
	{ table: 'CustomerProfile', dateColumn: 'syncedAt', rawColumn: 'rawLastOrderPayload' },
	{ table: 'CustomerOrder', dateColumn: 'updatedAt', rawColumn: 'rawPayload' },
	{ table: 'CustomerOrderItem', dateColumn: 'updatedAt', rawColumn: 'rawPayload' },
	{ table: 'EnboxShipment', dateColumn: 'updatedAt', rawColumn: 'rawPayload' },
	{ table: 'TemplateSyncLog', dateColumn: 'createdAt', rawColumn: 'rawPayload' },
	{ table: 'Campaign', dateColumn: 'createdAt', rawColumn: 'rawPayload' },
	{ table: 'CampaignRecipient', dateColumn: 'createdAt', rawColumn: 'rawPayload' },
	{ table: 'CampaignConversion', dateColumn: 'createdAt', rawColumn: 'rawPayload' },
	{ table: 'AbandonedCartAutomationLog', dateColumn: 'createdAt', rawColumn: 'rawPayload' },
	{ table: 'PendingPaymentAutomationLog', dateColumn: 'createdAt', rawColumn: 'rawPayload' },
	{ table: 'ShipmentNotificationLog', dateColumn: 'createdAt', rawColumn: 'rawPayload' },
];

function quoteIdentifier(value) {
	if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
		throw new Error(`Identificador SQL invalido: ${value}`);
	}
	return `"${value}"`;
}

async function countTarget({ table, dateColumn, rawColumn }) {
	const rows = await prisma.$queryRawUnsafe(
		`SELECT COUNT(*)::int AS count
		 FROM ${quoteIdentifier(table)}
		 WHERE ${quoteIdentifier(rawColumn)} IS NOT NULL
		   AND ${quoteIdentifier(dateColumn)} < $1
		   AND NOT (${quoteIdentifier(rawColumn)} ? 'compactedBy')`,
		cutoff
	);
	return Number(rows?.[0]?.count || 0);
}

async function compactTarget({ table, dateColumn, rawColumn }) {
	const result = await prisma.$executeRawUnsafe(
		`WITH selected AS (
			SELECT id
			FROM ${quoteIdentifier(table)}
			WHERE ${quoteIdentifier(rawColumn)} IS NOT NULL
			  AND ${quoteIdentifier(dateColumn)} < $1
			  AND NOT (${quoteIdentifier(rawColumn)} ? 'compactedBy')
			ORDER BY ${quoteIdentifier(dateColumn)} ASC
			LIMIT ${batchSize}
		)
		UPDATE ${quoteIdentifier(table)} target
		SET ${quoteIdentifier(rawColumn)} = jsonb_build_object(
			'compactedBy', 'compact-raw-payloads',
			'compactedAt', to_jsonb(NOW()),
			'retentionDays', ${retentionDays},
			'originalType', jsonb_typeof(target.${quoteIdentifier(rawColumn)})
		)
		FROM selected
		WHERE target.id = selected.id`,
		cutoff
	);
	return Number(result || 0);
}

try {
	console.log(JSON.stringify({
		mode,
		cutoff: cutoff.toISOString(),
		retentionDays,
		batchSize,
		excluded: ['WhatsAppTemplate.rawPayload'],
	}));

	for (const target of targets) {
		const pending = await countTarget(target);
		let compacted = 0;
		if (mode === 'apply' && pending > 0) {
			compacted = await compactTarget(target);
		}

		console.log(JSON.stringify({
			table: target.table,
			column: target.rawColumn,
			pending,
			compacted,
		}));
	}
} finally {
	await prisma.$disconnect();
}
