import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.dirname(fileURLToPath(import.meta.url));
const prototype = `file://${path.join(root, 'visual-redesign-prototypes.html').replaceAll('\\', '/')}`;
const outputRoot = path.resolve(root, '../audit-artifacts/redesign-prototypes');
const viewports = [
	{ name: '1440x960', width: 1440, height: 960 },
	{ name: '1280x800', width: 1280, height: 800 },
	{ name: '768x1024', width: 768, height: 1024 },
	{ name: '390x844', width: 390, height: 844 },
];
const directions = ['a', 'b', 'c'];
const screens = ['operations', 'inbox', 'campaigns', 'carts'];

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const metrics = [];

for (const direction of directions) {
	await mkdir(path.join(outputRoot, direction), { recursive: true });
	for (const screen of screens) {
		for (const viewport of viewports) {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await page.goto(prototype);
			await page.evaluate(({ direction: nextDirection, screen: nextScreen }) => {
				document.querySelector(`[data-direction="${nextDirection}"]`)?.click();
				document.querySelector(`.screen-nav [data-screen="${nextScreen}"]`)?.click();
			}, { direction, screen });
			await page.screenshot({
				path: path.join(outputRoot, direction, `${screen}-${viewport.name}.png`),
				fullPage: true,
			});
			const counts = await page.evaluate(() => {
				const visible = (selector) => [...document.querySelectorAll(selector)].filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
				return {
					sections: visible('#screen .section').length,
					kpis: visible('#screen .kpi').length,
					badges: visible('#screen .status').length,
					actions: visible('#screen button').length,
					borders: visible('#screen *').filter((node) => getComputedStyle(node).borderTopWidth !== '0px' || getComputedStyle(node).borderLeftWidth !== '0px').length,
				};
			});
			metrics.push({ direction, screen, viewport: viewport.name, ...counts });
		}
	}
}

await writeFile(path.join(outputRoot, 'metrics.json'), `${JSON.stringify({ generatedAt: 'synthetic-fixtures', metrics }, null, 2)}\n`);
await browser.close();
console.log(`Captured ${metrics.length} prototype states into ${outputRoot}`);
