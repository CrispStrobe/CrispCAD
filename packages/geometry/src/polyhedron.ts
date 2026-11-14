// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
/** Original bounded ear clipping for simple, planar faces; preserves boundary vertices. */
export function triangulatePolyhedron(points:readonly number[][],faces:readonly number[][]):number[]{
 const triangles:number[]=[];
 for(const face of faces){const normal=[0,0,0];for(let i=0;i<face.length;i++){const a=points[face[i]],b=points[face[(i+1)%face.length]];normal[0]+=(a[1]-b[1])*(a[2]+b[2]);normal[1]+=(a[2]-b[2])*(a[0]+b[0]);normal[2]+=(a[0]-b[0])*(a[1]+b[1]);}const length=Math.hypot(...normal);if(face.length===3&&length===0)continue;if(length<1e-12)throw new Error(t('Polyhedron face has zero area'));const n=normal.map(v=>v/length),origin=points[face[0]],extent=Math.max(1,...face.flatMap(id=>points[id].map((v,i)=>Math.abs(v-origin[i]))));
  if(face.some(id=>Math.abs(points[id].reduce((sum,v,i)=>sum+(v-origin[i])*n[i],0))>extent*1e-7))throw new Error(t('Polyhedron faces must be planar'));
  const drop=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),axes=[0,1,2].filter(i=>i!==drop),p=face.map(id=>axes.map(i=>points[id][i])),cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);const area=p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-a[1]*b[0];},0),sign=Math.sign(area),eps=extent*extent*1e-12;
  for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){if(i===0&&j===p.length-1)continue;const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length],overlap=[0,1].every(k=>Math.max(Math.min(a[k],b[k]),Math.min(c[k],d[k]))<=Math.min(Math.max(a[k],b[k]),Math.max(c[k],d[k]))+extent*1e-10);if(overlap&&cross(a,b,c)*cross(a,b,d)<=eps*eps&&cross(c,d,a)*cross(c,d,b)<=eps*eps)throw new Error(t('Polyhedron face intersects itself'));}
  const remaining=face.map((_,i)=>i);while(remaining.length>3){let clipped=false;for(let i=0;i<remaining.length;i++){const a=remaining[(i+remaining.length-1)%remaining.length],b=remaining[i],c=remaining[(i+1)%remaining.length];if(sign*cross(p[a],p[b],p[c])<=eps)continue;const inside=remaining.some(id=>id!==a&&id!==b&&id!==c&&sign*cross(p[a],p[b],p[id])>=-eps&&sign*cross(p[b],p[c],p[id])>=-eps&&sign*cross(p[c],p[a],p[id])>=-eps);if(inside)continue;triangles.push(face[a],face[b],face[c]);remaining.splice(i,1);clipped=true;break;}if(!clipped)throw new Error(t('Cannot triangulate polyhedron face'));}triangles.push(...remaining.map(i=>face[i]));
 }
 return triangles;
}
