import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@contracts': path.resolve(__dirname, 'contracts') },
  },
  test: {
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup-env.ts'],
    // Integration tests share one database — keep files sequential.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
