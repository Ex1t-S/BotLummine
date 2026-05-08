import { useMemo, useState } from 'react';
import CampaignComposerPanel from '../../../components/campaigns/CampaignComposerPanel.jsx';
import AbandonedCartCampaignPanel from './AbandonedCartCampaignPanel.jsx';

const SOURCE_OPTIONS = [
	{
		id: 'abandoned',
		label: 'Carritos abandonados',
		description: 'Recuperación rápida con filtros por ventana, monto y producto.',
		highlight: 'Ideal para recuperar ventas recientes en pocas horas.',
		steps: '1. Elegí template 2. Filtrá carritos 3. Previsualizá 4. Creá o lanzá',
	},
	{
		id: 'customers',
		label: 'Clientes y compras',
		description: 'Segmentá por compras, productos y filtros comerciales antes de lanzar.',
		highlight: 'Ideal para promociones, reactivación y audiencias comerciales.',
		steps: '1. Elegí template 2. Filtrá clientes 3. Seleccioná audiencia 4. Revisá y lanzá',
	},
];

function SourceButton({ option, active, onClick }) {
	return (
		<button
			type="button"
			aria-pressed={active}
			aria-describedby={`campaign-source-${option.id}-description`}
			className={`campaign-source-switch__button ${active ? 'is-active' : ''}`.trim()}
			onClick={() => onClick(option.id)}
		>
			<strong>{option.label}</strong>
			<span id={`campaign-source-${option.id}-description`}>{option.description}</span>
		</button>
	);
}

export default function UnifiedCampaignSegmentPanel({
	templates = [],
	selectedTemplate,
	onSelectTemplate,
	abandonedCart,
	mutations,
	onCreateCampaign,
	creatingCampaign,
}) {
	const [source, setSource] = useState('abandoned');

	const activeSource = useMemo(
		() => SOURCE_OPTIONS.find((option) => option.id === source) || SOURCE_OPTIONS[0],
		[source]
	);

	return (
		<div className="campaign-unified-segment">
			<div className="campaign-source-switch">
				<div className="campaign-source-switch__header">
					<span className="campaigns-tab-shell__eyebrow">Origen de audiencia</span>
					<h4>Elegí de dónde sale la audiencia</h4>
					<p>
						Primero definí si vas a recuperar carritos o crear una campaña para clientes.
						Después el panel cambia para que cada objetivo tenga su propio flujo.
					</p>
				</div>

				<div className="campaign-source-switch__grid">
					{SOURCE_OPTIONS.map((option) => (
						<SourceButton
							key={option.id}
							option={option}
							active={source === option.id}
							onClick={setSource}
						/>
					))}
				</div>

				<div className="campaign-segment-summary-grid">
					<div className="campaign-segment-summary-card">
						<span>Origen activo</span>
						<strong>{activeSource.label}</strong>
						<p>{activeSource.highlight}</p>
					</div>
					<div className="campaign-segment-summary-card">
						<span>Flujo recomendado</span>
						<strong>4 pasos claros</strong>
						<p>{activeSource.steps}</p>
					</div>
					<div className="campaign-segment-summary-card">
						<span>Consejo</span>
						<strong>No mezclar objetivos</strong>
						<p>
							Si querés recuperar ventas, usá carritos. Si querés comunicar promos o
							reactivar clientes, usá clientes y compras.
						</p>
					</div>
				</div>
			</div>

			<div className="campaign-unified-segment__body">
				{source === 'abandoned' ? (
					<AbandonedCartCampaignPanel
						templates={templates}
						selectedTemplate={selectedTemplate}
						onSelectTemplate={onSelectTemplate}
						form={abandonedCart.form}
						onUpdateField={abandonedCart.updateField}
						preview={abandonedCart.preview}
						previewing={mutations.abandonedPreview.isPending}
						creating={mutations.createAbandonedCampaign.isPending}
						onPreview={abandonedCart.handlePreview}
						onCreate={abandonedCart.handleCreate}
					/>
				) : (
					<CampaignComposerPanel
						templates={templates}
						selectedTemplate={selectedTemplate}
						onSelectTemplate={onSelectTemplate}
						onCreateCampaign={onCreateCampaign}
						creating={creatingCampaign}
						audienceModeOptions={['customers']}
						lockedAudienceMode="customers"
					/>
				)}
			</div>
		</div>
	);
}
