// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';
import type {CrossSection,ManifoldToplevel} from 'manifold-3d';
import type {GeometryResult} from './kernel.js';

export type AssemblyCut={axis:0|1; position:number; jog?:{at:number; position:number}};
export type AssemblySection={cut:AssemblyCut; bodies:{id:string; loops:SketchPoint[][]}[]};

export function sliceAssemblyGeometry(module:ManifoldToplevel,geometry:GeometryResult,cut:AssemblyCut):AssemblySection{
 const {axis,position,jog}=cut;
 if(jog&&Math.abs(position-jog.position)<1e-8)throw new Error(t('Choose different positions for the two section legs.'));
 const bodies:AssemblySection['bodies']=[];
 let firstLegHasMaterial=false,secondLegHasMaterial=false;
 for(const body of geometry.bodies){
  const intersects=(value:number)=>value>body.bounds.min[axis]&&value<body.bounds.max[axis];
  if(body.reference||body.hole||!body.indices.length||(!intersects(position)&&(!jog||!intersects(jog.position))))continue;
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
  const owned:CrossSection[]=[];
  const keep=(section:CrossSection)=>{owned.push(section);return section;};
  try{
   if(solid.status()!=='NoError')throw new Error(t`Cannot section the evaluated body “${body.name}”.`);
   const slice=(value:number)=>intersects(value)?keep(solid.slice(axis===0?value:-value)):undefined;
   const first=slice(position);
   let finished=first;
   if(jog){
    const before=clipLeg(first,jog.at,true,keep);
    const after=clipLeg(slice(jog.position),jog.at,false,keep);
    firstLegHasMaterial||=!!before;
    secondLegHasMaterial||=!!after;
    // Merge touching material from the same solid across the jog.
    finished=before&&after?keep(before.add(after)):before??after;
   }
   const loops=finished?.toPolygons();
   if(loops?.length)bodies.push({id:body.id,loops});
  }finally{
   for(const section of owned)section.delete();
   solid.delete();
  }
 }
 if(jog&&(!firstLegHasMaterial||!secondLegHasMaterial))throw new Error(t('Both legs of the offset section must cross part material.'));
 return {cut,bodies};
}

function clipLeg(section:CrossSection|undefined,at:number,before:boolean,keep:(value:CrossSection)=>CrossSection){
 if(!section||section.isEmpty())return undefined;
 const {min,max}=section.bounds();
 const [left,bottom]=min,[right,top]=max;
 const start=before?left:Math.max(left,at),end=before?Math.min(right,at):right;
 if(end<=start)return undefined;
 if(start===left&&end===right)return section;
 const clipped=keep(section.intersect([[start,bottom],[end,bottom],[end,top],[start,top]]));
 return clipped.isEmpty()?undefined:clipped;
}
