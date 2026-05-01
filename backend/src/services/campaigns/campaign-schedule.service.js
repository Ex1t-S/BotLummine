import { prisma } from '../../lib/prisma.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { createCampaignDraft, launchCampaign } from './whatsapp-campaign.service.js';

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_TIME_OF_DAY = '22:00';

function normalizeString(value, fallback = '') {
	const normalized = String(value ?? '').trim();
	return normalized || fallback;
}

function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

function normalizeStatus(value) {
	const normalized = normalizeString(value, 'ACTIVE').toUpperCase();
	return normalized === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
}

function normalizeTimeOfDay(value) {
	const match = normalizeString(value, DEFAULT_TIME_OF_DAY).match(/^(\d{1,2}):(\d{2})$/);
	if (!match) return DEFAULT_TIME_OF_DAY;

	const hour = Math.max(0, Math.min(Number(match[1]) || 0, 23));
	const minute = Math.max(0, Math.min(Number(match[2]) || 0, 59));
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeFilters(input = {}) {
	const parsedMinTotal = Number(input.minTotal);

	return {
		daysBack: Math.max(1, Math.min(Number(input.daysBack || 1) || 1, 90)),
		status: ['NEW', 'CONTACTED', 'ALL'].includes(normalizeString(input.status, 'ALL').toUpperCase())
			? normalizeString(input.status, 'ALL').toUpperCase()
			: 'ALL',
		limit: Math.max(1, Math.min(Number(input.limit || 100) || 100, 500)),
		minTotal:
			input.minTotal === '' || input.minTotal === null || input.minTotal === undefined
				? null
				: Number.isFinite(parsedMinTotal)
					? parsedMinTotal
					: null,
		productQuery: normalizeString(input.productQuery || ''),
	};
}

function getLocalParts(date, timezone) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(date);

	return parts.reduce((acc, part) => {
		if (part.type !== 'literal') acc[part.type] = Number(part.value);
		return acc;
	}, {});
}

function getTimezoneOffsetMs(date, timezone) {
	const parts = getLocalParts(date, timezone);
	const localAsUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second
	);

	return localAsUtc - date.getTime();
}

function zonedTimeToUtcDate({ year, month, day, hour, minute }, timezone) {
	let timestamp = Date.UTC(year, month - 1, day, hour, minute, 0);

	for (let index = 0; index < 2; index += 1) {
		const offset = getTimezoneOffsetMs(new Date(timestamp), timezone);
		timestamp = Date.UTC(year, month - 1, day, hour, minute, 0) - offset;
	}

	return new Date(timestamp);
}

function addLocalDays(parts, days) {
	const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
	return {
		year: next.getUTCFullYear(),
		month: next.getUTCMonth() + 1,
		day: next.getUTCDate(),
	};
}

export function getLocalRunKey(date = new Date(), timezone = DEFAULT_TIMEZONE) {
	const parts = getLocalParts(date, timezone || DEFAULT_TIMEZONE);
	return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function computeNextRunAt({
	timeOfDay = DEFAULT_TIME_OF_DAY,
	timezone = DEFAULT_TIMEZONE,
	from = new Date(),
	forceTomorrow = false,
} = {}) {
	const normalizedTime = normalizeTimeOfDay(timeOfDay);
	const [hour, minute] = normalizedTime.split(':').map(Number);
	const localNow = getLocalParts(from, timezone || DEFAULT_TIMEZONE);
	const targetDay = forceTomorrow ? addLocalDays(localNow, 1) : localNow;
	let candidate = zonedTimeToUtcDate({ ...targetDay, hour, minute }, timezone || DEFAULT_TIMEZONE);

	if (!forceTomorrow && candidate.getTime() <= from.getTime()) {
		candidate = zonedTimeToUtcDate({
			...addLocalDays(localNow, 1),
			hour,
			minute,
		}, timezone || DEFAULT_TIMEZONE);
	}

	return candidate;
}

function serializeSchedule(schedule) {
	if (!schedule) return null;

	return {
		...schedule,
		audienceFilters: schedule.audienceFilters || {},
		defaultComponents: safeArray(schedule.defaultComponents),
	};
}

async function resolveTemplate(workspaceId, templateId) {
	const template = await prisma.whatsAppTemplate.findFirst({
		where: {
			id: templateId,
			workspaceId,
			deletedAt: null,
		},
	});

	if (!template) {
		throw new Error('No se encontro el template seleccionado.');
	}

	return template;
}

function buildScheduleData(input = {}, template) {
	const timezone = normalizeString(input.timezone, DEFAULT_TIMEZONE);
	const timeOfDay = normalizeTimeOfDay(input.timeOfDay);
	const status = normalizeStatus(input.status);

	return {
		name: normalizeString(input.name, `Programacion ${template.name}`),
		templateLocalId: template.id,
		templateName: template.name,
		templateLanguage: template.language || 'es_AR',
		audienceSource: 'abandoned_carts',
		audienceFilters: normalizeFilters(input.audienceFilters || input.filters || {}),
		defaultComponents: safeArray(input.defaultComponents).length
			? input.defaultComponents
			: safeArray(template?.rawPayload?.components),
		notes: normalizeString(input.notes || '') || null,
		status,
		timeOfDay,
		timezone,
		nextRunAt:
			status === 'ACTIVE'
				? computeNextRunAt({ timeOfDay, timezone })
				: null,
	};
}

export async function listCampaignSchedules({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const schedules = await prisma.campaignSchedule.findMany({
		where: { workspaceId: resolvedWorkspaceId },
		orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }, { createdAt: 'desc' }],
	});

	return schedules.map(serializeSchedule);
}

