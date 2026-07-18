import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.resolve(root, '../audit-artifacts/redesign-v2');
const viewports = [
	{ name: '1440x960', width: 1440, height: 960 },
	{ name: '1280x800', width: 1280, height: 800 },
	{ name: '768x1024', width: 768, height: 1024 },
	{ name: '390x844', width: 390, height: 844 },
];

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const metrics = [];

for (const screen of ['operations', 'inbox']) {
	const prototype = `file://${path.join(root, `visual-redesign-v2-${screen}.html`).replaceAll('\\', '/')}`;
	for (const viewport of viewports) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await page.goto(prototype, { waitUntil: 'load' });
		await page.screenshot({
			path: path.join(outputRoot, `${screen}-${viewport.name}.png`),
			fullPage: true,
		});
		const result = await page.evaluate(() => ({
			documentWidth: document.documentElement.scrollWidth,
			viewportWidth: window.innerWidth,
			documentHeight: document.documentElement.scrollHeight,
			buttons: document.querySelectorAll('button').length,
			icons: document.querySelectorAll('svg.icon').length,
			cards: document.querySelectorAll('.panel').length,
			kpis: document.querySelectorAll('.metric').length,
			badges: document.querySelectorAll('.badge').length,
		}));
		metrics.push({ screen, state: 'default', viewport: viewport.name, ...result });

		if (screen === 'inbox' && viewport.width <= 580) {
			await page.locator('[data-conversation]').first().click();
			await page.screenshot({
				path: path.join(outputRoot, `${screen}-chat-${viewport.name}.png`),
				fullPage: true,
			});
		}
	}
}

await writeFile(path.join(outputRoot, 'metrics.json'), `${JSON.stringify({ generatedAt: 'synthetic-fixtures', metrics }, null, 2)}\n`);
await browser.close();
console.log(`Captured ${metrics.length} V2 states into ${outputRoot}`);
