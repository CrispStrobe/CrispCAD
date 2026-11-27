// SPDX-License-Identifier: BSD-3-Clause
/**
 * STEP evidence (Phase 6.5 of docs/CRISPCAD-CONVERGENCE.md): what a STEP file holds, read by the
 * exact kernel, as evidence for a review: per body its validity, exact volume, area, bounding box,
 * centroid and principal moments, and a topology summary (faces by surface kind with their area,
 * edges by curve kind with their length, free edges, the shortest edge and smallest face); for the
 * file its size, SHA-256, schema and header. For the model's own bodies it is a round trip: each
 * body is written as its own STEP file (bodies that touch would merge in one), read back, and the
 * read-back measures are compared with the model's; `file` then sums the files (SHA-256 of their
 * concatenation).
 *
 * The lab's guide `mcp-step-evidence` attaches build evidence to every modeling step; this is the
 * same idea for exchange files (original code). Core holds the plain data, the header reader, the
 * command parser and the text formatter; the exact backend computes it (`step-evidence` request).
 * Read-only: nothing is imported into the model.
 */
import type {CadSession} from './session.js';
import {commandTokens} from './command-arguments.js';
import {t} from './i18n.js';

export const STEP_EVIDENCE_VERSION=1;
/** Round trip: read-back volume and area agree with the model within this relative deviation. */
export const STEP_ROUND_TRIP_TOLERANCE=1e-6;
export interface StepEvidenceKindCount {readonly count:number;readonly areaMm2?:number;readonly lengthMm?:number}
export interface StepEvidenceBody {
 readonly name:string;
 readonly color:string|null;
 /** The kernel's validity check of the solid (closed, consistently oriented, no self-intersections). */
 readonly valid:boolean;
 readonly solids:number;
 readonly volumeMm3:number;
 readonly areaMm2:number;
 readonly bounds:{readonly min:readonly number[];readonly max:readonly number[]};
 readonly centroid:readonly number[];
 /** Principal moments of inertia at unit density (mm⁵), ascending. */
 readonly principalMoments:readonly number[];
 readonly faces:{readonly total:number;readonly bySurface:Readonly<Record<string,StepEvidenceKindCount>>;readonly smallestMm2:number};
 readonly edges:{readonly total:number;readonly byCurve:Readonly<Record<string,StepEvidenceKindCount>>;readonly closed:number;
  /** Edges that do not bound exactly two faces (an open or non-manifold shell). Seams bound one face twice. */
  readonly free:number;readonly shortestMm:number};
}
export interface StepFileHeader {readonly schema:readonly string[];readonly description?:string;readonly name?:string;readonly timestamp?:string;readonly preprocessor?:string;readonly originatingSystem?:string}
export interface StepRoundTripBody {readonly id:string;readonly name:string;readonly volumeMm3:number;readonly readVolumeMm3:number;readonly areaMm2:number;readonly readAreaMm2:number;readonly volumeDeviation:number;readonly areaDeviation:number;readonly pass:boolean}
export interface StepEvidence {
 readonly version:number;
 readonly file:{readonly name:string;readonly bytes:number;readonly sha256:string;readonly header:StepFileHeader};
 readonly bodies:readonly StepEvidenceBody[];
 /** The reader's notes on bodies it repaired (healed or stitched faces). */
 readonly notes:readonly string[];
 readonly totals:{readonly volumeMm3:number;readonly areaMm2:number;readonly faces:number;readonly edges:number};
 /** Model bodies only: each written as its own STEP file and read back. */
 readonly roundTrip?:{readonly tolerance:number;readonly bodies:readonly StepRoundTripBody[];readonly pass:boolean};
 readonly disclaimer:string;
}

const strings=(text:string)=>[...text.matchAll(/'((?:[^']|'')*)'/g)].map(m=>m[1].replace(/''/g,"'"));
/** FILE_DESCRIPTION, FILE_NAME and FILE_SCHEMA from a STEP file's HEADER section. */
export function readStepHeader(text:string):StepFileHeader{
 const header=/HEADER\s*;([\s\S]*?)ENDSEC\s*;/i.exec(text.slice(0,64*1024))?.[1]??'';
 const entity=(name:string)=>new RegExp(`${name}\\s*\\(([\\s\\S]*?)\\)\\s*;`,'i').exec(header)?.[1];
 const description=entity('FILE_DESCRIPTION'),name=entity('FILE_NAME'),schema=entity('FILE_SCHEMA');
 const named=name?strings(name):[],described=description?strings(description):[];
 const optional=(key:keyof StepFileHeader,value:string|undefined)=>value&&value.trim()?{[key]:value.trim().slice(0,200)}:{};
 // FILE_NAME(name, time_stamp, (author), (organization), preprocessor_version, originating_system, authorisation)
 const lists=name?[...name.matchAll(/\(([^()]*)\)/g)].map(m=>m[0]):[],flat=name?strings(name.replace(/\([^()]*\)/g,'')):[];
 return {schema:schema?strings(schema).map(s=>s.trim()).filter(Boolean):[],...optional('description',described[0]),...optional('name',named[0]),...optional('timestamp',named[1]),
  ...(lists.length>=2?{...optional('preprocessor',flat[2]),...optional('originatingSystem',flat[3])}:{})};
}

