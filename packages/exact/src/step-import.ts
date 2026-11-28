// SPDX-License-Identifier: BSD-3-Clause
// STEP import as exact bodies: the kernel reads the file strictly (every body a closed solid, or
// the whole file is refused), and each body is stored the way `exact-body` nodes keep it: its
// B-rep re-written by the kernel as one-solid AP214 STEP, its exact measures and its display mesh.
// Nothing here falls back to a mesh importer.
//
// The stored STEP is checked against the measures whenever the kernel reads it (the B-rep cache
// below), so exact work never runs on a body that does not read back as it was imported. Import
// itself does not read it back: that read took a quarter of the import time (the 58-body Feather
// RP2040 board: 8 s of 38 s CPU) and was repeated by the first exact request anyway.
import {MAX_EXACT_BODY_BREP_CHARS,MAX_STEP_IMPORT_BODIES,MAX_STEP_IMPORT_BYTES,STEP_IMPORT_DISPLAY_TOLERANCE,exactBodyKey,t} from '@brickwright/cad-core';
import type {ExactBody,ExactBodyData,ExactProgress,StepImportOccurrence,Vec3} from '@brickwright/cad-core';
import {ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactKernel,ExactSolid} from '@crispcad/exact-kernel';
import {displayTessellation} from './display.js';

export interface ImportedExactBody {
 /** The body's name in the file, or the file's name with its index. */
 name:string;
 /** The body's place in the file's product structure, top product first (exact kernel 0.1.11),
  * or null when the kernel could not match it to the bodies. */
 occurrence:StepImportOccurrence[]|null;
 /** `#rrggbb` from the file, or null. */
 color:string|null;
 body:Omit<ExactBodyData,'origin'>;
}
export interface ExactStepImport {bodies:ImportedExactBody[];notes:string[]}

/** Relative agreement of the stored B-rep's volume and area with the measures taken at import. The
 * re-written STEP of real files reads back within 5e-9 (a Feather RP2040 pin header's area; volumes
 * within 3e-12, boxes identical), so 1e-7 refuses a changed body, not floating-point noise. */
const SAME=1e-7,SAME_BOX_MM=1e-6;
const hex=(color:readonly number[]|null)=>color&&color.length===3&&color.every(c=>Number.isFinite(c))
 ?'#'+color.map(c=>Math.round(Math.min(1,Math.max(0,c))*255).toString(16).padStart(2,'0')).join(''):null;
const rel=(a:number,b:number)=>Math.abs(a-b)/Math.max(Math.abs(b),1e-12);
const point=(v:readonly number[]):Vec3=>[v[0],v[1],v[2]];
/** Names from files are kept short and printable. */
const cleanName=(name:string|null)=>name?.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120)||'';

