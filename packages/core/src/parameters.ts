// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import type {CadDocument, SolidNode} from './document.js';

export type ParameterUnit = 'mm' | 'deg' | 'scalar';
export interface NamedParameter {expression: string; unit: ParameterUnit}
export type DrivenProperty = 'width' | 'depth' | 'height' | 'radius' |
  'positionX' | 'positionY' | 'positionZ' | 'rotationX' | 'rotationY' | 'rotationZ' |
  'scaleX' | 'scaleY' | 'scaleZ';
export interface ParameterBinding {nodeId: string; property: DrivenProperty; expression: string}
export interface ParametricDesign {version: 1; parameters: Record<string, NamedParameter>; bindings: ParameterBinding[]}
export interface Quantity {value: number; length: number; angle: number; boolean?: true}
const units: Record<string, Quantity> = {
  mm: {value: 1, length: 1, angle: 0}, cm: {value: 10, length: 1, angle: 0},
  m: {value: 1000, length: 1, angle: 0}, in: {value: 25.4, length: 1, angle: 0},
  deg: {value: 1, length: 0, angle: 1}, rad: {value: 180 / Math.PI, length: 0, angle: 1},
};
const dimensions = (unit: ParameterUnit): [number, number] => unit === 'mm' ? [1, 0] : unit === 'deg' ? [0, 1] : [0, 0];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validName = (name: string) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) && !Object.hasOwn(units, name) && !['constructor','prototype','__proto__'].includes(name);
function error(message: string): never {throw new Error(t`Parameters: ${message}`);}
function finite(q: Quantity): Quantity {
  if (!Number.isInteger(q.length) || !Number.isInteger(q.angle) || !Number.isFinite(q.value) || Math.abs(q.value) > 1e9 || Math.abs(q.length) > 8 || Math.abs(q.angle) > 8) error(t('result is outside the supported range'));
  return q;
}
function asUnit(q: Quantity, unit: ParameterUnit): Quantity {
  if(q.boolean&&unit!=='scalar')error(t('boolean cannot supply a dimensional value'));
  const [length, angle] = dimensions(unit);
  // Bare numeric expressions are interpreted in the field's declared unit.
  if (q.length === 0 && q.angle === 0) return {...q, length, angle};
  if (q.length !== length || q.angle !== angle) error(t`expression must produce ${unit}`);
  return q;
}

/** Trigonometry uses degrees, matching the editor's angular properties. */
function evaluateMathFunction(name: string, args: Quantity[]): Quantity {
  const unary = ['sin','cos','tan','asin','acos','atan','sqrt','abs','floor','ceil','round','exp','ln','log'];
  const count = unary.includes(name) ? 1 : ['atan2','pow'].includes(name) ? 2 : ['min','max'].includes(name) ? -1 : 0;
  if (!count) return error(t`unknown mathematical function “${name}”`);
  if (count > 0 ? args.length !== count : args.length < 1) return error(t`invalid arguments for “${name}”`);
  if(args.some(q=>q.boolean))error(t('function requires numeric arguments'));
  const a = args[0], b = args[1];
  const scalar = (q: Quantity) => {if (q.length || q.angle) error(t('function requires a dimensionless argument')); return q.value;};
  const matching = () => {if (args.some(q => q.length !== a.length || q.angle !== a.angle)) error(t('function arguments must have matching units'));};
  const result = (value: number, length = 0, angle = 0) => finite({value, length, angle});
  if (['sin','cos','tan'].includes(name)) {
    if (a.length || (a.angle !== 0 && a.angle !== 1)) error(t('trigonometry requires degrees or a scalar angle'));
    const radians = a.value * Math.PI / 180;
    return result(name === 'sin' ? Math.sin(radians) : name === 'cos' ? Math.cos(radians) : Math.tan(radians));
  }
  if (['asin','acos','atan'].includes(name)) {
    const value = scalar(a);
    return result((name === 'asin' ? Math.asin(value) : name === 'acos' ? Math.acos(value) : Math.atan(value)) * 180 / Math.PI);
  }
  if (name === 'atan2') {matching(); return result(Math.atan2(a.value, b.value) * 180 / Math.PI);}
  if (name === 'sqrt') return result(Math.sqrt(a.value), a.length / 2, a.angle / 2);
  if (name === 'pow') {const exponent = scalar(b); return result(Math.pow(a.value, exponent), a.length * exponent, a.angle * exponent);}
  if (name === 'min' || name === 'max') {matching(); return result((name === 'min' ? Math.min : Math.max)(...args.map(q => q.value)), a.length, a.angle);}
  if (['abs','floor','ceil','round'].includes(name)) return result((name === 'abs' ? Math.abs : name === 'floor' ? Math.floor : name === 'ceil' ? Math.ceil : (v: number) => Math.sign(v) * Math.floor(Math.abs(v) + .5))(a.value), a.length, a.angle);
  const value = scalar(a);
  return result(name === 'exp' ? Math.exp(value) : name === 'ln' ? Math.log(value) : Math.log10(value));
}

