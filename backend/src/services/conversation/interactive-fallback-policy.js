const INTERACTIVE_PAYLOAD_ERROR_CODES = new Set(['131009']);

export function shouldFallbackInteractiveToText(sendResult = {}) {
	if (sendResult?.ok || Number(sendResult?.httpStatus) !== 400) return false;

	const error = sendResult?.error || {};
	const code = String(error.code || error.error_code || '');
	if (INTERACTIVE_PAYLOAD_ERROR_CODES.has(code)) return true;

	const message = String(error.message || error.error_user_msg || '').toLowerCase();
	return code === '100' && /interactive|list|button|parameter|invalid.*(field|type|value)/.test(message);
}
