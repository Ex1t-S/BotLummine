import { useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './DashboardLayout.css';
import logoLummine from '../assets/lummine-logo.png';
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
		match: (pathname) => pathname.startsWith('/ai-lab'),
		title: 'AI Lab',
		description: 'Pruebas de respuesta, tono y recomendaciones.',
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

export default function DashboardLayout() {
	const navigate = useNavigate();
	const location = useLocation();
	const { user, logout } = useAuth();
	const contentRef = useRef(null);
	const lastScrollTopRef = useRef(0);
	const [topbarHidden, setTopbarHidden] = useState(false);
	const isAdmin = isAdminUser(user);
	const isPlatformAdmin = isPlatformAdminUser(user);
	const workspace = user?.workspace || null;
	const brandName = isPlatformAdmin
		? 'Admin plataforma'
		: (workspace?.aiConfig?.businessName || workspace?.name || 'Marca');
	const logoUrl = workspace?.branding?.logoUrl || logoLummine;
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

	return (
		<div className="admin-shell">
			<aside className="admin-sidebar">
				<div className="admin-brand">
					<div className="admin-brand-mark admin-brand-mark--logo">
						<img src={logoUrl} alt={brandName} className="admin-brand-logo" />
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
						<NavLink to="/operations" className={navClass}>
							Operación
						</NavLink>

						{!isPlatformAdmin ? (
							<NavLink
								to="/inbox/automatico"
								className={navClassWithPrefix(location, '/inbox')}
							>
								Inbox
							</NavLink>
						) : null}
					</NavGroup>

					{isAdmin && !isPlatformAdmin ? (
						<>
							<NavGroup label="Ventas">
								<NavLink to="/catalog" className={navClass}>
									Catálogo
								</NavLink>
								<NavLink to="/abandoned-carts" className={navClass}>
									Carritos
								</NavLink>
								<NavLink to="/customers" className={navClass}>
									Clientes
								</NavLink>
							</NavGroup>

							<NavGroup label="Marketing">
								<NavLink to="/campaigns" className={navClassWithPrefix(location, '/campaigns')}>
									Campañas
								</NavLink>
								<NavLink to="/analytics" className={navClass}>
									Estadísticas
								</NavLink>
								<NavLink to="/ai-lab" className={navClass}>
									AI Lab
								</NavLink>
							</NavGroup>
						</>
					) : null}

					{isAdmin ? (
						<NavGroup label="Configuración">
							<NavLink to="/admin" className={navClass}>
								{isPlatformAdmin ? 'Admin plataforma' : 'Configuración'}
							</NavLink>

							{!isPlatformAdmin ? (
								<NavLink to="/whatsapp-menu" className={navClass}>
									Menú
								</NavLink>
							) : null}
						</NavGroup>
					) : null}
				</nav>

				<button className="logout-btn" onClick={handleLogout} type="button">
					Salir
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
					<div className="admin-topbar-user" aria-label="Usuario actual">
						<strong>{user?.name || user?.email || 'Usuario'}</strong>
						<span>{isPlatformAdmin ? 'SUPERADMIN' : (isAdmin ? 'ADMIN' : 'AGENTE')}</span>
					</div>
				</header>

				<main className="admin-content" ref={contentRef} onScroll={handleContentScroll}>
					<Outlet />
				</main>
			</div>
		</div>
	);
}
