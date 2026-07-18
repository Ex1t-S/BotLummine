const GENERIC_STATUS_LABELS = {
	ACTIVE: 'Activo',
	INACTIVE: 'Inactivo',
	SUSPENDED: 'Suspendido',
	ARCHIVED: 'Archivado',
	DISABLED: 'Desactivado',
	ERROR: 'Con errores',
	PENDING: 'Pendiente',
	PAUSED: 'Pausado',
	RUNNING: 'En curso',
	QUEUED: 'En cola',
	FINISHED: 'Finalizado',
	COMPLETED: 'Finalizado',
	DRAFT: 'Borrador',
	FAILED: 'Con errores',
	PARTIAL: 'Parcial',
	CANCELED: 'Cancelado',
	CANCELLED: 'Cancelado',
	REJECTED: 'Rechazado',
	APPROVED: 'Aprobado',
	SENT: 'Enviado',
	DELIVERED: 'Entregado',
	READ: 'Leído',
	NEW: 'Nuevo',
};

const TEMPLATE_STATUS_LABELS = {
	APPROVED: 'Aprobada',
	PENDING: 'Pendiente',
	PAUSED: 'Pausada',
	REJECTED: 'Rechazada',
	DRAFT: 'Borrador',
	DISABLED: 'Desactivada',
};

const CAMPAIGN_STATUS_LABELS = {
	...GENERIC_STATUS_LABELS,
	ACTIVE: 'En curso',
	PAUSED: 'Pausada',
	FINISHED: 'Finalizada',
	COMPLETED: 'Finalizada',
	FAILED: 'Con errores',
	CANCELED: 'Cancelada',
	CANCELLED: 'Cancelada',
	SENT: 'Enviada',
};

const TEMPLATE_CATEGORY_LABELS = {
	MARKETING: 'Promocional',
	UTILITY: 'Informativa',
	AUTHENTICATION: 'Autenticación',
};

const HEADER_FORMAT_LABELS = {
	TEXT: 'Texto',
	IMAGE: 'Imagen',
	VIDEO: 'Video',
	DOCUMENT: 'Documento',
	NONE: 'Sin encabezado',
};

function normalize(value) {
	return String(value || '').trim().toUpperCase();
}

function readableFallback(value, fallback) {
	const normalized = normalize(value);
	if (!normalized) return fallback;
	return normalized
		.toLowerCase()
		.split('_')
		.filter(Boolean)
		.map((part, index) => index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
		.join(' ');
}

export function formatStatusLabel(value, fallback = 'Sin estado') {
	return GENERIC_STATUS_LABELS[normalize(value)] || readableFallback(value, fallback);
}

export function formatCampaignStatusLabel(value, fallback = 'Borrador') {
	return CAMPAIGN_STATUS_LABELS[normalize(value)] || readableFallback(value, fallback);
}

export function formatTemplateStatusLabel(value, fallback = 'Borrador') {
	return TEMPLATE_STATUS_LABELS[normalize(value)] || readableFallback(value, fallback);
}

export function formatTemplateCategoryLabel(value, fallback = 'Promocional') {
	return TEMPLATE_CATEGORY_LABELS[normalize(value)] || readableFallback(value, fallback);
}

export function formatHeaderFormatLabel(value, fallback = 'Sin encabezado') {
	return HEADER_FORMAT_LABELS[normalize(value)] || readableFallback(value, fallback);
}
