// SPDX-License-Identifier: BSD-3-Clause
import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({
  base:'./',
  build:{outDir:'dist/brickwright-sdk',emptyOutDir:true,target:'es2020',
    lib:{entry:resolve('apps/brickwright/sdk.ts'),formats:['es'],fileName:()=> 'sdk.js'},
    // Keep fonts as files rather than duplicating them into the worker and host.
    assetsInlineLimit:0,
  },
  worker:{format:'es'},
});
