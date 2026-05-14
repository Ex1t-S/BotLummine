import { readFile } from 'node:fs/promises';

import { runGeminiContent } from '../ai/gemini.service.js';
import { resolveInboxMediaAbsolutePath } from '../whatsapp/whatsapp-media.service.js';
import { logger, maskPhone } from '../../lib/logger.js';

const SUPPORTED_MIME_RE = /^(image\/(png|jpe?g|webp)|application\/pdf)$/i;
const MAX_CLASSIFICATION_BYTES = Number(process.env.AI_ATTACHMENT_CLASSIFIER_MAX_BYTES || 8 * 1024 * 1024);

function createPartFromBase64(data, mimeType) {
	return {
		inlineData: {
			mimeType,
			data,
		},
	};
}

function normalizeString(value = '') {
	return String(value || '').trim();
}

function normalizeKind(value = '') {
	const kind = normalizeString(value).toLowerCase();
	return [
		'payment_proof',
		'return_evidence',
		'shipping_label',
		'product_photo',
		'unclear',
		'other',
	].includes(kind)
		? kind
		: 'unclear';
}

function safeConfidence(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 0;
	return Math.max(0, Math.min(parsed, 1));
}

function getAttachmentMeta({ rawPayload = null, attachmentMeta = null } = {}) {
	const payloadAttachment = rawPayload?.attachment || {};
	return {
		mimeType: normalizeString(
			attachmentMeta?.attachmentMimeType ||
				payloadAttachment.mimeType ||
				rawPayload?.attachmentMimeType ||
				''
		),
		storageFileName: normalizeString(
			attachmentMeta?.attachmentStoredFileName ||
				attachmentMeta?.storedFileName ||
				payloadAttachment.storageFileName ||
				payloadAttachment.storedFileName ||
				''
		),
		name: normalizeString(
			attachmentMeta?.attachmentName ||
				payloadAttachment.name ||
				rawPayload?.attachmentName ||
				''
		),
		size: Number(
			attachmentMeta?.attachmentSize ||
				payloadAttachment.size ||
				rawPayload?.attachmentSize ||
				0
		),
	};
}

function buildClassifierPrompt({
	messageBody = '',
	currentState = {},
	recentMessages = [],
	mimeType = '',
	fileName = '',
}) {
	const recentText = recentMessages
		.slice(-6)
		.map((message) => `${message.role === 'assistant' ? 'IA' : 'Cliente'}: ${message.text || ''}`)
		.join('\n')
		.slice(-1800);

	return [
		'Clasifica el adjunto de una conversacion de WhatsApp de ecommerce.',
		'Responde SOLO JSON valido con: kind, confidence, reason.',
		'kind debe ser uno de: payment_proof, return_evidence, shipping_label, product_photo, unclear, other.',
		'payment_proof: comprobante/ticket/transferencia/mercadopago/pago bancario.',
		'return_evidence: foto de producto fallado/equivocado, talle, etiqueta o evidencia para cambio/devolucion.',
		'shipping_label: etiqueta, guia, seguimiento o documento logistico.',
		'No extraigas ni repitas datos sensibles como alias, CBU, DNI, montos, tarjetas o numeros completos.',
		`Mime: ${mimeType || 'desconocido'}. Archivo: ${fileName || 'sin nombre'}.`,
		`Estado: lastIntent=${currentState?.lastIntent || ''}; handoffReason=${currentState?.handoffReason || ''}; lastUserGoal=${currentState?.lastUserGoal || ''}.`,
		`Mensaje actual: ${messageBody || ''}`,
		recentText ? `Contexto reciente:\n${recentText}` : '',
	].filter(Boolean).join('\n');
}

function parseClassifierJson(text = '') {
	const raw = normalizeString(text);
	if (!raw) return null;

	const jsonText = raw.startsWith('{')
		? raw
		: raw.match(/\{[\s\S]*\}/)?.[0] || '';
	if (!jsonText) return null;

	const parsed = JSON.parse(jsonText);
	return {
		kind: normalizeKind(parsed.kind),
		confidence: safeConfidence(parsed.confidence),
		reason: normalizeString(parsed.reason).slice(0, 180),
	};
}

