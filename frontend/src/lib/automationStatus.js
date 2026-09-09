export function automationStatus({ settings, failed = false, loading = false, runtime }) {
	if (failed || !settings || typeof settings.enabled !== 'boolean') return { label: loading ? 'Verificando' : 'Sin verificar', tone: 'neutral' };
	if (!settings.enabled) return { label: 'Sin envíos', tone: 'neutral' };
	if (!runtime || typeof runtime.outboundEnabled !== 'boolean' || typeof runtime.automationEnabled !== 'boolean') return { label: 'Envíos sin verificar', tone: 'neutral' };
	if (!runtime.outboundEnabled || !runtime.automationEnabled) return { label: 'Pausada por el equipo', tone: 'warning' };
	if (runtime.channelConfigured === false) return { label: 'Sin canal configurado', tone: 'danger' };
	if (settings.lastError) return { label: 'Requiere revisión', tone: 'danger' };
	if (runtime.quietHoursPaused) return { label: 'Esperando horario', tone: 'neutral' };
	if (!settings.lastRunAt) return { label: 'Sin ejecuciones registradas', tone: 'warning' };
	return { label: 'Habilitada para ejecutar', tone: 'info' };
}

export function runtimePresentation(data) {
	if (!data || typeof data.outboundEnabled !== 'boolean' || typeof data.autoRepliesEnabled !== 'boolean') return { title: 'Estado de envíos sin verificar', detail: 'No se pudo confirmar si los envíos están habilitados.', tone: 'neutral' };
	if (!data.outboundEnabled) return { title: 'Envíos pausados por el equipo', detail: 'La pausa de salidas no desactiva la recepción de mensajes.', tone: 'warning' };
	if (!data.autoRepliesEnabled) return { title: 'Respuestas automáticas pausadas', detail: 'La asignación a IA no habilita los envíos automáticos.', tone: 'warning' };
	return { title: 'Permisos de envío habilitados', detail: 'Cada conversación conserva su control humano. Esto no confirma la conexión con Meta.', tone: 'info' };
}

export function contactWindowLabel(runtime) {
	const window = runtime?.quietHours;
	if (!window || !Number.isInteger(window.startHour) || !Number.isInteger(window.endHour)) return 'Horario sin verificar';
	if (window.startHour === window.endHour) return `Sin pausa horaria · ${window.timezone}`;
	const hour = value => `${String(value).padStart(2, '0')}:00`;
	return `Pausa de ${hour(window.startHour)} a ${hour(window.endHour)} · ${window.timezone}`;
}

export function conversationAutomationLabel(conversation, runtime) {
	if (!conversation?.aiEnabled || (conversation.queue && conversation.queue !== 'AUTO')) return 'Equipo humano';
	if (!runtime || typeof runtime.outboundEnabled !== 'boolean' || typeof runtime.autoRepliesEnabled !== 'boolean') return 'IA · permisos sin verificar';
	if (!runtime.outboundEnabled || !runtime.autoRepliesEnabled) return 'IA · envíos pausados';
	return 'Asignada a IA';
}
