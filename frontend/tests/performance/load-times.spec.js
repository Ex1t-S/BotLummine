import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const strictMode = process.env.PERF_STRICT === '1';
const useRealApi = process.env.PERF_REAL_API === '1';
const perfEmail = process.env.PERF_EMAIL || '';
const perfPassword = process.env.PERF_PASSWORD || '';
const readyBudgetMs = Number(process.env.PERF_MAX_READY_MS || 3500);
const totalBudgetMs = Number(process.env.PERF_MAX_TOTAL_MS || 6500);
const testBaseURL = process.env.PERF_BASE_URL || 'http://127.0.0.1:4173';
const networkQuietTimeoutMs = Number(process.env.PERF_NETWORK_QUIET_TIMEOUT_MS || 5000);

const mockUser = {
	id: 'perf-user',
	email: 'perf@example.com',
	name: 'Perf Admin',
	role: 'ADMIN',
	workspaceId: 'perf-workspace',
	workspace: {
		id: 'perf-workspace',
		name: 'Marca Perf',
		slug: 'marca-perf',
		status: 'ACTIVE',
		branding: null,
	},
};

const routesToMeasure = [
	{ name: 'inicio-publico', path: '/inicio', readySelector: '.login-page', authenticated: false },
	{ name: 'login-publico', path: '/login', readySelector: '.login-card', authenticated: false },
	{ name: 'operations', path: '/operations', readySelector: '.operations-page' },
	{ name: 'inbox', path: '/inbox/automatico', readySelector: '.inbox-sidebar' },
	{ name: 'campaigns-library', path: '/campaigns/library', readySelector: '.campaigns-page' },
	{ name: 'campaigns-segment', path: '/campaigns/segment', readySelector: '.campaigns-page' },
	{ name: 'customers', path: '/customers', readySelector: '.customers-page' },
	{ name: 'catalog', path: '/catalog', readySelector: '.catalog-search-form' },
	{ name: 'admin', path: '/admin', readySelector: '.tenant-admin-page' },
	{ name: 'whatsapp-menu', path: '/whatsapp-menu', readySelector: '.wam-hero' },
];

function json(payload) {
	return {
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify(payload),
	};
}

function automationSettings() {
	return {
		enabled: false,
		configured: false,
		templateId: null,
		variableMapping: {},
		lastRunAt: null,
		lastError: null,
	};
}

function apiPayload(pathname, authenticated = true) {
	if (pathname === '/auth/me') return authenticated ? { ok: true, user: mockUser } : { ok: false, user: null };
	if (pathname === '/auth/login') return { ok: true, user: mockUser };
	if (pathname === '/auth/logout') return { ok: true };

	if (pathname === '/dashboard/operations/summary') {
		return {
			openIssuesCount: 0,
			totals: {
				activeConversations30d: 0,
				messages30dInbound: 0,
				paymentReview: 0,
				unreadConversationsCount: 0,
			},
			workspaces: [
				{
					workspace: mockUser.workspace,
					metrics: {
						activeConversations30d: 0,
						unreadConversationsCount: 0,
						paymentReview: 0,
						customersCount: 0,
						campaignsCount: 0,
					},
					issues: [],
				},
			],
		};
	}

	if (pathname.includes('automation/settings') || pathname.includes('shipment-notifications/settings')) {
		return automationSettings();
	}

	if (pathname === '/dashboard/inbox') {
		return {
			conversations: [],
			items: [],
			total: 0,
			nextCursor: null,
			hasMore: false,
		};
	}

	if (pathname.includes('/dashboard/conversations/') && pathname.endsWith('/messages')) {
		return { messages: [], items: [], nextCursor: null, hasMore: false };
	}

	if (pathname === '/dashboard/catalog') {
		return { items: [], total: 0, page: 1, totalPages: 1 };
	}

	if (pathname === '/dashboard/customers') {
		return {
			customers: [],
			items: [],
			stats: {
				totalOrders: 0,
				totalCustomers: 0,
				withPhone: 0,
				avgTicket: 0,
				totalSpent: 0,
			},
			pagination: { page: 1, totalPages: 1, total: 0 },
		};
	}

	if (pathname === '/dashboard/customers/sync-status') {
		return {
			running: false,
			message: 'Sin sincronización activa.',
			pagesFetched: 0,
			ordersFetched: 0,
			warnings: [],
			errors: [],
			activeWindow: { label: 'Últimos 30 días' },
		};
	}

	if (pathname === '/admin/workspaces') {
		return { workspaces: [mockUser.workspace] };
	}

	if (pathname.startsWith('/admin/workspaces/perf-workspace')) {
		return {
			workspace: mockUser.workspace,
			users: [],
			status: {},
			settings: {},
		};
	}

	if (pathname === '/admin/analytics/workspaces') {
		return { totals: {}, workspaces: [] };
	}

	if (pathname === '/campaigns/stats') return { overview: {}, stats: {} };
	if (pathname === '/campaigns/templates') return { templates: [] };
	if (pathname === '/campaigns') return { campaigns: [] };
	if (pathname === '/campaigns/schedules') return { schedules: [] };
	if (pathname === '/campaigns/shipment-notifications/candidates') {
		return { candidates: [], summary: {} };
	}

	if (pathname === '/whatsapp-menu') {
		return {
			settings: {
				name: 'Menú Perf',
				config: {
					version: 1,
					mainMenuKey: 'MAIN',
					menus: [
						{
							key: 'MAIN',
							title: 'Menú principal',
							headerText: 'Hola',
							body: 'Elegí una opción:',
							buttonText: 'Ver opciones',
							footerText: '',
							isActive: true,
							sortOrder: 1,
							options: [],
						},
					],
				},
			},
		};
	}

	return {};
}

