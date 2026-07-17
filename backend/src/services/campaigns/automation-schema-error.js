const AUTOMATION_SCHEMA_ERROR_CODE = 'AUTOMATION_SCHEMA_NOT_READY';

function normalizeFeatureName(value) {
	const normalized = String(value || '').trim();
	return normalized.slice(0, 80) || 'solicitada';
}

export function createAutomationSchemaNotReadyError(feature, cause = null) {
	const error = new Error(
		`La automatizacion ${normalizeFeatureName(feature)} no esta disponible porque faltan migraciones de base de datos.`,
		cause ? { cause } : undefined,
	);
	error.code = AUTOMATION_SCHEMA_ERROR_CODE;
	error.statusCode = 503;
	return error;
}

export { AUTOMATION_SCHEMA_ERROR_CODE };
