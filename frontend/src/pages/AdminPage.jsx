import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isPlatformAdminUser } from '../lib/authz.js';
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

const EMPTY_CATALOG_FORM = {
	bodys: '',
	bombachasModeladoras: '',
	calzasLinfaticas: '',
	fajas: '',
	shortsFaja: '',
	general: ''
};

const EMPTY_POLICY_FORM = {
	shipping: '',
	promotions: '',
	minPurchase: '',
	humanHandoff: ''
};

const tabs = [
	{ key: 'brand', label: 'Marca' },
	{ key: 'users', label: 'Usuarios' },
	{ key: 'whatsapp', label: 'WhatsApp' },
	{ key: 'commerce', label: 'Ecommerce' },
	{ key: 'logistics', label: 'Envios' },
	{ key: 'operations', label: 'Operaciones' }
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

function mapCatalogForm(workspace) {
	const catalog = workspace?.aiConfig?.catalogConfig || {};
	return {
		bodys: fieldValue(catalog.bodys),
		bombachasModeladoras: fieldValue(catalog.bombachasModeladoras),
		calzasLinfaticas: fieldValue(catalog.calzasLinfaticas),
		fajas: fieldValue(catalog.fajas),
		shortsFaja: fieldValue(catalog.shortsFaja),
		general: fieldValue(catalog.general)
	};
}

function mapPolicyForm(workspace) {
	const policy = workspace?.aiConfig?.policyConfig || {};
	return {
		shipping: fieldValue(policy.shipping),
		promotions: fieldValue(policy.promotions),
		minPurchase: fieldValue(policy.minPurchase),
		humanHandoff: fieldValue(policy.humanHandoff)
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

export default function AdminPage() {
	const { user } = useAuth();
	const platformAdmin = isPlatformAdminUser(user);
	const [activeTab, setActiveTab] = useState('brand');
	const [workspaces, setWorkspaces] = useState([]);
	const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(user?.workspaceId || '');
	const [workspace, setWorkspace] = useState(null);
	const [workspaceForm, setWorkspaceForm] = useState(mapWorkspaceForm(user?.workspace || null));
	const [workspaceCreateForm, setWorkspaceCreateForm] = useState(EMPTY_WORKSPACE_FORM);
	const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM);
	const [catalogForm, setCatalogForm] = useState(EMPTY_CATALOG_FORM);
	const [policyForm, setPolicyForm] = useState(EMPTY_POLICY_FORM);
	const [users, setUsers] = useState([]);
	const [userForm, setUserForm] = useState(EMPTY_USER_FORM);
	const [channelForm, setChannelForm] = useState(EMPTY_CHANNEL_FORM);
	const [commerceProvider, setCommerceProvider] = useState('SHOPIFY');
	const [commerceForm, setCommerceForm] = useState(EMPTY_COMMERCE_FORM);
	const [logisticsForm, setLogisticsForm] = useState(EMPTY_LOGISTICS_FORM);
	const [catalogStatus, setCatalogStatus] = useState(null);
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
			return;
		}

		const res = await api.get('/admin/workspaces');
		const items = res.data.workspaces || [];
		setWorkspaces(items);
		setSelectedWorkspaceId((current) => current || items[0]?.id || '');
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

		const [workspaceRes, usersRes, catalogRes] = await Promise.all([
			api.get(`/admin/workspaces/${workspaceId}`),
			api.get(`/admin/workspaces/${workspaceId}/users`),
			api.get(`/admin/workspaces/${workspaceId}/catalog/status`).catch(() => null)
		]);

		const nextWorkspace = workspaceRes.data.workspace || null;
		setWorkspace(nextWorkspace);
		setWorkspaceForm(mapWorkspaceForm(nextWorkspace));
		setPaymentForm(mapPaymentForm(nextWorkspace));
		setCatalogForm(mapCatalogForm(nextWorkspace));
		setPolicyForm(mapPolicyForm(nextWorkspace));
		setUsers(usersRes.data.users || []);
		setCatalogStatus(catalogRes?.data?.catalog || null);

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
		if (!selectedWorkspaceId) return;
		setLoading(true);
		loadWorkspaceDetail(selectedWorkspaceId)
			.catch((err) => setError(err.response?.data?.error || err.message))
			.finally(() => setLoading(false));
	}, [selectedWorkspaceId]);

	useEffect(() => {
		if (workspace) selectCommerceConnection(workspace, commerceProvider);
	}, [commerceProvider]);

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
			...workspaceForm.aiConfig,
			paymentConfig: {
				transfer: {
					bank: paymentForm.transferBank,
					holder: paymentForm.transferHolder,
					alias: paymentForm.transferAlias,
					cbu: paymentForm.transferCbu,
					extra: paymentForm.transferExtra
				}
			},
			catalogConfig: {
				bodys: catalogForm.bodys,
				bombachasModeladoras: catalogForm.bombachasModeladoras,
				calzasLinfaticas: catalogForm.calzasLinfaticas,
				fajas: catalogForm.fajas,
				shortsFaja: catalogForm.shortsFaja,
				general: catalogForm.general
			},
			policyConfig: {
				shipping: policyForm.shipping,
				promotions: policyForm.promotions,
				minPurchase: policyForm.minPurchase,
				humanHandoff: policyForm.humanHandoff
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
			setCatalogForm(mapCatalogForm(nextWorkspace));
			setPolicyForm(mapPolicyForm(nextWorkspace));
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
			showNotice('Marca creada.');
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
	}

	async function handleSaveBrand(event) {
		event.preventDefault();
		await saveWorkspace({
			name: workspaceForm.name,
			slug: workspaceForm.slug,
			status: workspaceForm.status,
			branding: workspaceForm.branding,
			aiConfig: buildAiConfig(workspaceForm.aiConfig)
		}, 'Marca e IA guardadas.');
	}

	async function handleSavePayment(event) {
		event.preventDefault();
		await saveWorkspace({ aiConfig: buildAiConfig() }, 'Pagos y politicas guardadas.');
	}

	async function handleSaveCatalogConfig(event) {
		event.preventDefault();
		await saveWorkspace({ aiConfig: buildAiConfig() }, 'Catalogo contextual guardado.');
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
			const res = await api.post(`/admin/workspaces/${selectedWorkspaceId}/catalog/sync`, { provider });
			setCatalogStatus(res.data.catalog || null);
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
			showNotice('Branding importado desde Tienda Nube.');
		} catch (err) {
			showError(err);
		} finally {
			setSaving(false);
		}
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

	return (
		<div className="tenant-admin-page">
			<header className="tenant-admin-header">
				<div>
					<h2>Admin multi marca</h2>
					<p>{workspace?.name || 'Configuracion de workspaces, accesos e integraciones'}</p>
				</div>
				{workspaceOptions.length ? (
					<Select label="Workspace" value={selectedWorkspaceId} onChange={setSelectedWorkspaceId}>
						{workspaceOptions.map((item) => (
							<option key={item.id} value={item.id}>
								{item.name || item.slug || item.id}
							</option>
						))}
					</Select>
				) : null}
			</header>

			{notice ? <div className="tenant-admin-alert success">{notice}</div> : null}
			{error ? <div className="tenant-admin-alert error">{error}</div> : null}

			<div className="tenant-admin-tabs">
				{tabs.map((tab) => (
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

			<div className="tenant-admin-scroll">
				{platformAdmin && activeTab === 'brand' ? (
					<section className="tenant-admin-panel">
						<h3>Nueva marca</h3>
						<form className="tenant-admin-grid" onSubmit={handleCreateWorkspace}>
							<Input label="Nombre" value={workspaceCreateForm.name} required onChange={(value) => setWorkspaceCreateForm((cur) => ({ ...cur, name: value }))} />
							<Input label="Slug" value={workspaceCreateForm.slug} required onChange={(value) => setWorkspaceCreateForm((cur) => ({ ...cur, slug: value }))} />
							<Input label="Nombre IA" value={workspaceCreateForm.businessName} onChange={(value) => setWorkspaceCreateForm((cur) => ({ ...cur, businessName: value }))} />
							<Input label="Agente" value={workspaceCreateForm.agentName} onChange={(value) => setWorkspaceCreateForm((cur) => ({ ...cur, agentName: value }))} />
							<Textarea label="Tono" value={workspaceCreateForm.tone} onChange={(value) => setWorkspaceCreateForm((cur) => ({ ...cur, tone: value }))} />
							<button type="submit" disabled={saving}>Crear marca</button>
						</form>
					</section>
				) : null}

				{activeTab === 'brand' ? (
					<section className="tenant-admin-panel">
						<h3>Marca, branding e IA</h3>
						<form className="tenant-admin-grid" onSubmit={handleSaveBrand}>
							<Input label="Nombre" value={workspaceForm.name} onChange={(value) => setWorkspaceForm((cur) => ({ ...cur, name: value }))} />
							<Input label="Slug" value={workspaceForm.slug} onChange={(value) => setWorkspaceForm((cur) => ({ ...cur, slug: value }))} />
							<Select label="Estado" value={workspaceForm.status || 'ACTIVE'} onChange={(value) => setWorkspaceForm((cur) => ({ ...cur, status: value }))}>
								<option value="ACTIVE">ACTIVE</option>
								<option value="SUSPENDED">SUSPENDED</option>
								<option value="ARCHIVED">ARCHIVED</option>
							</Select>
							<Input label="Logo URL" value={workspaceForm.branding?.logoUrl || ''} onChange={(value) => setNestedForm('branding', 'logoUrl', value)} />
							<Input label="Color primario" type="color" value={workspaceForm.branding?.primaryColor || '#0f172a'} onChange={(value) => setNestedForm('branding', 'primaryColor', value)} />
							<Input label="Color secundario" type="color" value={workspaceForm.branding?.secondaryColor || '#f8fafc'} onChange={(value) => setNestedForm('branding', 'secondaryColor', value)} />
							<Input label="Color acento" type="color" value={workspaceForm.branding?.accentColor || '#10b981'} onChange={(value) => setNestedForm('branding', 'accentColor', value)} />
							<Input label="Nombre comercial" value={workspaceForm.aiConfig?.businessName || ''} onChange={(value) => setNestedForm('aiConfig', 'businessName', value)} />
							<Input label="Agente IA" value={workspaceForm.aiConfig?.agentName || ''} onChange={(value) => setNestedForm('aiConfig', 'agentName', value)} />
							<Textarea label="Tono" value={workspaceForm.aiConfig?.tone || ''} onChange={(value) => setNestedForm('aiConfig', 'tone', value)} />
							<Textarea label="Contexto de negocio" rows={5} value={workspaceForm.aiConfig?.businessContext || ''} onChange={(value) => setNestedForm('aiConfig', 'businessContext', value)} />
							<Textarea label="System prompt extra" rows={5} value={workspaceForm.aiConfig?.systemPrompt || ''} onChange={(value) => setNestedForm('aiConfig', 'systemPrompt', value)} />
							<button type="submit" disabled={saving || loading}>Guardar marca</button>
						</form>
					</section>
				) : null}

				{activeTab === 'brand' ? (
					<section className="tenant-admin-panel">
						<h3>Pagos, politicas y catalogo contextual</h3>
						<form className="tenant-admin-grid" onSubmit={handleSavePayment}>
							<Input label="Banco transferencia" value={paymentForm.transferBank} onChange={(value) => setPaymentForm((cur) => ({ ...cur, transferBank: value }))} />
							<Input label="Titular" value={paymentForm.transferHolder} onChange={(value) => setPaymentForm((cur) => ({ ...cur, transferHolder: value }))} />
							<Input label="Alias" value={paymentForm.transferAlias} onChange={(value) => setPaymentForm((cur) => ({ ...cur, transferAlias: value }))} />
							<Input label="CBU/CVU" value={paymentForm.transferCbu} onChange={(value) => setPaymentForm((cur) => ({ ...cur, transferCbu: value }))} />
							<Textarea label="Texto transferencia" value={paymentForm.transferExtra} onChange={(value) => setPaymentForm((cur) => ({ ...cur, transferExtra: value }))} />
							<Textarea label="Envios" value={policyForm.shipping} onChange={(value) => setPolicyForm((cur) => ({ ...cur, shipping: value }))} />
							<Textarea label="Promos" value={policyForm.promotions} onChange={(value) => setPolicyForm((cur) => ({ ...cur, promotions: value }))} />
							<Input label="Compra minima" value={policyForm.minPurchase} onChange={(value) => setPolicyForm((cur) => ({ ...cur, minPurchase: value }))} />
							<Textarea label="Derivacion humana" value={policyForm.humanHandoff} onChange={(value) => setPolicyForm((cur) => ({ ...cur, humanHandoff: value }))} />
							<button type="submit" disabled={saving}>Guardar pagos y politicas</button>
						</form>
						<form className="tenant-admin-grid" onSubmit={handleSaveCatalogConfig}>
							<Input label="Catalogo general" value={catalogForm.general} onChange={(value) => setCatalogForm((cur) => ({ ...cur, general: value }))} />
							<Input label="Bodys" value={catalogForm.bodys} onChange={(value) => setCatalogForm((cur) => ({ ...cur, bodys: value }))} />
							<Input label="Bombachas modeladoras" value={catalogForm.bombachasModeladoras} onChange={(value) => setCatalogForm((cur) => ({ ...cur, bombachasModeladoras: value }))} />
							<Input label="Calzas linfaticas" value={catalogForm.calzasLinfaticas} onChange={(value) => setCatalogForm((cur) => ({ ...cur, calzasLinfaticas: value }))} />
							<Input label="Fajas" value={catalogForm.fajas} onChange={(value) => setCatalogForm((cur) => ({ ...cur, fajas: value }))} />
							<Input label="Shorts faja" value={catalogForm.shortsFaja} onChange={(value) => setCatalogForm((cur) => ({ ...cur, shortsFaja: value }))} />
							<button type="submit" disabled={saving}>Guardar catalogo contextual</button>
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
									<button type="button" onClick={() => editUser(item)}>Editar</button>
								</div>
							))}
						</div>
						<form className="tenant-admin-grid" onSubmit={handleSaveUser}>
							<Input label="Nombre" value={userForm.name} required onChange={(value) => setUserForm((cur) => ({ ...cur, name: value }))} />
							<Input label="Email" value={userForm.email} required={!userForm.id} onChange={(value) => setUserForm((cur) => ({ ...cur, email: value }))} />
							<Input label={userForm.id ? 'Nuevo password' : 'Password'} type="password" value={userForm.password} required={!userForm.id} onChange={(value) => setUserForm((cur) => ({ ...cur, password: value }))} />
							<Select label="Rol" value={userForm.role} onChange={(value) => setUserForm((cur) => ({ ...cur, role: value }))}>
								<option value="AGENT">AGENT - solo inbox</option>
								<option value="ADMIN">ADMIN - marca completa</option>
								{platformAdmin ? <option value="PLATFORM_ADMIN">PLATFORM_ADMIN</option> : null}
							</Select>
							<button type="submit" disabled={saving}>{userForm.id ? 'Actualizar usuario' : 'Crear usuario'}</button>
							{userForm.id ? <button type="button" onClick={() => setUserForm(EMPTY_USER_FORM)}>Cancelar edicion</button> : null}
						</form>
					</section>
				) : null}

				{activeTab === 'whatsapp' ? (
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

				{activeTab === 'commerce' ? (
					<section className="tenant-admin-panel">
						<h3>Ecommerce</h3>
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
						</form>
					</section>
				) : null}

				{activeTab === 'logistics' ? (
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

				{activeTab === 'operations' ? (
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
