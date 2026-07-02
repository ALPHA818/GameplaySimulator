import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const root = process.cwd();
const alias = {
  '@renderer': resolve(root, 'apps/desktop/src/renderer/src'),
  '@core': resolve(root, 'packages/core/src'),
  '@ui-shared': resolve(root, 'packages/ui-shared/src')
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias
    },
    build: {
      outDir: resolve(root, 'out/main'),
      rollupOptions: {
        input: resolve(root, 'apps/desktop/src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias
    },
    build: {
      outDir: resolve(root, 'out/preload'),
      rollupOptions: {
        input: resolve(root, 'apps/desktop/src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: resolve(root, 'apps/desktop/src/renderer'),
    plugins: [react()],
    build: {
      outDir: resolve(root, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(root, 'apps/desktop/src/renderer/index.html')
      }
    },
    resolve: {
      alias
    }
  }
});
