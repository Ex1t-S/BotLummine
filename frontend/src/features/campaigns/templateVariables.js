export function validateTemplateBodyBoundaries(value = '') {
	const body = String(value || '').trim();
	if (/^\{\{\s*(?:\d+|[a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/.test(body) || /\{\{\s*(?:\d+|[a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/.test(body)) {
		return 'El cuerpo no puede empezar ni terminar con una variable. Agregá texto fijo antes y después; por ejemplo: Hola {{1}}, retomá tu compra en {{2}}. Si necesitás ayuda, respondé este mensaje.';
	}
	return '';
}
