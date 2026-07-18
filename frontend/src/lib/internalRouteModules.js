export const internalRouteModules = {
	privateShell: () => import('../layout/PrivateAppShell.jsx'),
	operations: () => import('../pages/OperationsPage.jsx'),
	inbox: () => import('../pages/InboxPage.jsx'),
	admin: () => import('../pages/AdminPage.jsx'),
	analytics: () => import('../pages/AnalyticsPage.jsx'),
	catalog: () => import('../pages/CatalogPage.jsx'),
	campaigns: () => import('../pages/CampaignsPage.jsx'),
	abandonedCarts: () => import('../pages/AbandonedCartsPage.jsx'),
	customers: () => import('../pages/CustomersPage.jsx'),
	whatsappMenu: () => import('../pages/WhatsAppMenuPage.jsx'),
	aiLab: () => import('../pages/AiLabPage.jsx'),
	login: () => import('../pages/LoginPage.jsx'),
};

export function getInternalRouteKey(pathname = '') {
	const path = String(pathname || '').trim().toLowerCase();

	if (path.startsWith('/operations')) return 'operations';
	if (path.startsWith('/inbox')) return 'inbox';
	if (path.startsWith('/admin')) return 'admin';
	if (path.startsWith('/analytics')) return 'analytics';
	if (path.startsWith('/catalog')) return 'catalog';
	if (path.startsWith('/campaigns')) return 'campaigns';
	if (path.startsWith('/abandoned-carts')) return 'abandonedCarts';
	if (path.startsWith('/customers')) return 'customers';
	if (path.startsWith('/whatsapp-menu')) return 'whatsappMenu';
	if (path.startsWith('/ai-lab')) return 'aiLab';
	if (['/inicio', '/contacto', '/precios', '/login'].includes(path)) return 'login';

	return '';
}

export function prefetchInternalRoute(pathname = '') {
	const routeKey = getInternalRouteKey(pathname);
	const loader = internalRouteModules[routeKey];

	if (!loader) return Promise.resolve(null);

	return loader().catch((error) => {
		console.error('[APP][ROUTE_PREFETCH_FAILED]', {
			pathname,
			routeKey,
			error,
		});
		return null;
	});
}
