import { useMemo, useState } from 'react';
import { formatCampaignStatusLabel } from '../../utils/statusLabels.js';

function formatDate(value) {
	if (!value) return '--';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '--';
	return new Intl.DateTimeFormat('es-AR', {
		dateStyle: 'short',
		timeStyle: 'short',
	}).format(date);
}

function formatPercent(value) {
	const numeric = Math.min(1, Math.max(0, Number(value || 0)));
	return `${Math.ceil(numeric * 100)}%`;
}

function formatMoney(value, currency = 'ARS') {
	if (value === null || value === undefined || value === '') return '--';

	try {
		return new Intl.NumberFormat('es-AR', {
			style: 'currency',
			currency: currency || 'ARS',
			maximumFractionDigits: 0,
		}).format(Number(value));
	} catch {
		return `${value} ${currency || 'ARS'}`;
	}
}

function formatCompactNumber(value) {
	return new Intl.NumberFormat('es-AR').format(Number(value || 0));
}

function badgeClass(value = '') {
	return `campaign-badge ${String(value).toLowerCase()}`;
}

function getMetric(campaign = {}, keys = []) {
	for (const key of keys) {
		if (campaign?.[key] !== undefined && campaign?.[key] !== null) {
			return campaign[key];
		}
	}

	if (keys.includes('totalRecipients') && campaign?.pagination?.total !== undefined && campaign?.pagination?.total !== null) {
		return campaign.pagination.total;
	}

	return 0;
}

function hasProviderCode(failureDiagnostics = {}, expectedCode = '') {
	const normalizedExpected = String(expectedCode || '').replace(/\D+/g, '');
	if (!normalizedExpected) return false;

	const providerCodes = Array.isArray(failureDiagnostics.byProviderCode)
		? failureDiagnostics.byProviderCode
		: [];
	const examples = Array.isArray(failureDiagnostics.examples)
		? failureDiagnostics.examples
		: [];

	return [...providerCodes, ...examples].some((item) => (
		String(item?.code || item?.errorCode || '').replace(/\D+/g, '') === normalizedExpected
	));
}

function buildCampaignActionModel(campaign = {}) {
	const status = String(campaign?.status || '').toUpperCase();
	const failedCount = Number(campaign?.failedCount || campaign?.failedRecipients || 0);
	const pendingCount = Number(campaign?.pendingCount || campaign?.pendingRecipients || 0);
	const isAutomationRun = campaign?.kind === 'automation_run';

	if (['RUNNING', 'QUEUED'].includes(status)) {
		if (isAutomationRun) {
			return {
				primaryLabel: 'En curso',
				primaryDisabled: true,
				primaryAction: null,
				secondaryLabel: null,
				secondaryAction: null,
				helperText: 'La automatizacion diaria esta enviando los pendientes.',
			};
		}

		return {
			primaryLabel: 'En curso',
			primaryDisabled: true,
			primaryAction: null,
			secondaryLabel: 'Cancelar campaña',
			secondaryAction: isAutomationRun ? null : 'pause',
			helperText: 'La campaña ya está en ejecución o en cola. Solo podés cancelarla.',
		};
	}

	if (['FAILED', 'PARTIAL'].includes(status)) {
		return {
			primaryLabel: failedCount > 0 ? 'Reintentar fallidos' : 'Relanzar pendientes',
			primaryDisabled: failedCount === 0 && pendingCount === 0,
			primaryAction: 'resume',
			secondaryLabel: null,
			secondaryAction: null,
			helperText:
				failedCount > 0
					? 'La campaña tuvo destinatarios fallidos. Podés reintentar solo esos envíos.'
					: 'No hay destinatarios fallidos ni pendientes para volver a lanzar.',
		};
	}

	if (status === 'CANCELED') {
		return {
			primaryLabel: pendingCount > 0 || failedCount > 0 ? 'Relanzar pendientes' : 'Sin acciones',
			primaryDisabled: pendingCount === 0 && failedCount === 0,
			primaryAction: 'resume',
			secondaryLabel: null,
			secondaryAction: null,
			helperText:
				pendingCount > 0 || failedCount > 0
					? 'La campaña fue cancelada, pero todavía podés volver a intentar los pendientes.'
					: 'La campaña fue cancelada y ya no tiene destinatarios para relanzar.',
		};
	}

	if (status === 'FINISHED') {
		if (failedCount > 0 || pendingCount > 0) {
			return {
				primaryLabel: failedCount > 0 ? 'Reintentar fallidos' : 'Relanzar pendientes',
				primaryDisabled: false,
				primaryAction: 'resume',
				secondaryLabel: null,
				secondaryAction: null,
				helperText:
					failedCount > 0
						? `La campaña terminó, pero ${failedCount} destinatario${failedCount === 1 ? '' : 's'} fallaron. El reintento no toca los envíos aceptados.`
						: `La campaña terminó con ${pendingCount} destinatario${pendingCount === 1 ? '' : 's'} pendiente${pendingCount === 1 ? '' : 's'}.`,
			};
		}

		return {
			primaryLabel: 'Finalizada',
			primaryDisabled: true,
			primaryAction: null,
			secondaryLabel: null,
			secondaryAction: null,
			helperText: 'La campaña ya terminó. Si querés repetirla, conviene crear una nueva a partir de esta misma plantilla.',
		};
	}

	if (isAutomationRun) {
		return {
			primaryLabel: failedCount > 0 ? 'Reintentar fallidos' : 'Sin acciones',
			primaryDisabled: failedCount === 0,
			primaryAction: failedCount > 0 ? 'resume' : null,
			secondaryLabel: null,
			secondaryAction: null,
			helperText:
				failedCount > 0
					? 'La automatizacion tiene fallidos para reintentar sin tocar los omitidos.'
					: 'No hay fallidos pendientes en esta automatizacion diaria.',
		};
	}

	return {
		primaryLabel: 'Lanzar campaña',
		primaryDisabled: false,
		primaryAction: 'dispatch',
		secondaryLabel: null,
		secondaryAction: null,
		helperText: 'Esta campaña todavía está en borrador. Cuando la lances, empieza el despacho.',
	};
}

