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
			secondaryLabel: 'Cancelar campaña',
			secondaryAction: 'pause',
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
		return {
			primaryLabel: 'Finalizada',
			primaryDisabled: true,
			primaryAction: null,
			secondaryLabel: null,
			secondaryAction: null,
			helperText: 'La campaña ya terminó. Si querés repetirla, conviene crear una nueva a partir de este mismo template.',
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
	if (normalized === 'CHAT_CONFIRMATION') return 'Chat';
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
	const campaignCost = calculateCampaignCost(recipientMetrics.sent);
	const attributedRevenue = Number(analytics.attributedRevenue || 0);
	const attributedCurrency = analytics.attributedCurrency || 'ARS';
	const conversionSourceItems = buildConversionSourceItems(analytics.conversionsBySource || {});

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

			<div className="campaign-runs-grid campaign-runs-grid--balanced">
				<div className="campaign-detail-box campaign-detail-box--elevated campaign-detail-box--tracking campaign-detail-box--tracking-list">
					<div className="campaign-detail-header">
						<div>
								<h4>Campañas cargadas</h4>
								<p>Elegí una campaña para revisar su tracking y sus destinatarios.</p>
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
								const campaignAnalytics = campaign?.analytics || {};
								const listTotalRecipients = getMetric(campaign, ['totalRecipients', 'recipientCount']);
								const listSentRecipients = getMetric(campaign, ['sentRecipients', 'sentCount']);
								const listCost = calculateCampaignCost(listSentRecipients);

								return (
									<button
										type="button"
										key={campaign.id}
										className={`campaign-list-card campaign-list-card--run${isSelected ? ' selected' : ''}`}
										onClick={() => onSelectCampaign(campaign)}
										aria-pressed={isSelected}
										aria-label={`Ver tracking de ${campaign.name}`}
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
											<span>{listTotalRecipients} destinatarios</span>
											<span>{getStatusTone(campaign.status)}</span>
											<span>Creada {formatDate(campaign.createdAt)}</span>
										</div>

										<div className="campaign-inline-stats campaign-inline-stats--stack-mobile campaign-inline-stats--analytics">
											<span>Respondieron {Number(campaignAnalytics.repliedRecipients || 0)}</span>
											<span>Lectura efectiva {Number(campaignAnalytics.effectiveReadRecipients || 0)}</span>
											<span>Señales {Number(campaignAnalytics.conversionSignalRecipients || campaignAnalytics.purchasedRecipients || 0)}</span>
											<span>Costo {formatUsdCost(listCost)}</span>
										</div>
									</button>
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
											? 'Eliminar campaña'
											: 'No se puede eliminar una campaña en cola o en ejecución'
									}
								>
									{deleteBusy ? 'Eliminando...' : 'Eliminar'}
								</button>
							</div>

							<div className="campaign-tracking-kpis">
								<div className="campaign-tracking-kpi campaign-tracking-kpi--featured">
									<span>Señales de compra</span>
									<strong>{Number(analytics.conversionSignalRecipients || 0)}</strong>
									<small>{formatPercent(analytics.conversionSignalRate || 0)} con pedido o chat</small>
								</div>
								<div className="campaign-tracking-kpi campaign-tracking-kpi--featured">
									<span>Facturación atribuida</span>
									<strong>{formatMoney(attributedRevenue, attributedCurrency)}</strong>
									<small>Solo pedidos reales atribuidos</small>
								</div>
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
									<span>Costo</span>
									<strong>{formatUsdCost(campaignCost)}</strong>
									<small>{recipientMetrics.sent} enviados x USD 0.06</small>
								</div>
							</div>

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
									{statusFilter !== 'ALL' ? ` · filtro ${statusFilter}` : ''}
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
															{normalizeRecipientStatus(recipient.status)}
														</span>
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
