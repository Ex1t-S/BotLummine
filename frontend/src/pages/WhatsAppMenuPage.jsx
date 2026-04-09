import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api.js';
import '../styles/WhatsAppMenuPage.css';

const ACTION_TYPES = [
	{ value: 'SUBMENU', label: 'Abrir submenú' },
	{ value: 'INTENT', label: 'Disparar intención' },
	{ value: 'MESSAGE', label: 'Responder texto' },
	{ value: 'HUMAN', label: 'Derivar a humano' }
];

const INTENT_OPTIONS = [
	{ value: 'product', label: 'Producto' },
	{ value: 'order_status', label: 'Estado de pedido' },
	{ value: 'payment', label: 'Pagos' },
	{ value: 'shipping', label: 'Envíos' },
	{ value: 'size_help', label: 'Talles' }
];

function createEmptyOption(nextIndex = 1) {
	return {
		id: `menu_option_${Date.now()}_${nextIndex}`,
		title: 'Nueva opción',
		description: '',
		aliases: [String(nextIndex)],
		actionType: 'MESSAGE',
		actionValue: '',
		promptPrefix: '',
		replyBody: 'Contame un poco más y seguimos por acá.',
		effectiveMessageBody: '',
		summaryUserMessage: '',
		statePatch: {},
		isActive: true,
		sortOrder: nextIndex
	};
}

function createEmptyMenu(nextIndex = 1) {
	return {
		key: `MENU_${Date.now()}_${nextIndex}`,
		title: 'Nuevo menú',
		headerText: 'Nuevo menú',
		body: 'Elegí una opción:',
		buttonText: 'Ver opciones',
		footerText: 'Escribí 0 o menú para volver al inicio.',
		sectionTitle: 'Opciones',
		textFallback: '',
		isActive: true,
		sortOrder: nextIndex,
		options: [createEmptyOption(1)]
	};
}

function deepClone(value) {
	return JSON.parse(JSON.stringify(value));
}

function aliasesToText(aliases = []) {
	return (Array.isArray(aliases) ? aliases : []).join(', ');
}

