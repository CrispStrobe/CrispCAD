// SPDX-License-Identifier: BSD-3-Clause
import { checkPhysics } from './physics.js';
import { checkParametricDesign } from './parameters.js';
import type { ParametricDesign } from './parameters.js';
import {checkGenerator} from './generators.js';
import type {GeneratorRecipe} from './generators.js';
import type { PartPhysics, CadJoint } from './physics.js';
export type Vec3 = [number, number, number];
export interface Transform { position: Vec3; rotation: Vec3; scale: Vec3 }
export type Primitive = { kind: 'box'; size: Vec3 } | { kind: 'cylinder'; radius: number; height: number; segments: number } | { kind: 'sphere'; radius: number; segments: number };
export type Shape = Primitive | { kind: 'boolean'; operation: 'union' | 'subtract' | 'intersect'; inputs: string[] } | { kind: 'mesh'; positions: number[]; indices: number[] };
export type SolidNode = { id: string; name: string; color: string; transform: Transform; reference?: boolean; physics?: PartPhysics; generator?:GeneratorRecipe } & Shape;
export interface CadDocument { format: 'brickwright-cad'; version: 1 | 2; units: 'mm'; id: string; title: string; nodes: Record<string, SolidNode>; roots: string[]; joints?: CadJoint[]; parametric?: ParametricDesign }
export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const identityTransform = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
export function newId(): string {
  if(typeof globalThis.crypto?.randomUUID==='function'){try{return crypto.randomUUID();}catch{}}
  if(typeof globalThis.crypto?.getRandomValues!=='function')throw new Error('Secure random identifiers are unavailable in this host');
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const createDocument = (title = 'Untitled design'): CadDocument => ({ format: 'brickwright-cad', version: 1, units: 'mm', id: newId(), title, nodes: {}, roots: [] });
/** Fast stale-result guard, not an authenticity/signing mechanism. */
export function documentGeometryKey(doc: CadDocument): string {
  const source=JSON.stringify([doc.id,doc.roots,Object.entries(doc.nodes).map(([id,n])=>{const {physics,...geometry}=n;return [id,geometry];})]);let a=2166136261,b=3339675911;
  for(let i=0;i<source.length;i++){a=Math.imul(a^source.charCodeAt(i),16777619);b=Math.imul(b^source.charCodeAt(i),2246822519);}return `${source.length}:${a>>>0}:${b>>>0}`;
}
function fail(message: string): never { throw new Error(`Invalid CAD project: ${message}`); }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, min = -1e6, max = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, limit = 160): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= limit && !/[\u0000-\u001f]/.test(v);
const idOk = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(v) && !['constructor', 'prototype', '__proto__'].includes(v);
const vec = (v: unknown, min = -1e6, max = 1e6): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(x => num(x, min, max));

