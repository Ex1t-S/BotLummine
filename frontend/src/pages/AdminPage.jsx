import { useEffect, useMemo, useState } from 'react';
import api, { buildApiUrl, resolveApiUrl } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isPlatformAdminUser } from '../lib/authz.js';
import { PageHeader } from '../components/ui/InternalPage.jsx';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
import './AdminPage.css';

const EMPTY_WORKSPACE_FORM = {
	name: '',
	slug: '',
	businessName: '',
	agentName: 'Sofi',
	tone: 'humana, directa y comercial'
};

const EMPTY_USER_FORM = {
	id: '',
	name: '',
	email: '',
	password: '',
	role: 'AGENT'
};

const EMPTY_CHANNEL_FORM = {
	id: '',
	name: 'Canal principal',
	wabaId: '',
	phoneNumberId: '',
	displayPhoneNumber: '',
	accessToken: '',
	verifyToken: '',
	graphVersion: 'v25.0',
	status: 'ACTIVE'
};

const EMPTY_COMMERCE_FORM = {
	id: '',
	provider: 'SHOPIFY',
	externalStoreId: '',
	shopDomain: '',
	accessToken: '',
	refreshToken: '',
	scope: '',
	storeName: '',
	storeUrl: '',
	apiVersion: '2026-04',
	status: 'ACTIVE'
};

const EMPTY_LOGISTICS_FORM = {
	id: '',
	provider: 'ENBOX',
	username: '',
	password: '',
	panelBaseUrl: '',
	publicBaseUrl: '',
	publicTrackingSalt: '',
	targetClientId: '',
	discoverySeedDid: '',
	status: 'ACTIVE'
};

const EMPTY_PAYMENT_FORM = {
	transferBank: '',
	transferHolder: '',
	transferAlias: '',
	transferCbu: '',
	transferExtra: ''
};

const platformTabs = [
	{ key: 'workspaces', label: 'Marcas' },
	{ key: 'integrations', label: 'Integraciones' },
	{ key: 'users', label: 'Usuarios' },
	{ key: 'operations', label: 'Operaciones' }
];

const brandAdminTabs = [
	{ key: 'brand', label: 'Marca' },
	{ key: 'integrations', label: 'Integraciones' },
	{ key: 'content', label: 'Contenido' },
	{ key: 'users', label: 'Usuarios' }
];

function fieldValue(value) {
	return value == null ? '' : String(value);
}

function mapWorkspaceForm(workspace) {
	const ai = workspace?.aiConfig || {};
	return {
		name: fieldValue(workspace?.name),
		slug: fieldValue(workspace?.slug),
		status: fieldValue(workspace?.status || 'ACTIVE'),
		branding: {
			logoUrl: fieldValue(workspace?.branding?.logoUrl),
			primaryColor: fieldValue(workspace?.branding?.primaryColor),
			secondaryColor: fieldValue(workspace?.branding?.secondaryColor),
			accentColor: fieldValue(workspace?.branding?.accentColor)
		},
		aiConfig: {
			businessName: fieldValue(ai.businessName),
			agentName: fieldValue(ai.agentName),
			tone: fieldValue(ai.tone),
			systemPrompt: fieldValue(ai.systemPrompt),
			businessContext: fieldValue(ai.businessContext)
		}
	};
}

function mapPaymentForm(workspace) {
	const transfer = workspace?.aiConfig?.paymentConfig?.transfer || {};
	return {
		transferBank: fieldValue(transfer.bank),
		transferHolder: fieldValue(transfer.holder),
		transferAlias: fieldValue(transfer.alias),
		transferCbu: fieldValue(transfer.cbu),
		transferExtra: fieldValue(transfer.extra)
	};
}

function Input({ label, value, onChange, type = 'text', placeholder = '', required = false }) {
	return (
		<label className="admin-field">
			<span>{label}</span>
			<input
				type={type}
				value={value}
				placeholder={placeholder}
				required={required}
				onChange={(event) => onChange(event.target.value)}
			/>
		</label>
	);
}

function Select({ label, value, onChange, children }) {
	return (
		<label className="admin-field">
			<span>{label}</span>
			<select value={value} onChange={(event) => onChange(event.target.value)}>
				{children}
			</select>
		</label>
	);
}

function Textarea({ label, value, onChange, rows = 3 }) {
	return (
		<label className="admin-field admin-field--wide">
			<span>{label}</span>
			<textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} />
		</label>
	);
}

function StatusPill({ children }) {
	return <span className="tenant-admin-pill">{children || 'Sin datos'}</span>;
}

function SectionIntro({ title, description }) {
	return (
		<div className="tenant-admin-section-copy">
			<h3>{title}</h3>
			{description ? <p>{description}</p> : null}
		</div>
	);
}

function formatNumber(value) {
	return new Intl.NumberFormat('es-AR').format(Number(value || 0));
}

function formatCurrency(value, currency = 'ARS') {
	const amount = Number(value || 0);
	try {
		return new Intl.NumberFormat('es-AR', {
			style: 'currency',
			currency: currency || 'ARS',
			maximumFractionDigits: 0
		}).format(amount);
	} catch {
		return `$${amount.toLocaleString('es-AR')}`;
	}
}

function formatUsd(value) {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 2
	}).format(Number(value || 0));
}

function formatPercent(value) {
	return `${new Intl.NumberFormat('es-AR', {
		maximumFractionDigits: 1
	}).format(Number(value || 0))}%`;
}

function clampPercent(value) {
	return Math.max(0, Math.min(100, Number(value || 0)));
}

function getBrandColor(workspace = {}) {
	const color = String(workspace?.branding?.primaryColor || '').trim();
	return /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#0f766e';
}

function getWorkspaceName(workspace = {}) {
	return workspace?.aiConfig?.businessName || workspace?.name || workspace?.slug || 'Marca';
}

function getInitials(value = '') {
	const parts = String(value || 'Marca').trim().split(/\s+/).filter(Boolean).slice(0, 2);
	return parts.map((part) => part[0]?.toUpperCase() || '').join('') || 'M';
}

function getActivityItems(metrics = {}) {
	const items = [
		{
			key: 'inbound',
			label: 'Entrada',
			value: Number(metrics.messages30dInbound || 0),
			help: 'Mensajes recibidos por WhatsApp en los últimos 30 días.',
		},
		{
			key: 'outbound',
			label: 'Salida',
			value: Number(metrics.messages30dOutbound || 0),
			help: 'Mensajes enviados por la marca en los últimos 30 días.',
		},
		{
			key: 'read',
			label: 'Leídos',
			value: Number(metrics.readRecipientsCount || 0),
			help: 'Destinatarios de campañas que llegaron a estado leído.',
		},
		{
			key: 'conversions',
			label: 'Conv.',
			value: Number(metrics.conversionCount || 0),
			help: 'Ventas atribuidas y carritos recuperados con contacto previo de WhatsApp.',
		},
	];
	const values = items.map((item) => item.value);
	const max = Math.max(...values, 1);
	return items.map((item) => ({
		...item,
		height: Math.max(12, Math.round((item.value / max) * 100)),
	}));
}