/** Original bounded expression AST. Evaluation short-circuits inactive branches. */
export function evaluateExpression(source: string, lookup: (name: string) => Quantity, options:{references?:Set<string>}={}): Quantity {
  if (typeof source !== 'string' || !source.trim() || source.length > 1024) error(t('expression must contain 1–1024 characters'));
  const tokens: string[] = []; let at = 0;
  while (at < source.length) {
    if (/\s/.test(source[at])) {at++; continue;}
    const token = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z][A-Za-z0-9_]*|^(?:==|!=|<=|>=|&&|\|\|)|^[(),+*/%!?<>:-]/.exec(source.slice(at))?.[0];
    if (!token) error(t`unsupported expression near “${source.slice(at, at + 12)}”`);
    tokens.push(token); at += token.length;
    if (tokens.length > 512) error(t('expression has too many tokens'));
  }
  type Expr = {kind:'literal';value:Quantity}|{kind:'name';name:string}|{kind:'unary';op:string;value:Expr}|{kind:'binary';op:string;a:Expr;b:Expr}|{kind:'call';name:string;args:Expr[]}|{kind:'conditional';test:Expr;yes:Expr;no:Expr};
  let cursor = 0;
  const scalar = (value:number):Quantity => ({value,length:0,angle:0});
  const expect = (token:string) => {if(tokens[cursor++]!==token)error(t('expected a number, parameter or parenthesis'));};
  function primary(depth:number):Expr {
    if(depth>32)error(t('expression is too deeply nested'));
    const token=tokens[cursor++];
    if(['+','-','!'].includes(token))return {kind:'unary',op:token,value:primary(depth+1)};
    if(token==='('){const value=conditional(depth+1);if(tokens[cursor++]!==')')error(t('missing closing parenthesis'));return value;}
    if(token&&/^(?:\d|\.)/.test(token)){
      let value=scalar(Number(token));if(Object.hasOwn(units,tokens[cursor])){const unit=units[tokens[cursor++]];value={...unit,value:value.value*unit.value};}
      return {kind:'literal',value:finite(value)};
    }
    if(token&&/^[A-Za-z]/.test(token)){
      if(tokens[cursor]==='('){cursor++;const args:Expr[]=[];
        if(tokens[cursor]!==')')do{args.push(conditional(depth+1));if(args.length>32)error(t('too many function arguments'));if(tokens[cursor]!==',')break;cursor++;}while(true);
        if(tokens[cursor++]!==')')error(t('missing closing parenthesis'));return {kind:'call',name:token,args};
      }
      if(Object.hasOwn(units,token))error(t('put a number before a unit'));
      return token==='true'||token==='false'?{kind:'literal',value:{...scalar(token==='true'?1:0),boolean:true}}:{kind:'name',name:token};
    }
    return error(t('expected a number, parameter or parenthesis'));
  }
  const operators=[['||'],['&&'],['==','!='],['<','<=','>','>='],['+','-'],['*','/','%']];
  function binary(level:number,depth:number):Expr {
    if(level===operators.length)return primary(depth);
    let a=binary(level+1,depth);while(operators[level].includes(tokens[cursor])){const op=tokens[cursor++],b=binary(level+1,depth);a={kind:'binary',op,a,b};}return a;
  }
  function conditional(depth:number):Expr {
    if(depth>32)error(t('expression is too deeply nested'));
    const test=binary(0,depth);if(tokens[cursor]!=='?')return test;cursor++;
    const yes=conditional(depth+1);expect(':');return {kind:'conditional',test,yes,no:conditional(depth+1)};
  }
  const root=conditional(0);if(options.references){const pending=[root];while(pending.length){const node=pending.pop()!;if(node.kind==='name')options.references.add(node.name);else if(node.kind==='unary')pending.push(node.value);else if(node.kind==='binary')pending.push(node.a,node.b);else if(node.kind==='conditional')pending.push(node.test,node.yes,node.no);else if(node.kind==='call')pending.push(...node.args);}}if(cursor!==tokens.length)error(t`unexpected token “${tokens[cursor]}”`);
  const truth=(q:Quantity):boolean=>{if(q.length||q.angle)error(t('condition requires a dimensionless value'));return q.value!==0;};
  const bool=(value:boolean):Quantity=>({...scalar(value?1:0),boolean:true});
  const numeric=(q:Quantity)=>{if(q.boolean)error(t('arithmetic requires numeric values'));};
  const matching=(a:Quantity,b:Quantity)=>{if(a.length!==b.length||a.angle!==b.angle)error(t('comparison requires matching units'));};
  function evaluate(node:Expr):Quantity {
    if(node.kind==='literal')return node.value;
    if(node.kind==='name')return finite(lookup(node.name));
    if(node.kind==='call'&&node.name==='assertValue'){if(node.args.length!==2)error(t('Assertion requires condition and value'));if(!truth(evaluate(node.args[0])))error(t('Assertion failed'));return evaluate(node.args[1]);}
    if(node.kind==='call')return evaluateMathFunction(node.name,node.args.map(evaluate));
    if(node.kind==='conditional')return evaluate(truth(evaluate(node.test))?node.yes:node.no);
    if(node.kind==='unary'){const q=evaluate(node.value);if(node.op==='!')return bool(!truth(q));numeric(q);return finite({...q,value:node.op==='-'?-q.value:q.value});}
    const a=evaluate(node.a),op=node.op;
    if(op==='&&')return bool(truth(a)&&truth(evaluate(node.b)));
    if(op==='||')return bool(truth(a)||truth(evaluate(node.b)));
    const b=evaluate(node.b);
    if(['==','!=','<','<=','>','>='].includes(op)){matching(a,b);if((op==='=='||op==='!=')&&!!a.boolean!==!!b.boolean)return bool(op==='!=');return bool((op==='=='?a.value===b.value:op==='!='?a.value!==b.value:op==='<'?a.value<b.value:op==='<='?a.value<=b.value:op==='>'?a.value>b.value:a.value>=b.value));}
    numeric(a);numeric(b);
    if(op==='+'||op==='-'){
      if(a.length!==b.length||a.angle!==b.angle)error(t('addition/subtraction requires matching units (for example width + 5 mm)'));
      return finite({...a,value:a.value+(op==='+'?b.value:-b.value)});
    }
    if((op==='/'||op==='%')&&b.value===0)error(t('division by zero'));
    if(op==='%'){matching(a,b);return finite({...a,value:a.value%b.value});}
    return finite({value:op==='*'?a.value*b.value:a.value/b.value,length:a.length+(op==='*'?b.length:-b.length),angle:a.angle+(op==='*'?b.angle:-b.angle)});
  }
  return evaluate(root);
}

