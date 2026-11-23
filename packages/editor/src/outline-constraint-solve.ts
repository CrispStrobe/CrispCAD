// SPDX-License-Identifier: BSD-3-Clause
import {isSketchPoint,outlineSatisfiesRelations,t} from '@brickwright/cad-core';
import type {OutlineRule,OutlineSolveRequest,SketchPoint} from '@brickwright/cad-core';
export type {OutlineSolveRequest} from '@brickwright/cad-core';

export type OutlineConstraint=OutlineRule<number,number>;
export type OutlineDragTarget={index:number;point:SketchPoint};
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

export function solveOutline(request:OutlineSolveRequest,signal:AbortSignal,target?:OutlineDragTarget):Promise<OutlineSolveResult>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(signal.reason);return;}
  const worker=new Worker(new URL('./outline-constraints.worker.js',import.meta.url),{type:'module'});
  const finish=()=>{
   clearTimeout(timer);
   signal.removeEventListener('abort',abort);
   worker.terminate();
  };
  const abort=()=>{finish();reject(signal.reason);};
  const timer=setTimeout(()=>{
   finish();reject(new Error(t('The outline solve took too long. Try fewer constraints.')));
  },10000);
  signal.addEventListener('abort',abort,{once:true});
  worker.onerror=worker.onmessageerror=()=>{
   finish();reject(new Error(t('Could not load the outline constraint solver.')));
  };
  worker.onmessage=({data}:MessageEvent<unknown>)=>{
   finish();
   try{resolve(verifyOutlineSolve(request,data));}
   catch(error){reject(error);}
  };
  try{worker.postMessage(target?{...request,target}:request);}
  catch(error){finish();reject(error);}
 });
}

export async function solveOutlinePoints(request:OutlineSolveRequest,signal:AbortSignal):Promise<SketchPoint[]>{
 return (await solveOutline(request,signal)).points;
}
