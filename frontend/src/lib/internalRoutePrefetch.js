import api from './api.js';
import {
	fetchAbandonedCartAutomationSettings,
	fetchCampaignSchedules,
	fetchCampaigns,
	fetchPendingPaymentAutomationSettings,
	fetchShipmentNotificationCandidates,
	fetchShipmentNotificationSettings,
	fetchTemplates,
} from './campaigns.js';
import { normalizeCustomerFilterParams } from './customerFilters.js';
import { prefetchInternalRoute } from './internalRouteModules.js';
import { queryKeys, queryPresets } from './queryClient.js';
import { isAdminUser, isPlatformAdminUser } from './authz.js';

const INBOX_PAGE_SIZE = 30;
const CUSTOMER_PAGE_SIZE = 24;

const DEFAULT_CUSTOMER_FILTERS = {
	q: '',
	productQuery: '',
	orderNumber: '',
	dateFrom: '',
	dateTo: '',
	paymentStatus: '',
	shippingStatus: '',
	minSpent: '',
	hasPhoneOnly: false,
	sort: 'purchase_desc',
	page: 1,
	pageSize: CUSTOMER_PAGE_SIZE,
};

const DEFAULT_SHIPMENT_DAYS_BACK = 14;

function prefetchQuery(queryClient, options) {
	if (!queryClient || !options?.queryKey || !options?.queryFn) return;
	queryClient.prefetchQuery(options).catch(() => undefined);
}

function prefetchInfiniteQuery(queryClient, options) {
	if (!queryClient || !options?.queryKey || !options?.queryFn) return;
	if (typeof queryClient.prefetchInfiniteQuery !== 'function') return;
	queryClient.prefetchInfiniteQuery(options).catch(() => undefined);
}

function readPath(pathname = '') {
	try {
		return new URL(String(pathname || '/'), 'http://local').pathname;
	} catch {
		return String(pathname || '/');
	}
}

function readSearch(pathname = '') {
	try {
		return new URL(String(pathname || '/'), 'http://local').searchParams;
	} catch {
		return new URLSearchParams();
	}
}

function resolveInboxQueue(pathname = '') {
	const path = readPath(pathname);
	const slug = path.split('/').filter(Boolean)[1] || 'automatico';
	const bySlug = {
		todos: 'ALL',
		automatico: 'AUTO',
		'atencion-humana': 'HUMAN',
		comprobantes: 'PAYMENT_REVIEW',
	};
	return bySlug[slug] || 'AUTO';
}

function resolveReadFilter(pathname = '') {
	const read = String(readSearch(pathname).get('read') || '').trim().toUpperCase();
	return ['ALL', 'UNREAD', 'READ'].includes(read) ? read : 'ALL';
}

function buildDefaultShipmentRange() {
	const to = new Date();
	const from = new Date();
	from.setDate(to.getDate() - (DEFAULT_SHIPMENT_DAYS_BACK - 1));
	return {
		dateFrom: from.toISOString().slice(0, 10),
		dateTo: to.toISOString().slice(0, 10),
	};
}

function prefetchOperationsData(queryClient) {
	prefetchQuery(queryClient, {
		queryKey: queryKeys.operationsSummary,
		queryFn: async () => {
			const res = await api.get('/dashboard/operations/summary');
			return res.data;
		},
		...queryPresets.inbox,
	});
}

function prefetchInboxData(pathname, queryClient) {
	const queue = resolveInboxQueue(pathname);
	const readFilter = resolveReadFilter(pathname);

	prefetchInfiniteQuery(queryClient, {
		queryKey: queryKeys.inbox(queue, '', readFilter),
		queryFn: async ({ pageParam = 0 }) => {
			const res = await api.get('/dashboard/inbox', {
				params: {
					queue,
					limit: INBOX_PAGE_SIZE,
					offset: pageParam,
					read: readFilter,
				},
			});
			return res.data;
		},
		initialPageParam: 0,
		getNextPageParam: (lastPage) => lastPage?.nextOffset ?? undefined,
		...queryPresets.inbox,
	});
}

function prefetchCatalogData(queryClient) {
	const params = { q: '', page: 1 };
	prefetchQuery(queryClient, {
		queryKey: queryKeys.catalog(params),
		queryFn: async () => {
			const res = await api.get('/dashboard/catalog', { params });
			return {
				items: res.data.items || [],
				total: res.data.total || 0,
				page: res.data.page || 1,
				totalPages: res.data.totalPages || 1,
			};
		},
		...queryPresets.catalog,
	});
}

function prefetchCustomersData(queryClient) {
	const requestFilters = normalizeCustomerFilterParams(DEFAULT_CUSTOMER_FILTERS, {
		pageSize: CUSTOMER_PAGE_SIZE,
	});

	prefetchQuery(queryClient, {
		queryKey: queryKeys.customers(requestFilters),
		queryFn: async () => {
			const response = await api.get('/dashboard/customers', {
				params: requestFilters,
			});
			return {
				customers: Array.isArray(response.data?.customers) ? response.data.customers : [],
				stats: response.data?.stats || {},
				pagination: {
					page: Number(response.data?.pagination?.page || 1),
					totalPages: Number(response.data?.pagination?.totalPages || 1),
					totalItems: Number(response.data?.pagination?.totalItems || 0),
					pageSize: Number(response.data?.pagination?.pageSize || CUSTOMER_PAGE_SIZE),
				},
			};
		},
		...queryPresets.customers,
	});
}

