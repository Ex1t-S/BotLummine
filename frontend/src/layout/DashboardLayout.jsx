import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

function navClass({ isActive }) {
	return `admin-menu-link${isActive ? ' active' : ''}`;
}

export default function DashboardLayout() {
	const navigate = useNavigate();
	const { user, logout } = useAuth();

	async function handleLogout() {
		try {
			await logout();
			navigate('/login', { replace: true });
		} catch (error) {
			console.error(error);
		}
	}

	return (
		<div className="admin-shell">
			<aside className="admin-sidebar">
				<div className="admin-brand">
					<div className="admin-brand-mark">L</div>

					<div className="admin-brand-copy">
						<h1>Lummine</h1>
						<p>Ventas conversacionales</p>
					</div>
				</div>

				<div className="admin-user-box">
					<strong>{user?.name || user?.email || 'Usuario'}</strong>
					<span>{user?.role || 'admin'}</span>
				</div>

				<nav className="admin-menu">
					<NavLink to="/inbox" className={navClass}>
						Inbox
					</NavLink>

					<NavLink to="/catalog" className={navClass}>
						Catálogo
					</NavLink>

					<NavLink to="/campaigns" className={navClass}>
						Campañas
					</NavLink>

					<NavLink to="/abandoned-carts" className={navClass}>
						Carritos
					</NavLink>

					<NavLink to="/customers" className={navClass}>
						Clientes
					</NavLink>

					<NavLink to="/whatsapp-menu" className={navClass}>
						Editar menú
					</NavLink>

					<NavLink to="/ai-lab" className={navClass}>
						AI Lab
					</NavLink>
				</nav>

				<button className="logout-btn" onClick={handleLogout} type="button">
					Salir
				</button>
			</aside>

			<main className="admin-content">
				<Outlet />
			</main>
		</div>
	);
}