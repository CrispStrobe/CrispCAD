// SPDX-License-Identifier: BSD-3-Clause
// Pre-flight for exact features: count what a fillet, chamfer or shell would touch on its source
// solid and refuse it before the kernel runs when that exceeds the host's limits (limits.ts).
import {t} from '@brickwright/cad-core';
import type {ExactFeatureOperation,ExactFaceSelector} from '@brickwright/cad-core';
import {ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactSolid} from '@crispcad/exact-kernel';
import {CURVED_EDGE_WEIGHT} from './limits.js';
import type {ExactLimits} from './limits.js';

/** What a fillet, chamfer or shell would touch, counted on its source solid. */
export interface ExactFeatureCost {
 /** Fillet/chamfer: edges selected; shell: every edge of the body. */
 readonly edges:number;
 /** Of those, edges that are not straight lines (hole rims, arcs, splines). */
 readonly curvedEdges:number;
 /** Faces of the source body. */
 readonly faces:number;
 /** Edges weighted by what they cost the kernel: straight + CURVED_EDGE_WEIGHT × curved. */
 readonly weightedEdges:number;
}

/** What the kernel takes: every edge, one planar face's edges, or chosen edges by index. */
export type ExactCostEdges='all'|ExactFaceSelector|{readonly edgeIndices:readonly number[]};
interface SmVector {x:number;y:number;z:number}
interface SmEdge {readonly geomType:string;_identity?():string}
interface SmFace {readonly geomType:string;readonly isPlanar?:boolean;normalAt(point?:readonly number[]):SmVector;center?():SmVector;edges():Iterable<SmEdge>}
interface SmPart {faces():Iterable<SmFace>;edges?():Iterable<SmEdge>}
const partOf=(solid:ExactSolid):SmPart|undefined=>{
 const part=(solid as unknown as {part?:SmPart}).part;
 return part&&typeof part.faces==='function'?part:undefined;
};

/** The planar face the kernel would pick for `selector` (see @crispcad/exact-kernel `face`). */
function selectedFace(faces:readonly SmFace[],selector:ExactFaceSelector):SmFace|undefined{
 const [x,y,z]=selector.faceNormal,length=Math.hypot(x,y,z);
 if(!(length>0))return undefined;
 const n=[x/length,y/length,z/length];
 const matches=faces.filter(face=>{
  if(face.isPlanar===false||face.isPlanar===undefined&&face.geomType!=='plane')return false;
  const m=face.normalAt();
  return m.x*n[0]+m.y*n[1]+m.z*n[2]>1-1e-9;
 });
 if(!selector.outermost)return matches.length===1?matches[0]:undefined;
 const along=(face:SmFace)=>{const c=face.center?.();return c?c.x*n[0]+c.y*n[1]+c.z*n[2]:0;};
 return matches.sort((a,b)=>along(b)-along(a))[0];
}

/**
 * Count what an exact feature on `source` would touch. Returns undefined for a solid that is not
 * an smlibwasm part (another backend, a test double): such jobs are not pre-flighted.
 */
export function exactFeatureCost(source:ExactSolid,operation:ExactFeatureOperation,edges:ExactCostEdges='all'):ExactFeatureCost|undefined{
 const part=partOf(source);
 if(!part)return undefined;
 const faces=[...part.faces()];
 let selected:Iterable<SmEdge>;
 if(operation!=='shell'&&edges!=='all'&&'edgeIndices' in edges){
  if(!part.edges)return undefined;
  const all=[...part.edges()];
  selected=edges.edgeIndices.map(i=>all[i]).filter(Boolean);
 }else if(operation!=='shell'&&edges!=='all'){
  const face=selectedFace(faces,edges as ExactFaceSelector);
  // No (unique) face: the kernel refuses the selector itself, with its own message.
  if(!face)return {edges:0,curvedEdges:0,faces:faces.length,weightedEdges:0};
  selected=face.edges();
 }else if(part.edges)selected=part.edges();
 else{
  const seen=new Map<string,SmEdge>();let i=0;
  for(const face of faces)for(const edge of face.edges())seen.set(edge._identity?.()??String(i++),edge);
  selected=seen.values();
 }
 let count=0,curved=0;
 for(const edge of selected){count++;if(edge.geomType!=='line')curved++;}
 return {edges:count,curvedEdges:curved,faces:faces.length,weightedEdges:count-curved+CURVED_EDGE_WEIGHT*curved};
}

/**
 * Refuse `operation` on `source` when it exceeds `limits`, with a message that says why and what
 * to do. Called before the kernel runs the feature; the model and its history are untouched.
 */
export function checkExactFeatureCost(source:ExactSolid,operation:ExactFeatureOperation,edges:ExactCostEdges|undefined,limits:Pick<ExactLimits,'maxFeatureEdges'|'maxShellFaces'>):ExactFeatureCost|undefined{
 if(!Number.isFinite(limits.maxFeatureEdges)&&!Number.isFinite(limits.maxShellFaces))return undefined;
 const cost=exactFeatureCost(source,operation,edges);
 if(!cost)return undefined;
 if(operation==='shell'){
  if(cost.faces>limits.maxShellFaces)
   throw new ExactKernelError('unsupported',t`Shelling a body with ${cost.faces} faces is too much for the exact kernel on this device, which allows ${limits.maxShellFaces}. Shell a simpler body, or add the holes after shelling.`);
 }else if(cost.weightedEdges>limits.maxFeatureEdges){
  const curved=Math.floor(limits.maxFeatureEdges/CURVED_EDGE_WEIGHT),straight=limits.maxFeatureEdges;
  throw new ExactKernelError('unsupported',operation==='fillet'
   ?t`Rounding ${cost.edges} edges (${cost.curvedEdges} of them curved) at once is too much for the exact kernel on this device, which allows about ${curved} curved or ${straight} straight edges per feature. Choose a face with fewer edges.`
   :t`Beveling ${cost.edges} edges (${cost.curvedEdges} of them curved) at once is too much for the exact kernel on this device, which allows about ${curved} curved or ${straight} straight edges per feature. Choose a face with fewer edges.`);
 }
 return cost;
}
