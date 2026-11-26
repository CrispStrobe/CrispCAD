// SPDX-License-Identifier: BSD-3-Clause
// A ceiling for the exact kernel's WebAssembly memory.
//
// smlibwasm defines (and exports) its own linear memory: 64 MiB initially, growable to 4 GiB. A
// host cannot hand it a smaller Memory, and the loader takes no maximum. The maximum is one LEB128
// number in the module's memory section, though, so it can be lowered in the bytes before they are
// compiled. Emscripten's heap growth then fails softly at the ceiling (`memory.grow` throws, its
// resize handler catches that and malloc returns null), and the kernel call fails with an error
// instead of growing until a tablet's browser kills the tab. After such a failure the kernel's
// state is not trusted: the editor's exact worker is discarded and the next job starts a new one.
//
// The bytes reach WebAssembly through `WebAssembly.instantiateStreaming` (browsers) or
// `WebAssembly.instantiate` (Node, and browsers when streaming fails); both are wrapped while the
// kernel loads, and only a module whose memory may grow beyond the ceiling is rewritten.

const WASM_PAGE=65536;

/** Read an unsigned LEB128 at `at`; returns the value and the position after it. */
function leb(bytes:Uint8Array,at:number):[number,number]{
 let value=0,scale=1,byte;
 do{
  if(at>=bytes.length)throw new RangeError('truncated WebAssembly module');
  byte=bytes[at++];value+=(byte&127)*scale;scale*=128;
 }while(byte&128);
 return [value,at];
}

/**
 * A copy of the WebAssembly module `bytes` whose defined memory may grow to at most `maxBytes`
 * (rounded down to whole 64 KiB pages, never below the memory's initial size). Undefined when there
 * is nothing to lower: no memory section, an imported memory, a memory without a maximum (the
 * section would have to grow), or a maximum that is already at or below the ceiling.
 */
export function capWasmMemory(bytes:Uint8Array,maxBytes:number):Uint8Array|undefined{
 if(!(maxBytes>0)||!Number.isFinite(maxBytes))return undefined;
 if(bytes.length<8||bytes[0]!==0||bytes[1]!==0x61||bytes[2]!==0x73||bytes[3]!==0x6d)return undefined;
 let at=8;
 while(at<bytes.length){
  const id=bytes[at++];
  const [size,body]=leb(bytes,at);at=body;
  if(id!==5){at+=size;continue;}
  let [count,next]=leb(bytes,at);at=next;
  let copy:Uint8Array|undefined;
  for(let i=0;i<count;i++){
   const [flags,afterFlags]=leb(bytes,at);
   const [min,afterMin]=leb(bytes,afterFlags);at=afterMin;
   // Bit 0: has a maximum; bits 1 (shared) and 2 (memory64) are left alone: no maximum or a
   // 64-bit memory is not what smlibwasm ships, and rewriting either would change its size.
   if(!(flags&1)||flags&4)return undefined;
   const start=at,[max,end]=leb(bytes,at);at=end;
   const pages=Math.max(min,Math.floor(maxBytes/WASM_PAGE));
   if(pages>=max)continue;
   // Same width as the old number (LEB128 may carry padding bytes), so no offset moves.
   const width=end-start;
   if(pages>=2**(7*width))return undefined;
   copy??=new Uint8Array(bytes);
   let rest=pages;
   for(let j=0;j<width;j++){copy[start+j]=(rest&127)|(j<width-1?128:0);rest=Math.floor(rest/128);}
  }
  return copy;
 }
 return undefined;
}

type Source=BufferSource|WebAssembly.Module;
/**
 * Run `load` (which instantiates the kernel) with every WebAssembly module instantiated meanwhile
 * capped to `maxBytes` of memory. Returns whether a module was capped. Without a finite ceiling,
 * or where `WebAssembly` cannot be wrapped, `load` runs unchanged.
 */
export async function withWasmMemoryCap<T>(maxBytes:number|undefined,load:()=>Promise<T>):Promise<{value:T;capped:boolean}>{
 if(!maxBytes||!Number.isFinite(maxBytes)||typeof WebAssembly==='undefined')return {value:await load(),capped:false};
 const wasm=WebAssembly as unknown as {instantiate:(source:Source,imports?:WebAssembly.Imports)=>Promise<unknown>;instantiateStreaming?:(source:Response|PromiseLike<Response>,imports?:WebAssembly.Imports)=>Promise<unknown>};
 const instantiate=wasm.instantiate,streaming=wasm.instantiateStreaming;
 let capped=false;
 const capOf=(source:Source):Source=>{
  if(source instanceof WebAssembly.Module)return source;
  const view=source instanceof Uint8Array?source:ArrayBuffer.isView(source)?new Uint8Array(source.buffer,source.byteOffset,source.byteLength):new Uint8Array(source as ArrayBuffer);
  const lowered=capWasmMemory(view,maxBytes);
  if(lowered)capped=true;
  return lowered??source;
 };
 try{
  wasm.instantiate=function(source,imports){return instantiate.call(WebAssembly,capOf(source),imports);};
  // Streaming compiles while downloading; the rewrite needs the whole module first.
  if(streaming)wasm.instantiateStreaming=async function(source,imports){
   const response=await source;
   return instantiate.call(WebAssembly,capOf(new Uint8Array(await response.arrayBuffer())),imports);
  };
  const value=await load();
  return {value,capped};
 }finally{
  wasm.instantiate=instantiate;
  if(streaming)wasm.instantiateStreaming=streaming;
 }
}
