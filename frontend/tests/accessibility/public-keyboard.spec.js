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

test.describe('accesibilidad pública crítica', () => {
	test('el menú móvil mueve, contiene y restaura el foco', async ({ page }) => {
		await mockPublicAuth(page);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/inicio');

		const trigger = page.locator('.login-nav__menu');
		await expect(trigger).toHaveAccessibleName('Abrir menu');
		await trigger.click();
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		await expect(trigger).toHaveAccessibleName('Cerrar menu');

		const dialog = page.getByRole('dialog', { name: 'Navegación móvil' });
		await expect(dialog).toBeVisible();
		await expect(dialog.locator('.login-mobile-nav__link').first()).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await expect(trigger).toBeFocused();
	});

	test('login expone labels, nombres accesibles y foco visible', async ({ page }) => {
		await mockPublicAuth(page);
		await page.goto('/login');

		const email = page.getByLabel('Email');
		const password = page.getByLabel('Contraseña', { exact: true });
		await expect(email).toBeVisible();
		await expect(password).toBeVisible();
		await expect(page.getByRole('button', { name: 'Mostrar contraseña' })).toBeVisible();

		await email.focus();
		const outlineStyle = await email.evaluate((element) => getComputedStyle(element.parentElement).outlineStyle);
		expect(outlineStyle).not.toBe('none');

		const unnamedControls = await page.evaluate(() => [
			...document.querySelectorAll('button, input, textarea, select'),
		].filter((element) => {
			const labelled = element.labels?.length
				|| element.getAttribute('aria-label')
				|| element.getAttribute('aria-labelledby')
				|| element.textContent?.trim()
				|| element.getAttribute('title');
			return !labelled;
		}).length);
		expect(unnamedControls).toBe(0);
	});
});
