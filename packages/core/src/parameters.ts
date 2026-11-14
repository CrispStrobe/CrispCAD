// SPDX-License-Identifier: BSD-3-Clause
import {formatSCADNumber} from './scad-numbers.js';
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
  const unary = ['isNumber','isBoolean','formatLengthSCAD','formatLength','sin','cos','tan','asin','acos','atan','sqrt','abs','floor','ceil','round','exp','ln','log'];
  const count = unary.includes(name) ? 1 : ['atan2','pow'].includes(name) ? 2 : name==='rangeCount'?3 : ['randomValue','rangeAt'].includes(name) ? 4 : ['min','max'].includes(name) ? -1 : 0;
  if (!count) return error(t`unknown mathematical function “${name}”`);
  if (count > 0 ? args.length !== count : args.length < 1) return error(t`invalid arguments for “${name}”`);
  if(name==='isNumber'||name==='isBoolean')return {value:name==='isBoolean'?(args[0].boolean?1:0):(args[0].boolean?0:1),length:0,angle:0,boolean:true};
  if(name==='formatLength'||name==='formatLengthSCAD'){const q=args[0],text=q.boolean?String(q.value!==0):name==='formatLengthSCAD'?formatSCADNumber(q.value):String(q.value);return {value:[...text].length,length:0,angle:0};}
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
  if(name==='rangeCount'){const [start,end,step]=args.map(scalar);if(!step)error(t('Range step must be nonzero'));const q=(end-start)/step;return result(Math.max(0,Math.floor(q+4*Number.EPSILON*Math.max(1,Math.abs(q)))+1));}
  if(name==='rangeAt'){const [start,end,step,index]=args.map(scalar);const q=(end-start)/step,count=step===0?0:Math.max(0,Math.floor(q+4*Number.EPSILON*Math.max(1,Math.abs(q)))+1);if(!Number.isInteger(index)||index<0||index>=count)error(t('List index is outside the available values'));return result(start+step*index);}
  if(name==='randomValue'){if(a.length!==b.length||a.angle!==b.angle)error(t('function arguments must have matching units'));const seed=scalar(args[2]),index=scalar(args[3]);if(!Number.isInteger(index)||index<0||index>1000000)error(t('List index is outside the available values'));const bytes=new DataView(new ArrayBuffer(8));bytes.setFloat64(0,seed,true);let hash=bytes.getUint32(0,true)^bytes.getUint32(4,true)^Math.imul(index+1,0x9e3779b1);hash=Math.imul(hash^(hash>>>16),0x21f0aaad);hash=Math.imul(hash^(hash>>>15),0x735a2d97);hash^=hash>>>15;return result(Math.min(a.value,b.value)+((hash>>>0)/4294967296)*Math.abs(a.value-b.value),a.length,a.angle);}
  if (name === 'atan2') {matching(); return result(Math.atan2(a.value, b.value) * 180 / Math.PI);}
  if (name === 'sqrt') return result(Math.sqrt(a.value), a.length / 2, a.angle / 2);
  if (name === 'pow') {const exponent = scalar(b); return result(Math.pow(a.value, exponent), a.length * exponent, a.angle * exponent);}
  if (name === 'min' || name === 'max') {matching(); return result((name === 'min' ? Math.min : Math.max)(...args.map(q => q.value)), a.length, a.angle);}
  if (['abs','floor','ceil','round'].includes(name)) return result((name === 'abs' ? Math.abs : name === 'floor' ? Math.floor : name === 'ceil' ? Math.ceil : (v: number) => Math.sign(v) * Math.floor(Math.abs(v) + .5))(a.value), a.length, a.angle);
  const value = scalar(a);
  return result(name === 'exp' ? Math.exp(value) : name === 'ln' ? Math.log(value) : Math.log10(value));
}

