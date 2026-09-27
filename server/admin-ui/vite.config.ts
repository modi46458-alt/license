import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Admin panel (static SPA). Built into server/public/admin and served by the
 * license server under /admin with a strict CSP. It contains no secrets: it
 * talks to /admin/api with an HttpOnly session cookie + CSRF header.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, '../public/admin'),
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: { polyfill: false },
  },
});
