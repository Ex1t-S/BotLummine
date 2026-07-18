import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoApiPlugin } from './demo/demo-api-plugin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
	const demoMode = mode === 'demo';

	return {
		plugins: [demoMode ? createDemoApiPlugin() : null, react(), tailwindcss()].filter(Boolean),
		resolve: {
			alias: {
				'@': path.resolve(__dirname, './src'),
			},
		},
		build: {
			rollupOptions: {
				output: {
					manualChunks(id) {
						if (!id.includes('node_modules')) return undefined;
						if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
							return 'vendor-react';
						}
						if (id.includes('lucide-react')) {
							return 'vendor-icons';
						}
						if (id.includes('three')) {
							return 'vendor-three';
						}
						return undefined;
					}
				},
			},
		},
		server: {
			port: 5173,
			proxy: demoMode ? undefined : {
				'/api': {
					target: 'http://127.0.0.1:3000',
					changeOrigin: true,
				},
			},
		},
	};
});
