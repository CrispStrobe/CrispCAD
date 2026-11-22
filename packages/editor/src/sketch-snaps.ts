// SPDX-License-Identifier: BSD-3-Clause
import {evaluateSketch,featureValue,isSketchPoint,sketchBulgeArc} from '@brickwright/cad-core';
import type {CadDocument,PlanarSketch,SketchPoint} from '@brickwright/cad-core';

type Line = {kind:'line'; a:SketchPoint; b:SketchPoint};
type Circle = {kind:'circle'; center:SketchPoint; radius:number; start?:number; sweep?:number};
type Edge = Line | Circle;
export type SketchSnap = {point:SketchPoint; kind:'Endpoint'|'Midpoint'|'Center'|'Intersection'};
const subtract = ([x,y]:SketchPoint,[a,b]:SketchPoint):SketchPoint => [x-a,y-b];
const cross = ([x,y]:SketchPoint,[a,b]:SketchPoint) => x*b-y*a;
const dot = ([x,y]:SketchPoint,[a,b]:SketchPoint) => x*a+y*b;
const advance = ([x,y]:SketchPoint,[a,b]:SketchPoint,t:number):SketchPoint => [x+a*t,y+b*t];
const tau=2*Math.PI;
const epsilon=1e-8;

function onSweep(point:SketchPoint, circle:Circle) {
 const {start,sweep,center} = circle;
 if(start===undefined||sweep===undefined)return true;
 const [x,y]=subtract(point,center);
 const angle=Math.sign(sweep)*(Math.atan2(y,x)-start);
 const delta=(angle%tau+tau)%tau;
 return delta<=Math.abs(sweep)+epsilon||tau-delta<epsilon;
}

function intersectLines(first:Line,second:Line):SketchPoint[] {
 const v=subtract(first.b,first.a),w=subtract(second.b,second.a),offset=subtract(second.a,first.a);
 const det=cross(v,w);
 if(Math.abs(det)<epsilon)return [];
 const t=cross(offset,w)/det,u=cross(offset,v)/det;
 return t>=0&&t<=1&&u>=0&&u<=1?[advance(first.a,v,t)]:[];
}

function intersectLineCircle(line:Line,circle:Circle):SketchPoint[] {
 const offset=subtract(line.a,circle.center),v=subtract(line.b,line.a);
 const vv=dot(v,v),t=-dot(offset,v)/vv;
 const closest=advance(offset,v,t),remaining=circle.radius**2-dot(closest,closest);
 if(remaining<0)return [];
 const dt=Math.sqrt(remaining/vv);
 return [t-dt,t+dt].filter(t=>t>=0&&t<=1).map(t=>advance(line.a,v,t)).filter(p=>onSweep(p,circle));
}

function intersectCircles(first:Circle,second:Circle):SketchPoint[] {
 const offset=subtract(second.center,first.center),distance=Math.hypot(...offset);
 if(distance<epsilon||distance>first.radius+second.radius||distance<Math.abs(first.radius-second.radius))return [];
 const along=(distance**2+first.radius**2-second.radius**2)/(2*distance);
 const h=Math.sqrt(Math.max(0,first.radius**2-along**2));
 const unit:SketchPoint=[offset[0]/distance,offset[1]/distance],perpendicular:SketchPoint=[-unit[1],unit[0]];
 const base=advance(first.center,unit,along);
 return [-h,h].map(t=>advance(base,perpendicular,t)).filter(p=>onSweep(p,first)&&onSweep(p,second));
}

function intersections(first:Edge,second:Edge) {
 if(first.kind==='line')return second.kind==='line'?intersectLines(first,second):intersectLineCircle(first,second);
 return second.kind==='line'?intersectLineCircle(second,first):intersectCircles(first,second);
}

export function sketchSnapReference(sketch:PlanarSketch, doc:CadDocument) {
 const {contour,holes=[]}=evaluateSketch(sketch,doc);
 const points:SketchSnap[]=[], edges:Edge[]=[];
 const addLoop=(vertices:SketchPoint[],bulges?:number[])=>vertices.forEach((a,i)=>{
  const b=vertices[(i+1)%vertices.length];
  points.push({kind:'Endpoint',point:a});
  const arc=sketchBulgeArc(a,b,bulges?.[i]??0);
  if(arc){
   const mid=arc.start+arc.sweep/2;
   points.push({kind:'Midpoint',point:advance(arc.center,[Math.cos(mid),Math.sin(mid)],arc.radius)});
   points.push({kind:'Center',point:arc.center});
   edges.push({kind:'circle',...arc});
  }else{
   points.push({kind:'Midpoint',point:advance(a,subtract(b,a),.5)});
   edges.push({kind:'line',a,b});
  }
 });
 const addCircle=(center:SketchPoint,radius:number)=>{
  points.push({kind:'Center',point:center});
  edges.push({kind:'circle',center,radius});
 };
 const profile=sketch.profile;
 if(profile.kind==='rectangle')addLoop(contour);
 if(profile.kind==='outline')addLoop(profile.points,profile.bulges);
 if(profile.kind==='circle')addCircle(profile.center??[0,0],featureValue(profile.radius,doc));
 if(profile.kind==='region')for(const loop of profile.loops){
  if(loop.kind==='outline')addLoop(loop.points,loop.bulges);
  else addCircle([featureValue(loop.center[0],doc),featureValue(loop.center[1],doc)],featureValue(loop.radius,doc));
 }
 return {contours:[contour,...holes],points,edges};
}

type Reference = ReturnType<typeof sketchSnapReference>;

export function collectSketchSnaps(first?:Reference,second?:Reference):SketchSnap[] {
 const points=[...(first?.points??[]),...(second?.points??[])];
 if(first&&second)for(const a of first.edges)for(const b of second.edges){
  for(const point of intersections(a,b))points.push({kind:'Intersection',point});
 }
 // Very shallow arcs can have centers outside the supported sketch plane.
 return points.filter(({point})=>isSketchPoint(point)).sort((a,b)=>a.point[0]-b.point[0]);
}

export function nearestSketchSnap(point:SketchPoint, targets:SketchSnap[], tolerance:number) {
 let best:SketchSnap|undefined, distance=tolerance**2;
 // The collector sorts by X so long imported outlines stay cheap to drag.
 let left=0,right=targets.length;
 while(left<right){
  const mid=(left+right)>>>1;
  if(targets[mid].point[0]<point[0]-tolerance)left=mid+1;else right=mid;
 }
 for(let i=left;i<targets.length&&targets[i].point[0]<=point[0]+tolerance;i++){
  const target=targets[i];
  const delta=subtract(point,target.point),d=dot(delta,delta);
  if(d<distance||(d===distance&&best&&target.kind==='Intersection')){best=target;distance=d;}
 }
 return best;
}
