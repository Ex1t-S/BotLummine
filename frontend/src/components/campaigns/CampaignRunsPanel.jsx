import { useMemo } from 'react';

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
	const numeric = Number(value || 0);
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

function calculateCampaignCost(sentCount = 0) {
	return Number(sentCount || 0) * 0.06;
}

function formatUsdCost(value = 0) {
	try {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(Number(value || 0));
	} catch {
		return `USD ${Number(value || 0).toFixed(2)}`;
	}
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
			secondaryLabel: 'Cancelar campana',
			secondaryAction: 'pause',
			helperText: 'La campana ya esta en ejecucion o en cola. Solo podes cancelarla.',
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
					? 'La campana tuvo fallidos. Podes reintentar solo esos destinatarios.'
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
					? 'La campana fue cancelada, pero todavia podes volver a intentar los pendientes.'
					: 'La campana fue cancelada y ya no tiene destinatarios para relanzar.',
		};
	}

	if (status === 'FINISHED') {
		return {
			primaryLabel: 'Finalizada',
			primaryDisabled: true,
			primaryAction: null,
			secondaryLabel: null,
			secondaryAction: null,
			helperText: 'La campana ya termino. Si queres repetirla, conviene crear una nueva a partir de este mismo template.',
		};
	}

	return {
		primaryLabel: 'Lanzar campana',
		primaryDisabled: false,
		primaryAction: 'dispatch',
		secondaryLabel: null,
		secondaryAction: null,
		helperText: 'Esta campana todavia esta en borrador. Cuando la lances, empieza el despacho.',
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
	const analytics = selectedCampaign?.analytics || {};
	const campaignCost = calculateCampaignCost(recipientMetrics.sent);

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
					<h3>Historial y tracking de campanas</h3>
					<p>
						Segui borradores, campanas activas y resultados desde una vista mas clara,
						con tracking real de envios, entregas y lecturas.
					</p>
				</div>
			</div>

			<div className="campaign-runs-grid campaign-runs-grid--balanced">
				<div className="campaign-detail-box campaign-detail-box--elevated campaign-detail-box--tracking campaign-detail-box--tracking-list">
					<div className="campaign-detail-header">
						<div>
								<h4>Campanas cargadas</h4>
								<p>Elegi una campana para revisar su tracking y sus destinatarios.</p>
						</div>
					</div>

					<div className="campaign-list compact campaign-list--airy campaign-list--tracking">
						{campaigns.length === 0 ? (
							<div className="campaign-empty-state">
								<strong>Todavia no hay campanas.</strong>
								<p>Crea una y te va a aparecer aca con sus metricas.</p>
							</div>
						) : (
							campaigns.map((campaign) => {
								const isSelected = selectedCampaign?.id === campaign.id;
								const listMetrics = buildRecipientMetrics(campaign);
								const campaignAnalytics = campaign?.analytics || {};
								const listCost = calculateCampaignCost(listMetrics.sent);

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

										<div className="campaign-inline-stats campaign-inline-stats--stack-mobile campaign-inline-stats--analytics">
											<span>Respondieron {Number(campaignAnalytics.repliedRecipients || 0)}</span>
											<span>Lectura efectiva {Number(campaignAnalytics.effectiveReadRecipients || 0)}</span>
											<span>Compraron {Number(campaignAnalytics.conversionSignalRecipients || campaignAnalytics.purchasedRecipients || 0)}</span>
											<span>Costo {formatUsdCost(listCost)}</span>
										</div>
									</article>
								);
							})
						)}
					</div>
				</div>

				<div className="campaign-detail-box campaign-detail-box--elevated campaign-detail-box--tracking campaign-detail-box--tracking-detail">
					{selectedCampaign ? (
						<>
							<div className="campaign-detail-header">
								<div>
									<h4>{selectedCampaign.name}</h4>
									<p>{selectedCampaign.description || selectedCampaign.notes || 'Sin descripcion.'}</p>
								</div>
								<span className={badgeClass(selectedCampaign.status)}>
									{selectedCampaign.status || 'DRAFT'}
								</span>
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
											? 'Eliminar campana'
											: 'No se puede eliminar una campana en cola o en ejecucion'
									}
								>
									{deleteBusy ? 'Eliminando...' : 'Eliminar'}
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
									<span>Leidos</span>
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
								<div className="campaign-tracking-kpi">
									<span>Respondieron</span>
									<strong>{Number(analytics.repliedRecipients || 0)}</strong>
									<small>{formatPercent(analytics.replyRate || 0)}</small>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Lectura efectiva</span>
									<strong>{Number(analytics.effectiveReadRecipients || 0)}</strong>
									<small>{formatPercent(analytics.effectiveReadRate || 0)}</small>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Compraron</span>
									<strong>{Number(analytics.purchasedRecipients || 0)}</strong>
									<small>{formatPercent(analytics.purchaseRate || 0)}</small>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Compra por chat</span>
									<strong>{Number(analytics.chatConfirmedPurchaseRecipients || 0)}</strong>
									<small>{formatPercent(analytics.chatConfirmedPurchaseRate || 0)}</small>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Conversion total</span>
									<strong>{Number(analytics.conversionSignalRecipients || 0)}</strong>
									<small>{formatPercent(analytics.conversionSignalRate || 0)}</small>
								</div>
								<div className="campaign-tracking-kpi">
									<span>Costo</span>
									<strong>{formatUsdCost(campaignCost)}</strong>
									<small>{recipientMetrics.sent} enviados x USD 0.06</small>
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
										placeholder="Nombre, telefono o estado"
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
									</select>
								</div>
							</div>

							<div className="campaign-recipient-table-wrapper campaign-recipient-table-wrapper--tracking">
								<table className="campaign-table">
									<thead>
										<tr>
											<th>Destinatario</th>
											<th>Telefono</th>
											<th>Estado</th>
											<th>Interaccion</th>
											<th>Compra detectada</th>
											<th>Ultima actualizacion</th>
										</tr>
									</thead>
									<tbody>
										{paginatedRecipients.length ? (
											paginatedRecipients.map((recipient) => (
												<tr key={recipient.id || recipient.phone}>
													<td>{recipient.contactName || recipient.name || 'Sin nombre'}</td>
													<td>{recipient.phone || recipient.contactPhone || '--'}</td>
													<td>
														<span className={badgeClass(normalizeRecipientStatus(recipient.status))}>
															{normalizeRecipientStatus(recipient.status)}
														</span>
													</td>
													<td>
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
													<td>
														<div className="campaign-recipient-meta">
															<span
																className={badgeClass(
																	recipient.conversionSignal ? 'approved' : 'pending'
																)}
															>
																{recipient.conversionSignal ? 'Compro / confirmo' : 'Sin compra'}
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
						</>
					) : (
						<div className="campaign-empty-state">
							<strong>Elegi una campana.</strong>
							<p>Aca vas a ver el detalle, los estados y las acciones disponibles.</p>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
