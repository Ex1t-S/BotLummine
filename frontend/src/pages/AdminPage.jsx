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
	name: '',
	email: '',
	password: '',
	role: 'AGENT'
};

const EMPTY_CHANNEL_FORM = {
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
	storeName: '',
	storeUrl: '',
	apiVersion: '2026-04',
	status: 'ACTIVE'
};

function fieldValue(value) {
	return value == null ? '' : String(value);
}

function mapWorkspaceForm(workspace) {
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
			businessName: fieldValue(workspace?.aiConfig?.businessName),
			agentName: fieldValue(workspace?.aiConfig?.agentName),
			tone: fieldValue(workspace?.aiConfig?.tone),
			systemPrompt: fieldValue(workspace?.aiConfig?.systemPrompt),
			businessContext: fieldValue(workspace?.aiConfig?.businessContext)
		}
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

export default function AdminPage() {
	const { user } = useAuth();
	const platformAdmin = isPlatformAdminUser(user);
	const [workspaces, setWorkspaces] = useState([]);
	const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(user?.workspaceId || '');
	const [workspace, setWorkspace] = useState(null);
	const [workspaceForm, setWorkspaceForm] = useState(mapWorkspaceForm(user?.workspace || null));
	const [workspaceCreateForm, setWorkspaceCreateForm] = useState(EMPTY_WORKSPACE_FORM);
	const [users, setUsers] = useState([]);
	const [userForm, setUserForm] = useState(EMPTY_USER_FORM);
	const [channelForm, setChannelForm] = useState(EMPTY_CHANNEL_FORM);
	const [commerceForm, setCommerceForm] = useState(EMPTY_COMMERCE_FORM);
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

	async function loadWorkspaceDetail(workspaceId) {
		if (!workspaceId) return;

		const [workspaceRes, usersRes] = await Promise.all([
			api.get(`/admin/workspaces/${workspaceId}`),
			api.get(`/admin/workspaces/${workspaceId}/users`)
		]);

		const nextWorkspace = workspaceRes.data.workspace || null;
		setWorkspace(nextWorkspace);
		setWorkspaceForm(mapWorkspaceForm(nextWorkspace));
		setUsers(usersRes.data.users || []);

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

		const connection = nextWorkspace?.commerceConnections?.find((item) => item.provider === 'SHOPIFY') ||
			nextWorkspace?.commerceConnections?.[0] ||
			null;
		setCommerceForm({
			...EMPTY_COMMERCE_FORM,
			id: connection?.id || '',
			provider: connection?.provider || EMPTY_COMMERCE_FORM.provider,
			externalStoreId: fieldValue(connection?.externalStoreId),
			shopDomain: fieldValue(connection?.shopDomain),
			storeName: fieldValue(connection?.storeName),
			storeUrl: fieldValue(connection?.storeUrl),
			status: fieldValue(connection?.status || 'ACTIVE'),
			accessToken: '',
			apiVersion: fieldValue(connection?.rawPayload?.apiVersion || EMPTY_COMMERCE_FORM.apiVersion)
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

	function setNestedForm(section, key, value) {
		setWorkspaceForm((current) => ({
			...current,
			[section]: {
				...(current[section] || {}),
				[key]: value
			}
		}));
	}

	async function handleCreateWorkspace(event) {
		event.preventDefault();
		setSaving(true);
		setError('');
		setNotice('');
		try {
			const res = await api.post('/admin/workspaces', workspaceCreateForm);
			const created = res.data.workspace;
			setWorkspaceCreateForm(EMPTY_WORKSPACE_FORM);
			await loadWorkspaces();
			setSelectedWorkspaceId(created?.id || '');
			setNotice('Marca creada.');
		} catch (err) {
			setError(err.response?.data?.error || err.message);
		} finally {
			setSaving(false);
		}
	}

	async function handleSaveWorkspace(event) {
		event.preventDefault();
		setSaving(true);
		setError('');
		setNotice('');
		try {
			const payload = {
				name: workspaceForm.name,
				slug: workspaceForm.slug,
				status: workspaceForm.status,
				branding: workspaceForm.branding,
				aiConfig: workspaceForm.aiConfig
			};
			const res = await api.patch(`/admin/workspaces/${selectedWorkspaceId}`, payload);
			setWorkspace(res.data.workspace || null);
			setNotice('Configuracion guardada.');
		} catch (err) {
			setError(err.response?.data?.error || err.message);
		} finally {
			setSaving(false);
		}
	}

	async function handleCreateUser(event) {
		event.preventDefault();
		setSaving(true);
		setError('');
		setNotice('');
		try {
			await api.post(`/admin/workspaces/${selectedWorkspaceId}/users`, userForm);
			setUserForm(EMPTY_USER_FORM);
			await loadWorkspaceDetail(selectedWorkspaceId);
			setNotice('Usuario creado.');
		} catch (err) {
			setError(err.response?.data?.error || err.message);
		} finally {
			setSaving(false);
		}
	}

	async function handleSaveChannel(event) {
		event.preventDefault();
		setSaving(true);
		setError('');
		setNotice('');
		try {
			await api.put(`/admin/workspaces/${selectedWorkspaceId}/whatsapp-channel`, channelForm);
			await loadWorkspaceDetail(selectedWorkspaceId);
			setNotice('Canal WhatsApp guardado.');
		} catch (err) {
			setError(err.response?.data?.error || err.message);
		} finally {
			setSaving(false);
		}
	}

	async function handleSaveCommerce(event) {
		event.preventDefault();
		setSaving(true);
		setError('');
		setNotice('');
		try {
			await api.put(
				`/admin/workspaces/${selectedWorkspaceId}/commerce-connections/${commerceForm.provider}`,
				commerceForm
			);
			await loadWorkspaceDetail(selectedWorkspaceId);
			setNotice('Conexion ecommerce guardada.');
		} catch (err) {
			setError(err.response?.data?.error || err.message);
		} finally {
			setSaving(false);
		}
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

			<div className="tenant-admin-scroll">
				{platformAdmin ? (
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

				<section className="tenant-admin-panel">
					<h3>Marca e IA</h3>
					<form className="tenant-admin-grid" onSubmit={handleSaveWorkspace}>
						<Input label="Nombre" value={workspaceForm.name} onChange={(value) => setWorkspaceForm((cur) => ({ ...cur, name: value }))} />
						<Input label="Slug" value={workspaceForm.slug} onChange={(value) => setWorkspaceForm((cur) => ({ ...cur, slug: value }))} />
						<Select label="Estado" value={workspaceForm.status || 'ACTIVE'} onChange={(value) => setWorkspaceForm((cur) => ({ ...cur, status: value }))}>
							<option value="ACTIVE">ACTIVE</option>
							<option value="SUSPENDED">SUSPENDED</option>
							<option value="ARCHIVED">ARCHIVED</option>
						</Select>
						<Input label="Logo URL" value={workspaceForm.branding?.logoUrl || ''} onChange={(value) => setNestedForm('branding', 'logoUrl', value)} />
						<Input label="Color primario" type="color" value={workspaceForm.branding?.primaryColor || '#0f172a'} onChange={(value) => setNestedForm('branding', 'primaryColor', value)} />
						<Input label="Color acento" type="color" value={workspaceForm.branding?.accentColor || '#10b981'} onChange={(value) => setNestedForm('branding', 'accentColor', value)} />
						<Input label="Nombre comercial" value={workspaceForm.aiConfig?.businessName || ''} onChange={(value) => setNestedForm('aiConfig', 'businessName', value)} />
						<Input label="Agente IA" value={workspaceForm.aiConfig?.agentName || ''} onChange={(value) => setNestedForm('aiConfig', 'agentName', value)} />
						<Textarea label="Tono" value={workspaceForm.aiConfig?.tone || ''} onChange={(value) => setNestedForm('aiConfig', 'tone', value)} />
						<Textarea label="Contexto de negocio" value={workspaceForm.aiConfig?.businessContext || ''} onChange={(value) => setNestedForm('aiConfig', 'businessContext', value)} />
						<Textarea label="System prompt extra" value={workspaceForm.aiConfig?.systemPrompt || ''} onChange={(value) => setNestedForm('aiConfig', 'systemPrompt', value)} />
						<button type="submit" disabled={saving || loading}>Guardar marca</button>
					</form>
				</section>

				<section className="tenant-admin-panel">
					<h3>Usuarios</h3>
					<div className="tenant-admin-users">
						{users.map((item) => (
							<div className="tenant-admin-user-row" key={item.id}>
								<strong>{item.name}</strong>
								<span>{item.email}</span>
								<small>{item.role}</small>
							</div>
						))}
					</div>
					<form className="tenant-admin-grid" onSubmit={handleCreateUser}>
						<Input label="Nombre" value={userForm.name} required onChange={(value) => setUserForm((cur) => ({ ...cur, name: value }))} />
						<Input label="Email" value={userForm.email} required onChange={(value) => setUserForm((cur) => ({ ...cur, email: value }))} />
						<Input label="Password" type="password" value={userForm.password} required onChange={(value) => setUserForm((cur) => ({ ...cur, password: value }))} />
						<Select label="Rol" value={userForm.role} onChange={(value) => setUserForm((cur) => ({ ...cur, role: value }))}>
							<option value="AGENT">AGENT</option>
							<option value="ADMIN">ADMIN</option>
							{platformAdmin ? <option value="PLATFORM_ADMIN">PLATFORM_ADMIN</option> : null}
						</Select>
						<button type="submit" disabled={saving}>Crear usuario</button>
					</form>
				</section>

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
						<button type="submit" disabled={saving}>Guardar WhatsApp</button>
					</form>
				</section>

				<section className="tenant-admin-panel">
					<h3>Ecommerce</h3>
					<form className="tenant-admin-grid" onSubmit={handleSaveCommerce}>
						<Select label="Proveedor" value={commerceForm.provider} onChange={(value) => setCommerceForm((cur) => ({ ...cur, provider: value }))}>
							<option value="SHOPIFY">SHOPIFY</option>
							<option value="TIENDANUBE">TIENDANUBE</option>
						</Select>
						<Input label="Store ID / dominio" value={commerceForm.externalStoreId} required onChange={(value) => setCommerceForm((cur) => ({ ...cur, externalStoreId: value }))} />
						<Input label="Shop domain" value={commerceForm.shopDomain} onChange={(value) => setCommerceForm((cur) => ({ ...cur, shopDomain: value }))} />
						<Input label="Access token" type="password" value={commerceForm.accessToken} required={!commerceForm.id} onChange={(value) => setCommerceForm((cur) => ({ ...cur, accessToken: value }))} />
						<Input label="Store name" value={commerceForm.storeName} onChange={(value) => setCommerceForm((cur) => ({ ...cur, storeName: value }))} />
						<Input label="Store URL" value={commerceForm.storeUrl} onChange={(value) => setCommerceForm((cur) => ({ ...cur, storeUrl: value }))} />
						<Input label="API version" value={commerceForm.apiVersion} onChange={(value) => setCommerceForm((cur) => ({ ...cur, apiVersion: value }))} />
						<button type="submit" disabled={saving}>Guardar ecommerce</button>
					</form>
				</section>
			</div>
		</div>
	);
}
