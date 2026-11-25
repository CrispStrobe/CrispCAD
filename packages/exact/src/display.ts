// SPDX-License-Identifier: BSD-3-Clause
// Display meshes for exact features: the exact result tessellated at EXACT_DISPLAY_TOLERANCE in
// the feature's local frame, keyed to the model it was computed from (exactFeatureKey), so the
// Manifold evaluator can show it without the kernel and refuse it once it is out of date.
import {EXACT_DISPLAY_TOLERANCE,MAX_EXACT_DISPLAY_INDICES,MAX_EXACT_DISPLAY_POSITIONS,exactFeatureKey,t} from '@brickwright/cad-core';
import type {CadDocument,ExactFeatureDisplay} from '@brickwright/cad-core';
import {ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactKernel,TriangleMesh} from '@crispcad/exact-kernel';
import {lowerDocumentNode} from './lower-document.js';

/** Stored coordinates are rounded to 1 nm; Manifold reads them as Float32 anyway. */
const round=(value:number)=>{const r=Math.round(value*1e6)/1e6;return Object.is(r,-0)?0:r;};

/** Weld coincident vertices, drop degenerate triangles and require a closed, consistently
 * oriented surface: every directed edge must be matched by exactly one opposite edge. */
export function displayMesh(mesh:Pick<TriangleMesh,'positions'|'indices'>,name:string):Omit<ExactFeatureDisplay,'sourceKey'>{
 const positions:number[]=[],indices:number[]=[],welded=new Map<string,number>(),remap=new Uint32Array(mesh.positions.length/3);
 for(let i=0;i<remap.length;i++){
  const x=round(mesh.positions[3*i]),y=round(mesh.positions[3*i+1]),z=round(mesh.positions[3*i+2]),key=`${x},${y},${z}`;
  let index=welded.get(key);
  if(index===undefined){index=positions.length/3;welded.set(key,index);positions.push(x,y,z);}
  remap[i]=index;
 }
 const edges=new Map<string,number>();
 for(let i=0;i<mesh.indices.length;i+=3){
  const a=remap[mesh.indices[i]],b=remap[mesh.indices[i+1]],c=remap[mesh.indices[i+2]];
  if(a===b||b===c||c===a)continue;
  indices.push(a,b,c);
  for(const [p,q] of [[a,b],[b,c],[c,a]])edges.set(`${p},${q}`,(edges.get(`${p},${q}`)??0)+1);
 }
 for(const [edge,count] of edges){
  const [p,q]=edge.split(',');
  if(count!==1||edges.get(`${q},${p}`)!==1)throw new ExactKernelError('kernel-failure',t`${name}: the exact tessellation is not a closed surface, so it cannot be displayed.`);
 }
 if(positions.length>MAX_EXACT_DISPLAY_POSITIONS||indices.length>MAX_EXACT_DISPLAY_INDICES)
  throw new ExactKernelError('unsupported',t`${name}: the exact display mesh exceeds 250000 vertices or 500000 triangles.`);
 if(indices.length<12)throw new ExactKernelError('kernel-failure',t`${name}: the exact result has no displayable solid.`);
 return {positions,indices};
}

export interface ExactFeatureResult {display:ExactFeatureDisplay;volume:number}
/** The exact feature `id` built on the exact kernel and tessellated for display. Call inside `k.scope`. */
export function exactFeatureDisplay(k:ExactKernel,doc:CadDocument,id:string):ExactFeatureResult{
 const node=doc.nodes[id];
 if(node?.kind!=='exact-feature')throw new ExactKernelError('invalid-input',t`${id} is not an exact feature`);
 const solid=lowerDocumentNode(k,doc,id,{local:true});
 if(!k.isValid(solid))throw new ExactKernelError('kernel-failure',t`${node.name}: the exact result is not a valid closed solid.`);
 const mesh=displayMesh(k.tessellate(solid,EXACT_DISPLAY_TOLERANCE),node.name);
 return {display:{sourceKey:exactFeatureKey(doc,id),...mesh},volume:k.volume(solid)};
}
