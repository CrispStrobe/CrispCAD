// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {SketchPoint,Vec3} from '@brickwright/cad-core';

const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const delta=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const zero=(value:number)=>value===0?0:value;
const zAxis:Vec3=[0,0,1],yAxis:Vec3=[0,1,0],xAxis:Vec3=[1,0,0];
const unit=(vector:Vec3):Vec3=>{
 const length=Math.hypot(...vector);
 if(!length||!Number.isFinite(length))throw new Error(t('DXF extrusion directions must be finite and nonzero.'));
 return vector.map(value=>value/length) as Vec3;
};

export function dxfObjectPlane(normal:Vec3,elevation:number){
 const n=unit(normal);
 const x=unit(cross(Math.abs(n[0])<1/64&&Math.abs(n[1])<1/64?yAxis:zAxis,n));
 const y=cross(n,x);
 return {n,x,y,elevation};
}
export type DxfObjectPlane=ReturnType<typeof dxfObjectPlane>;

function linePlane(points:Vec3[]){
 const start=points[0];
 if(points.every(point=>Math.abs(point[2]-start[2])<=1e-6))return dxfObjectPlane(zAxis,start[2]);
 const directions=points.slice(1).map(point=>delta(point,start));
 const initial=directions.find(vector=>Math.hypot(...vector)>1e-6);
 if(!initial)return dxfObjectPlane(zAxis,start[2]);
 const axis=unit(initial);
 const normal=directions.map(direction=>cross(axis,direction)).find(vector=>Math.hypot(...vector)>1e-6);
 // Collinear guides leave one free rotation. Keep the normal as close to world Z as possible.
 const canonical=unit(normal??cross(axis,cross(Math.abs(axis[2])<.999?zAxis:xAxis,axis)));
 const largest=canonical.reduce((best,value,i)=>Math.abs(value)>Math.abs(canonical[best])?i:best,0);
 const oriented=canonical[largest]<0?canonical.map(value=>-value) as Vec3:canonical;
 return dxfObjectPlane(oriented,dot(oriented,start));
}

export function dxfSketchPlane(objects:DxfObjectPlane[],linePoints:Vec3[]){
 const plane=objects[0]??linePlane(linePoints);
 const {n,x,y,elevation}=plane;
 const nonplanar=()=>new Error(t('Select DXF entities on one plane. The selected geometry is not coplanar.'));
 const check=(offset:number,magnitude:number)=>{
  if(!Number.isFinite(offset)||Math.abs(offset)>Math.max(1e-6,16*Number.EPSILON*magnitude))throw nonplanar();
 };
 const project=(point:Vec3):SketchPoint=>{
  check(dot(n,point)-elevation,Math.hypot(...point));
  return [zero(dot(x,point)),zero(dot(y,point))];
 };
 const orient=(object:DxfObjectPlane)=>{
  const parallel=dot(n,object.n),normalOffset=object.elevation*Math.sign(parallel);
  if(Math.hypot(...cross(n,object.n))>1e-9)throw nonplanar();
  check(normalOffset-elevation,Math.max(Math.abs(normalOffset),Math.abs(elevation)));
  // Use the analytic in-plane rotation/reflection so the points and radii
  // are unaffected by a potentially large elevation.
  const xx=dot(x,object.x),xy=dot(x,object.y),yx=dot(y,object.x),yy=dot(y,object.y);
  return {project:object===plane?([u,v]:SketchPoint)=>[u,v] as SketchPoint:
   ([u,v]:SketchPoint):SketchPoint=>[zero(xx*u+xy*v),zero(yx*u+yy*v)],handedness:Math.sign(parallel)};
 };
 return {project,orient,unfolded:Math.abs(n[0])+Math.abs(n[1])>1e-9||n[2]<0||Math.abs(elevation)>1e-6};
}