export async function createCampaignSchedule({
	workspaceId = DEFAULT_WORKSPACE_ID,
	templateId,
	...input
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const template = await resolveTemplate(resolvedWorkspaceId, templateId);
	const data = buildScheduleData(input, template);

	const schedule = await prisma.campaignSchedule.create({
		data: {
			workspaceId: resolvedWorkspaceId,
			...data,
		},
	});

	return serializeSchedule(schedule);
}

export async function updateCampaignSchedule(scheduleId, {
	workspaceId = DEFAULT_WORKSPACE_ID,
	templateId = null,
	...input
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const current = await prisma.campaignSchedule.findFirst({
		where: { id: scheduleId, workspaceId: resolvedWorkspaceId },
	});

	if (!current) {
		throw new Error('No se encontro la programacion.');
	}

	const template = templateId
		? await resolveTemplate(resolvedWorkspaceId, templateId)
		: await resolveTemplate(resolvedWorkspaceId, current.templateLocalId);
	const data = buildScheduleData(
		{
			name: input.name ?? current.name,
			audienceFilters: input.audienceFilters ?? current.audienceFilters,
			defaultComponents: input.defaultComponents ?? current.defaultComponents,
			notes: input.notes ?? current.notes,
			status: input.status ?? current.status,
			timeOfDay: input.timeOfDay ?? current.timeOfDay,
			timezone: input.timezone ?? current.timezone,
		},
		template
	);

	const schedule = await prisma.campaignSchedule.update({
		where: { id: scheduleId },
		data,
	});

	return serializeSchedule(schedule);
}

export async function deleteCampaignSchedule(scheduleId, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const current = await prisma.campaignSchedule.findFirst({
		where: { id: scheduleId, workspaceId: resolvedWorkspaceId },
		select: { id: true },
	});

	if (!current) {
		throw new Error('No se encontro la programacion.');
	}

	await prisma.campaignSchedule.delete({ where: { id: scheduleId } });
	return { deleted: true };
}

export async function processDueCampaignSchedules({ limit = 5 } = {}) {
	const now = new Date();
	const schedules = await prisma.campaignSchedule.findMany({
		where: {
			status: 'ACTIVE',
			nextRunAt: { lte: now },
		},
		orderBy: { nextRunAt: 'asc' },
		take: Math.max(1, Math.min(Number(limit) || 5, 20)),
	});
	const results = [];

	for (const schedule of schedules) {
		const runKey = getLocalRunKey(schedule.nextRunAt || now, schedule.timezone || DEFAULT_TIMEZONE);
		const claimed = await prisma.campaignSchedule.updateMany({
			where: {
				id: schedule.id,
				status: 'ACTIVE',
				nextRunAt: { lte: now },
				OR: [{ lastRunKey: null }, { lastRunKey: { not: runKey } }],
			},
			data: {
				lastRunAt: now,
				lastRunKey: runKey,
				lastError: null,
			},
		});

		if (claimed.count === 0) continue;

		const nextRunAt = computeNextRunAt({
			timeOfDay: schedule.timeOfDay,
			timezone: schedule.timezone,
			from: now,
			forceTomorrow: true,
		});

		try {
			const created = await createCampaignDraft({
				workspaceId: schedule.workspaceId,
				name: `${schedule.name} ${runKey}`,
				templateId: schedule.templateLocalId,
				languageCode: schedule.templateLanguage,
				sendComponents: safeArray(schedule.defaultComponents),
				audienceSource: schedule.audienceSource || 'abandoned_carts',
				audienceFilters: schedule.audienceFilters || {},
				notes: schedule.notes || null,
				launchedByUserId: null,
			});
			const campaignId = created?.campaign?.id;

			if (campaignId) {
				await launchCampaign(campaignId, { workspaceId: schedule.workspaceId });
			}

			await prisma.campaignSchedule.update({
				where: { id: schedule.id },
				data: {
					nextRunAt,
					lastCampaignId: campaignId || null,
					lastError: null,
					runCount: { increment: 1 },
				},
			});

			results.push({ scheduleId: schedule.id, ok: true, campaignId });
		} catch (error) {
			await prisma.campaignSchedule.update({
				where: { id: schedule.id },
				data: {
					nextRunAt,
					lastError: error.message || 'Error ejecutando la programacion.',
				},
			});

			results.push({ scheduleId: schedule.id, ok: false, error: error.message });
		}
	}

	return {
		processed: results.length,
		results,
	};
}
