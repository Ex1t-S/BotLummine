import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const baseURL = 'http://127.0.0.1:5174';

export default defineConfig({
	testDir: '.',
	testMatch: 'local-demo.spec.js',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	use: {
		baseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm exec vite -- --mode demo --host 127.0.0.1 --port 5174',
		cwd: frontendRoot,
		url: `${baseURL}/api/demo/status`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
