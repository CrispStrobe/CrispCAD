// SPDX-License-Identifier: BSD-3-Clause
// The optional exact kernel (@brickwright/cad-exact on @crispcad/exact-kernel) is a lazy chunk
// of the geometry worker. Emit every file that belongs to it under assets/exact/, so the service
// worker can leave it out of the eager offline precache and cache it on first use instead.
export const EXACT_ASSET_DIR='assets/exact/';
const exactModule=id=>/[\\/]@crispcad[\\/]exact-kernel[\\/]|[\\/]packages[\\/]exact[\\/]|[\\/]@brickwright[\\/]cad-exact[\\/]/.test(id);
const exactAsset=name=>/^(smlibwasm|_defeature_)/.test(name);
/** Worker output names: exact-kernel chunks, workers and the WebAssembly go to assets/exact/. */
export const exactKernelWorkerOutput={
  entryFileNames:chunk=>exactAsset(chunk.name)||chunk.moduleIds?.some(exactModule)?`${EXACT_ASSET_DIR}[name]-[hash].js`:'assets/[name]-[hash].js',
  chunkFileNames:chunk=>chunk.moduleIds.some(exactModule)?`${EXACT_ASSET_DIR}[name]-[hash].js`:'assets/[name]-[hash].js',
  assetFileNames:asset=>(asset.names??[asset.name]).some(name=>name&&exactAsset(name))?`${EXACT_ASSET_DIR}[name]-[hash][extname]`:'assets/[name]-[hash][extname]',
};
