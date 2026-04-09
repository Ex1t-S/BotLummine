import { prisma } from '../../lib/prisma.js';
import {
	graphDelete,
	graphGet,
	graphPost,
	getWhatsAppBusinessAccountId
} from './meta-graph.service.js';

const TEMPLATE_FIELDS = [
	'id',
	'name',
	'language',
	'status',
	'category',
	'quality_score',
	'components',
	'parameter_format'
].join(',');

function normalizeString(value, fallback = '') {
	const normalized = String(value ?? '').trim();

	return normalized || fallback;
}

function toUpperValue(value, fallback = '') {
	return normalizeString(value, fallback).toUpperCase();
}

function cleanJson(value, fallback = null) {
	if (value === undefined) {
		return fallback;
	}

	return value;
}

function ensureTemplateName(name) {
	const normalized = normalizeString(name);

	if (!normalized) {
		throw new Error('El nombre de la plantilla es obligatorio.');
	}

	return normalized.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function ensureTemplateLanguage(language) {
	const normalized = normalizeString(language, 'es_AR');

	if (!normalized) {
		throw new Error('El idioma de la plantilla es obligatorio.');
	}

	return normalized;
}

function ensureTemplateCategory(category) {
	const normalized = toUpperValue(category);

	if (!['AUTHENTICATION', 'MARKETING', 'UTILITY'].includes(normalized)) {
		throw new Error('La categoría debe ser AUTHENTICATION, MARKETING o UTILITY.');
	}

	return normalized;
}

function ensureParameterFormat(parameterFormat) {
	const normalized = toUpperValue(parameterFormat || 'POSITIONAL', 'POSITIONAL');

	if (!['POSITIONAL', 'NAMED'].includes(normalized)) {
		throw new Error('parameterFormat debe ser POSITIONAL o NAMED.');
	}

	return normalized;
}

function ensureComponents(components = []) {
	if (!Array.isArray(components) || !components.length) {
		throw new Error('La plantilla debe tener al menos un componente.');
	}

	const normalized = components.map((component) => ({
		...component,
		type: toUpperValue(component?.type)
	}));

	const bodyCount = normalized.filter((component) => component.type === 'BODY').length;

	if (bodyCount !== 1) {
		throw new Error('La plantilla debe tener exactamente un componente BODY.');
	}

	return normalized;
}

function extractHeaderFormat(components = []) {
	const header = components.find((component) => toUpperValue(component?.type) === 'HEADER');

	if (!header) {
		return null;
	}

	return normalizeString(header.format || header.type || null) || null;
}

function extractTextFromButtons(buttons = []) {
	return buttons
		.map((button) => {
			const type = toUpperValue(button?.type);
			const text = normalizeString(button?.text || button?.url || button?.phone_number || '');

			return text ? `[${type}] ${text}` : '';
		})
		.filter(Boolean);
}

function buildTemplatePreviewText(components = []) {
	const lines = [];

	for (const component of components) {
		const type = toUpperValue(component?.type);

		if (type === 'HEADER' && component?.text) {
			lines.push(`HEADER: ${component.text}`);
		}

		if (type === 'BODY' && component?.text) {
			lines.push(component.text);
		}

		if (type === 'FOOTER' && component?.text) {
			lines.push(`FOOTER: ${component.text}`);
		}

		if (type === 'BUTTONS' && Array.isArray(component?.buttons)) {
			lines.push(...extractTextFromButtons(component.buttons));
		}
	}

	return lines.join('\n').trim() || null;
}

function applyTokens(text = '', variables = {}) {
	return String(text || '').replace(/{{\s*([^}]+?)\s*}}/g, (_match, rawKey) => {
		const key = String(rawKey || '').trim();

		if (Object.prototype.hasOwnProperty.call(variables, key)) {
			return String(variables[key] ?? '');
		}

		return `{{${key}}}`;
	});
}