function normalizeRecipientStatus(status = '') {
	const normalized = String(status || '').trim().toUpperCase();

	if (['READ', 'SEEN'].includes(normalized)) return 'READ';
	if (['DELIVERED'].includes(normalized)) return 'DELIVERED';
	if (['SENT', 'DISPATCHED'].includes(normalized)) return 'SENT';
	if (['FAILED', 'ERROR'].includes(normalized)) return 'FAILED';
	if (['PENDING', 'QUEUED', 'NEW', 'CREATED'].includes(normalized)) return 'PENDING';

	return normalized || 'PENDING';
}

function formatRecipientStatus(status = '') {
	const normalized = normalizeRecipientStatus(status);
	if (normalized === 'READ') return 'Leido';
	if (normalized === 'DELIVERED') return 'Entregado';
	if (normalized === 'SENT') return 'Enviado';
	if (normalized === 'FAILED') return 'Fallido';
	if (normalized === 'SKIPPED') return 'Omitido';
	if (normalized === 'PENDING') return 'Pendiente';
	return normalized;
}

function formatRecipientErrorMessage(message = '') {
	const normalized = String(message || '').trim();
	const key = normalized.toLowerCase();

	const labels = {
		human_or_handoff_open: 'Omitido: conversacion abierta en atencion humana.',
		recent_support_context: 'Omitido: conversacion reciente de soporte.',
		campaign_cooldown_24h: 'Omitido: ya recibio una campana en las ultimas 24 h.',
		campaign_source_cooldown_7d: 'Omitido: ya recibio una campana de este tipo en los ultimos 7 dias.',
		opted_out: 'Omitido: contacto excluido de marketing.',
	};

	return labels[key] || normalized;
}

