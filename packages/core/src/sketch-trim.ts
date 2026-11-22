// SPDX-License-Identifier: BSD-3-Clause
import {evaluateSketch,resolveSketchPath} from './features.js';
import type {PlanarSketch,SketchProfile} from './features.js';
import type {SketchLoop} from './sketch-region.js';
import {newId} from './document.js';
import type {CadDocument} from './document.js';
import {isSketchPoint,sketchBulgeArc} from './sketch-outline.js';
import type {SketchPoint} from './sketch-outline.js';
import {t} from './i18n.js';

type Outline=Extract<SketchLoop,{kind:'outline'}>;
type Segment={a:SketchPoint;b:SketchPoint;bulge:number;keep:boolean};
const epsilon=1e-8;
const tau=2*Math.PI;

export function trimSketchProfile(sketch:PlanarSketch,context:Pick<CadDocument,'parametric'>,a:SketchPoint,b:SketchPoint,keep:'left'|'right'):SketchProfile{
 const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
 if(!isSketchPoint(a)||!isSketchPoint(b)||length<.00001)throw new Error(t('Choose two distinct trim points in the sketch.'));
 const ux=dx/length,uy=dy/length;
 const signed=([x,y]:SketchPoint)=>-uy*(x-a[0])+ux*(y-a[1]);
 const retained=(point:SketchPoint)=>(keep==='left'?1:-1)*signed(point)>=-epsilon;

 function split(start:SketchPoint,end:SketchPoint,bulge:number):Segment[]{
  const arc=sketchBulgeArc(start,end,bulge);
  let candidates:number[],at:(u:number)=>SketchPoint;
  if(arc){
   const {center,radius,start:angle,sweep}=arc;
   const height=signed(center);
   candidates=[];
   if(Math.abs(height)<=radius){
    const base:SketchPoint=[center[0]+uy*height,center[1]-ux*height];
    const half=Math.sqrt((radius-Math.abs(height))*(radius+Math.abs(height)));
    candidates=[-half,half].map(step=>{
     const contact=Math.atan2(base[1]+uy*step-center[1],base[0]+ux*step-center[0]);
     const turn=Math.sign(sweep)*(contact-angle);
     return ((turn%tau+tau)%tau)/Math.abs(sweep);
    });
   }
   at=u=>u===0?start:u===1?end:[center[0]+radius*Math.cos(angle+sweep*u),center[1]+radius*Math.sin(angle+sweep*u)];
   const cutArc=(u:number,v:number)=>Math.tan(sweep*(v-u)/4);
   const trimmed=segments(candidates,at,cutArc);
   if(trimmed.every(piece=>piece.keep===trimmed[0].keep))return [{a:start,b:end,bulge,keep:trimmed[0].keep}];
   return trimmed;
  }
  const first=signed(start),last=signed(end);
  candidates=first===last?[]:[first/(first-last)];
  at=u=>u===0?start:u===1?end:[start[0]+(end[0]-start[0])*u,start[1]+(end[1]-start[1])*u];
  return segments(candidates,at,()=>0);
 }

 function segments(candidates:number[],at:(u:number)=>SketchPoint,bulge:(u:number,v:number)=>number){
  const stops=[0,...candidates.filter(u=>u>epsilon&&u<1-epsilon).sort((u,v)=>u-v).filter((u,i,ordered)=>!i||u-ordered[i-1]>epsilon),1];
  return stops.slice(0,-1).map((u,i)=>{
   const v=stops[i+1];
   return {a:at(u),b:at(v),bulge:bulge(u,v),keep:retained(at((u+v)/2))};
  });
 }

 function pointsFrom(remaining:Segment[]){
  const points=[...remaining.map(piece=>piece.a),remaining.at(-1)!.b];
  const bulges=[...remaining.map(piece=>piece.bulge),0];
  return {points,bulges};
 }
 function cut(outline:Outline):Outline{
  const pieces=outline.points.flatMap((point,i)=>split(point,outline.points[(i+1)%outline.points.length],outline.bulges?.[i]??0));
  const discarded=pieces.findIndex(piece=>!piece.keep);
  if(discarded<0||!pieces.some(piece=>piece.keep))throw new Error(t('The trim line must cross the outside boundary.'));
  const ordered=[...pieces.slice(discarded+1),...pieces.slice(0,discarded+1)];
  const runs=ordered.filter((piece,i)=>piece.keep&&(i===0||!ordered[i-1].keep));
  if(runs.length!==1)throw new Error(t('This trim would cross the outside boundary more than twice. Choose a simpler cut.'));
  const {points,bulges}=pointsFrom(ordered.filter(piece=>piece.keep));
  const result={...outline,points};
  if(bulges.some(Boolean))result.bulges=bulges;
  else delete result.bulges;
  return result;
 }

 const before=evaluateSketch(sketch,context);
 const profile=sketch.profile;
 let result:SketchProfile;
 if(profile.kind==='path'){
  const vertices=resolveSketchPath(profile,context);
  const sourceIndices=new Map(vertices.map((point,index)=>[point,index]));
  const pieces=vertices.slice(0,-1).flatMap((point,i)=>split(point,vertices[i+1],profile.bulges?.[i]??0));
  const first=pieces.findIndex(piece=>piece.keep);
  if(first<0||pieces.every(piece=>piece.keep))throw new Error(t('The trim line must cross the open path.'));
  let last=pieces.length-1;
  while(!pieces[last].keep)last--;
  const remaining=pieces.slice(first,last+1);
  if(remaining.some(piece=>!piece.keep))throw new Error(t('This trim would leave separate paths. Choose a different line or side.'));
  const {points,bulges}=pointsFrom(remaining);
  result={...profile,points};
  if(profile.vertexIds&&profile.anchors){
   const {vertexIds}=profile;
   const retainedIds=points.map(point=>vertexIds[sourceIndices.get(point)??-1]??newId());
   const anchors=profile.anchors.filter(anchor=>retainedIds.includes(anchor.vertexId));
   if(anchors.length){
    result.vertexIds=retainedIds;
    result.anchors=anchors;
    result.points=points.map(point=>profile.points[sourceIndices.get(point)??-1]??point);
   }else{
    delete result.vertexIds;
    delete result.anchors;
   }
  }
  if(bulges.some(Boolean))result.bulges=bulges;
  else delete result.bulges;
 }else if(profile.kind==='outline')result=cut(profile);
 else if(profile.kind==='region'){
  const outside=before.loopIds![0],boundary=profile.loops.find(loop=>loop.id===outside);
  if(boundary?.kind!=='outline')throw new Error(t('Trim needs a polygon or arc outline as the outside boundary.'));
  result={...profile,loops:profile.loops.map(loop=>loop.id===outside?cut(boundary):loop)};
 }else throw new Error(t('Trim needs a polygon or arc outline as the outside boundary.'));
 const evaluated=evaluateSketch({...sketch,profile:result},context);
 if(before.loopIds?.[0]!==evaluated.loopIds?.[0])throw new Error(t('This trim changes which loop is the outside boundary.'));
 return result;
}
