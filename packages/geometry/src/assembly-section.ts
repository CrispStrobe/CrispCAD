// SPDX-License-Identifier: BSD-3-Clause
import {assemblySectionJogLimit,t} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';
import type {CrossSection,ManifoldToplevel} from 'manifold-3d';
import type {GeometryResult} from './kernel.js';

type AssemblyJog={at:number; position:number};
export type AssemblyCut={axis:0|1; position:number; jog?:AssemblyJog; additionalJogs?:AssemblyJog[]};
export const assemblyCutJogs=(cut:AssemblyCut)=>cut.jog?[cut.jog,...(cut.additionalJogs??[])]:[];
export type AssemblySection={cut:AssemblyCut; bodies:{id:string; loops:SketchPoint[][]}[]};

export function sliceAssemblyGeometry(module:ManifoldToplevel,geometry:GeometryResult,cut:AssemblyCut):AssemblySection{
 const {axis,position}=cut,jogs=assemblyCutJogs(cut);
 if(jogs.length>assemblySectionJogLimit)throw new Error(t`Use at most ${assemblySectionJogLimit} jogs in an assembly section.`);
 const positions=[position,...jogs.map(jog=>jog.position)];
 const legHasMaterial=positions.map(()=>false);
 for(const [i,jog] of jogs.entries()){
  if(i&&jog.at<=jogs[i-1].at)throw new Error(t('Enter jog coordinates in increasing order.'));
  if(Math.abs(positions[i]-jog.position)<1e-8){
   throw new Error(jogs.length===1?t('Choose different positions for the two section legs.'):
    t`Choose different positions for section legs ${i+1} and ${i+2}.`);
  }
 }
 const bodies:AssemblySection['bodies']=[];
 for(const body of geometry.bodies){
  const intersects=(value:number)=>value>body.bounds.min[axis]&&value<body.bounds.max[axis];
  if(body.reference||body.hole||!body.indices.length||!positions.some(intersects))continue;
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
   let finished:CrossSection|undefined;
   for(const [i,value] of positions.entries()){
    const leg=clipLeg(slice(value),jogs[i-1]?.at??-Infinity,jogs[i]?.at??Infinity,keep);
    if(!leg)continue;
    legHasMaterial[i]=true;
    // Merge touching material only between legs of the same solid.
    finished=finished?keep(finished.add(leg)):leg;
   }
   const loops=finished?.toPolygons();
   if(loops?.length)bodies.push({id:body.id,loops});
  }finally{
   for(const section of owned)section.delete();
   solid.delete();
  }
 }
 const emptyLeg=legHasMaterial.indexOf(false);
 if(jogs.length&&emptyLeg>=0){
  throw new Error(jogs.length===1?t('Both legs of the offset section must cross part material.'):
   t`Section leg ${emptyLeg+1} misses part material.`);
 }
 return {cut,bodies};
}

function clipLeg(section:CrossSection|undefined,from:number,to:number,keep:(value:CrossSection)=>CrossSection){
 if(!section||section.isEmpty())return undefined;
 const {min,max}=section.bounds();
 const [left,bottom]=min,[right,top]=max;
 const start=Math.max(left,from),end=Math.min(right,to);
 if(end<=start)return undefined;
 if(start===left&&end===right)return section;
 const clipped=keep(section.intersect([[start,bottom],[end,bottom],[end,top],[start,top]]));
 return clipped.isEmpty()?undefined:clipped;
}
