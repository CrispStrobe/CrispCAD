// SPDX-License-Identifier: BSD-3-Clause
// STEP evidence (Phase 6.5): read a STEP file with the exact kernel and summarise each body's
// exact measures and topology for a review (core: step-evidence.ts). Original code. Read-only: the
// bodies are read inside the caller's scope and discarded; nothing is imported into a model.
import {MAX_STEP_IMPORT_BODIES,MAX_STEP_IMPORT_BYTES,STEP_EVIDENCE_VERSION,readStepHeader,sha256HexSync,t} from '@brickwright/cad-core';
import type {StepEvidence,StepEvidenceBody,StepEvidenceKindCount} from '@brickwright/cad-core';
import {ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactKernel} from '@crispcad/exact-kernel';
import {translatedStepError} from './step-import.js';

const hex=(color:readonly number[]|null)=>color&&color.length===3&&color.every(c=>Number.isFinite(c))
 ?'#'+color.map(c=>Math.round(Math.min(1,Math.max(0,c))*255).toString(16).padStart(2,'0')).join(''):null;
const cleanName=(name:string|null)=>name?.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120)||'';

/** Evidence of every body in a STEP file. Call inside `k.scope`. Refuses what STEP import refuses
 * (not STEP, no solid, a body the reader cannot build), so evidence never silently drops a body. */
export function stepFileEvidence(k:ExactKernel,bytes:Uint8Array,file:string):StepEvidence{
 if(!(bytes instanceof Uint8Array)||!bytes.byteLength)throw new ExactKernelError('invalid-input',t('The STEP file is empty.'));
 if(bytes.byteLength>MAX_STEP_IMPORT_BYTES)throw new ExactKernelError('unsupported',t`The STEP file is larger than ${MAX_STEP_IMPORT_BYTES/1048576} MiB.`);
 let read:ReturnType<ExactKernel['importStepBodies']>;
 try{read=k.importStepBodies(bytes,{maxBodies:MAX_STEP_IMPORT_BODIES});}
 catch(error){throw translatedStepError(error);}
 const base=file.replace(/\.(step|stp)$/i,'')||'STEP body';
 const bodies=read.bodies.map(({solid,name,color},i):StepEvidenceBody=>{
  const topology=k.topology(solid),box=k.bbox(solid),mass=k.massProperties(solid);
  const bySurface:Record<string,{count:number;areaMm2:number}>={},byCurve:Record<string,{count:number;lengthMm:number}>={};
  for(const face of topology.faces){const entry=bySurface[face.surface]??={count:0,areaMm2:0};entry.count++;entry.areaMm2+=face.area;}
  for(const edge of topology.edges){const entry=byCurve[edge.curve]??={count:0,lengthMm:0};entry.count++;entry.lengthMm+=edge.length;}
  return {name:cleanName(name)||(read.bodies.length>1?`${base} ${i+1}`:base),color:hex(color),valid:k.isValid(solid),solids:k.solidCount(solid),
   volumeMm3:k.volume(solid),areaMm2:k.area(solid),bounds:{min:[...box.min],max:[...box.max]},centroid:[...mass.centroid],principalMoments:[...mass.principalMoments].sort((a,b)=>a-b),
   faces:{total:topology.faces.length,bySurface:bySurface as Record<string,StepEvidenceKindCount>,smallestMm2:topology.faces.length?Math.min(...topology.faces.map(f=>f.area)):0},
   edges:{total:topology.edges.length,byCurve:byCurve as Record<string,StepEvidenceKindCount>,closed:topology.edges.filter(e=>e.closed).length,
    free:topology.edges.filter(e=>e.faces.length!==2).length,shortestMm:topology.edges.length?Math.min(...topology.edges.map(e=>e.length)):0}};
 });
 // The header is ASCII text at the start of the file; only that much is decoded.
 const head=new TextDecoder('latin1').decode(bytes.subarray(0,64*1024));
 return {version:STEP_EVIDENCE_VERSION,file:{name:file,bytes:bytes.byteLength,sha256:sha256HexSync(bytes),header:readStepHeader(head)},bodies,notes:[...read.notes],
  totals:{volumeMm3:bodies.reduce((s,b)=>s+b.volumeMm3,0),areaMm2:bodies.reduce((s,b)=>s+b.areaMm2,0),faces:bodies.reduce((s,b)=>s+b.faces.total,0),edges:bodies.reduce((s,b)=>s+b.edges.total,0)},
  disclaimer:t('Evidence from the exact kernel’s reading of the file: measures and topology as read, not a certificate of the design or of the exporting system.')};
}
