import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const workspace = {
	id: 'workspace-carts',
	name: 'Marca Carritos',
	slug: 'marca-carritos',
	status: 'ACTIVE',
};

const user = {
	id: 'user-carts',
	email: 'operador@example.test',
	name: 'Operador Sintético',
	role: 'ADMIN',
	workspaceId: workspace.id,
	workspace,
};

const cart = {
	id: 'cart-synthetic-1',
	contactName: 'Cliente Sintético',
	contactPhone: '+54 11 0000 0000',
	contactEmail: 'cliente@example.test',
	checkoutCreatedAt: '2026-07-15T15:00:00.000Z',
	createdAt: '2026-07-15T15:00:00.000Z',
	status: 'NEW',
	statusLabel: 'Nuevo',
	totalLabel: '$ 125.000,00',
	lastMessageSentLabel: 'Nunca',
	responsibleName: null,
	canOpenCart: true,
	abandonedCheckoutUrl: 'https://example.test/cart/synthetic',
	productsPreview: ['Producto de prueba'],
	displayCreatedAt: '15/7/2026, 12:00',
	shippingCity: 'Ciudad de prueba',
	shippingProvince: 'Provincia de prueba',
};

function json(body, status = 200) {
	return {
		status,
		contentType: 'application/json',
		body: JSON.stringify(body),
	};
}

function cartsPayload({ empty = false } = {}) {
	return {
		ok: true,
		carts: empty ? [] : [cart],
		stats: {
			total: empty ? 0 : 1,
			totalNew: empty ? 0 : 1,
			totalContacted: 0,
			showingFrom: empty ? 0 : 1,
			showingTo: empty ? 0 : 1,
		},
		pagination: { page: 1, totalPages: 1, total: empty ? 0 : 1 },
	};
}

async function installCartsApi(page, { release = null, errorControl = null, empty = false } = {}) {
	await page.route('**/api/**', async (route) => {
		const pathname = new URL(route.request().url()).pathname.replace(/^\/api/, '');

		if (pathname === '/auth/me') {
			await route.fulfill(json({ ok: true, user }));
			return;
		}

		if (pathname === '/dashboard/abandoned-carts' && route.request().method() === 'GET') {
			if (release) await release.promise;
			if (errorControl && !errorControl.allow) {
				await route.fulfill(json({ ok: false, error: 'Carritos temporalmente no disponibles.' }, 503));
				return;
			}
			await route.fulfill(json(cartsPayload({ empty })));
			return;
		}

		await route.fulfill(json({ ok: true }));
	});
}

test.beforeAll(async () => {
	await mkdir('audit-artifacts/screenshots/after', { recursive: true });
});

test('separa loading y muestra la tabla operativa en desktop', async ({ page }) => {
	let resolveRequest;
	const release = { promise: new Promise((resolve) => { resolveRequest = resolve; }) };
	await installCartsApi(page, { release });
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto('/abandoned-carts');

	await expect(page.getByRole('status')).toContainText('Cargando carritos abandonados');
	resolveRequest();

	const table = page.getByRole('table', { name: 'Carritos abandonados ordenados desde el más reciente' });
	await expect(table).toBeVisible();
	for (const column of ['Cliente', 'Importe', 'Antigüedad', 'Estado', 'Último contacto', 'Próxima acción']) {
		await expect(table.getByRole('columnheader', { name: column })).toBeVisible();
	}
	await expect(table.getByText('Cliente Sintético')).toBeVisible();
	await expect(table.getByText('No contactado', { exact: true })).toBeVisible();
	await page.screenshot({
		path: 'audit-artifacts/screenshots/after/abandoned-carts-table-1440x960.png',
		fullPage: true,
	});
});

test('separa error de empty y permite reintentar', async ({ page }) => {
	const errorControl = { allow: false };
	await installCartsApi(page, { errorControl });
	await page.goto('/abandoned-carts');

	const errorState = page.getByRole('alert').filter({ hasText: 'No pudimos cargar los carritos' });
	await expect(errorState).toBeVisible();
	await expect(page.getByText('No hay carritos para mostrar')).toHaveCount(0);

	errorControl.allow = true;
	await errorState.getByRole('button', { name: 'Reintentar' }).click();
	await expect(page.getByRole('table')).toBeVisible();
	await expect(errorState).toHaveCount(0);
});

test('usa cards operativas sin overflow en móvil', async ({ page }) => {
	await installCartsApi(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/abandoned-carts');

	const mobileCard = page.locator('.abandoned-card').filter({ hasText: 'Cliente Sintético' });
	await expect(mobileCard).toBeVisible();
	await expect(page.getByRole('table')).toBeHidden();
	await expect.poll(() => page.evaluate(
		() => document.documentElement.scrollWidth <= window.innerWidth
	)).toBe(true);
	await mobileCard.scrollIntoViewIfNeeded();
	await page.screenshot({
		path: 'audit-artifacts/screenshots/after/abandoned-carts-mobile-390x844.png',
		fullPage: true,
	});
});
