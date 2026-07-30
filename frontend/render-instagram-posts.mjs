import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(here, './src/assets/instagram');
const style = process.env.INSTAGRAM_POST_STYLE || 'digitall';
const isGenerative = style === 'generative' || style === 'v4';
const isRework = style === 'rework' || style === 'v5';
const rendererFile = isRework
	? 'instagram-posts-render-v5.html'
	: isGenerative
		? 'instagram-posts-render-v4.html'
		: 'instagram-posts-render.html';
const htmlUrl = pathToFileURL(resolve(here, rendererFile)).href;
const version =
	process.env.INSTAGRAM_POST_VERSION || (isRework ? 'v5' : isGenerative ? 'v4' : style === 'digitall' ? 'v3' : 'v2');

async function main() {
	await mkdir(outputDir, { recursive: true });

	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({
		viewport: { width: 1080, height: 1350 },
		deviceScaleFactor: 1,
	});

	for (let index = 1; index <= 9; index += 1) {
		await page.goto(`${htmlUrl}?post=${index}&style=${style}`, { waitUntil: 'load' });
		await page.waitForFunction(() => window.__READY__ === true);
		await page.screenshot({
			path: resolve(outputDir, `bladeia-instagram-post-${version}-${String(index).padStart(2, '0')}.png`),
			clip: { x: 0, y: 0, width: 1080, height: 1350 },
		});
	}

	await browser.close();
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
