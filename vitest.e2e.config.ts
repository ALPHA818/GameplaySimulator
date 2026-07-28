import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(process.cwd(), 'packages/core/src'),
      '@instrumentation-sdk': resolve(process.cwd(), 'packages/instrumentation-sdk/src'),
      '@renderer': resolve(process.cwd(), 'apps/desktop/src/renderer/src'),
      '@ui-shared': resolve(process.cwd(), 'packages/ui-shared/src')
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/e2e/**/*.e2e.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
