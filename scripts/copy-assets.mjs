import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('apps/standalone/public/cad-assets', { recursive: true });
await copyFile('node_modules/manifold-3d/manifold.wasm', 'apps/standalone/public/cad-assets/manifold.wasm');
