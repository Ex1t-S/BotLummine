import { useEffect, useMemo, useState } from 'react';
import { uploadCampaignHeaderImage } from '../../lib/campaigns.js';

function createEmptyButton(type = 'QUICK_REPLY') {
	return {
		id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		type,
		text: '',
		url: '',
		phoneNumber: '',
	};
}

const defaultForm = {
	name: '',
	language: 'es_AR',
	category: 'MARKETING',
	headerType: 'TEXT',
	headerText: '',
	headerMediaId: '',
	headerMediaPreviewUrl: '',
	headerAssetHandle: '',
	bodyText: '',
	footerText: '',
	buttons: [],
};

function normalizeString(value, fallback = '') {
	const normalized = String(value ?? '').trim();
	return normalized || fallback;
}

function toUpper(value, fallback = '') {
	return normalizeString(value, fallback).toUpperCase();
}

function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

function getComponentByType(components = [], type = '') {
	return safeArray(components).find((component) => toUpper(component?.type) === toUpper(type)) || null;
}

function normalizeButton(button = {}, index = 0) {
	return {
		id: button.id || `button_${index}_${Math.random().toString(36).slice(2, 8)}`,
		type: toUpper(button.type, 'QUICK_REPLY'),
		text: normalizeString(button.text || ''),
		url: normalizeString(button.url || ''),
		phoneNumber: normalizeString(button.phone_number || button.phoneNumber || ''),
	};
}

function extractHeaderHandle(header = {}, template = {}) {
	const fromExample = safeArray(header?.example?.header_handle)[0];
	const fromRawPayload = template?.rawPayload?.headerMedia?.headerHandle;
	const fromTemplate = template?.headerMedia?.headerHandle;

	return normalizeString(fromExample || fromRawPayload || fromTemplate || '');
}

function mapTemplateToForm(template) {
	if (!template) return { ...defaultForm };

	const components = safeArray(template?.rawPayload?.components || template?.components);
	const header = getComponentByType(components, 'HEADER');
	const body = getComponentByType(components, 'BODY');
	const footer = getComponentByType(components, 'FOOTER');
	const buttonsComponent = getComponentByType(components, 'BUTTONS');

	return {
		name: normalizeString(template.name || ''),
		language: normalizeString(template.language || 'es_AR', 'es_AR'),
		category: toUpper(template.category || 'MARKETING', 'MARKETING'),
		headerType: toUpper(header?.format || template.headerFormat || 'TEXT', 'TEXT'),
		headerText: normalizeString(header?.text || template.headerText || ''),
		headerMediaId: normalizeString(
			header?.image?.id || template?.rawPayload?.headerMedia?.mediaId || template?.headerMedia?.mediaId || ''
		),
		headerMediaPreviewUrl: normalizeString(
			header?.image?.link ||
				template?.rawPayload?.headerMedia?.previewUrl ||
				template?.headerMedia?.previewUrl ||
				''
		),
		headerAssetHandle: extractHeaderHandle(header, template),
		bodyText: normalizeString(body?.text || template.bodyText || ''),
		footerText: normalizeString(footer?.text || template.footerText || ''),
		buttons: safeArray(buttonsComponent?.buttons).map((button, index) => normalizeButton(button, index)),
	};
}

function getVariableNumbers(text = '') {
	const matches = [...String(text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]));
	return [...new Set(matches)].sort((a, b) => a - b);
}

function buildSampleValue(variableNumber, context = 'general') {
	if (context === 'name') return `Ejemplo ${variableNumber}`;
	if (context === 'header') return `Dato ${variableNumber}`;
	if (context === 'url') return `ejemplo-${variableNumber}`;
	if (context === 'phone') return `54922100000${variableNumber}`;
	return `Valor ${variableNumber}`;
}

