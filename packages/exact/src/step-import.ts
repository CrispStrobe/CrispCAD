// SPDX-License-Identifier: BSD-3-Clause
// STEP import as exact bodies: the kernel reads the file strictly (every body a closed solid, or
// the whole file is refused), and each body is stored the way `exact-body` nodes keep it: its
// B-rep re-written by the kernel as one-solid AP214 STEP (checked to read back the same), its
// exact measures and its display mesh. Nothing here falls back to a mesh importer.
import {MAX_EXACT_BODY_BREP_CHARS,MAX_STEP_IMPORT_BODIES,MAX_STEP_IMPORT_BYTES,exactBodyKey,t} from '@brickwright/cad-core';
import type {ExactBody,ExactBodyData,Vec3} from '@brickwright/cad-core';
import {ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactKernel,ExactSolid} from '@crispcad/exact-kernel';
import {displayTessellation} from './display.js';

export interface ImportedExactBody {
 /** The body's name in the file, or the file's name with its index. */
 name:string;
 /** `#rrggbb` from the file, or null. */
 color:string|null;
 body:Omit<ExactBodyData,'origin'>;
}
export interface ExactStepImport {bodies:ImportedExactBody[];notes:string[]}

/** Relative agreement of the stored B-rep's volume and area with the body that was read. The
 * re-written STEP of real files reads back within 5e-9 (a Feather RP2040 pin header's area; volumes
 * within 3e-12, boxes identical), so 1e-7 refuses a changed body, not floating-point noise. */
const SAME=1e-7;
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
 * or is too large.
 */
export function importStepBodies(k:ExactKernel,bytes:Uint8Array,file:string):ExactStepImport{
 if(!(bytes instanceof Uint8Array)||!bytes.byteLength)throw new ExactKernelError('invalid-input',t('The STEP file is empty.'));
 if(bytes.byteLength>MAX_STEP_IMPORT_BYTES)throw new ExactKernelError('unsupported',t`The STEP file is larger than ${MAX_STEP_IMPORT_BYTES/1048576} MiB.`);
 let read:ReturnType<ExactKernel['importStepBodies']>;
 try{read=k.importStepBodies(bytes,{maxBodies:MAX_STEP_IMPORT_BODIES});}
 catch(error){throw translatedStepError(error);}
 const base=file.replace(/\.(step|stp)$/i,'')||'STEP body';
 const bodies=read.bodies.map(({solid,name,color},i)=>{
  const label=cleanName(name)||(read.bodies.length>1?`${base} ${i+1}`:base);
  return {name:label,color:hex(color),body:storedBody(k,solid,label)};
 });
 return {bodies,notes:read.notes};
}

/** One read body as an `exact-body` node keeps it. */
export function storedBody(k:ExactKernel,solid:ExactSolid,name:string):Omit<ExactBodyData,'origin'>{
 const volume=k.volume(solid),area=k.area(solid),box=k.bbox(solid);
 const text=k.exportStep(solid);
 if(text.length>MAX_EXACT_BODY_BREP_CHARS)throw new ExactKernelError('unsupported',t`${name}: its exact B-rep is larger than ${MAX_EXACT_BODY_BREP_CHARS/1048576} MiB as STEP, so it cannot be stored in the model.`);
 // The stored form must rebuild the same solid, or later exact work on it would not be exact.
 const back=k.importStepBodies(text,{maxBodies:1}).bodies[0].solid,backBox=k.bbox(back);
 if(rel(k.volume(back),volume)>SAME||rel(k.area(back),area)>SAME||[0,1,2].some(i=>Math.abs(backBox.min[i]-box.min[i])>1e-6||Math.abs(backBox.max[i]-box.max[i])>1e-6))
  throw new ExactKernelError('kernel-failure',t`${name}: the exact kernel cannot store this body faithfully (its STEP does not read back the same).`);
 return {brep:{format:'step',text},measures:{volume,area,min:point(box.min),max:point(box.max)},display:displayTessellation(k,solid,name)};
}

/**
 * Solids rebuilt from stored B-reps, kept between requests (the kernel reads a large body in
 * seconds). Solids are made outside any `k.scope`, so a request's scope does not free them; the
 * least recently used ones are disposed beyond `capacity`.
 */
export function createBrepCache(k:ExactKernel,capacity=16){
 const solids=new Map<string,ExactSolid>();
 const read=(node:Pick<ExactBody,'brep'>,name:string)=>{
  const read=k.importStepBodies(node.brep.text,{maxBodies:1});
  if(read.bodies.length!==1)throw new ExactKernelError('kernel-failure',t`${name}: the stored exact B-rep does not hold exactly one solid.`);
  return read.bodies[0].solid;
 };
 return {
  /** Read every exact body of `nodes` that is not cached yet. Call outside `k.scope`. */
  warm(nodes:Iterable<{kind:string;name:string}>){
   for(const node of nodes){
    if(node.kind!=='exact-body')continue;
    const body=node as unknown as ExactBody&{name:string},key=exactBodyKey(body),cached=solids.get(key);
    if(cached){solids.delete(key);solids.set(key,cached);continue;}
    solids.set(key,read(body,body.name));
    while(solids.size>capacity){const [oldest,solid]=solids.entries().next().value!;solids.delete(oldest);solid.dispose();}
   }
  },
  /** The cached solid, or one read now (owned by the caller's scope). */
  solid(node:ExactBody&{name:string}):ExactSolid{return solids.get(exactBodyKey(node))??read(node,node.name);},
  get size(){return solids.size;},
  clear(){for(const solid of solids.values())solid.dispose();solids.clear();},
 };
}
export type BrepCache=ReturnType<typeof createBrepCache>;
