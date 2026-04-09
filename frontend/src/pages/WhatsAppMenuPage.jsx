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
	return ACTION_TYPES.find((item) => item.value === actionType)?.label || actionType;
}

function getIntentLabel(intentValue) {
	return INTENT_OPTIONS.find((item) => item.value === intentValue)?.label || intentValue || 'No definida';
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

	const stats = useMemo(() => {
		if (!config) {
			return {
				totalMenus: 0,
				totalOptions: 0,
				activeOptions: 0
			};
		}

		const totalMenus = config.menus.length;
		const totalOptions = config.menus.reduce((acc, menu) => acc + (menu.options?.length || 0), 0);
		const activeOptions = config.menus.reduce(
			(acc, menu) => acc + (menu.options?.filter((option) => option.isActive !== false).length || 0),
			0
		);

		return { totalMenus, totalOptions, activeOptions };
	}, [config]);

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
			setFeedback('Menú guardado. La nueva configuración ya quedó lista para usarse.');
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
			<div className="wam-hero">
				<div className="wam-hero__content">
					<div className="wam-eyebrow">WhatsApp Menu Builder</div>
					<h1>Menú de WhatsApp</h1>
					<p>
						Editá la estructura del menú, el texto que ve el cliente y el flujo que dispara cada opción
						sin perderte en un formulario eterno.
					</p>
				</div>

				<div className="wam-hero__actions">
					<button
						type="button"
						className="wam-button wam-button--ghost"
						onClick={handleReset}
						disabled={saving}
					>
						Restaurar default
					</button>
					<button type="button" className="wam-button" onClick={handleSave} disabled={saving}>
						{saving ? 'Guardando...' : 'Guardar cambios'}
					</button>
				</div>
			</div>

			<div className="wam-stats">
				<div className="wam-stat-card">
					<span>Menús</span>
					<strong>{stats.totalMenus}</strong>
				</div>
				<div className="wam-stat-card">
					<span>Opciones totales</span>
					<strong>{stats.totalOptions}</strong>
				</div>
				<div className="wam-stat-card">
					<span>Opciones activas</span>
					<strong>{stats.activeOptions}</strong>
				</div>
				<div className="wam-stat-card">
					<span>Menú inicial</span>
					<strong>{config.menus.find((menu) => menu.key === config.mainMenuKey)?.title || 'Sin definir'}</strong>
				</div>
			</div>

			<div className="wam-toolbar wam-panel">
				<div className="wam-section-heading">
					<div>
						<h2>Configuración general</h2>
						<p>Definí el nombre interno de esta configuración y cuál es el menú que arranca primero.</p>
					</div>
				</div>

				<div className="wam-toolbar__grid">
					<label>
						<span>Nombre de la configuración</span>
						<input
							value={settingsName}
							onChange={(event) => setSettingsName(event.target.value)}
							placeholder="Ej: Configuración principal"
						/>
					</label>

					<label>
						<span>Menú inicial</span>
						<select
							value={config.mainMenuKey}
							onChange={(event) =>
								setConfig((current) => ({ ...current, mainMenuKey: event.target.value }))
							}
						>
							{config.menus.map((menu) => (
								<option key={menu.key} value={menu.key}>
									{menu.title}
								</option>
							))}
						</select>
					</label>
				</div>
			</div>

			{feedback ? <div className="wam-alert wam-alert--success">{feedback}</div> : null}
			{error ? <div className="wam-alert wam-alert--error">{error}</div> : null}

			<div className="wam-grid">
				<aside className="wam-sidebar">
					<div className="wam-panel wam-panel--sticky">
						<div className="wam-panel__header">
							<div>
								<h2>Menús</h2>
								<p className="wam-panel__subtext">Elegí qué bloque querés editar.</p>
							</div>
							<button type="button" className="wam-link-button" onClick={addMenu}>
								+ Agregar menú
							</button>
						</div>

						<div className="wam-menu-list">
							{config.menus.map((menu, index) => {
								const isActive = menu.key === selectedMenuKey;
								const activeOptionsCount = menu.options?.filter((option) => option.isActive !== false).length || 0;

								return (
									<button
										key={menu.key}
										type="button"
										className={`wam-menu-card ${isActive ? 'is-active' : ''}`}
										onClick={() => setSelectedMenuKey(menu.key)}
									>
										<div className="wam-menu-card__top">
											<div className="wam-menu-card__title-wrap">
												<span className="wam-menu-card__index">Menú {index + 1}</span>
												<strong>{menu.title}</strong>
											</div>
											{config.mainMenuKey === menu.key ? <span className="wam-badge">Inicial</span> : null}
										</div>

										<p>{menu.body || 'Sin mensaje principal.'}</p>

										<div className="wam-menu-card__meta">
											<span>{menu.options?.length || 0} opciones</span>
											<span>{activeOptionsCount} activas</span>
										</div>
									</button>
								);
							})}
						</div>
					</div>
				</aside>

				<section className="wam-editor">
					{selectedMenu ? (
						<>
							<div className="wam-panel">
								<div className="wam-panel__header">
									<div>
										<h2>Editor del menú</h2>
										<p className="wam-panel__subtext">
											Acá definís el bloque general del menú seleccionado.
										</p>
									</div>

									<button
										type="button"
										className="wam-link-button wam-link-button--danger"
										onClick={() => removeMenu(selectedMenu.key)}
									>
										Eliminar menú
									</button>
								</div>

								<div className="wam-section-block">
									<div className="wam-section-heading">
										<div>
											<h3>Datos básicos</h3>
											<p>Lo mínimo para identificar el menú y mostrarlo bien en WhatsApp.</p>
										</div>
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
									</div>
								</div>

								<div className="wam-section-block">
									<div className="wam-section-heading">
										<div>
											<h3>Mensaje visible</h3>
											<p>Esto es lo que el cliente ve cuando se abre este menú.</p>
										</div>
									</div>

									<div className="wam-form-grid">
										<label className="wam-form-grid__full">
											<span>Cuerpo</span>
											<textarea
												rows={4}
												value={selectedMenu.body}
												onChange={(event) => updateMenuField(selectedMenu.key, 'body', event.target.value)}
												placeholder="Ej: Elegí una opción para ayudarte más rápido:"
											/>
										</label>

										<label className="wam-form-grid__full">
											<span>Footer</span>
											<input
												value={selectedMenu.footerText}
												onChange={(event) => updateMenuField(selectedMenu.key, 'footerText', event.target.value)}
												placeholder="Ej: Escribí 0 o menú para volver al inicio."
											/>
										</label>
									</div>
								</div>

								<div className="wam-section-block">
									<div className="wam-section-heading">
										<div>
											<h3>Organización</h3>
											<p>Sirve para ordenar cómo aparece este menú y cómo se agrupan sus opciones.</p>
										</div>
									</div>

									<div className="wam-form-grid">
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
							</div>

							<div className="wam-panel">
								<div className="wam-panel__header">
									<div>
										<h2>Opciones del menú</h2>
										<p className="wam-panel__subtext">
											Cada tarjeta representa una opción que puede tocar o escribir el cliente.
										</p>
									</div>

									<button type="button" className="wam-link-button" onClick={() => addOption(selectedMenu.key)}>
										+ Agregar opción
									</button>
								</div>

								<div className="wam-option-list">
									{sortedSelectedOptions.map((option, index) => (
										<div key={option.id} className="wam-option-card">
											<div className="wam-option-card__header">
												<div className="wam-option-card__title-group">
													<div className="wam-option-card__eyebrow">Opción {index + 1}</div>
													<h3>{option.title || 'Nueva opción'}</h3>
													<div className="wam-option-card__chips">
														<span className="wam-chip">{getActionLabel(option.actionType)}</span>
														<span className={`wam-chip ${option.isActive !== false ? 'is-success' : 'is-muted'}`}>
															{option.isActive !== false ? 'Activa' : 'Inactiva'}
														</span>
													</div>
												</div>

												<button
													type="button"
													className="wam-link-button wam-link-button--danger"
													onClick={() => removeOption(selectedMenu.key, option.id)}
												>
													Eliminar
												</button>
											</div>

											<div className="wam-option-card__summary">
												<div>
													<span>Descripción</span>
													<strong>{option.description || 'Sin descripción'}</strong>
												</div>
												<div>
													<span>Orden</span>
													<strong>{option.sortOrder || index + 1}</strong>
												</div>
												<div>
													<span>Alias</span>
													<strong>{option.aliases?.length ? aliasesToText(option.aliases) : 'Sin alias'}</strong>
												</div>
											</div>

											<div className="wam-section-block wam-section-block--soft">
												<div className="wam-section-heading">
													<div>
														<h3>Contenido principal</h3>
														<p>Lo básico para que la opción quede clara y funcione.</p>
													</div>
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
															placeholder="Texto corto que el cliente ve debajo del título"
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
															placeholder="Ej: 1, productos, ver productos"
														/>
														<small>Separalos con coma. Sirven para detectar variaciones del texto del usuario.</small>
													</label>
												</div>
											</div>

											{option.actionType === 'SUBMENU' ? (
												<div className="wam-section-block">
													<div className="wam-section-heading">
														<div>
															<h3>Destino del submenú</h3>
															<p>Elegí a qué menú debe mandar esta opción.</p>
														</div>
													</div>

													<div className="wam-form-grid">
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
															<span>Texto antes de mostrar submenú</span>
															<input
																value={option.promptPrefix || ''}
																onChange={(event) =>
																	updateOptionField(selectedMenu.key, option.id, 'promptPrefix', event.target.value)
																}
																placeholder="Ej: Perfecto. Vamos por productos."
															/>
														</label>
													</div>
												</div>
											) : null}

											{option.actionType === 'INTENT' ? (
												<div className="wam-section-block">
													<div className="wam-section-heading">
														<div>
															<h3>Configuración de intención</h3>
															<p>Esta opción dispara un flujo interno para la IA.</p>
														</div>
													</div>

													<div className="wam-form-grid">
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

														<div className="wam-inline-info">
															<span>Intención actual</span>
															<strong>{getIntentLabel(option.actionValue)}</strong>
														</div>

														<label className="wam-form-grid__full">
															<span>Mensaje interno que usa la IA</span>
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
																placeholder="Ej: El cliente quiere ver productos destacados."
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
																placeholder="Ej: Consultó por productos"
															/>
														</label>
													</div>
												</div>
											) : null}

											{option.actionType === 'MESSAGE' || option.actionType === 'HUMAN' ? (
												<div className="wam-section-block">
													<div className="wam-section-heading">
														<div>
															<h3>Respuesta</h3>
															<p>Este texto se envía como respuesta directa.</p>
														</div>
													</div>

													<div className="wam-form-grid">
														<label className="wam-form-grid__full">
															<span>Respuesta</span>
															<textarea
																rows={4}
																value={option.replyBody || ''}
																onChange={(event) =>
																	updateOptionField(selectedMenu.key, option.id, 'replyBody', event.target.value)
																}
																placeholder="Escribí la respuesta que va a recibir el cliente"
															/>
														</label>
													</div>
												</div>
											) : null}

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
															placeholder="Ej: Bodys modeladores"
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
															placeholder="Ej: Comprar, consultar, resolver pago"
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
															placeholder="Ej: body reductor, calza premium"
														/>
														<small>Separalos con coma.</small>
													</label>
												</div>
											</details>
										</div>
									))}
								</div>
							</div>
						</>
					) : (
						<div className="wam-empty">Elegí un menú para editar.</div>
					)}
				</section>

				<aside className="wam-preview">
					<div className="wam-panel wam-panel--sticky">
						<div className="wam-panel__header">
							<div>
								<h2>Preview</h2>
								<p className="wam-panel__subtext">Vista rápida de cómo se vería este menú.</p>
							</div>
						</div>

						{selectedMenu ? (
							<div className="wam-phone-preview">
								<div className="wam-phone-preview__topbar">
									<div className="wam-phone-preview__avatar">L</div>
									<div>
										<div className="wam-phone-preview__brand">
											{selectedMenu.headerText || selectedMenu.title || 'Lummine'}
										</div>
										<div className="wam-phone-preview__status">Mensaje interactivo</div>
									</div>
								</div>

								<div className="wam-phone-preview__screen">
									<div className="wam-phone-bubble">
										<p>{selectedMenu.body}</p>

										<div className="wam-phone-options">
											{sortedSelectedOptions
												.filter((option) => option.isActive !== false)
												.map((option) => (
													<div key={option.id} className="wam-phone-option">
														<strong>{option.title}</strong>
														<span>{option.description || 'Sin descripción'}</span>
													</div>
												))}
										</div>

										<small>{selectedMenu.footerText}</small>
									</div>

									<div className="wam-phone-preview__cta">{selectedMenu.buttonText}</div>
								</div>
							</div>
						) : null}
					</div>
				</aside>
			</div>
		</div>
	);
}