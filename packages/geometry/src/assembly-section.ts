// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';
import type {ManifoldToplevel} from 'manifold-3d';
import type {GeometryResult} from './kernel.js';

export type AssemblyCut={axis:0|1; position:number};
export type AssemblySection={cut:AssemblyCut; bodies:{id:string; loops:SketchPoint[][]}[]};

export function sliceAssemblyGeometry(module:ManifoldToplevel,geometry:GeometryResult,cut:AssemblyCut):AssemblySection{
 const {axis,position}=cut;
 const bodies:AssemblySection['bodies']=[];
 for(const body of geometry.bodies){
  if(body.reference||body.hole||!body.indices.length||position<=body.bounds.min[axis]||position>=body.bounds.max[axis])continue;
  // Rotate the coordinates into the slice plane, preserving mesh winding.
  const vertices=new Float32Array(body.positions.length);
  for(let i=0;i<vertices.length;i+=3){
   vertices[i]=body.positions[i+(axis===0?1:0)];
   vertices[i+1]=body.positions[i+2];
   vertices[i+2]=axis===0?body.positions[i]:-body.positions[i+1];
  }
  const mesh=new module.Mesh({numProp:3,vertProperties:vertices,triVerts:body.indices});
  mesh.merge();
  const solid=new module.Manifold(mesh);
  try{
   if(solid.status()!=='NoError')throw new Error(t`Cannot section the evaluated body “${body.name}”.`);
   const section=solid.slice(axis===0?position:-position);
   try{
    const loops=section.toPolygons();
    if(loops.length)bodies.push({id:body.id,loops});
   }finally{section.delete();}
  }finally{solid.delete();}
 }
 return {cut,bodies};
}
