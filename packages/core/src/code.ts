// SPDX-License-Identifier: BSD-3-Clause
// Original bounded CAD language. No OpenSCAD/JSCAD interpreter or runtime code.
import {evaluateExpression,evaluateParameters} from './parameters.js';
import type {NamedParameter,ParameterUnit,Quantity} from './parameters.js';
import type {Vec3} from './document.js';
export interface CodeProgram {version:1;language:'brickwright-cad-script';source:string;parameters:Record<string,string>}
export type CodeShape = {kind:'box';size:Vec3}|{kind:'cylinder';radius:number;height:number;segments:number}|{kind:'sphere';radius:number;segments:number}|
 {kind:'union'|'subtract'|'intersect';shapes:CodeShape[]}|{kind:'move'|'rotate'|'scale';vector:Vec3;shape:CodeShape}|{kind:'repeat';count:number;step:Vec3;shape:CodeShape};
export interface CompiledCode {shape:CodeShape;parameters:Record<string,NamedParameter>;values:Record<string,Quantity>;expandedNodes:number;estimatedFaces:number}
export class CadCodeError extends Error {
 readonly line:number;readonly column:number;
 constructor(message:string,readonly offset:number,source:string){const before=source.slice(0,offset);const lines=before.split('\n');super(`Line ${lines.length}, column ${lines.at(-1)!.length+1}: ${message}`);this.name='CadCodeError';this.line=lines.length;this.column=lines.at(-1)!.length+1;}
}
export const CODE_LIMITS=Object.freeze({sourceBytes:32768,tokens:8192,statements:128,depth:32,expandedNodes:256,estimatedFaces:200000,repeat:64});
interface Token {text:string;at:number}
interface Scalar {text:string;at:number}
type ShapeAst={kind:'reference';name:string;at:number}|{kind:'call';name:string;at:number;scalars:Scalar[];vector?:Scalar[];shapes:ShapeAst[]};
const safeName=(name:string)=>/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)&&!['constructor','prototype','__proto__'].includes(name);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
export function compileCode(program:CodeProgram):CompiledCode {
 const source=program?.source;
 const fail=(message:string,at=0):never=>{throw new CadCodeError(message,at,typeof source==='string'?source:'');};
 if(!object(program)||program.version!==1||program.language!=='brickwright-cad-script'||typeof source!=='string'||!object(program.parameters)||Object.keys(program).some(key=>!['version','language','source','parameters'].includes(key)))fail('Unsupported code program schema');
 if(new TextEncoder().encode(source).length>CODE_LIMITS.sourceBytes)fail('Source exceeds 32 KiB');
 const tokens:Token[]=[];let at=0;
 while(at<source.length){if(/\s/.test(source[at])){at++;continue;}if(source.slice(at,at+2)==='//'){const end=source.indexOf('\n',at);at=end<0?source.length:end+1;continue;}
  const text=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z][A-Za-z0-9_]*|^[=;:,()[\]+*/-]/.exec(source.slice(at))?.[0];
  if(!text)fail('Unsupported token; use CAD expressions and modeling functions',at);tokens.push({text:text!,at});at+=text!.length;if(tokens.length>CODE_LIMITS.tokens)fail('Too many source tokens',at);
 }
 let cursor=0;const peek=()=>tokens[cursor]?.text,offset=()=>tokens[cursor]?.at??source.length;
 const take=()=>{const token=tokens[cursor++];if(!token)fail('Unexpected end of source',source.length);return token;};
 const expect=(value:string)=>{if(peek()!==value)fail(`Expected “${value}”`,offset());return take();};
 const name=()=>{const token=take();if(!safeName(token.text))fail('Expected a name',token.at);return token.text;};
 function scalar(stops:string[]):Scalar {const start=offset(),values:string[]=[];let depth=0;while(cursor<tokens.length){const next=peek()!;if(depth===0&&stops.includes(next))break;if(next==='(')depth++;if(next===')'){if(depth===0)break;depth--;}values.push(take().text);if(depth>32)fail('Expression nesting exceeds 32',start);}if(!values.length||depth!==0)fail('Expected a complete dimensional expression',start);return {text:values.join(' '),at:start};}
 function vector():Scalar[]{expect('[');const result=[scalar([',']),...(expect(','),[scalar([','])]),...(expect(','),[scalar([']'])])];expect(']');return result;}
 function shape(depth=0):ShapeAst {if(depth>CODE_LIMITS.depth)fail('Shape nesting exceeds 32',offset());const token=take();if(!safeName(token.text))fail('Expected a shape function or named shape',token.at);if(peek()!=='(')return {kind:'reference',name:token.text,at:token.at};expect('(');
  const call:Extract<ShapeAst,{kind:'call'}>={kind:'call',name:token.text,at:token.at,scalars:[],shapes:[]};
  if(['box','cylinder','sphere'].includes(call.name)){while(peek()!==')'){call.scalars.push(scalar([',',')']));if(peek()!==',')break;expect(',');}}
  else if(['move','rotate','scale'].includes(call.name)){call.vector=vector();expect(',');call.shapes.push(shape(depth+1));}
  else if(call.name==='repeat'){call.scalars.push(scalar([',']));expect(',');call.vector=vector();expect(',');call.shapes.push(shape(depth+1));}
  else if(['union','subtract','intersect'].includes(call.name)){while(peek()!==')'){call.shapes.push(shape(depth+1));if(call.shapes.length>64)fail('At most 64 boolean operands',call.at);if(peek()!==',')break;expect(',');}}
  else fail(`Unknown modeling function “${call.name}”`,call.at);
  expect(')');return call;
 }
 const parameters:Record<string,NamedParameter>=Object.create(null),parameterOffsets=new Map<string,number>(),definitions=new Map<string,ShapeAst>();let output:ShapeAst|undefined,statements=0;
 while(cursor<tokens.length){if(++statements>CODE_LIMITS.statements)fail('Too many statements',offset());const statement=take();
  if(output)fail('Return must be the final statement',statement.at);
  if(statement.text==='param'){const id=name();if(Object.hasOwn(parameters,id)||definitions.has(id))fail(`Duplicate name “${id}”`,statement.at);expect(':');const unit=take();if(!['mm','deg','scalar'].includes(unit.text))fail('Parameter unit must be mm, deg or scalar',unit.at);expect('=');const value=scalar([';']);parameters[id]={unit:unit.text as ParameterUnit,expression:value.text};parameterOffsets.set(id,value.at);}
  else if(statement.text==='let'){const id=name();if(definitions.has(id)||Object.hasOwn(parameters,id))fail(`Duplicate name “${id}”`,statement.at);expect('=');definitions.set(id,shape());}
  else if(statement.text==='return')output=shape();else fail('Expected param, let or return',statement.at);
  expect(';');
 }
 if(!output)fail('Finish the program with return shape;');
 const resolved=structuredClone(parameters);for(const [key,value] of Object.entries(program.parameters)){if(!Object.hasOwn(parameters,key))fail(`Unknown parameter override “${key}”`);if(typeof value!=='string'||!value.trim())fail(`Invalid override for “${key}”`);resolved[key].expression=value;}
 let values:Record<string,Quantity>;try{values=evaluateParameters({version:1,parameters:resolved,bindings:[]});}catch(error){const message=error instanceof Error?error.message:String(error);const related=[...parameterOffsets].find(([key])=>message.includes(`“${key}”`));fail(message,related?.[1]??0);}
 function number(expr:Scalar,unit:ParameterUnit,min:number,max:number,integer=false):number {try{const q=evaluateExpression(expr.text,key=>{if(!Object.hasOwn(values,key))throw new Error(`Unknown parameter “${key}”`);return values[key];});const length=unit==='mm'?1:0,angle=unit==='deg'?1:0;if((q.length||q.angle)&&(q.length!==length||q.angle!==angle))throw new Error(`Expected ${unit}`);if(q.value<min||q.value>max||integer&&!Number.isInteger(q.value))throw new Error(`Expected ${integer?'an integer':'a value'} between ${min} and ${max}`);return q.value;}catch(error){return fail(error instanceof Error?error.message:String(error),expr.at);}}
 const built=new Map<string,CodeShape>(),visiting=new Set<string>();
 function resolve(ast:ShapeAst,depth=0):CodeShape {if(depth>32)fail('Dependency depth exceeds 32',ast.at);if(ast.kind==='reference'){if(built.has(ast.name))return built.get(ast.name)!;if(visiting.has(ast.name))fail(`Shape dependency cycle at “${ast.name}”`,ast.at);const definition=definitions.get(ast.name);if(!definition)fail(`Unknown shape “${ast.name}”`,ast.at);visiting.add(ast.name);const result=resolve(definition!,depth+1);visiting.delete(ast.name);built.set(ast.name,result);return result;}
  const n=ast.scalars.length,arity=(min:number,max=min)=>{if(n<min||n>max)fail(`${ast.name} requires ${min}${max===min?'':`–${max}`} numeric arguments`,ast.at);},mm=(i:number)=>number(ast.scalars[i],'mm',.01,100000),segments=(i:number)=>ast.scalars[i]?number(ast.scalars[i],'scalar',12,96,true):48;
  if(ast.name==='box'){arity(3);return {kind:'box',size:[mm(0),mm(1),mm(2)]};}
  if(ast.name==='cylinder'){arity(2,3);return {kind:'cylinder',radius:mm(0),height:mm(1),segments:segments(2)};}
  if(ast.name==='sphere'){arity(1,2);return {kind:'sphere',radius:mm(0),segments:segments(1)};}
  if(['union','subtract','intersect'].includes(ast.name)){if(ast.shapes.length<2)fail('Boolean operations need at least two shapes',ast.at);return {kind:ast.name as 'union'|'subtract'|'intersect',shapes:ast.shapes.map(child=>resolve(child,depth+1))};}
  const unit=ast.name==='scale'?'scalar':ast.name==='rotate'?'deg':'mm';const vec=ast.vector!.map(v=>number(v,unit,ast.name==='scale'?.001:ast.name==='rotate'?-360000:-1e6,ast.name==='scale'?1000:ast.name==='rotate'?360000:1e6)) as Vec3;
  const child=resolve(ast.shapes[0],depth+1);if(ast.name==='repeat')return {kind:'repeat',count:number(ast.scalars[0],'scalar',1,CODE_LIMITS.repeat,true),step:vec,shape:child};
  return {kind:ast.name as 'move'|'rotate'|'scale',vector:vec,shape:child};
 }
 // Check unused declarations too; malformed definitions cannot hide behind an unused name.
 for(const [id,ast] of definitions)resolve({kind:'reference',name:id,at:ast.at});
 const result=resolve(output!);let expandedNodes=0,estimatedFaces=0;
 function budget(s:CodeShape,multiplier=1,depth=0){if(depth>32)fail('Expanded dependency depth exceeds 32');expandedNodes+=multiplier;if(expandedNodes>CODE_LIMITS.expandedNodes)fail('Expanded shape budget exceeds 256 nodes');if(s.kind==='box')estimatedFaces+=12*multiplier;else if(s.kind==='cylinder')estimatedFaces+=4*s.segments*multiplier;else if(s.kind==='sphere')estimatedFaces+=4*s.segments*s.segments*multiplier;else if('shapes' in s)s.shapes.forEach(child=>budget(child,multiplier,depth+1));else budget(s.shape,multiplier*(s.kind==='repeat'?s.count:1),depth+1);if(estimatedFaces>CODE_LIMITS.estimatedFaces)fail('Estimated mesh budget exceeds 200000 faces');}
 budget(result);return {shape:result,parameters,values:values!,expandedNodes,estimatedFaces};
}
export const defaultCodeProgram=():CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:`// A dimensioned plate with three bores. Coordinates are millimetres.\nparam width: mm = 60;\nparam depth: mm = 30;\nparam thickness: mm = 5;\nparam bore: mm = 3;\nlet plate = move([0, 0, thickness / 2], box(width, depth, thickness));\nlet holes = move([-20, 0, thickness / 2], repeat(3, [20, 0, 0], cylinder(bore, thickness * 2)));\nreturn subtract(plate, holes);\n`});
