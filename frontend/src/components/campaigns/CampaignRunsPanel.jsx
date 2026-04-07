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

	return 0;
}

function getStatusTone(status = '') {
	const normalized = String(status || '').toUpperCase();
	if (['RUNNING', 'QUEUED', 'ACTIVE'].includes(normalized)) return 'En marcha';
	if (['PAUSED'].includes(normalized)) return 'Pausada';
	if (['COMPLETED', 'SENT'].includes(normalized)) return 'Finalizada';
	return 'Borrador';
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
}) {
	const recipients = selectedCampaign?.recipients || [];
	const currentStatus = String(selectedCampaign?.status || '').toUpperCase();
	const canDelete = selectedCampaign && !['RUNNING', 'QUEUED'].includes(currentStatus);
	const deleteBusy = Boolean(deleteLoading && selectedCampaign?.id);
	const totalCampaignRecipients = campaigns.reduce(
		(total, campaign) => total + Number(getMetric(campaign, ['totalRecipients', 'recipientCount'])),
		0
	);

	return (
		<section className="campaign-panel campaign-panel--soft">
			<div className="campaign-panel-header">
				<div>
					<h3>Historial de campañas</h3>
					<p>
						Seguí borradores, campañas activas y resultados desde una vista más fácil de leer
						para operación diaria.
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
										<span className={badgeClass(campaign.status)}>{campaign.status || 'DRAFT'}</span>
									</div>

									<div className="campaign-inline-stats campaign-inline-stats--stack-mobile">
										<span>{getMetric(campaign, ['totalRecipients', 'recipientCount'])} destinatarios</span>
										<span>{getStatusTone(campaign.status)}</span>
										<span>Creada {formatDate(campaign.createdAt)}</span>
									</div>
								</article>
							);
						})
					)}
				</div>

				<div className="campaign-detail-box campaign-detail-box--elevated">
					{selectedCampaign ? (
						<>
							<div className="campaign-detail-header">
								<div>
									<h4>{selectedCampaign.name}</h4>
									<p>{selectedCampaign.description || selectedCampaign.notes || 'Sin descripción.'}</p>
								</div>
								<span className={badgeClass(selectedCampaign.status)}>{selectedCampaign.status || 'DRAFT'}</span>
							</div>

							<div className="campaign-detail-meta-grid">
								<div className="campaign-detail-meta-card">
									<span>Template</span>
									<strong>{selectedCampaign.templateName || selectedCampaign.template?.name || 'Sin template'}</strong>
								</div>
								<div className="campaign-detail-meta-card">
									<span>Destinatarios</span>
									<strong>{getMetric(selectedCampaign, ['totalRecipients', 'recipientCount'])}</strong>
								</div>
								<div className="campaign-detail-meta-card">
									<span>Creación</span>
									<strong>{formatDate(selectedCampaign.createdAt)}</strong>
								</div>
							</div>

							<div className="campaign-detail-actions campaign-detail-actions--spaced">
								<button
									className="button primary"
									onClick={() => onDispatch(selectedCampaign.id)}
									disabled={actionLoading}
								>
									Despachar
								</button>
								<button
									className="button secondary"
									onClick={() => onPause(selectedCampaign.id)}
									disabled={actionLoading}
								>
									Pausar
								</button>
								<button
									className="button ghost"
									onClick={() => onResume(selectedCampaign.id)}
									disabled={actionLoading}
								>
									Reanudar
								</button>
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

							<div className="campaign-detail-metrics">
								<div>
									<span>Total</span>
									<strong>{getMetric(selectedCampaign, ['totalRecipients', 'recipientCount'])}</strong>
								</div>
								<div>
									<span>Enviados</span>
									<strong>{getMetric(selectedCampaign, ['sentCount'])}</strong>
								</div>
								<div>
									<span>Fallidos</span>
									<strong>{getMetric(selectedCampaign, ['failedCount'])}</strong>
								</div>
								<div>
									<span>Pendientes</span>
									<strong>{getMetric(selectedCampaign, ['pendingCount'])}</strong>
								</div>
							</div>

							<div className="campaign-recipient-list">
								<div className="campaign-recipient-list-title">Vista rápida de destinatarios</div>
								{recipients.length ? (
									recipients.slice(0, 8).map((recipient) => (
										<div key={recipient.id || recipient.phone} className="campaign-recipient-row">
											<div>
												<strong>{recipient.contactName || recipient.phone || 'Sin nombre'}</strong>
												<span>{recipient.phone || 'Sin teléfono'}</span>
											</div>
											<span className={badgeClass(recipient.status)}>{recipient.status || 'PENDING'}</span>
										</div>
									))
								) : (
									<div className="campaign-empty-state compact">
										<p>Esta campaña todavía no tiene detalle de destinatarios para mostrar.</p>
									</div>
								)}
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
