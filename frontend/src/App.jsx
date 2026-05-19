import { Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import ProtectedRoute from './components/ProtectedRoute.jsx';
import BrandLoader from './components/ui/BrandLoader.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { getDefaultRouteForRole, isPlatformAdminUser } from './lib/authz.js';
import { internalRouteModules } from './lib/internalRouteModules.js';
import { lazyWithRetry } from './lib/lazyWithRetry.js';

const InboxPage = lazyWithRetry(internalRouteModules.inbox, 'InboxPage');
const CatalogPage = lazyWithRetry(internalRouteModules.catalog, 'CatalogPage');
const CampaignsPage = lazyWithRetry(internalRouteModules.campaigns, 'CampaignsPage');
const AbandonedCartsPage = lazyWithRetry(internalRouteModules.abandonedCarts, 'AbandonedCartsPage');
const CustomersPage = lazyWithRetry(internalRouteModules.customers, 'CustomersPage');
const WhatsAppMenuPage = lazyWithRetry(internalRouteModules.whatsappMenu, 'WhatsAppMenuPage');
const AdminPage = lazyWithRetry(internalRouteModules.admin, 'AdminPage');
const OperationsPage = lazyWithRetry(internalRouteModules.operations, 'OperationsPage');
const PrivateAppShell = lazyWithRetry(internalRouteModules.privateShell, 'PrivateAppShell');
const LoginPage = lazyWithRetry(internalRouteModules.login, 'LoginPage');

function RoleHomeRedirect() {
	const { user } = useAuth();
	return <Navigate to={getDefaultRouteForRole(user?.role)} replace />;
}

function PageLoader() {
	return (
		<div className="route-loader" role="status" aria-live="polite">
			<span className="route-loader__bar" aria-hidden="true" />
			<strong>Cargando sección</strong>
			<div className="route-loader__skeleton" aria-hidden="true">
				<span />
				<span />
				<span />
				<span />
			</div>
		</div>
	);
}

function PublicPage() {
	return (
		<Suspense fallback={<BrandLoader label="Cargando" />}>
			<LoginPage />
		</Suspense>
	);
}

function BrandAnalyticsRoute() {
	const { user } = useAuth();
	if (isPlatformAdminUser(user)) {
		return <Navigate to="/admin" replace />;
	}

	return <AdminPage defaultTab="analytics" />;
}

export default function App() {
	const { loading } = useAuth();
	const location = useLocation();
	const isPublicPath = ['/inicio', '/contacto', '/precios', '/login'].includes(location.pathname);

	if (loading && !isPublicPath) {
		return <BrandLoader label="Cargando" />;
	}

	return (
		<Routes>
			<Route path="/inicio" element={<PublicPage />} />
			<Route path="/contacto" element={<PublicPage />} />
			<Route path="/precios" element={<PublicPage />} />
			<Route path="/login" element={<PublicPage />} />

			<Route
				path="/"
				element={
					<ProtectedRoute>
						<Suspense fallback={<BrandLoader label="Cargando panel" />}>
							<PrivateAppShell />
						</Suspense>
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
					element={<Navigate to="/operations" replace />}
				/>
			</Route>
		</Routes>
	);
}