/** Original bounded expression AST. Evaluation short-circuits inactive branches. */
type Expr = {kind:'literal';value:Quantity}|{kind:'name';name:string}|{kind:'unary';op:string;value:Expr}|{kind:'binary';op:string;a:Expr;b:Expr}|{kind:'call';name:string;args:Expr[]}|{kind:'conditional';test:Expr;yes:Expr;no:Expr};
const parsedExpressions=new Map<string,Expr>();
function parseExpression(source:string):Expr{
  const tokens: string[] = []; let at = 0;
  while (at < source.length) {
    if (/\s/.test(source[at])) {at++; continue;}
    const token = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z][A-Za-z0-9_]*|^(?:==|!=|<=|>=|&&|\|\|)|^[(),+*/%!?<>:-]/.exec(source.slice(at))?.[0];
    if (!token) error(t`unsupported expression near “${source.slice(at, at + 12)}”`);
    tokens.push(token); at += token.length;
    if (tokens.length > 512) error(t('expression has too many tokens'));
  }

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
        if(tokens[cursor]!==')')do{args.push(conditional(depth+1));if(args.length>(token==='pick'?257:32))error(t('too many function arguments'));if(tokens[cursor]!==',')break;cursor++;}while(true);
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
  const root=conditional(0);if(cursor!==tokens.length)error(t`unexpected token “${tokens[cursor]}”`);return root;
}
export function evaluateExpression(source: string, lookup: (name: string, scope?:ReadonlyMap<string,Quantity>) => Quantity, options:{references?:Set<string>;bindings?:ReadonlyMap<string,Quantity>}={}): Quantity {
  if (typeof source !== 'string' || !source.trim() || source.length > 1024) error(t('expression must contain 1–1024 characters'));
  let root=parsedExpressions.get(source);if(!root){root=parseExpression(source);if(parsedExpressions.size>=256)parsedExpressions.delete(parsedExpressions.keys().next().value!);parsedExpressions.set(source,root);}
  if(options.references){const pending:{node:Expr;bound:Set<string>}[]=[{node:root,bound:new Set()}];while(pending.length){const {node,bound}=pending.pop()!;if(node.kind==='name'){if(!bound.has(node.name))options.references.add(node.name);}else if(node.kind==='unary')pending.push({node:node.value,bound});else if(node.kind==='binary')pending.push({node:node.a,bound},{node:node.b,bound});else if(node.kind==='conditional')pending.push({node:node.test,bound},{node:node.yes,bound},{node:node.no,bound});else if(node.kind==='call'){if((node.name==='sumRange'||node.name==='filterAt')&&node.args[0]?.kind==='name'){const nested=new Set([...bound,node.args[0].name]);node.args.slice(1).forEach((arg,i)=>pending.push({node:arg,bound:i===3?nested:bound}));}else node.args.forEach(arg=>pending.push({node:arg,bound}));}}}
  const scalar = (value:number):Quantity => ({value,length:0,angle:0});
  const truth=(q:Quantity):boolean=>{if(q.length||q.angle)error(t('condition requires a dimensionless value'));return q.value!==0;};
  const bool=(value:boolean):Quantity=>({...scalar(value?1:0),boolean:true});
  const numeric=(q:Quantity)=>{if(q.boolean)error(t('arithmetic requires numeric values'));};
  const matching=(a:Quantity,b:Quantity)=>{if(a.length!==b.length||a.angle!==b.angle)error(t('comparison requires matching units'));};
  const expressionBindings=new Map<string,Quantity>(options.bindings);let evaluationSteps=0;
  function evaluate(node:Expr):Quantity {
    if(++evaluationSteps>65536)error(t('expression evaluation budget exceeded'));
    if(node.kind==='literal')return node.value;
    if(node.kind==='name')return finite(expressionBindings.get(node.name)??lookup(node.name,expressionBindings));
    if(node.kind==='call'){if(node.name==='sumRange'||node.name==='filterAt'){const arity=node.name==='sumRange'?5:6;if(node.args.length!==arity||node.args[0].kind!=='name')error(t('Invalid range reduction'));const variable=node.args[0].name,[start,end,increment]=node.args.slice(1,4).map(arg=>{const q=evaluate(arg);if(q.boolean||q.length||q.angle)error(t('function requires a dimensionless argument'));return q.value;}),q=(end-start)/increment,count=increment===0?0:Math.max(0,Math.floor(q+4*Number.EPSILON*Math.max(1,Math.abs(q)))+1);if(!increment||!Number.isSafeInteger(count)||count>256)error(t('Range reduction exceeds 256 values'));const target=node.name==='filterAt'?evaluate(node.args[5]):undefined;if(target&&(target.boolean||target.length||target.angle||!Number.isInteger(target.value)||target.value<0))error(t('List index is outside the available values'));const previous=expressionBindings.get(variable);let sum=0,found=0;try{for(let i=0;i<count;i++){const value=start+i*increment;expressionBindings.set(variable,scalar(value));const result=evaluate(node.args[4]);if(node.name==='sumRange'){if(result.boolean||result.length||result.angle)error(t('function requires a dimensionless argument'));sum+=result.value;}else if(truth(result)){if(found++===target!.value)return scalar(value);}}if(target)error(t('List index is outside the available values'));return finite(scalar(sum));}finally{if(previous)expressionBindings.set(variable,previous);else expressionBindings.delete(variable);}}if(node.name==='pick'){if(node.args.length<2)error(t('pick requires an index and values'));const index=evaluate(node.args[0]);if(index.boolean||index.length||index.angle||!Number.isInteger(index.value)||index.value<0||index.value>=node.args.length-1)error(t('List index is outside the available values'));return evaluate(node.args[index.value+1]);}return evaluateMathFunction(node.name,node.args.map(evaluate));}
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

export function evaluateParameters(design: ParametricDesign, options:{declarationLimit?:64|256}={}): Record<string, Quantity> {
  if (!record(design) || design.version !== 1 || !record(design.parameters) || !Array.isArray(design.bindings) || design.bindings.length > 256) error(t('invalid design schema'));
  const entries = Object.entries(design.parameters);
  const limit=options.declarationLimit===256?256:64;if(entries.length>limit)error(limit===64?t('at most 64 named parameters are supported'):t('at most 256 code values are supported'));
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
