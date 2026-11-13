// SPDX-License-Identifier: BSD-3-Clause
import type {CadDocument, SolidNode} from './document.js';

export type ParameterUnit = 'mm' | 'deg' | 'scalar';
export interface NamedParameter {expression: string; unit: ParameterUnit}
export type DrivenProperty = 'width' | 'depth' | 'height' | 'radius' |
  'positionX' | 'positionY' | 'positionZ' | 'rotationX' | 'rotationY' | 'rotationZ' |
  'scaleX' | 'scaleY' | 'scaleZ';
export interface ParameterBinding {nodeId: string; property: DrivenProperty; expression: string}
export interface ParametricDesign {version: 1; parameters: Record<string, NamedParameter>; bindings: ParameterBinding[]}
export interface Quantity {value: number; length: number; angle: number}
const units: Record<string, Quantity> = {
  mm: {value: 1, length: 1, angle: 0}, cm: {value: 10, length: 1, angle: 0},
  m: {value: 1000, length: 1, angle: 0}, in: {value: 25.4, length: 1, angle: 0},
  deg: {value: 1, length: 0, angle: 1}, rad: {value: 180 / Math.PI, length: 0, angle: 1},
};
const dimensions = (unit: ParameterUnit): [number, number] => unit === 'mm' ? [1, 0] : unit === 'deg' ? [0, 1] : [0, 0];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validName = (name: string) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) && !Object.hasOwn(units, name) && !['constructor','prototype','__proto__'].includes(name);
function error(message: string): never {throw new Error(`Parameters: ${message}`);}
function finite(q: Quantity): Quantity {
  if (!Number.isFinite(q.value) || Math.abs(q.value) > 1e9 || Math.abs(q.length) > 8 || Math.abs(q.angle) > 8) error('result is outside the supported range');
  return q;
}
function asUnit(q: Quantity, unit: ParameterUnit): Quantity {
  const [length, angle] = dimensions(unit);
  // Bare numeric expressions are interpreted in the field's declared unit.
  if (q.length === 0 && q.angle === 0) return {...q, length, angle};
  if (q.length !== length || q.angle !== angle) error(`expression must produce ${unit}`);
  return q;
}

/** Original bounded arithmetic parser. Never evals JS or accesses object members. */
export function evaluateExpression(source: string, lookup: (name: string) => Quantity): Quantity {
  if (typeof source !== 'string' || !source.trim() || source.length > 256) error('expression must contain 1–256 characters');
  const tokens: string[] = [];
  let at = 0;
  while (at < source.length) {
    if (/\s/.test(source[at])) {at++; continue;}
    const token = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z][A-Za-z0-9_]*|^[()+*/-]/.exec(source.slice(at))?.[0];
    if (!token) error(`unsupported expression near “${source.slice(at, at + 12)}”`);
    tokens.push(token); at += token.length;
    if (tokens.length > 128) error('expression has too many tokens');
  }
  let cursor = 0;
  function primary(depth: number): Quantity {
    if (depth > 32) error('expression is too deeply nested');
    const token = tokens[cursor++];
    if (token === '+' || token === '-') {const q = primary(depth + 1); return finite({...q, value: token === '-' ? -q.value : q.value});}
    if (token === '(') {const q = sum(depth + 1); if (tokens[cursor++] !== ')') error('missing closing parenthesis'); return q;}
    if (token && /^(?:\d|\.)/.test(token)) {
      let q: Quantity = {value: Number(token), length: 0, angle: 0};
      if (Object.hasOwn(units, tokens[cursor])) {const u = units[tokens[cursor++]]; q = {...u, value: q.value * u.value};}
      return finite(q);
    }
    if (token && /^[A-Za-z]/.test(token)) {
      if (Object.hasOwn(units, token)) error('put a number before a unit');
      return finite(lookup(token));
    }
    return error('expected a number, parameter or parenthesis');
  }
  function product(depth: number): Quantity {
    let q = primary(depth);
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operation = tokens[cursor++], b = primary(depth);
      if (operation === '/' && b.value === 0) error('division by zero');
      q = finite({value: operation === '*' ? q.value * b.value : q.value / b.value,
        length: q.length + (operation === '*' ? b.length : -b.length), angle: q.angle + (operation === '*' ? b.angle : -b.angle)});
    }
    return q;
  }
  function sum(depth: number): Quantity {
    let q = product(depth);
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operation = tokens[cursor++], b = product(depth);
      if (q.length !== b.length || q.angle !== b.angle) error('addition/subtraction requires matching units (for example width + 5 mm)');
      q = finite({...q, value: q.value + (operation === '+' ? b.value : -b.value)});
    }
    return q;
  }
  const result = sum(0);
  if (cursor !== tokens.length) error(`unexpected token “${tokens[cursor]}”`);
  return result;
}

