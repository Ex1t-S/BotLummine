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
	if (!template) {
		return { ...defaultForm };
	}

	const components = safeArray(template?.rawPayload?.components);
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
			header?.image?.id || template?.rawPayload?.headerMedia?.mediaId || ''
		),
		headerMediaPreviewUrl: normalizeString(
			header?.image?.link || template?.rawPayload?.headerMedia?.previewUrl || ''
		),
		headerAssetHandle: extractHeaderHandle(header, template),
		bodyText: normalizeString(body?.text || template.bodyText || ''),
		footerText: normalizeString(footer?.text || template.footerText || ''),
		buttons: safeArray(buttonsComponent?.buttons).map((button, index) => normalizeButton(button, index)),
	};
}

function buildButtonsComponent(buttons = []) {
	const normalized = safeArray(buttons)
		.map((button, index) => normalizeButton(button, index))
		.filter((button) => button.text);

	if (!normalized.length) {
		return null;
	}

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

function buildSampleValue(variableNumber, context = 'general') {
	if (context === 'name') return `Ejemplo ${variableNumber}`;
	if (context === 'header') return `Dato ${variableNumber}`;
	if (context === 'phone') return `54922100000${variableNumber}`;
	if (context === 'url') return `ejemplo-${variableNumber}`;
	return `Valor ${variableNumber}`;
}

function getVariableNumbers(text = '') {
	const matches = [...String(text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]));
	return [...new Set(matches)].sort((a, b) => a - b);
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

	if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.headerType)) {
		const headerComponent = {
			type: 'HEADER',
			format: form.headerType,
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

function buildPayload(form) {
	const components = [];
	const headerComponent = buildHeaderComponent(form);

	if (headerComponent) {
		components.push(headerComponent);
	}

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

function getCompletionSteps(form) {
	return [
		Boolean(form.name.trim() && form.language && form.category),
		form.headerType === 'TEXT'
			? true
			: form.headerType === 'IMAGE'
				? Boolean(form.headerAssetHandle)
				: true,
		Boolean(form.bodyText.trim()),
		safeArray(form.buttons).every((button) => {
			if (!button.text.trim()) return false;
			if (button.type === 'URL') return Boolean(button.url.trim());
			if (button.type === 'PHONE_NUMBER') return Boolean(button.phoneNumber.trim());
			return true;
		}),
	];
}

function getReviewItems(form, variables) {
	return [
		{ label: 'Categoría', value: form.category || '—' },
		{ label: 'Idioma', value: form.language || '—' },
		{ label: 'Header', value: form.headerType || '—' },
		{ label: 'Variables', value: variables.length ? String(variables.length) : '0' },
	];
}

function getWarnings(form, variables) {
	const warnings = [];

	if (!form.name.trim()) {
		warnings.push('Todavía no definiste el nombre interno del template.');
	}

	if (!form.bodyText.trim()) {
		warnings.push('El body está vacío. Meta no te va a dejar crear la plantilla así.');
	}

	if (form.headerType === 'IMAGE' && !form.headerAssetHandle) {
		warnings.push('Para header IMAGE necesitás subir una imagen que devuelva header_handle.');
	}

	if (variables.length > 0) {
		warnings.push(`Se detectaron ${variables.length} variable${variables.length > 1 ? 's' : ''}. Revisá que el texto tenga sentido también con datos reales.`);
	}

	if (form.buttons.length >= 3) {
		warnings.push('Ya llegaste al máximo de 3 botones para este builder.');
	}

	return warnings;
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

	const variables = useMemo(() => {
		const buttonUrls = safeArray(form.buttons)
			.map((button) => button.url || '')
			.join('\n');

		return getVariableNumbers(`${form.headerText}\n${form.bodyText}\n${form.footerText}\n${buttonUrls}`);
	}, [form]);

	const previewButtons = useMemo(() => {
		return safeArray(form.buttons)
			.map((button, index) => normalizeButton(button, index))
			.filter((button) => button.text);
	}, [form.buttons]);

	const stepCompletion = useMemo(() => getCompletionSteps(form), [form]);
	const completedCount = stepCompletion.filter(Boolean).length;
	const reviewItems = useMemo(() => getReviewItems(form, variables), [form, variables]);
	const warnings = useMemo(() => getWarnings(form, variables), [form, variables]);

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
			if (safeArray(current.buttons).length >= 3) {
				return current;
			}

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
			const previewUrl = URL.createObjectURL(file);
			const nextMediaId = extractUploadValue(response, ['mediaId', 'id']);
			const nextHeaderHandle = extractUploadValue(response, [
				'headerHandle',
				'header_handle',
				'mediaHandle',
				'handle',
			]);

			setForm((current) => ({
				...current,
				headerType: 'IMAGE',
				headerMediaId: nextMediaId,
				headerMediaPreviewUrl: previewUrl,
				headerAssetHandle: nextHeaderHandle,
			}));

			if (!nextHeaderHandle) {
				setLocalError(
					'La imagen se subió, pero el backend no devolvió un header_handle. Para templates IMAGE, Meta lo exige.'
				);
			}
		} catch (error) {
			setLocalError(error?.response?.data?.error || 'No se pudo subir la imagen del header.');
		} finally {
			setUploadingImage(false);
			event.target.value = '';
		}
	}

	function validatePayload(payload) {
	if (!payload.name) {
		return 'Poné un nombre interno para el template.';
	}

	const bodyComponent = payload.components.find((component) => component.type === 'BODY');
	const bodyText = bodyComponent?.text;

	if (!bodyText) {
		return 'El body del template es obligatorio.';
	}

	if (getVariableNumbers(bodyText).length && !bodyComponent?.example?.body_text?.[0]?.length) {
		return 'El body usa variables, pero faltan ejemplos. El builder debería armarlos solo.';
	}

	if (form.headerType === 'IMAGE' && !form.headerAssetHandle) {
		return 'Para templates con header IMAGE necesitás una imagen que devuelva header_handle.';
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

	async function handleSubmit(event) {
		event.preventDefault();

		if (isReadOnlyTemplate) {
			setLocalError('El template hello_world es de muestra de Meta y no se puede editar. Creá uno nuevo.');
			return;
		}

		const payload = buildPayload(form);
		const validationError = validatePayload(payload);

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
					<span className="campaigns-eyebrow">Editor</span>
					<h3>{isEditingSelectedTemplate ? 'Editar template' : 'Crear template nuevo'}</h3>
					<p>
						Armalo por bloques: estructura, contenido, botones y revisión final. Mucho más cerca de Meta y mucho menos dolor de cabeza.
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
				<div className={`template-builder-progress-step ${stepCompletion[0] ? 'is-done' : ''}`}>
					1. Base
				</div>
				<div className={`template-builder-progress-step ${stepCompletion[1] ? 'is-done' : ''}`}>
					2. Header
				</div>
				<div className={`template-builder-progress-step ${stepCompletion[2] ? 'is-done' : ''}`}>
					3. Contenido
				</div>
				<div className={`template-builder-progress-step ${stepCompletion[3] ? 'is-done' : ''}`}>
					4. Botones
				</div>
			</div>

			<div className="template-builder-layout">
				<form className="campaign-form template-builder-form" onSubmit={handleSubmit}>
					{isReadOnlyTemplate ? (
						<div className="template-builder-warning">
							<strong>Template de muestra de Meta.</strong>
							<span>
								`hello_world` se puede mirar, pero no editar. Apretá <strong>+ Nuevo template</strong> y armá uno propio.
							</span>
						</div>
					) : null}

					<section className={`template-builder-section ${stepCompletion[0] ? 'is-active' : ''}`}>
						<div className="template-builder-section-head">
							<div className="template-builder-section-step">1</div>
							<div>
								<h4>Estructura base</h4>
								<p>Definí nombre interno, idioma, categoría y el tipo de header.</p>
							</div>
						</div>

						<div className="template-builder-section-body">
							<div className="campaign-form-grid two-columns">
								<label className="field">
									<span>Nombre interno</span>
									<input
										value={form.name}
										onChange={(event) => updateForm('name', event.target.value)}
										placeholder="promo_invierno_body"
									/>
									<small>Usá nombres cortos, claros y sin espacios raros.</small>
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
							</div>

							<div className="template-toggle-grid">
								{['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].map((type) => (
									<button
										key={type}
										type="button"
										className={`template-type-card ${form.headerType === type ? 'active' : ''}`}
										onClick={() => {
											setForm((current) => ({
												...current,
												headerType: type,
												headerText: type === 'TEXT' ? current.headerText : '',
												...(type !== 'IMAGE'
													? {
														headerMediaId: '',
														headerMediaPreviewUrl: '',
														headerAssetHandle: '',
													}
													: {}),
											}));
										}}
									>
										<strong>{type}</strong>
										<span>
											{type === 'TEXT' && 'Título corto arriba del mensaje.'}
											{type === 'IMAGE' && 'Imagen destacada como cabecera.'}
											{type === 'VIDEO' && 'Preparado para ampliar después.'}
											{type === 'DOCUMENT' && 'Preparado para ampliar después.'}
										</span>
									</button>
								))}
							</div>
						</div>
					</section>

					<section className={`template-builder-section ${stepCompletion[1] ? 'is-active' : ''}`}>
						<div className="template-builder-section-head">
							<div className="template-builder-section-step">2</div>
							<div>
								<h4>Header</h4>
								<p>Elegí si querés texto o una imagen. Para IMAGE, Meta pide un handle de ejemplo.</p>
							</div>
						</div>

						<div className="template-builder-section-body">
							{form.headerType === 'TEXT' ? (
								<label className="field">
									<span>Texto del header</span>
									<input
										value={form.headerText}
										onChange={(event) => updateForm('headerText', event.target.value)}
										placeholder="Hola {{1}}"
									/>
									<small>Ideal para un título corto. No lo conviertas en una tesis.</small>
								</label>
							) : null}

							{form.headerType === 'IMAGE' ? (
								<div className="template-media-upload-box">
									<div className="template-media-upload-top">
										<div>
											<strong>Imagen del header</strong>
											<p>Subila acá y el builder intentará guardar tanto el media id como el header_handle.</p>
										</div>

										<label className="button ghost template-upload-button">
											<input
												type="file"
												accept="image/*"
												onChange={handleImageUpload}
												disabled={uploadingImage}
												style={{ display: 'none' }}
											/>
											{uploadingImage ? 'Subiendo…' : 'Subir imagen'}
										</label>
									</div>

									{form.headerMediaPreviewUrl ? (
										<div className="template-media-preview-card">
											<img src={form.headerMediaPreviewUrl} alt="Header preview" />
											<div className="template-media-preview-meta">
												<div>
													<div><strong>Vista previa cargada</strong></div>
													<div>{form.headerAssetHandle ? 'Header handle listo.' : 'Falta header handle.'}</div>
												</div>

												{form.headerAssetHandle ? <code>{form.headerAssetHandle}</code> : null}
											</div>
										</div>
									) : (
										<div className="template-media-empty">
											No hay imagen cargada todavía. Acá debería aparecer la vista previa.
										</div>
									)}

									<div className="template-helper-inline">
										<div><strong>Media ID:</strong> {form.headerMediaId || 'todavía no disponible'}</div>
										<div><strong>Header handle:</strong> {form.headerAssetHandle || 'todavía no disponible'}</div>
									</div>

									{form.headerMediaPreviewUrl || form.headerMediaId || form.headerAssetHandle ? (
										<div className="campaign-inline-actions">
											<button
												type="button"
												className="button ghost"
												onClick={() =>
													setForm((current) => ({
														...current,
														headerMediaId: '',
														headerMediaPreviewUrl: '',
														headerAssetHandle: '',
													}))
												}
											>
												Quitar imagen
											</button>
										</div>
									) : null}
								</div>
							) : null}

							{['VIDEO', 'DOCUMENT'].includes(form.headerType) ? (
								<div className="template-soft-empty">
									Dejé el camino listo para VIDEO y DOCUMENT, pero por ahora el flujo más sólido queda en TEXT e IMAGE. Primero resolvemos lo que más vende; después le metemos nitro al resto.
								</div>
							) : null}
						</div>
					</section>

					<section className={`template-builder-section ${stepCompletion[2] ? 'is-active' : ''}`}>
						<div className="template-builder-section-head">
							<div className="template-builder-section-step">3</div>
							<div>
								<h4>Contenido</h4>
								<p>Escribí el mensaje principal y el pie. Las variables se detectan solas.</p>
							</div>
						</div>

						<div className="template-builder-section-body">
							<label className="field">
								<span>Body</span>
								<textarea
									rows={8}
									value={form.bodyText}
									onChange={(event) => updateForm('bodyText', event.target.value)}
									placeholder="Hola {{1}}, tenemos una promo especial para vos..."
								/>
								<small>Este bloque es obligatorio. Acá vive el corazón del mensaje.</small>
							</label>

							<label className="field">
								<span>Footer</span>
								<input
									value={form.footerText}
									onChange={(event) => updateForm('footerText', event.target.value)}
									placeholder="Lummine · Atención por WhatsApp"
								/>
								<small>Opcional. Mejor si es corto.</small>
							</label>
						</div>
					</section>

					<section className={`template-builder-section ${stepCompletion[3] ? 'is-active' : ''}`}>
						<div className="template-builder-section-head">
							<div className="template-builder-section-step">4</div>
							<div>
								<h4>Botones y variables</h4>
								<p>Agregá llamadas a la acción claras. Máximo 3 botones.</p>
							</div>
						</div>

						<div className="template-builder-section-body">
							<div className="template-button-toolbar">
								<button
									type="button"
									className="button secondary"
									onClick={() => addButton('QUICK_REPLY')}
									disabled={form.buttons.length >= 3}
								>
									+ Respuesta rápida
								</button>
								<button
									type="button"
									className="button secondary"
									onClick={() => addButton('URL')}
									disabled={form.buttons.length >= 3}
								>
									+ Enlace
								</button>
								<button
									type="button"
									className="button secondary"
									onClick={() => addButton('PHONE_NUMBER')}
									disabled={form.buttons.length >= 3}
								>
									+ Llamada
								</button>
							</div>

							<div className="template-button-limit">
								{form.buttons.length}/3 botones usados
							</div>

							{form.buttons.length ? (
								<div className="template-button-list">
									{form.buttons.map((button, index) => (
										<div key={button.id} className="template-button-card">
											<div className="template-button-card-head">
												<strong>Botón {index + 1}</strong>
												<button
													type="button"
													className="button ghost"
													onClick={() => removeButton(button.id)}
												>
													Quitar
												</button>
											</div>

											<div className="template-button-card-grid">
												<label className="field">
													<span>Tipo</span>
													<select
														value={button.type}
														onChange={(event) =>
															updateButton(button.id, {
																type: event.target.value,
																url: event.target.value === 'URL' ? button.url : '',
																phoneNumber:
																	event.target.value === 'PHONE_NUMBER'
																		? button.phoneNumber
																		: '',
															})
														}
													>
														<option value="QUICK_REPLY">QUICK_REPLY</option>
														<option value="URL">URL</option>
														<option value="PHONE_NUMBER">PHONE_NUMBER</option>
													</select>
												</label>

												<label className="field">
													<span>Texto</span>
													<input
														value={button.text}
														onChange={(event) => updateButton(button.id, { text: event.target.value })}
														placeholder={`Botón ${index + 1}`}
													/>
												</label>
											</div>

											{button.type === 'URL' ? (
												<label className="field">
													<span>Enlace</span>
													<input
														value={button.url}
														onChange={(event) => updateButton(button.id, { url: event.target.value })}
														placeholder="https://tu-sitio.com/catalogo/{{1}}"
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
														placeholder="+5492210000000"
													/>
												</label>
											) : null}
										</div>
									))}
								</div>
							) : (
								<div className="template-soft-empty">
									Podés dejar el template sin botones o sumar hasta 3. Menos es más cuando el mensaje está bien pensado.
								</div>
							)}

							<div className="campaign-variable-box">
								<strong>Variables detectadas</strong>
								<div className="campaign-variable-list">
									{variables.length ? (
										variables.map((variable) => <span key={variable}>{`{{${variable}}}`}</span>)
									) : (
										<span className="template-variable-empty">Sin variables</span>
									)}
								</div>
							</div>
						</div>
					</section>

					<section className="template-builder-section is-active">
						<div className="template-builder-section-head">
							<div className="template-builder-section-step">5</div>
							<div>
								<h4>Revisión final</h4>
								<p>Antes de guardar, mirá si la estructura cierra y si Meta no te va a escupir el payload en la cara.</p>
							</div>
						</div>

						<div className="template-builder-section-body">
							<div className="template-review-grid">
								{reviewItems.map((item) => (
									<div key={item.label} className="template-review-card">
										<span>{item.label}</span>
										<strong>{item.value}</strong>
									</div>
								))}
							</div>

							{warnings.length ? (
								<div className="template-builder-warning">
									<strong>Chequeos rápidos</strong>
									<ul>
										{warnings.map((warning) => (
											<li key={warning}>{warning}</li>
										))}
									</ul>
								</div>
							) : null}

							{localError ? (
								<div className="template-builder-error">
									<strong>No se puede guardar todavía.</strong>
									<span>{localError}</span>
								</div>
							) : null}
						</div>
					</section>

					<div className="template-builder-submit-row campaign-form-actions">
						<button className="button primary" type="submit" disabled={creating || updating || uploadingImage}>
							{isEditingSelectedTemplate
								? updating
									? 'Guardando…'
									: 'Guardar cambios'
								: creating
									? 'Creando…'
									: 'Crear template'}
						</button>
					</div>
				</form>

				<aside className="template-preview-sidebar">
					<div className="template-preview-card-sticky">
						<div className="template-preview-meta">
							<div>
								<span className="template-preview-meta-label">Vista previa</span>
								<strong>{form.name || 'Template sin nombre todavía'}</strong>
							</div>

							<span className="campaign-badge draft">
								{isEditingSelectedTemplate ? 'EDITANDO' : 'NUEVO'}
							</span>
						</div>

						<div className="template-preview-stat-grid">
							<div className="template-preview-stat">
								<span>Completado</span>
								<strong>{completedCount}/4</strong>
							</div>
							<div className="template-preview-stat">
								<span>Botones</span>
								<strong>{previewButtons.length}</strong>
							</div>
							<div className="template-preview-stat">
								<span>Variables</span>
								<strong>{variables.length}</strong>
							</div>
						</div>

						<div className="campaign-preview-shell template-preview-shell--sticky">
							<div className="campaign-whatsapp-preview">
								<div className="campaign-preview-phone-bar">WhatsApp preview</div>

								<div className="campaign-preview-bubble">
									{form.headerType === 'TEXT' && form.headerText ? (
										<div className="campaign-preview-header">{form.headerText}</div>
									) : null}

									{form.headerType === 'IMAGE' ? (
										form.headerMediaPreviewUrl ? (
											<div className="template-preview-image-wrap">
												<img
													src={form.headerMediaPreviewUrl}
													alt="Header preview"
													className="template-preview-image"
												/>
											</div>
										) : (
											<div className="template-preview-image-empty">
												Acá se va a ver la imagen del header.
											</div>
										)
									) : null}

									<div className="campaign-preview-body">
										{form.bodyText || 'El cuerpo del template se ve acá.'}
									</div>

									{form.footerText ? <div className="campaign-preview-footer">{form.footerText}</div> : null}

									{previewButtons.length ? (
										<div className="campaign-preview-buttons">
											{previewButtons.map((button) => (
												<button key={button.id} type="button">
													{button.text}
													<small style={{ display: 'block', opacity: 0.7, fontSize: 11 }}>
														{describeButtonType(button.type)}
													</small>
												</button>
											))}
										</div>
									) : null}
								</div>
							</div>
						</div>

						<div className="template-preview-tip">
							Probalo como si fueras cliente: si en menos de dos segundos no se entiende qué querés que haga, todavía le falta una vuelta.
						</div>
					</div>
				</aside>
			</div>
		</section>
	);
}