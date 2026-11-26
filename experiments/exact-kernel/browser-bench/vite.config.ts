// SPDX-License-Identifier: BSD-3-Clause
// Builds the browser bench like the product: Vite emits the exact kernel's WebAssembly as a file.
import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 root:fileURLToPath(new URL('.',import.meta.url)),base:'./',logLevel:'warn',
 build:{outDir:process.env.EXACT_BENCH_OUT??fileURLToPath(new URL('../../../test-results/exact-bench-site',import.meta.url)),emptyOutDir:true,target:'es2022'},
 worker:{format:'es'},
});
