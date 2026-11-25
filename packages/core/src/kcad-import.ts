// SPDX-License-Identifier: BSD-3-Clause
// Original bounded interpreter for a subset of kernelCAD `.kcad` model scripts
// (https://github.com/w1ne/kernelCAD-web, MIT; catalog models declare their own
// content licence). Acorn parses JavaScript; no submitted code is executed.
// TypeScript annotations must be stripped first (see scripts/convert-kcad.mjs).
// Output is an evaluated snapshot: one CAD Script program per assembly part.
import {parse} from 'acorn';
import {CadCodeError,CODE_LIMITS,compileCode} from './code.js';
import type {CodeProgram} from './code.js';
import {t} from './i18n.js';
import {shapeBoundsBySide} from './kcad-bounds.js';

type Ast={type:string;start:number;[key:string]:any};
type RecordValue={[key:string]:Value};
type Value=undefined|null|number|boolean|string|Value[]|RecordValue|Shape|Sketch|PathBuilder|Assembly|Procedure|Api|Pattern|MapValue|UncertainBound;
class Pattern {constructor(readonly regex:RegExp){}}
class MapValue {readonly map=new Map<string|number,Value>();}
class Shape {constructor(readonly source:string,readonly color?:string){}}
/** `circle` marks a sketch that is one exact circle (path().circle without a segment count). */
class Sketch {constructor(readonly contours:number[][][],readonly circle?:{cx:number;cy:number;r:number}){}}
class PathBuilder {constructor(readonly points:number[][]){}}
class Assembly {readonly parts:{name:string;shape:Shape}[]=[];constructor(readonly name:string){}}
class Procedure {constructor(readonly node:Ast,readonly scope:Scope){}}
class Api {constructor(readonly path:string,readonly receiver?:Value){}}
/** A bounding-box side that cannot be guaranteed, known only to lie in [lower, upper]. Math.min/max
 * resolve it when another operand is certainly beyond it; any other numeric use is refused. */
class UncertainBound {constructor(readonly lower:number,readonly upper:number){}}
class Returned {constructor(readonly value:Value){}}
class Scope {readonly values=new Map<string,Value>();readonly constants=new Set<string>();constructor(readonly parent?:Scope){} find(key:string):Scope|undefined{return this.values.has(key)?this:this.parent?.find(key);}}

export const KCAD_IMPORT_LIMITS=Object.freeze({sourceBytes:65536,steps:400000,loopIterations:1024,arrayItems:4096,callDepth:64,astNodes:40000,arcSegments:16,defaultSegments:48});
/** Content licences accepted for import; anything else, including kernelCAD's implicit CC-BY-4.0 default, is refused. */
export const KCAD_ACCEPTED_LICENSES=Object.freeze(['CC0-1.0','MIT']);
export interface KernelCADPart {name:string;color?:string;program:CodeProgram}
export interface KernelCADImport {name?:string;title?:string;license:string;description?:string;parts:KernelCADPart[];skippedParts:{name:string;reason:string}[];warnings:string[];parameters:Record<string,number|string|boolean>}

const fmt=(n:number)=>{const v=Math.abs(n)<1e-12?0:Number(n.toFixed(6));return String(Object.is(v,-0)?0:v);};
const vec=(v:readonly number[])=>`[${v.map(fmt).join(', ')}]`;

