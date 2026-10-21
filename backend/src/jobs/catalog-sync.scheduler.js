import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { syncCatalogForWorkspace } from '../services/catalog/catalog.service.js';
import { resolveActiveCommerceConnection } from '../services/commerce/active-commerce.service.js';

const DEFAULT_INTERVAL_MS = 72 * 60 * 60 * 1000;
const DEFAULT_START_DELAY_MS = 60 * 1000;
const MIN_INTERVAL_MS = 60 * 60 * 1000;

let timer = null;
let started = false;
let running = false;

function enabled() {
	const value = String(process.env.CATALOG_SYNC_ENABLED ?? 'true').trim().toLowerCase();
	return !['0', 'false', 'no', 'off', 'disabled'].includes(value);
}

function intervalMs() {
	const configuredHours = Number(process.env.CATALOG_SYNC_INTERVAL_HOURS);
	if (Number.isFinite(configuredHours) && configuredHours > 0) {
		return Math.max(MIN_INTERVAL_MS, configuredHours * 60 * 60 * 1000);
	}
	const value = Number(process.env.CATALOG_SYNC_INTERVAL_MS || DEFAULT_INTERVAL_MS);
	return Math.max(MIN_INTERVAL_MS, Number.isFinite(value) ? value : DEFAULT_INTERVAL_MS);
}

async function runCatalogSyncTick() {
	if (running) return;
	running = true;
	try {
		const workspaces = await prisma.workspace.findMany({
			where: { commerceConnections: { some: { status: 'ACTIVE' } } },
			select: { id: true }
		});
		const results = [];
		for (const workspace of workspaces) {
			try {
				const connection = await resolveActiveCommerceConnection({ workspaceId: workspace.id });
				const latestSuccess = await prisma.catalogSyncLog.findFirst({
					where: { workspaceId: workspace.id, provider: connection.provider, status: 'SUCCESS' },
					orderBy: { finishedAt: 'desc' },
					select: { finishedAt: true }
				});
				if (latestSuccess?.finishedAt && Date.now() - latestSuccess.finishedAt.getTime() < intervalMs()) {
					results.push({ workspaceId: workspace.id, ok: true, skipped: true });
					continue;
				}
				const result = await syncCatalogForWorkspace({ workspaceId: workspace.id });
				results.push({ workspaceId: workspace.id, ok: result?.ok !== false, result });
			} catch (error) {
				results.push({ workspaceId: workspace.id, ok: false, error: error?.message || String(error) });
				logger.error('catalog.sync_scheduler_workspace_failed', { workspaceId: workspace.id, error });
			}
		}
		logger.info('catalog.sync_scheduler_tick', {
			workspaces: results.length,
			skippedWorkspaces: results.filter((item) => item.skipped).length,
			failed: results.filter((item) => !item.ok).length,
			added: results.reduce((sum, item) => sum + Number(item.result?.productsAdded || 0), 0),
			updated: results.reduce((sum, item) => sum + Number(item.result?.productsUpdated || 0), 0),
			skipped: results.reduce((sum, item) => sum + Number(item.result?.productsSkipped || 0), 0),
			detailsFetched: results.reduce((sum, item) => sum + Number(item.result?.detailsFetched || 0), 0)
		});
	} catch (error) {
		logger.error('catalog.sync_scheduler_failed', { error });
	} finally {
		running = false;
	}
}

export function startCatalogSyncScheduler() {
	if (started || !enabled()) return { started: false, enabled: enabled() };
	started = true;
	const configuredIntervalMs = intervalMs();
	logger.info('catalog.sync_scheduler_started', { intervalMs: configuredIntervalMs });
	timer = setInterval(() => { void runCatalogSyncTick(); }, configuredIntervalMs);
	if (typeof timer.unref === 'function') timer.unref();
	setTimeout(() => { void runCatalogSyncTick(); }, DEFAULT_START_DELAY_MS).unref?.();
	return { started: true, enabled: true, intervalMs: configuredIntervalMs };
}

export function stopCatalogSyncScheduler() {
	if (timer) clearInterval(timer);
	timer = null;
	started = false;
}
