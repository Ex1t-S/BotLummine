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
			dedupe: ['react', 'react-dom'],
			alias: {
				'@': path.resolve(__dirname, './src'),
			},
		},
		// Prebundle the React entry points together so lazy routes and the renderer
		// share the same hook dispatcher, including during local hot reloads.
		optimizeDeps: {
			include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
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
