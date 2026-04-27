import fs from 'node:fs/promises';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { resolveInboxMediaAbsolutePath } from '../whatsapp/whatsapp-media.service.js';

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
]);

function normalizeString(value = '') {
	return String(value || '').trim();
}

function normalizeMimeType(value = '') {
	return normalizeString(value).toLowerCase();
}

function extractJsonObject(text = '') {
	const value = normalizeString(text);
	if (!value) return null;

	try {
		return JSON.parse(value);
	} catch {
		const match = value.match(/\{[\s\S]*\}/);
		if (!match) return null;
		try {
			return JSON.parse(match[0]);
		} catch {
			return null;
		}
	}
}

function getStoredAttachmentFileName(rawPayload = null) {
	return normalizeString(
		rawPayload?.attachment?.storageFileName ||
			rawPayload?.attachmentStoredFileName ||
			''
	);
}

function buildPaymentProofPrompt() {
	return [
		'Analiza esta imagen recibida por WhatsApp.',
		'Decidi si parece ser un comprobante de pago, transferencia, Mercado Pago, ticket bancario o captura de pago.',
		'No confirmes que el pago sea valido: solo clasifica la imagen y extrae datos visibles.',
		'Responde solamente JSON valido con esta forma:',
		'{"isPaymentProof":boolean,"confidence":number,"reason":"string","paymentApp":"string|null","amount":"string|null","date":"string|null","senderName":"string|null","receiverName":"string|null","operationId":"string|null","visibleText":"string|null"}',
	].join('\n');
}

function normalizePaymentProofResponse({
	parsed = null,
	provider = null,
	model = null,
	raw = null,
} = {}) {
	if (!parsed) {
		return buildAnalysisResult({
			available: true,
			analyzed: true,
			reason: 'invalid_model_json',
			provider,
			model,
			raw,
		});
	}

	const confidence = Math.max(0, Math.min(1, Number(parsed.confidence || 0)));

	return buildAnalysisResult({
		available: true,
		analyzed: true,
		isPaymentProof: Boolean(parsed.isPaymentProof) && confidence >= 0.65,
		confidence,
		reason: parsed.reason,
		provider,
		model,
		fields: {
			paymentApp: parsed.paymentApp || null,
			amount: parsed.amount || null,
			date: parsed.date || null,
			senderName: parsed.senderName || null,
			receiverName: parsed.receiverName || null,
			operationId: parsed.operationId || null,
			visibleText: parsed.visibleText || null,
		},
		raw,
	});
}

async function analyzeWithGemini({ imageBuffer, mimeType }) {
	const apiKey = normalizeString(process.env.GEMINI_API_KEY || '');
	if (!apiKey) return null;

	const model = normalizeString(
		process.env.GEMINI_VISION_MODEL ||
			process.env.GEMINI_MODEL ||
			'gemini-2.5-flash-lite'
	);
	const ai = new GoogleGenAI({ apiKey });
	const response = await ai.models.generateContent({
		model,
		contents: [
			{
				inlineData: {
					mimeType,
					data: imageBuffer.toString('base64'),
				},
			},
			{ text: buildPaymentProofPrompt() },
		],
	});

	const outputText = response.text || '';
	return normalizePaymentProofResponse({
		parsed: extractJsonObject(outputText),
		provider: 'gemini',
		model,
		raw: {
			outputText,
			usage: response.usageMetadata || null,
		},
	});
}

async function analyzeWithOpenAI({ imageBuffer, mimeType }) {
	const apiKey = normalizeString(process.env.OPENAI_API_KEY || '');
	if (!apiKey) return null;

	const model = normalizeString(process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini');
	const client = new OpenAI({ apiKey });
	const response = await client.responses.create({
		model,
		input: [
			{
				role: 'user',
				content: [
					{
						type: 'input_text',
						text: buildPaymentProofPrompt(),
					},
					{
						type: 'input_image',
						image_url: `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
					},
				],
			},
		],
	});

	return normalizePaymentProofResponse({
		parsed: extractJsonObject(response.output_text || ''),
		provider: 'openai',
		model,
		raw: {
			outputText: response.output_text || '',
			usage: response.usage || null,
		},
	});
}

function isSupportedImage({ messageType = '', attachmentMeta = null, rawPayload = null } = {}) {
	const normalizedType = normalizeString(messageType).toLowerCase();
	const mimeType = normalizeMimeType(
		attachmentMeta?.attachmentMimeType ||
			rawPayload?.attachment?.mimeType ||
			rawPayload?.attachmentMimeType ||
			''
	);

	if (normalizedType !== 'image' && !mimeType.startsWith('image/')) {
		return false;
	}

	return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType);
}

function buildAnalysisResult({
	available = false,
	analyzed = false,
	isPaymentProof = false,
	confidence = 0,
	reason = '',
	provider = null,
	model = null,
	fields = {},
	raw = null,
	error = null,
} = {}) {
	return {
		available,
		analyzed,
		isPaymentProof: Boolean(isPaymentProof),
		confidence: Number(confidence || 0),
		reason: normalizeString(reason),
		provider,
		model,
		fields,
		raw,
		error,
	};
}

export async function analyzePaymentProofImage({
	messageType = 'text',
	attachmentMeta = null,
	rawPayload = null,
} = {}) {
	if (!isSupportedImage({ messageType, attachmentMeta, rawPayload })) {
		return buildAnalysisResult({ reason: 'attachment_not_supported_image' });
	}

	if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
		return buildAnalysisResult({ reason: 'missing_vision_api_key' });
	}

	const storedFileName = getStoredAttachmentFileName(rawPayload);
	if (!storedFileName) {
		return buildAnalysisResult({ available: true, reason: 'missing_stored_attachment' });
	}

	const mimeType = normalizeMimeType(
		attachmentMeta?.attachmentMimeType ||
			rawPayload?.attachment?.mimeType ||
			'image/jpeg'
	);

	try {
		const absolutePath = resolveInboxMediaAbsolutePath(storedFileName);
		const imageBuffer = await fs.readFile(absolutePath);
		const maxBytes = Number(process.env.PAYMENT_PROOF_VISION_MAX_BYTES || 7 * 1024 * 1024);

		if (imageBuffer.length > maxBytes) {
			return buildAnalysisResult({
				available: true,
				reason: 'image_too_large',
				error: `Image size ${imageBuffer.length} exceeds ${maxBytes}`,
			});
		}

		const preferredProvider = normalizeString(process.env.PAYMENT_PROOF_VISION_PROVIDER || 'gemini').toLowerCase();
		const analyzers = preferredProvider === 'openai'
			? [analyzeWithOpenAI, analyzeWithGemini]
			: [analyzeWithGemini, analyzeWithOpenAI];

		let lastError = null;
		for (const analyzer of analyzers) {
			try {
				const result = await analyzer({ imageBuffer, mimeType });
				if (result) return result;
			} catch (error) {
				lastError = error;
				console.error('[PAYMENT_PROOF_VISION][PROVIDER ERROR]', {
					error: error?.message || error,
				});
			}
		}

		return buildAnalysisResult({
			available: true,
			reason: 'vision_analysis_failed',
			error: lastError?.message || 'No se pudo analizar la imagen con ningun proveedor.',
		});
	} catch (error) {
		console.error('[PAYMENT_PROOF_VISION][ERROR]', {
			message: error?.message || error,
			storedFileName,
		});

		return buildAnalysisResult({
			available: true,
			reason: 'vision_analysis_failed',
			error: error?.message || 'No se pudo analizar la imagen.',
		});
	}
}
