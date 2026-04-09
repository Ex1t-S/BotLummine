import { useState } from 'react';
import CampaignComposerPanel from '../../../components/campaigns/CampaignComposerPanel.jsx';
import AbandonedCartCampaignPanel from './AbandonedCartCampaignPanel.jsx';

const SOURCE_OPTIONS = [
	{
		id: 'abandoned',
		label: 'Carritos abandonados',
		description: 'Recuperación rápida con filtros de ventana, monto y producto.',
	},
	{
		id: 'customers',
		label: 'Clientes y compras',
		description: 'Segmentá por compras, productos y filtros comerciales antes de lanzar.',
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

	return (
		<div className="campaign-unified-segment">
			<div className="campaign-source-switch">
				<div className="campaign-source-switch__header">
					<span className="campaigns-tab-shell__eyebrow">Origen de audiencia</span>
					<h4>Elegí de dónde sale la audiencia</h4>
					<p>
						Primero definís si querés trabajar con recuperación de carritos o con segmentación
						de clientes. Después el panel cambia sin mezclar dos módulos distintos.
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
