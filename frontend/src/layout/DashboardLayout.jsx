import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import {
	BarChart3,
	Boxes,
	Building2,
	ChevronRight,
	FlaskConical,
	Inbox,
	LayoutDashboard,
	LogOut,
	MessageSquareText,
	Moon,
	Settings,
	ShoppingBag,
	ShoppingCart,
	Sun,
	Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import api, { resolveApiUrl } from '../lib/api.js';
import './DashboardLayout.css';
import { canUseAiLab, isAdminUser, isAiLabOnlyWorkspace, isPlatformAdminUser } from '../lib/authz.js';
import {
	getFrequentInternalPaths,
	prefetchInternalRouteAndData,
	scheduleIdleInternalPrefetch,
} from '../lib/internalRoutePrefetch.js';

const PAGE_META = [
	{
		match: (pathname) => pathname.startsWith('/inbox'),
		title: 'Bandeja',
	},
	{
		match: (pathname) => pathname.startsWith('/campaigns'),
		title: 'Campañas',
	},
	{
		match: (pathname) => pathname.startsWith('/abandoned-carts'),
		title: 'Carritos',
	},
	{
		match: (pathname) => pathname.startsWith('/customers'),
		title: 'Clientes',
	},
	{
		match: (pathname) => pathname.startsWith('/catalog'),
		title: 'Catálogo',
	},
	{
		match: (pathname) => pathname.startsWith('/analytics'),
		title: 'Estadísticas',
	},
	{
		match: (pathname) => pathname.startsWith('/whatsapp-menu'),
		title: 'Menú de WhatsApp',
	},
	{
		match: (pathname) => pathname.startsWith('/ai-lab'),
		title: 'Laboratorio de IA',
	},
	{
		match: (pathname) => pathname.startsWith('/admin'),
		title: 'Configuración',
	},
	{
		match: (pathname) => pathname.startsWith('/operations'),
		title: 'Operación',
	},
];

function getPageMeta(pathname = '') {
	return PAGE_META.find((item) => item.match(pathname)) || PAGE_META[PAGE_META.length - 1];
}

function navClass({ isActive }) {
	return `admin-menu-link${isActive ? ' active' : ''}`;
}

function navClassWithPrefix(location, prefix) {
	return ({ isActive }) => navClass({ isActive: isActive || location.pathname.startsWith(prefix) });
}

function NavGroup({ label, children }) {
	return (
		<div className="admin-menu-group">
			<span className="admin-menu-group-label">{label}</span>
			<div className="admin-menu-group-links">{children}</div>
		</div>
	);
}

function NavItem({ to, icon: Icon, children, className, onPrepare }) {
	function handlePrepare() {
		onPrepare?.(to);
	}

	return (
		<NavLink
			to={to}
			className={className || navClass}
			onFocus={handlePrepare}
			onMouseEnter={handlePrepare}
			onTouchStart={handlePrepare}
		>
			<Icon size={17} strokeWidth={2.2} aria-hidden="true" />
			<span>{children}</span>
			<ChevronRight className="admin-menu-link-chevron" size={15} strokeWidth={2.2} aria-hidden="true" />
		</NavLink>
	);
}

export default function DashboardLayout() {
	const navigate = useNavigate();
	const location = useLocation();
	const queryClient = useQueryClient();
	const { resolvedTheme, setTheme } = useTheme();
	const { user, logout } = useAuth();
	const contentRef = useRef(null);
	const [resettingDemo, setResettingDemo] = useState(false);
	const demoMode = import.meta.env.MODE === 'demo';
	const darkMode = resolvedTheme === 'dark';
	const isAdmin = isAdminUser(user);
	const isPlatformAdmin = isPlatformAdminUser(user);
	const aiLabOnlyWorkspace = isAiLabOnlyWorkspace(user);
	const showAiLab = canUseAiLab(user);
	const workspace = user?.workspace || null;
	const brandName = isPlatformAdmin
		? 'Admin plataforma'
		: (workspace?.aiConfig?.businessName || workspace?.name || 'Marca');
	const storeLogoUrl = !isPlatformAdmin ? resolveApiUrl(workspace?.branding?.logoUrl || '') : '';
	const [brandLogoFailed, setBrandLogoFailed] = useState(false);
	const visibleStoreLogoUrl = storeLogoUrl && !brandLogoFailed ? storeLogoUrl : '';
	const brandInitial = brandName.trim().charAt(0).toUpperCase() || 'M';
	const userDisplayName = user?.name || user?.email || 'Usuario';
	const roleLabel = isPlatformAdmin ? 'Superadministrador' : (isAdmin ? 'Administrador' : 'Agente');
	const userInitials = userDisplayName
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part.charAt(0).toUpperCase())
		.join('') || 'U';
	const basePageMeta = getPageMeta(location.pathname);
	const pageMeta = isPlatformAdmin && location.pathname.startsWith('/admin')
		? {
			title: 'Admin plataforma',
		}
		: basePageMeta;

	const preparePath = useCallback((path) => {
		prefetchInternalRouteAndData(path, queryClient, { user });
	}, [queryClient, user]);

	useEffect(() => {
		if (aiLabOnlyWorkspace && location.pathname !== '/ai-lab') {
			navigate('/ai-lab', { replace: true });
		}
	}, [aiLabOnlyWorkspace, location.pathname, navigate]);

	useEffect(() => {
		if (contentRef.current) {
			contentRef.current.scrollTop = 0;
		}
	}, [location.pathname]);

	useEffect(() => {
		const paths = getFrequentInternalPaths(user);
		return scheduleIdleInternalPrefetch(paths, {
			user,
			currentPath: location.pathname,
		});
	}, [location.pathname, user]);

	async function handleLogout() {
		try {
			await logout();
			navigate('/inicio', { replace: true });
		} catch (error) {
			console.error(error);
		}
	}

	function handleThemeToggle() {
		setTheme(darkMode ? 'light' : 'dark');
	}

	async function handleDemoReset() {
		if (!demoMode || resettingDemo) return;
		setResettingDemo(true);
		try {
			await api.post('/demo/reset');
			queryClient.clear();
			window.location.assign('/operations');
		} finally {
			setResettingDemo(false);
		}
	}

	return (
		<div className="admin-shell">
			<aside className="admin-sidebar">
				<div className="admin-brand">
					<div className="admin-brand-mark admin-brand-mark--logo">
						{visibleStoreLogoUrl ? <img src={visibleStoreLogoUrl} alt={`${brandName} logo`} className="admin-brand-logo" onError={() => setBrandLogoFailed(true)} /> : <span className="admin-brand-fallback" aria-hidden="true">{brandInitial}</span>}
					</div>

					<div className="admin-brand-copy">
						<h1>{isPlatformAdmin ? 'BladeIA' : brandName}</h1>
					</div>
					{demoMode ? <span className="admin-demo-mobile">Demo</span> : null}
				</div>

				<div className="admin-workspace-box">
					<span>Espacio activo</span>
					<strong>{brandName}</strong>
				</div>

				<nav className="admin-menu" aria-label="Navegación principal">
					{aiLabOnlyWorkspace ? (
						<NavGroup label="Pruebas">
							<NavItem to="/ai-lab" icon={FlaskConical} onPrepare={preparePath}>Laboratorio IA</NavItem>
						</NavGroup>
					) : (
						<>
							<NavGroup label="Operación">
								<NavItem to="/operations" icon={LayoutDashboard} onPrepare={preparePath}>Operación</NavItem>

								{!isPlatformAdmin ? (
									<NavItem
										to="/inbox/automatico"
										icon={Inbox}
										className={navClassWithPrefix(location, '/inbox')}
										onPrepare={preparePath}
									>
										Bandeja
									</NavItem>
								) : null}
							</NavGroup>

							{isAdmin && !isPlatformAdmin ? (
								<>
									<NavGroup label="Ventas">
										<NavItem to="/catalog" icon={Boxes} onPrepare={preparePath}>Catálogo</NavItem>
										<NavItem to="/abandoned-carts" icon={ShoppingCart} onPrepare={preparePath}>Carritos</NavItem>
										<NavItem to="/customers" icon={Users} onPrepare={preparePath}>Clientes</NavItem>
									</NavGroup>

									<NavGroup label="Comercial">
										<NavItem to="/campaigns" icon={ShoppingBag} className={navClassWithPrefix(location, '/campaigns')} onPrepare={preparePath}>Campañas</NavItem>
										<NavItem to="/analytics" icon={BarChart3} onPrepare={preparePath}>Estadísticas</NavItem>
									</NavGroup>
								</>
							) : null}

							{isAdmin ? (
								<NavGroup label="Configuración">
									<NavItem to="/admin" icon={isPlatformAdmin ? Building2 : Settings} onPrepare={preparePath}>
										{isPlatformAdmin ? 'Admin plataforma' : 'Configuración'}
									</NavItem>

									{!isPlatformAdmin ? (
										<>
											<NavItem to="/whatsapp-menu" icon={MessageSquareText} onPrepare={preparePath}>Menú</NavItem>
										</>
									) : null}

									{showAiLab ? (
										<NavItem to="/ai-lab" icon={FlaskConical} onPrepare={preparePath}>Laboratorio IA</NavItem>
									) : null}
								</NavGroup>
							) : null}
						</>
					)}
				</nav>

				<div className="admin-sidebar-footer">
					<div className="admin-sidebar-user">
						<span className="admin-sidebar-avatar" aria-hidden="true">{userInitials}</span>
						<span><strong>{userDisplayName}</strong><small>{roleLabel}</small></span>
					</div>
					<button className="logout-btn" onClick={handleLogout} type="button" aria-label="Cerrar sesión" title="Cerrar sesión">
						<LogOut size={16} strokeWidth={2.2} aria-hidden="true" />
						<span>Salir</span>
					</button>
				</div>
			</aside>

			<div className="admin-main">
				<header className="admin-topbar">
					<div>
						<h2>{pageMeta.title}</h2>
					</div>
					<div className="admin-topbar-actions">
						{demoMode ? (
							<div className="admin-demo-mode" role="status" aria-label="Modo demo local activo">
								<span><strong>DEMO LOCAL</strong> · sin envíos externos</span>
								<button type="button" onClick={handleDemoReset} disabled={resettingDemo}>
									{resettingDemo ? 'Restaurando…' : 'Restaurar datos'}
								</button>
							</div>
						) : null}
						<button
							type="button"
							className="admin-theme-toggle"
							onClick={handleThemeToggle}
							aria-label={darkMode ? 'Activar modo claro' : 'Activar modo oscuro'}
							title={darkMode ? 'Modo claro' : 'Modo oscuro'}
						>
							{darkMode ? (
								<Sun size={16} strokeWidth={2.2} aria-hidden="true" />
							) : (
								<Moon size={16} strokeWidth={2.2} aria-hidden="true" />
							)}
						</button>
						<div className="admin-topbar-user" aria-label="Usuario actual">
							<strong>{userDisplayName}</strong>
							<span>{roleLabel}</span>
						</div>
					</div>
				</header>

				<main className="admin-content" ref={contentRef}>
					<Outlet />
				</main>
			</div>
		</div>
	);
}
