// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import type {Vec3} from './document.js';

/** Matching, simple XY rings, connected in authored vertex order. No resampling. */
export function loftPolyhedron(input:readonly (readonly Vec3[])[]):{points:Vec3[];faces:number[][]}{
 const invalid=()=>{throw new Error(t('Loft needs matching planar XY sections ordered along Z'));};
 const topology=()=>{throw new Error(t('Loft sections must be simple and have consistent winding'));};
 const count=input[0]?.length??0;
 if(input.length<2||count<3||input.some(r=>r.length!==count))invalid();
 const sections=input.map(r=>r.map(p=>[...p] as Vec3));let winding=0,pairs=0;
 for(const ring of sections){
  if(ring.some(p=>p.length!==3||p.some(n=>!Number.isFinite(n)||Math.abs(n)>100000)))invalid();
  const extent=Math.max(1,...ring.flatMap(p=>p.map((v,i)=>Math.abs(v-ring[0][i])))),eps=extent*extent*1e-12;
  if(ring.some(p=>Math.abs(p[2]-ring[0][2])>extent*1e-9))invalid();
  const origin=ring[0],area=ring.reduce((sum,p,i)=>{const q=ring[(i+1)%count];return sum+(p[0]-origin[0])*(q[1]-origin[1])-(q[0]-origin[0])*(p[1]-origin[1]);},0);
  if(Math.abs(area)<=eps||winding&&Math.sign(area)!==winding)topology();winding=Math.sign(area);
  const cross=(a:Vec3,b:Vec3,c:Vec3)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<count;i++){
   const a=ring[i],b=ring[(i+1)%count];if(Math.hypot(a[0]-b[0],a[1]-b[1])<extent*1e-10)topology();
   for(let j=i+2;j<count;j++){
    if(i===0&&j===count-1)continue;if(++pairs>131072)throw new Error(t('Loft exceeds the section or vertex budget'));
    const c=ring[j],d=ring[(j+1)%count],overlap=[0,1].every(k=>Math.max(Math.min(a[k],b[k]),Math.min(c[k],d[k]))<=Math.min(Math.max(a[k],b[k]),Math.max(c[k],d[k]))+extent*1e-10);
    if(overlap&&cross(a,b,c)*cross(a,b,d)<=eps*eps&&cross(c,d,a)*cross(c,d,b)<=eps*eps)topology();
   }
  }
 }
 const direction=Math.sign(sections[1][0][2]-sections[0][0][2]);
 if(!direction||sections.some((r,i)=>i>0&&(r[0][2]-sections[i-1][0][2])*direction<=1e-9))invalid();
 if(direction<0)sections.reverse();if(winding<0)sections.forEach(r=>r.reverse());
 const points=sections.flat(),faces:number[][]=[Array.from({length:count},(_,i)=>count-1-i)];
 for(let s=0;s<sections.length-1;s++)for(let j=0;j<count;j++){
  const a=s*count+j,b=s*count+(j+1)%count,c=b+count,d=a+count;
  faces.push([a,b,c],[a,c,d]);
 }
 faces.push(Array.from({length:count},(_,i)=>points.length-count+i));return {points,faces};
}
