import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(here, './src/assets/feature-carousel');
const baseURL = process.env.SHOWCASE_BASE_URL || 'http://127.0.0.1:5174';
const email = process.env.SHOWCASE_EMAIL || 'showcase@bladeia.local';
const password = process.env.SHOWCASE_PASSWORD || 'DemoBladeIA2026!';

const shots = [
	{ path: '/inbox/automatico', file: 'showcase-inbox-auto.png' },
	{ path: '/inbox/comprobantes', file: 'showcase-inbox-payments.png' },
	{ path: '/campaigns/tracking', file: 'showcase-campaigns.png' },
	{ path: '/campaigns/templates', file: 'showcase-templates.png' },
	{ path: '/abandoned-carts', file: 'showcase-carts.png' },
	{ path: '/operations', file: 'showcase-operations.png' },
];

async function login(page) {
	await page.addInitScript(() => {
		window.localStorage.setItem('theme', 'dark');
		document.documentElement.classList.add('dark');
	});

	const response = await page.context().request.post('http://127.0.0.1:3000/api/auth/login', {
		data: { email, password },
	});

	if (!response.ok()) {
		throw new Error(`No se pudo iniciar sesion para capturas: HTTP ${response.status()}`);
	}

	const rawCookie = response.headers()['set-cookie'] || '';
	const token = rawCookie.match(/wa_assistant_token=([^;]+)/)?.[1];

	if (!token) {
		throw new Error('El backend no devolvio el token de sesion esperado.');
	}

	await page.context().addCookies([
		{
			name: 'wa_assistant_token',
			value: token,
			domain: '127.0.0.1',
			path: '/',
			httpOnly: true,
			secure: false,
			sameSite: 'Lax',
		},
	]);

	await page.goto(`${baseURL}/operations`, { waitUntil: 'domcontentloaded' });
	await page.waitForURL(/\/operations/, { timeout: 30_000 });
	await page.waitForTimeout(2200);
}

async function capture(page, shot) {
	await page.goto(`${baseURL}${shot.path}`, { waitUntil: 'domcontentloaded' });

	if (shot.path === '/operations') {
		await page.locator('.operations-summary-strip').waitFor({ state: 'visible', timeout: 30_000 });
		await page.getByText('Cargando prioridades operativas', { exact: false }).waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => null);
		await page.waitForTimeout(1800);
	} else {
		await page.waitForTimeout(2600);
	}

	await page.screenshot({
		path: resolve(outputDir, shot.file),
		fullPage: false,
	});
}

async function main() {
	await mkdir(outputDir, { recursive: true });

	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({
		viewport: { width: 1440, height: 960 },
		deviceScaleFactor: 1,
	});

	await login(page);

	for (const shot of shots) {
		await capture(page, shot);
	}

	await browser.close();
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