function deepPersonalize(value, variables = {}) {
	if (Array.isArray(value)) {
		return value.map((item) => deepPersonalize(item, variables));
	}

	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, childValue]) => [key, deepPersonalize(childValue, variables)])
		);
	}

	if (typeof value === 'string') {
		return applyTokens(value, variables);
	}

	return value;
}

function localTemplateWhere(metaOrLocalId) {
	return {
		OR: [
			{ id: String(metaOrLocalId) },
			{ metaTemplateId: String(metaOrLocalId) }
		]
	};
}

function buildTemplateUpsertPayload(metaTemplate, rawPayloadOverride = null) {
	const components = Array.isArray(metaTemplate?.components)
		? metaTemplate.components
		: Array.isArray(rawPayloadOverride?.components)
			? rawPayloadOverride.components
			: [];

	return {
		wabaId: getWhatsAppBusinessAccountId(),
		metaTemplateId: metaTemplate?.id ? String(metaTemplate.id) : null,
		name: ensureTemplateName(metaTemplate?.name || rawPayloadOverride?.name || ''),
		language: ensureTemplateLanguage(metaTemplate?.language || rawPayloadOverride?.language || 'es_AR'),
		category: ensureTemplateCategory(metaTemplate?.category || rawPayloadOverride?.category || 'UTILITY'),
		status: normalizeString(metaTemplate?.status || rawPayloadOverride?.status || 'IN_REVIEW'),
		qualityScore: normalizeString(metaTemplate?.quality_score || metaTemplate?.qualityScore || '') || null,
		headerFormat: extractHeaderFormat(components),
		parameterFormat: normalizeString(
			metaTemplate?.parameter_format || rawPayloadOverride?.parameter_format || ''
		) || null,
		previewText: buildTemplatePreviewText(components),
		rejectedReason: normalizeString(metaTemplate?.rejected_reason || '') || null,
		disabledReason: normalizeString(metaTemplate?.disabled_reason || '') || null,
		lastSyncedAt: new Date(),
		rawPayload: cleanJson(rawPayloadOverride || metaTemplate)
	};
}

export function renderTemplatePreviewFromComponents(components = [], variables = {}) {
	const safeComponents = Array.isArray(components) ? components : [];
	const personalized = deepPersonalize(safeComponents, variables);

	return {
		components: personalized,
		previewText: buildTemplatePreviewText(personalized)
	};
}

export async function upsertLocalTemplate(metaTemplate, rawPayloadOverride = null) {
	const payload = buildTemplateUpsertPayload(metaTemplate, rawPayloadOverride);

	return prisma.whatsAppTemplate.upsert({
		where: {
			wabaId_name_language: {
				wabaId: payload.wabaId,
				name: payload.name,
				language: payload.language
			}
		},
		update: payload,
		create: payload
	});
}

export async function listLocalTemplates({
	q = '',
	status = '',
	category = '',
	language = '',
	includeDeleted = false,
	limit = 100
} = {}) {
	const where = {
		deletedAt: includeDeleted ? undefined : null,
		status: status ? normalizeString(status).toUpperCase() : undefined,
		category: category ? normalizeString(category).toUpperCase() : undefined,
		language: language ? normalizeString(language) : undefined,
		OR: q
			? [
				{ name: { contains: q, mode: 'insensitive' } },
				{ previewText: { contains: q, mode: 'insensitive' } }
			]
			: undefined
	};

	return prisma.whatsAppTemplate.findMany({
		where,
		orderBy: [
			{ updatedAt: 'desc' },
			{ name: 'asc' }
		],
		take: Math.max(1, Math.min(Number(limit) || 100, 250))
	});
}

export async function getTemplateOrThrow(templateId) {
	const template = await prisma.whatsAppTemplate.findFirst({
		where: localTemplateWhere(templateId)
	});

	if (!template) {
		throw new Error('No se encontró la plantilla solicitada.');
	}

	return template;
}

