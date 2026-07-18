import { useEffect, useMemo, useState } from 'react';
import {
	Bot,
	Check,
	ChevronRight,
	CreditCard,
	Eye,
	ListTree,
	MessageSquareText,
	PackageSearch,
	Plus,
	RotateCcw,
	Save,
	Settings2,
	ShoppingBag,
	Truck,
	UserRoundCheck,
} from 'lucide-react';
import api from '../lib/api.js';
import { ActionButton, EmptyState, PageHeader } from '../components/ui/InternalPage.jsx';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
import '../styles/WhatsAppMenuPage.css';

const ACTION_TYPES = [
	{ value: 'SUBMENU', label: 'Abrir otro menú' },
	{ value: 'INTENT', label: 'La IA continúa la conversación' },
	{ value: 'MESSAGE', label: 'Responder un texto fijo' },
	{ value: 'HUMAN', label: 'Pasar a humano' },
];

const INTENT_OPTIONS = [
	{ value: 'product', label: 'Producto' },
	{ value: 'order_status', label: 'Estado de pedido' },
	{ value: 'payment', label: 'Pagos' },
	{ value: 'shipping', label: 'Envíos' },
	{ value: 'size_help', label: 'Talles' },
];

const OPTION_PRESETS = [
	{
		key: 'products',
		label: 'Productos',
		description: 'La IA sigue como consulta de producto.',
		icon: ShoppingBag,
		option: {
			title: 'Ver productos',
			description: 'Catálogo y recomendaciones',
			aliases: ['1', 'productos', 'catalogo', 'ver productos'],
			actionType: 'INTENT',
			actionValue: 'product',
			effectiveMessageBody: 'Quiero ver productos y recibir una recomendacion',
			statePatch: { salesStage: 'DISCOVERY' },
		},
	},
	{
		key: 'orders',
		label: 'Pedidos',
		description: 'Consulta de estado o seguimiento.',
		icon: PackageSearch,
		option: {
			title: 'Estado de mi pedido',
			description: 'Seguimiento o estado',
			aliases: ['2', 'pedido', 'pedidos', 'estado pedido', 'seguimiento'],
			actionType: 'INTENT',
			actionValue: 'order_status',
			effectiveMessageBody: 'Quiero saber el estado de mi pedido',
		},
	},
	{
		key: 'payments',
		label: 'Pagos',
		description: 'Medios de pago o comprobantes.',
		icon: CreditCard,
		option: {
			title: 'Medios de pago',
			description: 'Formas de pago disponibles',
			aliases: ['3', 'pago', 'pagos', 'medios de pago'],
			actionType: 'INTENT',
			actionValue: 'payment',
			effectiveMessageBody: 'Quiero saber que medios de pago aceptan',
		},
	},
	{
		key: 'shipping',
		label: 'Envíos',
		description: 'Zonas, costos o tiempos.',
		icon: Truck,
		option: {
			title: 'Envios',
			description: 'Zonas y tiempos',
			aliases: ['4', 'envio', 'envios', 'shipping'],
			actionType: 'INTENT',
			actionValue: 'shipping',
			effectiveMessageBody: 'Quiero consultar sobre envios',
		},
	},
	{
		key: 'message',
		label: 'Respuesta rapida',
		description: 'Envía un texto fijo.',
		icon: MessageSquareText,
		option: {
			title: 'Respuesta rapida',
			description: 'Texto automatico',
			aliases: ['info', 'ayuda'],
			actionType: 'MESSAGE',
			replyBody: 'Contame un poco mas y seguimos por aca.',
		},
	},
	{
		key: 'submenu',
		label: 'Submenú',
		description: 'Lleva a otro bloque de opciones.',
		icon: Plus,
		option: {
			title: 'Ver más opciones',
			description: 'Abrir otro menú',
			aliases: ['mas', 'opciones'],
			actionType: 'SUBMENU',
			promptPrefix: 'Te muestro más opciones.',
		},
	},
	{
		key: 'human',
		label: 'Hablar con humano',
		description: 'Deriva la conversacion.',
		icon: UserRoundCheck,
		option: {
			title: 'Hablar con una persona',
			description: 'Pasar a atencion humana',
			aliases: ['humano', 'asesor', 'asesora', 'persona'],
			actionType: 'HUMAN',
			actionValue: 'human',
			replyBody: 'Te paso con una persona del equipo para que te ayude.',
		},
	},
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
		replyBody: 'Contame un poco mas y seguimos por aca.',
		effectiveMessageBody: '',
		statePatch: {},
		isActive: true,
		sortOrder: nextIndex,
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
		options: [createEmptyOption(1)],
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

function normalizeKey(value = '') {
	return String(value || '').trim().toLowerCase();
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
						statePatch: nextStatePatch,
					};
				}),
			};
		}),
	};
}

