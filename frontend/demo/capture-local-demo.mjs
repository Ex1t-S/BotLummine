import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../audit-artifacts/local-demo-v2');
const baseURL = process.env.DEMO_BASE_URL || 'http://127.0.0.1:5173';

const routes = [
	['operations', '/operations', '.operations-page'],
	['inbox', '/inbox/automatico', '.inbox-sidebar'],
	['campaign-audience', '/campaigns/segment', '.campaigns-page'],
	['campaign-tracking', '/campaigns/tracking', '.campaigns-page'],
	['carts', '/abandoned-carts', '.abandoned-carts-page'],
	['analytics', '/analytics', '.analytics-v2-page'],
	['ai-lab', '/ai-lab', '.ai-lab-page'],
];

const viewports = [
	['desktop', { width: 1440, height: 960 }],
	['mobile', { width: 390, height: 844 }],
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();

try {
	for (const [viewportName, viewport] of viewports) {
		const context = await browser.newContext({ viewport });
		const page = await context.newPage();
		await page.request.post(`${baseURL}/api/demo/reset`);

		for (const [name, route, readySelector] of routes) {
			await page.goto(`${baseURL}${route}`, { waitUntil: 'domcontentloaded' });
			await page.locator(readySelector).waitFor({ state: 'visible', timeout: 15_000 });
			await page.screenshot({
				path: path.join(outputDir, `${name}-${viewportName}.png`),
				fullPage: true,
			});
		}

		await context.close();
	}
} finally {
	await browser.close();
}

console.log(`Capturas demo guardadas en ${outputDir}`);