async function installMockApi(page, getAuthenticated) {
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const pathname = url.pathname.replace(/^\/api/, '') || '/';

		if (pathname.endsWith('/stream')) {
			await route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				body: '',
			});
			return;
		}

		if (pathname === '/auth/me' && !getAuthenticated()) {
			await route.fulfill(json(apiPayload(pathname, false)));
			return;
		}

		await route.fulfill(json(apiPayload(pathname, getAuthenticated())));
	});
}

async function loginWithRealAccount(page) {
	if (!perfEmail || !perfPassword) {
		throw new Error('Faltan PERF_EMAIL y PERF_PASSWORD para PERF_REAL_API=1.');
	}

	await page.goto(new URL('/login', testBaseURL).toString(), { waitUntil: 'domcontentloaded' });
	await page.locator('input[type="email"]').fill(perfEmail);
	await page.locator('input[type="password"]').fill(perfPassword);
	await page.locator('button[type="submit"]').click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

async function collectMetrics(page, name, path, readySelector) {
	const startedAt = Date.now();
	await page.goto(new URL(path, testBaseURL).toString(), { waitUntil: 'domcontentloaded' });

	const domContentLoadedMs = Date.now() - startedAt;
	await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: 15_000 });
	const readyMs = Date.now() - startedAt;

	let networkQuietTimedOut = false;
	await page.waitForLoadState('networkidle', { timeout: networkQuietTimeoutMs }).catch(() => {
		networkQuietTimedOut = true;
	});
	const networkQuietMs = Date.now() - startedAt;

	const browserMetrics = await page.evaluate(() => {
		const [navigation] = performance.getEntriesByType('navigation');
		const resources = performance.getEntriesByType('resource')
			.map((entry) => ({
				name: entry.name,
				initiatorType: entry.initiatorType,
				duration: Math.round(entry.duration),
				transferSize: entry.transferSize || 0,
				encodedBodySize: entry.encodedBodySize || 0,
				decodedBodySize: entry.decodedBodySize || 0,
				responseEnd: Math.round(entry.responseEnd),
			}))
			.sort((a, b) => (b.transferSize || b.encodedBodySize) - (a.transferSize || a.encodedBodySize));

		const finishedResources = resources.filter((entry) => Number.isFinite(entry.responseEnd) && entry.responseEnd > 0);
		const lastFinishedResourceMs = finishedResources.length
			? Math.max(...finishedResources.map((entry) => entry.responseEnd))
			: 0;

		return {
			navigation: navigation
				? {
						duration: Math.round(navigation.duration),
						domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
						loadEventEnd: Math.round(navigation.loadEventEnd),
				  }
				: null,
			resources,
			lastFinishedResourceMs,
		};
	});
	const totalMs = Math.round(Math.max(readyMs, browserMetrics.navigation?.loadEventEnd || 0, browserMetrics.lastFinishedResourceMs || 0));

	const heavyResources = browserMetrics.resources
		.filter((resource) => {
			const fileName = resource.name.split('/').pop() || '';
			const size = Math.max(resource.transferSize, resource.encodedBodySize, resource.decodedBodySize);
			const isCodeOrStyle = /\.(js|css)(\?|$)/i.test(fileName);
			return size > (isCodeOrStyle ? 30_000 : 100_000) || resource.duration > 900;
		})
		.sort((a, b) => {
			const durationDelta = b.duration - a.duration;
			if (Math.abs(durationDelta) > 250) return durationDelta;
			const sizeA = Math.max(a.transferSize, a.encodedBodySize, a.decodedBodySize);
			const sizeB = Math.max(b.transferSize, b.encodedBodySize, b.decodedBodySize);
			return sizeB - sizeA;
		})
		.slice(0, 8)
		.map((resource) => ({
			...resource,
			name: resource.name.split('/').pop(),
		}));

	return {
		name,
		path,
		domContentLoadedMs,
		readyMs,
		totalMs,
		networkQuietMs,
		networkQuietTimedOut,
		navigation: browserMetrics.navigation,
		heavyResources,
	};
}