function WorkspaceAnalyticsCard({ item, selected, onSelect }) {
	const workspace = item.workspace || {};
	const metrics = item.metrics || {};
	const name = getWorkspaceName(workspace);
	const brandColor = getBrandColor(workspace);
	const sent = Number(metrics.sentRecipientsCount || 0);
	const conversionRate = sent ? (Number(metrics.conversionCount || 0) / sent) * 100 : 0;
	const readWidth = clampPercent(metrics.readRate);
	const deliveryWidth = clampPercent(metrics.deliveryRate);
	const activityItems = getActivityItems(metrics);

	return (
		<button
			type="button"
			className={`workspace-analytics-card ${selected ? 'is-selected' : ''}`.trim()}
			style={{ '--brand-color': brandColor }}
			onClick={onSelect}
		>
			<div className="workspace-card-head">
				<div className="workspace-card-brand">
					<div className="workspace-card-logo">
						{workspace.branding?.logoUrl ? (
							<img src={workspace.branding.logoUrl} alt={name} />
						) : (
							<span>{getInitials(name)}</span>
						)}
					</div>
					<div>
						<strong>{name}</strong>
						<span>{workspace.slug || workspace.status || 'workspace'}</span>
					</div>
				</div>
				<span className="workspace-card-status">{workspace.status || 'ACTIVE'}</span>
			</div>

			<div
				className="workspace-card-hero metric-help"
				data-help="Ventas reales atribuidas y carritos recuperados con contacto previo de WhatsApp divididos por mensajes enviados en campañas."
				title="Ventas y carritos recuperados contactados / mensajes enviados en campañas."
			>
				<div>
					<span>Conversión por WhatsApp</span>
					<strong>{formatPercent(conversionRate)}</strong>
					<small>{formatNumber(metrics.conversionCount)} ventas y carritos recuperados</small>
				</div>
				<div className="workspace-card-ring" aria-hidden="true">
					<div style={{ '--progress': `${clampPercent(conversionRate)}%` }}>
						<span>{formatPercent(conversionRate)}</span>
					</div>
				</div>
			</div>

			<div className="workspace-card-progress">
				<div
					className="metric-help"
					data-help="Porcentaje de mensajes de campaña que Meta marcó como entregados sobre el total enviado."
					title="Mensajes entregados / mensajes enviados."
				>
					<span>Entregados</span>
					<strong>{formatPercent(metrics.deliveryRate)}</strong>
					<i><b style={{ width: `${deliveryWidth}%` }} /></i>
				</div>
				<div
					className="metric-help"
					data-help="Porcentaje de mensajes entregados que llegaron a estado leído."
					title="Mensajes leídos / mensajes entregados."
				>
					<span>Leídos</span>
					<strong>{formatPercent(metrics.readRate)}</strong>
					<i><b style={{ width: `${readWidth}%` }} /></i>
				</div>
			</div>

			<div className="workspace-card-body">
				<div className="workspace-card-chart" aria-label="Actividad por marca">
					{activityItems.map((item) => (
						<span
							key={item.key}
							className="metric-help"
							style={{ height: `${item.height}%` }}
							data-help={`${item.help} Total: ${formatNumber(item.value)}.`}
							title={`${item.label}: ${formatNumber(item.value)}. ${item.help}`}
							aria-label={`${item.label}: ${formatNumber(item.value)}`}
						/>
					))}
					<div className="workspace-card-chart-labels" aria-hidden="true">
						{activityItems.map((item) => (
							<small key={item.key}>{item.label}</small>
						))}
					</div>
				</div>
				<div
					className="workspace-card-chat metric-help"
					data-help="Suma de mensajes entrantes y salientes de WhatsApp durante los últimos 30 días."
					title="Mensajes WhatsApp de los últimos 30 días."
				>
					<span>WhatsApp 30d</span>
					<strong>{formatNumber(Number(metrics.messages30dInbound || 0) + Number(metrics.messages30dOutbound || 0))}</strong>
					<small>
						{formatNumber(metrics.activeConversations30d)} conversaciones activas
					</small>
				</div>
			</div>

			<div className="workspace-card-stats">
				<div
					className="metric-help"
					data-help="Carritos abandonados recuperados con contacto previo de WhatsApp."
					title="Carritos recuperados atribuibles a WhatsApp."
				>
					<span>Carritos rec.</span>
					<strong>{formatNumber(metrics.recoveredCartsCount)}</strong>
				</div>
				<div
					className="metric-help"
					data-help="Costo estimado de mensajes facturables según la variable WHATSAPP_ESTIMATED_MESSAGE_COST_USD."
					title="Mensajes facturables por costo estimado configurado."
				>
					<span>Costo est.</span>
					<strong>{formatUsd(metrics.estimatedCampaignCostUsd)}</strong>
				</div>
				<div
					className="metric-help"
					data-help="Mensajes pendientes de lectura interna en conversaciones abiertas."
					title="Suma de mensajes no leídos en el inbox."
				>
					<span>No leídos</span>
					<strong>{formatNumber(metrics.unreadMessagesCount)}</strong>
				</div>
			</div>
		</button>
	);
}

