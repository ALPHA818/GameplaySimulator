import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(process.cwd(), 'apps/runner/src/index.ts'),
      formats: ['es'],
      fileName: 'index'
    },
    outDir: resolve(process.cwd(), 'dist/runner'),
    emptyOutDir: true,
    target: 'node20'
  }
});
