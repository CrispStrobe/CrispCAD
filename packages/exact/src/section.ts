// SPDX-License-Identifier: BSD-3-Clause
// Exact sections for drawings: each body split by each cutting plane of a (possibly stepped)
// section, and the edges of the cut face read from the B-rep. Lines, circles (with their exact
// centre and radius) and the ellipses where the plane cuts a cylinder (with the cylinder, so the
// projection can rebuild the ellipse exactly) come back as data; the editor clips them to the legs
// and hatches them (assembly-section-view.ts). A body the kernel cannot build or cut is reported
// with the reason and sectioned from its mesh instead.
import {t} from '@brickwright/cad-core';
import type {CadDocument,ExactDrawingFace,ExactDrawingFailure,ExactSectionBody,ExactSectionData,ExactSectionEdge} from '@brickwright/cad-core';
import {ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactFaceInfo,ExactKernel,ExactSolid} from '@crispcad/exact-kernel';
import {ExactLoweringError,lowerDocumentBody} from './lower-document.js';
import type {ExactFeatureLimits} from './lower-document.js';
import type {BrepCache} from './step-import.js';

/** Cutting planes of one section request (positions along the world axis, one per leg). */
export const MAX_SECTION_PLANES=5;
/** Edges one body's cut face may have. */
export const MAX_SECTION_EDGES=4000;

const face=(f:ExactFaceInfo):ExactDrawingFace=>({surface:f.surface,point:[...f.point],normal:[...f.normal],
 ...(f.radius!==undefined?{radius:f.radius}:{}),...(f.axis?{axis:{origin:[...f.axis.origin],direction:[...f.axis.direction]}}:{})});

/** The cut-face edges of one solid at `normal · x = offset` (call inside `k.scope`). */
export function sectionEdges(k:ExactKernel,solid:ExactSolid,axis:0|1,position:number):ExactSectionEdge[]{
 const box=k.bbox(solid),span=box.max[axis]-box.min[axis],margin=Math.max(1e-9,span*1e-12);
 if(!(position>box.min[axis]+margin&&position<box.max[axis]-margin))return [];
 const normal:[number,number,number]=[axis===0?1:0,axis===1?1:0,0];
 let parts:[ExactSolid,ExactSolid];
 try{parts=k.splitByPlane(solid,normal,position);}
 catch(error){
  // The plane crosses the box but not the material (a U-shaped part between its arms).
  if(error instanceof ExactKernelError&&/nothing of the part lies/.test(error.message))return [];
  throw error;
 }
 // The part on the positive side: its cut face looks along −normal.
 const topology=k.topology(parts[0]);
 const caps=new Set(topology.faces.filter(f=>f.surface==='plane'&&f.normal[axis]<-1+1e-9&&Math.abs(f.point[axis]-position)<=Math.max(1e-7,Math.abs(position)*1e-12)).map(f=>f.index));
 if(!caps.size)return [];
 const edges=topology.edges.filter(edge=>edge.faces.some(i=>caps.has(i))&&!edge.faces.every(i=>caps.has(i)));
 if(edges.length>MAX_SECTION_EDGES)throw new ExactKernelError('unsupported',t`The section's cut face has ${edges.length} edges, more than ${MAX_SECTION_EDGES}.`);
 return edges.map(edge=>{
  const cap=edge.faces.find(i=>caps.has(i))!,other=edge.faces.find(i=>!caps.has(i));
  const surfaces=[face(topology.faces[cap]),...(other!==undefined?[face(topology.faces[other])]:[])];
  return {curve:edge.curve,faces:surfaces.map((_,i)=>i),points:edge.points.flatMap(p=>[p[0],p[1],p[2]]),closed:edge.closed,length:edge.length,surfaces,
   ...(edge.curve==='circle'&&edge.radius!==undefined&&edge.center&&edge.axis?{circle:{center:[...edge.center],radius:edge.radius,axis:[...edge.axis]}}:{})};
 });
}

/** Exact sections of the top-level bodies `targets` at every position, one kernel scope per body. */
export function exactSectionData(k:ExactKernel,doc:CadDocument,targets:readonly string[],cut:{axis:0|1;positions:readonly number[]},
 options:{limits?:ExactFeatureLimits;breps?:BrepCache;fatal:(error:unknown)=>boolean}):ExactSectionData{
 if(cut.axis!==0&&cut.axis!==1||!Array.isArray(cut.positions)||!cut.positions.length||cut.positions.length>MAX_SECTION_PLANES||!cut.positions.every(p=>typeof p==='number'&&Number.isFinite(p)&&Math.abs(p)<=100000))
  throw new ExactKernelError('invalid-input',t('Give the section axis and up to five cut positions.'));
 const bodies:ExactSectionBody[]=[],failures:ExactDrawingFailure[]=[];
 for(const id of targets){
  const name=doc.nodes[id].name;
  try{
   bodies.push(k.scope(()=>{
    const solid=lowerDocumentBody(k,doc,id,{limits:options.limits,breps:options.breps});
    if(!k.isValid(solid))throw new ExactKernelError('kernel-failure',t`${name}: the exact result is not a valid closed solid.`);
    return {id,name,legs:cut.positions.map(position=>sectionEdges(k,solid,cut.axis,position))};
   }));
  }catch(error){
   if(options.fatal(error))throw error;
   const code=error instanceof ExactLoweringError?error.diagnostic.code:error instanceof ExactKernelError?error.code:'kernel-failure';
   failures.push({id,name,code,message:error instanceof Error?error.message:String(error)});
  }
 }
 return {axis:cut.axis,positions:[...cut.positions],bodies,failures};
}
