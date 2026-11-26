// SPDX-License-Identifier: BSD-3-Clause
// The optional exact kernel (@brickwright/cad-exact on @crispcad/exact-kernel) is a lazy chunk
// of the geometry worker. Emit every file that belongs to it under assets/exact/, so the service
// worker can leave it out of the eager offline precache and cache it on first use instead.
import {transformWithEsbuild} from 'vite';
export const EXACT_ASSET_DIR='assets/exact/';
const exactModule=id=>/[\\/]@crispcad[\\/]exact-kernel[\\/]|[\\/]packages[\\/]exact[\\/]|[\\/]@brickwright[\\/]cad-exact[\\/]/.test(id);
const exactAsset=name=>/^(smlibwasm|_defeature_)/.test(name);
/** Worker output names: exact-kernel chunks, workers and the WebAssembly go to assets/exact/. */
export const exactKernelWorkerOutput={
  entryFileNames:chunk=>exactAsset(chunk.name)||chunk.moduleIds?.some(exactModule)?`${EXACT_ASSET_DIR}[name]-[hash].js`:'assets/[name]-[hash].js',
  chunkFileNames:chunk=>chunk.moduleIds.some(exactModule)?`${EXACT_ASSET_DIR}[name]-[hash].js`:'assets/[name]-[hash].js',
  assetFileNames:asset=>(asset.names??[asset.name]).some(name=>name&&exactAsset(name))?`${EXACT_ASSET_DIR}[name]-[hash][extname]`:'assets/[name]-[hash][extname]',
};

/**
 * Vite's library mode inlines every `new URL('x.wasm', import.meta.url)` asset as a base64 data
 * URL, whatever `assetsInlineLimit` says: the SDK build put the 9.4 MB smlibwasm.wasm into two
 * exact chunks (~26 MB). Marking those references `?no-inline` makes Vite emit the file instead
 * (still routed by exactKernelWorkerOutput, so smlibwasm lands under assets/exact/) and leave a
 * URL relative to the referencing chunk, which works when a host serves the SDK from a sub-path.
 * The kernel fetches it only when it initialises, i.e. on the first exact command.
 */
export function emitWasmFiles(){
  const wasmURL=/\bnew\s+URL\s*\(\s*(['"])([^'"?#]+\.wasm)\1\s*,\s*import\.meta\.url\s*\)/g;
  return {
    name:'crispcad:emit-wasm-files',enforce:'pre',apply:'build',
    transform(code,id){
      if(!code.includes('.wasm')||!code.includes('import.meta.url'))return null;
      let changed=false;
      const next=code.replace(wasmURL,(_,quote,file)=>{changed=true;return `new URL(${quote}${file}?no-inline${quote}, import.meta.url)`;});
      return changed?{code:next,map:null}:null;
    },
  };
}

/**
 * Keep the function names of @crispcad/exact-kernel's bundled modules through minification. Since
 * 0.1.6 the kernel holds a memory ceiling (`maxMemoryBytes`) by wrapping smlibwasm's Emscripten
 * `_emscripten_resize_heap` import, which it finds by the function's `name` (the import keys are
 * minified). A minified build renamed it, and the kernel then refused to load with a ceiling
 * ("the loader has no _emscripten_resize_heap import"); every exact job in the browser failed.
 */
export function preserveExactKernelNames(){
  return {
    name:'crispcad:preserve-exact-kernel-names',enforce:'pre',
    transform(code,id){
      if(!/[\\/]@crispcad[\\/]exact-kernel[\\/]dist[\\/][^\\/?]+\.js$/.test(id.split('?')[0]))return null;
      return transformWithEsbuild(code,id,{loader:'js',target:'esnext',keepNames:true});
    },
  };
}
