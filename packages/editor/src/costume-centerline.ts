// SPDX-License-Identifier: BSD-3-Clause
import {CubicBezierCurve,EllipseCurve,Vector2} from 'three';
import type {Curve} from 'three';
import {sketchBulgeArc} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';

const turn=2*Math.PI;
const forwardAngle=(angle:number)=>((angle%turn)+turn)%turn;

export function ellipseSweep(curve:EllipseCurve):number {
 const delta=curve.aEndAngle-curve.aStartAngle;
 if(Math.abs(delta)<Number.EPSILON)return 0;
 const forward=forwardAngle(delta);
 const span=forward<Number.EPSILON?turn:forward;
 return curve.aClockwise?(span===turn?-turn:span-turn):span;
}

/** Recover the circular sub-arcs explicitly authored by Costumes, including SVG rounding. */
function paperArcSweep(curve:CubicBezierCurve):number|undefined {
 const startTangent=curve.v1.clone().sub(curve.v0),endTangent=curve.v3.clone().sub(curve.v2);
 if(startTangent.length()<1e-7||endTangent.length()<1e-7)return undefined;
 const a=startTangent.clone().normalize(),b=endTangent.clone().normalize();
 const normalA=new Vector2(-a.y,a.x),normalB=new Vector2(-b.y,b.x);
 const det=normalA.cross(normalB);
 if(Math.abs(det)<1e-3)return undefined;
 const center=curve.v0.clone().addScaledVector(normalA,curve.v3.clone().sub(curve.v0).cross(normalB)/det);
 const start=curve.v0.clone().sub(center),end=curve.v3.clone().sub(center),radius=start.length();
 const sweep=Math.atan2(start.cross(end),start.dot(end));
 if(!Number.isFinite(radius)||radius<=0||Math.abs(sweep)>Math.PI/2+.001)return undefined;
 const rounding=Math.min(.00025,radius*.001);
 if(Math.abs(end.length()-radius)>rounding)return undefined;
 const multiplier=4*Math.tan(sweep/4)/3;
 const expected=(radial:Vector2)=>new Vector2(-radial.y,radial.x).multiplyScalar(multiplier);
 return startTangent.distanceTo(expected(start))<=rounding&&endTangent.distanceTo(expected(end))<=rounding?sweep:undefined;
}

export function costumeArcSweep(curve:Curve<Vector2>,fromPrecisionArc:boolean):number|undefined {
 if(curve instanceof EllipseCurve&&curve.xRadius>0&&Math.abs(curve.xRadius-curve.yRadius)<=curve.xRadius*1e-9){
  const sweep=ellipseSweep(curve);
  if(sweep&&Math.abs(sweep)<turn)return sweep;
 }
 if(fromPrecisionArc&&curve instanceof CubicBezierCurve)return paperArcSweep(curve);
 return undefined;
}

export function costumeCenterlinePreview(points:SketchPoint[],bulges?:number[]) {
 const extrema=[...points];
 let d='';
 for(let index=0;index<points.length;index++){
  const [x,y]=points[index];
  if(index===0){d=`M ${x} ${-y}`;continue;}
  const arc=bulges&&sketchBulgeArc(points[index-1],points[index],bulges[index-1]);
  if(!arc){d+=` L ${x} ${-y}`;continue;}
  const {center,radius,start,sweep}=arc;
  d+=` A ${radius} ${radius} 0 ${Math.abs(sweep)>Math.PI?1:0} ${sweep<0?1:0} ${x} ${-y}`;
  for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2]){
   const distance=forwardAngle((angle-start)*Math.sign(sweep));
   if(distance<=Math.abs(sweep))extrema.push([center[0]+radius*Math.cos(angle),center[1]+radius*Math.sin(angle)]);
  }
 }
 return {extrema,d};
}