export async function syncTemplatesFromMeta({
	pageLimit = 10,
	pageSize = 100
} = {}) {
	const syncLog = await prisma.templateSyncLog.create({
		data: {
			status: 'RUNNING'
		}
	});

	let after = null;
	let page = 0;
	let fetchedCount = 0;
	let upsertedCount = 0;
	let errorCount = 0;
	const pages = [];

	try {
		while (page < pageLimit) {
			const response = await graphGet(`/${getWhatsAppBusinessAccountId()}/message_templates`, {
				params: {
					limit: Math.max(1, Math.min(Number(pageSize) || 100, 250)),
					fields: TEMPLATE_FIELDS,
					after
				}
			});

			const batch = Array.isArray(response?.data) ? response.data : [];
			pages.push(response);
			fetchedCount += batch.length;

			for (const item of batch) {
				await upsertLocalTemplate(item);
				upsertedCount += 1;
			}

			after = response?.paging?.cursors?.after || null;
			page += 1;

			if (!after || !batch.length) {
				break;
			}
		}

		await prisma.templateSyncLog.update({
			where: { id: syncLog.id },
			data: {
				status: 'FINISHED',
				finishedAt: new Date(),
				fetchedCount,
				upsertedCount,
				errorCount,
				rawPayload: {
					pagesFetched: page,
					lastAfter: after
				}
			}
		});

		return {
			fetchedCount,
			upsertedCount,
			errorCount
		};
	} catch (error) {
		errorCount += 1;

		await prisma.templateSyncLog.update({
			where: { id: syncLog.id },
			data: {
				status: 'FAILED',
				finishedAt: new Date(),
				fetchedCount,
				upsertedCount,
				errorCount,
				message: error.message,
				rawPayload: {
					pages
				}
			}
		});

		throw error;
	}
}

export async function createTemplate({
	name,
	category,
	language = 'es_AR',
	parameterFormat = 'POSITIONAL',
	components = []
}) {
	const normalizedParameterFormat = ensureParameterFormat(parameterFormat);

	const payload = {
		name: ensureTemplateName(name),
		category: ensureTemplateCategory(category),
		language: ensureTemplateLanguage(language),
		parameter_format: normalizedParameterFormat,
		components: ensureComponents(components)
	};

	const response = await graphPost(`/${getWhatsAppBusinessAccountId()}/message_templates`, payload);
	const localTemplate = await upsertLocalTemplate(
		{
			id: response?.id || null,
			name: payload.name,
			language: payload.language,
			category: response?.category || payload.category,
			status: response?.status || 'IN_REVIEW',
			parameter_format: normalizedParameterFormat,
			components: payload.components
		},
		{
			...payload,
			...response
		}
	);

	return {
		response,
		template: localTemplate
	};
}

export async function updateTemplate(templateId, {
	category,
	parameterFormat,
	components = []
}) {
	const localTemplate = await getTemplateOrThrow(templateId);

	if (!localTemplate.metaTemplateId) {
		throw new Error('La plantilla local no tiene metaTemplateId para editar en Meta.');
	}

	const normalizedParameterFormat = ensureParameterFormat(
		parameterFormat ||
			localTemplate.parameterFormat ||
			localTemplate.rawPayload?.parameter_format ||
			'POSITIONAL'
	);

	const payload = {
		category: ensureTemplateCategory(category || localTemplate.category),
		parameter_format: normalizedParameterFormat,
		components: ensureComponents(components)
	};

	const response = await graphPost(`/${localTemplate.metaTemplateId}`, payload);
	const updatedTemplate = await upsertLocalTemplate(
		{
			id: localTemplate.metaTemplateId,
			name: localTemplate.name,
			language: localTemplate.language,
			category: response?.category || payload.category,
			status: response?.status || 'IN_REVIEW',
			parameter_format: normalizedParameterFormat,
			components: payload.components
		},
		{
			...(localTemplate.rawPayload || {}),
			...payload,
			...response,
			name: localTemplate.name,
			language: localTemplate.language
		}
	);

	return {
		response,
		template: updatedTemplate
	};
}