function textToAliases(text = '') {
	return String(text || '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
}

function updateStatePatch(menuConfig, menuKey, optionId, patchKey, value) {
	return {
		...menuConfig,
		menus: menuConfig.menus.map((menu) => {
			if (menu.key !== menuKey) return menu;

			return {
				...menu,
				options: menu.options.map((option) => {
					if (option.id !== optionId) return option;

					const nextStatePatch = { ...(option.statePatch || {}) };

					if (value === '' || value === null || value === undefined) {
						delete nextStatePatch[patchKey];
					} else {
						nextStatePatch[patchKey] = value;
					}

					return {
						...option,
						statePatch: nextStatePatch
					};
				})
			};
		})
	};
}

function getActionLabel(actionType) {
	return ACTION_TYPES.find((action) => action.value === actionType)?.label || actionType;
}

function sortOptions(options = []) {
	return [...options].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

export default function WhatsAppMenuPage() {
	const [config, setConfig] = useState(null);
	const [settingsName, setSettingsName] = useState('Configuración principal');
	const [selectedMenuKey, setSelectedMenuKey] = useState('');
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [feedback, setFeedback] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		loadMenu();
	}, []);

	async function loadMenu() {
		setLoading(true);
		setError('');
		setFeedback('');

		try {
			const response = await api.get('/whatsapp-menu');
			const nextConfig = deepClone(response.data?.settings?.config || { version: 1, mainMenuKey: '', menus: [] });

			setConfig(nextConfig);
			setSettingsName(response.data?.settings?.name || 'Configuración principal');
			setSelectedMenuKey(nextConfig.mainMenuKey || nextConfig.menus?.[0]?.key || '');
		} catch (requestError) {
			setError(requestError?.response?.data?.error || 'No pude cargar el menú de WhatsApp.');
		} finally {
			setLoading(false);
		}
	}

	const selectedMenu = useMemo(() => {
		if (!config) return null;
		return config.menus.find((menu) => menu.key === selectedMenuKey) || config.menus[0] || null;
	}, [config, selectedMenuKey]);

	const sortedSelectedOptions = useMemo(() => sortOptions(selectedMenu?.options || []), [selectedMenu]);

	function updateMenuField(menuKey, field, value) {
		setConfig((current) => {
			const nextMenus = current.menus.map((menu) => (menu.key === menuKey ? { ...menu, [field]: value } : menu));

			if (field === 'key') {
				const normalizedValue = String(value || '').trim();

				const remappedMenus = nextMenus.map((menu) => ({
					...menu,
					options: menu.options.map((option) =>
						option.actionType === 'SUBMENU' && option.actionValue === menuKey
							? { ...option, actionValue: normalizedValue }
							: option
					)
				}));

				if (selectedMenuKey === menuKey) {
					setSelectedMenuKey(normalizedValue);
				}

				return {
					...current,
					mainMenuKey: current.mainMenuKey === menuKey ? normalizedValue : current.mainMenuKey,
					menus: remappedMenus
				};
			}

			return {
				...current,
				menus: nextMenus
			};
		});
	}

	function updateOptionField(menuKey, optionId, field, value) {
		setConfig((current) => ({
			...current,
			menus: current.menus.map((menu) => {
				if (menu.key !== menuKey) return menu;

				return {
					...menu,
					options: menu.options.map((option) => (option.id === optionId ? { ...option, [field]: value } : option))
				};
			})
		}));
	}

	function addMenu() {
		setConfig((current) => {
			const nextMenu = createEmptyMenu(current.menus.length + 1);
			const nextConfig = {
				...current,
				menus: [...current.menus, nextMenu]
			};

			setSelectedMenuKey(nextMenu.key);
			return nextConfig;
		});
	}

	function removeMenu(menuKey) {
		setConfig((current) => {
			if (current.menus.length <= 1) return current;

			const nextMenus = current.menus.filter((menu) => menu.key !== menuKey);
			const nextMainKey = current.mainMenuKey === menuKey ? nextMenus[0]?.key || '' : current.mainMenuKey;

			setSelectedMenuKey(nextMenus[0]?.key || '');

			return {
				...current,
				mainMenuKey: nextMainKey,
				menus: nextMenus
			};
		});
	}

	function addOption(menuKey) {
		setConfig((current) => ({
			...current,
			menus: current.menus.map((menu) => {
				if (menu.key !== menuKey) return menu;

				return {
					...menu,
					options: [...menu.options, createEmptyOption(menu.options.length + 1)]
				};
			})
		}));
	}

	function removeOption(menuKey, optionId) {
		setConfig((current) => ({
			...current,
			menus: current.menus.map((menu) => {
				if (menu.key !== menuKey) return menu;
				if (menu.options.length <= 1) return menu;

				return {
					...menu,
					options: menu.options.filter((option) => option.id !== optionId)
				};
			})
		}));
	}

	async function handleSave() {
		if (!config) return;

		setSaving(true);
		setError('');
		setFeedback('');

		try {
			const payload = {
				name: settingsName,
				config
			};

			const response = await api.put('/whatsapp-menu', payload);
			const nextConfig = deepClone(response.data?.settings?.config || config);

			setConfig(nextConfig);
			setSelectedMenuKey(nextConfig.mainMenuKey || nextConfig.menus?.[0]?.key || '');
			setFeedback('Menú guardado correctamente.');
		} catch (requestError) {
			setError(requestError?.response?.data?.error || 'No pude guardar los cambios del menú.');
		} finally {
			setSaving(false);
		}
	}

	async function handleReset() {
		setSaving(true);
		setError('');
		setFeedback('');

		try {
			const response = await api.post('/whatsapp-menu/reset');
			const nextConfig = deepClone(response.data?.settings?.config || { version: 1, mainMenuKey: '', menus: [] });

			setConfig(nextConfig);
			setSettingsName(response.data?.settings?.name || 'Configuración principal');
			setSelectedMenuKey(nextConfig.mainMenuKey || nextConfig.menus?.[0]?.key || '');
			setFeedback('Se restauró el menú por defecto.');
		} catch (requestError) {
			setError(requestError?.response?.data?.error || 'No pude restaurar el menú por defecto.');
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return (
			<div className="wam-page">
				<div className="wam-empty">Cargando editor de menú...</div>
			</div>
		);
	}

	if (!config) {
		return (
			<div className="wam-page">
				<div className="wam-empty">No hay configuración para mostrar.</div>
			</div>
		);
	}

	return (
		<div className="wam-page">
			<section className="wam-hero">
				<div className="wam-hero__content">
					<span className="wam-hero__eyebrow">Automatización · WhatsApp</span>
					<h1>Editor de menú</h1>
					<p>
						Editá el menú principal, los submenús y el flujo de cada opción con una interfaz más simple y
						clara.
					</p>
				</div>

				<div className="wam-hero__actions">
					<button
						type="button"
						className="wam-button wam-button--secondary"
						onClick={handleReset}
						disabled={saving}
					>
						Restaurar default
					</button>

					<button type="button" className="wam-button wam-button--primary" onClick={handleSave} disabled={saving}>
						{saving ? 'Guardando...' : 'Guardar cambios'}
					</button>
				</div>
			</section>

			<section className="wam-card wam-topbar">
				<div className="wam-section-head">
					<div>
						<span className="wam-section-label">Configuración general</span>
						<h2>Ajustes base</h2>
						<p>Definí el nombre de la configuración y cuál es el menú inicial.</p>
					</div>
				</div>

				<div className="wam-form-grid">
					<label>
						<span>Nombre de la configuración</span>
						<input
							value={settingsName}
							onChange={(event) => setSettingsName(event.target.value)}
							placeholder="Configuración principal"
						/>
					</label>

					<label>
						<span>Menú inicial</span>
						<select
							value={config.mainMenuKey}
							onChange={(event) => setConfig((current) => ({ ...current, mainMenuKey: event.target.value }))}
						>
							{config.menus.map((menu) => (
								<option key={menu.key} value={menu.key}>
									{menu.title}
								</option>
							))}
						</select>
					</label>
				</div>
			</section>

			{feedback ? <div className="wam-alert wam-alert--success">{feedback}</div> : null}
			{error ? <div className="wam-alert wam-alert--error">{error}</div> : null}

			<div className="wam-layout">
				<aside className="wam-card wam-sidebar">
					<div className="wam-sidebar__header">
						<div>
							<span className="wam-section-label">Menús</span>
							<h2>Lista de menús</h2>
						</div>

						<button type="button" className="wam-button wam-button--secondary wam-button--small" onClick={addMenu}>
							+ Agregar
						</button>
					</div>

					<div className="wam-menu-list">
						{config.menus.map((menu, index) => {
							const isSelected = menu.key === selectedMenuKey;
							const totalOptions = menu.options?.length || 0;

							return (
								<button
									key={menu.key}
									type="button"
									className={`wam-menu-item ${isSelected ? 'is-active' : ''}`}
									onClick={() => setSelectedMenuKey(menu.key)}
								>
									<div className="wam-menu-item__top">
										<span className="wam-menu-item__index">Menú {index + 1}</span>
										{config.mainMenuKey === menu.key ? <span className="wam-chip">Inicial</span> : null}
									</div>

									<strong>{menu.title}</strong>
									<p>{menu.body || 'Sin texto principal'}</p>

									<div className="wam-menu-item__meta">
										<span>{totalOptions} opciones</span>
									</div>
								</button>
							);
						})}
					</div>
				</aside>

				<section className="wam-card wam-editor">
					{selectedMenu ? (
						<>
							<div className="wam-editor__header">
								<div>
									<span className="wam-section-label">Menú seleccionado</span>
									<h2>{selectedMenu.title}</h2>
									<p>Editá los datos generales y las opciones de este menú.</p>
								</div>

								<button
									type="button"
									className="wam-button wam-button--danger wam-button--small"
									onClick={() => removeMenu(selectedMenu.key)}
								>
									Eliminar menú
								</button>
							</div>

							<div className="wam-block">
								<div className="wam-block__header">
									<h3>Datos del menú</h3>
								</div>

								<div className="wam-form-grid">
									<label>
										<span>Clave interna</span>
										<input
											value={selectedMenu.key}
											onChange={(event) => updateMenuField(selectedMenu.key, 'key', event.target.value)}
										/>
									</label>

									<label>
										<span>Título</span>
										<input
											value={selectedMenu.title}
											onChange={(event) => updateMenuField(selectedMenu.key, 'title', event.target.value)}
										/>
									</label>

									<label>
										<span>Header</span>
										<input
											value={selectedMenu.headerText}
											onChange={(event) => updateMenuField(selectedMenu.key, 'headerText', event.target.value)}
										/>
									</label>

									<label>
										<span>Texto del botón</span>
										<input
											value={selectedMenu.buttonText}
											onChange={(event) => updateMenuField(selectedMenu.key, 'buttonText', event.target.value)}
										/>
									</label>

									<label className="wam-form-grid__full">
										<span>Cuerpo</span>
										<textarea
											rows={4}
											value={selectedMenu.body}
											onChange={(event) => updateMenuField(selectedMenu.key, 'body', event.target.value)}
										/>
									</label>

									<label className="wam-form-grid__full">
										<span>Footer</span>
										<input
											value={selectedMenu.footerText}
											onChange={(event) => updateMenuField(selectedMenu.key, 'footerText', event.target.value)}
										/>
									</label>

									<label>
										<span>Título de sección</span>
										<input
											value={selectedMenu.sectionTitle || ''}
											onChange={(event) => updateMenuField(selectedMenu.key, 'sectionTitle', event.target.value)}
										/>
									</label>

									<label>
										<span>Orden</span>
										<input
											type="number"
											value={selectedMenu.sortOrder || 1}
											onChange={(event) =>
												updateMenuField(selectedMenu.key, 'sortOrder', Number(event.target.value) || 1)
											}
										/>
									</label>
								</div>
							</div>

							<div className="wam-block">
								<div className="wam-block__header wam-block__header--between">
									<h3>Opciones</h3>

									<button
										type="button"
										className="wam-button wam-button--secondary wam-button--small"
										onClick={() => addOption(selectedMenu.key)}
									>
										+ Agregar opción
									</button>
								</div>

								<div className="wam-options-list">
									{sortedSelectedOptions.map((option, index) => (
										<details key={option.id} className="wam-option-card" open={index === 0}>
											<summary className="wam-option-card__summary">
												<div className="wam-option-card__summary-main">
													<span className="wam-option-card__eyebrow">Opción {index + 1}</span>
													<strong>{option.title || 'Nueva opción'}</strong>
													<p>{option.description || 'Sin descripción'}</p>
												</div>

												<div className="wam-option-card__summary-side">
													<span className="wam-pill">{getActionLabel(option.actionType)}</span>
													<span className="wam-pill wam-pill--soft">Orden {option.sortOrder || index + 1}</span>
												</div>
											</summary>

											<div className="wam-option-card__content">
												<div className="wam-option-card__actions">
													<button
														type="button"
														className="wam-button wam-button--danger wam-button--small"
														onClick={() => removeOption(selectedMenu.key, option.id)}
													>
														Eliminar
													</button>
												</div>

												<div className="wam-form-grid">
													<label>
														<span>ID</span>
														<input
															value={option.id}
															onChange={(event) => updateOptionField(selectedMenu.key, option.id, 'id', event.target.value)}
														/>
													</label>

													<label>
														<span>Título</span>
														<input
															value={option.title}
															onChange={(event) => updateOptionField(selectedMenu.key, option.id, 'title', event.target.value)}
														/>
													</label>

													<label className="wam-form-grid__full">
														<span>Descripción</span>
														<input
															value={option.description || ''}
															onChange={(event) =>
																updateOptionField(selectedMenu.key, option.id, 'description', event.target.value)
															}
														/>
													</label>

													<label>
														<span>Acción</span>
														<select
															value={option.actionType}
															onChange={(event) =>
																updateOptionField(selectedMenu.key, option.id, 'actionType', event.target.value)
															}
														>
															{ACTION_TYPES.map((action) => (
																<option key={action.value} value={action.value}>
																	{action.label}
																</option>
															))}
														</select>
													</label>

													<label>
														<span>Orden</span>
														<input
															type="number"
															value={option.sortOrder || index + 1}
															onChange={(event) =>
																updateOptionField(
																	selectedMenu.key,
																	option.id,
																	'sortOrder',
																	Number(event.target.value) || index + 1
																)
															}
														/>
													</label>

													<label className="wam-form-grid__full">
														<span>Aliases</span>
														<input
															value={aliasesToText(option.aliases)}
															onChange={(event) =>
																updateOptionField(
																	selectedMenu.key,
																	option.id,
																	'aliases',
																	textToAliases(event.target.value)
																)
															}
															placeholder="1, productos, ver productos"
														/>
													</label>

													{option.actionType === 'SUBMENU' ? (
														<>
															<label>
																<span>Ir al menú</span>
																<select
																	value={option.actionValue || ''}
																	onChange={(event) =>
																		updateOptionField(selectedMenu.key, option.id, 'actionValue', event.target.value)
																	}
																>
																	{config.menus.map((menu) => (
																		<option key={menu.key} value={menu.key}>
																			{menu.title}
																		</option>
																	))}
																</select>
															</label>

															<label className="wam-form-grid__full">
																<span>Texto previo</span>
																<input
																	value={option.promptPrefix || ''}
																	onChange={(event) =>
																		updateOptionField(selectedMenu.key, option.id, 'promptPrefix', event.target.value)
																	}
																/>
															</label>
														</>
													) : null}

													{option.actionType === 'INTENT' ? (
														<>
															<label>
																<span>Intención</span>
																<select
																	value={option.actionValue || ''}
																	onChange={(event) =>
																		updateOptionField(selectedMenu.key, option.id, 'actionValue', event.target.value)
																	}
																>
																	{INTENT_OPTIONS.map((intent) => (
																		<option key={intent.value} value={intent.value}>
																			{intent.label}
																		</option>
																	))}
																</select>
															</label>

															<label className="wam-form-grid__full">
																<span>Mensaje interno para IA</span>
																<input
																	value={option.effectiveMessageBody || ''}
																	onChange={(event) =>
																		updateOptionField(
																			selectedMenu.key,
																			option.id,
																			'effectiveMessageBody',
																			event.target.value
																		)
																	}
																/>
															</label>

															<label className="wam-form-grid__full">
																<span>Resumen para historial</span>
																<input
																	value={option.summaryUserMessage || ''}
																	onChange={(event) =>
																		updateOptionField(
																			selectedMenu.key,
																			option.id,
																			'summaryUserMessage',
																			event.target.value
																		)
																	}
																/>
															</label>
														</>
													) : null}

													{option.actionType === 'MESSAGE' || option.actionType === 'HUMAN' ? (
														<label className="wam-form-grid__full">
															<span>Respuesta</span>
															<textarea
																rows={4}
																value={option.replyBody || ''}
																onChange={(event) =>
																	updateOptionField(selectedMenu.key, option.id, 'replyBody', event.target.value)
																}
															/>
														</label>
													) : null}
												</div>

												<details className="wam-advanced">
													<summary>Configuración avanzada</summary>

													<div className="wam-form-grid">
														<label>
															<span>Foco de producto</span>
															<input
																value={option.statePatch?.currentProductFocus || ''}
																onChange={(event) =>
																	setConfig((current) =>
																		updateStatePatch(
																			current,
																			selectedMenu.key,
																			option.id,
																			'currentProductFocus',
																			event.target.value
																		)
																	)
																}
															/>
														</label>

														<label>
															<span>Objetivo del cliente</span>
															<input
																value={option.statePatch?.lastUserGoal || ''}
																onChange={(event) =>
																	setConfig((current) =>
																		updateStatePatch(
																			current,
																			selectedMenu.key,
																			option.id,
																			'lastUserGoal',
																			event.target.value
																		)
																	)
																}
															/>
														</label>

														<label className="wam-form-grid__full">
															<span>Productos de interés</span>
															<input
																value={aliasesToText(option.statePatch?.interestedProducts || [])}
																onChange={(event) =>
																	setConfig((current) =>
																		updateStatePatch(
																			current,
																			selectedMenu.key,
																			option.id,
																			'interestedProducts',
																			textToAliases(event.target.value)
																		)
																	)
																}
																placeholder="body, calza, conjunto"
															/>
														</label>
													</div>
												</details>
											</div>
										</details>
									))}
								</div>
							</div>
						</>
					) : (
						<div className="wam-empty">Elegí un menú para editar.</div>
					)}
				</section>

				<aside className="wam-card wam-preview">
					<div className="wam-preview__header">
						<span className="wam-section-label">Preview</span>
						<h2>Vista previa</h2>
						<p>Una referencia rápida de cómo se va a ver el mensaje.</p>
					</div>

					{selectedMenu ? (
						<div className="wam-phone">
							<div className="wam-phone__top">
								<div className="wam-phone__avatar">L</div>
								<div>
									<strong>{selectedMenu.headerText || selectedMenu.title || 'Lummine'}</strong>
									<span>Mensaje interactivo</span>
								</div>
							</div>

							<div className="wam-phone__screen">
								<div className="wam-phone__bubble">
									<p>{selectedMenu.body}</p>

									<div className="wam-phone__options">
										{sortedSelectedOptions
											.filter((option) => option.isActive !== false)
											.map((option) => (
												<div key={option.id} className="wam-phone__option">
													<strong>{option.title}</strong>
													<span>{option.description || 'Sin descripción'}</span>
												</div>
											))}
									</div>

									<small>{selectedMenu.footerText}</small>
								</div>

								<button type="button" className="wam-phone__button">
									{selectedMenu.buttonText}
								</button>
							</div>
						</div>
					) : null}
				</aside>
			</div>
		</div>
	);
}