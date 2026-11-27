import {geometrySignature} from './hash.js';
import {checkDrawingSheets} from './drawing-sheet.js';
import type {DrawingSheet} from './drawing-sheet.js';
import {checkSimulation,simulationTracers} from './simulation.js';
import type {SimulationSettings,MotionTracer} from './simulation.js';
// SPDX-License-Identifier: BSD-3-Clause
import {checkModelProvenance,pruneModelProvenance} from './model-provenance.js';
import type {ModelProvenance} from './model-provenance.js';
import {t as translate} from './i18n.js';
import {checkModelSource} from './model-source.js';
import type {ModelSource} from './model-source.js';
import {compileCode} from './code.js';
import type {CodeProgram} from './code.js';
import {checkFeatures} from './features.js';
import type {PlanarSketch,ExtrusionFeature,RevolutionFeature,MirrorFeature,PatternFeature} from './features.js';
import {checkExactFeatureShape} from './exact-feature.js';
import type {ExactFeature} from './exact-feature.js';
import {checkExactBodyShape} from './exact-body.js';
import type {ExactBody} from './exact-body.js';
import {checkHoleShape} from './fasteners.js';
import type {HoleFeature} from './fasteners.js';
import { checkPhysics } from './physics.js';
import { checkParametricDesign } from './parameters.js';
import type { ParametricDesign } from './parameters.js';
import {checkGenerator} from './generators.js';
import type {GeneratorRecipe} from './generators.js';
import type { PartPhysics, CadJoint } from './physics.js';
export type Vec3 = [number, number, number];
export interface Transform { position: Vec3; rotation: Vec3; scale: Vec3 }
export type Primitive = { kind: 'box'; size: Vec3 } | { kind: 'cylinder'; radius: number; height: number; segments: number } | { kind: 'sphere'; radius: number; segments: number };
export type Shape = Primitive | HoleFeature | ExtrusionFeature | RevolutionFeature | MirrorFeature | PatternFeature | ExactFeature | ExactBody | {kind:'code';program:CodeProgram} | { kind: 'boolean'; operation: 'union' | 'subtract' | 'intersect'; inputs: string[]; useHoleRoles?:true } | { kind: 'mesh'; positions: number[]; indices: number[]; surface?: true };
export type SolidNode = { id: string; name: string; color: string; transform: Transform; reference?: boolean; role?: 'solid'|'hole'; provenance?: string[]; physics?: PartPhysics; generator?:GeneratorRecipe } & Shape;
const noInputs:readonly string[]=[];
export function constructionInputs(node:SolidNode|undefined):readonly string[]{
  if(node?.kind==='boolean')return node.inputs;
  if(node?.kind==='mirror'||node?.kind==='pattern'||node?.kind==='exact-feature')return [node.source];
  return noInputs;
}
export interface CadDocument { format: 'brickwright-cad'; version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48; units: 'mm'; id: string; title: string; nodes: Record<string, SolidNode>; roots: string[]; joints?: CadJoint[]; parametric?: ParametricDesign; sketches?:Record<string,PlanarSketch>; provenance?:ModelProvenance; modelSource?:ModelSource; simulation?:SimulationSettings; tracers?:MotionTracer[]; drawings?:DrawingSheet[] }
export const isCube=(node:SolidNode)=>node.kind==='box'&&node.generator?.preset==='cube';
function linkedCubeValue(previous:readonly number[],next:readonly number[]):number{const changed=next.filter((v,i)=>Math.abs(v-previous[i])>1e-10*Math.max(1,Math.abs(v)));if(changed.some(v=>Math.abs(v-changed[0])>1e-10*Math.max(1,Math.abs(v))))throw new Error(translate('Cube edges are linked; use a Box for independent dimensions'));return changed[0]??next[0];}
export function constrainCubeTransform(node:SolidNode,next:Transform):Transform{if(!isCube(node))return next;if(!vec(next.scale,.001,1000))throw new Error(translate('Cube edges are linked; use a Box for independent dimensions'));const axis=next.scale.map((v,i)=>Math.abs(v/node.transform.scale[i]-1)).reduce((best,v,i,a)=>v>a[best]?i:best,0),scale=next.scale[axis];return {...next,scale:[scale,scale,scale]};}
export function constrainCubeEdit(node:SolidNode,next:SolidNode):SolidNode{if(!isCube(node)||node.kind!=='box'||next.kind!=='box')return next;if(!vec(next.size,.01,100000))throw new Error(translate('Cube edges are linked; use a Box for independent dimensions'));const edge=linkedCubeValue(node.size,next.size);return {...next,size:[edge,edge,edge],transform:constrainCubeTransform(node,next.transform),generator:{...node.generator!,values:{edge}}};}
export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const identityTransform = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
export function newId(): string {
  if(typeof globalThis.crypto?.randomUUID==='function'){try{return crypto.randomUUID();}catch{}}
  if(typeof globalThis.crypto?.getRandomValues!=='function')throw new Error(translate('Secure random identifiers are unavailable in this host'));
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const createDocument = (title = translate('Untitled design')): CadDocument => ({ format: 'brickwright-cad', version: 1, units: 'mm', id: newId(), title, nodes: {}, roots: [] });
/** Fast stale-result guard, not an authenticity/signing mechanism. */
export function documentGeometryKey(doc: CadDocument): string {
  const source=JSON.stringify([doc.id,doc.roots,doc.sketches,doc.parametric,Object.entries(doc.nodes).map(([id,n])=>{const {physics,...geometry}=n;if(doc.version>=5)delete geometry.provenance;return [id,geometry];})]);
  return geometrySignature(source);
}
function fail(message: string): never { throw new Error(translate`Invalid CAD project: ${message}`); }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, min = -1e6, max = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, limit = 160): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= limit && !/[\u0000-\u001f]/.test(v);
const idOk = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(v) && !['constructor', 'prototype', '__proto__'].includes(v);
const vec = (v: unknown, min = -1e6, max = 1e6): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(x => num(x, min, max));

