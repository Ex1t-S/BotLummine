import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const workspace = {
	id: 'workspace-customers',
	name: 'Marca Clientes',
	slug: 'marca-clientes',
	status: 'ACTIVE',
	branding: null,
};

function json(body, status = 200) {
	return {
		status,
		contentType: 'application/json',
		body: JSON.stringify(body),
	};
}

async function installCustomersApi(page, control) {
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const pathname = url.pathname.replace(/^\/api/, '');

		if (pathname === '/auth/me') {
			await route.fulfill(json({
				ok: true,
				user: {
					id: 'user-customers',
					email: 'admin@example.test',
					name: 'Admin Clientes',
					role: 'ADMIN',
					workspaceId: workspace.id,
					workspace,
				},
			}));
			return;
		}

		if (pathname === '/dashboard/customers') {
			if (!control.allowCustomers) {
				await route.fulfill(json({ message: 'Clientes temporalmente no disponibles.' }, 503));
				return;
			}

			await route.fulfill(json({
				customers: [
					{
						id: 'customer-synthetic',
						displayName: 'Cliente Sintetico',
						initials: 'CS',
						phone: '+54 11 0000 0000',
						email: 'cliente@example.test',
						lastOrderLabel: '#1001',
						totalSpentLabel: '$ 75.000',
						paymentStatus: 'paid',
						shippingStatus: 'preparing',
						lastOrderDateLabel: '17/7/2026',
						totalUnitsPurchased: 2,
						productsPreview: ['Producto sintetico de prueba'],
						updatedAt: '2026-07-17T15:00:00.000Z',
					},
				],
				stats: {
					totalOrders: 1,
					totalCustomers: 1,
					withPhone: 1,
					totalSpent: 75000,
					avgTicket: 75000,
					showingFrom: 1,
					showingTo: 1,
				},
				pagination: { page: 1, totalPages: 3, totalItems: 49, pageSize: 24 },
			}));
			return;
		}

		if (pathname === '/dashboard/customers/sync-status') {
			await route.fulfill(json({ running: false, message: 'Sincronizacion lista.', errors: [], warnings: [] }));
			return;
		}

		if (pathname === '/dashboard/catalog') {
			await route.fulfill(json({
				items: [
					{ id: 'product-1', name: 'Producto sintetico de prueba' },
					{ id: 'product-2', name: 'Segundo producto sintetico' },
				],
			}));
			return;
		}

		await route.fulfill(json({}));
	});
}

test.beforeAll(async () => {
	await mkdir('audit-artifacts/screenshots/after', { recursive: true });
});

test('expone filtros, selector y paginacion por nombre accesible en mobile', async ({ page }) => {
	const control = { allowCustomers: true };
	await installCustomersApi(page, control);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/customers');

	await expect(page.getByLabel('Buscar general')).toBeVisible();
	await expect(page.getByLabel('Nro. pedido')).toBeVisible();
	await expect(page.getByLabel('Pago')).toBeVisible();
	await expect(page.getByLabel('Envío')).toBeVisible();

	const productToggle = page.getByRole('button', { name: 'Producto comprado' });
	await expect(productToggle).toHaveAttribute('aria-expanded', 'false');
	await productToggle.focus();
	await expect(productToggle).toBeFocused();
	await productToggle.press('Enter');
	await expect(productToggle).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByLabel('Buscar productos del catalogo')).toBeVisible();

	const currentPage = page.getByRole('button', { name: 'Ir a la pagina 1' });
	await expect(currentPage).toHaveAttribute('aria-current', 'page');
	const nextPage = page.getByRole('button', { name: 'Ir a la pagina siguiente' });
	const targetMetrics = await nextPage.evaluate((element) => ({
		height: element.getBoundingClientRect().height,
		minHeight: getComputedStyle(element).minHeight,
		zoom: getComputedStyle(element).zoom,
	}));
	expect(targetMetrics.height, JSON.stringify(targetMetrics)).toBeGreaterThanOrEqual(44);

	await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.screenshot({ path: 'audit-artifacts/screenshots/after/customers-mobile-390x844.png' });
});

test('no presenta un estado vacio durante un error y permite reintentar', async ({ page }) => {
	const control = { allowCustomers: false };
	await installCustomersApi(page, control);
	await page.goto('/customers');

	const errorState = page.getByRole('alert').filter({ hasText: 'No pudimos cargar las compras' });
	await expect(errorState).toBeVisible();
	await expect(page.getByText('No hay compras para esos filtros')).toHaveCount(0);

	control.allowCustomers = true;
	await errorState.getByRole('button', { name: 'Reintentar' }).click();
	await expect(page.getByText('Cliente Sintetico')).toBeVisible();
});
