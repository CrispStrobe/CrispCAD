// SPDX-License-Identifier: BSD-3-Clause
import {isSketchPoint,t} from '@brickwright/cad-core';
import type {OutlineRule,SketchPoint} from '@brickwright/cad-core';

export type OutlineConstraint=OutlineRule<number,number>;
export type OutlineSolveRequest={points:SketchPoint[];constraints:OutlineConstraint[]};
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
 const edge=(index:number)=>{
  const start=points[index],end=points[(index+1)%count];
  const x=end[0]-start[0],y=end[1]-start[1];
  return {x,y,length:Math.hypot(x,y)};
 };
 // Verify the completed draft independently of the numeric solver.
 const satisfied=(constraint:OutlineConstraint)=>{
  const a=edge(constraint.edge),tol=1e-6;
  switch(constraint.kind){
   case 'horizontal':return Math.abs(a.y)<=tol;
   case 'vertical':return Math.abs(a.x)<=tol;
   case 'length':return Math.abs(a.length-constraint.length)<=tol;
   default:{
    const b=edge(constraint.other);
    if(constraint.kind==='equal')return Math.abs(a.length-b.length)<=tol;
    const norm=a.length*b.length;
    if(norm<=tol*tol)return false;
    const residual=constraint.kind==='parallel'?a.x*b.y-a.y*b.x:a.x*b.x+a.y*b.y;
    return Math.abs(residual/norm)<=tol;
   }
  }
 };
 if(!request.constraints.every(satisfied))throw new Error(t('The solved outline did not meet every constraint.'));
 return {points,degrees};
}

export function solveOutline(request:OutlineSolveRequest,signal:AbortSignal):Promise<OutlineSolveResult>{
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
  try{worker.postMessage(request);}
  catch(error){finish();reject(error);}
 });
}