/** Validate before replacing any live state. Unknown versions are refused, never downgraded. */
export function checkDocument(value: unknown): CadDocument {
  if (!record(value) || value.format !== 'brickwright-cad' || ![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48].includes(value.version as number) || value.units !== 'mm') fail(translate('unsupported format, version or units'));
  if (!idOk(value.id) || !text(value.title) || !record(value.nodes) || !Array.isArray(value.roots)) fail(translate('missing document identity, nodes or roots'));
  const nodes = value.nodes as Record<string, unknown>;
  const entries = Object.entries(nodes);
  if (entries.length > 2000 || value.roots.length > 2000) fail(translate('too many objects (maximum 2000)'));
  for (const [id, raw] of entries) {
    if (!idOk(id) || !record(raw) || raw.id !== id || !text(raw.name) || typeof raw.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw.color)) fail(translate`bad node ${id}`);
    if(raw.surface!==undefined&&((value.version as number)<30||raw.kind!=='mesh'||raw.surface!==true||raw.reference!==true))fail(translate('Surface meshes require a reference body and document version 30'));
    if(raw.role!==undefined&&((value.version as number)<7||!['solid','hole'].includes(String(raw.role))||raw.reference===true))fail(translate('Invalid solid/hole role'));
    if(raw.useHoleRoles!==undefined&&((value.version as number)<7||raw.kind!=='boolean'||raw.operation!=='union'||raw.useHoleRoles!==true))fail(translate('Invalid solid/hole combination'));
    const t = raw.transform;
    if(raw.generator!==undefined){if(value.version===1)fail(translate('shape recipes require version 2 or later'));checkGenerator(raw.generator);}
    if (!record(t) || !vec(t.position) || !vec(t.rotation, -360000, 360000) || !vec(t.scale, 0.001, 1000)) fail(translate`bad transform on ${id}`);
    if((raw.generator as GeneratorRecipe|undefined)?.preset==='cube'){const size=raw.size as Vec3,edge=(raw.generator as GeneratorRecipe).values.edge;if(raw.kind!=='box'||!vec(size,.01,100000)||size.some(v=>v!==edge)||(t.scale as Vec3).some(v=>v!==(t.scale as Vec3)[0]))fail(translate('Cube edges are linked; use a Box for independent dimensions'));}
    switch (raw.kind) {
      case 'box': if (!vec(raw.size, 0.01, 100000)) fail(translate`bad box dimensions on ${id}`); break;
      case 'cylinder':
        if (!num(raw.radius, 0.01, 50000) || !num(raw.height, 0.01, 100000) || !Number.isInteger(raw.segments) || !num(raw.segments, 12, 256)) fail(translate`bad cylinder on ${id}`); break;
      case 'sphere':
        if (!num(raw.radius, 0.01, 50000) || !Number.isInteger(raw.segments) || !num(raw.segments, 12, 256)) fail(translate`bad sphere on ${id}`); break;
      case 'code': if((value.version as number)<4)fail(translate('code objects require version 4'));if((raw.program as CodeProgram|undefined)?.version===2&&(value.version as number)<42)fail(translate('CAD Script revision 2 (ruled lofts) requires document version 42'));{const compiled=compileCode(raw.program as CodeProgram);if(compiled.usesSmoothLoft&&(value.version as number)<43)fail(translate('CAD Script smoothLoft requires document version 43'));if(compiled.usesLoftPairing&&(value.version as number)<46)fail(translate('CAD Script loft pairing requires document version 46'));}break;
      case 'extrusion': case 'revolution': break; // Full versioned feature validation follows graph validation.
      case 'pattern':
        if((value.version as number)<14||!idOk(raw.source)||!Object.hasOwn(nodes,raw.source))fail(translate`bad pattern source on ${id}`);
        break;
      case 'exact-feature':
        if(!checkExactFeatureShape(raw,value.version as number,source=>idOk(source)&&Object.hasOwn(nodes,source)))fail(translate`bad exact feature on ${id} (requires document version 41, an existing source and a bounded display mesh)`);
        break;
      case 'hole':
        if(!checkHoleShape(raw,value.version as number))fail(translate`bad standard hole on ${id} (requires document version 47, the hole role and consistent bore, seat and depth)`);
        break;
      case 'exact-body':
        if(!checkExactBodyShape(raw,value.version as number))fail(translate`bad exact body on ${id} (requires document version 45, the B-rep as STEP text of at most 8 MiB, its measures and a bounded display mesh)`);
        break;
      case 'mirror':
        if((value.version as number)<13||!idOk(raw.source)||!Object.hasOwn(nodes,raw.source))fail(translate`bad mirror source on ${id}`);
        break;
      case 'boolean':
        if (!['union', 'subtract', 'intersect'].includes(String(raw.operation)) || !Array.isArray(raw.inputs) || raw.inputs.length < 2 || raw.inputs.length > 100 || new Set(raw.inputs).size !== raw.inputs.length || !raw.inputs.every(x => idOk(x) && Object.hasOwn(nodes, x))) fail(translate`bad boolean inputs on ${id}`); break;
      case 'mesh':
        if (!Array.isArray(raw.positions) || raw.positions.length < 9 || raw.positions.length > 750000 || raw.positions.length % 3 || !raw.positions.every(x => num(x)) || !Array.isArray(raw.indices) || raw.indices.length < (raw.surface===true?3:12) || raw.indices.length > 1500000 || raw.indices.length % 3 || !raw.indices.every(x => Number.isInteger(x) && num(x, 0, (raw.positions as unknown[]).length / 3 - 1))) fail(translate`bad mesh on ${id}`); break;
      default: fail(translate`unsupported shape on ${id}`);
    }
  }
  if (new Set(value.roots).size !== value.roots.length || !value.roots.every(x => idOk(x) && Object.hasOwn(nodes, x))) fail(translate('bad root list'));
  const seen = new Set<string>(); const visiting = new Set<string>(); const heights = new Map<string, number>();
  const visit = (id: string, depth: number): number => {
    if (depth > 100) fail(translate('operation tree is too deep'));
    if (visiting.has(id)) fail(translate('cyclic operation tree'));
    if (seen.has(id)) { if (depth + heights.get(id)! > 100) fail(translate('operation tree is too deep')); return heights.get(id)!; }
    visiting.add(id);
    const node = nodes[id] as SolidNode;
    const height: number = Math.max(0,...constructionInputs(node).map(input=>1+visit(input,depth+1)));
    if (height > 100) fail(translate('operation tree is too deep'));
    visiting.delete(id); seen.add(id); heights.set(id, height); return height;
  };
  // Check all nodes, including malformed unreachable graphs, before normalizing.
  entries.forEach(([id]) => visit(id, 0));
  const reachable = new Set<string>();
  const mark = (id: string) => { if (reachable.has(id)) return; reachable.add(id); const n = nodes[id] as SolidNode; constructionInputs(n).forEach(mark); };
  (value.roots as string[]).forEach(mark);
  if (reachable.size !== entries.length) fail(translate('orphaned nodes'));
  checkModelProvenance(value as unknown as CadDocument);
  checkPhysics(value as unknown as CadDocument);
  checkSimulation(value as unknown as CadDocument);
  checkParametricDesign(value as unknown as CadDocument);
  checkFeatures(value as unknown as CadDocument);
  checkDrawingSheets(value as unknown as CadDocument);
  checkModelSource(value as unknown as CadDocument);
  return value as unknown as CadDocument;
}
export function validateDocument(value: unknown): CadDocument {
  return structuredClone(checkDocument(value));
}
export function parseDocument(source: string): CadDocument {
  if (new TextEncoder().encode(source).length > MAX_DOCUMENT_BYTES) fail(translate('file exceeds 16 MiB'));
  return validateDocument(JSON.parse(source));
}
/** Exact-feature display buffers are written on one line each. Indenting them would put every
 * coordinate on its own line (a filleted box grew to ~317 KB). Only these buffers are compacted,
 * so documents without exact features serialize byte for byte as before, which keeps
 * hash-verified projects, library outputs and attribution hashes stable. */
