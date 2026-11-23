// SPDX-License-Identifier: BSD-3-Clause
import {sha256} from '@noble/hashes/sha2.js';
/** Same content addresses in browsers, native custom schemes and headless hosts. */
export async function sha256Hex(bytes:Uint8Array):Promise<string>{
 let digest:Uint8Array;
 if(globalThis.crypto?.subtle){try{digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource));}catch{digest=sha256(bytes);}}
 else digest=sha256(bytes);
 return Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');
}

/** Compact geometry lookup key. Callers still review the geometry before applying changes. */
export function geometrySignature(source:string):string {
 let a=2166136261,b=3339675911;
 for(let i=0;i<source.length;i++){
  const code=source.charCodeAt(i);
  a=Math.imul(a^code,16777619);
  b=Math.imul(b^code,2246822519);
 }
 return `${source.length}:${a>>>0}:${b>>>0}`;
}
