import {libraryPreviewAssets} from './scripts/library-preview-assets.js';
import {libraryCatalogueAssets} from './scripts/library-catalogue-assets.js';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import {preserveDwgClassNames} from './scripts/preserve-dwg-class-names.js';
import {exactKernelWorkerOutput,preserveExactKernelNames} from './scripts/exact-kernel-assets.js';
export default defineConfig({
  plugins: [libraryPreviewAssets(), libraryCatalogueAssets(), preserveExactKernelNames()],
  root: 'apps/standalone', base: './',
  build: { outDir: '../../dist', emptyOutDir: true, rollupOptions: { input: { main: resolve('apps/standalone/index.html'), embedded: resolve('apps/standalone/embedded.html'), 'exact-check': resolve('apps/standalone/exact-check.html') } } },
  worker: { format: 'es', plugins: () => [preserveDwgClassNames(), preserveExactKernelNames()], rollupOptions: { output: exactKernelWorkerOutput } },
  server: { host: '127.0.0.1', port: 4317, strictPort: true, fs: { allow: [process.cwd()] } },
  preview: { port: 4317, strictPort: true },
});