function buildHeaderComponent(form) {
	if (form.headerType === 'TEXT' && form.headerText.trim()) {
		const headerVariables = getVariableNumbers(form.headerText);

		const component = {
			type: 'HEADER',
			format: 'TEXT',
			text: form.headerText.trim(),
		};

		if (headerVariables.length) {
			component.example = {
				header_text: headerVariables.map((variableNumber) => buildSampleValue(variableNumber, 'header')),
			};
		}

		return component;
	}

	if (form.headerType === 'IMAGE') {
		const headerComponent = {
			type: 'HEADER',
			format: 'IMAGE',
		};

		if (form.headerAssetHandle) {
			headerComponent.example = {
				header_handle: [form.headerAssetHandle],
			};
		}

		return headerComponent;
	}

	return null;
}

function buildBodyComponent(form) {
	const bodyVariables = getVariableNumbers(form.bodyText);

	const component = {
		type: 'BODY',
		text: form.bodyText.trim(),
	};

	if (bodyVariables.length) {
		component.example = {
			body_text: [bodyVariables.map((variableNumber) => buildSampleValue(variableNumber, 'name'))],
		};
	}

	return component;
}

function buildButtonsComponent(buttons = []) {
	const normalized = safeArray(buttons)
		.map((button, index) => normalizeButton(button, index))
		.filter((button) => button.text);

	if (!normalized.length) return null;

	return {
		type: 'BUTTONS',
		buttons: normalized.map((button) => {
			if (button.type === 'URL') {
				return {
					type: 'URL',
					text: button.text,
					url: button.url,
				};
			}

			if (button.type === 'PHONE_NUMBER') {
				return {
					type: 'PHONE_NUMBER',
					text: button.text,
					phone_number: button.phoneNumber,
				};
			}

			return {
				type: 'QUICK_REPLY',
				text: button.text,
			};
		}),
	};
}

function buildPayload(form) {
	const components = [];
	const headerComponent = buildHeaderComponent(form);

	if (headerComponent) components.push(headerComponent);
	components.push(buildBodyComponent(form));

	if (form.footerText.trim()) {
		components.push({
			type: 'FOOTER',
			text: form.footerText.trim(),
		});
	}

	const buttonsComponent = buildButtonsComponent(form.buttons);
	if (buttonsComponent) {
		components.push(buttonsComponent);
	}

	return {
		name: form.name.trim(),
		language: form.language,
		category: form.category,
		components,
		headerMedia:
			form.headerType === 'IMAGE'
				? {
						mediaId: normalizeString(form.headerMediaId || '') || null,
						previewUrl: normalizeString(form.headerMediaPreviewUrl || '') || null,
						headerHandle: normalizeString(form.headerAssetHandle || '') || null,
					}
				: null,
	};
}

function validatePayload(payload, form) {
	if (!payload.name) return 'Poné un nombre interno para el template.';
	if (!payload.components?.length) return 'El template no tiene contenido.';
	if (!form.bodyText.trim()) return 'El cuerpo del mensaje no puede quedar vacío.';

	if (form.headerType === 'IMAGE' && !form.headerAssetHandle) {
		return 'Si usás header con imagen, subí una imagen primero.';
	}

	for (const button of safeArray(form.buttons)) {
		if (!button.text.trim()) {
			return 'Todos los botones tienen que tener texto.';
		}

		if (button.type === 'URL' && !button.url.trim()) {
			return 'Los botones de enlace necesitan una URL.';
		}

		if (button.type === 'PHONE_NUMBER' && !button.phoneNumber.trim()) {
			return 'Los botones de llamada necesitan un número.';
		}
	}

	return '';
}

function describeButtonType(type = '') {
	if (type === 'URL') return 'Abrir enlace';
	if (type === 'PHONE_NUMBER') return 'Llamar';
	return 'Respuesta rápida';
}

function isMetaSampleTemplate(template) {
	return String(template?.name || '').trim().toLowerCase() === 'hello_world';
}

