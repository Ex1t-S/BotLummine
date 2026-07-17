import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function revealLazySections(page) {
	const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
	for (let offset = 0; offset <= documentHeight; offset += 600) {
		await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), offset);
		await page.waitForTimeout(30);
	}
	await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
	await page.waitForTimeout(100);
}

test('captura las vistas públicas sin datos reales', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.route('**/api/**', async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === '/api/auth/me') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: false, user: null }),
			});
			return;
		}
		await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
	});

	const outputDir = 'audit-artifacts/screenshots/after';
	await mkdir(outputDir, { recursive: true });

	for (const viewport of [
		{ width: 1440, height: 960 },
		{ width: 390, height: 844 },
	]) {
		await page.setViewportSize(viewport);
		for (const route of [
			{ path: '/inicio', name: 'landing' },
			{ path: '/precios', name: 'pricing' },
			{ path: '/contacto', name: 'contact' },
			{ path: '/login', name: 'login' },
		]) {
			await page.goto(route.path);
			await expect(page.locator('.login-page')).toBeVisible();
			await revealLazySections(page);
			await page.screenshot({
				path: `${outputDir}/${route.name}-${viewport.width}x${viewport.height}.png`,
				fullPage: true,
			});
		}
	}
});
