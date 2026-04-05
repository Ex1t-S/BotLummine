import { formatPreviewText } from '../utils.js';

export default function AbandonedCartCampaignPanel({
	templates = [],
	selectedTemplate,
	onSelectTemplate,
	form,
	onUpdateField,
	preview,
	previewing,
	creating,
	onPreview,
	onCreate,
}) {
	return (
		<div className="campaign-custom-audience">
			<div className="campaign-custom-audience-intro">
				<span className="campaigns-eyebrow">Campañas desde carritos abandonados</span>
				<h3>Crear audiencia automática desde AbandonedCart</h3>
				<p>
					Usa el template seleccionado para generar audiencia desde carritos reales,
					deduplicados por teléfono.
				</p>
			</div>

			<div className="campaign-custom-audience-grid">
				<div className="campaign-custom-audience-card">
					<div className="field">
						<span>Template seleccionado</span>
						<select
							value={selectedTemplate?.id || ''}
							onChange={(e) => {
								const next = templates.find((template) => template.id === e.target.value) || null;
								onSelectTemplate(next);
							}}
						>
							<option value="">Seleccionar template</option>
							{templates.map((template) => (
								<option key={template.id} value={template.id}>
									{template.name} · {template.language} · {template.status}
								</option>
							))}
						</select>
					</div>

					<div className="campaign-form-grid two-columns">
						<div className="field">
							<span>Nombre de campaña</span>
							<input
								value={form.name}
								onChange={(e) => onUpdateField('name', e.target.value)}
								placeholder="Recuperación carritos 7 días"
							/>
						</div>

						<div className="field">
							<span>Ventana</span>
							<select
								value={form.daysBack}
								onChange={(e) => onUpdateField('daysBack', Number(e.target.value))}
							>
								<option value={7}>7 días</option>
								<option value={15}>15 días</option>
								<option value={30}>30 días</option>
							</select>
						</div>
					</div>

					<div className="campaign-custom-audience-grid-4">
						<div className="field">
							<span>Estado</span>
							<select
								value={form.status}
								onChange={(e) => onUpdateField('status', e.target.value)}
							>
								<option value="NEW">NEW</option>
								<option value="CONTACTED">CONTACTED</option>
								<option value="ALL">ALL</option>
							</select>
						</div>

						<div className="field">
							<span>Límite</span>
							<input
								type="number"
								min="1"
								max="500"
								value={form.limit}
								onChange={(e) => onUpdateField('limit', Number(e.target.value || 50))}
							/>
						</div>

						<div className="field">
							<span>Monto mínimo</span>
							<input
								type="number"
								min="0"
								value={form.minTotal}
								onChange={(e) => onUpdateField('minTotal', e.target.value)}
								placeholder="0"
							/>
						</div>

						<div className="field">
							<span>Producto</span>
							<input
								value={form.productQuery}
								onChange={(e) => onUpdateField('productQuery', e.target.value)}
								placeholder="body, faja, calza"
							/>
						</div>
					</div>

					<div className="field">
						<span>Notas</span>
						<textarea
							value={form.notes}
							onChange={(e) => onUpdateField('notes', e.target.value)}
							placeholder="Notas internas de esta campaña"
							rows={3}
						/>
					</div>

					<label className="campaign-toggle">
						<input
							type="checkbox"
							checked={form.launchNow}
							onChange={(e) => onUpdateField('launchNow', e.target.checked)}
						/>
						Enviar apenas se cree
					</label>

					<div className="campaign-form-actions">
						<button
							type="button"
							className="button ghost"
							onClick={onPreview}
							disabled={previewing}
						>
							{previewing ? 'Generando...' : 'Previsualizar audiencia'}
						</button>

						<button
							type="button"
							className="button primary"
							onClick={() => onCreate(form.launchNow)}
							disabled={creating}
						>
							{creating
								? 'Creando campaña...'
								: form.launchNow
									? 'Crear y lanzar'
									: 'Guardar campaña'}
						</button>
					</div>
				</div>

				<div className="campaign-custom-audience-card campaign-custom-audience-preview">
					<div className="campaign-custom-audience-preview-head">
						<div>
							<div className="campaign-custom-audience-preview-title">Preview de audiencia</div>
							<div className="campaign-custom-audience-preview-subtitle">
								{preview.total || 0} destinatarios
							</div>
						</div>

						{selectedTemplate ? (
							<span className="campaign-custom-audience-pill">{selectedTemplate.name}</span>
						) : null}
					</div>

					<div className="campaign-custom-audience-preview-list">
						{preview.recipients?.length ? (
							preview.recipients.slice(0, 8).map((recipient, index) => (
								<div
									key={`${recipient.phone}-${index}`}
									className="campaign-custom-audience-recipient"
								>
									<div className="campaign-custom-audience-recipient-top">
										<strong>{recipient.contactName || recipient.phone}</strong>
										<span>{recipient.totalAmount || ''}</span>
									</div>

									<div className="campaign-custom-audience-recipient-product">
										{recipient.primaryProductName || 'Sin producto'}
									</div>

									<div className="campaign-custom-audience-recipient-phone">
										{recipient.phone}
									</div>

									{recipient.renderedPreviewText ? (
										<div className="campaign-custom-audience-recipient-preview">
											{formatPreviewText(recipient.renderedPreviewText, 260)}
										</div>
									) : null}
								</div>
							))
						) : (
							<div className="campaign-custom-audience-empty">
								Previsualizá la audiencia para ver los primeros destinatarios y cómo se
								renderiza el template.
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