function buildRecipientMetrics(campaign = {}) {
	const recipients = Array.isArray(campaign?.allRecipients)
		? campaign.allRecipients
		: Array.isArray(campaign?.recipients)
			? campaign.recipients
			: [];
	const totalFromServer =
		Number(campaign?.pagination?.total) ||
		Number(campaign?.totalRecipients) ||
		Number(campaign?.recipientCount) ||
		0;

	if (totalFromServer > 0 && recipients.length < totalFromServer) {
		return {
			total: totalFromServer,
			sent: getMetric(campaign, ['sentCount']),
			delivered: getMetric(campaign, ['deliveredCount']),
			read: getMetric(campaign, ['readCount']),
			failed: getMetric(campaign, ['failedCount']),
			pending: getMetric(campaign, ['pendingCount']),
			skipped: getMetric(campaign, ['skippedCount', 'skippedRecipients']),
		};
	}

	if (!recipients.length) {
		return {
			total: getMetric(campaign, ['totalRecipients', 'recipientCount']),
			sent: getMetric(campaign, ['sentCount']),
			delivered: getMetric(campaign, ['deliveredCount']),
			read: getMetric(campaign, ['readCount']),
			failed: getMetric(campaign, ['failedCount']),
			pending: getMetric(campaign, ['pendingCount']),
			skipped: getMetric(campaign, ['skippedCount', 'skippedRecipients']),
		};
	}

	let sent = 0;
	let delivered = 0;
	let read = 0;
	let failed = 0;
	let pending = 0;
	let skipped = 0;

	for (const recipient of recipients) {
		const status = normalizeRecipientStatus(recipient?.status);

		if (status === 'READ') {
			read += 1;
			delivered += 1;
			sent += 1;
			continue;
		}

		if (status === 'DELIVERED') {
			delivered += 1;
			sent += 1;
			continue;
		}

		if (status === 'SENT') {
			sent += 1;
			continue;
		}

		if (status === 'FAILED') {
			failed += 1;
			continue;
		}

		if (status === 'SKIPPED') {
			skipped += 1;
			continue;
		}

		pending += 1;
	}

	return {
		total: recipients.length,
		sent,
		delivered,
		read,
		failed,
		pending,
		skipped,
	};
}

