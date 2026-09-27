import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Builds the extension pages (popup now; dashboard/options in Phase 10) and the MV3 service
 * worker. The service worker is emitted as an ES module (manifest declares
 * "type": "module"), so shared chunks between pages and the worker are fine.
 *
 * The content script is built separately (vite.content.config.ts) because
 * MV3 content scripts cannot be ES modules and must be a single classic file.
 */
/**
 * The license server origin is a build-time setting (VITE_LICENSE_API_URL,
 * e.g. https://license.example.com). It is written into the manifest's
 * host_permissions so the service worker may reach it; nothing else is.
 */
function licenseOriginInManifest(apiUrl: string): Plugin {
  const origin = new URL(apiUrl).origin;
  return {
    name: 'license-origin-in-manifest',
    apply: 'build',
    writeBundle(options) {
      const file = resolve(options.dir ?? 'dist', 'manifest.json');
      const text = readFileSync(file, 'utf8').replaceAll('__LICENSE_API_ORIGIN__', origin);
      writeFileSync(file, text);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    licenseOriginInManifest(
      loadEnv(mode, import.meta.dirname, 'VITE_').VITE_LICENSE_API_URL ?? 'http://localhost:8787',
    ),
  ],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    target: 'chrome120',
    // Chrome 120 supports modulepreload natively; the polyfill would add a fetch() call.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        'service-worker': resolve(import.meta.dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
}));
