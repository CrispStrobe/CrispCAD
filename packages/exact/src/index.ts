// SPDX-License-Identifier: BSD-3-Clause
// Optional exact B-rep backend. Importing this module loads no WebAssembly; `createExactBackend`
// loads the kernel lab's SMLib build once per process or worker. Hosts import this module
// lazily (dynamic import) so the default Manifold path never pays for it.
import {staleExactFeatures,validateDocument,t} from '@brickwright/cad-core';
import type {CadDocument,ExactCommandHost,ExactCommandRequest,ExactCommandResult,ExactFeatureDisplay,KernelIdentity} from '@brickwright/cad-core';
import {createSmlibKernel,ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactKernel,ExactSolid,SmlibKernel,SmlibLoadOptions} from '@crispcad/exact-kernel';
import {exactKernelIdentity} from './identity.js';
import {lowerDocumentBody} from './lower-document.js';
import {exactFeatureDisplay} from './display.js';
import {exactKernelOptions} from './limits.js';
import type {ExactLimits} from './limits.js';
import type {ExactFeatureLimits} from './lower-document.js';

export * from './identity.js';
export {lowerCodeShape,evaluateCadScript,cadScript,revolveProfile,MIN_EXACT_SEGMENTS,MAX_POLYHEDRON_FACES} from './lower-cad-script.js';
export {lowerDocumentBody,lowerDocumentNode,sketchProfile,ExactLoweringError} from './lower-document.js';
export {displayMesh,displayTessellation,exactFeatureDisplay} from './display.js';
export {triangulatePolygon,facewiseMesh,MANY_LOOPS} from './face-mesh.js';
export type {ExactFeatureResult} from './display.js';
export type {ExactDiagnostic,ExactFeatureLimits} from './lower-document.js';
export {EXACT_LIMITS_TABLET,EXACT_LIMITS_DESKTOP,EXACT_LIMITS_NONE,CURVED_EDGE_WEIGHT,resolveExactLimits,exactGuardSeconds,exactKernelOptions} from './limits.js';
export type {ExactLimits} from './limits.js';
export {exactFeatureCost,checkExactFeatureCost} from './feature-cost.js';
export type {ExactFeatureCost} from './feature-cost.js';
export {ExactKernelError} from '@crispcad/exact-kernel';
export type {ExactKernel,ExactSolid,SmlibKernel,SmlibLoadOptions} from '@crispcad/exact-kernel';

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
export interface ExactFeatureDisplayResult {kernel:ExactKernelInfo;features:{id:string;name:string;display:ExactFeatureDisplay;volume:number}[]}
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

/** Per request: exact features that would touch more than `limits` allow are refused before the
 * kernel runs them (fillet, chamfer and shell, also when STEP export or a measure rebuilds them). */
export interface ExactRunOptions {readonly limits?:ExactFeatureLimits}
export interface ExactBackend {
 readonly kernel:ExactKernel;
 readonly info:ExactKernelInfo;
 /** The ceiling the kernel's WebAssembly memory was loaded with (bytes, whole 64 KiB pages), if any. */
 readonly memoryCapBytes?:number;
 /** Exact volume, area, bounding box and centroid of each body. */
 measure(doc:CadDocument,ids?:readonly string[],options?:ExactRunOptions):ExactMeasureResult;
 /** One AP214 STEP file with one solid per body, in world millimetres. */
 exportStep(doc:CadDocument,ids?:readonly string[],options?:ExactRunOptions):ExactStepResult;
 /** Display meshes of exact features (default: every missing or stale one), for the model given. */
 featureDisplays(doc:CadDocument,ids?:readonly string[],options?:ExactRunOptions):ExactFeatureDisplayResult;
}

