import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

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
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts']
  }
});
