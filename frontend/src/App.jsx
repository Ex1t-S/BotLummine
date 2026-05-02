import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import DashboardLayout from './layout/DashboardLayout.jsx';

import LoginPage from './pages/LoginPage.jsx';

import ProtectedRoute from './components/ProtectedRoute.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { getDefaultRouteForRole, isPlatformAdminUser } from './lib/authz.js';

const InboxPage = lazy(() => import('./pages/InboxPage.jsx'));
const CatalogPage = lazy(() => import('./pages/CatalogPage.jsx'));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage.jsx'));
const AbandonedCartsPage = lazy(() => import('./pages/AbandonedCartsPage.jsx'));
const CustomersPage = lazy(() => import('./pages/CustomersPage.jsx'));
const AiLabPage = lazy(() => import('./pages/AiLabPage.jsx'));
const WhatsAppMenuPage = lazy(() => import('./pages/WhatsAppMenuPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const OperationsPage = lazy(() => import('./pages/OperationsPage.jsx'));

function RoleHomeRedirect() {
	const { user } = useAuth();
	return <Navigate to={getDefaultRouteForRole(user?.role)} replace />;
}

function PageLoader() {
	return <div className="page-card">Cargando modulo...</div>;
}

function BrandAnalyticsRoute() {
	const { user } = useAuth();
	if (isPlatformAdminUser(user)) {
		return <Navigate to="/admin" replace />;
	}

	return <AdminPage defaultTab="analytics" />;
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
					path="operations"
					element={
						<ProtectedRoute allowedRoles={['ADMIN', 'AGENT']}>
							<Suspense fallback={<PageLoader />}>
								<OperationsPage />
							</Suspense>
						</ProtectedRoute>
					}
				/>
				<Route
					path="inbox/:queueSlug?"
					element={
						<ProtectedRoute allowedRoles={['ADMIN', 'AGENT']}>
							<Suspense fallback={<PageLoader />}>
								<InboxPage />
							</Suspense>
						</ProtectedRoute>
					}
				/>
				<Route
					path="admin"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<Suspense fallback={<PageLoader />}>
								<AdminPage />
							</Suspense>
						</ProtectedRoute>
					}
				/>
				<Route
					path="catalog"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<Suspense fallback={<PageLoader />}>
								<CatalogPage />
							</Suspense>
						</ProtectedRoute>
					}
				/>
				<Route
					path="analytics"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<Suspense fallback={<PageLoader />}>
								<BrandAnalyticsRoute />
							</Suspense>
						</ProtectedRoute>
					}
				/>
				<Route
					path="campaigns/*"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<Suspense fallback={<PageLoader />}>
								<CampaignsPage />
							</Suspense>
						</ProtectedRoute>
					}
				/>
				<Route
					path="abandoned-carts"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<Suspense fallback={<PageLoader />}>
								<AbandonedCartsPage />
							</Suspense>
						</ProtectedRoute>
					}
				/>
				<Route
					path="customers"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<Suspense fallback={<PageLoader />}>
								<CustomersPage />
							</Suspense>
						</ProtectedRoute>
					}
				/>
				<Route
					path="whatsapp-menu"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<Suspense fallback={<PageLoader />}>
								<WhatsAppMenuPage />
							</Suspense>
						</ProtectedRoute>
					}
				/>
				<Route
					path="ai-lab"
					element={
						<ProtectedRoute allowedRoles={['ADMIN']}>
							<Suspense fallback={<PageLoader />}>
								<AiLabPage />
							</Suspense>
						</ProtectedRoute>
					}
				/>
			</Route>
		</Routes>
	);
}