export async function deleteTemplate(templateId, { deleteAllLanguages = false } = {}) {
	const localTemplate = await getTemplateOrThrow(templateId);

	const deletePayload = deleteAllLanguages
		? {
			name: localTemplate.name
		}
		: {
			name: localTemplate.name,
			hsm_id: localTemplate.metaTemplateId
		};

	const response = await graphDelete(`/${getWhatsAppBusinessAccountId()}/message_templates`, {
		data: deletePayload
	});

	if (deleteAllLanguages) {
		await prisma.whatsAppTemplate.updateMany({
			where: {
				wabaId: localTemplate.wabaId,
				name: localTemplate.name
			},
			data: {
				status: 'DELETED',
				deletedAt: new Date(),
				lastSyncedAt: new Date()
			}
		});
	} else {
		await prisma.whatsAppTemplate.update({
			where: { id: localTemplate.id },
			data: {
				status: 'DELETED',
				deletedAt: new Date(),
				lastSyncedAt: new Date()
			}
		});
	}

	return {
		response,
		templateId: localTemplate.id,
		name: localTemplate.name,
		deleteAllLanguages
	};
}

export async function applyTemplateStatusWebhook(payload = {}) {
	const metaTemplateId = normalizeString(
		payload?.message_template_id ||
		payload?.template_id ||
		payload?.id ||
		''
	);

	if (!metaTemplateId) {
		return null;
	}

	const template = await prisma.whatsAppTemplate.findFirst({
		where: {
			metaTemplateId
		}
	});

	if (!template) {
		return null;
	}

	return prisma.whatsAppTemplate.update({
		where: { id: template.id },
		data: {
			status: normalizeString(payload?.event || payload?.status || template.status),
			rejectedReason: normalizeString(payload?.reason || payload?.rejected_reason || '') || template.rejectedReason,
			lastSyncedAt: new Date(),
			rawPayload: payload
		}
	});
}

export async function applyTemplateQualityWebhook(payload = {}) {
	const metaTemplateId = normalizeString(
		payload?.message_template_id ||
		payload?.template_id ||
		payload?.id ||
		''
	);

	if (!metaTemplateId) {
		return null;
	}

	const template = await prisma.whatsAppTemplate.findFirst({
		where: {
			metaTemplateId
		}
	});

	if (!template) {
		return null;
	}

	return prisma.whatsAppTemplate.update({
		where: { id: template.id },
		data: {
			qualityScore: normalizeString(payload?.new_quality_score || payload?.quality_score || '') || template.qualityScore,
			lastSyncedAt: new Date(),
			rawPayload: payload
		}
	});
}

export async function applyTemplateCategoryWebhook(payload = {}) {
	const metaTemplateId = normalizeString(
		payload?.message_template_id ||
		payload?.template_id ||
		payload?.id ||
		''
	);

	if (!metaTemplateId) {
		return null;
	}

	const template = await prisma.whatsAppTemplate.findFirst({
		where: {
			metaTemplateId
		}
	});

	if (!template) {
		return null;
	}

	return prisma.whatsAppTemplate.update({
		where: { id: template.id },
		data: {
			category: ensureTemplateCategory(payload?.new_category || payload?.category || template.category),
			lastSyncedAt: new Date(),
			rawPayload: payload
		}
	});
}

export async function applyTemplateComponentsWebhook(payload = {}) {
	const metaTemplateId = normalizeString(
		payload?.message_template_id ||
		payload?.template_id ||
		payload?.id ||
		''
	);

	if (!metaTemplateId) {
		return null;
	}

	const template = await prisma.whatsAppTemplate.findFirst({
		where: {
			metaTemplateId
		}
	});

	if (!template) {
		return null;
	}

	const components = Array.isArray(payload?.components)
		? payload.components
		: Array.isArray(template?.rawPayload?.components)
			? template.rawPayload.components
			: [];

	return prisma.whatsAppTemplate.update({
		where: { id: template.id },
		data: {
			headerFormat: extractHeaderFormat(components),
			previewText: buildTemplatePreviewText(components),
			lastSyncedAt: new Date(),
			rawPayload: {
				...(template.rawPayload || {}),
				...payload,
				components
			}
		}
	});
}