export function evaluateParameters(design: ParametricDesign): Record<string, Quantity> {
  if (!record(design) || design.version !== 1 || !record(design.parameters) || !Array.isArray(design.bindings) || design.bindings.length > 256) error('invalid design schema');
  const entries = Object.entries(design.parameters);
  if (entries.length > 64) error('at most 64 named parameters are supported');
  for (const [name, parameter] of entries) {
    if (!validName(name) || !record(parameter) || !['mm','deg','scalar'].includes(String(parameter.unit)) || typeof parameter.expression !== 'string') error(`invalid parameter “${name}”`);
  }
  const result: Record<string, Quantity> = Object.create(null), visiting = new Set<string>();
  function resolve(name: string): Quantity {
    if (Object.hasOwn(result, name)) return result[name];
    if (!Object.hasOwn(design.parameters, name)) error(`unknown parameter “${name}”`);
    if (visiting.has(name)) error(`dependency cycle at “${name}”`);
    visiting.add(name);
    const p = design.parameters[name];
    result[name] = asUnit(evaluateExpression(p.expression, resolve), p.unit);
    visiting.delete(name);
    return result[name];
  }
  entries.forEach(([name]) => resolve(name));
  return result;
}

const transformFields: Record<string, ['position'|'rotation'|'scale', number]> = {
  positionX:['position',0],positionY:['position',1],positionZ:['position',2],
  rotationX:['rotation',0],rotationY:['rotation',1],rotationZ:['rotation',2],
  scaleX:['scale',0],scaleY:['scale',1],scaleZ:['scale',2],
};
export function drivenProperties(node: SolidNode): DrivenProperty[] {
  const shape: DrivenProperty[] = node.kind === 'box' ? ['width','depth','height'] : node.kind === 'cylinder' ? ['radius','height'] : node.kind === 'sphere' ? ['radius'] : [];
  return [...shape, ...Object.keys(transformFields) as DrivenProperty[]];
}
export const propertyUnit = (property: DrivenProperty): ParameterUnit => property.startsWith('rotation') ? 'deg' : property.startsWith('scale') ? 'scalar' : 'mm';
export function propertyValue(node: SolidNode, property: DrivenProperty): number {
  if (!drivenProperties(node).includes(property)) error(`“${property}” is not available on ${node.name}`);
  if (Object.hasOwn(transformFields, property)) {const [key, axis] = transformFields[property]; return node.transform[key][axis];}
  if (node.kind === 'box') return node.size[['width','depth','height'].indexOf(property)];
  if (node.kind === 'cylinder') return property === 'radius' ? node.radius : node.height;
  if (node.kind === 'sphere') return node.radius;
  return error('unsupported driven property');
}
function setProperty(node: SolidNode, property: DrivenProperty, value: number) {
  if (Object.hasOwn(transformFields, property)) {const [key, axis] = transformFields[property]; node.transform[key][axis] = value;}
  else if (node.kind === 'box') node.size[['width','depth','height'].indexOf(property)] = value;
  else if (node.kind === 'cylinder' && property === 'height') node.height = value;
  else if (node.kind === 'cylinder' || node.kind === 'sphere') node.radius = value;
}
function solvedBindings(doc: CadDocument) {
  const design = doc.parametric;
  if (design === undefined) return [];
  if (doc.version === 1) error('parametric designs require document version 2');
  const values = evaluateParameters(design), used = new Set<string>();
  // Until joint frames have parametric references, require an explicit detach.
  const connected = new Set<string>();
  function mark(id: string) {if(connected.has(id))return;connected.add(id);const n=doc.nodes[id];if(n?.kind==='boolean')n.inputs.forEach(mark);}
  doc.joints?.forEach(j=>{mark(j.bodyA);mark(j.bodyB);});
  return design.bindings.map(binding => {
    if (!record(binding) || typeof binding.nodeId !== 'string' || !Object.hasOwn(doc.nodes,binding.nodeId) || typeof binding.property !== 'string' || typeof binding.expression !== 'string') error('invalid binding');
    const node = doc.nodes[binding.nodeId];
    propertyValue(node, binding.property);
    if (connected.has(node.id)) error('detach joints before driving this body or its operands');
    const key = node.id + ':' + binding.property;
    if (used.has(key)) error('a property may have only one driving expression');
    used.add(key);
    const result = asUnit(evaluateExpression(binding.expression, name => {
      if (!Object.hasOwn(values, name)) error(`unknown parameter “${name}”`);
      return values[name];
    }), propertyUnit(binding.property));
    return {binding, value: result.value};
  });
}
/** Recompute on a mutable session draft, before validation/commit. */
export function applyParametricBindings(doc: CadDocument) {
  for (const {binding,value} of solvedBindings(doc)) setProperty(doc.nodes[binding.nodeId],binding.property,value);
}
/** Persisted evaluated values must agree with design intent; never silently repair imports. */
export function checkParametricDesign(doc: CadDocument) {
  for (const {binding,value} of solvedBindings(doc)) {
    const actual = propertyValue(doc.nodes[binding.nodeId],binding.property);
    if (Math.abs(actual-value) > 1e-9 * Math.max(1,Math.abs(value))) error('stored geometry is stale relative to its driving expressions');
  }
}
export function assertDrivenEdit(doc: CadDocument, next: SolidNode) {
  for (const binding of doc.parametric?.bindings ?? []) if (binding.nodeId === next.id) {
    if (propertyValue(doc.nodes[next.id],binding.property) !== propertyValue(next,binding.property)) error(`“${binding.property}” is driven; edit its expression or detach its binding first`);
  }
}
