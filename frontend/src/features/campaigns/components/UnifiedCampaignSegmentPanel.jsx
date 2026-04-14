import { useMemo, useState } from 'react';
import CampaignComposerPanel from '../../../components/campaigns/CampaignComposerPanel.jsx';
import AbandonedCartCampaignPanel from './AbandonedCartCampaignPanel.jsx';

const SOURCE_OPTIONS = [
	{
		id: 'abandoned',
		label: 'Carritos abandonados',
		description: 'Recuperacion rapida con filtros por ventana, monto y producto.',
		highlight: 'Ideal para recuperar ventas frias en pocas horas.',
		steps: '1. Elegi template 2. Filtra carritos 3. Previsualiza 4. Crea o lanza',
	},
	{
		id: 'customers',
		label: 'Clientes y compras',
		description: 'Segmenta por compras, productos y filtros comerciales antes de lanzar.',
		highlight: 'Ideal para promociones, reactivacion y audiencias comerciales.',
		steps: '1. Elegi template 2. Filtra clientes 3. Selecciona audiencia 4. Revisa y lanza',
	},
];

function SourceButton({ option, active, onClick }) {
	return (
		<button
			type="button"
			className={`campaign-source-switch__button ${active ? 'is-active' : ''}`.trim()}
			onClick={() => onClick(option.id)}
		>
			<strong>{option.label}</strong>
			<span>{option.description}</span>
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
					<h4>Elegi de donde sale la audiencia</h4>
					<p>
						Primero defini si queres trabajar con recuperacion de carritos o con
						segmentacion de clientes. Despues el panel cambia sin mezclar dos modulos
						distintos.
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
							Si queres recuperar ventas usa carritos. Si queres comunicar promos o
							reactivar clientes, usa clientes y compras.
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
