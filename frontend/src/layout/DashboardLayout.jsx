import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './DashboardLayout.css';
import logoLummine from '../assets/lummine-logo.png';
import { isAdminUser } from '../lib/authz.js';

function navClass({ isActive }) {
	return `admin-menu-link${isActive ? ' active' : ''}`;
}

export default function DashboardLayout() {
	const navigate = useNavigate();
	const { user, logout } = useAuth();
	const isAdmin = isAdminUser(user);

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
					<div className="admin-brand-mark admin-brand-mark--logo">
						<img
							src={logoLummine}
							alt="Lummine"
							className="admin-brand-logo"
						/>
					</div>

					<div className="admin-brand-copy">
						<h1>Lummine</h1>
						<p>{isAdmin ? 'Ventas conversacionales' : 'Inbox de atención'}</p>
					</div>
				</div>

				<div className="admin-user-box">
					<strong>{user?.name || user?.email || 'Usuario'}</strong>
					<span>{isAdmin ? 'ADMIN' : 'AGENTE'}</span>
				</div>

				<nav className="admin-menu">
					<NavLink to="/inbox" className={navClass}>
						Inbox
					</NavLink>

					{isAdmin ? (
						<>
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
						</>
					) : null}
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
