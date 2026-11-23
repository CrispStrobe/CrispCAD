// SPDX-License-Identifier: BSD-3-Clause
import {isSketchPoint,outlineSatisfiesRelations,t} from '@brickwright/cad-core';
import type {OutlineDragTarget,OutlineRule,OutlineSolveRequest,SketchPoint} from '@brickwright/cad-core';
export type {OutlineDragTarget,OutlineSolveRequest} from '@brickwright/cad-core';

export type OutlineConstraint=OutlineRule<number,number>;
export type OutlineSolveResult={points:SketchPoint[];degrees:number|null};

export function verifyOutlineSolve(request:OutlineSolveRequest,response:unknown):OutlineSolveResult{
 const result=response as {status?:string;points?:SketchPoint[];degrees?:number|null};
 if(result?.status==='unavailable')throw new Error(t('Could not load the outline constraint solver.'));
 if(result?.status!=='solved')throw new Error(t('Could not solve these outline constraints. Check dimensions and segment choices.'));
 const {points:raw,degrees}=result;
 const count=request.points.length;
 if(!Array.isArray(raw)||raw.length!==count||!raw.every(isSketchPoint)||
  degrees!==null&&(typeof degrees!=='number'||!Number.isInteger(degrees)||degrees<0||degrees>2*(count-1))||
  raw[0].some((value,axis)=>value!==request.points[0][axis])){
  throw new Error(t('The solver returned invalid outline points.'));
 }
 const points=raw.map(([x,y],index):SketchPoint=>index===0?[x,y]:[Number(x.toFixed(9))||0,Number(y.toFixed(9))||0]);
 if(!outlineSatisfiesRelations(request,points))throw new Error(t('The solved outline did not meet every constraint.'));
 return {points,degrees};
}

/** A gesture reuses one worker. Calls are sequential, including dependent region loops. */
export function openOutlineSolver(signal:AbortSignal){
 signal.throwIfAborted();
 const worker=new Worker(new URL('./outline-constraints.worker.js',import.meta.url),{type:'module'});
 let closed=false;
 let pending:{timer:ReturnType<typeof setTimeout>; request:OutlineSolveRequest;
  resolve:(result:OutlineSolveResult)=>void; reject:(reason:unknown)=>void}|undefined;
 const take=()=>{
  const result=pending;
  pending=undefined;
  if(result)clearTimeout(result.timer);
  return result;
 };
 const close=(reason:unknown=new DOMException('Solver closed','AbortError'))=>{
  if(closed)return;
  closed=true;
  signal.removeEventListener('abort',abort);
  worker.terminate();
  take()?.reject(reason);
 };
 const abort=()=>close(signal.reason);
 signal.addEventListener('abort',abort,{once:true});
 worker.onerror=worker.onmessageerror=()=>close(new Error(t('Could not load the outline constraint solver.')));
 worker.onmessage=({data}:MessageEvent<unknown>)=>{
  const call=take();
  if(!call)return;
  try{call.resolve(verifyOutlineSolve(call.request,data));}
  catch(error){call.reject(error);}
 };
 return {
  close,
  solve(request:OutlineSolveRequest,target?:OutlineDragTarget):Promise<OutlineSolveResult>{
   return new Promise((resolve,reject)=>{
    if(closed||pending){reject(new Error(t('Could not load the outline constraint solver.')));return;}
    const timer=setTimeout(()=>close(new Error(t('The outline solve took too long. Try fewer constraints.'))),10000);
    pending={timer,request,resolve,reject};
    try{worker.postMessage(target?{...request,target}:request);}
    catch(error){close(error);}
   });
  }
 };
}

export async function solveOutline(request:OutlineSolveRequest,signal:AbortSignal,target?:OutlineDragTarget):Promise<OutlineSolveResult>{
 const solver=openOutlineSolver(signal);
 try{return await solver.solve(request,target);}
 finally{solver.close();}
}

export async function solveOutlinePoints(request:OutlineSolveRequest,signal:AbortSignal,target?:OutlineDragTarget):Promise<SketchPoint[]>{
 return (await solveOutline(request,signal,target)).points;
}