function extractUploadValue(response = {}, keys = []) {
	for (const key of keys) {
		const value = response?.[key];
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return '';
}

function inferCurrentStep(form) {
	if (!form.name.trim() || !form.bodyText.trim()) return 1;
	if (form.headerType === 'IMAGE' && !form.headerAssetHandle) return 2;
	if (safeArray(form.buttons).length && safeArray(form.buttons).some((button) => !button.text.trim())) return 3;
	return 4;
}

function BuilderSection({ step, title, description, active = false, children }) {
	return (
		<section className={`template-builder-section ${active ? 'is-active' : ''}`}>
			<div className="template-builder-section-head">
				<div className="template-builder-section-step">{step}</div>
				<div>
					<h4>{title}</h4>
					{description ? <p>{description}</p> : null}
				</div>
			</div>
			<div className="template-builder-section-body">{children}</div>
		</section>
	);
}

export default function TemplateBuilderPanel({
	selectedTemplate,
	onCreateTemplate,
	onUpdateTemplate,
	creating,
	updating,
}) {
	const [form, setForm] = useState(defaultForm);
	const [localError, setLocalError] = useState('');
	const [uploadingImage, setUploadingImage] = useState(false);
	const [forcedCreateMode, setForcedCreateMode] = useState(false);

	useEffect(() => {
		if (selectedTemplate?.id) {
			setForm(mapTemplateToForm(selectedTemplate));
			setForcedCreateMode(false);
		} else {
			setForm({ ...defaultForm });
			setForcedCreateMode(true);
		}
		setLocalError('');
	}, [selectedTemplate?.id]);

	const isEditingSelectedTemplate = Boolean(selectedTemplate?.id) && !forcedCreateMode;
	const isReadOnlyTemplate = isEditingSelectedTemplate && isMetaSampleTemplate(selectedTemplate);
	const currentStep = inferCurrentStep(form);

	const variables = useMemo(() => {
		const buttonUrls = safeArray(form.buttons)
			.map((button) => button.url || '')
			.join('\n');

		return getVariableNumbers(
			`${form.headerText}\n${form.bodyText}\n${form.footerText}\n${buttonUrls}`
		);
	}, [form]);

	const previewButtons = useMemo(() => {
		return safeArray(form.buttons)
			.map((button, index) => normalizeButton(button, index))
			.filter((button) => button.text);
	}, [form.buttons]);

	const canSave = !creating && !updating && !uploadingImage;

	function updateForm(field, value) {
		setForm((current) => ({ ...current, [field]: value }));
	}

	function updateButton(buttonId, patch) {
		setForm((current) => ({
			...current,
			buttons: safeArray(current.buttons).map((button) =>
				button.id === buttonId ? { ...button, ...patch } : button
			),
		}));
	}

	function addButton(type = 'QUICK_REPLY') {
		setForm((current) => {
			if (safeArray(current.buttons).length >= 3) return current;

			return {
				...current,
				buttons: [...safeArray(current.buttons), createEmptyButton(type)],
			};
		});
	}

	function removeButton(buttonId) {
		setForm((current) => ({
			...current,
			buttons: safeArray(current.buttons).filter((button) => button.id !== buttonId),
		}));
	}

	function startCreateMode() {
		setForcedCreateMode(true);
		setForm({ ...defaultForm });
		setLocalError('');
	}

	function restoreSelectedTemplate() {
		if (!selectedTemplate?.id) {
			startCreateMode();
			return;
		}

		setForcedCreateMode(false);
		setForm(mapTemplateToForm(selectedTemplate));
		setLocalError('');
	}

	async function handleImageUpload(event) {
		const file = event.target.files?.[0];
		if (!file) return;

		setLocalError('');
		setUploadingImage(true);

		try {
			const response = await uploadCampaignHeaderImage(file);

			const mediaId = extractUploadValue(response, [
				'mediaId',
				'id',
				'uploadedMediaId',
				'metaMediaId',
				'whatsAppMediaId',
			]);

			const previewUrl = extractUploadValue(response, [
				'previewUrl',
				'url',
				'link',
				'publicUrl',
				'mediaUrl',
			]);

			const headerHandle = extractUploadValue(response, [
				'headerHandle',
				'handle',
				'assetHandle',
				'headerAssetHandle',
			]);

			setForm((current) => ({
				...current,
				headerMediaId: mediaId,
				headerMediaPreviewUrl: previewUrl,
				headerAssetHandle: headerHandle,
			}));
		} catch (error) {
			setLocalError(error?.response?.data?.error || 'No se pudo subir la imagen.');
		} finally {
			setUploadingImage(false);
			event.target.value = '';
		}
	}

	async function handleSubmit(event) {
		event.preventDefault();

		if (isReadOnlyTemplate) {
			setLocalError('El template hello_world es de muestra de Meta y no se puede editar.');
			return;
		}

		const payload = buildPayload(form);
		const validationError = validatePayload(payload, form);

		if (validationError) {
			setLocalError(validationError);
			return;
		}

		setLocalError('');

		if (isEditingSelectedTemplate) {
			await onUpdateTemplate(selectedTemplate.id, payload);
			return;
		}

		await onCreateTemplate(payload);
		setForcedCreateMode(true);
		setForm({ ...defaultForm });
	}

	return (
		<section className="campaign-panel campaign-panel--soft template-builder-shell">
			<div className="template-builder-topbar">
				<div>
					<span className="campaigns-eyebrow">
						{isEditingSelectedTemplate ? 'Editando template' : 'Nuevo template'}
					</span>
					<h3>{isEditingSelectedTemplate ? form.name || 'Editar template' : 'Crear template nuevo'}</h3>
					<p>
						Primero definís la base, después el contenido y al final revisás el preview. Mucho menos ladrillo, bastante más usable.
					</p>
				</div>

				<div className="template-builder-topbar-actions">
					{!forcedCreateMode ? (
						<button type="button" className="button secondary" onClick={startCreateMode}>
							+ Nuevo template
						</button>
					) : null}

					{forcedCreateMode && selectedTemplate?.id ? (
						<button type="button" className="button ghost" onClick={restoreSelectedTemplate}>
							Volver al seleccionado
						</button>
					) : null}
				</div>
			</div>

			<div className="template-builder-progress">
				<div className={`template-builder-progress-step ${currentStep >= 1 ? 'is-done' : ''}`}>Base</div>
				<div className={`template-builder-progress-step ${currentStep >= 2 ? 'is-done' : ''}`}>Contenido</div>
				<div className={`template-builder-progress-step ${currentStep >= 3 ? 'is-done' : ''}`}>Botones</div>
				<div className={`template-builder-progress-step ${currentStep >= 4 ? 'is-done' : ''}`}>Revisión</div>
			</div>

			<div className="template-builder-layout">
				<form className="campaign-form template-builder-form" onSubmit={handleSubmit}>
					{isReadOnlyTemplate ? (
						<div className="campaign-inline-warning">
							Estás viendo un template sample de Meta. No se puede editar. Tocá <strong>+ Nuevo template</strong> y armá uno propio.
						</div>
					) : null}

					{localError ? <div className="campaign-inline-error">{localError}</div> : null}

					<BuilderSection
						step="1"
						title="Base del template"
						description="Nombre interno, idioma y categoría."
						active={currentStep === 1}
					>
						<div className="campaign-form-grid two-columns">
							<label className="field">
								<span>Nombre interno</span>
								<input
									value={form.name}
									onChange={(event) => updateForm('name', event.target.value)}
									placeholder="promo_body_abril"
								/>
								<small>Usá algo corto y reconocible para vos.</small>
							</label>

							<label className="field">
								<span>Idioma</span>
								<select
									value={form.language}
									onChange={(event) => updateForm('language', event.target.value)}
								>
									<option value="es_AR">es_AR</option>
									<option value="es_ES">es_ES</option>
									<option value="en_US">en_US</option>
									<option value="pt_BR">pt_BR</option>
								</select>
							</label>
						</div>

						<div className="campaign-form-grid two-columns">
							<label className="field">
								<span>Categoría</span>
								<select
									value={form.category}
									onChange={(event) => updateForm('category', event.target.value)}
								>
									<option value="MARKETING">MARKETING</option>
									<option value="UTILITY">UTILITY</option>
									<option value="AUTHENTICATION">AUTHENTICATION</option>
								</select>
							</label>

							<label className="field">
								<span>Tipo de encabezado</span>
								<select
									value={form.headerType}
									onChange={(event) => updateForm('headerType', event.target.value)}
								>
									<option value="TEXT">Texto</option>
									<option value="IMAGE">Imagen</option>
								</select>
							</label>
						</div>
					</BuilderSection>

					<BuilderSection
						step="2"
						title="Contenido del mensaje"
						description="Encabezado, cuerpo y pie."
						active={currentStep === 2}
					>
						{form.headerType === 'TEXT' ? (
							<label className="field">
								<span>Texto del encabezado</span>
								<input
									value={form.headerText}
									onChange={(event) => updateForm('headerText', event.target.value)}
									placeholder="Oferta especial {{1}}"
								/>
							</label>
						) : (
							<div className="template-media-upload-box">
								<div className="template-media-upload-top">
									<div>
										<strong>Header con imagen</strong>
										<p>Subí una imagen y el builder guarda el handle para Meta.</p>
									</div>

									<label className="button secondary template-upload-button">
										<input type="file" accept="image/*" onChange={handleImageUpload} hidden />
										{uploadingImage ? 'Subiendo...' : 'Subir imagen'}
									</label>
								</div>

								{form.headerMediaPreviewUrl ? (
									<div className="template-media-preview-card">
										<img src={form.headerMediaPreviewUrl} alt="Preview header" />
										<div className="template-media-preview-meta">
											<span>Imagen cargada</span>
											<code>{form.headerMediaId || 'sin mediaId'}</code>
										</div>
									</div>
								) : (
									<div className="template-media-empty">
										Todavía no cargaste imagen para el header.
									</div>
								)}
							</div>
						)}

						<label className="field">
							<span>Cuerpo</span>
							<textarea
								rows={7}
								value={form.bodyText}
								onChange={(event) => updateForm('bodyText', event.target.value)}
								placeholder={'Hola {{1}}, vimos que te interesó {{2}}.\nTodavía lo tenemos disponible.'}
							/>
							<small>Podés usar variables como {`{{1}}`} y {`{{2}}`}.</small>
						</label>

						<label className="field">
							<span>Footer</span>
							<input
								value={form.footerText}
								onChange={(event) => updateForm('footerText', event.target.value)}
								placeholder="Lummine"
							/>
						</label>
					</BuilderSection>

					<BuilderSection
						step="3"
						title="Botones"
						description="Opcionales, pero ayudan muchísimo."
						active={currentStep === 3}
					>
						<div className="template-button-toolbar">
							<button type="button" className="button ghost" onClick={() => addButton('QUICK_REPLY')}>
								+ Respuesta rápida
							</button>
							<button type="button" className="button ghost" onClick={() => addButton('URL')}>
								+ Botón con link
							</button>
							<button type="button" className="button ghost" onClick={() => addButton('PHONE_NUMBER')}>
								+ Botón llamar
							</button>
						</div>

						{form.buttons.length ? (
							<div className="template-button-list">
								{form.buttons.map((button) => (
									<div key={button.id} className="template-button-card">
										<div className="template-button-card-head">
											<strong>{describeButtonType(button.type)}</strong>
											<button
												type="button"
												className="button ghost"
												onClick={() => removeButton(button.id)}
											>
												Quitar
											</button>
										</div>

										<div className="campaign-form-grid two-columns">
											<label className="field">
												<span>Tipo</span>
												<select
													value={button.type}
													onChange={(event) =>
														updateButton(button.id, {
															type: event.target.value,
															url: '',
															phoneNumber: '',
														})
													}
												>
													<option value="QUICK_REPLY">Respuesta rápida</option>
													<option value="URL">URL</option>
													<option value="PHONE_NUMBER">Llamada</option>
												</select>
											</label>

											<label className="field">
												<span>Texto del botón</span>
												<input
													value={button.text}
													onChange={(event) =>
														updateButton(button.id, { text: event.target.value })
													}
													placeholder="Ver producto"
												/>
											</label>
										</div>

										{button.type === 'URL' ? (
											<label className="field">
												<span>URL</span>
												<input
													value={button.url}
													onChange={(event) =>
														updateButton(button.id, { url: event.target.value })
													}
													placeholder="https://..."
												/>
											</label>
										) : null}

										{button.type === 'PHONE_NUMBER' ? (
											<label className="field">
												<span>Número</span>
												<input
													value={button.phoneNumber}
													onChange={(event) =>
														updateButton(button.id, { phoneNumber: event.target.value })
													}
													placeholder="549221..."
												/>
											</label>
										) : null}
									</div>
								))}
							</div>
						) : (
							<div className="template-soft-empty">
								No agregaste botones todavía.
							</div>
						)}
					</BuilderSection>

					<BuilderSection
						step="4"
						title="Guardar"
						description="Revisá variables y enviá el template."
						active={currentStep === 4}
					>
						<div className="template-review-grid">
							<div className="template-review-card">
								<span>Modo</span>
								<strong>{isEditingSelectedTemplate ? 'Editar seleccionado' : 'Crear nuevo'}</strong>
							</div>
							<div className="template-review-card">
								<span>Variables</span>
								<strong>{variables.length}</strong>
							</div>
							<div className="template-review-card">
								<span>Botones</span>
								<strong>{form.buttons.length}</strong>
							</div>
							<div className="template-review-card">
								<span>Header</span>
								<strong>{form.headerType === 'IMAGE' ? 'Imagen' : 'Texto'}</strong>
							</div>
						</div>

						<div className="campaign-form-actions template-builder-submit-row">
							<button type="submit" className="button primary" disabled={!canSave || isReadOnlyTemplate}>
								{creating || updating
									? 'Guardando...'
									: isEditingSelectedTemplate
										? 'Guardar cambios'
										: 'Crear template'}
							</button>
						</div>
					</BuilderSection>
				</form>

				<aside className="template-preview-sidebar">
					<div className="template-preview-card-sticky">
						<div className="template-preview-meta">
							<div>
								<span className="template-preview-meta-label">Preview</span>
								<strong>{form.name || 'template_sin_nombre'}</strong>
							</div>
							<span className="campaign-badge">{form.category}</span>
						</div>

						{variables.length ? (
							<div className="campaign-variable-box">
								<strong>Variables detectadas</strong>
								<div className="campaign-variable-list">
									{variables.map((variable) => (
										<span key={variable}>{`{{${variable}}}`}</span>
									))}
								</div>
							</div>
						) : null}

						<div className="campaign-preview-shell template-preview-shell--sticky">
							<div className="campaign-whatsapp-preview">
								<div className="campaign-preview-phone-bar">Vista previa del mensaje</div>
								<div className="campaign-preview-bubble">
									{form.headerType === 'TEXT' && form.headerText ? (
										<div className="campaign-preview-header">{form.headerText}</div>
									) : null}

									{form.headerType === 'IMAGE' ? (
										form.headerMediaPreviewUrl ? (
											<div className="template-preview-image-wrap">
												<img
													className="template-preview-image"
													src={form.headerMediaPreviewUrl}
													alt="Header"
												/>
											</div>
										) : (
											<div className="template-preview-image-empty">Header con imagen</div>
										)
									) : null}

									<div className="campaign-preview-body">
										{form.bodyText || 'Acá vas a ver el cuerpo del mensaje.'}
									</div>

									{form.footerText ? (
										<div className="campaign-preview-footer">{form.footerText}</div>
									) : null}

									{previewButtons.length ? (
										<div className="campaign-preview-buttons">
											{previewButtons.map((button) => (
												<button key={button.id} type="button">
													{button.text}
												</button>
											))}
										</div>
									) : null}
								</div>
							</div>
						</div>

						<div className="template-preview-tip">
							<strong>Tip:</strong> mantené el texto corto, usá 1 o 2 variables útiles y no conviertas el template en una tesis doctoral con botones.
						</div>
					</div>
				</aside>
			</div>
		</section>
	);
}