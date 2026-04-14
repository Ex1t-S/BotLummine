import { useMemo } from 'react';

function formatDate(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return new Intl.DateTimeFormat('es-AR', {
		dateStyle: 'short',
		timeStyle: 'short',
	}).format(date);
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

function getStatusTone(status = '') {
	const normalized = String(status || '').toUpperCase();

	if (['RUNNING', 'QUEUED', 'ACTIVE'].includes(normalized)) return 'En marcha';
	if (['PAUSED', 'CANCELED'].includes(normalized)) return 'Detenida';
	if (['PARTIAL'].includes(normalized)) return 'Parcial';
	if (['FAILED'].includes(normalized)) return 'Con fallos';
	if (['COMPLETED', 'SENT', 'FINISHED'].includes(normalized)) return 'Finalizada';

	return 'Borrador';
}

function buildCampaignActionModel(campaign = {}) {
	const status = String(campaign?.status || '').toUpperCase();
	const failedCount = Number(campaign?.failedCount || campaign?.failedRecipients || 0);
	const pendingCount = Number(campaign?.pendingCount || campaign?.pendingRecipients || 0);

	if (['RUNNING', 'QUEUED'].includes(status)) {
		return {
			primaryLabel: 'En curso',
			primaryDisabled: true,
			primaryAction: null,
			secondaryLabel: 'Cancelar campaÃ±a',
			secondaryAction: 'pause',
			helperText: 'La campaÃ±a ya estÃ¡ en ejecuciÃ³n o en cola. Solo podÃ©s cancelarla.',
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
					? 'La campaÃ±a tuvo fallidos. PodÃ©s reintentar solo esos destinatarios.'
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
					? 'La campaÃ±a fue cancelada, pero todavÃ­a podÃ©s volver a intentar los pendientes.'
					: 'La campaÃ±a fue cancelada y ya no tiene destinatarios para relanzar.',
		};
	}

	if (status === 'FINISHED') {
		return {
			primaryLabel: 'Finalizada',
			primaryDisabled: true,
			primaryAction: null,
			secondaryLabel: null,
			secondaryAction: null,
			helperText: 'La campaÃ±a ya terminÃ³. Si querÃ©s repetirla, conviene crear una nueva a partir de este mismo template.',
		};
	}

	return {
		primaryLabel: 'Lanzar campaÃ±a',
		primaryDisabled: false,
		primaryAction: 'dispatch',
		secondaryLabel: null,
		secondaryAction: null,
		helperText: 'Esta campaÃ±a todavÃ­a estÃ¡ en borrador. Cuando la lances, empieza el despacho.',
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

function buildRecipientMetrics(campaign = {}) {
	const recipients = Array.isArray(campaign?.allRecipients)
		? campaign.allRecipients
		: Array.isArray(campaign?.recipients)
			? campaign.recipients
			: [];

	if (!recipients.length) {
		return {
			total: getMetric(campaign, ['totalRecipients', 'recipientCount']),
			sent: getMetric(campaign, ['sentCount']),
			delivered: getMetric(campaign, ['deliveredCount']),
			read: getMetric(campaign, ['readCount']),
			failed: getMetric(campaign, ['failedCount']),
			pending: getMetric(campaign, ['pendingCount']),
		};
	}

	let sent = 0;
	let delivered = 0;
	let read = 0;
	let failed = 0;
	let pending = 0;

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

		pending += 1;
	}

	return {
		total: recipients.length,
		sent,
		delivered,
		read,
		failed,
		pending,
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
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	return haystack.includes(normalizedSearch);
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
	tracking = {},
}) {
	const currentStatus = String(selectedCampaign?.status || '').toUpperCase();
	const canDelete = selectedCampaign && !['RUNNING', 'QUEUED'].includes(currentStatus);
	const deleteBusy = Boolean(deleteLoading && selectedCampaign?.id);
	const actionModel = useMemo(
		() => buildCampaignActionModel(selectedCampaign || {}),
		[selectedCampaign]
	);

	const totalCampaignRecipients = campaigns.reduce(
		(total, campaign) => total + Number(getMetric(campaign, ['totalRecipients', 'recipientCount'])),
		0
	);

	const {
		statusFilter = 'ALL',
		setStatusFilter = () => {},
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

	const filteredRecipients = useMemo(() => {
		return allRecipients.filter((recipient) => {
			const normalizedStatus = normalizeRecipientStatus(recipient?.status);
			const passesStatus =
				statusFilter === 'ALL'
					? true
					: normalizedStatus === String(statusFilter).toUpperCase();

			return passesStatus && recipientMatchesSearch(recipient, search);
		});
	}, [allRecipients, statusFilter, search]);

	const totalPages = Math.max(1, Math.ceil(filteredRecipients.length / pageSize));
	const safePage = Math.min(page, totalPages);

	const paginatedRecipients = filteredRecipients.slice(
		(safePage - 1) * pageSize,
		safePage * pageSize
	);

	return (
		<section className="campaign-panel campaign-panel--soft campaign-tracking-panel">
			<div className="campaign-panel-header">
				<div>
					<h3>Historial y tracking de campañas</h3>
					<p>
						Seguí borradores, campañas activas y resultados desde una vista más clara,
						con tracking real de envíos, entregas y lecturas.
					</p>
				</div>
			</div>

			<div className="campaign-inline-summary">
				<div className="campaign-inline-summary-item">
					<strong>{campaigns.length}</strong>
					<span>campañas registradas</span>
				</div>
				<div className="campaign-inline-summary-item">
					<strong>{totalCampaignRecipients}</strong>
					<span>destinatarios sumados</span>
				</div>
				<div className="campaign-inline-summary-item">
					<strong>{selectedCampaign ? getStatusTone(selectedCampaign.status) : '—'}</strong>
					<span>estado actual seleccionado</span>
				</div>
			</div>

			<div className="campaign-runs-grid campaign-runs-grid--balanced">
				<div className="campaign-list compact campaign-list--airy">
					{campaigns.length === 0 ? (
						<div className="campaign-empty-state">
							<strong>Todavía no hay campañas.</strong>
							<p>Creá una y te va a aparecer acá con sus métricas.</p>
						</div>
					) : (
						campaigns.map((campaign) => {
							const isSelected = selectedCampaign?.id === campaign.id;
							const listMetrics = buildRecipientMetrics(campaign);

							return (
								<article
									key={campaign.id}
									className={`campaign-list-card campaign-list-card--run${isSelected ? ' selected' : ''}`}
									onClick={() => onSelectCampaign(campaign)}
									role="button"
									tabIndex={0}
									onKeyDown={(event) => {
										if (event.key === 'Enter' || event.key === ' ') {
											event.preventDefault();
											onSelectCampaign(campaign);
										}
									}}
								>
									<div className="campaign-list-card-top">
										<div>
											<strong>{campaign.name}</strong>
											<p>{campaign.templateName || campaign.template?.name || 'Sin template asociado'}</p>
										</div>
										<span className={badgeClass(campaign.status)}>
											{campaign.status || 'DRAFT'}
										</span>
									</div>

									<div className="campaign-inline-stats campaign-inline-stats--stack-mobile">
										<span>{listMetrics.total} destinatarios</span>
										<span>{getStatusTone(campaign.status)}</span>
										<span>Creada {formatDate(campaign.createdAt)}</span>
									</div>
								</article>
							);
						})
					)}
				</div>

				<div className="campaign-detail-box campaign-detail-box--elevated campaign-detail-box--tracking">
					{selectedCampaign ? (
						<>
							<div className="campaign-detail-header">
								<div>
									<h4>{selectedCampaign.name}</h4>
									<p>{selectedCampaign.description || selectedCampaign.notes || 'Sin descripción.'}</p>
								</div>
								<span className={badgeClass(selectedCampaign.status)}>
									{selectedCampaign.status || 'DRAFT'}
								</span>
							</div>

							<div className="campaign-detail-meta-grid">
								<div className="campaign-detail-meta-card">
									<span>Template</span>
									<strong>
										{selectedCampaign.templateName || selectedCampaign.template?.name || 'Sin template'}
									</strong>
								</div>
								<div className="campaign-detail-meta-card">
									<span>Destinatarios</span>
									<strong>{recipientMetrics.total}</strong>
								</div>
								<div className="campaign-detail-meta-card">
									<span>Creación</span>
									<strong>{formatDate(selectedCampaign.createdAt)}</strong>
								</div>
								<div className="campaign-detail-meta-card">
									<span>AcciÃ³n sugerida</span>
									<strong>{actionModel.primaryLabel}</strong>
								</div>
							</div>

							<div className="campaign-helper-box">
								<div className="campaign-helper-text">{actionModel.helperText}</div>
							</div>

							<div className="campaign-detail-actions campaign-detail-actions--spaced">
								<button
									className="button primary"
									onClick={() => {
										if (actionModel.primaryAction === 'dispatch') onDispatch(selectedCampaign.id);
										if (actionModel.primaryAction === 'resume') onResume(selectedCampaign.id);
									}}
									disabled={actionLoading || actionModel.primaryDisabled}
								>
									{actionModel.primaryLabel}
								</button>

								{actionModel.secondaryAction === 'pause' ? (
									<button
										className="button secondary"
										onClick={() => onPause(selectedCampaign.id)}
										disabled={actionLoading}
									>
										{actionModel.secondaryLabel}
									</button>
								) : null}

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
									{deleteBusy ? 'Eliminando…' : 'Eliminar'}
								</button>
							</div>

							<div className="campaign-tracking-kpis">
								<div className="campaign-tracking-kpi">
									<span>Total</span>
									<strong>{recipientMetrics.total}</strong>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Enviados</span>
									<strong>{recipientMetrics.sent}</strong>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Entregados</span>
									<strong>{recipientMetrics.delivered}</strong>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Leídos</span>
									<strong>{recipientMetrics.read}</strong>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Fallidos</span>
									<strong>{recipientMetrics.failed}</strong>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Pendientes</span>
									<strong>{recipientMetrics.pending}</strong>
								</div>
							</div>

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
										<option value="READ">Leídos</option>
										<option value="FAILED">Fallidos</option>
									</select>
								</div>
							</div>

							<div className="campaign-recipient-table-wrapper campaign-recipient-table-wrapper--tracking">
								<table className="campaign-table">
									<thead>
										<tr>
											<th>Destinatario</th>
											<th>Teléfono</th>
											<th>Estado</th>
											<th>Última actualización</th>
										</tr>
									</thead>
									<tbody>
										{paginatedRecipients.length ? (
											paginatedRecipients.map((recipient) => (
												<tr key={recipient.id || recipient.phone}>
													<td>{recipient.contactName || recipient.name || 'Sin nombre'}</td>
													<td>{recipient.phone || recipient.contactPhone || '—'}</td>
													<td>
														<span className={badgeClass(normalizeRecipientStatus(recipient.status))}>
															{normalizeRecipientStatus(recipient.status)}
														</span>
													</td>
													<td>
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
												<td colSpan={4}>
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
									Mostrando {filteredRecipients.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
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
						</>
					) : (
						<div className="campaign-empty-state">
							<strong>Elegí una campaña.</strong>
							<p>Acá vas a ver el detalle, los estados y las acciones disponibles.</p>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
