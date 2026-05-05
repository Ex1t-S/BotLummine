import { useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
	BarChart3,
	Boxes,
	Building2,
	ChevronRight,
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
import { resolveApiUrl } from '../lib/api.js';
import './DashboardLayout.css';
import logoBladeIA from '../assets/bladeia-logo.svg';
import { isAdminUser, isPlatformAdminUser } from '../lib/authz.js';

const PAGE_META = [
	{
		match: (pathname) => pathname.startsWith('/inbox'),
		title: 'Inbox',
		description: 'Conversaciones, comprobantes y atención de clientes.',
	},
	{
		match: (pathname) => pathname.startsWith('/campaigns'),
		title: 'Campañas',
		description: 'Templates, audiencias, envíos y resultados.',
	},
	{
		match: (pathname) => pathname.startsWith('/abandoned-carts'),
		title: 'Carritos',
		description: 'Oportunidades de recuperación y seguimiento.',
	},
	{
		match: (pathname) => pathname.startsWith('/customers'),
		title: 'Clientes',
		description: 'Base de clientes, compras y datos de contacto.',
	},
	{
		match: (pathname) => pathname.startsWith('/catalog'),
		title: 'Catálogo',
		description: 'Productos, stock y sincronización comercial.',
	},
	{
		match: (pathname) => pathname.startsWith('/analytics'),
		title: 'Estadísticas',
		description: 'Indicadores de ventas y actividad de la marca.',
	},
	{
		match: (pathname) => pathname.startsWith('/whatsapp-menu'),
		title: 'Menú de WhatsApp',
		description: 'Opciones guiadas y respuestas iniciales.',
	},
	{
		match: (pathname) => pathname.startsWith('/admin'),
		title: 'Configuración',
		description: 'Marca, usuarios, canales y ajustes operativos.',
	},
	{
		match: (pathname) => pathname.startsWith('/operations'),
		title: 'Operación',
		description: 'Prioridades abiertas y salud diaria del negocio.',
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

function NavItem({ to, icon: Icon, children, className }) {
	return (
		<NavLink to={to} className={className || navClass}>
			<Icon size={17} strokeWidth={2.2} aria-hidden="true" />
			<span>{children}</span>
			<ChevronRight className="admin-menu-link-chevron" size={15} strokeWidth={2.2} aria-hidden="true" />
		</NavLink>
	);
}

export default function DashboardLayout() {
	const navigate = useNavigate();
	const location = useLocation();
	const { resolvedTheme, setTheme } = useTheme();
	const { user, logout } = useAuth();
	const contentRef = useRef(null);
	const lastScrollTopRef = useRef(0);
	const [topbarHidden, setTopbarHidden] = useState(false);
	const [logoFailed, setLogoFailed] = useState(false);
	const darkMode = resolvedTheme === 'dark';
	const isAdmin = isAdminUser(user);
	const isPlatformAdmin = isPlatformAdminUser(user);
	const workspace = user?.workspace || null;
	const brandName = isPlatformAdmin
		? 'Admin plataforma'
		: (workspace?.aiConfig?.businessName || workspace?.name || 'Marca');
	const logoUrl = resolveApiUrl(workspace?.branding?.logoUrl || '') || logoBladeIA;
	const basePageMeta = getPageMeta(location.pathname);
	const pageMeta = isPlatformAdmin && location.pathname.startsWith('/admin')
		? {
			title: 'Admin plataforma',
			description: 'Marcas, usuarios, canales y salud operativa.',
		}
		: basePageMeta;

	useEffect(() => {
		lastScrollTopRef.current = 0;
		setTopbarHidden(false);
		if (contentRef.current) {
			contentRef.current.scrollTop = 0;
		}
	}, [location.pathname]);

	useEffect(() => {
		setLogoFailed(false);
	}, [logoUrl]);

	function updateTopbarForScroll(scrollTop) {
		const previousScrollTop = lastScrollTopRef.current;
		const delta = scrollTop - previousScrollTop;

		if (scrollTop <= 8) {
			setTopbarHidden(false);
		} else if (delta > 10) {
			setTopbarHidden(true);
		} else if (delta < -10) {
			setTopbarHidden(false);
		}

		lastScrollTopRef.current = Math.max(0, scrollTop);
	}

	function handleContentScroll(event) {
		updateTopbarForScroll(event.currentTarget.scrollTop || 0);
	}

	function handleMainWheel(event) {
		if (event.deltaY > 10) {
			setTopbarHidden(true);
		} else if (event.deltaY < -10) {
			setTopbarHidden(false);
		}
	}

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

	return (
		<div className="admin-shell">
			<aside className="admin-sidebar">
				<div className="admin-brand">
					<div className="admin-brand-mark admin-brand-mark--logo">
						<img
							src={logoFailed ? logoBladeIA : logoUrl}
							alt={brandName}
							className="admin-brand-logo"
							onError={() => setLogoFailed(true)}
						/>
					</div>

					<div className="admin-brand-copy">
						<h1>{brandName}</h1>
						<p>{isPlatformAdmin ? 'Gestión multi marca' : (isAdmin ? 'Atención conversacional' : 'Inbox de atención')}</p>
					</div>
				</div>

				<div className="admin-user-box">
					<strong>{user?.name || user?.email || 'Usuario'}</strong>
					<span>{isPlatformAdmin ? 'SUPERADMIN' : (isAdmin ? 'ADMIN' : 'AGENTE')}</span>
				</div>

				<nav className="admin-menu" aria-label="Navegación principal">
					<NavGroup label="Operación">
						<NavItem to="/operations" icon={LayoutDashboard}>Operación</NavItem>

						{!isPlatformAdmin ? (
							<NavItem
								to="/inbox/automatico"
								icon={Inbox}
								className={navClassWithPrefix(location, '/inbox')}
							>
								Inbox
							</NavItem>
						) : null}
					</NavGroup>

					{isAdmin && !isPlatformAdmin ? (
						<>
							<NavGroup label="Ventas">
								<NavItem to="/catalog" icon={Boxes}>Catálogo</NavItem>
								<NavItem to="/abandoned-carts" icon={ShoppingCart}>Carritos</NavItem>
								<NavItem to="/customers" icon={Users}>Clientes</NavItem>
							</NavGroup>

							<NavGroup label="Marketing">
								<NavItem to="/campaigns" icon={ShoppingBag} className={navClassWithPrefix(location, '/campaigns')}>Campañas</NavItem>
								<NavItem to="/analytics" icon={BarChart3}>Estadísticas</NavItem>
							</NavGroup>
						</>
					) : null}

					{isAdmin ? (
						<NavGroup label="Configuración">
							<NavItem to="/admin" icon={isPlatformAdmin ? Building2 : Settings}>
								{isPlatformAdmin ? 'Admin plataforma' : 'Configuración'}
							</NavItem>

							{!isPlatformAdmin ? (
								<NavItem to="/whatsapp-menu" icon={MessageSquareText}>Menú</NavItem>
							) : null}
						</NavGroup>
					) : null}
				</nav>

				<button className="logout-btn" onClick={handleLogout} type="button">
					<LogOut size={16} strokeWidth={2.2} aria-hidden="true" />
					<span>Salir</span>
				</button>
			</aside>

			<div
				className={`admin-main${topbarHidden ? ' topbar-hidden' : ''}`}
				onWheelCapture={handleMainWheel}
			>
				<header className="admin-topbar">
					<div>
						<span>{isPlatformAdmin ? 'Plataforma' : brandName}</span>
						<h2>{pageMeta.title}</h2>
						<p>{pageMeta.description}</p>
					</div>
					<div className="admin-topbar-actions">
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
							<strong>{user?.name || user?.email || 'Usuario'}</strong>
							<span>{isPlatformAdmin ? 'SUPERADMIN' : (isAdmin ? 'ADMIN' : 'AGENTE')}</span>
						</div>
					</div>
				</header>

				<main className="admin-content" ref={contentRef} onScroll={handleContentScroll}>
					<Outlet />
				</main>
			</div>
		</div>
	);
}
