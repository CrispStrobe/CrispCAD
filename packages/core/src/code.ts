// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
// Original bounded CAD language. No OpenSCAD/JSCAD interpreter or runtime code.
import {evaluateExpression,evaluateParameters} from './parameters.js';
import type {NamedParameter,ParameterUnit,Quantity} from './parameters.js';
import type {Vec3} from './document.js';
export interface CodeProgram {version:1;language:'brickwright-cad-script';source:string;parameters:Record<string,string>}
export type CodeShape = {kind:'box';size:Vec3}|{kind:'cylinder';radius:number;height:number;segments:number}|{kind:'sphere';radius:number;segments:number}|{kind:'extrude';height:number;points:[number,number][]}|
 {kind:'union'|'subtract'|'intersect';shapes:CodeShape[]}|{kind:'move'|'rotate'|'scale';vector:Vec3;shape:CodeShape}|{kind:'repeat';count:number;step:Vec3;shape:CodeShape};
export interface CompiledCode {shape:CodeShape;parameters:Record<string,NamedParameter>;values:Record<string,Quantity>;expandedNodes:number;estimatedFaces:number}
export class CadCodeError extends Error {
 readonly line:number;readonly column:number;readonly detail:string;
 constructor(message:string,readonly offset:number,source:string,readonly code:string='invalid-source'){const before=source.slice(0,offset);const lines=before.split('\n');super(t`Line ${lines.length}, column ${lines.at(-1)!.length+1}: ${message}`);this.detail=message;this.name='CadCodeError';this.line=lines.length;this.column=lines.at(-1)!.length+1;}
}
export const CODE_LIMITS=Object.freeze({sourceBytes:32768,tokens:8192,statements:128,depth:32,expandedNodes:256,estimatedFaces:200000,repeat:64});
interface Token {text:string;at:number}
interface Scalar {text:string;at:number}
type ShapeAst={kind:'reference';name:string;at:number}|{kind:'call';name:string;at:number;scalars:Scalar[];vector?:Scalar[];points?:Scalar[][];shapes:ShapeAst[]};
const safeName=(name:string)=>/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)&&!['constructor','prototype','__proto__'].includes(name);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
export function compileCode(program:CodeProgram):CompiledCode {
 const source=program?.source;
 const fail=(message:string,at=0):never=>{throw new CadCodeError(message,at,typeof source==='string'?source:'');};
 if(!object(program)||program.version!==1||program.language!=='brickwright-cad-script'||typeof source!=='string'||!object(program.parameters)||Object.keys(program).some(key=>!['version','language','source','parameters'].includes(key)))fail(t('Unsupported code program schema'));
 if(new TextEncoder().encode(source).length>CODE_LIMITS.sourceBytes)fail(t('Source exceeds 32 KiB'));
 const tokens:Token[]=[];let at=0;
 while(at<source.length){if(/\s/.test(source[at])){at++;continue;}if(source.slice(at,at+2)==='//'){const end=source.indexOf('\n',at);at=end<0?source.length:end+1;continue;}
  const text=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z][A-Za-z0-9_]*|^[=;:,()[\]+*/-]/.exec(source.slice(at))?.[0];
  if(!text)fail(t('Unsupported token; use CAD expressions and modeling functions'),at);tokens.push({text:text!,at});at+=text!.length;if(tokens.length>CODE_LIMITS.tokens)fail(t('Too many source tokens'),at);
 }
 let cursor=0;const peek=()=>tokens[cursor]?.text,offset=()=>tokens[cursor]?.at??source.length;
 const take=()=>{const token=tokens[cursor++];if(!token)fail(t('Unexpected end of source'),source.length);return token;};
 const expect=(value:string)=>{if(peek()!==value)fail(t`Expected “${value}”`,offset());return take();};
 const name=()=>{const token=take();if(!safeName(token.text))fail(t('Expected a name'),token.at);return token.text;};
 function scalar(stops:string[]):Scalar {const start=offset(),values:string[]=[];let depth=0;while(cursor<tokens.length){const next=peek()!;if(depth===0&&stops.includes(next))break;if(next==='(')depth++;if(next===')'){if(depth===0)break;depth--;}values.push(take().text);if(depth>32)fail(t('Expression nesting exceeds 32'),start);}if(!values.length||depth!==0)fail(t('Expected a complete dimensional expression'),start);return {text:values.join(' '),at:start};}
 function vector():Scalar[]{expect('[');const result=[scalar([',']),...(expect(','),[scalar([','])]),...(expect(','),[scalar([']'])])];expect(']');return result;}
 function shape(depth=0):ShapeAst {if(depth>CODE_LIMITS.depth)fail(t('Shape nesting exceeds 32'),offset());const token=take();if(!safeName(token.text))fail(t('Expected a shape function or named shape'),token.at);if(peek()!=='(')return {kind:'reference',name:token.text,at:token.at};expect('(');
  const call:Extract<ShapeAst,{kind:'call'}>={kind:'call',name:token.text,at:token.at,scalars:[],shapes:[]};
  if(call.name==='extrude'){call.scalars.push(scalar([',']));expect(',');expect('[');call.points=[];while(peek()!==']'){expect('[');call.points.push([scalar([',']),...(expect(','),[scalar([']'])])]);expect(']');if(call.points.length>256)fail(t('Extrusion profile exceeds 256 points'),call.at);if(peek()!==',')break;expect(',');}expect(']');}
  else if(['box','cylinder','sphere'].includes(call.name)){while(peek()!==')'){call.scalars.push(scalar([',',')']));if(peek()!==',')break;expect(',');}}
  else if(['move','rotate','scale'].includes(call.name)){call.vector=vector();expect(',');call.shapes.push(shape(depth+1));}
  else if(call.name==='repeat'){call.scalars.push(scalar([',']));expect(',');call.vector=vector();expect(',');call.shapes.push(shape(depth+1));}
  else if(['union','subtract','intersect'].includes(call.name)){while(peek()!==')'){call.shapes.push(shape(depth+1));if(call.shapes.length>64)fail(t('At most 64 boolean operands'),call.at);if(peek()!==',')break;expect(',');}}
  else fail(t`Unknown modeling function “${call.name}”`,call.at);
  expect(')');return call;
 }
 const parameters:Record<string,NamedParameter>=Object.create(null),parameterOffsets=new Map<string,number>(),definitions=new Map<string,ShapeAst>();let output:ShapeAst|undefined,statements=0;
 while(cursor<tokens.length){if(++statements>CODE_LIMITS.statements)fail(t('Too many statements'),offset());const statement=take();
  if(output)fail(t('Return must be the final statement'),statement.at);
  if(statement.text==='param'){const id=name();if(Object.hasOwn(parameters,id)||definitions.has(id))fail(t`Duplicate name “${id}”`,statement.at);expect(':');const unit=take();if(!['mm','deg','scalar'].includes(unit.text))fail(t('Parameter unit must be mm, deg or scalar'),unit.at);expect('=');const value=scalar([';']);parameters[id]={unit:unit.text as ParameterUnit,expression:value.text};parameterOffsets.set(id,value.at);}
  else if(statement.text==='let'){const id=name();if(definitions.has(id)||Object.hasOwn(parameters,id))fail(t`Duplicate name “${id}”`,statement.at);expect('=');definitions.set(id,shape());}
  else if(statement.text==='return')output=shape();else fail(t('Expected param, let or return'),statement.at);
  expect(';');
 }
 if(!output)fail(t('Finish the program with return shape;'));
 const resolved=structuredClone(parameters);for(const [key,value] of Object.entries(program.parameters)){if(!Object.hasOwn(parameters,key))fail(t`Unknown parameter override “${key}”`);if(typeof value!=='string'||!value.trim())fail(t`Invalid override for “${key}”`);resolved[key].expression=value;}
 let values:Record<string,Quantity>;try{values=evaluateParameters({version:1,parameters:resolved,bindings:[]});}catch(error){const message=error instanceof Error?error.message:String(error);const related=[...parameterOffsets].find(([key])=>message.includes(`“${key}”`));fail(message,related?.[1]??0);}
 function number(expr:Scalar,unit:ParameterUnit,min:number,max:number,integer=false):number {try{const q=evaluateExpression(expr.text,key=>{if(!Object.hasOwn(values,key))throw new Error(t`Unknown parameter “${key}”`);return values[key];});const length=unit==='mm'?1:0,angle=unit==='deg'?1:0;if((q.length||q.angle)&&(q.length!==length||q.angle!==angle))throw new Error(t`Expected ${unit}`);if(q.value<min||q.value>max||integer&&!Number.isInteger(q.value))throw new Error(t`Expected ${integer?t('an integer'):t('a value')} between ${min} and ${max}`);return q.value;}catch(error){return fail(error instanceof Error?error.message:String(error),expr.at);}}
 const built=new Map<string,CodeShape>(),visiting=new Set<string>();
 function resolve(ast:ShapeAst,depth=0):CodeShape {if(depth>32)fail(t('Dependency depth exceeds 32'),ast.at);if(ast.kind==='reference'){if(built.has(ast.name))return built.get(ast.name)!;if(visiting.has(ast.name))fail(t`Shape dependency cycle at “${ast.name}”`,ast.at);const definition=definitions.get(ast.name);if(!definition)fail(t`Unknown shape “${ast.name}”`,ast.at);visiting.add(ast.name);const result=resolve(definition!,depth+1);visiting.delete(ast.name);built.set(ast.name,result);return result;}
  const n=ast.scalars.length,arity=(min:number,max=min)=>{if(n<min||n>max)fail(t`${ast.name} requires ${min}${max===min?'':`–${max}`} numeric arguments`,ast.at);},mm=(i:number)=>number(ast.scalars[i],'mm',.01,100000),segments=(i:number,min=12,max=96)=>ast.scalars[i]?number(ast.scalars[i],'scalar',min,max,true):48;
  if(ast.name==='extrude'){arity(1);let points=ast.points!.map(p=>p.map(v=>number(v,'mm',-100000,100000)) as [number,number]);if(points.length>3&&points[0].every((v,i)=>v===points.at(-1)![i]))points=points.slice(0,-1);if(points.length<3)fail(t('Extrusion profile needs at least three points'),ast.at);const area=points.reduce((a,p,i)=>a+p[0]*points[(i+1)%points.length][1]-points[(i+1)%points.length][0]*p[1],0);if(Math.abs(area)<1e-8)fail(t('Extrusion profile has zero area'),ast.at);const cross=(a:number[],b:number[],c:number[])=> (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-9)fail(t('Extrusion profile contains a zero-length edge'),ast.at);for(let j=i+2;j<points.length;j++){if(i===0&&j===points.length-1)continue;const c=points[j],d=points[(j+1)%points.length];const overlap=[0,1].every(k=>Math.max(Math.min(a[k],b[k]),Math.min(c[k],d[k]))<=Math.min(Math.max(a[k],b[k]),Math.max(c[k],d[k]))+1e-9);if(overlap&&cross(a,b,c)*cross(a,b,d)<=1e-10&&cross(c,d,a)*cross(c,d,b)<=1e-10)fail(t('Extrusion profile intersects itself'),ast.at);}}if(area<0)points.reverse();return {kind:'extrude',height:mm(0),points};}
  if(ast.name==='box'){arity(3);return {kind:'box',size:[mm(0),mm(1),mm(2)]};}
  if(ast.name==='cylinder'){arity(2,3);return {kind:'cylinder',radius:mm(0),height:mm(1),segments:segments(2,3,256)};}
  if(ast.name==='sphere'){arity(1,2);return {kind:'sphere',radius:mm(0),segments:segments(1)};}
  if(['union','subtract','intersect'].includes(ast.name)){if(ast.shapes.length<2)fail(t('Boolean operations need at least two shapes'),ast.at);return {kind:ast.name as 'union'|'subtract'|'intersect',shapes:ast.shapes.map(child=>resolve(child,depth+1))};}
  const unit=ast.name==='scale'?'scalar':ast.name==='rotate'?'deg':'mm';const vec=ast.vector!.map(v=>number(v,unit,ast.name==='scale'?.001:ast.name==='rotate'?-360000:-1e6,ast.name==='scale'?1000:ast.name==='rotate'?360000:1e6)) as Vec3;
  const child=resolve(ast.shapes[0],depth+1);if(ast.name==='repeat')return {kind:'repeat',count:number(ast.scalars[0],'scalar',1,CODE_LIMITS.repeat,true),step:vec,shape:child};
  return {kind:ast.name as 'move'|'rotate'|'scale',vector:vec,shape:child};
 }
 // Check unused declarations too; malformed definitions cannot hide behind an unused name.
 for(const [id,ast] of definitions)resolve({kind:'reference',name:id,at:ast.at});
 const result=resolve(output!);let expandedNodes=0,estimatedFaces=0;
 function budget(s:CodeShape,multiplier=1,depth=0){if(depth>32)fail(t('Expanded dependency depth exceeds 32'));expandedNodes+=multiplier;if(expandedNodes>CODE_LIMITS.expandedNodes)fail(t('Expanded shape budget exceeds 256 nodes'));if(s.kind==='box')estimatedFaces+=12*multiplier;else if(s.kind==='cylinder')estimatedFaces+=4*s.segments*multiplier;else if(s.kind==='sphere')estimatedFaces+=4*s.segments*s.segments*multiplier;else if(s.kind==='extrude')estimatedFaces+=4*s.points.length*multiplier;else if('shapes' in s)s.shapes.forEach(child=>budget(child,multiplier,depth+1));else budget(s.shape,multiplier*(s.kind==='repeat'?s.count:1),depth+1);if(estimatedFaces>CODE_LIMITS.estimatedFaces)fail(t('Estimated mesh budget exceeds 200000 faces'));}
 budget(result);return {shape:result,parameters,values:values!,expandedNodes,estimatedFaces};
}
export const defaultCodeProgram=():CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:`// A dimensioned plate with three bores. Coordinates are millimetres.\nparam width: mm = 60;\nparam depth: mm = 30;\nparam thickness: mm = 5;\nparam bore: mm = 3;\nlet plate = move([0, 0, thickness / 2], box(width, depth, thickness));\nlet holes = move([-20, 0, thickness / 2], repeat(3, [20, 0, 0], cylinder(bore, thickness * 2)));\nreturn subtract(plate, holes);\n`});
