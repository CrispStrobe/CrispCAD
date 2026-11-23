// SPDX-License-Identifier: BSD-3-Clause
import {decodeSketchDwg} from './decode-sketch-dwg.js';
import {encodeSketchDwg} from './encode-sketch-dwg.js';
import type {SketchExchange} from './sketch-exchange.js';

export type SketchDwgRequest={kind:'read';bytes:ArrayBuffer}|{kind:'write';drawing:SketchExchange};
export type SketchDwgResponse={kind:'read';text:string}|{kind:'write';bytes:ArrayBuffer}|{kind:'error'};

self.onmessage=({data}:MessageEvent<SketchDwgRequest>)=>{
 try{
  if(data.kind==='read'){
   self.postMessage({kind:'read',text:decodeSketchDwg(data.bytes)} satisfies SketchDwgResponse);
  }else{
   const bytes=encodeSketchDwg(data.drawing);
   self.postMessage({kind:'write',bytes} satisfies SketchDwgResponse,{transfer:[bytes]});
  }
 }catch{self.postMessage({kind:'error'} satisfies SketchDwgResponse);}
};