function recipientMatchesSearch(recipient = {}, search = '') {
	const normalizedSearch = String(search || '').trim().toLowerCase();
	if (!normalizedSearch) return true;

	const haystack = [
		recipient.contactName,
		recipient.name,
		recipient.phone,
		recipient.contactPhone,
		recipient.status,
		recipient.errorMessage,
		formatRecipientStatus(recipient.status),
		formatRecipientErrorMessage(recipient.errorMessage),
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	return haystack.includes(normalizedSearch);
}

function recipientMatchesPurchaseFilter(recipient = {}, filter = 'ALL') {
	const normalizedFilter = String(filter || 'ALL').toUpperCase();

	if (normalizedFilter === 'WITH_SIGNAL') return Boolean(recipient.conversionSignal);
	if (normalizedFilter === 'REAL_PURCHASE') return Boolean(recipient.purchaseDetected);
	if (normalizedFilter === 'CHAT_ONLY') {
		return Boolean(recipient.chatConfirmedPurchase) && !recipient.purchaseDetected;
	}
	if (normalizedFilter === 'NO_PURCHASE') return !recipient.conversionSignal;

	return true;
}

function formatPurchaseFilter(filter = 'ALL') {
	const normalized = String(filter || 'ALL').toUpperCase();
	if (normalized === 'WITH_SIGNAL') return 'con señal';
	if (normalized === 'REAL_PURCHASE') return 'compra real';
	if (normalized === 'CHAT_ONLY') return 'solo chat';
	if (normalized === 'NO_PURCHASE') return 'sin compra';
	return 'todas';
}

function formatConversionSource(source = '') {
	const normalized = String(source || '').toUpperCase();
	if (normalized === 'ABANDONED_CART') return 'Carritos';
	if (normalized === 'PENDING_PAYMENT') return 'Pagos pendientes';
	if (normalized === 'MARKETING') return 'Marketing';
	if (normalized === 'APP' || normalized === 'CHAT_CONFIRMATION') return 'App';
	return source || 'Sin fuente';
}

function buildConversionSourceItems(conversionsBySource = {}) {
	return Object.entries(conversionsBySource)
		.filter(([, count]) => Number(count || 0) > 0)
		.map(([source, count]) => ({
			source,
			label: formatConversionSource(source),
			count: Number(count || 0),
		}));
}

function formatBlockedReason(reason = '') {
	const normalized = String(reason || '').trim();
	if (normalized === 'campaign_dispatch_paused') return 'Campanas pausadas para la marca';
	if (normalized === 'whatsapp_outbound_paused') return 'Salientes de WhatsApp pausados';
	if (normalized === 'no_pending_or_failed_recipients') return 'Sin destinatarios pendientes o fallidos';
	return normalized || 'Sin detalle';
}

export default function CampaignRunsPanel({
	campaigns = [],
	selectedCampaign,
	onSelectCampaign,
	onDispatch,
	onPause,
	onResume,
	onDelete,
	actionLoading,
	deleteLoading,
	loading = false,
	tracking = {},
}) {
	const [retryConfirmationOpen, setRetryConfirmationOpen] = useState(false);
	const currentStatus = String(selectedCampaign?.status || '').toUpperCase();
	const selectedIsAutomationRun = selectedCampaign?.kind === 'automation_run';
	const canDelete = selectedCampaign && !selectedIsAutomationRun && !['RUNNING', 'QUEUED'].includes(currentStatus);
	const deleteBusy = Boolean(deleteLoading && selectedCampaign?.id);
	const actionModel = useMemo(
		() => buildCampaignActionModel(selectedCampaign || {}),
		[selectedCampaign]
	);

	const {
		statusFilter = 'ALL',
		setStatusFilter = () => {},
		purchaseFilter = 'ALL',
		setPurchaseFilter = () => {},
		search = '',
		setSearch = () => {},
		page = 1,
		setPage = () => {},
		pageSize = 24,
	} = tracking;

	const allRecipients = Array.isArray(selectedCampaign?.allRecipients)
		? selectedCampaign.allRecipients
		: Array.isArray(selectedCampaign?.recipients)
			? selectedCampaign.recipients
			: [];

	const recipientMetrics = useMemo(
		() => buildRecipientMetrics(selectedCampaign || {}),
		[selectedCampaign]
	);
	const analytics = selectedCampaign?.analytics || {};
	const diagnostics = selectedCampaign?.diagnostics || {};
	const failureDiagnostics = diagnostics.failures || {};
	const operationalControls = diagnostics.controls || {};
	const hasTemplateParameterMismatch = hasProviderCode(failureDiagnostics, '132000');
	const conversionSourceItems = buildConversionSourceItems(analytics.conversionsBySource || {});
	const retryableCount = recipientMetrics.failed + recipientMetrics.pending;

	const filteredRecipients = useMemo(() => {
		return allRecipients.filter((recipient) => {
			const normalizedStatus = normalizeRecipientStatus(recipient?.status);
			const passesStatus =
				statusFilter === 'ALL'
					? true
					: normalizedStatus === String(statusFilter).toUpperCase();

			return (
				passesStatus &&
				recipientMatchesPurchaseFilter(recipient, purchaseFilter) &&
				recipientMatchesSearch(recipient, search)
			);
		});
	}, [allRecipients, statusFilter, purchaseFilter, search]);

	const totalPages = Math.max(1, Math.ceil(filteredRecipients.length / pageSize));
	const safePage = Math.min(page, totalPages);

	const paginatedRecipients = filteredRecipients.slice(
		(safePage - 1) * pageSize,
		safePage * pageSize
	);

	function handleRetryDialogKeyDown(event) {
		if (event.key === 'Escape') {
			event.preventDefault();
			setRetryConfirmationOpen(false);
			return;
		}
		if (event.key !== 'Tab') return;

		const buttons = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled)'));
		if (buttons.length === 1) {
			event.preventDefault();
			buttons[0].focus();
			return;
		}
		if (buttons.length < 2) return;
		const firstButton = buttons[0];
		const lastButton = buttons[buttons.length - 1];
		if (event.shiftKey && document.activeElement === firstButton) {
			event.preventDefault();
			lastButton.focus();
		}
		if (!event.shiftKey && document.activeElement === lastButton) {
			event.preventDefault();
			firstButton.focus();
		}
	}

	return (
		<section className="campaign-panel campaign-panel--soft campaign-tracking-panel campaign-tracking-panel--focused">
			<div className="campaign-panel-header">
				<div>
					<h3>Seguimiento de envíos</h3>
					<p>
						Elegí una campaña, revisá lo que requiere atención y bajá al destinatario sólo si necesitás investigar.
					</p>
				</div>
			</div>

			{campaigns.length === 0 ? (
				<div className="campaign-empty-state campaign-tracking-empty-state">
					<strong>{loading ? 'Cargando historial...' : 'Todavia no hay historial visible.'}</strong>
					<p>
						{loading
							? 'Estamos buscando automatizaciones diarias y campanas enviadas.'
							: 'Las automatizaciones del dia y las campanas manuales van a aparecer aca, agrupadas y con sus resultados.'}
					</p>
				</div>
			) : (
			<div className="campaign-runs-grid campaign-runs-grid--balanced">
				<div className="campaign-detail-box campaign-detail-box--tracking campaign-detail-box--tracking-list">
					<div className="campaign-detail-header">
						<div>
							<h4>Historial</h4>
							<p>{campaigns.length} campaña{campaigns.length === 1 ? '' : 's'} disponible{campaigns.length === 1 ? '' : 's'}</p>
						</div>
					</div>

					<div className="campaign-list compact campaign-list--airy campaign-list--tracking">
						{campaigns.length === 0 ? (
							<div className="campaign-empty-state">
								<strong>Todavía no hay campañas.</strong>
								<p>Creá una y va a aparecer acá con sus métricas.</p>
							</div>
						) : (
							campaigns.map((campaign) => {
								const isSelected = selectedCampaign?.id === campaign.id;
								const listTotalRecipients = getMetric(campaign, ['totalRecipients', 'recipientCount']);
								const listSentRecipients = getMetric(campaign, ['sentRecipients', 'sentCount']);
								const listFailedRecipients = getMetric(campaign, ['failedRecipients', 'failedCount']);

								return (
									<button
										type="button"
										key={campaign.id}
										className={`campaign-list-card campaign-list-card--run${isSelected ? ' selected' : ''}`}
										onClick={() => onSelectCampaign(campaign)}
										aria-pressed={isSelected}
										aria-label={`Ver seguimiento de ${campaign.name}`}
									>
										<div className="campaign-list-card-top">
											<div>
												<strong>{campaign.name}</strong>
												<p>{campaign.templateName || campaign.template?.name || 'Sin plantilla asociada'}</p>
											</div>
											<span className={`campaign-run-state campaign-run-state--${String(campaign.status || 'draft').toLowerCase()}`}>
												{formatCampaignStatusLabel(campaign.status)}
											</span>
										</div>

										<div className="campaign-run-list-summary">
											<span><strong>{formatCompactNumber(listSentRecipients)}</strong> de {formatCompactNumber(listTotalRecipients)} enviados</span>
											<span className={listFailedRecipients ? 'has-error' : ''}>{listFailedRecipients ? `${listFailedRecipients} fallidos` : 'Sin fallos'}</span>
											<small>{formatDate(campaign.createdAt)}</small>
										</div>
									</button>
								);
							})
						)}
					</div>
				</div>

				<div className="campaign-detail-box campaign-detail-box--tracking campaign-detail-box--tracking-detail">
					{selectedCampaign ? (
						<>
							<div className="campaign-detail-header">
								<div>
									<h4>{selectedCampaign.name}</h4>
									<p>{selectedCampaign.description || selectedCampaign.notes || 'Sin descripcion.'}</p>
								</div>
								<span className={`campaign-run-state campaign-run-state--${String(selectedCampaign.status || 'draft').toLowerCase()}`}>
									{formatCampaignStatusLabel(selectedCampaign.status)}
								</span>
							</div>

							<div className="campaign-run-decision">
								<strong>Próxima acción</strong>
								<span>{hasTemplateParameterMismatch ? 'Meta rechazó las variables de esta plantilla. Corregilas y validalas antes de reintentar.' : actionModel.helperText}</span>
							</div>

							{operationalControls.blockedReasons?.length || failureDiagnostics.totalFailed ? (
								<details className={`campaign-safety-panel campaign-safety-panel--${operationalControls.riskLevel || 'notice'}`} open={Boolean(failureDiagnostics.totalFailed)}>
									<summary className="campaign-safety-panel__head">
										<span>
											<strong>Fallos y controles de seguridad</strong>
											<small>
												{failureDiagnostics.totalFailed
													? `${failureDiagnostics.totalFailed} destinatario(s) fallidos detectados.`
													: 'Sin fallidos registrados para esta campana.'}
											</small>
										</span>
										{failureDiagnostics.possiblePhoneNormalization ? (
											<b>{failureDiagnostics.possiblePhoneNormalization} posible(s) telefono mal normalizado</b>
										) : null}
									</summary>

									{operationalControls.blockedReasons?.length ? (
										<div className="campaign-safety-list">
											{operationalControls.blockedReasons.map((reason) => (
												<span key={reason}>{formatBlockedReason(reason)}</span>
											))}
										</div>
									) : null}

									{failureDiagnostics.byReason?.length ? (
										<div className="campaign-failure-reasons">
											{failureDiagnostics.byReason.map((item) => (
												<div key={item.key}>
													<strong>{item.count}</strong>
													<span>{item.label}</span>
													<small>{item.action}</small>
												</div>
											))}
										</div>
									) : null}

									{hasTemplateParameterMismatch ? (
										<div className="campaign-provider-warning" role="alert">
											<strong>Error Meta 132000: las variables no coinciden con la plantilla.</strong>
											<span>Revisá la cantidad y el orden de los parámetros renderizados. El reintento queda bloqueado hasta corregir el contenido.</span>
										</div>
									) : null}

									{failureDiagnostics.examples?.length ? (
										<div className="campaign-failure-examples">
											{failureDiagnostics.examples.slice(0, 3).map((item) => (
												<span key={item.id}>
													<strong>{item.contactName || item.phone || 'Destinatario'}</strong>
													<small>
														{item.reasonLabel}
														{item.errorCode ? ` · ${item.errorCode}` : ''}
														{item.normalizedPhone && item.normalizedPhone !== item.phone ? ` · sugerido ${item.normalizedPhone}` : ''}
													</small>
												</span>
											))}
										</div>
									) : null}
								</details>
							) : null}

							<div className="campaign-detail-actions campaign-detail-actions--spaced">
								{actionModel.primaryAction ? (
								<button
									className="button primary"
									onClick={() => {
									if (actionModel.primaryAction === 'dispatch') onDispatch(selectedCampaign.id);
									if (actionModel.primaryAction === 'resume') setRetryConfirmationOpen(true);
									}}
									disabled={actionLoading || actionModel.primaryDisabled}
								>
									{actionModel.primaryLabel}
								</button>
								) : null}

								{actionModel.secondaryAction === 'pause' ? (
									<button
										className="button secondary"
										onClick={() => onPause(selectedCampaign.id)}
										disabled={actionLoading}
									>
										{actionModel.secondaryLabel}
									</button>
								) : null}

								{!selectedIsAutomationRun ? (
								<button
									type="button"
									className="button danger"
									onClick={() => onDelete(selectedCampaign)}
									disabled={!canDelete || deleteBusy}
									title={
										canDelete
											? 'Eliminar campaña'
											: 'No se puede eliminar una campaña en cola o en ejecución'
									}
								>
									{deleteBusy ? 'Eliminando...' : 'Eliminar'}
								</button>
								) : null}
							</div>

							<div className="campaign-tracking-kpis campaign-tracking-kpis--essential" aria-label="Señales principales de la campaña">
								<div className="campaign-tracking-kpi">
									<span>Enviados</span>
									<strong>{recipientMetrics.sent}</strong>
									<small>de {recipientMetrics.total} destinatarios</small>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Entregados</span>
									<strong>{recipientMetrics.delivered}</strong>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Respondieron</span>
									<strong>{Number(analytics.repliedRecipients || 0)}</strong>
									<small>{formatPercent(analytics.replyRate || 0)}</small>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Compraron</span>
									<strong>{Number(analytics.purchasedRecipients || 0)}</strong>
									<small>{formatPercent(analytics.purchaseRate || 0)}</small>
								</div>
							</div>

							{recipientMetrics.failed || recipientMetrics.pending || recipientMetrics.skipped ? (
								<div className="campaign-run-exceptions" role="status">
									<strong>{recipientMetrics.failed} fallidos · {recipientMetrics.pending} pendientes</strong>
									<span>{recipientMetrics.skipped || 0} omitidos por exclusiones o contexto reciente.</span>
								</div>
							) : null}

							{conversionSourceItems.length ? (
								<div className="campaign-conversion-source-strip" aria-label="Conversiones por fuente">
									{conversionSourceItems.map((item) => (
										<span key={item.source}>
											<strong>{item.count}</strong>
											{item.label}
										</span>
									))}
								</div>
							) : null}

							<div className="campaign-tracking-toolbar">
								<div className="field">
									<span>Buscar destinatario</span>
									<input
										type="text"
										value={search}
										onChange={(event) => {
											setSearch(event.target.value);
											setPage(1);
										}}
										placeholder="Nombre, teléfono o estado"
									/>
								</div>

								<div className="field campaign-tracking-toolbar-select">
									<span>Filtrar por estado</span>
									<select
										value={statusFilter}
										onChange={(event) => {
											setStatusFilter(event.target.value);
											setPage(1);
										}}
									>
										<option value="ALL">Todos</option>
										<option value="PENDING">Pendientes</option>
										<option value="SENT">Enviados</option>
										<option value="DELIVERED">Entregados</option>
										<option value="READ">Leidos</option>
										<option value="FAILED">Fallidos</option>
										<option value="SKIPPED">Omitidos</option>
									</select>
								</div>

								<div className="field campaign-tracking-toolbar-select">
									<span>Filtrar por compra</span>
									<select
										value={purchaseFilter}
										onChange={(event) => {
											setPurchaseFilter(event.target.value);
											setPage(1);
										}}
									>
										<option value="ALL">Todas</option>
										<option value="WITH_SIGNAL">Con señal</option>
										<option value="REAL_PURCHASE">Compra real</option>
										<option value="CHAT_ONLY">Solo chat</option>
										<option value="NO_PURCHASE">Sin compra</option>
									</select>
								</div>
							</div>

							<div className="campaign-results-summary" aria-live="polite">
								<strong>{formatCompactNumber(filteredRecipients.length)}</strong>
								<span>
									destinatario{filteredRecipients.length === 1 ? '' : 's'} en la vista actual
									{statusFilter !== 'ALL' ? ` · filtro ${formatRecipientStatus(statusFilter)}` : ''}
									{purchaseFilter !== 'ALL' ? ` · ${formatPurchaseFilter(purchaseFilter)}` : ''}
									{search ? ' · búsqueda aplicada' : ''}
								</span>
							</div>

							<div className="campaign-recipient-table-wrapper campaign-recipient-table-wrapper--tracking">
								<table className="campaign-table" aria-label="Destinatarios y resultados de la campaña">
									<thead>
										<tr>
											<th>Destinatario</th>
											<th>Telefono</th>
											<th>Estado</th>
											<th>Interacción</th>
											<th>Compra detectada</th>
											<th>Ultima actualizacion</th>
										</tr>
									</thead>
									<tbody>
										{paginatedRecipients.length ? (
											paginatedRecipients.map((recipient) => (
												<tr key={recipient.id || recipient.phone}>
													<td data-label="Destinatario">{recipient.contactName || recipient.name || 'Sin nombre'}</td>
													<td data-label="Teléfono">{recipient.phone || recipient.contactPhone || '--'}</td>
													<td data-label="Estado">
														<span className={badgeClass(normalizeRecipientStatus(recipient.status))}>
															{formatRecipientStatus(recipient.status)}
														</span>
														{recipient.errorMessage ? (
															<div className="campaign-recipient-error">
																{recipient.errorCode ? `${recipient.errorCode}: ` : ''}{formatRecipientErrorMessage(recipient.errorMessage)}
															</div>
														) : null}
													</td>
													<td data-label="Interacción">
														<div className="campaign-recipient-meta">
															<span
																className={badgeClass(
																	recipient.hasReply
																		? 'read'
																		: recipient.effectiveRead
																			? 'delivered'
																			: 'pending'
																)}
															>
																{recipient.hasReply
																	? 'Respondio'
																	: recipient.effectiveRead
																		? 'Leido efectivo'
																		: 'Sin senal'}
															</span>
															<small>
																{recipient.firstReplyAt
																	? `Respuesta: ${formatDate(recipient.firstReplyAt)}`
																	: recipient.effectiveRead
																		? 'Leido por respuesta o check de lectura'
																		: 'Sin respuesta registrada'}
															</small>
														</div>
													</td>
													<td data-label="Compra detectada">
														<div className="campaign-recipient-meta">
															<span
																className={badgeClass(
																	recipient.conversionSignal ? 'approved' : 'pending'
																)}
															>
																{recipient.purchaseDetected
																	? 'Compra real'
																	: recipient.chatConfirmedPurchase
																		? 'Confirmo por chat'
																		: 'Sin compra'}
															</span>
															<small>
																{recipient.purchaseDetected
																	? `#${recipient.purchaseOrderNumber || recipient.purchaseOrderId || '--'} · ${formatMoney(
																			recipient.purchaseTotalAmount,
																			recipient.purchaseCurrency
																	  )}`
																	: recipient.chatConfirmedPurchase
																		? `Chat: ${recipient.chatConfirmedPurchaseBody || 'compra confirmada en conversacion'}`
																		: 'No hay pedido posterior al envio'}
															</small>
														</div>
													</td>
													<td data-label="Última actualización">
														{formatDate(
															recipient.readAt ||
															recipient.deliveredAt ||
															recipient.sentAt ||
															recipient.updatedAt ||
															recipient.createdAt
														)}
													</td>
												</tr>
											))
										) : (
											<tr>
												<td colSpan={6}>
													<div className="campaign-empty-state compact">
														<p>No hay destinatarios para ese filtro.</p>
													</div>
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>

							<div className="campaign-customer-pagination campaign-customer-pagination--tracking">
								<span>
									Mostrando {filteredRecipients.length === 0 ? 0 : (safePage - 1) * pageSize + 1}-
									{Math.min(safePage * pageSize, filteredRecipients.length)} de {filteredRecipients.length}
								</span>

								<div className="campaign-inline-actions campaign-inline-actions--wrap">
									<button
										type="button"
										className="button ghost"
										disabled={safePage <= 1}
										onClick={() => setPage((current) => Math.max(1, current - 1))}
									>
										Anterior
									</button>

									<button
										type="button"
										className="button ghost"
										disabled={safePage >= totalPages}
										onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
									>
										Siguiente
									</button>
								</div>
							</div>

							{retryConfirmationOpen ? (
								<div className="campaign-retry-backdrop" role="presentation">
					<div className="campaign-retry-dialog" role="dialog" aria-modal="true" aria-labelledby="campaign-retry-title" aria-describedby="campaign-retry-description" onKeyDown={handleRetryDialogKeyDown}>
										<h4 id="campaign-retry-title">Reintentar envíos sin duplicar</h4>
										<p id="campaign-retry-description">Se volverán a preparar hasta {retryableCount} destinatarios fallidos o pendientes. Los enviados no se tocan y las exclusiones, bajas y conversaciones recientes se controlan otra vez antes del envío.</p>
										{hasTemplateParameterMismatch ? (
											<div className="campaign-provider-warning" role="alert">
												<strong>No se puede reintentar todavía.</strong>
												<span>Meta devolvió 132000. Corregí y validá la cantidad y el orden de las variables de la plantilla; repetir ahora produciría el mismo fallo.</span>
											</div>
										) : null}
										<div className="campaign-retry-dialog__facts"><span><strong>{recipientMetrics.failed}</strong> fallidos</span><span><strong>{recipientMetrics.pending}</strong> pendientes</span><span><strong>{recipientMetrics.sent}</strong> ya enviados, protegidos</span></div>
										<div className="campaign-retry-dialog__actions">
							<button type="button" className="button secondary" autoFocus onClick={() => setRetryConfirmationOpen(false)}>Cancelar</button>
											<button type="button" className="button primary" disabled={actionLoading || retryableCount === 0 || hasTemplateParameterMismatch} onClick={() => { setRetryConfirmationOpen(false); onResume(selectedCampaign.id); }}>Confirmar reintento</button>
										</div>
									</div>
								</div>
							) : null}
						</>
					) : (
						<div className="campaign-empty-state">
							<strong>Elegí una campaña.</strong>
							<p>Acá vas a ver el detalle, los estados y las acciones disponibles.</p>
						</div>
					)}
				</div>
			</div>
			)}
		</section>
	);
}
