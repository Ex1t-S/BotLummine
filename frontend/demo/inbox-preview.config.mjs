import { mergeConfig } from 'vite';
import baseConfig from '../vite.config.js';
import { fileURLToPath } from 'node:url';
export default env => mergeConfig(baseConfig({ ...env, mode: 'demo' }), {
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-inbox-preview', import.meta.url)),
  define: {
    'import.meta.env.VITE_BASE_API_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
  },
});
