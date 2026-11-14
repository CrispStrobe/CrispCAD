// SPDX-License-Identifier: BSD-3-Clause
import type {Vec3} from './document.js';
/** Original linear-size mesh construction; explicit side diagonals preserve taper shape. */
export function ellipticFrustumMesh(start:readonly number[],end:readonly number[],height:number,segments:number):{points:Vec3[];faces:number[][]}{
 const points:Vec3[]=[],faces:number[][]=[];
 const ring=(r:readonly number[],z:number)=>{
  if(!r[0]&&!r[1]){const tip=points.length;points.push([0,0,z]);return {ids:Array(segments).fill(tip) as number[],center:tip,tip:true};}
  const ids=Array.from({length:segments},(_,i)=>{const angle=i*2*Math.PI/segments,id=points.length;points.push([r[0]*Math.cos(angle),r[1]*Math.sin(angle),z]);return id;});const center=points.length;points.push([0,0,z]);return {ids,center,tip:false};
 };
 const bottom=ring(start,-height/2),top=ring(end,height/2);
 for(let i=0;i<segments;i++){
  const next=(i+1)%segments,a=bottom.ids[i],b=bottom.ids[next],c=top.ids[i],d=top.ids[next];
  if(!bottom.tip){faces.push([bottom.center,b,a],[a,b,c]);}
  if(!top.tip){faces.push([top.center,c,d],[c,b,d]);}
 }
 return {points,faces};
}
