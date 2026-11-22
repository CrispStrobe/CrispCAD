// SPDX-License-Identifier: BSD-3-Clause
import type {SketchPoint} from '@brickwright/cad-core';

export type SectionInterval = [number,number];
export type SectionContour = {points:SketchPoint[]; circle?:{center:SketchPoint;radius:number}};
const tolerance=1e-8;

/** Intersect a closed profile with a cut, retaining the material between voids. */
export function sectionMaterial(contours:SectionContour[],axis:0|1,cut:number):SectionInterval[]{
 const across=axis===0?1:0;
 const slice=({points,circle}:SectionContour,includeBoundary:boolean):SectionInterval[]=>{
  if(circle){
   const d=Math.abs(cut-circle.center[axis]);
   if(d>=circle.radius)return [];
   const span=Math.sqrt((circle.radius-d)*(circle.radius+d));
   return [[circle.center[across]-span,circle.center[across]+span]];
  }
  const crossings:number[]=[],coincident:SectionInterval[]=[];
  for(const [i,a] of points.entries()){
   const b=points[(i+1)%points.length],da=a[axis]-cut,db=b[axis]-cut;
   if(Math.abs(da)<=tolerance){
    crossings.push(a[across]);
    if(Math.abs(db)<=tolerance)coincident.push([Math.min(a[across],b[across]),Math.max(a[across],b[across])]);
   }
   if((da<-tolerance&&db>tolerance)||(da>tolerance&&db<-tolerance)){
    crossings.push(a[across]+(b[across]-a[across])*da/(da-db));
   }
  }
  crossings.sort((a,b)=>a-b);
  const spans:SectionInterval[]=[];
  for(let i=1;i<crossings.length;i++){
   const start=crossings[i-1],end=crossings[i];
   if(end-start<=tolerance)continue;
   const mid=(start+end)/2;
   const boundary=coincident.some(([left,right])=>mid>=left&&mid<=right);
   let inside=false;
   if(boundary)inside=includeBoundary;
   else for(const [j,a] of points.entries()){
    const b=points[(j+1)%points.length];
    if((a[axis]>cut)===(b[axis]>cut))continue;
    const crossing=a[across]+(b[across]-a[across])*(cut-a[axis])/(b[axis]-a[axis]);
    if(crossing>mid)inside=!inside;
   }
   if(inside){
    const previous=spans.at(-1);
    if(previous&&start-previous[1]<=tolerance)previous[1]=end;
    else spans.push([start,end]);
   }
  }
  return spans;
 };
 const [boundary,...holes]=contours;
 if(!boundary)return [];
 const material=slice(boundary,true);
 const voids=holes.flatMap(hole=>slice(hole,false)).sort((a,b)=>a[0]-b[0]);
 return material.flatMap(([start,end])=>{
  const runs:SectionInterval[]=[];
  let left=start;
  for(const [gapStart,gapEnd] of voids){
   if(gapEnd<=left+tolerance)continue;
   if(gapStart>=end-tolerance)break;
   if(gapStart>left+tolerance)runs.push([left,gapStart]);
   left=Math.max(left,gapEnd);
  }
  if(end>left+tolerance)runs.push([left,end]);
  return runs;
 });
}
