import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/** Benchmarks only (npm run bench); not part of npm test. */
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  test: { environment: 'jsdom', include: ['bench/**/*.bench.test.ts'], testTimeout: 300_000 },
});
