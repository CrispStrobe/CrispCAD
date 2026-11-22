// SPDX-License-Identifier: BSD-3-Clause
import {sketchBulgeArc,t} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';

type Point=SketchPoint;
type Arc={center:Point;radius:number;sweep:number};
type Edge={a:Point;b:Point;tangentA:Point;tangentB:Point;length:number;arc?:Arc};
type End={point:Point;parameter:number};
const tolerance=1e-7;
const tau=2*Math.PI;
const subtract=(a:Point,b:Point):Point=>[a[0]-b[0],a[1]-b[1]];
const add=(a:Point,b:Point):Point=>[a[0]+b[0],a[1]+b[1]];
const scale=([x,y]:Point,s:number):Point=>[x*s,y*s];
const dot=(a:Point,b:Point)=>a[0]*b[0]+a[1]*b[1];
const cross=(a:Point,b:Point)=>a[0]*b[1]-a[1]*b[0];
const left=([x,y]:Point):Point=>[-y,x];
const magnitude=(p:Point)=>Math.hypot(...p);
const invalid=()=>new Error(t('This curved offset collapses an edge or changes the outline topology. Try a smaller distance.'));

function signedArea(points:Point[],bulges:number[]){
 const origin=points[0];
 return points.reduce((sum,a,i)=>{
  const b=points[(i+1)%points.length],arc=sketchBulgeArc(a,b,bulges[i]);
  if(!arc)return sum+cross(subtract(a,origin),subtract(b,origin));
  const turn=arc.sweep;
  const segment=Math.abs(turn)<1e-4?turn**3/6:turn-Math.sin(turn);
  return sum+cross(subtract(a,origin),subtract(b,origin))+arc.radius**2*segment;
 },0)/2;
}

function shiftedEdge(a:Point,b:Point,bulge:number,distance:number):Edge{
 const arc=sketchBulgeArc(a,b,bulge);
 if(!arc){
  const vector=subtract(b,a),length=magnitude(vector),tangent=scale(vector,1/length);
  const shift=scale(left(tangent),-distance);
  return {a:add(a,shift),b:add(b,shift),tangentA:tangent,tangentB:tangent,length};
 }
 const {center,radius:original,sweep}=arc,sign=Math.sign(sweep),radius=original+sign*distance;
 if(radius<.00001)throw invalid();
 const radialA=scale(subtract(a,center),1/original),radialB=scale(subtract(b,center),1/original);
 return {a:add(a,scale(radialA,sign*distance)),b:add(b,scale(radialB,sign*distance)),
  tangentA:scale(left(radialA),sign),tangentB:scale(left(radialB),sign),
  length:radius*Math.abs(sweep),arc:{center,radius,sweep}};
}

function lineCircle(line:Edge,circle:Arc):Point[]{
 const toCenter=subtract(circle.center,line.a),along=dot(toCenter,line.tangentA),off=cross(line.tangentA,toCenter);
 const distance=Math.abs(off);
 if(distance>circle.radius+tolerance)return [];
 const base=add(line.a,scale(line.tangentA,along));
 const delta=Math.sqrt(Math.max(0,(circle.radius-distance)*(circle.radius+distance)));
 return [-delta,delta].map(d=>add(base,scale(line.tangentA,d)));
}
function circleCircle(a:Arc,b:Arc):Point[]{
 const delta=subtract(b.center,a.center),distance=magnitude(delta);
 if(distance<tolerance||distance>a.radius+b.radius+tolerance||distance<Math.abs(a.radius-b.radius)-tolerance)return [];
 const unit=scale(delta,1/distance);
 const along=((a.radius-b.radius)*(a.radius+b.radius)+distance**2)/(2*distance);
 const cut=add(a.center,scale(unit,along));
 const height=Math.sqrt(Math.max(0,(a.radius-along)*(a.radius+along)));
 return [-height,height].map(d=>add(cut,scale(left(unit),d)));
}
function intersections(a:Edge,b:Edge):Point[]{
 if(a.arc&&b.arc)return circleCircle(a.arc,b.arc);
 if(a.arc)return lineCircle(b,a.arc);
 if(b.arc)return lineCircle(a,b.arc);
 const det=cross(a.tangentA,b.tangentA);
 if(Math.abs(det)<tolerance)return [];
 return [add(a.a,scale(a.tangentA,cross(subtract(b.a,a.a),b.tangentA)/det))];
}

function parameter(edge:Edge,point:Point){
 if(magnitude(subtract(point,edge.a))<=tolerance)return 0;
 if(magnitude(subtract(point,edge.b))<=tolerance)return 1;
 if(!edge.arc)return dot(subtract(point,edge.a),edge.tangentA)/edge.length;
 const {center,sweep}=edge.arc;
 const origin=subtract(edge.a,center),target=subtract(point,center);
 const angle=Math.atan2(cross(origin,target),dot(origin,target))*Math.sign(sweep);
 return ((angle%tau+tau)%tau)/Math.abs(sweep);
}

/** Offset finite circular/straight supports. Rounded corners use the original
 * vertex as their center; inward corners trim adjacent shifted supports. */
export function offsetCurvedOutline(points:Point[],bulges:number[],distance:number){
 const area=signedArea(points,bulges),winding=Math.sign(area),shift=distance*winding;
 const edges=points.map((point,i)=>shiftedEdge(point,points[(i+1)%points.length],bulges[i],shift));
 const starts:End[]=edges.map(edge=>({point:edge.a,parameter:0}));
 const ends:End[]=edges.map(edge=>({point:edge.b,parameter:1}));
 const joins=edges.map((edge,i)=>{
  const j=(i+1)%edges.length,next=edges[j];
  if(magnitude(subtract(edge.b,next.a))<=tolerance){
   starts[j].point=ends[i].point=scale(add(edge.b,next.a),.5);
   return 0;
  }
  const turn=Math.atan2(cross(edge.tangentB,next.tangentA),dot(edge.tangentB,next.tangentA));
  if(turn*shift>0)return Math.tan(turn/4);

  const candidates=intersections(edge,next).map(point=>{
   const u=parameter(edge,point),v=parameter(next,point);
   return {point,u,v,removed:(1-u)*edge.length+v*next.length};
  }).filter(({u,v})=>u>=0&&u<=1&&v>=0&&v<=1).sort((a,b)=>a.removed-b.removed);
  const join=candidates[0];
  if(!join)throw invalid();
  ends[i]={point:join.point,parameter:join.u};
  starts[j]={point:join.point,parameter:join.v};
  return 0;
 });
 const result={points:[] as Point[],bulges:[] as number[]};
 for(const [i,edge] of edges.entries()){
  const fraction=ends[i].parameter-starts[i].parameter;
  if(fraction*edge.length<.00001)throw invalid();
  result.points.push(starts[i].point);
  result.bulges.push(edge.arc?Math.tan(edge.arc.sweep*fraction/4):0);
  if(joins[i]){
   result.points.push(ends[i].point);
   result.bulges.push(joins[i]);
  }
 }
 const after=signedArea(result.points,result.bulges);
 if(Math.sign(after)!==winding||(Math.abs(after)-Math.abs(area))*distance<=0)throw invalid();
 return result;
}
