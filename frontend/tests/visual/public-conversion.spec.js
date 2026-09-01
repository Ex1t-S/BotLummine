import { expect, test } from '@playwright/test';

async function mockPublicAuth(page) {
	await page.route('**/api/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ ok: false, user: null }),
		});
	});
}

test.describe('experiencia pública de conversión', () => {
	test.beforeEach(async ({ page }) => {
		await mockPublicAuth(page);
	});

	test('landing prioriza una propuesta verificable y CTAs claros', async ({ page }) => {
		await page.goto('/inicio');

		await expect(page.getByRole('heading', {
			name: 'Convertí conversaciones en trabajo comercial ordenado.',
		})).toBeVisible();
		await expect(page.getByRole('link', { name: 'Solicitar una demo' }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Ver planes' })).toBeVisible();
		await expect(page.getByText('+12k')).toHaveCount(0);
		await expect(page.getByText('86%')).toHaveCount(0);
		await expect(page).toHaveTitle(/BladeIA.*operación comercial/i);
		await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /WhatsApp/i);
	});

	test('precios ofrece una acción concreta por plan', async ({ page }) => {
		await page.goto('/precios');

		await expect(page.getByRole('heading', { name: 'Un plan claro para cada etapa.' })).toBeVisible();
		const planActions = page.locator('.login-pricing-card__cta');
		await expect(planActions).toHaveCount(2);
		for (const action of await planActions.all()) {
			await expect(action).toHaveAttribute('href', /^\/contacto\?plan=/);
		}
	});

	test('contacto separa los canales y conserva contexto del plan', async ({ page }) => {
		await page.goto('/contacto?plan=B%C3%A1sico');

		await expect(page.getByRole('heading', { name: 'Veamos cómo ordenar tu operación.' })).toBeVisible();
		await expect(page.getByRole('link', { name: /WhatsApp/i })).toBeVisible();
		await expect(page.locator('a[href^="mailto:"]')).toHaveCount(2);
		await expect(page.getByText(/Consulta por Básico/i)).toBeVisible();
	});

	test('login no se indexa y conserva labels visibles', async ({ page }) => {
		await page.goto('/login');

		await expect(page.getByRole('heading', { name: 'Ingresá a tu espacio' })).toBeVisible();
		await expect(page.getByLabel('Email')).toBeVisible();
		await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
	});

	for (const path of ['/inicio', '/precios', '/contacto', '/login']) {
		test(`${path} no desborda horizontalmente en móvil`, async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(path);
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
			expect(overflow).toBeLessThanOrEqual(1);
		});
	}
});
