import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PERF_BASE_URL || 'http://127.0.0.1:4173';
const shouldStartPreview = !process.env.PERF_BASE_URL;

export default defineConfig({
	testDir: './tests',
	timeout: 60_000,
	expect: {
		timeout: 10_000,
	},
	reporter: [
		['list'],
		['html', { outputFolder: 'playwright-report', open: 'never' }],
	],
	use: {
		baseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: shouldStartPreview
		? {
				command: 'npm run build && npm run preview -- --host 127.0.0.1',
				url: baseURL,
				reuseExistingServer: true,
				timeout: 120_000,
		  }
		: undefined,
});
