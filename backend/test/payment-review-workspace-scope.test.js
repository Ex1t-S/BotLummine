import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(testDir, '..');

function read(relativePath) {
	return fs.readFileSync(path.join(backendDir, relativePath), 'utf8');
}

describe('payment review action boundaries', () => {
	it('keeps action reads and writes scoped to the request workspace', () => {
		const controller = read('src/controllers/payment-review.controller.js');

		assert.match(controller, /requireRequestWorkspaceId/);
		assert.match(controller, /where: \{ id: conversationId, workspaceId \}/);
		assert.match(controller, /where: \{ conversationId, workspaceId \}/);
		assert.match(controller, /workspaceId, idempotencyKey/);
		assert.match(controller, /prisma\.\$transaction/);
		assert.doesNotMatch(controller, /DEFAULT_WORKSPACE_ID/);
	});

	it('protects the endpoints with inbox access and exposes an additive migration', () => {
		const routes = read('src/routes/dashboard.routes.js');
		const schema = read('prisma/schema.prisma');
		const migration = read('prisma/migrations/20260717200000_add_payment_review_actions/migration.sql');

		assert.match(routes, /router\.get\('\/conversations\/:conversationId\/payment-review\/actions', requireInboxAccess/);
		assert.match(routes, /router\.post\('\/conversations\/:conversationId\/payment-review\/actions', requireInboxAccess/);
		assert.match(schema, /model PaymentReviewAction/);
		assert.match(schema, /@@unique\(\[workspaceId, idempotencyKey\]\)/);
		assert.match(schema, /enum PaymentReviewActionType/);
		assert.match(migration, /CREATE TYPE "PaymentReviewActionType"/);
		assert.match(migration, /ON DELETE CASCADE/);
		assert.doesNotMatch(migration, /DROP TABLE/);
	});
});
