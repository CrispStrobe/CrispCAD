// SPDX-License-Identifier: BSD-3-Clause
// Detects WebAssembly embedded in a JavaScript chunk as base64 (a `data:application/wasm` URL or any
// long base64 run starting with the `\0asm` magic, "AGFzbQ"). Used by package-brickwright-sdk.mjs.
export const INLINE_WASM_LIMIT=64*1024;
/** Descriptions of every inline WebAssembly payload of at least `limit` base64 characters. */
export function findInlineWasm(code,limit=INLINE_WASM_LIMIT){
 const hits=[];
 for(const match of code.matchAll(/(data:application\/wasm;base64,)?AGFzbQ[A-Za-z0-9+/]*={0,2}/g)){
  if(match[0].length>=limit||match[1])hits.push(`${match[1]?'data:application/wasm URL':'base64 WebAssembly'} of ${(match[0].length/1048576).toFixed(1)} MiB at offset ${match.index}`);
 }
 return hits;
}
