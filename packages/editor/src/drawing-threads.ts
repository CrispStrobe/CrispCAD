// SPDX-License-Identifier: BSD-3-Clause
// Cosmetic threads of standard tapped holes (document version 47) on an exact assembly sheet, drawn
// the ISO 6410-1 way: seen along its axis, the thread's major diameter is a thin continuous circle
// of about three quarters (open in the upper right quadrant, ends clear of the centre lines) around
// the tap drill's circle, dashed where the drill's rim is hidden; seen from the side, the internal
// thread is hidden, so its major diameter is two thin dashed lines along the thread and, for a
// blind hole, a dashed line across where the thread ends. The thread runs the depth of the hole (the
// node stores no separate thread length). The hole's place comes from its node (`nodeWorldFrame`);
// end-on, the drill circle must be one the exact projection drew, so a hole the B-rep does not have
// (or a body drawn from its mesh) gets no thread circle. Holes inside a pattern or mirror are left
// out, as their callouts are.
import {THREADS,nodeWorldFrame} from '@brickwright/cad-core';
import type {CadDocument,HoleFeature,SketchPoint,Vec3} from '@brickwright/cad-core';
import {drawingViews} from './drawing-page.js';
import type {DrawingLayout} from './drawing-page.js';
import type {ExactAssemblyProjection} from './exact-drawing-projection.js';

/** The 3/4 circle: from 95° counter-clockwise to 355° (the gap in the upper right quadrant). */
export const THREAD_ARC={start:95*Math.PI/180,sweep:260*Math.PI/180};

type Placement=readonly (readonly [unknown,number,number])[];

/** Nodes inside each drawn body (inputs of combinations, sources of features). */
function drawnNodes(doc:CadDocument,bodies:readonly string[]){
 const seen=new Set<string>(),stack=[...bodies];
 while(stack.length){
  const id=stack.pop()!;
  if(seen.has(id)||!doc.nodes[id])continue;
  seen.add(id);
  const node=doc.nodes[id] as {inputs?:string[];source?:string};
  if(Array.isArray(node.inputs))stack.push(...node.inputs);
  if(typeof node.source==='string')stack.push(node.source);
 }
 return seen;
}

/** Add the cosmetic threads of tapped standard holes; returns how many holes got thread lines. */
export function addThreadSymbols(page:DrawingLayout,doc:CadDocument,projection:ExactAssemblyProjection,placements:Placement,factor:number,hiddenLines:boolean):number{
 const inside=drawnNodes(doc,projection.exact.exactBodies),{origin}=projection;
 let threaded=0;
 for(const node of Object.values(doc.nodes)){
  if(node.kind!=='hole'||!inside.has(node.id))continue;
  const hole=node as unknown as HoleFeature&{id:string};
  if(hole.standard.type!=='tapped')continue;
  let mouth:Vec3,axis:Vec3;
  try{
   const frame=nodeWorldFrame(doc,node.id),m=frame.rotation;
   mouth=frame.origin;axis=[-m[2],-m[5],-m[8]];
  }catch{continue;}
  const major=THREADS[hole.standard.thread].nominal/2,length=hole.depth;
  let drawn=false;
  for(const [view,[,left,bottom]] of placements.entries()){
   const {horizontal,vertical,depth}=drawingViews[view];
   const paper=(p:readonly number[]):SketchPoint=>[left+(p[horizontal]-origin[horizontal])*factor,bottom+(p[vertical]-origin[vertical])*factor];
   if(Math.abs(Math.abs(axis[depth])-1)<1e-9){
    // End-on: around the drill circle the projection drew at this centre.
    const u=mouth[horizontal]-origin[horizontal],v=mouth[vertical]-origin[vertical];
    const rim=projection.holes[view]?.find(h=>Math.hypot(h.center[0]-u,h.center[1]-v)<1e-6&&Math.abs(h.radius-hole.diameter/2)<1e-6);
    if(!rim||(!rim.visible&&!hiddenLines))continue;
    page.circles.push({center:paper(mouth),radius:major*factor,arc:{...THREAD_ARC},thin:true,...(rim.visible?{}:{hidden:true as const})});
    drawn=true;
   }else if(Math.abs(axis[depth])<1e-9&&hiddenLines){
    // From the side: hidden major-diameter lines along the thread, and across its end when blind.
    const along:SketchPoint=[axis[horizontal],axis[vertical]],across:SketchPoint=[-along[1],along[0]];
    const start=paper(mouth),end:SketchPoint=[start[0]+along[0]*length*factor,start[1]+along[1]*length*factor];
    const offset=(p:SketchPoint,side:number):SketchPoint=>[p[0]+across[0]*major*factor*side,p[1]+across[1]*major*factor*side];
    for(const side of [-1,1])page.paths.push({stroke:'hidden',points:[offset(start,side),offset(end,side)]});
    if(!hole.through)page.paths.push({stroke:'hidden',points:[offset(end,-1),offset(end,1)]});
    drawn=true;
   }
  }
  if(drawn)threaded++;
 }
 return threaded;
}
