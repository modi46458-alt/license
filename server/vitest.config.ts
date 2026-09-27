import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node', // admin-ui tests opt into jsdom per file
    include: ['test/**/*.test.ts', 'admin-ui/src/**/*.test.tsx'],
    testTimeout: 20_000,
  },
});
