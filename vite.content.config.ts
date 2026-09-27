import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Content script: one self-contained IIFE, appended to dist/ after the app build. */
export default defineConfig(({ mode }) => ({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    target: 'chrome120',
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      name: 'IMSLIContent',
      formats: ['iife'],
      fileName: () => 'content-script.js',
    },
  },
}));
