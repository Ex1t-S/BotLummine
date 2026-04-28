import { Routes, Route, Navigate } from 'react-router-dom';

import DashboardLayout from './layout/DashboardLayout.jsx';

import LoginPage from './pages/LoginPage.jsx';
import InboxPage from './pages/InboxPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import CampaignsPage from './pages/CampaignsPage.jsx';
import AbandonedCartsPage from './pages/AbandonedCartsPage.jsx';
import CustomersPage from './pages/CustomersPage.jsx';
import AiLabPage from './pages/AiLabPage.jsx';
import WhatsAppMenuPage from './pages/WhatsAppMenuPage.jsx';
import AdminPage from './pages/AdminPage.jsx';

import ProtectedRoute from './components/ProtectedRoute.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { getDefaultRouteForRole } from './lib/authz.js';

function RoleHomeRedirect() {
	const { user } = useAuth();
	return <Navigate to={getDefaultRouteForRole(user?.role)} replace />;
}

export default function App() {
	return (
		<Routes>
			<Route path="/login" element={<LoginPage />} />

			<Route
				path="/"
				element={
					<ProtectedRoute>
						<DashboardLayout />
					</ProtectedRoute>
				}
			>
				<Route index element={<RoleHomeRedirect />} />
				<Route
					path="inbox"
					element={
						<ProtectedRoute allowedRoles={['ADMIN', 'AGENT']}>
							<InboxPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path="admin"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<AdminPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path="catalog"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<CatalogPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path="campaigns/*"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<CampaignsPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path="abandoned-carts"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<AbandonedCartsPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path="customers"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<CustomersPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path="whatsapp-menu"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<WhatsAppMenuPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path="ai-lab"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<AiLabPage />
						</ProtectedRoute>
					}
				/>
			</Route>
		</Routes>
	);
}