export function evaluateParameters(design: ParametricDesign): Record<string, Quantity> {
  if (!record(design) || design.version !== 1 || !record(design.parameters) || !Array.isArray(design.bindings) || design.bindings.length > 256) error(t('invalid design schema'));
  const entries = Object.entries(design.parameters);
  if (entries.length > 64) error(t('at most 64 named parameters are supported'));
  for (const [name, parameter] of entries) {
    if (!validName(name) || !record(parameter) || !['mm','deg','scalar'].includes(String(parameter.unit)) || typeof parameter.expression !== 'string') error(t`invalid parameter “${name}”`);
  }
  const result: Record<string, Quantity> = Object.create(null), visiting = new Set<string>();
  function resolve(name: string): Quantity {
    if (Object.hasOwn(result, name)) return result[name];
    if (!Object.hasOwn(design.parameters, name)) error(t`unknown parameter “${name}”`);
    if (visiting.has(name)) error(t`dependency cycle at “${name}”`);
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
  if (!drivenProperties(node).includes(property)) error(t`“${property}” is not available on ${node.name}`);
  if (Object.hasOwn(transformFields, property)) {const [key, axis] = transformFields[property]; return node.transform[key][axis];}
  if (node.kind === 'box') return node.size[['width','depth','height'].indexOf(property)];
  if (node.kind === 'cylinder') return property === 'radius' ? node.radius : node.height;
  if (node.kind === 'sphere') return node.radius;
  return error(t('unsupported driven property'));
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
  if (doc.version === 1) error(t('parametric designs require document version 2'));
  const values = evaluateParameters(design), used = new Set<string>();
  // Until joint frames have parametric references, require an explicit detach.
  const connected = new Set<string>();
  function mark(id: string) {if(connected.has(id))return;connected.add(id);const n=doc.nodes[id];if(n?.kind==='boolean')n.inputs.forEach(mark);}
  doc.joints?.forEach(j=>{mark(j.bodyA);mark(j.bodyB);});
  return design.bindings.map(binding => {
    if (!record(binding) || typeof binding.nodeId !== 'string' || !Object.hasOwn(doc.nodes,binding.nodeId) || typeof binding.property !== 'string' || typeof binding.expression !== 'string') error(t('invalid binding'));
    const node = doc.nodes[binding.nodeId];
    propertyValue(node, binding.property);
    if (connected.has(node.id)) error(t('detach joints before driving this body or its operands'));
    const key = node.id + ':' + binding.property;
    if (used.has(key)) error(t('a property may have only one driving expression'));
    used.add(key);
    const result = asUnit(evaluateExpression(binding.expression, name => {
      if (!Object.hasOwn(values, name)) error(t`unknown parameter “${name}”`);
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
    if (Math.abs(actual-value) > 1e-9 * Math.max(1,Math.abs(value))) error(t('stored geometry is stale relative to its driving expressions'));
  }
}
export function assertDrivenEdit(doc: CadDocument, next: SolidNode) {
  for (const binding of doc.parametric?.bindings ?? []) if (binding.nodeId === next.id) {
    if (propertyValue(doc.nodes[next.id],binding.property) !== propertyValue(next,binding.property)) error(t`“${binding.property}” is driven; edit its expression or detach its binding first`);
  }
}
