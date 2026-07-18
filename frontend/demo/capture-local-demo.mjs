import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../audit-artifacts/local-demo-v4');
const baseURL = process.env.DEMO_BASE_URL || 'http://127.0.0.1:5173';

const routes = [
	['operations', '/operations', '.operations-page'],
	['operations-scrolled', '/operations', '.operations-page', true],
	['inbox', '/inbox/automatico', '.inbox-sidebar'],
	['campaign-overview', '/campaigns', '.campaign-os-overview'],
	['campaign-create', '/campaigns/segment?audience=customers', '.campaign-wizard-nav'],
	['campaign-audiences', '/campaigns/audiences', '.campaign-os-audiences'],
	['campaign-automations', '/campaigns/automations', '.campaign-os-automations'],
	['campaign-templates', '/campaigns/library', '.template-library-shell'],
	['campaign-results', '/campaigns/results', '.campaign-os-results'],
	['campaign-results-detail', '/campaigns/tracking', '.campaigns-page'],
	['carts', '/abandoned-carts', '.abandoned-carts-page'],
	['analytics', '/analytics', '.analytics-v2-page'],
	['ai-lab', '/ai-lab', '.ai-lab-page'],
];

const viewports = [
	['desktop', { width: 1440, height: 960 }],
	['desktop-compact', { width: 1280, height: 800 }],
	['tablet', { width: 768, height: 1024 }],
	['mobile', { width: 390, height: 844 }],
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();

try {
	for (const [viewportName, viewport] of viewports) {
		const context = await browser.newContext({ viewport });
		const page = await context.newPage();
		await page.request.post(`${baseURL}/api/demo/reset`);

		for (const [name, route, readySelector, scrollContent = false] of routes) {
			await page.goto(`${baseURL}${route}`, { waitUntil: 'domcontentloaded' });
			await page.locator(readySelector).waitFor({ state: 'visible', timeout: 15_000 });
			if (scrollContent) {
				await page.locator('.admin-content').evaluate((element) => {
					element.scrollTop = 640;
				});
			}
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