export function importKernelCAD(source:string,overrides:Record<string,number|string|boolean>={}):KernelCADImport{
 if(typeof source!=='string')throw new CadCodeError(t('Expected source text'),0,'');
 let steps=0,depth=0,location=0;const warnings=new Set<string>();
 const fail:(message:string,node?:Ast,code?:string)=>never=(message,node,code='invalid-source')=>{throw new CadCodeError(message,node?.start??location,source,code);};
 const unsupported:(feature:string,node?:Ast)=>never=(feature,node)=>fail(t`Unsupported kernelCAD feature “${feature}”`,node,'unsupported-feature');
 const tick=(node:Ast)=>{location=node.start;if(++steps>KCAD_IMPORT_LIMITS.steps)fail(t('kernelCAD evaluation budget exceeded'),node,'resource-limit');};
 if(new TextEncoder().encode(source).length>KCAD_IMPORT_LIMITS.sourceBytes)fail(t('kernelCAD source exceeds 64 KiB'));
 let tree:Ast;try{tree=parse(source,{ecmaVersion:2022,sourceType:'script',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true}) as Ast;}catch(error){if(error instanceof RangeError)fail(t('kernelCAD syntax nesting limit exceeded'),undefined,'resource-limit');return fail(t('Invalid JavaScript syntax; strip TypeScript annotations first'),{type:'error',start:(error as {pos?:number}).pos??0});}
 {const pending=[tree];let nodes=0;while(pending.length){const node=pending.pop()!;if(++nodes>KCAD_IMPORT_LIMITS.astNodes)fail(t('kernelCAD syntax tree limit exceeded'),node,'resource-limit');for(const value of Object.values(node))for(const child of Array.isArray(value)?value:[value])if(child&&typeof child==='object'&&typeof child.type==='string')pending.push(child);}}
 const safe=(key:string)=>{if(['__proto__','prototype','constructor'].includes(key))unsupported(key);return key;};
 const record=():RecordValue=>Object.create(null);
 const plain=(v:Value):v is RecordValue=>typeof v==='object'&&v!==null&&Object.getPrototypeOf(v)===null;
 const number=(v:Value):number=>{if(v instanceof UncertainBound)unsupported('shape.boundingBox side of a cut, intersected or partially revolved solid whose extreme is not certain');if(typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v)))return Number(v);if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e9)fail(t('Expected a finite kernelCAD number'));return v;};
 // Infinity is a JavaScript sentinel (e.g. a running minimum); it may flow through Math and comparisons, never into geometry.
 const extended=(v:Value):number=>typeof v==="number"&&(v===Infinity||v===-Infinity)?v:number(v);
 // Script arithmetic (e.g. seeded pseudo-random generators) may pass 1e9 in intermediates; geometry may not.
 const integerSafe=(v:Value):number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER?v:number(v);
 const list=(v:Value):Value[]=>{if(!Array.isArray(v)||v.length>KCAD_IMPORT_LIMITS.arrayItems)fail(t('Expected a bounded kernelCAD array'));return v;};
 const vector=(v:Value,size=3):number[]=>{const a=list(v);if(a.length!==size)fail(t`Expected a kernelCAD vector with ${size} components`);return a.map(number);};
 const array=(v:Value[]):Value[]=>{if(v.length>KCAD_IMPORT_LIMITS.arrayItems)fail(t('kernelCAD array limit exceeded'),undefined,'resource-limit');return v;};
 const shape=(text:string,color?:string)=>{if(text.length>CODE_LIMITS.sourceBytes)fail(t('kernelCAD expanded source limit exceeded'),undefined,'resource-limit');return new Shape(text,color);};
 const asShape=(v:Value):Shape=>{if(!(v instanceof Shape))fail(t('Expected kernelCAD solid geometry'));return v;};
 const optionsOf=(v:Value,allowed:string[],what:string):RecordValue=>{if(v===undefined)return record();if(!plain(v))return unsupported(`${what} options`);for(const key of Object.keys(v))if(!allowed.includes(key))unsupported(`${what} option ${key}`);return v;};
 const segments=(v:Value)=>{if(v===undefined)return KCAD_IMPORT_LIMITS.defaultSegments;const n=Math.round(number(v));if(n<3||n>512)fail(t('kernelCAD segment count must be from 3 to 512'));return n;};

 let meta:RecordValue|undefined;const parameters:Record<string,number|string|boolean>=Object.create(null);
 const root=new Scope();for(const name of ['Math','Object','Number','String','Array','meta','param','params','presets','assembly','box','cylinder','sphere','torus','path','extrudePolygon','extrudeRect','extrudeCircle','extrudeRoundedRect','filletPolygon'])root.values.set(name,new Api(name));root.values.set('undefined',undefined);root.values.set('Infinity',Infinity);

 function lookup(scope:Scope,key:string):Value{safe(key);const found=scope.find(key);if(!found)fail(t`Unknown kernelCAD name “${key}”`);return found.values.get(key);}
 function member(value:Value,key:string,node?:Ast):Value{safe(key);
  if(value instanceof Api){if(value.path==='Math'&&key in {PI:1,E:1,SQRT2:1,SQRT1_2:1})return Math[key as 'PI'];if(value.receiver===undefined)return new Api(`${value.path}.${key}`);}
  if((typeof value==='number'||typeof value==='string'||typeof value==='boolean')&&key==='value')return value; // param refs evaluate to their value
  if(typeof value==='string'){if(key==='length')return value.length;if(['startsWith','endsWith','includes','toUpperCase','toLowerCase','slice','padStart','split','replace','replaceAll','trim'].includes(key))return new Api(`string.${key}`,value);}
  if(typeof value==='number'&&key==='toFixed')return new Api('number.toFixed',value);
  if(value instanceof Pattern&&key==='test')return new Api('pattern.test',value);
  if(value instanceof MapValue){if(key==='size')return value.map.size;if(['get','set','has','keys','values','entries','forEach'].includes(key))return new Api(`map.${key}`,value);}
  if(Array.isArray(value)){if(key==='length')return value.length;if(['push','concat','map','forEach','slice','filter','reduce','some','every','find','findIndex','includes','indexOf','splice','join','flatMap','flat','reverse','fill','at','entries','unshift','sort'].includes(key))return new Api(`array.${key}`,value);if(/^\d+$/.test(key))return value[Number(key)];}
  if(value instanceof Shape||value instanceof Sketch||value instanceof PathBuilder||value instanceof Assembly)return new Api(`${value.constructor.name}.${key}`,value);
  if(plain(value))return value[key];
  if(value===undefined||value===null)return fail(t`Cannot read “${key}” of nothing`,node);
  return unsupported(`property ${key}`,node);}
 function keyOf(node:Ast,scope:Scope):string{const key=node.computed?evaluate(node.property,scope):node.property.name;if(typeof key!=='string'&&typeof key!=='number')unsupported('computed property',node);return safe(String(key));}
 function bind(pattern:Ast,value:Value,scope:Scope,constant=false){if(pattern.type==='Identifier'){safe(pattern.name);scope.values.set(pattern.name,value);if(constant)scope.constants.add(pattern.name);return;}if(pattern.type==='AssignmentPattern'){bind(pattern.left,value===undefined?evaluate(pattern.right,scope):value,scope,constant);return;}if(pattern.type==='ObjectPattern'){for(const p of pattern.properties){if(p.type!=='Property'||p.computed)unsupported('destructuring',p);bind(p.value,member(value,String(p.key.name??p.key.value)),scope,constant);}return;}if(pattern.type==='ArrayPattern'){const a=list(value);pattern.elements.forEach((p:Ast|null,i:number)=>{if(!p)return;if(p.type==='RestElement')bind(p.argument,a.slice(i),scope,constant);else bind(p,a[i],scope,constant);});return;}unsupported(pattern.type,pattern);}
 function set(node:Ast,value:Value,scope:Scope){if(node.type==='Identifier'){const target=scope.find(safe(node.name));if(!target)fail(t`Unknown kernelCAD name “${node.name}”`,node);if(target.constants.has(node.name))unsupported('const reassignment',node);target.values.set(node.name,value);return;}if(node.type==='MemberExpression'){const object=evaluate(node.object,scope),key=keyOf(node,scope);if(plain(object)){object[key]=value;return;}if(Array.isArray(object)&&/^\d+$/.test(key)&&Number(key)<KCAD_IMPORT_LIMITS.arrayItems){object[Number(key)]=value;return;}}unsupported('assignment target',node);}
 function binary(operator:string,a:Value,b:Value):Value{if(operator==='===')return a===b;if(operator==='!==')return a!==b;if(operator==='==')return a==b;if(operator==='!=')return a!=b;if(operator==='+'&&(typeof a==='string'||typeof b==='string'))return String(a)+String(b);const comparison=['<','<=','>','>='].includes(operator),x=comparison?extended(a):integerSafe(a),y=comparison?extended(b):integerSafe(b);switch(operator){case '+':return x+y;case '-':return x-y;case '*':return x*y;case '/':return x/y;case '%':return x%y;case '**':return x**y;case '<':return x<y;case '<=':return x<=y;case '>':return x>y;case '>=':return x>=y;}return unsupported(operator);}
 function evaluate(node:Ast,scope:Scope):Value{tick(node);switch(node.type){
  case 'Literal':if(node.value===null||['boolean','string','number'].includes(typeof node.value))return node.value;if(node.regex){const {pattern,flags}=node.regex;if(pattern.length>1024||!/^[gimsu]*$/.test(flags))unsupported('regular expression',node);return new Pattern(new RegExp(pattern,flags.replace('g','')));}return unsupported('literal',node);
  case 'TemplateLiteral':return node.quasis.map((q:Ast,i:number)=>q.value.cooked+(i<node.expressions.length?String(evaluate(node.expressions[i],scope)):'')).join('');
  case 'Identifier':return lookup(scope,node.name);
  case 'ArrayExpression':{const values:Value[]=[];for(const item of node.elements){if(!item)unsupported('array holes',node);if(item.type==='SpreadElement')values.push(...list(evaluate(item.argument,scope)));else values.push(evaluate(item,scope));array(values);}return values;}
  case 'ObjectExpression':{const value=record();for(const p of node.properties){if(p.type==='SpreadElement'){const other=evaluate(p.argument,scope);if(!plain(other))return unsupported('object spread',p);for(const [key,item]of Object.entries(other))value[safe(key)]=item;continue;}if(p.type!=='Property'||p.kind!=='init'||p.method)unsupported('object property',p);const key=p.computed?String(evaluate(p.key,scope)):String(p.key.name??p.key.value);value[safe(key)]=evaluate(p.value,scope);}return value;}
  case 'MemberExpression':{const object=evaluate(node.object,scope);if(node.optional&&(object===undefined||object===null))return undefined;return member(object,keyOf(node,scope),node);}
  case 'ChainExpression':return evaluate(node.expression,scope);
  case 'ArrowFunctionExpression':case 'FunctionExpression':if(node.async||node.generator)unsupported('async/generator',node);return new Procedure(node,scope);
  case 'CallExpression':{const fn=evaluate(node.callee,scope);if(node.optional&&(fn===undefined||fn===null))return undefined;const args:Value[]=[];for(const a of node.arguments){if(a.type==='SpreadElement')args.push(...list(evaluate(a.argument,scope)));else args.push(evaluate(a,scope));array(args);}location=node.start;return call(fn,args);}
  case 'NewExpression':{if(node.callee.type!=='Identifier'||node.callee.name!=='Map')return unsupported('new',node);const out=new MapValue();if(node.arguments[0])for(const entry of list(evaluate(node.arguments[0],scope))){const [k,v]=list(entry);if(typeof k!=='string'&&typeof k!=='number')unsupported('Map key',node);out.map.set(k,v);}return out;}
  case 'BinaryExpression':if(node.operator==='in'){const key=evaluate(node.left,scope),target=evaluate(node.right,scope);if((typeof key==='string'||typeof key==='number')&&plain(target))return Object.hasOwn(target,safe(String(key)));if(typeof key==='number'&&Array.isArray(target))return Number.isInteger(key)&&key>=0&&key<target.length;return unsupported('in',node);}if(node.operator==='instanceof')return unsupported(node.operator,node);return binary(node.operator,evaluate(node.left,scope),evaluate(node.right,scope));
  case 'LogicalExpression':{const a=evaluate(node.left,scope);return node.operator==='&&'?(a?evaluate(node.right,scope):a):node.operator==='||'?(a?a:evaluate(node.right,scope)):a??evaluate(node.right,scope);}
  case 'ConditionalExpression':return evaluate(evaluate(node.test,scope)?node.consequent:node.alternate,scope);
  case 'UnaryExpression':{const value=evaluate(node.argument,scope);if(node.operator==='!')return !value;if(node.operator==='-')return -number(value);if(node.operator==='+')return number(value);if(node.operator==='typeof')return value instanceof Procedure||value instanceof Api?'function':value===null?'object':typeof value;return unsupported(node.operator,node);}
  case 'AssignmentExpression':{if(['&&=','||=','??='].includes(node.operator))return unsupported(node.operator,node);const value=node.operator==='='?evaluate(node.right,scope):binary(node.operator.slice(0,-1),evaluate(node.left,scope),evaluate(node.right,scope));set(node.left,value,scope);return value;}
  case 'UpdateExpression':{const before=number(evaluate(node.argument,scope)),after=before+(node.operator==='++'?1:-1);set(node.argument,after,scope);return node.prefix?after:before;}
  case 'AwaitExpression':return evaluate(node.argument,scope); // every value is already evaluated; await is the identity
  case 'SequenceExpression':{let last:Value;for(const e of node.expressions)last=evaluate(e,scope);return last;}
  default:return unsupported(node.type,node);
 }}
 function block(nodes:Ast[],scope:Scope):Returned|'break'|'continue'|undefined{for(const node of nodes)if(node.type==='FunctionDeclaration'){if(node.async||node.generator)unsupported('async/generator',node);scope.values.set(safe(node.id.name),new Procedure(node,scope));}for(const node of nodes){const result=statement(node,scope);if(result)return result;}}
 function loopBody(body:Ast,scope:Scope):Returned|'break'|undefined{const result=statement(body,scope);if(result==='continue')return;return result;}
 function statement(node:Ast,scope:Scope):Returned|'break'|'continue'|undefined{tick(node);switch(node.type){
  case 'VariableDeclaration':for(const d of node.declarations)bind(d.id,d.init?evaluate(d.init,scope):undefined,scope,node.kind==='const');return;
  case 'FunctionDeclaration':return;
  case 'ExpressionStatement':evaluate(node.expression,scope);return;
  case 'ReturnStatement':return new Returned(node.argument?evaluate(node.argument,scope):undefined);
  case 'BlockStatement':return block(node.body,new Scope(scope));
  case 'EmptyStatement':return;
  case 'BreakStatement':if(node.label)unsupported('labelled break',node);return 'break';
  case 'ContinueStatement':if(node.label)unsupported('labelled continue',node);return 'continue';
  case 'IfStatement':return evaluate(node.test,scope)?statement(node.consequent,scope):node.alternate?statement(node.alternate,scope):undefined;
  case 'ForStatement':{const local=new Scope(scope);if(node.init)node.init.type==='VariableDeclaration'?statement(node.init,local):evaluate(node.init,local);let iterations=0;while(!node.test||evaluate(node.test,local)){if(++iterations>KCAD_IMPORT_LIMITS.loopIterations)fail(t('kernelCAD loop limit exceeded'),node,'resource-limit');const result=loopBody(node.body,local);if(result==='break')break;if(result)return result;if(node.update)evaluate(node.update,local);}return;}
  case 'ForOfStatement':{const source=evaluate(node.right,scope),items=typeof source==='string'?[...source]:list(source);if(items.length>KCAD_IMPORT_LIMITS.loopIterations)fail(t('kernelCAD loop limit exceeded'),node,'resource-limit');for(const item of items){const local=new Scope(scope);if(node.left.type!=='VariableDeclaration')unsupported('for-of target',node);bind(node.left.declarations[0].id,item,local,node.left.kind==='const');const result=loopBody(node.body,local);if(result==='break')break;if(result)return result;}return;}
  case 'WhileStatement':{let iterations=0;while(evaluate(node.test,scope)){if(++iterations>KCAD_IMPORT_LIMITS.loopIterations)fail(t('kernelCAD loop limit exceeded'),node,'resource-limit');const result=loopBody(node.body,new Scope(scope));if(result==='break')break;if(result)return result;}return;}
  case 'ThrowStatement':return fail(t('kernelCAD source threw an error'),node);
  case 'SwitchStatement':{const value=evaluate(node.discriminant,scope),local=new Scope(scope);let matched=false;for(const c of node.cases){if(!matched)matched=c.test===null?false:evaluate(c.test,local)===value;if(!matched)continue;const result=block(c.consequent,local);if(result==='break')return;if(result)return result;}if(!matched){const fallback=node.cases.findIndex((c:Ast)=>c.test===null);if(fallback>=0)for(const c of node.cases.slice(fallback)){const result=block(c.consequent,local);if(result==='break')return;if(result)return result;}}return;}
  default:return unsupported(node.type,node);
 }}
 const deg=(v:Value)=>number(v);
 function rotation(target:Shape,axis:number[],angle:number,pivot?:Value):Shape{if(Math.hypot(...axis)<1e-12)fail(t('Transform axis must be nonzero'));let body=`axisRotate(${vec(axis)}, ${fmt(angle)}, ${target.source})`;if(pivot!==undefined){const p=vector(pivot);body=`move(${vec(p)}, axisRotate(${vec(axis)}, ${fmt(angle)}, move(${vec(p.map(v=>-v))}, ${target.source})))`;}return shape(body,target.color);}
 function arc(from:number[],to:number[],mid:number[]):number[][]{const [ax,ay]=from,[bx,by]=mid,[cx,cy]=to,d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));if(Math.abs(d)<1e-12)return [to];const ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/d,uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/d,r=Math.hypot(ax-ux,ay-uy),angle=(x:number,y:number)=>Math.atan2(y-uy,x-ux),a0=angle(ax,ay),norm=(a:number)=>{while(a<0)a+=2*Math.PI;while(a>=2*Math.PI)a-=2*Math.PI;return a;},ccwMid=norm(angle(bx,by)-a0),ccwEnd=norm(angle(cx,cy)-a0),sweep=ccwMid<=ccwEnd?ccwEnd:ccwEnd-2*Math.PI,n=Math.max(2,Math.ceil(KCAD_IMPORT_LIMITS.arcSegments*Math.abs(sweep)/Math.PI));return Array.from({length:n},(_,i)=>i===n-1?to:[ux+r*Math.cos(a0+sweep*(i+1)/n),uy+r*Math.sin(a0+sweep*(i+1)/n)]);}
 const profile=(s:Sketch)=>s.circle?`move2d(${fmt(s.circle.cx)}, ${fmt(s.circle.cy)}, circle2d(${fmt(s.circle.r)}))`:s.contours.length===1?`polygon2d(${JSON.stringify(s.contours[0].map(p=>p.map(v=>Number(fmt(v)))))})`:`polygon2d(${JSON.stringify(s.contours.flat().map(p=>p.map(v=>Number(fmt(v)))))}, ${JSON.stringify(s.contours.reduce<number[][]>((paths,c)=>{const start=paths.flat().length;paths.push(c.map((_,i)=>start+i));return paths;},[]))})`;
 // Original corner rounding: tangent arcs cut back along both edges, capped at half of each edge.
 function filletCorners(points:number[][],r:number,n:number):number[][]{if(points.length<3||r===0)return points;const out:number[][]=[];for(let i=0;i<points.length;i++){const p=points[(i+points.length-1)%points.length],c=points[i],q=points[(i+1)%points.length],u=[p[0]-c[0],p[1]-c[1]],v=[q[0]-c[0],q[1]-c[1]],lu=Math.hypot(...u),lv=Math.hypot(...v);if(lu<1e-12||lv<1e-12){out.push(c);continue;}const ua=[u[0]/lu,u[1]/lu],va=[v[0]/lv,v[1]/lv],cos=Math.max(-1,Math.min(1,ua[0]*va[0]+ua[1]*va[1])),theta=Math.acos(cos);if(theta<1e-6||Math.PI-theta<1e-6){out.push(c);continue;}let d=r/Math.tan(theta/2);d=Math.min(d,lu/2,lv/2);const radius=d*Math.tan(theta/2),a=[c[0]+ua[0]*d,c[1]+ua[1]*d],b=[c[0]+va[0]*d,c[1]+va[1]*d],bis=[ua[0]+va[0],ua[1]+va[1]],lb=Math.hypot(...bis),h=radius/Math.sin(theta/2),centre=[c[0]+bis[0]/lb*h,c[1]+bis[1]/lb*h],a0=Math.atan2(a[1]-centre[1],a[0]-centre[0]);let sweep=Math.atan2(b[1]-centre[1],b[0]-centre[0])-a0;while(sweep>Math.PI)sweep-=2*Math.PI;while(sweep<-Math.PI)sweep+=2*Math.PI;for(let k=0;k<=n;k++)out.push([centre[0]+radius*Math.cos(a0+sweep*k/n),centre[1]+radius*Math.sin(a0+sweep*k/n)]);}if(out.length>KCAD_IMPORT_LIMITS.arrayItems)fail(t('kernelCAD array limit exceeded'),undefined,'resource-limit');return out;}
 const circleContour=(cx:number,cy:number,r:number,n:number)=>Array.from({length:n},(_,i)=>[cx+r*Math.cos(2*Math.PI*i/n),cy+r*Math.sin(2*Math.PI*i/n)]);
 function call(fn:Value,args:Value[]):Value{
  if(++depth>KCAD_IMPORT_LIMITS.callDepth)fail(t('kernelCAD call depth exceeded'),undefined,'resource-limit');try{
   if(fn instanceof Procedure){const local=new Scope(fn.scope);if(fn.node.id)local.values.set(fn.node.id.name,fn);fn.node.params.forEach((p:Ast,i:number)=>{if(p.type==='RestElement')bind(p.argument,args.slice(i),local);else bind(p,args[i],local);});if(fn.node.body.type!=='BlockStatement')return evaluate(fn.node.body,local);const result=block(fn.node.body.body,local);return result instanceof Returned?result.value:undefined;}
   if(!(fn instanceof Api))return unsupported('call target');const path=fn.path,self=fn.receiver;
   if(path.startsWith('Math.')){const functions:Record<string,(...x:number[])=>number>={sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,atan2:Math.atan2,sqrt:Math.sqrt,cbrt:Math.cbrt,abs:Math.abs,floor:Math.floor,ceil:Math.ceil,round:Math.round,trunc:Math.trunc,sign:Math.sign,min:Math.min,max:Math.max,pow:Math.pow,hypot:Math.hypot,exp:Math.exp,log:Math.log,log2:Math.log2,log10:Math.log10,sinh:Math.sinh,cosh:Math.cosh,tanh:Math.tanh};const method=functions[path.slice(5)];if(!method)return unsupported(path);
    if((path==='Math.min'||path==='Math.max')&&args.some(a=>a instanceof UncertainBound)){
     const known=args.filter(a=>!(a instanceof UncertainBound)).map(extended),open=args.filter((a):a is UncertainBound=>a instanceof UncertainBound),low=path==='Math.min';
     const best=low?Math.min(...known):Math.max(...known);
     if(known.length&&open.every(u=>low?u.lower>=best:u.upper<=best))return best;
     return new UncertainBound(low?Math.min(best,...open.map(u=>u.lower)):Math.max(best,...open.map(u=>u.lower)),low?Math.min(best,...open.map(u=>u.upper)):Math.max(best,...open.map(u=>u.upper)));
    }
    return method(...args.map(extended));}
   switch(path){
    case 'Number':return Number(args[0]);case 'String':return String(args[0]);case 'Number.isFinite':return typeof args[0]==='number'&&Number.isFinite(args[0]);case 'Array.isArray':return Array.isArray(args[0]);
    case 'Array.from':{const spec=args[0];if(!plain(spec)||typeof spec.length!=='number')return unsupported('Array.from source');const n=number(spec.length);if(n<0||n>KCAD_IMPORT_LIMITS.arrayItems)fail(t('kernelCAD array limit exceeded'),undefined,'resource-limit');return Array.from({length:n},(_,i)=>args[1]===undefined?undefined:call(args[1],[undefined,i]));}
    case 'Object.entries':if(!plain(args[0]))return unsupported('Object.entries source');return Object.entries(args[0]).map(([k,v])=>[k,v]);
    case 'Object.keys':if(!plain(args[0]))return unsupported('Object.keys source');return Object.keys(args[0]);
    case 'Object.values':if(!plain(args[0]))return unsupported('Object.values source');return Object.values(args[0]);
    case 'meta':if(!plain(args[0]))return unsupported('meta arguments');meta=args[0];return undefined;
    case 'presets':return undefined;
    case 'param':{const name=args[0];if(typeof name!=='string')return unsupported('param name');const value=Object.hasOwn(overrides,name)?overrides[name]:args[1];if(!['number','string','boolean'].includes(typeof value))return unsupported('param default');const opts=plain(args[2])?args[2]:undefined;if(typeof value==='number'&&opts&&(typeof opts.min==='number'&&value<opts.min||typeof opts.max==='number'&&value>opts.max))fail(t`kernelCAD parameter “${name}” is outside its declared range`);parameters[name]=value as number|string|boolean;return value;}
    case 'params':{if(!plain(args[0]))return unsupported('params declaration');const out=record();for(const [name,spec] of Object.entries(args[0])){const value=Object.hasOwn(overrides,name)?overrides[name]:plain(spec)?spec.default:spec;if(!['number','string','boolean'].includes(typeof value))return unsupported('params default');parameters[name]=value as number;out[name]=value;}return out;}
    case 'assembly':return new Assembly(typeof args[0]==='string'?args[0]:'model');
    case 'box':{
     // A negative size spans [size, 0] from the corner, as in OCCT; centred boxes use |size|.
     const [x,y,z]=args.slice(0,3).map(number);if(x===0||y===0||z===0)fail(t('Expected nonzero kernelCAD box dimensions'));if(args[4]!==undefined)optionsOf(args[4],['faceLabels'],'box');const body=`box(${fmt(Math.abs(x))}, ${fmt(Math.abs(y))}, ${fmt(Math.abs(z))})`;return shape(args[3]===true?body:`move(${vec([x/2,y/2,z/2])}, ${body})`);}
    case 'cylinder':{const h=number(args[0]),r=number(args[1]);if(h<=0||r<=0)fail(t('Expected positive kernelCAD cylinder dimensions'));if(plain(args[2]))unsupported('cylinder options in the segments argument');if(args[3]!==undefined)optionsOf(args[3],['faceLabels'],'cylinder');
     // The source format ignores the segment count: its cylinder is always exact, so it keeps CAD Script's default (a true circle).
     return shape(`move([0, 0, ${fmt(h/2)}], cylinder(${fmt(r)}, ${fmt(h)}))`);}
    case 'sphere':{const r=number(args[0]);if(r<=0)fail(t('Expected a positive kernelCAD sphere radius'));return shape(`sphere(${fmt(r)}, ${KCAD_IMPORT_LIMITS.defaultSegments})`);}
    case 'torus':{const R=number(args[0]),r=number(args[1]);if(R<=r||r<=0)fail(t('Expected a kernelCAD torus with a positive tube inside its ring'));
     // Without a count the tube is an exact circle; with one it is an n-gon (first vertex at the
     // outer equator) revolved exactly. Only the tube is faceted, never the ring.
     if(args[2]===undefined)return shape(`torus(${fmt(R)}, ${fmt(r)})`);
     return shape(`revolve(${profile(new Sketch([circleContour(R,0,r,segments(args[2]))]))}, 360)`);}
    case 'extrudePolygon':{const points=list(args[0]).map(p=>vector(p,2)),d=number(args[1]);optionsOf(args[2],[],'extrudePolygon');return shape(`extrudeProfile(${fmt(d)}, ${profile(new Sketch([points]))})`);}
    case 'extrudeRect':{const [w,h,d]=args.slice(0,3).map(number);optionsOf(args[3],[],'extrudeRect');return shape(`extrudeProfile(${fmt(d)}, rectangle2d(${fmt(w)}, ${fmt(h)}, true))`);}
    case 'extrudeCircle':{const [r,d]=args.slice(0,2).map(number);optionsOf(args[2],[],'extrudeCircle');return shape(`extrudeProfile(${fmt(d)}, circle2d(${fmt(r)}, ${KCAD_IMPORT_LIMITS.defaultSegments}))`);}
    case 'path':return new PathBuilder([]);
    case 'extrudeRoundedRect':{
     // Centred w × h profile swept along +Z; the radius is clamped below half the shorter side as in
     // the source format. axis 'x' maps (x, y, z) to (z, x, y), axis 'y' maps it to (x, z, -y).
     const [w,h,rIn,d]=args.slice(0,4).map(number),o=optionsOf(args[4],['axis','twistAngle','faceLabels'],'extrudeRoundedRect'),axis=o.axis===undefined?'z':o.axis;
     if(o.twistAngle!==undefined&&number(o.twistAngle)!==0)unsupported('extrudeRoundedRect twistAngle');if(axis!=='x'&&axis!=='y'&&axis!=='z')return unsupported(`extrudeRoundedRect axis ${String(axis)}`);
     if(w<=0||h<=0||d<=0||rIn<0)fail(t('Invalid kernelCAD rounded rectangle'));const r=Math.min(rIn,Math.min(w,h)/2*0.9999);
     const body=r===0?`extrudeProfile(${fmt(d)}, rectangle2d(${fmt(w)}, ${fmt(h)}, true))`:`extrudeProfile(${fmt(d)}, offset2d(${fmt(r)}, 1, ${KCAD_IMPORT_LIMITS.defaultSegments}, rectangle2d(${fmt(w-2*r)}, ${fmt(h-2*r)}, true)))`;
     return shape(axis==='z'?body:axis==='x'?`axisRotate([1, 1, 1], 120, ${body})`:`axisRotate([1, 0, 0], -90, ${body})`);}
    case 'filletPolygon':{const points=list(args[0]).map(p=>vector(p,2)),r=number(args[1]),o=optionsOf(args[2],['segments'],'filletPolygon'),n=o.segments===undefined?8:Math.max(1,Math.min(64,Math.round(number(o.segments))));if(r<0)fail(t('Invalid kernelCAD fillet radius'));return filletCorners(points,r,n);}
   }
   if(self instanceof PathBuilder){const pts=self.points,last=()=>{if(!pts.length)fail(t('kernelCAD path needs moveTo first'));return pts[pts.length-1];};
    switch(path){
     case 'PathBuilder.moveTo':if(pts.length)return unsupported('multiple moveTo in one path');return new PathBuilder([[number(args[0]),number(args[1])]]);
     case 'PathBuilder.lineTo':last();return new PathBuilder([...pts,[number(args[0]),number(args[1])]]);
     case 'PathBuilder.threePointsArc':return new PathBuilder([...pts,...arc(last(),[number(args[0]),number(args[1])],[number(args[2]),number(args[3])])]);
     case 'PathBuilder.label':return self;
     case 'PathBuilder.close':{const contour=pts.slice();if(contour.length>1&&Math.hypot(contour[0][0]-contour.at(-1)![0],contour[0][1]-contour.at(-1)![1])<1e-9)contour.pop();if(contour.length<3)fail(t('kernelCAD path needs at least three points'));return new Sketch([contour]);}
     case 'PathBuilder.circle':{const [cx,cy,r]=args.slice(0,3).map(number);if(r<=0)fail(t('Expected a positive kernelCAD circle radius'));
      // Without a segment count the source circle is exact: keep it a true circle2d (the contour only serves lofts).
      return new Sketch([circleContour(cx,cy,r,segments(args[3]))],args[3]===undefined?{cx,cy,r}:undefined);}
    }
    return unsupported(path.replace('PathBuilder.','path.'));
   }
   if(self instanceof Sketch){
    switch(path){
     case 'Sketch.extrude':{const d=number(args[0]);optionsOf(args[1],[],'extrude');if(d<=0)fail(t('Expected a positive kernelCAD extrusion depth'));return shape(`extrudeProfile(${fmt(d)}, ${profile(self)})`);}
     case 'Sketch.revolve':{const o=optionsOf(args[0],['angleDeg'],'revolve'),angle=o.angleDeg===undefined?360:number(o.angleDeg);return shape(`revolve(${profile(self)}, ${fmt(angle)}, ${KCAD_IMPORT_LIMITS.defaultSegments})`);}
     case 'Sketch.loft':{const others=Array.isArray(args[0])?args[0]:[args[0]],o=optionsOf(args[1],['spacing','planes','ruled'],'loft'),spacing=o.spacing===undefined?10:number(o.spacing),sections=[self,...others];if(!sections.every(s=>s instanceof Sketch&&s.contours.length===1))return unsupported('loft sections');const counts=new Set((sections as Sketch[]).map(s=>s.contours[0].length));if(counts.size!==1)return unsupported('loft sections with different point counts');
      // Planes: XY only, one per section (or one per added section, with the base at z=0).
      let origins=sections.map((_,i)=>[0,0,i*spacing]);if(o.planes!==undefined){const planes=list(o.planes).map(p=>{if(!plain(p)||p.plane!=='XY'||Object.keys(p).some(k=>!['plane','origin'].includes(k)))return unsupported('loft plane other than XY');return p.origin===undefined?[0,0,0]:vector(p.origin);});if(planes.length===sections.length)origins=planes;else if(planes.length===sections.length-1)origins=[[0,0,0],...planes];else return unsupported('loft plane count');}
      if(o.ruled!==true&&sections.length>2)warnings.add(t('Smooth kernelCAD lofts through more than two sections are converted as ruled lofts'));
      return shape(`loft([${(sections as Sketch[]).map((s,i)=>`[${s.contours[0].map(p=>vec([p[0]+origins[i][0],p[1]+origins[i][1],origins[i][2]])).join(', ')}]`).join(', ')}])`);}
    }
    return unsupported(path.replace('Sketch.','sketch.'));
   }
   if(self instanceof Shape){
    switch(path){
     case 'Shape.translate':{const v=Array.isArray(args[0])?vector(args[0]):[0,1,2].map(i=>number(args[i]??0));return shape(`move(${vec(v)}, ${self.source})`,self.color);}
     case 'Shape.rotate':return rotation(self,vector(args[0]),deg(args[1]),args[2]);
     case 'Shape.rotateX':return rotation(self,[1,0,0],deg(args[0]),args[1]);
     case 'Shape.rotateY':return rotation(self,[0,1,0],deg(args[0]),args[1]);
     case 'Shape.rotateZ':return rotation(self,[0,0,1],deg(args[0]),args[1]);
     case 'Shape.alongAxis':{const a=vector(args[0]),l=Math.hypot(...a);if(l<1e-12)fail(t('Transform axis must be nonzero'));const [x,y,z]=a.map(v=>v/l);if(z>1-1e-12)return self;if(z<-1+1e-12)return rotation(self,[1,0,0],180);return rotation(self,[-y,x,0],Math.acos(z)*180/Math.PI);}
     case 'Shape.scale':{const v=Array.isArray(args[0])?vector(args[0]):args.length>=3?args.slice(0,3).map(number):Array(3).fill(number(args[0]));if(v.every(x=>x===1))return self;return shape(`scale(${vec(v)}, ${self.source})`,self.color);}
     case 'Shape.color':if(typeof args[0]!=='string')return unsupported('color value');return shape(self.source,args[0]);
     case 'Shape.union':case 'Shape.subtract':case 'Shape.intersect':{const others=args.flat().map(asShape);if(!others.length)return self;return shape(`${path.slice(6)}(${[self,...others].map(s=>s.source).join(', ')})`,self.color);}
     case 'Shape.mirror':{const plane=typeof args[0]==='string'?args[0]:plain(args[0])?args[0].plane:undefined;if(plain(args[0])&&args[0].offset!==undefined&&number(args[0].offset)!==0)return unsupported('mirror offset');const normal=plane==='xy'?[0,0,1]:plane==='xz'?[0,1,0]:plane==='yz'?[1,0,0]:unsupported('mirror plane');return shape(`union(${self.source}, mirror(${vec(normal)}, ${self.source}))`,self.color);}
     case 'Shape.boundingBox':{
      // Evaluated at conversion time from the converted part: exact bounds of the modelled solid
      // (true circles, cylinders and spheres), which is what { exact: true } asks for.
      const o=optionsOf(args[0],['exact'],'boundingBox');if(o.exact!==true)return unsupported('shape.boundingBox without { exact: true } (padded kernel bounds)');
      let tree;try{tree=compileCode({version:1,language:'brickwright-cad-script',parameters:{},source:`return ${self.source};`}).shape;}catch{return unsupported('shape.boundingBox of a part over the CAD Script limits');}
      // A side that is not guaranteed (a cutter reaching it, an intersection) becomes a marker that
      // refuses conversion only when the script actually reads it.
      const b=shapeBoundsBySide(tree),side=(v:number|undefined,lower:number,upper:number):Value=>v===undefined?new UncertainBound(lower,upper):Number(fmt(v)),both=(f:(lo:number,hi:number)=>number)=>b.min.map((lo,i)=>lo===undefined||b.max[i]===undefined?new UncertainBound(-Infinity,Infinity):Number(fmt(f(lo,b.max[i]!))));
      const box=record();box.min=b.min.map((v,i)=>side(v,b.limit.min[i],Infinity));box.max=b.max.map((v,i)=>side(v,-Infinity,b.limit.max[i]));box.size=both((lo,hi)=>hi-lo);box.center=both((lo,hi)=>(lo+hi)/2);return box;}
     case 'Shape.name':case 'Shape.label':case 'Shape.material':case 'Shape.tag':warnings.add(t`Ignored kernelCAD metadata ${path.slice(6)}()`);return self;
    }
    return unsupported(path.replace('Shape.','shape.'));
   }
   if(self instanceof Assembly){
    switch(path){
     case 'Assembly.part':{const name=args[0];if(typeof name!=='string')return unsupported('part name');const value=args[1] instanceof Procedure?call(args[1],[]):args[1];if(value instanceof Assembly)return unsupported('nested assembly');self.parts.push({name,shape:asShape(value)});return self;}
     case 'Assembly.model':return self;
     // Connectors only name frames for mates; a mate at pose 0 is the as-built placement, so both
     // leave the converted geometry unchanged. Another pose would move parts and is refused.
     case 'Assembly.connector':warnings.add(t`Ignored kernelCAD assembly ${path.slice(9)}(); parts keep their authored placement`);return self;
     case 'Assembly.mate':{const o=args.find(plain) as RecordValue|undefined;if(o&&o.pose!==undefined&&number(o.pose)!==0)return unsupported('assembly.mate with a nonzero pose');}
     // falls through
     case 'Assembly.place':warnings.add(t`Ignored kernelCAD assembly ${path.slice(9)}(); parts keep their authored placement`);return self;
    }
    return unsupported(path.replace('Assembly.','assembly.'));
   }
   if(Array.isArray(self)){const values=self as Value[],fnArg=args[0];switch(path){
    case 'array.push':array([...values,...args]);values.push(...args);return values.length;
    case 'array.concat':return array(values.concat(...args.map(v=>Array.isArray(v)?v:[v])));
    case 'array.slice':return values.slice(args[0]===undefined?0:number(args[0]),args[1]===undefined?undefined:number(args[1]));
    case 'array.map':return values.map((v,i)=>call(fnArg,[v,i,values]));
    case 'array.flatMap':return array(values.flatMap((v,i)=>{const r=call(fnArg,[v,i,values]);return Array.isArray(r)?r:[r];}));
    case 'array.forEach':values.forEach((v,i)=>call(fnArg,[v,i,values]));return undefined;
    case 'array.filter':return values.filter((v,i)=>call(fnArg,[v,i,values]));
    case 'array.some':return values.some((v,i)=>call(fnArg,[v,i,values]));
    case 'array.every':return values.every((v,i)=>call(fnArg,[v,i,values]));
    case 'array.find':return values.find((v,i)=>call(fnArg,[v,i,values]));
    case 'array.findIndex':return values.findIndex((v,i)=>call(fnArg,[v,i,values]));
    case 'array.splice':{const start=number(args[0]),count=args.length>1?number(args[1]):values.length;array([...values,...args.slice(2)]);return values.splice(start,count,...args.slice(2));}
    case 'array.reduce':{let acc=args.length>1?args[1]:values[0];for(let i=args.length>1?0:1;i<values.length;i++)acc=call(fnArg,[acc,values[i],i,values]);return acc;}
    case 'array.includes':return values.includes(args[0]);case 'array.indexOf':return values.indexOf(args[0]);
    case 'array.join':return values.map(String).join(args[0]===undefined?',':String(args[0]));
    case 'array.flat':return array(values.flat() as Value[]);case 'array.reverse':return values.reverse();
    case 'array.at':return values.at(number(args[0]));case 'array.fill':return values.fill(args[0]);
    case 'array.entries':return values.map((v,i)=>[i,v]);
    case 'array.unshift':array([...args,...values]);values.unshift(...args);return values.length;
    case 'array.sort':{if(fnArg===undefined){if(!values.every(v=>typeof v==='number')&&!values.every(v=>typeof v==='string'))return unsupported('sort without comparator');return values.sort();}return values.sort((a,b)=>number(call(fnArg,[a,b])));}
   }}
   if(typeof self==='string'){const s=self;switch(path){case 'string.startsWith':return s.startsWith(String(args[0]));case 'string.endsWith':return s.endsWith(String(args[0]));case 'string.includes':return s.includes(String(args[0]));case 'string.toUpperCase':return s.toUpperCase();case 'string.toLowerCase':return s.toLowerCase();case 'string.trim':return s.trim();case 'string.slice':return s.slice(args[0]===undefined?0:number(args[0]),args[1]===undefined?undefined:number(args[1]));case 'string.padStart':return s.padStart(number(args[0]),args[1]===undefined?' ':String(args[1]));case 'string.split':return s.split(String(args[0]));case 'string.replace':case 'string.replaceAll':{if(typeof args[0]!=='string'||typeof args[1]!=='string')return unsupported(`${path} with a non-string pattern or replacement`);return path==='string.replace'?s.replace(args[0],args[1]):s.replaceAll(args[0],args[1]);}}}
   if(path==='number.toFixed')return number(self).toFixed(args[0]===undefined?0:number(args[0]));
   if(self instanceof Pattern&&path==='pattern.test'){const text=String(args[0]);if(text.length>256)return unsupported('long regular-expression subject');return self.regex.test(text);}
   if(self instanceof MapValue){const m=self.map,key=(v:Value)=>{if(typeof v!=='string'&&typeof v!=='number')return unsupported('Map key');return v;};switch(path){case 'map.get':return m.get(key(args[0]));case 'map.has':return m.has(key(args[0]));case 'map.set':if(m.size>=KCAD_IMPORT_LIMITS.arrayItems)fail(t('kernelCAD array limit exceeded'),undefined,'resource-limit');m.set(key(args[0]),args[1]);return self;case 'map.keys':return [...m.keys()];case 'map.values':return [...m.values()];case 'map.entries':return [...m.entries()].map(([k,v])=>[k,v]);case 'map.forEach':m.forEach((v,k)=>call(args[0],[v,k]));return undefined;}}
   return unsupported(path);
  }finally{depth--;}
 }
 const result=block(tree.body,root);
 const license=typeof meta?.license==='string'?meta.license:'CC-BY-4.0';
 if(!KCAD_ACCEPTED_LICENSES.includes(license))fail(t`kernelCAD content licence ${license} is not accepted; only CC0-1.0 and MIT models can be imported`,undefined,'licence');
 const returned=result instanceof Returned?result.value:undefined;
 const parts=returned instanceof Assembly?returned.parts:returned instanceof Shape?[{name:typeof meta?.name==='string'?meta.name:'model',shape:returned}]:fail(t('kernelCAD source must return a shape or an assembly model'));
 const out:KernelCADPart[]=[],skippedParts:{name:string;reason:string}[]=[];
 for(const part of parts){const program:CodeProgram={version:1,language:'brickwright-cad-script',parameters:{},source:`return ${part.shape.source};`};try{compileCode(program);out.push({name:part.name,...(part.shape.color?{color:part.shape.color}:{}),program});}catch(error){skippedParts.push({name:part.name,reason:error instanceof Error?error.message:String(error)});}}
 if(!out.length)fail(t('No kernelCAD part fits the CAD Script limits'),undefined,'resource-limit');
 const text=(v:Value)=>typeof v==='string'?v:undefined;
 return {...(text(meta?.name)?{name:text(meta?.name)}:{}),...(text(meta?.title)?{title:text(meta?.title)}:{}),...(text(meta?.description)?{description:text(meta?.description)}:{}),license,parts:out,skippedParts,warnings:[...warnings],parameters:{...parameters}};
}