export function createExactBackendFromKernel(kernel:ExactKernel,memoryCapBytes=(kernel as Partial<SmlibKernel>).maxMemoryBytes):ExactBackend{
 const info:ExactKernelInfo=Object.freeze({...exactKernelIdentity,smlib:kernel.version,licence:kernel.licence});
 const lower=(input:CadDocument,ids?:readonly string[],options:ExactRunOptions={})=>{
  const doc=validateDocument(input),targets=exactTargets(doc,ids);
  return {doc,targets,solids:targets.map(id=>{
   const solid=lowerDocumentBody(kernel,doc,id,options);
   if(!kernel.isValid(solid))throw new ExactKernelError('kernel-failure',t`${doc.nodes[id].name}: the exact result is not a valid closed solid.`);
   return solid;
  })};
 };
 return {
  kernel,info,...(memoryCapBytes?{memoryCapBytes}:{}),
  measure(input,ids,options){
   return kernel.scope(()=>{
    const {doc,targets,solids}=lower(input,ids,options);
    return {kernel:info,bodies:solids.map((solid,i)=>{
     const box=kernel.bbox(solid),mass=kernel.massProperties(solid);
     return {id:targets[i],name:doc.nodes[targets[i]].name,volume:kernel.volume(solid),area:kernel.area(solid),bounds:{min:[...box.min],max:[...box.max]},centroid:[...mass.centroid],solids:kernel.solidCount(solid)};
    })};
   });
  },
  featureDisplays(input,ids,options={}){
   const doc=validateDocument(input),targets=ids?.length?[...new Set(ids)]:staleExactFeatures(doc);
   if(targets.length>MAX_EXACT_BODIES)throw new ExactKernelError('invalid-input',t`Exact commands are limited to ${MAX_EXACT_BODIES} bodies.`);
   for(const id of targets)if(doc.nodes[id]?.kind!=='exact-feature')throw new ExactKernelError('invalid-input',t`${id} is not an exact feature`);
   return {kernel:info,features:targets.map(id=>kernel.scope(()=>({id,name:doc.nodes[id].name,...exactFeatureDisplay(kernel,doc,id,options)})))};
  },
  exportStep(input,ids,options){
   return kernel.scope(()=>{
    const {doc,targets,solids}=lower(input,ids,options);
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

/**
 * How the kernel loads, and its limits (`exactKernelOptions(limits)` derives the last two):
 * - `maxMemoryBytes`: ceiling for the kernel's WebAssembly memory, applied by the kernel when the
 *   module is instantiated (the wasm bytes are not changed). A job that needs more fails with
 *   `kernel-failure` "ran out of memory" instead of growing the page's memory; the kernel is not to
 *   be trusted afterwards (`isFatalExactError`), so a host discards it, e.g. by ending its worker,
 *   which is also how the memory returns to its baseline.
 * - `guardSeconds`: the kernel's guard for shell, offset and similar steps (default 20 s; 0: none).
 * Like the other options, they count only on the first call in a process or worker.
 */
export type ExactBackendOptions=SmlibLoadOptions;
let shared:Promise<ExactBackend>|undefined;
/** Load SMLib once (per process or worker) and return the exact backend on it. */
export function createExactBackend(options:ExactBackendOptions={}):Promise<ExactBackend>{
 shared??=createSmlibKernel(options).then(kernel=>createExactBackendFromKernel(kernel),error=>{shared=undefined;throw error;});
 return shared;
}

/**
 * Whether `error` from an exact request leaves the kernel unusable: a WebAssembly trap (out of
 * bounds, unreachable, an Emscripten abort), memory exhaustion, or a kernel that reports damage.
 * The kernel's ordinary refusals (`ExactKernelError` from a fillet it cannot build) are not fatal.
 * A host that sees a fatal error discards the kernel (its worker); the next request loads it anew.
 */
export function isFatalExactError(error:unknown):boolean{
 for(let e:unknown=error,depth=0;e&&depth<8;e=(e as {cause?:unknown}).cause,depth++){
  if(typeof WebAssembly!=='undefined'&&e instanceof WebAssembly.RuntimeError)return true;
  if(e instanceof RangeError&&/memory|allocat/i.test(e.message))return true;
  const message=e instanceof Error?e.message:typeof e==='string'?e:'';
  if(/\bAborted\(|out of memory|memory access out of bounds|bad_alloc|Cannot enlarge memory|memory may be damaged|kernel crashed/i.test(message))return true;
 }
 return false;
}

/**
 * One exact request on a loaded backend, with its timing: what the editor's exact worker, the MCP
 * exact thread and the in-thread fallback all run. `loadMs` is the caller's (0 once loaded).
 */
export function runExactRequest(backend:ExactBackend,request:ExactCommandRequest,loadMs=0,options:ExactRunOptions={}):ExactCommandResult{
 const started=performance.now();
 const computed=request.operation==='measure'?{operation:'measure' as const,...backend.measure(request.document,request.bodies,options)}
  :request.operation==='feature-display'?{operation:'feature-display' as const,...backend.featureDisplays(request.document,request.bodies,options)}
  :{operation:'export-step' as const,...backend.exportStep(request.document,request.bodies,options)};
 return {...computed,timing:{loadMs,runMs:performance.now()-started,memoryBytes:backend.kernel.memory().heap}};
}

/**
 * An `ExactCommandHost` that runs the kernel in the calling thread: for hosts without workers,
 * and for tests. It blocks that thread for as long as the kernel runs (on a browser's main thread,
 * the UI), so the editor uses it only when it cannot start its exact worker. An abort before the
 * request starts or while it waits for the kernel to load cancels it; a running kernel call cannot
 * be interrupted in-thread, so an abort during it only discards the result. Pass `limits` (e.g.
 * EXACT_LIMITS_TABLET) to refuse heavy features before they block the thread; without them nothing
 * is refused, as for the MCP and CLI hosts. Full `ExactLimits` also set the kernel's memory ceiling
 * and guard (`exactKernelOptions`) unless the load options give them, since in-thread the guard is
 * the only stop for a shell-like step.
 */
export function createInThreadExactHost(options:ExactBackendOptions&{readonly limits?:ExactFeatureLimits&Partial<ExactLimits>}={}):ExactCommandHost{
 const {limits,...given}=options;
 const load={...(limits&&typeof limits.maxMemoryBytes==='number'&&typeof limits.requestTimeoutMs==='number'?exactKernelOptions(limits as ExactLimits):{}),...given};
 const cancelled=()=>new Error(t('Request cancelled'));
 return {
  async run(request,signal){
   if(signal?.aborted)throw cancelled();
   const started=performance.now(),backend=await createExactBackend(load),loaded=performance.now();
   if(signal?.aborted)throw cancelled();
   // Yield once so a caller that just showed progress gets a frame before the kernel blocks.
   await new Promise(resolve=>setTimeout(resolve,0));
   if(signal?.aborted)throw cancelled();
   const result=runExactRequest(backend,request,loaded-started,{limits});
   if(signal?.aborted)throw cancelled();
   return result;
  },
 };
}
