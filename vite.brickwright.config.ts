import {libraryPreviewAssets} from './scripts/library-preview-assets.js';
import {libraryCatalogueAssets} from './scripts/library-catalogue-assets.js';
// SPDX-License-Identifier: BSD-3-Clause
import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import {preserveDwgClassNames} from './scripts/preserve-dwg-class-names.js';
import {exactKernelWorkerOutput} from './scripts/exact-kernel-assets.js';
export default defineConfig({
  plugins: [libraryPreviewAssets(), libraryCatalogueAssets()],
  base:'./',
  build:{outDir:'dist/brickwright-sdk',emptyOutDir:true,target:'es2020',
    lib:{entry:resolve('apps/brickwright/sdk.ts'),formats:['es'],fileName:()=> 'sdk.js'},
    // Keep fonts as files rather than duplicating them into the worker and host.
    assetsInlineLimit:0,
  },
  worker:{format:'es',plugins:()=>[preserveDwgClassNames()],rollupOptions:{output:exactKernelWorkerOutput}},
  // The lazily loaded exact-kernel chunk (only inside the geometry worker) initialises its
  // WebAssembly with top-level await. Hosts never parse worker chunks with their bundler; they
  // load them as module workers, which support it. sdk.js itself has no top-level await
  // (scripts/package-brickwright-sdk.mjs checks).
  esbuild:{supported:{'top-level-await':true}},
});
