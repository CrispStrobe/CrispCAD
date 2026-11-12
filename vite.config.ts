import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: 'apps/standalone', base: './',
  build: { outDir: '../../dist', emptyOutDir: true, rollupOptions: { input: { main: resolve('apps/standalone/index.html'), embedded: resolve('apps/standalone/embedded.html') } } },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 4317, strictPort: true, fs: { allow: [process.cwd()] } },
  preview: { port: 4317, strictPort: true },
});