export async function classifyInboundAttachment({
	messageType = 'text',
	messageBody = '',
	rawPayload = null,
	attachmentMeta = null,
	currentState = {},
	recentMessages = [],
	waId = '',
} = {}) {
	if (rawPayload?.aiLabAttachmentClassification) {
		return {
			kind: normalizeKind(rawPayload.aiLabAttachmentClassification.kind),
			confidence: safeConfidence(rawPayload.aiLabAttachmentClassification.confidence),
			reason: normalizeString(rawPayload.aiLabAttachmentClassification.reason || 'ai_lab_fixture').slice(0, 180),
			source: 'ai-lab-attachment-classifier',
		};
	}

	const type = normalizeString(messageType).toLowerCase();
	if (!['image', 'document'].includes(type)) {
		return null;
	}

	const meta = getAttachmentMeta({ rawPayload, attachmentMeta });
	if (!meta.mimeType || !SUPPORTED_MIME_RE.test(meta.mimeType)) {
		return {
			kind: 'unclear',
			confidence: 0,
			reason: 'unsupported_attachment_type',
			source: 'attachment-classifier',
			skipped: true,
		};
	}

	if (!meta.storageFileName) {
		return {
			kind: 'unclear',
			confidence: 0,
			reason: 'missing_local_attachment',
			source: 'attachment-classifier',
			skipped: true,
		};
	}

	if (meta.size && meta.size > MAX_CLASSIFICATION_BYTES) {
		return {
			kind: 'unclear',
			confidence: 0,
			reason: 'attachment_too_large',
			source: 'attachment-classifier',
			skipped: true,
		};
	}

	try {
		const absolutePath = resolveInboxMediaAbsolutePath(meta.storageFileName);
		const buffer = await readFile(absolutePath);
		if (buffer.length > MAX_CLASSIFICATION_BYTES) {
			return {
				kind: 'unclear',
				confidence: 0,
				reason: 'attachment_too_large',
				source: 'attachment-classifier',
				skipped: true,
			};
		}

		const prompt = buildClassifierPrompt({
			messageBody,
			currentState,
			recentMessages,
			mimeType: meta.mimeType,
			fileName: meta.name,
		});

		const result = await runGeminiContent([
			{ text: prompt },
			createPartFromBase64(buffer.toString('base64'), meta.mimeType),
		], {
			model: process.env.GEMINI_ATTACHMENT_CLASSIFIER_MODEL ||
				process.env.GEMINI_MODEL ||
				'gemini-2.5-flash-lite',
			config: {
				temperature: 0,
				responseMimeType: 'application/json',
			},
		});

		const parsed = parseClassifierJson(result.text);
		if (!parsed) {
			return {
				kind: 'unclear',
				confidence: 0,
				reason: 'invalid_classifier_json',
				source: 'gemini-attachment-classifier',
				rawText: normalizeString(result.text).slice(0, 180),
			};
		}

		return {
			...parsed,
			source: 'gemini-attachment-classifier',
			model: result.model,
			usage: result.usage,
		};
	} catch (error) {
		logger.warn('ai.attachment_classifier_failed', {
			messageType: type,
			mimeType: meta.mimeType,
			fileName: meta.name || null,
			waId: maskPhone(waId || ''),
			error: error?.message || error,
		});

		return {
			kind: 'unclear',
			confidence: 0,
			reason: 'classifier_failed',
			source: 'gemini-attachment-classifier',
			error: error?.message || String(error || ''),
		};
	}
}

export function attachmentClassificationLooksLikePayment(classification = null) {
	return classification?.kind === 'payment_proof' && Number(classification.confidence || 0) >= 0.72;
}

export function attachmentClassificationLooksLikeReturnEvidence(classification = null) {
	return classification?.kind === 'return_evidence' && Number(classification.confidence || 0) >= 0.65;
}