function compactExactDisplays(document: CadDocument): Map<unknown, string> {
  const buffers = new Map<unknown, string>();
  for (const node of Object.values(document.nodes) as {kind?: string; display?: {positions?: unknown; indices?: unknown}}[]) {
    if ((node.kind !== 'exact-feature' && node.kind !== 'exact-body') || !node.display) continue;
    for (const array of [node.display.positions, node.display.indices])
      if (Array.isArray(array)) buffers.set(array, `\u0000exact-display:${buffers.size}\u0000`);
  }
  return buffers;
}
export function serializeDocument(document: CadDocument): string {
  const valid = validateDocument(document), buffers = compactExactDisplays(valid);
  let result = JSON.stringify(valid, buffers.size ? (_key, value) => buffers.get(value) ?? value : undefined, 2);
  for (const [array, token] of buffers) result = result.replace(JSON.stringify(token), () => JSON.stringify(array));
  if (new TextEncoder().encode(result).length > MAX_DOCUMENT_BYTES) fail(translate('file exceeds 16 MiB'));
  return result;
}
export function freezeDocument(document: CadDocument): CadDocument {
  const freeze = (v: unknown) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(freeze); } };
  freeze(document); return document;
}
export function pruneDocument(doc: CadDocument) {
  const keep = new Set<string>();
  const walk = (id: string) => { if (keep.has(id)) return; keep.add(id); const n = doc.nodes[id]; constructionInputs(n).forEach(walk); };
  doc.roots.forEach(walk);
  Object.keys(doc.nodes).forEach(id => { if (!keep.has(id)) delete doc.nodes[id]; });
  pruneModelProvenance(doc);
  if(doc.version>=8&&doc.tracers)doc.tracers=doc.tracers.filter(trace=>doc.roots.includes(trace.bodyId)&&!doc.nodes[trace.bodyId].reference&&doc.nodes[trace.bodyId].role!=='hole');
  if(doc.parametric)doc.parametric.bindings=doc.parametric.bindings.filter(binding=>keep.has(binding.nodeId));
}
