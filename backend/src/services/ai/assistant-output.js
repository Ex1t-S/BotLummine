const MAX_REPLY_LENGTH = 12000;
const MAX_LIST_ITEMS = 20;

function invalidOutput(message) {
	const error = new Error(`Invalid output schema: ${message}`);
	error.code = 'AI_INVALID_OUTPUT';
	return error;
}

function normalizeList(values, fieldName) {
	if (values === undefined || values === null) return [];
	if (!Array.isArray(values)) throw invalidOutput(`${fieldName} must be an array`);
	return values
		.map((value) => String(value || '').trim().slice(0, 120))
		.filter(Boolean)
		.slice(0, MAX_LIST_ITEMS);
}

function normalizeConfidence(value) {
	const numeric = Number(value ?? 0);
	if (!Number.isFinite(numeric)) throw invalidOutput('confidence must be numeric');
	return Math.min(1, Math.max(0, numeric));
}

export function validateAssistantOutput(candidate = {}) {
	if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
		throw invalidOutput('candidate must be an object');
	}

	const reply = String(candidate.reply ?? '').trim();
	if (!reply) throw invalidOutput('reply is required');
	if (reply.length > MAX_REPLY_LENGTH) throw invalidOutput('reply exceeds the maximum length');

	const needsHuman = Boolean(candidate.needsHuman);
	const handoffReason = candidate.handoffReason === null || candidate.handoffReason === undefined
		? null
		: String(candidate.handoffReason).trim().slice(0, 120) || null;
	if (needsHuman && !handoffReason) {
		throw invalidOutput('handoffReason is required when needsHuman is true');
	}

	return Object.freeze({
		reply,
		needsHuman,
		handoffReason,
		detectedIntent: String(candidate.detectedIntent || 'UNKNOWN').trim().slice(0, 80) || 'UNKNOWN',
		confidence: normalizeConfidence(candidate.confidence),
		usedFacts: Object.freeze(normalizeList(candidate.usedFacts, 'usedFacts')),
		riskFlags: Object.freeze(normalizeList(candidate.riskFlags, 'riskFlags')),
	});
}

export function normalizeProviderOutput(result = {}) {
	return validateAssistantOutput({
		reply: result?.output?.reply ?? result?.text,
		needsHuman: result?.output?.needsHuman ?? false,
		handoffReason: result?.output?.handoffReason ?? null,
		detectedIntent: result?.output?.detectedIntent ?? 'UNKNOWN',
		confidence: result?.output?.confidence ?? 0,
		usedFacts: result?.output?.usedFacts ?? [],
		riskFlags: result?.output?.riskFlags ?? [],
	});
}
