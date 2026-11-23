// SPDX-License-Identifier: BSD-3-Clause
import {Vector2} from 'three';
import {maxSketchOutlinePoints,t} from '@brickwright/cad-core';

export type CostumeStroke = {
 width:number;
 cap:'butt'|'round'|'square';
 join:'miter'|'round'|'bevel';
 miterLimit:number;
};

const normal=(direction:Vector2,length:number)=>new Vector2(-direction.y,direction.x).multiplyScalar(length);
const tooComplex=()=>new Error(t('This stroke overlaps itself or is too wide for its outline.'));
const angleStep=Math.PI/8;
function arc(center:Vector2,offset:Vector2,sweep:number,includeEnds:boolean):Vector2[] {
 const count=Math.ceil(Math.abs(sweep)/angleStep);
 return Array.from({length:includeEnds?count+1:Math.max(0,count-1)},(_,index)=>{
  const angle=sweep*(index+(includeEnds?0:1))/count;
  return offset.clone().rotateAround(new Vector2(),angle).add(center);
 });
}

const signedArea=(points:Vector2[])=>points.reduce((area,point,index)=>
 area+point.clone().sub(points[0]).cross(points[(index+1)%points.length].clone().sub(points[0])),0)/2;
const inside=(point:Vector2,polygon:Vector2[])=>polygon.reduce((inside,a,i)=>{
 const b=polygon[(i+1)%polygon.length];
 return (a.y>point.y)!==(b.y>point.y)&&point.x<a.x+(point.y-a.y)*(b.x-a.x)/(b.y-a.y)?!inside:inside;
},false);
const distanceToSegment=(point:Vector2,a:Vector2,b:Vector2)=>{
 const direction=b.clone().sub(a);
 const fraction=Math.min(1,Math.max(0,point.clone().sub(a).dot(direction)/direction.lengthSq()));
 return point.distanceTo(a.clone().addScaledVector(direction,fraction));
};

/** Expands one continuous centerline. The resulting contours still need sketch topology validation. */
export function expandCostumeStroke(points:Vector2[],closed:boolean,style:CostumeStroke):Vector2[][] {
 const half=style.width/2;
 if(!Number.isFinite(half)||half<=0||points.length<(closed?3:2))throw tooComplex();
 const directions=points.slice(0,closed?undefined:-1).map((point,index)=>{
  const direction=points[(index+1)%points.length].clone().sub(point);
  if(!Number.isFinite(direction.lengthSq())||direction.lengthSq()<1e-14)throw tooComplex();
  return direction.normalize();
 });
 const offsetSide=(side:number)=>points.flatMap((point,index)=>{
  const incoming=directions[(index+directions.length-1)%directions.length],outgoing=directions[index];
  if(!closed&&(index===0||index===points.length-1)){
   const start=index===0,direction=start?outgoing:incoming;
   const corner=point.clone().add(normal(direction,side*half));
   if(style.cap==='square')corner.addScaledVector(direction,start?-half:half);
   return [corner];
  }
  const turn=incoming.cross(outgoing),dot=incoming.dot(outgoing);
  if(1+dot<1e-9)throw tooComplex();
  const from=normal(incoming,side*half),to=normal(outgoing,side*half);
  const miter=from.clone().add(to).multiplyScalar(1/(1+dot));
  if(Math.abs(turn)<1e-10||turn*side>0||style.join==='miter'&&miter.length()<=style.miterLimit*half)
   return [point.clone().add(miter)];
  if(style.join==='round')return arc(point,from,Math.atan2(turn,dot),true);
  return [point.clone().add(from),point.clone().add(to)];
 });
 const left=offsetSide(1),right=offsetSide(-1);
 if(closed){
  const [insideEdge,outsideEdge]=signedArea(points)>0?[left,right]:[right,left];
  if(insideEdge.some(point=>!inside(point,points)||points.some((start,index)=>
   distanceToSegment(point,start,points[(index+1)%points.length])<half*(1-1e-7))))throw tooComplex();
  return [outsideEdge,insideEdge];
 }
 const endCap=style.cap==='round'?arc(points.at(-1)!,normal(directions.at(-1)!,half),-Math.PI,false):[];
 const startCap=style.cap==='round'?arc(points[0],normal(directions[0],-half),-Math.PI,false):[];
 const outline=[...left,...endCap,...right.reverse(),...startCap];
 if(outline.length>maxSketchOutlinePoints)throw new Error(t('This outline has too many vertices.'));
 return [outline];
}