const quote=(value:string)=>/^[A-Za-z0-9_-]+$/.test(value)?value:'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
const usage=()=>t('Usage: evidence step [all|"name"|id ...] | evidence step --file <file.step>.');
/** `evidence step [all|"name"|id ...]` (round trip of model bodies; empty: the selection or all) or `evidence step --file <path>`. */
export function parseStepEvidenceCommand(session:CadSession,tail:string):{bodies:string[];file?:string;invocation:string}{
 const tokens=commandTokens(tail),doc=session.state.document;
 if(!tokens.length||tokens[0].quoted||tokens[0].value.toLowerCase()!=='step')throw new Error(usage());
 const rest=tokens.slice(1);
 if(rest.length&&!rest[0].quoted&&rest[0].value.toLowerCase()==='--file'){
  if(rest.length!==2)throw new Error(usage());
  return {bodies:[],file:rest[1].value,invocation:`evidence step --file ${quote(rest[1].value)}`};
 }
 if(rest.some(token=>!token.quoted&&token.value.startsWith('--')))throw new Error(usage());
 let bodies:string[];
 if(!rest.length)bodies=session.state.selection.filter(id=>doc.roots.includes(id));
 else if(rest.length===1&&!rest[0].quoted&&rest[0].value.toLowerCase()==='all')bodies=[];
 else bodies=[...new Set(rest.map(({value})=>{
  if(doc.roots.includes(value))return value;
  const matches=doc.roots.filter(id=>doc.nodes[id].name===value);
  if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${value}`);
  return matches[0];
 }))];
 return {bodies,invocation:`evidence step ${bodies.length?bodies.map(quote).join(' '):'all'}`};
}

const fmt=(value:number,digits=6)=>String(Number(value.toPrecision(digits))+0);
const kinds=(record:Readonly<Record<string,StepEvidenceKindCount>>,unit:'areaMm2'|'lengthMm')=>Object.entries(record).sort((a,b)=>b[1].count-a[1].count).map(([kind,v])=>`${kind} ${v.count}${v[unit]!==undefined?` (${fmt(v[unit]!,4)} ${unit==='areaMm2'?'mm²':'mm'})`:''}`).join(', ');
/** The evidence as text for the terminal and the CLI. */
export function formatStepEvidence(e:StepEvidence):string{
 const h=e.file.header;
 const lines=[t`STEP evidence: ${e.file.name}, ${e.file.bytes} bytes, SHA-256 ${e.file.sha256}`,
  t`Schema: ${h.schema.join(', ')||t('none given')}${h.originatingSystem?' · '+h.originatingSystem:''}${h.timestamp?' · '+h.timestamp:''}`,
  t`${e.bodies.length} bodies: ${fmt(e.totals.volumeMm3)} mm³, ${fmt(e.totals.areaMm2)} mm², ${e.totals.faces} faces, ${e.totals.edges} edges`];
 for(const b of e.bodies){
  lines.push(`  ${b.name}${b.color?' ('+b.color+')':''}: ${b.valid?t('valid solid'):t('NOT a valid solid')} · ${fmt(b.volumeMm3)} mm³ · ${fmt(b.areaMm2)} mm² · ${t('box')} [${b.bounds.min.map(v=>fmt(v)).join(', ')}]–[${b.bounds.max.map(v=>fmt(v)).join(', ')}] · ${t('centroid')} [${b.centroid.map(v=>fmt(v)).join(', ')}]`);
  lines.push(`    ${t('faces')} ${b.faces.total}: ${kinds(b.faces.bySurface,'areaMm2')}; ${t('smallest')} ${fmt(b.faces.smallestMm2,4)} mm²`);
  lines.push(`    ${t('edges')} ${b.edges.total}: ${kinds(b.edges.byCurve,'lengthMm')}; ${t('closed')} ${b.edges.closed}, ${t('free')} ${b.edges.free}; ${t('shortest')} ${fmt(b.edges.shortestMm,4)} mm`);
 }
 for(const note of e.notes)lines.push(t`Reader note: ${note}`);
 if(e.roundTrip){
  lines.push(e.roundTrip.pass?t`Round trip: every body reads back within ${e.roundTrip.tolerance} (volume and area).`:t`Round trip: some bodies differ by more than ${e.roundTrip.tolerance}.`);
  for(const r of e.roundTrip.bodies)lines.push(`  ${r.name}: ${t('volume')} ${fmt(r.volumeMm3)} → ${fmt(r.readVolumeMm3)} (${r.volumeDeviation.toExponential(1)}), ${t('area')} ${fmt(r.areaMm2)} → ${fmt(r.readAreaMm2)} (${r.areaDeviation.toExponential(1)})${r.pass?'':' ✗'}`);
 }
 return lines.join('\n');
}
