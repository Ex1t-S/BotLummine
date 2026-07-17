import { expect, test } from '@playwright/test';

const workspace = {
	id: 'workspace-operations',
	name: 'Marca Operativa',
	slug: 'marca-operativa',
	status: 'ACTIVE',
	branding: null,
};

const user = {
	id: 'user-operations',
	email: 'operator@example.test',
	name: 'Operador Sintetico',
	role: 'ADMIN',
	workspaceId: workspace.id,
	workspace,
};

function json(body, status = 200) {
	return {
		status,
		contentType: 'application/json',
		body: JSON.stringify(body),
	};
}

function summary({ empty = false } = {}) {
	return {
		totals: {
			activeConversations30d: empty ? 0 : 12,
			messages30dInbound: empty ? 0 : 40,
			messages30dOutbound: empty ? 0 : 31,
			paymentReview: empty ? 0 : 2,
			unreadConversations: empty ? 0 : 3,
			unreadMessages: empty ? 0 : 5,
			abandonedCartsNew: empty ? 0 : 1,
		},
		workspaces: empty
			? []
			: [{
				workspace,
				metrics: {
					activeConversations30d: 12,
					unreadConversations: 3,
					paymentReview: 2,
					customersCount: 8,
					campaignsCount: 1,
				},
				issues: [],
			}],
	};
}

async function installOperationsApi(page, {
	mode = 'success',
	allowSummary = null,
	errorControl = null,
	empty = false,
} = {}) {
	let summaryAttempts = 0;
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname.replace(/^\/api/, '');

		if (pathname === '/auth/me') {
			await route.fulfill(json({ ok: true, user }));
			return;
		}

		if (pathname === '/dashboard/operations/summary') {
			summaryAttempts += 1;
			if (allowSummary) await allowSummary.promise;
			if (mode === 'error' && !errorControl?.allow) {
				await route.fulfill(json({ ok: false, error: 'Resumen no disponible.' }, 503));
				return;
			}
			await route.fulfill(json(summary({ empty })));
			return;
		}

		if (pathname.includes('/campaigns/abandoned-cart-automation/settings')
			|| pathname.includes('/campaigns/pending-payment-automation/settings')
			|| pathname.includes('/campaigns/shipment-notifications/settings')) {
			await route.fulfill(json({ settings: { enabled: false, configured: false, lastError: null } }));
			return;
		}

		await route.fulfill(json({}));
	});

	return () => summaryAttempts;
}

test('operations comunica loading y luego muestra prioridades', async ({ page }) => {
	let releaseSummary;
	const allowSummary = { promise: new Promise((resolve) => { releaseSummary = resolve; }) };
	await installOperationsApi(page, { allowSummary });
	await page.goto('/operations');

	await expect(page.getByRole('status')).toContainText('Cargando prioridades operativas');
	releaseSummary();
	await expect(page.getByRole('heading', { name: 'Marca Operativa' })).toBeVisible();
	await expect(page.getByText('Revisar comprobantes')).toBeVisible();
});

test('operations separa error de empty y permite reintentar', async ({ page }) => {
	const errorControl = { allow: false };
	await installOperationsApi(page, { mode: 'error', errorControl });
	await page.goto('/operations');

	const errorState = page.getByRole('alert').filter({ hasText: 'No pudimos cargar la operación' });
	await expect(errorState).toBeVisible();
	await expect(page.getByText('No hay marcas para mostrar')).toHaveCount(0);
	errorControl.allow = true;
	await errorState.getByRole('button', { name: 'Reintentar' }).click();
	await expect(page.getByRole('heading', { name: 'Marca Operativa' })).toBeVisible();
});

test('operations ofrece empty explícito sin inventar prioridades', async ({ page }) => {
	await installOperationsApi(page, { empty: true });
	await page.goto('/operations');

	await expect(page.getByText('No hay marcas para mostrar')).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(page.getByText('Revisar comprobantes')).toBeVisible();
});
