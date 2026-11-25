// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type { BodyMesh } from '@brickwright/cad-geometry';
export interface MassProperties {massKg:number;volumeM3:number;centerM:[number,number,number];inertiaKgM2:number[][]}
/** Rigidly attached solids retain their separate densities. Sum their tensors
 * about the common centre using the parallel-axis theorem. */
export function combineMassProperties(parts:readonly MassProperties[]):MassProperties{
 const massKg=parts.reduce((sum,p)=>sum+p.massKg,0),volumeM3=parts.reduce((sum,p)=>sum+p.volumeM3,0);
 if(!parts.length||!Number.isFinite(massKg)||massKg<=0)throw new Error(t('Invalid solid inertia'));
 const centerM=[0,1,2].map(axis=>parts.reduce((sum,p)=>sum+p.massKg*p.centerM[axis],0)/massKg) as [number,number,number],inertiaKgM2=Array.from({length:3},()=>[0,0,0]);
 for(const part of parts){const r=part.centerM.map((v,i)=>v-centerM[i]),r2=r.reduce((sum,v)=>sum+v*v,0);for(let row=0;row<3;row++)for(let col=0;col<3;col++)inertiaKgM2[row][col]+=part.inertiaKgM2[row][col]+part.massKg*((row===col?r2:0)-r[row]*r[col]);}
 return {massKg,volumeM3,centerM,inertiaKgM2};
}
/** Signed tetrahedral integrals of the evaluated solid, in SI, about its actual COM.
 * Collision decomposition never determines the body's mass or inertia. */
export function solidMassProperties(mesh:BodyMesh,densityKgM3:number):MassProperties {
 if(!Number.isFinite(densityKgM3)||densityKgM3<=0)throw new Error(t('Density must be positive'));
 const origin=mesh.bounds.min.map((v,i)=>(v+mesh.bounds.max[i])*.0005);let volume=0;const moment=[0,0,0],second=Array.from({length:3},()=>[0,0,0]);
 const a=[0,0,0],b=[0,0,0],c=[0,0,0],sum=[0,0,0];
 const {indices,positions}=mesh;
 for(let i=0;i<indices.length;i+=3){
  const ia=indices[i]*3,ib=indices[i+1]*3,ic=indices[i+2]*3;
  for(let axis=0;axis<3;axis++){
   a[axis]=positions[ia+axis]*.001-origin[axis];
   b[axis]=positions[ib+axis]*.001-origin[axis];
   c[axis]=positions[ic+axis]*.001-origin[axis];
   sum[axis]=a[axis]+b[axis]+c[axis];
  }
  const v=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  volume+=v;
  for(let x=0;x<3;x++){
   moment[x]+=v*sum[x]/4;
   for(let y=0;y<3;y++){
    // Keep the original zero-seeded accumulation order.
    const same=((0+a[x]*a[y])+b[x]*b[y])+c[x]*c[y];
    second[x][y]+=v*(same+sum[x]*sum[y])/20;
   }
  }
 }
 if(!Number.isFinite(volume)||volume<=1e-15)throw new Error(t`${mesh.name}: solid has no positive physical volume`);
 const local=moment.map(v=>v/volume),massKg=volume*densityKgM3,trace=second[0][0]+second[1][1]+second[2][2];const inertia=second.map((row,x)=>row.map((value,y)=>densityKgM3*((x===y?trace:0)-value)-massKg*((x===y?local.reduce((s,v)=>s+v*v,0):0)-local[x]*local[y])));
 if(!inertia.every((row,x)=>Number.isFinite(row[x])&&row[x]>0))throw new Error(t('Invalid solid inertia'));
 return {massKg,volumeM3:volume,centerM:local.map((v,i)=>v+origin[i]) as [number,number,number],inertiaKgM2:inertia};
}
