import { useState } from 'react';
import { uploadCampaignHeaderMedia } from '../../../lib/campaigns.js';
import {
	getTemplateHeaderMediaAccept,
	getTemplateHeaderMediaAsset,
	getTemplateHeaderMediaLabel,
	templateRequiresHeaderMedia,
} from '../templateHeaderMedia.js';

function extractUploadMediaId(result = {}) {
	return String(result?.mediaId || result?.id || '').trim();
}

export default function TemplateHeaderMediaUpload({
	template,
	mediaId = '',
	fileName = '',
	disabled = false,
	purpose = 'campaign_send',
	onUploaded,
	onClear,
}) {
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState('');

	if (!templateRequiresHeaderMedia(template)) {
		return null;
	}

	const label = getTemplateHeaderMediaLabel(template);
	const asset = getTemplateHeaderMediaAsset(template);
	const hasUploadedMedia = Boolean(String(mediaId || '').trim());
	const hasTemplateMedia = Boolean(asset.hasResolvedAsset);

	async function handleUpload(event) {
		const file = event.target.files?.[0];
		if (!file) return;

		setError('');
		setUploading(true);

		try {
			const result = await uploadCampaignHeaderMedia(file, { purpose });
			const nextMediaId = extractUploadMediaId(result);

			if (!nextMediaId) {
				throw new Error(`Meta no devolvio mediaId para el ${label}.`);
			}

			onUploaded?.(nextMediaId, file.name, result);
		} catch (uploadError) {
			setError(
				uploadError?.response?.data?.error ||
					uploadError?.message ||
					`No se pudo subir el ${label} del encabezado.`
			);
		} finally {
			setUploading(false);
			event.target.value = '';
		}
	}

	return (
		<div className="campaign-header-media-upload">
			<div className="campaign-helper-text">
				{hasTemplateMedia && !hasUploadedMedia
					? `La plantilla ya tiene ${label} de encabezado. Subi otro archivo solo si queres reemplazarlo.`
					: `Esta plantilla usa ${label} de encabezado para enviarse por WhatsApp.`}
			</div>

			<div className="campaign-inline-actions campaign-inline-actions--wrap">
				<label
					className="button secondary"
					style={{ cursor: disabled || uploading ? 'not-allowed' : 'pointer' }}
				>
					{uploading
						? `Subiendo ${label}...`
						: hasUploadedMedia
							? `Cambiar ${label}`
							: hasTemplateMedia
								? `Reemplazar ${label}`
								: `Subir ${label}`}
					<input
						type="file"
						accept={getTemplateHeaderMediaAccept(template)}
						onChange={handleUpload}
						disabled={disabled || uploading}
						style={{ display: 'none' }}
					/>
				</label>

				{hasUploadedMedia && onClear ? (
					<button type="button" className="button ghost" onClick={onClear} disabled={disabled || uploading}>
						Quitar {label}
					</button>
				) : null}

				{fileName ? (
					<span className="campaign-helper-inline-text">{fileName}</span>
				) : null}
			</div>

			{hasTemplateMedia && !hasUploadedMedia ? (
				<div className="campaign-inline-success">
					{`Se usara el ${label} guardado en la plantilla.`}
				</div>
			) : null}

			{hasUploadedMedia ? (
				<div className="campaign-inline-success">
					{`Se usara el ${label} cargado para esta configuracion.`}
				</div>
			) : null}

			{!hasTemplateMedia && !hasUploadedMedia ? (
				<div className="campaign-inline-warning">
					{`Subi un ${label} antes de activar o enviar esta automatizacion.`}
				</div>
			) : null}

			{error ? <div className="campaign-inline-error">{error}</div> : null}
		</div>
	);
}
