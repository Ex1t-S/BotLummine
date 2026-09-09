// A network error is not evidence that Meta rejected a message. Never send a
// second representation unless the provider explicitly rejected its structure.
export function canFallbackInteractiveMessage(result) {
	const status = Number(result?.httpStatus);
	const error = result?.error?.error || result?.error || {};
	return result?.ok === false
		&& status >= 400 && status < 500
		&& [100, 131008, 131009].includes(Number(error.code));
}

export function resolveAssistantHandoff({ output, audit, fallbackReason } = {}) {
	const needsHuman = output?.needsHuman === true || audit?.triggerHumanHandoff === true;
	return {
		needsHuman,
		handoffReason: needsHuman
			? String(output?.handoffReason || fallbackReason || 'ai_declared_handoff').trim() || 'ai_declared_handoff'
			: null,
	};
}

export function contextMessageLimit(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 1 ? Math.min(100, Math.floor(parsed)) : 12;
}