function prefetchAbandonedCartsData(queryClient) {
	const filters = {
		q: '',
		status: 'ALL',
		dateFrom: '',
		dateTo: '',
		syncWindow: 30,
		page: 1,
	};

	prefetchQuery(queryClient, {
		queryKey: queryKeys.abandonedCarts(filters),
		queryFn: async () => {
			const response = await api.get('/dashboard/abandoned-carts', { params: filters });
			return response.data;
		},
		...queryPresets.abandonedCarts,
	});
}

function prefetchCampaignData(pathname, queryClient) {
	const path = readPath(pathname);
	const activePath = path.split('/').filter(Boolean)[1] || 'library';
	const needsTemplates = [
		'library',
		'builder',
		'segment',
		'abandoned-carts',
		'schedules',
		'pending-payments',
		'shipments',
		'',
	].includes(activePath);

	if (needsTemplates) {
		prefetchQuery(queryClient, {
			queryKey: queryKeys.campaigns.templates(),
			queryFn: () => fetchTemplates(),
			...queryPresets.campaigns,
		});
	}

	if (activePath === 'tracking') {
		prefetchQuery(queryClient, {
			queryKey: queryKeys.campaigns.runs(),
			queryFn: () => fetchCampaigns(),
			...queryPresets.campaigns,
		});
	}

	if (activePath === 'schedules') {
		prefetchQuery(queryClient, {
			queryKey: queryKeys.campaigns.schedules,
			queryFn: fetchCampaignSchedules,
			...queryPresets.campaigns,
		});
	}

	if (activePath === 'abandoned-carts') {
		prefetchQuery(queryClient, {
			queryKey: ['campaigns', 'abandoned-cart-automation', 'settings'],
			queryFn: fetchAbandonedCartAutomationSettings,
			...queryPresets.campaigns,
		});
	}

	if (activePath === 'pending-payments') {
		prefetchQuery(queryClient, {
			queryKey: ['campaigns', 'pending-payment-automation', 'settings'],
			queryFn: fetchPendingPaymentAutomationSettings,
			...queryPresets.campaigns,
		});
	}

	if (activePath === 'shipments') {
		const range = buildDefaultShipmentRange();
		prefetchQuery(queryClient, {
			queryKey: ['campaigns', 'shipment-notifications', 'settings'],
			queryFn: fetchShipmentNotificationSettings,
			...queryPresets.campaigns,
		});
		prefetchQuery(queryClient, {
			queryKey: ['campaigns', 'shipment-notifications', 'candidates', range],
			queryFn: () => fetchShipmentNotificationCandidates({
				dateFrom: range.dateFrom,
				dateTo: range.dateTo,
				includeNotified: true,
			}),
			...queryPresets.campaigns,
		});
	}
}

function prefetchAdminData(queryClient, { user = null } = {}) {
	if (!isPlatformAdminUser(user)) return;

	prefetchQuery(queryClient, {
		queryKey: ['admin', 'workspaces'],
		queryFn: async () => {
			const response = await api.get('/admin/workspaces');
			return response.data;
		},
		...queryPresets.catalog,
	});
}

export function prefetchInternalRouteData(pathname = '', queryClient, options = {}) {
	if (!queryClient) return;

	const path = readPath(pathname);

	if (path.startsWith('/operations')) {
		prefetchOperationsData(queryClient);
		return;
	}

	if (path.startsWith('/inbox')) {
		prefetchInboxData(pathname, queryClient);
		return;
	}

	if (path.startsWith('/campaigns')) {
		prefetchCampaignData(pathname, queryClient);
		return;
	}

	if (path.startsWith('/catalog')) {
		prefetchCatalogData(queryClient);
		return;
	}

	if (path.startsWith('/customers')) {
		prefetchCustomersData(queryClient);
		return;
	}

	if (path.startsWith('/abandoned-carts')) {
		prefetchAbandonedCartsData(queryClient);
		return;
	}

	if (path.startsWith('/admin') || path.startsWith('/analytics')) {
		prefetchAdminData(queryClient, options);
	}
}

export function prefetchInternalRouteAndData(pathname = '', queryClient, options = {}) {
	void prefetchInternalRoute(pathname);
	prefetchInternalRouteData(pathname, queryClient, options);
}

export function scheduleIdleInternalPrefetch(paths = [], queryClient, options = {}) {
	if (typeof window === 'undefined' || !paths.length) return () => {};

	const uniquePaths = [...new Set(paths.filter(Boolean))];
	const run = () => {
		for (const path of uniquePaths) {
			prefetchInternalRouteAndData(path, queryClient, options);
		}
	};

	if (typeof window.requestIdleCallback === 'function') {
		const id = window.requestIdleCallback(run, { timeout: 2000 });
		return () => window.cancelIdleCallback?.(id);
	}

	const id = window.setTimeout(run, 900);
	return () => window.clearTimeout(id);
}

export function getFrequentInternalPaths(user = null) {
	const paths = ['/operations'];
	const isAdmin = isAdminUser(user);
	const isPlatformAdmin = isPlatformAdminUser(user);

	if (!isPlatformAdmin) {
		paths.push('/inbox/automatico');
	}

	if (isAdmin && !isPlatformAdmin) {
		paths.push('/campaigns/library', '/customers', '/catalog', '/abandoned-carts');
	}

	if (isPlatformAdmin) {
		paths.push('/admin');
	}

	return paths;
}
