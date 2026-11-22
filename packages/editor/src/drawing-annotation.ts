// SPDX-License-Identifier: BSD-3-Clause
import type {DrawingAnnotation,SketchPoint} from '@brickwright/cad-core';

export type DrawingAnchorPoint = {id:string; label:string; point:SketchPoint; radius?:number};
export const dimensionText=(value:number)=>String(Number(value.toFixed(3)));

export function placeDrawingAnnotation(
 annotation:DrawingAnnotation,sketchId:string,anchors:DrawingAnchorPoint[],factor:number
) {
 if(annotation.sketchId!==sketchId)return undefined;
 const first=anchors.find(anchor=>anchor.id===annotation.from);
 if(!first)return undefined;
 const [x,y]=annotation.at,[ax,ay]=first.point;
 const paths:SketchPoint[][]=[];
 if(annotation.kind==='diameter'){
  if(first.radius===undefined)return undefined;
  const r=first.radius*factor,dx=x-ax,dy=y-ay,length=Math.hypot(dx,dy);
  const start:SketchPoint=length>1e-8?[ax+r*dx/length,ay+r*dy/length]:[ax+r,ay];
  paths.push([start,[x,y],[x+6,y]]);
  return {paths,text:'Ø'+dimensionText(2*first.radius)+' mm',position:[x+1,y+1.5] as SketchPoint};
 }
 const second=anchors.find(anchor=>anchor.id===annotation.to);
 if(!second)return undefined;
 const [bx,by]=second.point;
 const horizontal=annotation.kind==='linear-x';
 const a=horizontal?ax:ay,b=horizontal?bx:by;
 const distance=Math.abs(a-b)/factor;
 if(distance<1e-7)return undefined;
 if(horizontal){
  paths.push([[ax,ay],[ax,y]],[[bx,by],[bx,y]],[[Math.min(a,b,x),y],[Math.max(a,b,x),y]]);
  for(const value of [a,b])paths.push([[value-.9,y-.9],[value+.9,y+.9]]);
 }else{
  paths.push([[ax,ay],[x,ay]],[[bx,by],[x,by]],[[x,Math.min(a,b,y)],[x,Math.max(a,b,y)]]);
  for(const value of [a,b])paths.push([[x-.9,value-.9],[x+.9,value+.9]]);
 }
 return {paths,text:dimensionText(distance)+' mm',position:[x+1.6,y+1.6] as SketchPoint};
}
