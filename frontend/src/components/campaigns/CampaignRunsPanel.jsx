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

export default function CampaignRunsPanel({
  campaigns = [],
  selectedCampaign,
  onSelectCampaign,
  onDispatch,
  onPause,
  onResume,
  actionLoading,
}) {
  const recipients = selectedCampaign?.recipients || [];

  return (
    <section className="campaign-panel">
      <div className="campaign-panel-header">
        <div>
          <h3>Campañas creadas</h3>
          <p>Seguimiento de borradores, campañas en cola y resultados de envío.</p>
        </div>
      </div>

      <div className="campaign-runs-grid">
        <div className="campaign-list compact">
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
                  className={`campaign-list-card${isSelected ? ' selected' : ''}`}
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

                  <div className="campaign-inline-stats">
                    <span>{campaign.totalRecipients || campaign.recipientCount || 0} destinatarios</span>
                    <span>Creada {formatDate(campaign.createdAt)}</span>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="campaign-detail-box">
          {selectedCampaign ? (
            <>
              <div className="campaign-detail-header">
                <div>
                  <h4>{selectedCampaign.name}</h4>
                  <p>{selectedCampaign.description || 'Sin descripción.'}</p>
                </div>
                <span className={badgeClass(selectedCampaign.status)}>{selectedCampaign.status || 'DRAFT'}</span>
              </div>

              <div className="campaign-detail-actions">
                <button
                  className="button primary"
                  onClick={() => {
                    console.log('DISPATCH CLICK =>', selectedCampaign?.id, selectedCampaign);
                    onDispatch(selectedCampaign.id);
                  }}
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
              </div>

              <div className="campaign-status-grid">
                <div>
                  <strong>{selectedCampaign.sentCount || 0}</strong>
                  <span>Enviados</span>
                </div>
                <div>
                  <strong>{selectedCampaign.deliveredCount || 0}</strong>
                  <span>Entregados</span>
                </div>
                <div>
                  <strong>{selectedCampaign.readCount || 0}</strong>
                  <span>Leídos</span>
                </div>
                <div>
                  <strong>{selectedCampaign.failedCount || 0}</strong>
                  <span>Fallidos</span>
                </div>
              </div>

              <div className="campaign-recipient-table-wrapper">
                <table className="campaign-table">
                  <thead>
                    <tr>
                      <th>Teléfono</th>
                      <th>Nombre</th>
                      <th>Estado</th>
                      <th>Último evento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.length ? (
                      recipients.map((recipient) => (
                        <tr key={recipient.id || recipient.phone}>
                          <td>{recipient.phone || recipient.waId || '—'}</td>
                          <td>{recipient.firstName || recipient.contactName || '—'}</td>
                          <td>
                            <span className={badgeClass(recipient.status)}>{recipient.status || 'PENDING'}</span>
                          </td>
                          <td>{formatDate(recipient.lastEventAt || recipient.updatedAt)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="4">Sin destinatarios cargados.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="campaign-empty-state sticky">
              <strong>Seleccioná una campaña.</strong>
              <p>Acá vas a ver el detalle, los destinatarios y las métricas reales.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