test.describe('performance de carga por pantalla', () => {
	test('mide rutas públicas e internas críticas', async ({ browser }, testInfo) => {
		const report = [];
		let storageState = null;

		if (useRealApi) {
			const authContext = await browser.newContext();
			const authPage = await authContext.newPage();
			await loginWithRealAccount(authPage);
			storageState = await authContext.storageState();
			await authContext.close();
		}

		for (const route of routesToMeasure) {
			const contextOptions = storageState && route.authenticated !== false ? { storageState } : undefined;
			const context = await browser.newContext(contextOptions);
			const page = await context.newPage();
			const authenticated = route.authenticated !== false;
			if (!useRealApi) {
				await installMockApi(page, () => authenticated);
			}

			try {
				const metrics = await collectMetrics(page, route.name, route.path, route.readySelector);
				report.push(metrics);
				console.log(
					`[perf] ${metrics.name}: ready=${metrics.readyMs}ms total=${metrics.totalMs}ms quiet=${metrics.networkQuietTimedOut ? 'timeout' : `${metrics.networkQuietMs}ms`} heavy=${metrics.heavyResources.map((item) => item.name).join(', ') || 'none'}`
				);
			} catch (error) {
				const failedMetric = {
					name: route.name,
					path: route.path,
					error: error?.message || String(error),
				};
				report.push(failedMetric);
				console.log(`[perf] ${route.name}: ERROR ${failedMetric.error}`);
			} finally {
				await context.close();
			}
		}

		await testInfo.attach('load-times.json', {
			body: JSON.stringify(report, null, 2),
			contentType: 'application/json',
		});

		const outputDir = path.resolve(process.cwd(), 'test-results', 'performance');
		await mkdir(outputDir, { recursive: true });
		await writeFile(path.join(outputDir, 'load-times.json'), JSON.stringify(report, null, 2));

		const failedRoutes = report.filter((metrics) => metrics.error);
		expect(failedRoutes, 'Todas las rutas medidas deben alcanzar su estado listo').toEqual([]);

		if (strictMode) {
			for (const metrics of report) {
				expect(metrics.readyMs, `${metrics.name} superó PERF_MAX_READY_MS`).toBeLessThanOrEqual(readyBudgetMs);
				expect(metrics.totalMs, `${metrics.name} superó PERF_MAX_TOTAL_MS`).toBeLessThanOrEqual(totalBudgetMs);
			}
		}
	});
});
