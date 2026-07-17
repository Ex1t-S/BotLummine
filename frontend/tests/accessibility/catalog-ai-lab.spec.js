import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const workspace = {
	id: 'workspace-accessibility',
	name: 'Marca Accesible',
	slug: 'marca-accesible',
	status: 'ACTIVE',
	branding: null,
	aiConfig: { businessName: 'Marca Accesible', vertical: 'ECOMMERCE' },
};

function json(body, status = 200) {
	return {
		status,
		contentType: 'application/json',
		body: JSON.stringify(body),
	};
}

function user(role) {
	return {
		id: `user-${role.toLowerCase()}`,
		email: 'admin@example.test',
		name: 'Admin Accesible',
		role,
		workspaceId: role === 'PLATFORM_ADMIN' ? null : workspace.id,
		workspace: role === 'PLATFORM_ADMIN' ? null : workspace,
	};
}

async function installCatalogApi(page, control) {
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname.replace(/^\/api/, '');

		if (pathname === '/auth/me') {
			await route.fulfill(json({ ok: true, user: user('ADMIN') }));
			return;
		}

		if (pathname === '/dashboard/catalog') {
			if (!control.allowCatalog) {
				await route.fulfill(json({ error: 'Catalogo temporalmente no disponible.' }, 503));
				return;
			}
			await route.fulfill(json({
				items: [{
					id: 'product-accessible',
					name: 'Producto Accesible',
					brand: 'Marca Accesible',
					currentPriceLabel: '$ 25.000',
				}],
				total: 25,
				page: 1,
				totalPages: 2,
			}));
			return;
		}

		await route.fulfill(json({}));
	});
}

async function installAiLabApi(page) {
	await page.route('**/api/**', async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname.replace(/^\/api/, '');

		if (pathname === '/auth/me') {
			await route.fulfill(json({ ok: true, user: user('PLATFORM_ADMIN') }));
			return;
		}

		if (pathname === '/admin/workspaces') {
			await route.fulfill(json({ workspaces: [workspace] }));
			return;
		}

		if (pathname === '/ai-lab/sessions') {
			await route.fulfill(json({ session: { id: 'session-accessible', messages: [] } }));
			return;
		}

		if (pathname === '/ai-lab/sessions/session-accessible/messages') {
			await route.fulfill(json({
				session: {
					id: 'session-accessible',
					messages: [
						{
							id: 'message-user',
							role: 'user',
							text: 'Consulta sintetica de producto',
							createdAt: '2026-07-17T15:00:00.000Z',
						},
						{
							id: 'message-assistant',
							role: 'assistant',
							text: 'Respuesta sintetica verificada',
							createdAt: '2026-07-17T15:00:01.000Z',
						},
					],
				},
			}));
			return;
		}

		await route.fulfill(json({}));
	});
}

test.beforeAll(async () => {
	await mkdir('audit-artifacts/screenshots/after', { recursive: true });
});

test('Catalogo expone busqueda, error recuperable y paginacion semantica', async ({ page }) => {
	const control = { allowCatalog: false };
	await installCatalogApi(page, control);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/catalog');

	await expect(page.getByLabel('Buscar en el catalogo')).toBeVisible();
	const errorState = page.getByRole('alert').filter({ hasText: 'No pudimos cargar el catálogo' });
	await expect(errorState).toBeVisible();
	await expect(page.getByText('No encontramos productos')).toHaveCount(0);

	control.allowCatalog = true;
	await errorState.getByRole('button', { name: 'Reintentar' }).click();
	await expect(page.getByText('Producto Accesible')).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Paginacion del catalogo' })).toBeVisible();
	await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	const brandBox = await page.locator('.admin-brand').boundingBox();
	expect(brandBox?.x, JSON.stringify(brandBox)).toBeGreaterThanOrEqual(0);
	const brandLogoBox = await page.locator('.admin-brand-mark').boundingBox();
	expect(brandLogoBox?.x, JSON.stringify(brandLogoBox)).toBeGreaterThanOrEqual(0);
	const brandCopyBox = await page.locator('.admin-brand-copy').boundingBox();
	expect(
		brandCopyBox?.x,
		JSON.stringify({ brandLogoBox, brandCopyBox }),
	).toBeGreaterThanOrEqual((brandLogoBox?.x || 0) + (brandLogoBox?.width || 0));
	await page.screenshot({ path: 'audit-artifacts/screenshots/after/catalog-mobile-390x844.png' });
});

test('AI Lab anuncia el historial y permite enviar una prueba sintetica', async ({ page }) => {
	await installAiLabApi(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/ai-lab');

	const composer = page.getByLabel('Mensaje de prueba');
	await expect(composer).toBeEnabled();
	const log = page.getByRole('log', { name: 'Conversacion de prueba con la IA' });
	await expect(log).toBeVisible();

	await composer.fill('Consulta sintetica de producto');
	await page.getByRole('button', { name: 'Enviar' }).click();
	await expect(log.getByText('Respuesta sintetica verificada')).toBeVisible();
	await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.screenshot({ path: 'audit-artifacts/screenshots/after/ai-lab-mobile-390x844.png' });
});
