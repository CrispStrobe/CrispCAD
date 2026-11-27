// SPDX-License-Identifier: BSD-3-Clause
// What a drawing needs from the exact B-rep of each body: its edges (curve kind, sample points,
// and for circular edges the exact centre, radius and axis), its faces (surface kind, and the
// radius and axis of cylinders, cones, spheres and tori), and a face-wise triangle mesh whose
// triangles know their face, used to decide what hides an edge and to find the silhouettes of
// curved faces. The hidden-line projection itself is plain TypeScript in the editor
// (exact-drawing-projection.ts); this module only reads the kernel, so it runs where the kernel
// runs (the editor's exact worker, the MCP thread, Node).
//
// A body the kernel cannot build is reported with the reason, not dropped silently: the drawing
// then projects that body from its display mesh and says so on the sheet.
import {t} from '@brickwright/cad-core';
import type {CadDocument,ExactDrawingBody,ExactDrawingData,ExactDrawingFailure} from '@brickwright/cad-core';
import {ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactKernel,ExactSolid} from '@crispcad/exact-kernel';
import {facewiseMesh} from './face-mesh.js';
import {ExactLoweringError,lowerDocumentBody} from './lower-document.js';
import type {ExactFeatureLimits} from './lower-document.js';
import type {BrepCache} from './step-import.js';

/** Faces and edges one body may have for an exact drawing; a larger body is drawn from its mesh. */
export const MAX_DRAWING_FACES=2000;
export const MAX_DRAWING_EDGES=6000;
/** Triangles of the face-wise mesh, over all bodies of one drawing request. */
export const MAX_DRAWING_TRIANGLES=400000;

/** Chord tolerance for the occlusion mesh: fine enough that hidden-line decisions are made within
 * a few hundredths of a millimetre, coarse enough for large parts. */
export function drawingMeshTolerance(bounds:{min:readonly number[];max:readonly number[]}){
 const diagonal=Math.hypot(...bounds.max.map((v,i)=>v-bounds.min[i]));
 return Math.min(.05,Math.max(.01,diagonal*2e-4));
}

export type {ExactDrawingBody,ExactDrawingData,ExactDrawingEdge,ExactDrawingFace,ExactDrawingFailure} from '@brickwright/cad-core';

const flat=(points:readonly (readonly number[])[])=>points.flatMap(p=>[p[0],p[1],p[2]]);

/** The drawing data of one exact solid (call inside `k.scope`). Throws `unsupported` when the
 * body is larger than a drawing takes. */
export function exactDrawingBody(k:ExactKernel,solid:ExactSolid,id:string,name:string,budget:{triangles:number}=({triangles:MAX_DRAWING_TRIANGLES})):ExactDrawingBody{
 const topology=k.topology(solid);
 if(topology.faces.length>MAX_DRAWING_FACES||topology.edges.length>MAX_DRAWING_EDGES)
  throw new ExactKernelError('unsupported',t`${name} has ${topology.faces.length} faces and ${topology.edges.length} edges, more than an exact drawing takes (${MAX_DRAWING_FACES} and ${MAX_DRAWING_EDGES}).`);
 const box=k.bbox(solid),bounds={min:[...box.min],max:[...box.max]};
 const tolerance=drawingMeshTolerance(bounds);
 let mesh=facewiseMesh(k,solid,{tolerance,angleDeg:10,faces:true});
 // A planar face SMLib had to mesh does not share a hole band's circle points: mesh without bands.
 if(mesh?.bands&&mesh.planarFallbacks)mesh=facewiseMesh(k,solid,{tolerance,angleDeg:10,bands:false,faces:true});
 if(!mesh?.faceOf)throw new ExactKernelError('unsupported',t`${name}: the exact kernel did not mesh the body face by face.`);
 const triangles=mesh.indices.length/3;
 if(triangles>budget.triangles)throw new ExactKernelError('unsupported',t`${name}: the exact drawing would need more than ${MAX_DRAWING_TRIANGLES} triangles.`);
 budget.triangles-=triangles;
 return {
  id,name,tolerance,bounds,
  faces:topology.faces.map(face=>({surface:face.surface,point:[...face.point],normal:[...face.normal],
   ...(face.radius!==undefined?{radius:face.radius}:{}),
   ...(face.axis?{axis:{origin:[...face.axis.origin],direction:[...face.axis.direction]}}:{})})),
  edges:topology.edges.map(edge=>({curve:edge.curve,faces:[...edge.faces],points:flat(edge.points),closed:edge.closed,length:edge.length,
   ...(edge.curve==='circle'&&edge.radius!==undefined&&edge.center&&edge.axis?{circle:{center:[...edge.center],radius:edge.radius,axis:[...edge.axis]}}:{})})),
  mesh:{positions:Float64Array.from(mesh.positions),indices:Uint32Array.from(mesh.indices),faceOf:Uint32Array.from(mesh.faceOf)},
 };
}

/**
 * Drawing data for each top-level body in `targets`, built and read inside its own kernel scope.
 * A body that cannot be built exactly, or is too large, becomes a failure with the reason; a fatal
 * kernel error (a trap, memory exhaustion) is rethrown, since the kernel cannot be trusted after it.
 */
export function exactDrawingData(k:ExactKernel,doc:CadDocument,targets:readonly string[],options:{limits?:ExactFeatureLimits;breps?:BrepCache;fatal:(error:unknown)=>boolean}):ExactDrawingData{
 const bodies:ExactDrawingBody[]=[],failures:ExactDrawingFailure[]=[],budget={triangles:MAX_DRAWING_TRIANGLES};
 for(const id of targets){
  const name=doc.nodes[id].name;
  try{
   bodies.push(k.scope(()=>{
    const solid=lowerDocumentBody(k,doc,id,{limits:options.limits,breps:options.breps});
    if(!k.isValid(solid))throw new ExactKernelError('kernel-failure',t`${name}: the exact result is not a valid closed solid.`);
    return exactDrawingBody(k,solid,id,name,budget);
   }));
  }catch(error){
   if(options.fatal(error))throw error;
   const code=error instanceof ExactLoweringError?error.diagnostic.code:error instanceof ExactKernelError?error.code:'kernel-failure';
   failures.push({id,name,code,message:error instanceof Error?error.message:String(error)});
  }
 }
 return {bodies,failures};
}
