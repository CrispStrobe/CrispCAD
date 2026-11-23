// SPDX-License-Identifier: BSD-3-Clause
import type {SketchPoint} from '@brickwright/cad-core';

const frameIntervalMs=33;

/** Keep one solve in flight and drop intermediate pointer positions. */
export function scheduleSketchDragPreview<T>(
 solve:(point:SketchPoint,signal:AbortSignal)=>Promise<T>,
 render:(result:T|undefined)=>void,
){
 const controller=new AbortController();
 let queued:SketchPoint|undefined,running=false,timer:ReturnType<typeof setTimeout>|undefined;
 let nextFrame=0;
 function schedule(){
  if(!queued||running||timer!==undefined||controller.signal.aborted)return;
  timer=setTimeout(()=>{
   timer=undefined;
   if(controller.signal.aborted||!queued)return;
   const point=queued;
   queued=undefined;
   running=true;
   nextFrame=performance.now()+frameIntervalMs;
   void run(point);
  },Math.max(0,nextFrame-performance.now()));
 }
 async function run(point:SketchPoint){
  let result:T|undefined;
  try{result=await solve(point,controller.signal);}
  catch{/* Invalid candidates leave the underlying draft visible. */}
  finally{running=false;}
  if(controller.signal.aborted)return;
  render(result);
  schedule();
 }
 return {
  update(point:SketchPoint){queued=point;schedule();},
  close(){
   controller.abort();
   clearTimeout(timer);
   queued=undefined;
  }
 };
}
