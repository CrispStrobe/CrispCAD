// SPDX-License-Identifier: BSD-3-Clause
// Optional exact B-rep backend. Importing this module loads no WebAssembly; `createExactBackend`
// loads the kernel lab's SMLib build once per process or worker. Hosts import this module
// lazily (dynamic import) so the default Manifold path never pays for it.
import {validateDocument,t} from '@brickwright/cad-core';
import type {CadDocument,KernelIdentity} from '@brickwright/cad-core';
import {createSmlibKernel,ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactKernel,ExactSolid,SmlibLoadOptions} from '@crispcad/exact-kernel';
import {exactKernelIdentity} from './identity.js';
import {lowerDocumentBody} from './lower-document.js';

export * from './identity.js';
export {lowerCodeShape,evaluateCadScript,cadScript,revolveProfile,MIN_EXACT_SEGMENTS,MAX_POLYHEDRON_FACES} from './lower-cad-script.js';
export {lowerDocumentBody,sketchProfile,ExactLoweringError} from './lower-document.js';
export type {ExactDiagnostic} from './lower-document.js';
export {ExactKernelError} from '@crispcad/exact-kernel';
export type {ExactKernel,ExactSolid,SmlibLoadOptions} from '@crispcad/exact-kernel';

/** At most this many bodies per exact request (as the Manifold interference check). */
export const MAX_EXACT_BODIES=64;
/** STEP text above this size is refused instead of being handed to a host. */
export const MAX_STEP_BYTES=64*1024*1024;

export interface ExactKernelInfo extends KernelIdentity {
 /** The SMLib build inside the package, reported by the kernel. */
 readonly smlib:string;
 readonly licence:string;
}
export interface ExactBodyMeasure {
 id:string;name:string;
 /** mm³ and mm², from the B-rep (no tessellation). */
 volume:number;area:number;
 bounds:{min:[number,number,number];max:[number,number,number]};
 centroid:[number,number,number];
 solids:number;
}
export interface ExactMeasureResult {kernel:ExactKernelInfo;bodies:ExactBodyMeasure[]}
export interface ExactStepResult {kernel:ExactKernelInfo;bodies:{id:string;name:string}[];step:string;bytes:number}

/** Bodies an exact command acts on: the given top-level bodies, or every printable one. */
export function exactTargets(doc:CadDocument,ids?:readonly string[]):string[]{
 let targets:string[];
 if(ids?.length){
  targets=[...new Set(ids)];
  for(const id of targets){
   if(!doc.roots.includes(id))throw new ExactKernelError('invalid-input',t`Unknown object id: ${id}`);
   const node=doc.nodes[id];
   if(node.reference)throw new ExactKernelError('invalid-input',t`${node.name} is a reference body and is never exported or measured.`);
   if(node.role==='hole')throw new ExactKernelError('invalid-input',t`${node.name} is a hole body; combine it with a solid first.`);
  }
 }else targets=doc.roots.filter(id=>!doc.nodes[id].reference&&doc.nodes[id].role!=='hole');
 if(!targets.length)throw new ExactKernelError('invalid-input',t('The design has no solid bodies to export'));
 if(targets.length>MAX_EXACT_BODIES)throw new ExactKernelError('invalid-input',t`Exact commands are limited to ${MAX_EXACT_BODIES} bodies.`);
 return targets;
}

export interface ExactBackend {
 readonly kernel:ExactKernel;
 readonly info:ExactKernelInfo;
 /** Exact volume, area, bounding box and centroid of each body. */
 measure(doc:CadDocument,ids?:readonly string[]):ExactMeasureResult;
 /** One AP214 STEP file with one solid per body, in world millimetres. */
 exportStep(doc:CadDocument,ids?:readonly string[]):ExactStepResult;
}

export function createExactBackendFromKernel(kernel:ExactKernel):ExactBackend{
 const info:ExactKernelInfo=Object.freeze({...exactKernelIdentity,smlib:kernel.version,licence:kernel.licence});
 const lower=(input:CadDocument,ids?:readonly string[])=>{
  const doc=validateDocument(input),targets=exactTargets(doc,ids);
  return {doc,targets,solids:targets.map(id=>{
   const solid=lowerDocumentBody(kernel,doc,id);
   if(!kernel.isValid(solid))throw new ExactKernelError('kernel-failure',t`${doc.nodes[id].name}: the exact result is not a valid closed solid.`);
   return solid;
  })};
 };
 return {
  kernel,info,
  measure(input,ids){
   return kernel.scope(()=>{
    const {doc,targets,solids}=lower(input,ids);
    return {kernel:info,bodies:solids.map((solid,i)=>{
     const box=kernel.bbox(solid),mass=kernel.massProperties(solid);
     return {id:targets[i],name:doc.nodes[targets[i]].name,volume:kernel.volume(solid),area:kernel.area(solid),bounds:{min:[...box.min],max:[...box.max]},centroid:[...mass.centroid],solids:kernel.solidCount(solid)};
    })};
   });
  },
  exportStep(input,ids){
   return kernel.scope(()=>{
    const {doc,targets,solids}=lower(input,ids);
    let combined:ExactSolid=solids[0];
    if(solids.length>1){
     // One STEP solid per body: a union may only collect bodies that stay apart.
     const expected=solids.reduce((sum,solid)=>sum+kernel.solidCount(solid),0);
     combined=kernel.union(solids[0],...solids.slice(1));
     if(kernel.solidCount(combined)!==expected){
      for(let i=0;i<solids.length;i++)for(let j=i+1;j<solids.length;j++){
       if(kernel.solidCount(kernel.union(solids[i],solids[j]))<kernel.solidCount(solids[i])+kernel.solidCount(solids[j]))
        throw new ExactKernelError('unsupported',t`${doc.nodes[targets[i]].name} and ${doc.nodes[targets[j]].name} touch or overlap, so one STEP file would merge them. Export them separately or combine them first.`);
      }
      throw new ExactKernelError('unsupported',t('Selected bodies touch or overlap, so one STEP file would merge them. Export them separately or combine them first.'));
     }
    }
    const step=kernel.exportStep(combined),bytes=new TextEncoder().encode(step).byteLength;
    if(bytes>MAX_STEP_BYTES)throw new ExactKernelError('unsupported',t('The STEP file exceeds 64 MiB.'));
    return {kernel:info,bodies:targets.map(id=>({id,name:doc.nodes[id].name})),step,bytes};
   });
  },
 };
}

let shared:Promise<ExactBackend>|undefined;
/** Load SMLib once (per process or worker) and return the exact backend on it. */
export function createExactBackend(options:SmlibLoadOptions={}):Promise<ExactBackend>{
 shared??=createSmlibKernel(options).then(createExactBackendFromKernel,error=>{shared=undefined;throw error;});
 return shared;
}