export default function AdminPage({ defaultTab = '' }) {
	useInternalDarkOverrides();

	const { user, refreshMe } = useAuth();
	const platformAdmin = isPlatformAdminUser(user);
	const visibleTabs = platformAdmin ? platformTabs : brandAdminTabs;
	const [activeTab, setActiveTab] = useState(defaultTab || (platformAdmin ? 'workspaces' : 'brand'));
	const [workspaces, setWorkspaces] = useState([]);
	const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(user?.workspaceId || '');
	const [workspace, setWorkspace] = useState(null);
	const [workspaceForm, setWorkspaceForm] = useState(mapWorkspaceForm(user?.workspace || null));
	const [workspaceCreateForm, setWorkspaceCreateForm] = useState(EMPTY_WORKSPACE_FORM);
	const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM);
	const [users, setUsers] = useState([]);
	const [userForm, setUserForm] = useState(EMPTY_USER_FORM);
	const [channelForm, setChannelForm] = useState(EMPTY_CHANNEL_FORM);
	const [commerceProvider, setCommerceProvider] = useState('SHOPIFY');
	const [commerceForm, setCommerceForm] = useState(EMPTY_COMMERCE_FORM);
	const [shopifyInstallShop, setShopifyInstallShop] = useState('');
	const [logisticsForm, setLogisticsForm] = useState(EMPTY_LOGISTICS_FORM);
	const [catalogStatus, setCatalogStatus] = useState(null);
	const [tiendanubeStatus, setTiendanubeStatus] = useState(null);
	const [shopifyStatus, setShopifyStatus] = useState(null);
	const [analytics, setAnalytics] = useState(null);
	const [analyticsLoading, setAnalyticsLoading] = useState(false);
	const [generatingBusinessContext, setGeneratingBusinessContext] = useState(false);
	const [brandLogoFailed, setBrandLogoFailed] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [notice, setNotice] = useState('');
	const [error, setError] = useState('');

	const workspaceOptions = useMemo(() => {
		if (platformAdmin) return workspaces;
		return user?.workspace ? [user.workspace] : [];
	}, [platformAdmin, user?.workspace, workspaces]);

	async function loadWorkspaces() {
		if (!platformAdmin) {
			const currentWorkspace = user?.workspace || null;
			setWorkspaces(currentWorkspace ? [currentWorkspace] : []);
			setSelectedWorkspaceId(currentWorkspace?.id || user?.workspaceId || '');
			return currentWorkspace ? [currentWorkspace] : [];
		}

		const res = await api.get('/admin/workspaces');
		const items = res.data.workspaces || [];
		setWorkspaces(items);
		setSelectedWorkspaceId((current) => current || items[0]?.id || '');
		return items;
	}

	function selectCommerceConnection(nextWorkspace, provider = commerceProvider) {
		const connection = nextWorkspace?.commerceConnections?.find((item) => item.provider === provider) || null;
		setCommerceForm({
			...EMPTY_COMMERCE_FORM,
			id: connection?.id || '',
			provider,
			externalStoreId: fieldValue(connection?.externalStoreId),
			shopDomain: fieldValue(connection?.shopDomain),
			scope: fieldValue(connection?.scope),
			storeName: fieldValue(connection?.storeName),
			storeUrl: fieldValue(connection?.storeUrl),
			status: fieldValue(connection?.status || 'ACTIVE'),
			accessToken: '',
			refreshToken: '',
			apiVersion: fieldValue(connection?.rawPayload?.apiVersion || EMPTY_COMMERCE_FORM.apiVersion)
		});
	}

	async function loadWorkspaceDetail(workspaceId) {
		if (!workspaceId) return;

		const [workspaceRes, usersRes, catalogRes, tiendanubeStatusRes, shopifyStatusRes] = await Promise.all([
			api.get(`/admin/workspaces/${workspaceId}`),
			api.get(`/admin/workspaces/${workspaceId}/users`),
			api.get(`/admin/workspaces/${workspaceId}/catalog/status`).catch(() => null),
			api.get('/tiendanube/status', { params: { workspaceId } }).catch(() => null),
			api.get('/shopify/status', { params: { workspaceId } }).catch(() => null)
		]);

		const nextWorkspace = workspaceRes.data.workspace || null;
		setWorkspace(nextWorkspace);
		setWorkspaceForm(mapWorkspaceForm(nextWorkspace));
		setPaymentForm(mapPaymentForm(nextWorkspace));
		setUsers(usersRes.data.users || []);
		setCatalogStatus(catalogRes?.data?.catalog || null);
		setTiendanubeStatus(tiendanubeStatusRes?.data || null);
		setShopifyStatus(shopifyStatusRes?.data || null);
		setShopifyInstallShop(
			shopifyStatusRes?.data?.shopDomain ||
			nextWorkspace?.commerceConnections?.find((item) => item.provider === 'SHOPIFY')?.shopDomain ||
			nextWorkspace?.commerceConnections?.find((item) => item.provider === 'SHOPIFY')?.externalStoreId ||
			''
		);

		const channel = nextWorkspace?.whatsappChannels?.[0] || null;
		setChannelForm({
			...EMPTY_CHANNEL_FORM,
			id: channel?.id || '',
			name: fieldValue(channel?.name || EMPTY_CHANNEL_FORM.name),
			wabaId: fieldValue(channel?.wabaId),
			phoneNumberId: fieldValue(channel?.phoneNumberId),
			displayPhoneNumber: fieldValue(channel?.displayPhoneNumber),
			graphVersion: fieldValue(channel?.graphVersion || EMPTY_CHANNEL_FORM.graphVersion),
			status: fieldValue(channel?.status || 'ACTIVE'),
			accessToken: '',
			verifyToken: ''
		});

		selectCommerceConnection(nextWorkspace, commerceProvider);

		const logistics = nextWorkspace?.logisticsConnections?.find((item) => item.provider === 'ENBOX') || null;
		const config = logistics?.config || {};
		setLogisticsForm({
			...EMPTY_LOGISTICS_FORM,
			id: logistics?.id || '',
			username: fieldValue(logistics?.username),
			password: '',
			status: fieldValue(logistics?.status || 'ACTIVE'),
			panelBaseUrl: fieldValue(config.panelBaseUrl),
			publicBaseUrl: fieldValue(config.publicBaseUrl),
			publicTrackingSalt: fieldValue(config.publicTrackingSalt),
			targetClientId: fieldValue(config.targetClientId),
			discoverySeedDid: fieldValue(config.discoverySeedDid)
		});
	}

	async function loadAnalytics(workspaceId = selectedWorkspaceId) {
		setAnalyticsLoading(true);
		try {
			const res = await api.get('/admin/analytics/workspaces', {
				params: workspaceId ? { workspaceId } : {}
			});
			setAnalytics(res.data || null);
		} finally {
			setAnalyticsLoading(false);
		}
	}

	useEffect(() => {
		let mounted = true;
		setLoading(true);
		loadWorkspaces()
			.catch((err) => {
				if (mounted) setError(err.response?.data?.error || err.message);
			})
			.finally(() => {
				if (mounted) setLoading(false);
			});
		return () => {
			mounted = false;
		};
	}, [platformAdmin]);

	useEffect(() => {
		if (typeof window === 'undefined') return;

		const params = new URLSearchParams(window.location.search);
		const nextTab = params.get('tab');
		const nextWorkspaceId = params.get('workspaceId');
		const tiendanubeResult = params.get('tiendanube');
		const connectedStoreId = params.get('storeId');
		const tiendanubeMessage = params.get('message');
		const shopifyResult = params.get('shopify');
		const connectedShop = params.get('shop');

		if (nextTab && visibleTabs.some((tab) => tab.key === nextTab)) {
			setActiveTab(nextTab);
		}

		if (platformAdmin && nextWorkspaceId) {
			setSelectedWorkspaceId(nextWorkspaceId);
		}

		if (tiendanubeResult === 'connected') {
			showNotice(
				tiendanubeMessage ||
				(connectedStoreId
					? `Tienda Nube conectada. Store ID ${connectedStoreId}.`
					: 'Tienda Nube conectada correctamente.')
			);
		}

		if (tiendanubeResult === 'partial') {
			setNotice('');
			setError(
				tiendanubeMessage ||
				(connectedStoreId
					? `La tienda ${connectedStoreId} se conecto, pero quedo alguna sincronizacion pendiente.`
					: 'La tienda se conecto, pero quedo alguna sincronizacion pendiente.')
			);
		}

		if (tiendanubeResult === 'already_connected') {
			showNotice(
				tiendanubeMessage ||
				'La app ya estaba conectada en esa tienda. Si queres, podes volver a sincronizar.'
			);
		}

		if (tiendanubeResult === 'cancelled' || tiendanubeResult === 'error') {
			setNotice('');
			setError(
				tiendanubeMessage ||
				(tiendanubeResult === 'cancelled'
					? 'La conexion con Tiendanube se cancelo antes de completarse.'
					: 'No se pudo completar la conexion con Tiendanube.')
			);
		}

		if (shopifyResult === 'connected') {
			showNotice(tiendanubeMessage || (connectedShop ? `Shopify conectado. Tienda ${connectedShop}.` : 'Shopify conectado correctamente.'));
		}

		if (shopifyResult === 'partial') {
			setNotice('');
			setError(tiendanubeMessage || (connectedShop ? `Shopify ${connectedShop} se conecto, pero quedaron tareas pendientes.` : 'Shopify se conecto, pero quedaron tareas pendientes.'));
		}

		if (shopifyResult === 'cancelled' || shopifyResult === 'error') {
			setNotice('');
			setError(
				tiendanubeMessage ||
				(shopifyResult === 'cancelled'
					? 'La conexion con Shopify se cancelo antes de completarse.'
					: 'No se pudo completar la conexion con Shopify.')
			);
		}

		if (nextTab || nextWorkspaceId || tiendanubeResult || connectedStoreId || tiendanubeMessage || shopifyResult || connectedShop) {
			window.history.replaceState({}, document.title, window.location.pathname);
		}
	}, [platformAdmin, visibleTabs]);

	useEffect(() => {
		const firstTab = platformAdmin ? 'workspaces' : 'brand';
		if (activeTab !== 'analytics' && !visibleTabs.some((tab) => tab.key === activeTab)) {
			setActiveTab(firstTab);
		}
	}, [platformAdmin, activeTab, visibleTabs]);

	useEffect(() => {
		if (!selectedWorkspaceId) return;
		setLoading(true);
		loadWorkspaceDetail(selectedWorkspaceId)
			.catch((err) => setError(err.response?.data?.error || err.message))
			.finally(() => setLoading(false));
	}, [selectedWorkspaceId]);

	useEffect(() => {
		loadAnalytics(selectedWorkspaceId).catch((err) => setError(err.response?.data?.error || err.message));
	}, [selectedWorkspaceId]);

	useEffect(() => {
		if (workspace) selectCommerceConnection(workspace, commerceProvider);
	}, [commerceProvider]);

	useEffect(() => {
		setBrandLogoFailed(false);
	}, [workspaceForm.branding?.logoUrl]);

	function showNotice(message) {
		setNotice(message);
		setError('');
	}

	function showError(err) {
		setNotice('');
		setError(err.response?.data?.error || err.message);
	}

	function setNestedForm(section, key, value) {
		setWorkspaceForm((current) => ({
			...current,
			[section]: {
				...(current[section] || {}),
				[key]: value
			}
		}));
	}

	function buildAiConfig(extra = {}) {
		return {
			paymentConfig: {
				transfer: {
					bank: paymentForm.transferBank,
					holder: paymentForm.transferHolder,
					alias: paymentForm.transferAlias,
					cbu: paymentForm.transferCbu,
					extra: paymentForm.transferExtra
				}
			},
			...extra
		};
	}

	async function saveWorkspace(payload, successMessage) {
		setSaving(true);
		try {
			const res = await api.patch(`/admin/workspaces/${selectedWorkspaceId}`, payload);
			const nextWorkspace = res.data.workspace || null;
			setWorkspace(nextWorkspace);
			setWorkspaceForm(mapWorkspaceForm(nextWorkspace));
			setPaymentForm(mapPaymentForm(nextWorkspace));
			showNotice(successMessage);
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
	}

	async function handleCreateWorkspace(event) {
		event.preventDefault();
		setSaving(true);
		try {
			const res = await api.post('/admin/workspaces', workspaceCreateForm);
			const created = res.data.workspace;
			setWorkspaceCreateForm(EMPTY_WORKSPACE_FORM);
			await loadWorkspaces();
			setSelectedWorkspaceId(created?.id || '');
			showNotice('Marca creada. Ya podes seguir con su configuración.');
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
	}

	async function handleSaveBrand(event) {
		event.preventDefault();
		if (platformAdmin) {
			await saveWorkspace({
				name: workspaceForm.name,
				slug: workspaceForm.slug,
				status: workspaceForm.status,
				branding: {
					logoUrl: workspaceForm.branding?.logoUrl || ''
				},
				aiConfig: {
					businessName: workspaceForm.aiConfig?.businessName || '',
					systemPrompt: workspaceForm.aiConfig?.systemPrompt || '',
					businessContext: workspaceForm.aiConfig?.businessContext || ''
				}
			}, 'Marca y configuracion avanzada guardadas.');
			return;
		}

		await saveWorkspace({
			aiConfig: {
				agentName: workspaceForm.aiConfig?.agentName || '',
				tone: workspaceForm.aiConfig?.tone || ''
			}
		}, 'Contenido de marca guardado.');
	}

	async function handleSavePayment(event) {
		event.preventDefault();
		await saveWorkspace({ aiConfig: buildAiConfig() }, 'Datos de pago guardados.');
	}

	async function handleGenerateBusinessContext() {
		if (!selectedWorkspaceId) return;
		setGeneratingBusinessContext(true);
		try {
			const currentDraft = workspaceForm.aiConfig?.businessContext || '';
			if (
				currentDraft &&
				!window.confirm('Esto va a reemplazar el contexto comercial actual en el formulario. ¿Querés seguir?')
			) {
				return;
			}

			const websiteUrl =
				commerceForm.storeUrl ||
				workspace?.commerceConnections?.[0]?.storeUrl ||
				tiendanubeStatus?.storeUrl ||
				'';
			const res = await api.post(`/admin/workspaces/${selectedWorkspaceId}/ai-context/generate`, {
				websiteUrl
			});
			const draft = String(res.data?.draft || '').trim();
			if (!draft) {
				setError('No se pudo generar un borrador de contexto comercial.');
				return;
			}

			setWorkspaceForm((cur) => ({
				...cur,
				aiConfig: {
					...cur.aiConfig,
					businessContext: draft
				}
			}));

			const mode = res.data?.generation?.mode === 'ai-assisted' ? 'IA' : 'base automatica';
			showNotice(`Contexto comercial generado con ${mode} usando web, catalogo y configuracion operativa. Revisalo y guardalo si te sirve.`);
		} catch (err) {
			showError(err);
		} finally {
			setGeneratingBusinessContext(false);
		}
	}

	async function handleSaveUser(event) {
		event.preventDefault();
		setSaving(true);
		try {
			if (userForm.id) {
				const payload = {
					name: userForm.name,
					role: userForm.role,
					...(userForm.password ? { password: userForm.password } : {})
				};
				await api.patch(`/admin/users/${userForm.id}`, payload);
				showNotice('Usuario actualizado.');
			} else {
				await api.post(`/admin/workspaces/${selectedWorkspaceId}/users`, userForm);
				showNotice('Usuario creado.');
			}
			setUserForm(EMPTY_USER_FORM);
			await loadWorkspaceDetail(selectedWorkspaceId);
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
	}

	async function handleSaveChannel(event) {
		event.preventDefault();
		setSaving(true);
		try {
			await api.put(`/admin/workspaces/${selectedWorkspaceId}/whatsapp-channel`, channelForm);
			await loadWorkspaceDetail(selectedWorkspaceId);
			showNotice('Canal WhatsApp guardado.');
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
	}

	async function handleSaveCommerce(event) {
		event.preventDefault();
		setSaving(true);
		try {
			await api.put(
				`/admin/workspaces/${selectedWorkspaceId}/commerce-connections/${commerceForm.provider}`,
				commerceForm
			);
			await loadWorkspaceDetail(selectedWorkspaceId);
			showNotice('Conexion ecommerce guardada.');
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
	}

	async function handleSaveLogistics(event) {
		event.preventDefault();
		setSaving(true);
		try {
			await api.put(
				`/admin/workspaces/${selectedWorkspaceId}/logistics-connections/${logisticsForm.provider}`,
				logisticsForm
			);
			await loadWorkspaceDetail(selectedWorkspaceId);
			showNotice('Conexion de envios guardada.');
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
	}

	async function handleCatalogSync(provider) {
		setSaving(true);
		try {
			const normalizedProvider = String(provider || '').toUpperCase();
			const res = !platformAdmin && normalizedProvider === 'TIENDANUBE'
				? await api.post('/tiendanube/catalog/sync', { workspaceId: selectedWorkspaceId })
				: await api.post(`/admin/workspaces/${selectedWorkspaceId}/catalog/sync`, { provider });
			setCatalogStatus(res.data.catalog || res.data || null);
			await loadWorkspaceDetail(selectedWorkspaceId);
			showNotice(`Sincronizacion ${provider} completada.`);
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
	}

	async function handleBrandingSync() {
		setSaving(true);
		try {
			const res = await api.post(`/admin/workspaces/${selectedWorkspaceId}/branding/sync`, { provider: 'TIENDANUBE' });
			const nextWorkspace = res.data.workspace || null;
			setWorkspace(nextWorkspace);
			setWorkspaceForm(mapWorkspaceForm(nextWorkspace));
			await refreshMe();
			showNotice('Branding importado desde Tienda Nube.');
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
	}

	async function handleDeleteWorkspace(targetWorkspace = null) {
		const workspaceToDelete = targetWorkspace || workspace;
		const workspaceId = workspaceToDelete?.id || selectedWorkspaceId;
		if (!platformAdmin || !workspaceId || !workspaceToDelete) return;

		const confirmed = window.confirm(
			`Vas a borrar la marca ${getWorkspaceName(workspaceToDelete)}. También se eliminarán sus usuarios, catálogo, conversaciones e integraciones.`
		);

		if (!confirmed) return;

		setSaving(true);
		try {
			const res = await api.delete(`/admin/workspaces/${workspaceId}`);
			const deletedName = res.data?.deletedWorkspace?.name || getWorkspaceName(workspaceToDelete);
			const items = await loadWorkspaces();
			const nextWorkspaceId = items[0]?.id || '';
			setSelectedWorkspaceId(nextWorkspaceId);
			if (!nextWorkspaceId) {
				setWorkspace(null);
				setWorkspaceForm(mapWorkspaceForm(null));
				setUsers([]);
				setCatalogStatus(null);
				setTiendanubeStatus(null);
				setShopifyStatus(null);
			}
			showNotice(`Marca eliminada: ${deletedName}.`);
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
	}

	function handleStartTiendanubeInstall() {
		if (!selectedWorkspaceId) return;
		window.location.href = buildApiUrl(`/tiendanube/install?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`);
	}

	function handleStartShopifyInstall(shopOverride = '') {
		if (!selectedWorkspaceId) return;
		const shopDomain = shopOverride || shopifyInstallShop || commerceForm.shopDomain || commerceForm.externalStoreId || shopifyStatus?.shopDomain || '';
		if (!shopDomain) {
			setNotice('');
			setError('Ingresa el dominio Shopify antes de conectar.');
			return;
		}
		const params = new URLSearchParams({
			workspaceId: selectedWorkspaceId,
			shop: shopDomain
		});
		window.location.href = buildApiUrl(`/shopify/install?${params.toString()}`);
	}

	function editUser(item) {
		setUserForm({
			id: item.id,
			name: fieldValue(item.name),
			email: fieldValue(item.email),
			password: '',
			role: fieldValue(item.role || 'AGENT')
		});
	}

	const brandName = workspaceForm.aiConfig?.businessName || workspaceForm.name || 'Marca';
	const brandStoreUrl = workspace?.storeInstallations?.[0]?.storeUrl || workspace?.commerceConnections?.[0]?.storeUrl || '';
	const brandLogoUrl = resolveApiUrl(workspaceForm.branding?.logoUrl || '');

	return (
		<div className="tenant-admin-page">
			<PageHeader
				className="tenant-admin-header"
				title={platformAdmin ? 'Admin de plataforma' : 'Configuración de marca'}
				description={
					platformAdmin
						? 'Creá nuevas marcas, elegí cuál editar y administrá sus integraciones.'
						: (workspace?.name || 'Branding, contenido y agentes de la marca')
				}
			>
				{!platformAdmin && workspaceOptions.length ? (
					<Select label="Marca actual" value={selectedWorkspaceId} onChange={setSelectedWorkspaceId}>
						{workspaceOptions.map((item) => (
							<option key={item.id} value={item.id}>
								{item.name || item.slug || item.id}
							</option>
						))}
					</Select>
				) : null}
			</PageHeader>

			{notice ? <div className="tenant-admin-alert success">{notice}</div> : null}
			{error ? <div className="tenant-admin-alert error">{error}</div> : null}

			{activeTab !== 'analytics' ? (
				<div className="tenant-admin-tabs">
					{visibleTabs.map((tab) => (
						<button
							type="button"
							key={tab.key}
							className={activeTab === tab.key ? 'active' : ''}
							onClick={() => setActiveTab(tab.key)}
						>
							{tab.label}
						</button>
					))}
				</div>
			) : null}

			<div className="tenant-admin-scroll">
				{platformAdmin && activeTab !== 'workspaces' ? (
					<section className="tenant-admin-panel tenant-admin-panel--compact">
						<div className="tenant-admin-selected-brand">
							<StatusPill>Marca seleccionada: {workspace ? getWorkspaceName(workspace) : 'sin seleccionar'}</StatusPill>
							<StatusPill>Slug: {workspace?.slug || 'sin slug'}</StatusPill>
							<button type="button" disabled={saving} onClick={() => setActiveTab('workspaces')}>
								Cambiar marca
							</button>
						</div>
					</section>
				) : null}

				{platformAdmin && activeTab === 'workspaces' ? (
					<section className="tenant-admin-panel">
						<SectionIntro
							title="Crear nueva marca"
							description="Este bloque siempre queda disponible para dar de alta otra marca, aunque ya tengas una seleccionada para editar."
						/>
						<form className="tenant-admin-grid" onSubmit={handleCreateWorkspace}>
							<Input label="Nombre interno" value={workspaceCreateForm.name} required onChange={(value) => setWorkspaceCreateForm((cur) => ({ ...cur, name: value }))} />
							<Input label="Identificador interno (slug)" value={workspaceCreateForm.slug} required onChange={(value) => setWorkspaceCreateForm((cur) => ({ ...cur, slug: value }))} />
							<Input label="Nombre comercial" value={workspaceCreateForm.businessName} onChange={(value) => setWorkspaceCreateForm((cur) => ({ ...cur, businessName: value }))} />
							<Input label="Nombre de la asesora IA" value={workspaceCreateForm.agentName} onChange={(value) => setWorkspaceCreateForm((cur) => ({ ...cur, agentName: value }))} />
							<Textarea label="Tono base de la asesora" value={workspaceCreateForm.tone} onChange={(value) => setWorkspaceCreateForm((cur) => ({ ...cur, tone: value }))} />
							<button type="submit" disabled={saving}>Crear marca</button>
						</form>
					</section>
				) : null}

				{platformAdmin && activeTab === 'workspaces' ? (
					<section className="tenant-admin-panel">
						<SectionIntro
							title="Marcas creadas"
							description="Elegí una marca para editarla. La selección solo afecta a los bloques de edición y configuración."
						/>
						{workspaces.length ? (
							<div className="tenant-admin-workspace-grid">
								{workspaces.map((item) => {
									const selected = item.id === selectedWorkspaceId;
									const itemName = getWorkspaceName(item);
									return (
										<div
											key={item.id}
											className={`tenant-admin-workspace-card ${selected ? 'is-selected' : ''}`.trim()}
										>
											<button
												type="button"
												className="tenant-admin-workspace-card__select"
												onClick={() => setSelectedWorkspaceId(item.id)}
											>
												<div className="tenant-admin-workspace-card__top">
													<div>
														<strong>{itemName}</strong>
														<span>{item.name || item.slug || item.id}</span>
													</div>
													<StatusPill>{item.status || 'ACTIVE'}</StatusPill>
												</div>
												<div className="tenant-admin-workspace-card__meta">
													<small>Slug: {item.slug || 'sin definir'}</small>
													<small>Asesora IA: {item.aiConfig?.agentName || 'sin definir'}</small>
												</div>
											</button>
											<div className="tenant-admin-workspace-card__actions">
												<button
													type="button"
													disabled={saving}
													onClick={() => setSelectedWorkspaceId(item.id)}
												>
													Editar
												</button>
												<button
													type="button"
													className="tenant-admin-workspace-card__delete"
													disabled={saving}
													onClick={() => handleDeleteWorkspace(item)}
												>
													Borrar
												</button>
											</div>
										</div>
									);
								})}
							</div>
						) : (
							<div className="tenant-admin-empty">Todavía no hay marcas creadas.</div>
						)}
					</section>
				) : null}

				{activeTab === 'workspaces' || activeTab === 'brand' ? (
					<section className="tenant-admin-panel">
						{platformAdmin ? (
							<SectionIntro
								title="Editar marca seleccionada"
								description={
									workspace
										? `Estás editando ${getWorkspaceName(workspace)}. Acá definís su identidad, contexto comercial y estado dentro de la plataforma.`
										: 'Seleccioná una marca de la lista anterior para editarla.'
								}
							/>
						) : (
							<h3>Marca conectada</h3>
						)}
						{platformAdmin ? (
							workspace ? (
								<>
									<div className="tenant-admin-selected-brand">
										<StatusPill>Marca interna: {workspaceForm.name || 'sin nombre'}</StatusPill>
										<StatusPill>Slug: {workspaceForm.slug || 'sin slug'}</StatusPill>
										<StatusPill>Estado: {workspaceForm.status || 'ACTIVE'}</StatusPill>
									</div>
									<form className="tenant-admin-grid" onSubmit={handleSaveBrand}>
										<Input label="Nombre interno" value={workspaceForm.name} onChange={(value) => setWorkspaceForm((cur) => ({ ...cur, name: value }))} />
										<Input label="Identificador interno (slug)" value={workspaceForm.slug} onChange={(value) => setWorkspaceForm((cur) => ({ ...cur, slug: value }))} />
										<Select label="Estado de la marca" value={workspaceForm.status || 'ACTIVE'} onChange={(value) => setWorkspaceForm((cur) => ({ ...cur, status: value }))}>
											<option value="ACTIVE">ACTIVE</option>
											<option value="SUSPENDED">SUSPENDED</option>
											<option value="ARCHIVED">ARCHIVED</option>
										</Select>
										<Input label="Nombre comercial" value={workspaceForm.aiConfig?.businessName || ''} onChange={(value) => setNestedForm('aiConfig', 'businessName', value)} />
										<Input label="Logo de la marca (URL)" value={workspaceForm.branding?.logoUrl || ''} onChange={(value) => setNestedForm('branding', 'logoUrl', value)} />
										<Textarea label="Contexto comercial" rows={5} value={workspaceForm.aiConfig?.businessContext || ''} onChange={(value) => setNestedForm('aiConfig', 'businessContext', value)} />
										<div className="tenant-admin-context-tools">
											<button type="button" disabled={saving || loading || generatingBusinessContext || !selectedWorkspaceId} onClick={handleGenerateBusinessContext}>
												{generatingBusinessContext ? 'Generando contexto...' : 'Generar contexto base'}
											</button>
											<small>Arma un borrador con datos reales de la tienda, catalogo y configuracion operativa.</small>
										</div>
										<Textarea label="Instrucciones extra del sistema" rows={5} value={workspaceForm.aiConfig?.systemPrompt || ''} onChange={(value) => setNestedForm('aiConfig', 'systemPrompt', value)} />
										<button type="submit" disabled={saving || loading}>Guardar marca</button>
										<button type="button" disabled={saving || loading} onClick={handleDeleteWorkspace}>Borrar marca</button>
									</form>
								</>
							) : (
								<div className="tenant-admin-empty">Seleccioná una marca para editarla.</div>
							)
						) : (
							<>
								<div className="tenant-admin-brand-summary">
									<div className="tenant-admin-brand-logo-box">
										{brandLogoUrl && !brandLogoFailed ? (
											<img src={brandLogoUrl} alt={brandName} onError={() => setBrandLogoFailed(true)} />
										) : (
											<span>{getInitials(brandName)}</span>
										)}
									</div>
									<div className="tenant-admin-brand-copy">
										<strong>{brandName}</strong>
										<span>{brandStoreUrl || 'Tienda Nube sin URL sincronizada'}</span>
										<button type="button" disabled={saving || loading} onClick={handleBrandingSync}>
											{saving ? 'Importando...' : 'Importar logo Tienda Nube'}
										</button>
									</div>
								</div>
								<div className="tenant-admin-shopify-card">
									<div>
										<strong>Shopify</strong>
										<span>{shopifyStatus?.shopDomain || 'Conecta la tienda Shopify de esta marca.'}</span>
									</div>
									<div className="tenant-admin-shopify-actions">
										<Input
											label="Dominio Shopify"
											value={shopifyInstallShop}
											placeholder="mi-tienda.myshopify.com"
											onChange={setShopifyInstallShop}
										/>
										<button type="button" disabled={saving || loading || !selectedWorkspaceId} onClick={() => handleStartShopifyInstall(shopifyInstallShop)}>
											Conectar Shopify
										</button>
									</div>
								</div>
							</>
						)}
					</section>
				) : null}

				{activeTab === 'content' ? (
					<section className="tenant-admin-panel">
						<SectionIntro
							title="Asesora IA"
							description="Definí cómo se llama la asesora virtual de la marca y cuál es su tono al responder."
						/>
						<form className="tenant-admin-grid" onSubmit={handleSaveBrand}>
							<Input label="Nombre de la asesora IA" value={workspaceForm.aiConfig?.agentName || ''} onChange={(value) => setNestedForm('aiConfig', 'agentName', value)} />
							<Textarea label="Tono de la asesora" value={workspaceForm.aiConfig?.tone || ''} onChange={(value) => setNestedForm('aiConfig', 'tone', value)} />
							<button type="submit" disabled={saving || loading}>Guardar asesora IA</button>
						</form>
					</section>
				) : null}

				{activeTab === 'content' ? (
					<section className="tenant-admin-panel">
						<SectionIntro
							title="Datos de pago"
							description="Estos datos son los que la asesora puede compartir cuando el cliente necesita pagar por transferencia."
						/>
						<form className="tenant-admin-grid" onSubmit={handleSavePayment}>
							<Input label="Banco para transferencias" value={paymentForm.transferBank} onChange={(value) => setPaymentForm((cur) => ({ ...cur, transferBank: value }))} />
							<Input label="Titular de la cuenta" value={paymentForm.transferHolder} onChange={(value) => setPaymentForm((cur) => ({ ...cur, transferHolder: value }))} />
							<Input label="Alias" value={paymentForm.transferAlias} onChange={(value) => setPaymentForm((cur) => ({ ...cur, transferAlias: value }))} />
							<Input label="CBU / CVU" value={paymentForm.transferCbu} onChange={(value) => setPaymentForm((cur) => ({ ...cur, transferCbu: value }))} />
							<Textarea label="Texto extra para transferencia" value={paymentForm.transferExtra} onChange={(value) => setPaymentForm((cur) => ({ ...cur, transferExtra: value }))} />
							<button type="submit" disabled={saving}>Guardar datos de pago</button>
						</form>
					</section>
				) : null}

				{activeTab === 'users' ? (
					<section className="tenant-admin-panel">
						<h3>Usuarios y permisos</h3>
						<div className="tenant-admin-users">
							{users.map((item) => (
								<div className="tenant-admin-user-row" key={item.id}>
									<strong>{item.name}</strong>
									<span>{item.email}</span>
									<small>{item.role}</small>
									<button
										type="button"
										disabled={!platformAdmin && item.role !== 'AGENT'}
										onClick={() => editUser(item)}
									>
										Editar
									</button>
								</div>
							))}
						</div>
						<form className="tenant-admin-grid" onSubmit={handleSaveUser}>
							<Input label="Nombre" value={userForm.name} required onChange={(value) => setUserForm((cur) => ({ ...cur, name: value }))} />
							<Input label="Email" value={userForm.email} required={!userForm.id} onChange={(value) => setUserForm((cur) => ({ ...cur, email: value }))} />
							<Input label={userForm.id ? 'Nuevo password' : 'Password'} type="password" value={userForm.password} required={!userForm.id} onChange={(value) => setUserForm((cur) => ({ ...cur, password: value }))} />
							<Select label="Rol" value={userForm.role} onChange={(value) => setUserForm((cur) => ({ ...cur, role: value }))}>
								<option value="AGENT">AGENT - solo inbox</option>
								{platformAdmin ? <option value="ADMIN">ADMIN - marca completa</option> : null}
								{platformAdmin ? <option value="PLATFORM_ADMIN">PLATFORM_ADMIN</option> : null}
							</Select>
							<button type="submit" disabled={saving}>{userForm.id ? 'Actualizar usuario' : 'Crear usuario'}</button>
							{userForm.id ? <button type="button" onClick={() => setUserForm(EMPTY_USER_FORM)}>Cancelar edicion</button> : null}
						</form>
					</section>
				) : null}

				{activeTab === 'integrations' ? (
					<section className="tenant-admin-panel">
						<h3>Conexion Tienda Nube</h3>
						<div className="tenant-admin-metrics">
							<StatusPill>Store ID: {tiendanubeStatus?.storeId || 'sin conectar'}</StatusPill>
							<StatusPill>Source: {tiendanubeStatus?.activeSource || 'sin resolver'}</StatusPill>
							<StatusPill>App secret: {tiendanubeStatus?.hasAppSecret ? 'ok' : 'falta revisar'}</StatusPill>
							<StatusPill>Webhooks esperados: {(tiendanubeStatus?.orderWebhookEvents || []).length || 0}</StatusPill>
						</div>
						<div className="tenant-admin-actions">
							<button type="button" disabled={saving || !selectedWorkspaceId} onClick={handleStartTiendanubeInstall}>
								Conectar Tiendanube
							</button>
							{platformAdmin ? (
								<button type="button" disabled={saving} onClick={handleBrandingSync}>
									Importar branding
								</button>
							) : null}
							<button type="button" disabled={saving || !selectedWorkspaceId} onClick={() => handleCatalogSync('TIENDANUBE')}>
								Sincronizar catalogo
							</button>
						</div>
					</section>
				) : null}

				{activeTab === 'integrations' ? (
					<section className="tenant-admin-panel">
						<h3>Conexion Shopify</h3>
						<div className="tenant-admin-metrics">
							<StatusPill>OAuth: {shopifyStatus?.hasClientSecret ? 'listo' : 'revisar credenciales'}</StatusPill>
							<StatusPill>Tienda: {shopifyStatus?.shopDomain || 'sin tienda'}</StatusPill>
							<StatusPill>Estado: {shopifyStatus?.status || 'sin resolver'}</StatusPill>
							<StatusPill>API: {shopifyStatus?.apiVersion || '2026-04'}</StatusPill>
						</div>
						<div className="tenant-admin-grid">
							<Input
								label="Dominio Shopify"
								value={shopifyInstallShop}
								placeholder="mi-tienda.myshopify.com"
								onChange={setShopifyInstallShop}
							/>
							<button type="button" disabled={saving || !selectedWorkspaceId} onClick={() => handleStartShopifyInstall(shopifyInstallShop)}>
								Conectar Shopify
							</button>
							<button type="button" disabled={saving || !selectedWorkspaceId} onClick={() => handleCatalogSync('SHOPIFY')}>
								Sincronizar catalogo Shopify
							</button>
						</div>
						<small className="tenant-admin-helper">
							Link directo: {selectedWorkspaceId && shopifyInstallShop ? buildApiUrl(`/shopify/install?${new URLSearchParams({ workspaceId: selectedWorkspaceId, shop: shopifyInstallShop }).toString()}`) : 'completa el dominio para generarlo'}
						</small>
					</section>
				) : null}

				{platformAdmin && activeTab === 'integrations' ? (
					<section className="tenant-admin-panel">
						<h3>WhatsApp Cloud API</h3>
						<form className="tenant-admin-grid" onSubmit={handleSaveChannel}>
							<Input label="Nombre" value={channelForm.name} onChange={(value) => setChannelForm((cur) => ({ ...cur, name: value }))} />
							<Input label="WABA ID" value={channelForm.wabaId} required onChange={(value) => setChannelForm((cur) => ({ ...cur, wabaId: value }))} />
							<Input label="Phone Number ID" value={channelForm.phoneNumberId} required onChange={(value) => setChannelForm((cur) => ({ ...cur, phoneNumberId: value }))} />
							<Input label="Telefono visible" value={channelForm.displayPhoneNumber} onChange={(value) => setChannelForm((cur) => ({ ...cur, displayPhoneNumber: value }))} />
							<Input label="Access token" type="password" value={channelForm.accessToken} required={!channelForm.id} onChange={(value) => setChannelForm((cur) => ({ ...cur, accessToken: value }))} />
							<Input label="Verify token" value={channelForm.verifyToken} onChange={(value) => setChannelForm((cur) => ({ ...cur, verifyToken: value }))} />
							<Input label="Graph version" value={channelForm.graphVersion} onChange={(value) => setChannelForm((cur) => ({ ...cur, graphVersion: value }))} />
							<Select label="Estado" value={channelForm.status} onChange={(value) => setChannelForm((cur) => ({ ...cur, status: value }))}>
								<option value="ACTIVE">ACTIVE</option>
								<option value="PENDING">PENDING</option>
								<option value="DISABLED">DISABLED</option>
								<option value="ERROR">ERROR</option>
							</Select>
							<button type="submit" disabled={saving}>Guardar WhatsApp</button>
						</form>
					</section>
				) : null}

				{platformAdmin && activeTab === 'integrations' ? (
					<section className="tenant-admin-panel">
						<h3>Ecommerce</h3>
						{commerceProvider === 'TIENDANUBE' ? (
							<div className="tenant-admin-metrics">
								<StatusPill>OAuth: {tiendanubeStatus?.hasAppSecret ? 'listo' : 'revisar app secret'}</StatusPill>
								<StatusPill>Instalada: {tiendanubeStatus?.storeId || 'sin tienda'}</StatusPill>
								<StatusPill>Source: {tiendanubeStatus?.activeSource || 'sin resolver'}</StatusPill>
								<StatusPill>Webhooks: {(tiendanubeStatus?.orderWebhookEvents || []).length || 0} eventos</StatusPill>
							</div>
						) : null}
						{commerceProvider === 'SHOPIFY' ? (
							<div className="tenant-admin-metrics">
								<StatusPill>OAuth: {shopifyStatus?.hasClientSecret ? 'listo' : 'revisar credenciales'}</StatusPill>
								<StatusPill>Tienda: {shopifyStatus?.shopDomain || 'sin tienda'}</StatusPill>
								<StatusPill>Estado: {shopifyStatus?.status || 'sin resolver'}</StatusPill>
								<StatusPill>API: {shopifyStatus?.apiVersion || commerceForm.apiVersion || '2026-04'}</StatusPill>
							</div>
						) : null}
						<form className="tenant-admin-grid" onSubmit={handleSaveCommerce}>
							<Select label="Proveedor" value={commerceProvider} onChange={(value) => {
								setCommerceProvider(value);
								setCommerceForm((cur) => ({ ...EMPTY_COMMERCE_FORM, provider: value, apiVersion: cur.apiVersion || EMPTY_COMMERCE_FORM.apiVersion }));
							}}>
								<option value="SHOPIFY">SHOPIFY</option>
								<option value="TIENDANUBE">TIENDANUBE</option>
							</Select>
							<Input label="Store ID / dominio" value={commerceForm.externalStoreId} required onChange={(value) => setCommerceForm((cur) => ({ ...cur, externalStoreId: value }))} />
							<Input label="Shop domain" value={commerceForm.shopDomain} onChange={(value) => setCommerceForm((cur) => ({ ...cur, shopDomain: value }))} />
							<Input label="Access token" type="password" value={commerceForm.accessToken} required={!commerceForm.id} onChange={(value) => setCommerceForm((cur) => ({ ...cur, accessToken: value }))} />
							<Input label="Refresh token" type="password" value={commerceForm.refreshToken} onChange={(value) => setCommerceForm((cur) => ({ ...cur, refreshToken: value }))} />
							<Input label="Scopes" value={commerceForm.scope} onChange={(value) => setCommerceForm((cur) => ({ ...cur, scope: value }))} />
							<Input label="Store name" value={commerceForm.storeName} onChange={(value) => setCommerceForm((cur) => ({ ...cur, storeName: value }))} />
							<Input label="Store URL" value={commerceForm.storeUrl} onChange={(value) => setCommerceForm((cur) => ({ ...cur, storeUrl: value }))} />
							<Input label="API version" value={commerceForm.apiVersion} onChange={(value) => setCommerceForm((cur) => ({ ...cur, apiVersion: value }))} />
							<Select label="Estado" value={commerceForm.status} onChange={(value) => setCommerceForm((cur) => ({ ...cur, status: value }))}>
								<option value="ACTIVE">ACTIVE</option>
								<option value="PENDING">PENDING</option>
								<option value="DISABLED">DISABLED</option>
								<option value="ERROR">ERROR</option>
							</Select>
							<button type="submit" disabled={saving}>Guardar ecommerce</button>
							{commerceProvider === 'TIENDANUBE' ? (
								<button type="button" disabled={saving || !selectedWorkspaceId} onClick={handleStartTiendanubeInstall}>
									Conectar Tiendanube
								</button>
							) : null}
							{commerceProvider === 'SHOPIFY' ? (
								<button type="button" disabled={saving || !selectedWorkspaceId} onClick={() => handleStartShopifyInstall()}>
									Conectar Shopify
								</button>
							) : null}
						</form>
					</section>
				) : null}

				{platformAdmin && activeTab === 'integrations' ? (
					<section className="tenant-admin-panel">
						<h3>Enbox</h3>
						<form className="tenant-admin-grid" onSubmit={handleSaveLogistics}>
							<Input label="Usuario" value={logisticsForm.username} required onChange={(value) => setLogisticsForm((cur) => ({ ...cur, username: value }))} />
							<Input label="Password" type="password" value={logisticsForm.password} required={!logisticsForm.id} onChange={(value) => setLogisticsForm((cur) => ({ ...cur, password: value }))} />
							<Input label="Panel base URL" value={logisticsForm.panelBaseUrl} onChange={(value) => setLogisticsForm((cur) => ({ ...cur, panelBaseUrl: value }))} />
							<Input label="Public base URL" value={logisticsForm.publicBaseUrl} onChange={(value) => setLogisticsForm((cur) => ({ ...cur, publicBaseUrl: value }))} />
							<Input label="Tracking salt" value={logisticsForm.publicTrackingSalt} onChange={(value) => setLogisticsForm((cur) => ({ ...cur, publicTrackingSalt: value }))} />
							<Input label="Target client ID" value={logisticsForm.targetClientId} onChange={(value) => setLogisticsForm((cur) => ({ ...cur, targetClientId: value }))} />
							<Input label="Seed DID" value={logisticsForm.discoverySeedDid} onChange={(value) => setLogisticsForm((cur) => ({ ...cur, discoverySeedDid: value }))} />
							<Select label="Estado" value={logisticsForm.status} onChange={(value) => setLogisticsForm((cur) => ({ ...cur, status: value }))}>
								<option value="ACTIVE">ACTIVE</option>
								<option value="PENDING">PENDING</option>
								<option value="DISABLED">DISABLED</option>
								<option value="ERROR">ERROR</option>
							</Select>
							<button type="submit" disabled={saving}>Guardar Enbox</button>
						</form>
					</section>
				) : null}

				{activeTab === 'analytics' ? (
					<section className="tenant-admin-panel tenant-admin-panel--analytics">
						<div className="tenant-admin-panel-heading">
							<div>
								<h3>{platformAdmin ? 'Estadisticas multi-marca' : 'Estadisticas de marca'}</h3>
								<p>{platformAdmin
									? 'Resumen por marca con actividad de WhatsApp, ventas, campañas y recuperación.'
									: 'Resumen de WhatsApp, ventas, campañas y recuperación de esta marca.'}</p>
							</div>
							{analytics?.activityWindowDays ? (
								<span>Últimos {formatNumber(analytics.activityWindowDays)} días</span>
							) : null}
						</div>
						<div className="tenant-admin-metrics">
							<StatusPill>Campañas: {formatNumber(analytics?.totals?.campaignsCount)}</StatusPill>
							<StatusPill>Activas: {formatNumber(analytics?.totals?.activeCampaignsCount)}</StatusPill>
							<StatusPill>Destinatarios: {formatNumber(analytics?.totals?.recipientsCount)}</StatusPill>
							<StatusPill>Clientes: {formatNumber(analytics?.totals?.customersCount)}</StatusPill>
							<StatusPill>Facturacion: {formatCurrency(analytics?.totals?.revenueTotal, analytics?.totals?.currency)}</StatusPill>
							<StatusPill>Conversaciones 30d: {formatNumber(analytics?.totals?.activeConversations30d)}</StatusPill>
							<StatusPill>Carritos recuperados: {formatNumber(analytics?.totals?.recoveredCartsCount)}</StatusPill>
							<StatusPill>Costo estimado: {formatUsd(analytics?.totals?.estimatedCampaignCostUsd)}</StatusPill>
						</div>
						<div className="workspace-analytics-grid">
							{(analytics?.workspaces || []).map((item) => (
								<WorkspaceAnalyticsCard
									key={item.workspace.id}
									item={item}
									selected={analytics?.detail?.workspaceId === item.workspace.id}
									onSelect={() => setSelectedWorkspaceId(item.workspace.id)}
								/>
							))}
						</div>
						{!analyticsLoading && !(analytics?.workspaces || []).length ? (
							<div className="tenant-admin-empty">No hay marcas para mostrar.</div>
						) : null}
						{analyticsLoading ? <StatusPill>Cargando estadísticas...</StatusPill> : null}
					</section>
				) : null}


				{platformAdmin && activeTab === 'operations' ? (
					<section className="tenant-admin-panel">
						<h3>Operaciones</h3>
						<div className="tenant-admin-metrics">
							<StatusPill>Productos: {catalogStatus?.totalProducts ?? 0}</StatusPill>
							<StatusPill>Publicados: {catalogStatus?.totalPublished ?? 0}</StatusPill>
							<StatusPill>Ultima sync: {catalogStatus?.lastSync?.status || 'sin sync'}</StatusPill>
						</div>
						<div className="tenant-admin-actions">
							<button type="button" disabled={saving} onClick={handleBrandingSync}>Importar branding Tienda Nube</button>
							<button type="button" disabled={saving} onClick={() => handleCatalogSync('TIENDANUBE')}>Sincronizar Tienda Nube</button>
							<button type="button" disabled={saving} onClick={() => handleCatalogSync('SHOPIFY')}>Sincronizar Shopify</button>
						</div>
					</section>
				) : null}
			</div>
		</div>
	);
}
