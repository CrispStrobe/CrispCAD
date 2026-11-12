// SPDX-License-Identifier: BSD-3-Clause
import {sha256} from '@noble/hashes/sha2.js';
/** Same content addresses in browsers, native custom schemes and headless hosts. */
export async function sha256Hex(bytes:Uint8Array):Promise<string>{
 let digest:Uint8Array;
 if(globalThis.crypto?.subtle){try{digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource));}catch{digest=sha256(bytes);}}
 else digest=sha256(bytes);
 return Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');
}
