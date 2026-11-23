// SPDX-License-Identifier: BSD-3-Clause
import {decodeSketchDwg} from './decode-sketch-dwg.js';

self.onmessage=({data}:MessageEvent<ArrayBuffer>)=>{
 try{self.postMessage({text:decodeSketchDwg(data)});}
 catch{self.postMessage({error:true});}
};