function getActionLabel(actionType) {
	return ACTION_TYPES.find((action) => action.value === actionType)?.label || actionType;
}

function getIntentLabel(intentValue = '') {
	return INTENT_OPTIONS.find((intent) => intent.value === intentValue)?.label || 'General';
}

function sortOptions(options = []) {
	return [...options].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

function createOptionFromPreset(preset, nextIndex = 1, targetMenuKey = '') {
	const option = createEmptyOption(nextIndex);
	const presetOption = preset?.option || {};
	const aliases = Array.isArray(presetOption.aliases) && presetOption.aliases.length
		? presetOption.aliases
		: [String(nextIndex)];

	return {
		...option,
		...deepClone(presetOption),
		id: `menu_option_${Date.now()}_${preset?.key || 'custom'}_${nextIndex}`,
		aliases,
		actionValue: presetOption.actionType === 'SUBMENU'
			? targetMenuKey || ''
			: (presetOption.actionValue || ''),
		sortOrder: nextIndex,
		isActive: true,
	};
}

function applyDraftsToConfig(menuConfig, drafts) {
	if (!menuConfig || !drafts || !Object.keys(drafts).length) return menuConfig;

	const nextConfig = deepClone(menuConfig);

	for (const [draftKey, rawValue] of Object.entries(drafts)) {
		const [menuKey, optionId, field] = draftKey.split(':');
		const menu = nextConfig.menus.find((item) => item.key === menuKey);
		const option = menu?.options?.find((item) => item.id === optionId);
		if (!option) continue;

		if (field === 'aliases') {
			option.aliases = textToAliases(rawValue);
			continue;
		}

		if (field === 'interestedProducts') {
			option.statePatch = {
				...(option.statePatch || {}),
			};
			const values = textToAliases(rawValue);
			if (values.length) {
				option.statePatch.interestedProducts = values;
			} else {
				delete option.statePatch.interestedProducts;
			}
		}
	}

	return nextConfig;
}

function validateMenuConfig(menuConfig = null) {
	if (!menuConfig) return [];
	const warnings = [];
	const menus = Array.isArray(menuConfig.menus) ? menuConfig.menus : [];
	const menuKeys = new Set(menus.map((menu) => menu.key));

	if (!menuKeys.has(menuConfig.mainMenuKey)) {
		warnings.push('El menú inicial no existe o no está seleccionado.');
	}

	for (const menu of menus) {
		const menuName = menu.title || menu.key || 'Menú sin nombre';
		const activeOptions = (menu.options || []).filter((option) => option.isActive !== false);
		const aliases = new Map();

		if (!String(menu.title || '').trim()) {
			warnings.push(`${menuName}: falta el título visible.`);
		}

		if (!String(menu.body || '').trim()) {
			warnings.push(`${menuName}: falta el texto principal del mensaje.`);
		}

		if (activeOptions.length > 10) {
			warnings.push(`${menuName}: WhatsApp permite hasta 10 opciones activas por menú.`);
		}

		for (const option of activeOptions) {
			const optionName = option.title || 'Opción sin título';
			if (!String(option.title || '').trim()) {
				warnings.push(`${menuName}: hay una opción sin título.`);
			}

			if (option.actionType === 'SUBMENU' && !menuKeys.has(option.actionValue)) {
				warnings.push(`${optionName}: apunta a un submenú que no existe.`);
			}

			if (option.actionType === 'MESSAGE' && !String(option.replyBody || '').trim()) {
				warnings.push(`${optionName}: falta la respuesta fija.`);
			}

			if (option.actionType === 'HUMAN' && !String(option.replyBody || '').trim()) {
				warnings.push(`${optionName}: conviene cargar el texto de derivación.`);
			}

			if (option.actionType === 'INTENT' && !String(option.actionValue || '').trim()) {
				warnings.push(`${optionName}: falta elegir cómo continúa la IA.`);
			}

			for (const alias of option.aliases || []) {
				const normalizedAlias = normalizeKey(alias);
				if (!normalizedAlias) continue;
				if (aliases.has(normalizedAlias)) {
					warnings.push(`${menuName}: el alias "${alias}" esta repetido.`);
					continue;
				}
				aliases.set(normalizedAlias, option.id);
			}
		}
	}

	return warnings;
}

function getPreviewResult(option = {}, menusByKey = {}) {
	if (!option) return null;

	if (option.actionType === 'SUBMENU') {
		const targetMenu = menusByKey[option.actionValue];
		return {
			type: 'submenu',
			title: targetMenu ? `Abre: ${targetMenu.title}` : 'Submenú no encontrado',
			body: option.promptPrefix || 'Abre otro bloque de opciones.',
			targetMenu,
		};
	}

	if (option.actionType === 'INTENT') {
		return {
			type: 'intent',
			title: `La IA continúa con: ${getIntentLabel(option.actionValue)}`,
			body: option.effectiveMessageBody || 'La IA usa el contexto del chat y responde el proximo paso.',
		};
	}

	if (option.actionType === 'HUMAN') {
		return {
			type: 'human',
			title: 'Pasa a atencion humana',
			body: option.replyBody || 'Te paso con una persona del equipo para que te ayude.',
		};
	}

	return {
		type: 'message',
		title: 'Responde texto fijo',
		body: option.replyBody || 'Sin respuesta cargada.',
	};
}

export default function WhatsAppMenuPage() {
	useInternalDarkOverrides();

	const [config, setConfig] = useState(null);
	const [settingsName, setSettingsName] = useState('Configuracion principal');
	const [selectedMenuKey, setSelectedMenuKey] = useState('');
	const [textDrafts, setTextDrafts] = useState({});
	const [previewMenuKey, setPreviewMenuKey] = useState('');
	const [previewSelection, setPreviewSelection] = useState(null);
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
			const nextMenuKey = nextConfig.mainMenuKey || nextConfig.menus?.[0]?.key || '';

			setConfig(nextConfig);
			setTextDrafts({});
			setSettingsName(response.data?.settings?.name || 'Configuracion principal');
			setSelectedMenuKey(nextMenuKey);
			setPreviewMenuKey(nextMenuKey);
			setPreviewSelection(null);
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
	const menusByKey = useMemo(
		() => Object.fromEntries((config?.menus || []).map((menu) => [menu.key, menu])),
		[config]
	);
	const previewMenu = useMemo(() => {
		if (!config) return null;
		return menusByKey[previewMenuKey] || menusByKey[config.mainMenuKey] || config.menus?.[0] || null;
	}, [config, menusByKey, previewMenuKey]);
	const previewOptions = useMemo(() => sortOptions(previewMenu?.options || []).filter((option) => option.isActive !== false), [previewMenu]);
	const previewResult = useMemo(
		() => getPreviewResult(previewSelection, menusByKey),
		[menusByKey, previewSelection]
	);
	const validationWarnings = useMemo(() => validateMenuConfig(config), [config]);
	const buildSteps = useMemo(() => [
		{
			label: 'Estructura',
			description: `${config?.menus?.length || 0} ${(config?.menus?.length || 0) === 1 ? 'menú' : 'menús'}`,
			complete: Boolean(config?.menus?.length && config?.mainMenuKey),
		},
		{
			label: 'Mensaje',
			description: selectedMenu?.body?.trim() ? 'Contenido listo' : 'Falta el texto principal',
			complete: Boolean(selectedMenu?.title?.trim() && selectedMenu?.body?.trim()),
		},
		{
			label: 'Opciones',
			description: `${sortedSelectedOptions.length} configuradas`,
			complete: sortedSelectedOptions.length > 0,
		},
	], [config?.mainMenuKey, config?.menus?.length, selectedMenu, sortedSelectedOptions.length]);

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
					),
				}));

				if (selectedMenuKey === menuKey) {
					setSelectedMenuKey(normalizedValue);
				}
				if (previewMenuKey === menuKey) {
					setPreviewMenuKey(normalizedValue);
				}

				return {
					...current,
					mainMenuKey: current.mainMenuKey === menuKey ? normalizedValue : current.mainMenuKey,
					menus: remappedMenus,
				};
			}

			return {
				...current,
				menus: nextMenus,
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
					options: menu.options.map((option) => (option.id === optionId ? { ...option, [field]: value } : option)),
				};
			}),
		}));
		setPreviewSelection((current) => (current?.id === optionId ? { ...current, [field]: value } : current));
	}

	function getDraftKey(menuKey, optionId, field) {
		return `${menuKey}:${optionId}:${field}`;
	}

	function handleDraftChange(menuKey, optionId, field, value) {
		const draftKey = getDraftKey(menuKey, optionId, field);
		setTextDrafts((current) => ({
			...current,
			[draftKey]: value,
		}));
	}

	function clearDraft(menuKey, optionId, field) {
		const draftKey = getDraftKey(menuKey, optionId, field);
		setTextDrafts((current) => {
			if (!(draftKey in current)) return current;
			const nextDrafts = { ...current };
			delete nextDrafts[draftKey];
			return nextDrafts;
		});
	}

	function addMenu() {
		setConfig((current) => {
			const nextMenu = createEmptyMenu(current.menus.length + 1);
			setSelectedMenuKey(nextMenu.key);
			setPreviewMenuKey(nextMenu.key);
			setPreviewSelection(null);

			return {
				...current,
				menus: [...current.menus, nextMenu],
			};
		});
	}

	function removeMenu(menuKey) {
		setConfig((current) => {
			if (current.menus.length <= 1) return current;

			const nextMenus = current.menus.filter((menu) => menu.key !== menuKey);
			const nextMainKey = current.mainMenuKey === menuKey ? nextMenus[0]?.key || '' : current.mainMenuKey;
			const nextSelectedKey = nextMenus[0]?.key || '';

			setSelectedMenuKey(nextSelectedKey);
			setPreviewMenuKey(nextMainKey || nextSelectedKey);
			setPreviewSelection(null);

			return {
				...current,
				mainMenuKey: nextMainKey,
				menus: nextMenus,
			};
		});
	}

	function addOptionFromPreset(menuKey, preset) {
		setConfig((current) => ({
			...current,
			menus: current.menus.map((menu) => {
				if (menu.key !== menuKey) return menu;
				const targetMenuKey = menu.options?.find((option) => option.actionType === 'SUBMENU')?.actionValue || current.mainMenuKey;
				const nextOption = createOptionFromPreset(preset, (menu.options || []).length + 1, targetMenuKey);

				return {
					...menu,
					options: [...menu.options, nextOption],
				};
			}),
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
					options: menu.options.filter((option) => option.id !== optionId),
				};
			}),
		}));
		setPreviewSelection((current) => (current?.id === optionId ? null : current));
	}

	function handlePreviewOption(option) {
		setPreviewSelection(option);
		if (option.actionType === 'SUBMENU' && menusByKey[option.actionValue]) {
			setPreviewMenuKey(option.actionValue);
		}
	}

	function resetPreview() {
		setPreviewMenuKey(config?.mainMenuKey || config?.menus?.[0]?.key || '');
		setPreviewSelection(null);
	}

	async function handleSave() {
		if (!config) return;

		setSaving(true);
		setError('');
		setFeedback('');

		try {
			const nextConfig = applyDraftsToConfig(config, textDrafts);
			const payload = {
				name: settingsName,
				config: nextConfig,
			};

			const response = await api.put('/whatsapp-menu', payload);
			const savedConfig = deepClone(response.data?.settings?.config || nextConfig);
			const nextMenuKey = savedConfig.mainMenuKey || savedConfig.menus?.[0]?.key || '';

			setConfig(savedConfig);
			setTextDrafts({});
			setSelectedMenuKey(nextMenuKey);
			setPreviewMenuKey(nextMenuKey);
			setPreviewSelection(null);
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
			const nextMenuKey = nextConfig.mainMenuKey || nextConfig.menus?.[0]?.key || '';

			setConfig(nextConfig);
			setTextDrafts({});
			setSettingsName(response.data?.settings?.name || 'Configuracion principal');
			setSelectedMenuKey(nextMenuKey);
			setPreviewMenuKey(nextMenuKey);
			setPreviewSelection(null);
			setFeedback('Se restauró el menú original.');
		} catch (requestError) {
			setError(requestError?.response?.data?.error || 'No pude restaurar el menú original.');
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return (
			<div className="wam-page">
				<EmptyState
					tone="loading"
					title="Cargando diseñador de menú"
					description="Estamos trayendo la configuración activa de WhatsApp."
					className="wam-empty"
				/>
			</div>
		);
	}

	if (!config) {
		return (
			<div className="wam-page">
				<EmptyState
					title="No hay una configuración para mostrar"
					description="Creá o restaurá una configuración para editar el menú inicial."
					className="wam-empty"
				/>
			</div>
		);
	}

	return (
		<div className="wam-page">
			<PageHeader
				className="wam-hero"
				eyebrow="Experiencia de WhatsApp"
				title="Diseñador de menú"
				description="Armá el recorrido de atención y comprobá el resultado en tiempo real, tal como lo verá tu cliente."
			>
				<div className="wam-hero__actions">
					<ActionButton
						variant="secondary"
						className="wam-button wam-button--secondary"
						onClick={handleReset}
						disabled={saving}
						icon={RotateCcw}
					>
						Restaurar original
					</ActionButton>

					<ActionButton className="wam-button wam-button--primary" onClick={handleSave} disabled={saving} icon={Save}>
						{saving ? 'Guardando…' : 'Guardar menú'}
					</ActionButton>
				</div>
			</PageHeader>

			<section className="wam-setup" aria-labelledby="wam-setup-title">
				<div className="wam-setup__intro">
					<Settings2 size={18} aria-hidden="true" />
					<div>
						<h2 id="wam-setup-title">Configuración</h2>
						<p>Datos internos del recorrido</p>
					</div>
				</div>

				<div className="wam-form-grid wam-setup__fields">
					<label>
						<span>Nombre interno</span>
						<input
							value={settingsName}
							onChange={(event) => setSettingsName(event.target.value)}
							placeholder="Menú principal"
						/>
					</label>

					<label>
						<span>Primer menú que verá el cliente</span>
						<select
							value={config.mainMenuKey}
							onChange={(event) => {
								setConfig((current) => ({ ...current, mainMenuKey: event.target.value }));
								setPreviewMenuKey(event.target.value);
								setPreviewSelection(null);
							}}
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
				<nav className="wam-card wam-sidebar" aria-label="Menús del recorrido">
					<div className="wam-sidebar__header">
						<div>
							<span className="wam-section-label">Recorrido</span>
							<h2>Menús</h2>
						</div>

						<button type="button" className="wam-button wam-button--secondary wam-button--small" onClick={addMenu}>
							<Plus size={14} aria-hidden="true" />
							Nuevo menú
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
										<span className="wam-menu-item__index">Paso {index + 1}</span>
										{config.mainMenuKey === menu.key ? <span className="wam-chip">Inicial</span> : null}
									</div>

									<strong>{menu.title}</strong>
									<p>{menu.body || 'Todavía no tiene un mensaje'}</p>

									<div className="wam-menu-item__meta">
										<span>{totalOptions} opciones</span>
									</div>
								</button>
							);
						})}
					</div>
				</nav>

				<section className="wam-card wam-editor">
					{selectedMenu ? (
						<>
							<div className="wam-editor__header">
								<div>
									<span className="wam-section-label">Edición</span>
									<h2>{selectedMenu.title}</h2>
									<p>Definí el mensaje y qué sucede cuando el cliente elige una opción.</p>
								</div>

								<button
									type="button"
									className="wam-button wam-button--danger wam-button--small"
									onClick={() => removeMenu(selectedMenu.key)}
								>
									Eliminar menú
								</button>
							</div>

							<ol className="wam-steps" aria-label="Progreso del menú">
								{buildSteps.map((step, index) => (
									<li key={step.label} className={step.complete ? 'is-complete' : ''}>
										<span className="wam-step__number">{step.complete ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
										<span>
											<strong>{step.label}</strong>
											<small>{step.description}</small>
										</span>
									</li>
								))}
							</ol>

							<div className="wam-block">
								<div className="wam-block__header">
									<div>
										<span className="wam-block__step">Paso 1</span>
										<h3>Mensaje del menú</h3>
										<p>Es lo primero que recibirá el cliente.</p>
									</div>
								</div>

								<div className="wam-form-grid">
									<label>
										<span>Nombre de este paso</span>
										<input
											value={selectedMenu.title}
											onChange={(event) => updateMenuField(selectedMenu.key, 'title', event.target.value)}
										/>
									</label>

									<label>
										<span>Encabezado para el cliente</span>
										<input
											value={selectedMenu.headerText}
											onChange={(event) => updateMenuField(selectedMenu.key, 'headerText', event.target.value)}
										/>
									</label>

									<label className="wam-form-grid__full">
										<span>Mensaje principal</span>
										<textarea
											rows={3}
											value={selectedMenu.body}
											onChange={(event) => updateMenuField(selectedMenu.key, 'body', event.target.value)}
										/>
									</label>
								</div>

								<details className="wam-message-details">
									<summary>
										<span><Settings2 size={16} aria-hidden="true" /> Detalles del mensaje</span>
										<small>Botón, pie, título de lista y orden</small>
									</summary>
									<div className="wam-form-grid">
										<label>
											<span>Texto del botón</span>
											<input
												value={selectedMenu.buttonText}
												onChange={(event) => updateMenuField(selectedMenu.key, 'buttonText', event.target.value)}
											/>
										</label>
										<label>
											<span>Título de la lista</span>
											<input
												value={selectedMenu.sectionTitle || ''}
												onChange={(event) => updateMenuField(selectedMenu.key, 'sectionTitle', event.target.value)}
											/>
										</label>
										<label>
											<span>Pie del mensaje</span>
											<input
												value={selectedMenu.footerText}
												onChange={(event) => updateMenuField(selectedMenu.key, 'footerText', event.target.value)}
											/>
										</label>
										<label>
											<span>Orden del menú</span>
											<input
												type="number"
												value={selectedMenu.sortOrder || 1}
												onChange={(event) => updateMenuField(selectedMenu.key, 'sortOrder', Number(event.target.value) || 1)}
											/>
										</label>
									</div>
								</details>
							</div>

							<div className="wam-block">
								<div className="wam-block__header">
									<div>
										<span className="wam-block__step">Paso 2</span>
										<h3>Agregar una opción</h3>
										<p>Elegí qué necesita resolver el cliente.</p>
									</div>
								</div>
								<div className="wam-preset-grid">
									{OPTION_PRESETS.map((preset) => {
										const Icon = preset.icon;
										return (
											<button
												type="button"
												className="wam-preset"
												key={preset.key}
												onClick={() => addOptionFromPreset(selectedMenu.key, preset)}
											>
												<Icon size={18} aria-hidden="true" />
												<span>
													<strong>{preset.label}</strong>
													<small>{preset.description}</small>
												</span>
											</button>
										);
									})}
								</div>
							</div>

							<div className="wam-block">
								<div className="wam-block__header wam-block__header--between">
									<div>
										<span className="wam-block__step">Paso 3</span>
										<h3>Opciones del menú</h3>
									</div>
									<span className="wam-pill wam-pill--soft">{sortedSelectedOptions.length} configuradas</span>
								</div>

								<div className="wam-options-list">
									{sortedSelectedOptions.map((option, index) => (
										<details key={option.id} className="wam-option-card" open={index === 0}>
											<summary className="wam-option-card__summary">
												<div className="wam-option-card__summary-main">
													<span className="wam-option-card__eyebrow">Opcion {index + 1}</span>
											<strong>{option.title || 'Nueva opción'}</strong>
													<p>{option.description || getActionLabel(option.actionType)}</p>
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
												<span>Texto de la opción</span>
														<input
															value={option.title}
															onChange={(event) => updateOptionField(selectedMenu.key, option.id, 'title', event.target.value)}
														/>
													</label>

													<label>
														<span>Que pasa al tocarla</span>
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
														<span>Descripcion corta</span>
														<input
															value={option.description || ''}
															onChange={(event) =>
																updateOptionField(selectedMenu.key, option.id, 'description', event.target.value)
															}
														/>
													</label>

													{option.actionType === 'SUBMENU' ? (
														<>
															<label>
																<span>Menu destino</span>
																<select
																	value={option.actionValue || ''}
																	onChange={(event) =>
																		updateOptionField(selectedMenu.key, option.id, 'actionValue', event.target.value)
																	}
																>
															<option value="">Elegir menú</option>
																	{config.menus.map((menu) => (
																		<option key={menu.key} value={menu.key}>
																			{menu.title}
																		</option>
																	))}
																</select>
															</label>

															<label>
																<span>Mensaje antes de abrir</span>
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
														<span>La IA continúa con</span>
																<select
																	value={option.actionValue || ''}
																	onChange={(event) =>
																		updateOptionField(selectedMenu.key, option.id, 'actionValue', event.target.value)
																	}
																>
																	<option value="">Elegir tema</option>
																	{INTENT_OPTIONS.map((intent) => (
																		<option key={intent.value} value={intent.value}>
																			{intent.label}
																		</option>
																	))}
																</select>
															</label>

															<label>
																<span>Mensaje que interpreta la IA</span>
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
														</>
													) : null}

													{option.actionType === 'MESSAGE' || option.actionType === 'HUMAN' ? (
														<label className="wam-form-grid__full">
													<span>{option.actionType === 'HUMAN' ? 'Texto de derivación' : 'Respuesta automática'}</span>
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
													<summary>Avanzado</summary>

													<div className="wam-form-grid">
														<label className="wam-form-grid__full">
															<span>Palabras que activan esta opción</span>
															<input
																value={
																	textDrafts[getDraftKey(selectedMenu.key, option.id, 'aliases')] ??
																	aliasesToText(option.aliases)
																}
																onChange={(event) =>
																	handleDraftChange(selectedMenu.key, option.id, 'aliases', event.target.value)
																}
																onBlur={(event) => {
																	updateOptionField(
																		selectedMenu.key,
																		option.id,
																		'aliases',
																		textToAliases(event.target.value)
																	);
																	clearDraft(selectedMenu.key, option.id, 'aliases');
																}}
																placeholder="1, productos, ver productos"
															/>
														</label>

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
																value={
																	textDrafts[getDraftKey(selectedMenu.key, option.id, 'interestedProducts')] ??
																	aliasesToText(option.statePatch?.interestedProducts || [])
																}
																onChange={(event) =>
																	handleDraftChange(
																		selectedMenu.key,
																		option.id,
																		'interestedProducts',
																		event.target.value
																	)
																}
																onBlur={(event) => {
																	setConfig((current) =>
																		updateStatePatch(
																			current,
																			selectedMenu.key,
																			option.id,
																			'interestedProducts',
																			textToAliases(event.target.value)
																		)
																	);
																	clearDraft(selectedMenu.key, option.id, 'interestedProducts');
																}}
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
						<div>
							<span className="wam-section-label"><Eye size={13} aria-hidden="true" /> Vista en vivo</span>
							<h2>Así lo verá tu cliente</h2>
							<p>Se actualiza mientras editás. Tocá una opción para probar el recorrido.</p>
						</div>
						<button type="button" className="wam-button wam-button--secondary wam-button--small" onClick={resetPreview}>
							Volver al inicio
						</button>
					</div>

					{previewMenu ? (
						<>
							<div className="wam-flow" aria-label="Recorrido de la vista previa">
								<ListTree size={14} aria-hidden="true" />
								<span>{previewMenu.title}</span>
								{previewSelection ? <ChevronRight size={13} aria-hidden="true" /> : null}
								{previewSelection ? <span>{previewSelection.title}</span> : null}
							</div>

							<div className="wam-phone" aria-label="Simulación del menú en WhatsApp" aria-live="polite">
								<div className="wam-phone__top">
									<div className="wam-phone__back" aria-hidden="true">‹</div>
									<div className="wam-phone__avatar">L</div>
									<div>
										<strong>Lummine</strong>
										<span>Cuenta de empresa</span>
									</div>
									<span className="wam-phone__online">en línea</span>
								</div>

								<div className="wam-phone__screen">
									<div className="wam-phone__date">Hoy</div>
									<div className="wam-phone__bubble">
										{previewMenu.headerText ? <strong className="wam-phone__heading">{previewMenu.headerText}</strong> : null}
										<p>{previewMenu.body}</p>
										<small>{previewMenu.footerText}</small>
										<span className="wam-phone__time">10:42</span>
									</div>


									<div className="wam-phone__list" role="group" aria-label={previewMenu.sectionTitle || 'Opciones disponibles'}>
										<div className="wam-phone__list-title">
											<span>{previewMenu.sectionTitle || 'Opciones disponibles'}</span>
											<small>{previewOptions.length} {previewOptions.length === 1 ? 'opción' : 'opciones'}</small>
										</div>
										<div className="wam-phone__options">
											{previewOptions.length ? previewOptions.map((option) => (
												<button
													type="button"
													key={option.id}
													className={`wam-phone__option ${previewSelection?.id === option.id ? 'is-selected' : ''}`}
													onClick={() => handlePreviewOption(option)}
												>
													<span className="wam-phone__option-index">{String(previewOptions.indexOf(option) + 1).padStart(2, '0')}</span>
													<span>
														<strong>{option.title}</strong>
														<small>{option.description || getActionLabel(option.actionType)}</small>
													</span>
													<ChevronRight size={15} aria-hidden="true" />
												</button>
											)) : (
												<div className="wam-phone__empty">Agregá una opción para verla acá.</div>
											)}
										</div>
									</div>

									<div className="wam-phone__composer" aria-hidden="true">
										<span>Mensaje</span>
										<div>›</div>
									</div>

									{previewResult ? (
										<div className={`wam-preview-result is-${previewResult.type}`}>
											<div className="wam-preview-result__icon" aria-hidden="true">
												<Bot size={16} />
											</div>
											<div>
												<strong>{previewResult.title}</strong>
												<p>{previewResult.body}</p>
											</div>
										</div>
									) : null}
								</div>
							</div>

							<div className="wam-validation">
								<strong>{validationWarnings.length ? 'Revisá antes de guardar' : 'Listo para guardar'}</strong>
								{validationWarnings.length ? (
									<ul>
										{validationWarnings.slice(0, 8).map((warning) => (
											<li key={warning}>{warning}</li>
										))}
									</ul>
								) : (
									<p>No encontramos advertencias en este recorrido.</p>
								)}
							</div>
						</>
					) : null}
				</aside>
			</div>
		</div>
	);
}
