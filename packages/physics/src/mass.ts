// SPDX-License-Identifier: BSD-3-Clause
import type { BodyMesh } from '@brickwright/cad-geometry';
export interface MassProperties {massKg:number;volumeM3:number;centerM:[number,number,number];inertiaKgM2:number[][]}
/** Signed tetrahedral integrals of the evaluated solid, in SI, about its actual COM.
 * Collision decomposition never determines the body's mass or inertia. */
export function solidMassProperties(mesh:BodyMesh,densityKgM3:number):MassProperties {
 if(!Number.isFinite(densityKgM3)||densityKgM3<=0)throw new Error('Density must be positive');
 const origin=mesh.bounds.min.map((v,i)=>(v+mesh.bounds.max[i])*.0005);let volume=0;const moment=[0,0,0],second=Array.from({length:3},()=>[0,0,0]);
 for(let i=0;i<mesh.indices.length;i+=3){const p=[0,1,2].map(j=>[0,1,2].map(k=>mesh.positions[mesh.indices[i+j]*3+k]*.001-origin[k]));const [a,b,c]=p;const v=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;volume+=v;
  for(let x=0;x<3;x++){moment[x]+=v*(a[x]+b[x]+c[x])/4;for(let y=0;y<3;y++){const same=p.reduce((s,q)=>s+q[x]*q[y],0);const sumX=a[x]+b[x]+c[x],sumY=a[y]+b[y]+c[y];second[x][y]+=v*(same+sumX*sumY)/20;}}
 }
 if(!Number.isFinite(volume)||volume<=1e-15)throw new Error(`${mesh.name}: solid has no positive physical volume`);
 const local=moment.map(v=>v/volume),massKg=volume*densityKgM3,trace=second[0][0]+second[1][1]+second[2][2];const inertia=second.map((row,x)=>row.map((value,y)=>densityKgM3*((x===y?trace:0)-value)-massKg*((x===y?local.reduce((s,v)=>s+v*v,0):0)-local[x]*local[y])));
 if(!inertia.every((row,x)=>Number.isFinite(row[x])&&row[x]>0))throw new Error('Invalid solid inertia');
 return {massKg,volumeM3:volume,centerM:local.map((v,i)=>v+origin[i]) as [number,number,number],inertiaKgM2:inertia};
}