/** Validate before replacing any live state. Unknown versions are refused, never downgraded. */
export function checkDocument(value: unknown): CadDocument {
  if (!record(value) || value.format !== 'brickwright-cad' || ![1,2].includes(value.version as number) || value.units !== 'mm') fail('unsupported format, version or units');
  if (!idOk(value.id) || !text(value.title) || !record(value.nodes) || !Array.isArray(value.roots)) fail('missing document identity, nodes or roots');
  const nodes = value.nodes as Record<string, unknown>;
  const entries = Object.entries(nodes);
  if (entries.length > 2000 || value.roots.length > 2000) fail('too many objects (maximum 2000)');
  for (const [id, raw] of entries) {
    if (!idOk(id) || !record(raw) || raw.id !== id || !text(raw.name) || typeof raw.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw.color)) fail(`bad node ${id}`);
    const t = raw.transform;
    if(raw.generator!==undefined){if(value.version!==2)fail('shape recipes require version 2');checkGenerator(raw.generator);}
    if (!record(t) || !vec(t.position) || !vec(t.rotation, -360000, 360000) || !vec(t.scale, 0.001, 1000)) fail(`bad transform on ${id}`);
    switch (raw.kind) {
      case 'box': if (!vec(raw.size, 0.01, 100000)) fail(`bad box dimensions on ${id}`); break;
      case 'cylinder':
        if (!num(raw.radius, 0.01, 50000) || !num(raw.height, 0.01, 100000) || !Number.isInteger(raw.segments) || !num(raw.segments, 12, 256)) fail(`bad cylinder on ${id}`); break;
      case 'sphere':
        if (!num(raw.radius, 0.01, 50000) || !Number.isInteger(raw.segments) || !num(raw.segments, 12, 256)) fail(`bad sphere on ${id}`); break;
      case 'boolean':
        if (!['union', 'subtract', 'intersect'].includes(String(raw.operation)) || !Array.isArray(raw.inputs) || raw.inputs.length < 2 || raw.inputs.length > 100 || new Set(raw.inputs).size !== raw.inputs.length || !raw.inputs.every(x => idOk(x) && Object.hasOwn(nodes, x))) fail(`bad boolean inputs on ${id}`); break;
      case 'mesh':
        if (!Array.isArray(raw.positions) || raw.positions.length < 9 || raw.positions.length > 750000 || raw.positions.length % 3 || !raw.positions.every(x => num(x)) || !Array.isArray(raw.indices) || raw.indices.length < 12 || raw.indices.length > 1500000 || raw.indices.length % 3 || !raw.indices.every(x => Number.isInteger(x) && num(x, 0, (raw.positions as unknown[]).length / 3 - 1))) fail(`bad mesh on ${id}`); break;
      default: fail(`unsupported shape on ${id}`);
    }
  }
  if (new Set(value.roots).size !== value.roots.length || !value.roots.every(x => idOk(x) && Object.hasOwn(nodes, x))) fail('bad root list');
  const seen = new Set<string>(); const visiting = new Set<string>(); const heights = new Map<string, number>();
  const visit = (id: string, depth: number): number => {
    if (depth > 100) fail('operation tree is too deep');
    if (visiting.has(id)) fail('cyclic operation tree');
    if (seen.has(id)) { if (depth + heights.get(id)! > 100) fail('operation tree is too deep'); return heights.get(id)!; }
    visiting.add(id);
    const node = nodes[id] as SolidNode;
    const height: number = node.kind === 'boolean' ? 1 + Math.max(...node.inputs.map(x => visit(x, depth + 1))) : 0;
    if (height > 100) fail('operation tree is too deep');
    visiting.delete(id); seen.add(id); heights.set(id, height); return height;
  };
  // Check all nodes, including malformed unreachable graphs, before normalizing.
  entries.forEach(([id]) => visit(id, 0));
  const reachable = new Set<string>();
  const mark = (id: string) => { if (reachable.has(id)) return; reachable.add(id); const n = nodes[id] as SolidNode; if (n.kind === 'boolean') n.inputs.forEach(mark); };
  (value.roots as string[]).forEach(mark);
  if (reachable.size !== entries.length) fail('orphaned nodes');
  checkPhysics(value as unknown as CadDocument);
  checkParametricDesign(value as unknown as CadDocument);
  return value as unknown as CadDocument;
}
export function validateDocument(value: unknown): CadDocument {
  return structuredClone(checkDocument(value));
}
export function parseDocument(source: string): CadDocument {
  if (new TextEncoder().encode(source).length > MAX_DOCUMENT_BYTES) fail('file exceeds 16 MiB');
  return validateDocument(JSON.parse(source));
}
export function serializeDocument(document: CadDocument): string {
  const result = JSON.stringify(validateDocument(document), null, 2);
  if (new TextEncoder().encode(result).length > MAX_DOCUMENT_BYTES) fail('file exceeds 16 MiB');
  return result;
}
export function freezeDocument(document: CadDocument): CadDocument {
  const freeze = (v: unknown) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(freeze); } };
  freeze(document); return document;
}
export function pruneDocument(doc: CadDocument) {
  const keep = new Set<string>();
  const walk = (id: string) => { if (keep.has(id)) return; keep.add(id); const n = doc.nodes[id]; if (n.kind === 'boolean') n.inputs.forEach(walk); };
  doc.roots.forEach(walk);
  Object.keys(doc.nodes).forEach(id => { if (!keep.has(id)) delete doc.nodes[id]; });
  if(doc.parametric)doc.parametric.bindings=doc.parametric.bindings.filter(binding=>keep.has(binding.nodeId));
}