/** The kernel's STEP refusals (English) in the current locale; other errors unchanged. */
export function translatedStepError(error:unknown):unknown{
 if(!(error instanceof ExactKernelError))return error;
 const m=error.message;let match:RegExpExecArray|null,message:string|undefined;
 if(/^This is not a STEP file/.test(m))message=t('This is not a STEP file: it does not start with ISO-10303-21.');
 else if(/^The STEP file is incomplete/.test(m))message=t('The STEP file is incomplete: it does not end with END-ISO-10303-21; (was it cut short?).');
 else if(/^STEP input must not be empty/.test(m))message=t('The STEP file is empty.');
 else if(/^The STEP file holds no solid/.test(m))message=t('The STEP file holds no solid (no B-rep body).');
 else if((match=/^The STEP file is malformed: ([\s\S]*)$/.exec(m)))message=t`The STEP file is malformed: ${match[1]}`;
 else if((match=/^The STEP file cannot be read exactly: ([\s\S]*)$/.exec(m)))message=t`The STEP file cannot be read exactly, so nothing was imported: ${match[1]}`;
 else if((match=/^The STEP file's (.*) is an open surface \(a sheet\), not a closed solid\.$/.exec(m)))message=t`The STEP file's ${match[1]} is an open surface (a sheet), not a closed solid, so nothing was imported.`;
 else if((match=/^The STEP file's (.*) is not a valid closed solid, even after repair\.$/.exec(m)))message=t`The STEP file's ${match[1]} is not a valid closed solid, even after repair, so nothing was imported.`;
 else if((match=/^The STEP file holds (\d+) bodies; at most (\d+) can be imported\.$/.exec(m)))message=t`The STEP file holds ${match[1]} bodies; at most ${match[2]} can be imported at once.`;
 return message?new ExactKernelError(error.code,message,{cause:error}):error;
}

/**
 * Read a STEP file as exact bodies. Call inside `k.scope`. `file` names the bodies that have no
 * name of their own. Refuses (ExactKernelError) a file above MAX_STEP_IMPORT_BYTES, with more than
 * MAX_STEP_IMPORT_BODIES bodies, any body the kernel cannot read as a closed solid, a body whose
 * B-rep exceeds MAX_EXACT_BODY_BREP_CHARS as STEP, and a body whose display mesh would not close
 * or is too large. `progress` hears of the read and of each body as it is stored and meshed.
 */
export function importStepBodies(k:ExactKernel,bytes:Uint8Array,file:string,progress?:(progress:ExactProgress)=>void):ExactStepImport{
 if(!(bytes instanceof Uint8Array)||!bytes.byteLength)throw new ExactKernelError('invalid-input',t('The STEP file is empty.'));
 if(bytes.byteLength>MAX_STEP_IMPORT_BYTES)throw new ExactKernelError('unsupported',t`The STEP file is larger than ${MAX_STEP_IMPORT_BYTES/1048576} MiB.`);
 let read:ReturnType<ExactKernel['importStepBodies']>;
 progress?.({phase:'read',done:0,total:1});
 try{read=k.importStepBodies(bytes,{maxBodies:MAX_STEP_IMPORT_BODIES});}
 catch(error){throw translatedStepError(error);}
 const base=file.replace(/\.(step|stp)$/i,'')||'STEP body',total=read.bodies.length;
 const bodies=read.bodies.map(({solid,name,color,occurrence},i)=>{
  progress?.({phase:'body',done:i,total});
  const label=cleanName(name)||(total>1?`${base} ${i+1}`:base);
  return {name:label,occurrence:occurrence?occurrence.map(o=>({product:o.product,instance:o.instance})):null,color:hex(color),body:storedBody(k,solid,label)};
 });

 progress?.({phase:'body',done:total,total});
 return {bodies,notes:read.notes};
}

/** One read body as an `exact-body` node keeps it (displayed at STEP_IMPORT_DISPLAY_TOLERANCE). */
export function storedBody(k:ExactKernel,solid:ExactSolid,name:string):Omit<ExactBodyData,'origin'>{
 const volume=k.volume(solid),area=k.area(solid),box=k.bbox(solid);
 const text=k.exportStep(solid);
 if(text.length>MAX_EXACT_BODY_BREP_CHARS)throw new ExactKernelError('unsupported',t`${name}: its exact B-rep is larger than ${MAX_EXACT_BODY_BREP_CHARS/1048576} MiB as STEP, so it cannot be stored in the model.`);
 return {brep:{format:'step',text},measures:{volume,area,min:point(box.min),max:point(box.max)},display:displayTessellation(k,solid,name,STEP_IMPORT_DISPLAY_TOLERANCE)};
}

/**
 * The solid of a stored B-rep, read by the kernel and checked against the measures taken at import:
 * the stored form must rebuild the same solid, or exact work on it would not be exact. Refuses
 * (`kernel-failure`) a B-rep that does not hold exactly one valid solid or whose volume, area or
 * box differ. The solid belongs to the caller's scope (or to none, outside `k.scope`).
 */
export function readStoredBody(k:ExactKernel,node:Pick<ExactBody,'brep'|'measures'>,name:string):ExactSolid{
 const read=k.importStepBodies(node.brep.text,{maxBodies:1});
 if(read.bodies.length!==1)throw new ExactKernelError('kernel-failure',t`${name}: the stored exact B-rep does not hold exactly one solid.`);
 const solid=read.bodies[0].solid,box=k.bbox(solid),m=node.measures;
 if(rel(k.volume(solid),m.volume)>SAME||rel(k.area(solid),m.area)>SAME||[0,1,2].some(i=>Math.abs(box.min[i]-m.min[i])>SAME_BOX_MM||Math.abs(box.max[i]-m.max[i])>SAME_BOX_MM)){
  solid.dispose();
  throw new ExactKernelError('kernel-failure',t`${name}: its stored exact B-rep does not read back as it was imported (volume, area or box differ), so exact work on it is refused. Import the STEP file again.`);
 }
 return solid;
}

/**
 * Solids rebuilt from stored B-reps (checked by readStoredBody), kept between requests (the kernel
 * reads a large body in seconds). Solids are made outside any `k.scope`, so a request's scope does
 * not free them; the least recently used ones beyond `capacity` are disposed, never one the current
 * request needs.
 */
export function createBrepCache(k:ExactKernel,capacity=16){
 const solids=new Map<string,ExactSolid>();
 const read=(node:Pick<ExactBody,'brep'|'measures'>,name:string)=>readStoredBody(k,node,name);
 // A solid is cached for the measures it was checked against, not for its B-rep alone.
 const keyOf=(node:Pick<ExactBody,'brep'|'measures'>)=>`${exactBodyKey(node)}|${JSON.stringify(node.measures)}`;
 return {
  /** Read every exact body of `nodes` that is not cached yet. Call outside `k.scope`. The bodies of
   * this request are all kept (a 58-body STEP board measured with only 16 kept read 42 of them
   * twice); older ones are dropped down to `capacity`. */
  warm(nodes:Iterable<{kind:string;name:string}>){
   const wanted=new Set<string>();
   for(const node of nodes){
    if(node.kind!=='exact-body')continue;
    const body=node as unknown as ExactBody&{name:string},key=keyOf(body),cached=solids.get(key);
    wanted.add(key);
    if(cached){solids.delete(key);solids.set(key,cached);continue;}
    solids.set(key,read(body,body.name));
   }
   for(const [key,solid] of solids){
    if(solids.size<=Math.max(capacity,wanted.size))break;
    if(wanted.has(key))continue;
    solids.delete(key);solid.dispose();
   }
  },
  /** The cached solid, or one read now (owned by the caller's scope). */
  solid(node:ExactBody&{name:string}):ExactSolid{return solids.get(keyOf(node))??read(node,node.name);},
  get size(){return solids.size;},
  clear(){for(const solid of solids.values())solid.dispose();solids.clear();},
 };
}
export type BrepCache=ReturnType<typeof createBrepCache>;
