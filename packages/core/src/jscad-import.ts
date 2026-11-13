// SPDX-License-Identifier: BSD-3-Clause
// Original bounded AST interpreter. Acorn parses syntax; no submitted JS is executed.
import {parse} from 'acorn';
import {CadCodeError,CODE_LIMITS,compileCode} from './code.js';
import type {CodeProgram} from './code.js';
import {t} from './i18n.js';
type Ast={type:string;start:number;[key:string]:any};
type RecordValue={[key:string]:Value};
type Value=undefined|null|number|boolean|string|Value[]|RecordValue|Geometry|Profile|Procedure|Api;
class Geometry {constructor(readonly source:string,readonly color?:string){}}
class Profile {constructor(readonly points:number[][]){}}
class Procedure {constructor(readonly node:Ast,readonly scope:Scope){}}
class Api {constructor(readonly path:string,readonly receiver?:Value[]){}}
class Returned {constructor(readonly value:Value){}}
class Scope {readonly values=new Map<string,Value>();readonly constants=new Set<string>();constructor(readonly parent?:Scope){} find(key:string):Scope|undefined{return this.values.has(key)?this:this.parent?.find(key);}}
export interface JSCADImportOptions {entryPoint?:string;arguments?:readonly (number|string|boolean)[]}
export interface JSCADImport {program:CodeProgram;outputs:{program:CodeProgram;color?:string}[];warnings:string[];parameters:Record<string,number|string|boolean>;evaluatedSnapshot:true}
export const JSCAD_IMPORT_LIMITS=Object.freeze({steps:20000,loopIterations:64,arrayItems:256,callDepth:32,astDepth:128,astNodes:8192});
export function importJSCAD(source:string,overrides:Record<string,number|string|boolean>={},options:JSCADImportOptions={}):JSCADImport{
 if(typeof source!=='string')throw new CadCodeError(t('Expected source text'),0,'');
 let steps=0,depth=0,location=0,coloursUsed=false;
 const fail:(message:string,node?:Ast,code?:string)=>never=(message,node,code='invalid-source')=>{throw new CadCodeError(message,node?.start??location,source,code);};
 const unsupported:(feature:string,node?:Ast)=>never=(feature,node)=>fail(t`Unsupported JSCAD feature “${feature}”`,node,'unsupported-feature');
 const tick=(node:Ast)=>{location=node.start;if(++steps>JSCAD_IMPORT_LIMITS.steps)fail(t('JSCAD evaluation budget exceeded'),node,'resource-limit');};
 if(new TextEncoder().encode(source).length>CODE_LIMITS.sourceBytes)fail(t('Source exceeds 32 KiB'));
 let tree:Ast;try{tree=parse(source,{ecmaVersion:2022,sourceType:'module'}) as Ast;}catch(error){if(error instanceof RangeError)fail(t('JSCAD syntax nesting limit exceeded'),undefined,'resource-limit');return fail(t('Invalid JavaScript syntax'),{type:'error',start:(error as {pos?:number}).pos??0});}
 const pending=[{node:tree,depth:0}];let nodes=0;while(pending.length){const item=pending.pop()!;if(++nodes>8192||item.depth>128)fail(t('JSCAD syntax tree limit exceeded'),item.node,'resource-limit');for(const value of Object.values(item.node)){for(const child of Array.isArray(value)?value:[value])if(child&&typeof child==='object'&&typeof child.type==='string')pending.push({node:child,depth:item.depth+1});}}
 const safe=(key:string)=>{if(['__proto__','prototype','constructor'].includes(key))unsupported(key);return key;};
 const record=():RecordValue=>Object.create(null);
 const plain=(v:Value):v is RecordValue=>typeof v==='object'&&v!==null&&Object.getPrototypeOf(v)===null;
 const number=(v:Value):number=>{if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e9)fail(t('Expected a finite JSCAD number'));return v;};
 const list=(v:Value):Value[]=>{if(!Array.isArray(v)||v.length>JSCAD_IMPORT_LIMITS.arrayItems)fail(t('Expected a bounded JSCAD array'));return v;};
 const vector=(v:Value,size=3):number[]=>{const a=list(v);if(a.length!==size)fail(t`Expected a JSCAD vector with ${size} components`);return a.map(number);};
 const array=(v:Value[]):Value[]=>{if(v.length>JSCAD_IMPORT_LIMITS.arrayItems)fail(t('JSCAD array limit exceeded'),undefined,'resource-limit');return v;};
 const geometry=(text:string,color?:string):Geometry=>{if(text.length>CODE_LIMITS.sourceBytes)fail(t('JSCAD expanded source limit exceeded'),undefined,'resource-limit');return new Geometry(text,color);};
 function geometries(values:Value[]):Geometry[]{const out:Geometry[]=[];const add=(v:Value,n=0)=>{if(n>32)fail(t('JSCAD array nesting limit exceeded'),undefined,'resource-limit');if(Array.isArray(v)){for(const x of v)add(x,n+1);}else if(v instanceof Geometry)out.push(v);else fail(t('Expected JSCAD solid geometry'));if(out.length>256)fail(t('JSCAD array limit exceeded'),undefined,'resource-limit');};for(const v of values)add(v);return out;}
 const merged=(name:string,items:Geometry[])=>{if(!items.length)fail(t('JSCAD construction returned no solids'));return items.length===1?items[0]:geometry(`${name}(${items.map(v=>v.source).join(', ')})`);};
 const root=new Scope(),module=record(),initialExports=record();module.exports=initialExports;root.values.set('module',module);root.values.set('exports',initialExports);root.values.set('require',new Api('require'));root.values.set('Math',new Api('Math'));root.values.set('undefined',undefined);
 function lookup(scope:Scope,key:string):Value{safe(key);const found=scope.find(key);if(!found)fail(t`Unknown JSCAD name “${key}”`);return found.values.get(key);}
 function member(value:Value,key:string):Value{safe(key);if(value instanceof Api){if(value.path==='Math'&&key==='PI')return Math.PI;if(value.path==='Math'&&key==='E')return Math.E;return new Api(value.path?`${value.path}.${key}`:key);}if(Array.isArray(value)){if(key==='length')return value.length;if(['push','concat','map','slice'].includes(key))return new Api(`array.${key}`,value);if(/^\d+$/.test(key))return value[Number(key)];}if(plain(value))return value[key];return unsupported(`property ${key}`);}
 function keyOf(node:Ast,scope:Scope):string{const key=node.computed?evaluate(node.property,scope):node.property.name;if(typeof key!=='string'&&typeof key!=='number')unsupported('computed property',node);return safe(String(key));}
 function bind(pattern:Ast,value:Value,scope:Scope,constant=false){if(pattern.type==='Identifier'){safe(pattern.name);scope.values.set(pattern.name,value);if(constant)scope.constants.add(pattern.name);return;}if(pattern.type==='AssignmentPattern'){bind(pattern.left,value===undefined?evaluate(pattern.right,scope):value,scope,constant);return;}if(pattern.type==='ObjectPattern'){for(const p of pattern.properties){if(p.type!=='Property'||p.computed)unsupported('destructuring',p);bind(p.value,member(value,String(p.key.name??p.key.value)),scope,constant);}return;}if(pattern.type==='ArrayPattern'){const a=list(value);pattern.elements.forEach((p:Ast|null,i:number)=>{if(p)bind(p,a[i],scope,constant);});return;}unsupported(pattern.type,pattern);}
 function set(node:Ast,value:Value,scope:Scope){if(node.type==='Identifier'){const target=scope.find(safe(node.name));if(!target)fail(t`Unknown JSCAD name “${node.name}”`,node);if(target.constants.has(node.name))unsupported('const reassignment',node);target.values.set(node.name,value);return;}if(node.type==='MemberExpression'){const object=evaluate(node.object,scope),key=keyOf(node,scope);if(plain(object)){object[key]=value;return;}if(Array.isArray(object)&&/^\d+$/.test(key)&&Number(key)<256){object[Number(key)]=value;return;}}unsupported('assignment target',node);}
 function binary(operator:string,a:Value,b:Value):Value{if(['===','=='].includes(operator))return a===b;if(['!==','!='].includes(operator))return a!==b;const x=number(a),y=number(b);switch(operator){case '+':return number(x+y);case '-':return number(x-y);case '*':return number(x*y);case '/':return number(x/y);case '%':return number(x%y);case '**':return number(x**y);case '<':return x<y;case '<=':return x<=y;case '>':return x>y;case '>=':return x>=y;}return unsupported(operator);}
 function evaluate(node:Ast,scope:Scope):Value{tick(node);switch(node.type){
  case 'Literal':if(node.value===null||['boolean','string','number'].includes(typeof node.value)){if(typeof node.value==='number')number(node.value);if(typeof node.value==='string'&&node.value.length>1024)unsupported('long string',node);return node.value;}return unsupported('literal',node);
  case 'Identifier':return lookup(scope,node.name);
  case 'ArrayExpression':{const values:Value[]=[];for(const item of node.elements){if(!item)unsupported('array holes',node);if(item.type==='SpreadElement')values.push(...list(evaluate(item.argument,scope)));else values.push(evaluate(item,scope));array(values);}return values;}
  case 'ObjectExpression':{const value=record();for(const p of node.properties){if(p.type!=='Property'||p.kind!=='init'||p.method||p.computed)unsupported('object property',p);value[safe(String(p.key.name??p.key.value))]=evaluate(p.value,scope);}return value;}
  case 'MemberExpression':return member(evaluate(node.object,scope),keyOf(node,scope));
  case 'ArrowFunctionExpression':case 'FunctionExpression':if(node.async||node.generator)unsupported('async/generator',node);return new Procedure(node,scope);
  case 'CallExpression':{const fn=evaluate(node.callee,scope),args:Value[]=[];for(const a of node.arguments){if(a.type==='SpreadElement')args.push(...list(evaluate(a.argument,scope)));else args.push(evaluate(a,scope));array(args);}location=node.start;return call(fn,args);}
  case 'BinaryExpression':return binary(node.operator,evaluate(node.left,scope),evaluate(node.right,scope));
  case 'LogicalExpression':{const a=evaluate(node.left,scope);return node.operator==='&&'?(a?evaluate(node.right,scope):a):node.operator==='||'?(a?a:evaluate(node.right,scope)):a??evaluate(node.right,scope);}
  case 'ConditionalExpression':return evaluate(evaluate(node.test,scope)?node.consequent:node.alternate,scope);
  case 'UnaryExpression':{const value=evaluate(node.argument,scope);if(node.operator==='!')return !value;if(node.operator==='-')return number(-number(value));if(node.operator==='+')return number(value);return unsupported(node.operator,node);}
  case 'AssignmentExpression':{const value=node.operator==='='?evaluate(node.right,scope):binary(node.operator.slice(0,-1),evaluate(node.left,scope),evaluate(node.right,scope));set(node.left,value,scope);return value;}
  case 'UpdateExpression':{const before=number(evaluate(node.argument,scope)),after=before+(node.operator==='++'?1:-1);set(node.argument,after,scope);return node.prefix?after:before;}
  default:return unsupported(node.type,node);
 }}
 function block(nodes:Ast[],scope:Scope):Returned|undefined{for(const node of nodes)if(node.type==='FunctionDeclaration'){if(node.async||node.generator)unsupported('async/generator',node);scope.values.set(safe(node.id.name),new Procedure(node,scope));}for(const node of nodes){const result=statement(node,scope);if(result)return result;}}
 function statement(node:Ast,scope:Scope):Returned|undefined{tick(node);switch(node.type){
  case 'VariableDeclaration':for(const d of node.declarations)bind(d.id,d.init?evaluate(d.init,scope):undefined,scope,node.kind==='const');return;
  case 'FunctionDeclaration':return;
  case 'ExpressionStatement':evaluate(node.expression,scope);return;
  case 'ReturnStatement':return new Returned(node.argument?evaluate(node.argument,scope):undefined);
  case 'BlockStatement':return block(node.body,new Scope(scope));
  case 'EmptyStatement':return;
  case 'IfStatement':return evaluate(node.test,scope)?statement(node.consequent,scope):node.alternate?statement(node.alternate,scope):undefined;
  case 'ForStatement':{const local=new Scope(scope);if(node.init)node.init.type==='VariableDeclaration'?statement(node.init,local):evaluate(node.init,local);let iterations=0;while(!node.test||evaluate(node.test,local)){if(++iterations>64)fail(t('JSCAD loop limit exceeded'),node,'resource-limit');const result=statement(node.body,local);if(result)return result;if(node.update)evaluate(node.update,local);}return;}
  case 'ImportDeclaration':if(node.source.value!=='@jscad/modeling')return unsupported(`import ${node.source.value}`,node);for(const spec of node.specifiers)bind(spec.local,spec.type==='ImportSpecifier'?member(new Api(''),spec.imported.name):new Api(''),scope);return;
  case 'ExportNamedDeclaration':if(node.source)return unsupported('re-export',node);if(node.declaration){statement(node.declaration,scope);const exported=module.exports;if(!plain(exported))return unsupported('module exports',node);if(node.declaration.type==='VariableDeclaration')for(const d of node.declaration.declarations){if(d.id.type!=='Identifier')return unsupported('export destructuring',d);exported[d.id.name]=lookup(scope,d.id.name);}else exported[node.declaration.id.name]=lookup(scope,node.declaration.id.name);}else for(const s of node.specifiers){if(!plain(module.exports))return unsupported('module exports',node);module.exports[s.exported.name]=lookup(scope,s.local.name);}return;
  case 'ExportDefaultDeclaration':{if(!plain(module.exports))return unsupported('module exports',node);module.exports.main=node.declaration.type==='FunctionDeclaration'?new Procedure(node.declaration,scope):evaluate(node.declaration,scope);return;}
  default:return unsupported(node.type,node);
 }}
 function call(fn:Value,args:Value[]):Value{
  if(++depth>32)fail(t('JSCAD call depth exceeded'),undefined,'resource-limit');try{
   if(fn instanceof Procedure){const local=new Scope(fn.scope);if(fn.node.id)local.values.set(fn.node.id.name,fn);fn.node.params.forEach((p:Ast,i:number)=>bind(p,args[i],local));return fn.node.body.type==='BlockStatement'?block(fn.node.body.body,local)?.value:evaluate(fn.node.body,local);}
   if(!(fn instanceof Api))return unsupported('call target');const path=fn.path;
   if(path==='require'){if(args.length!==1||args[0]!=='@jscad/modeling')return unsupported('require outside @jscad/modeling');return new Api('');}
   if(path.startsWith('Math.')){const functions:Record<string,(...x:number[])=>number>={sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,atan2:Math.atan2,sqrt:Math.sqrt,abs:Math.abs,floor:Math.floor,ceil:Math.ceil,round:Math.round,min:Math.min,max:Math.max,pow:Math.pow,hypot:Math.hypot};const method=functions[path.slice(5)];if(!method)return unsupported(path);return number(method(...args.map(number)));}
   if(path==='utils.degToRad')return number(args[0])*Math.PI/180;if(path==='utils.radToDeg')return number(args[0])*180/Math.PI;
   if(fn.receiver){const values=fn.receiver;switch(path){case 'array.push':array([...values,...args]);values.push(...args);return values.length;case 'array.concat':return array(values.concat(...args.map(v=>Array.isArray(v)?v:[v])));case 'array.slice':return values.slice(args[0]===undefined?0:number(args[0]),args[1]===undefined?undefined:number(args[1]));case 'array.map':return array(values.map((value,i)=>call(args[0],[value,i,values])));}return unsupported(path);}
   if(path.startsWith('maths.vec2.')){const method=path.slice(11);if(method==='create')return [0,0];const out=list(args[0]);if(out.length!==2)return unsupported(path);let result:number[];if(method==='fromAngleRadians'){const angle=number(args[1]);result=[Math.cos(angle),Math.sin(angle)];}else if(method==='normal'){const a=vector(args[1],2);result=[-a[1],a[0]];}else if(method==='scale'){const a=vector(args[1],2),factor=number(args[2]);result=a.map(v=>v*factor);}else return unsupported(path);out[0]=number(result[0]);out[1]=number(result[1]);return out;}
   if(['primitives.rectangle','primitives.circle','primitives.ellipse'].includes(path)){
    const opts=args[0]===undefined?record():args[0];if(!plain(opts)||args.length>1)return unsupported(`${path} arguments`);
    const rectangle=path==='primitives.rectangle',allowed=rectangle?['size','center']:['radius','center','segments'];
    for(const key of Object.keys(opts))if(!allowed.includes(key))return unsupported(`${path}.${key}`);
    const center=vector(opts.center??[0,0],2),size=rectangle?vector(opts.size??[2,2],2):path==='primitives.circle'?[number(opts.radius??1),number(opts.radius??1)]:vector(opts.radius??[1,1],2);
    if(size.some(n=>n<=0))fail(t('Expected positive JSCAD profile dimensions'));
    if(rectangle){const [x,y]=size.map(n=>n/2);return new Profile([[-x,-y],[x,-y],[x,y],[-x,y]].map(p=>p.map((n,i)=>number(n+center[i]))));}
    const count=number(opts.segments??32);if(!Number.isInteger(count)||count<3||count>256)fail(t('JSCAD profile segments must be an integer from 3 to 256'));
    return new Profile(Array.from({length:count},(_,i)=>{const angle=2*Math.PI*i/count;return [number(center[0]+size[0]*Math.cos(angle)),number(center[1]+size[1]*Math.sin(angle))];}));
   }
   if(path.startsWith('transforms.')&&args.slice(1).some(arg=>arg instanceof Profile)){
    const profiles=args.slice(1);if(!profiles.length||!profiles.every(arg=>arg instanceof Profile))return unsupported(`${path} mixed profiles/solids`);
    const method=path.slice(11);let offset=[0,0],factor=[1,1],angle=0;
    if(method==='translate')offset=vector(args[0],2);
    else if(method==='translateX'||method==='translateY')offset[method==='translateX'?0:1]=number(args[0]);
    else if(method==='scale'){factor=vector(args[0],2);if(factor.some(n=>n<=0))return unsupported('profile scale must be positive');}
    else if(method==='rotateZ')angle=number(args[0]);
    else if(method==='rotate'){const v=vector(args[0]);if(v[0]!==0||v[1]!==0)return unsupported('profile rotation outside XY plane');angle=v[2];}
    else return unsupported(path);
    const c=Math.cos(angle),s=Math.sin(angle),out=profiles.map(profile=>new Profile((profile as Profile).points.map(([x,y])=>[number(offset[0]+factor[0]*(x*c-y*s)),number(offset[1]+factor[1]*(x*s+y*c))])));
    return out.length===1?out[0]:out;
   }
   if(path==='primitives.polygon'){const opts=args[0];if(!plain(opts)||Object.keys(opts).some(key=>!['points','closed'].includes(key))||opts.closed===false)return unsupported('primitives.polygon options');return new Profile(list(opts.points).map(p=>vector(p,2)));}
   if(path==='extrusions.extrudeLinear'){const opts=args[0],profile=args[1];if(!plain(opts)||!(profile instanceof Profile)||Object.keys(opts).some(key=>key!=='height')||args.length!==2)return unsupported('extrusions.extrudeLinear options/profile');const points=profile.points.map(p=>`[${p.join(', ')}]`).join(', ');return geometry(`extrude(${number(opts.height??1)}, [${points}])`);}
   const bools:Record<string,string>={'booleans.union':'union','booleans.subtract':'subtract','booleans.intersect':'intersect'};if(bools[path])return merged(bools[path],geometries(args));
   if(path==='colors.colorize'){coloursUsed=true;const c=vector(args[0],Array.isArray(args[0])?args[0].length:3);if(c.length<3||c.length>4||c.some(n=>n<0||n>1)||c.length===4&&c[3]!==1)return unsupported('colorize alpha/color');const hex='#'+c.slice(0,3).map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join('');const shapes=geometries(args.slice(1)).map(g=>geometry(g.source,hex));return shapes.length===1?shapes[0]:shapes;}
   if(path.startsWith('primitives.')){const opts=args[0]===undefined?record():args[0];if(!plain(opts)||args.length>1)return unsupported(`${path} arguments`);const primitive=path.slice(11);const supported=primitive==='cuboid'?['size','center']:primitive==='cube'?['size','center']:primitive==='cylinder'?['radius','height','segments','center']:primitive==='sphere'?['radius','segments','center']:[];if(!supported.length)return unsupported(path);for(const key of Object.keys(opts))if(!supported.includes(key))return unsupported(`${path}.${key}`);
    const segments=number(opts.segments??32);let text:string;if(primitive==='cube'){const size=number(opts.size??2);text=`box(${size}, ${size}, ${size})`;}else if(primitive==='cuboid'){text=`box(${vector(opts.size??[2,2,2]).join(', ')})`;}else if(primitive==='cylinder')text=`cylinder(${number(opts.radius??1)}, ${number(opts.height??2)}, ${segments})`;else text=`sphere(${number(opts.radius??1)}, ${segments})`;if(opts.center!==undefined)text=`move([${vector(opts.center).join(', ')}], ${text})`;return geometry(text);
   }
   if(path.startsWith('transforms.')){const method=path.slice(11),operation=method.startsWith('translate')?'move':method.startsWith('rotate')?'rotate':method==='scale'?'scale':undefined;if(!operation)return unsupported(path);let v:number[];if(['translate','rotate','scale'].includes(method))v=vector(args[0]);else if(/^(translate|rotate)[XYZ]$/.test(method)){v=[0,0,0];v['XYZ'.indexOf(method.at(-1)!)]=number(args[0]);}else return unsupported(path);if(operation==='rotate')v=v.map(n=>n*180/Math.PI);const out=geometries(args.slice(1)).map(g=>geometry(`${operation}([${v.join(', ')}], ${g.source})`,g.color));return out.length===1?out[0]:out;}
   return unsupported(path);
  }finally{depth--;}
 }
 block(tree.body,root);const entry=safe(options.entryPoint??'main'),exported=module.exports,main=exported instanceof Procedure&&entry==='main'?exported:plain(exported)?exported[entry]:undefined;if(!(main instanceof Procedure))fail(t`JSCAD file must export the function “${entry}”`);
 const params=record(),metadata:Record<string,number|string|boolean>={},definitionsByName=new Map<string,RecordValue>();if(plain(exported)&&exported.getParameterDefinitions){const definitions=list(call(exported.getParameterDefinitions,[]));for(const item of definitions){if(!plain(item)||typeof item.name!=='string')fail(t('Invalid JSCAD parameter definition'));if(item.type==='group')continue;safe(item.name);if(!['number','boolean','string'].includes(typeof item.initial))fail(t('JSCAD parameter needs a scalar initial value'));if(Object.hasOwn(params,item.name))fail(t('Duplicate JSCAD parameter definition'));definitionsByName.set(item.name,item);params[item.name]=item.initial;metadata[item.name]=item.initial as number|string|boolean;}}
 for(const [key,value] of Object.entries(overrides)){if(!Object.hasOwn(params,key))fail(t`Unknown JSCAD parameter “${key}”`);let normalized=value;if(typeof params[key]==='number'&&typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))normalized=Number(value);if(typeof params[key]==='boolean'&&typeof value==='string'&&['true','false'].includes(value.trim()))normalized=value.trim()==='true';if(typeof normalized!==typeof params[key])fail(t`Invalid JSCAD parameter “${key}”`);if(typeof normalized==='number')number(normalized);params[key]=normalized;metadata[key]=normalized;}
 for(const [key,definition] of definitionsByName){const value=params[key];if(typeof value==='number'&&(definition.type==='int'&&!Number.isInteger(value)||typeof definition.min==='number'&&value<definition.min||typeof definition.max==='number'&&value>definition.max))fail(t`JSCAD parameter “${key}” is outside its declared range`);if(Array.isArray(definition.values)&&!definition.values.includes(value))fail(t`Invalid JSCAD parameter “${key}”`);}

 const args=options.arguments?[...options.arguments]:[params];if(options.arguments){if(args.length>64)fail(t('JSCAD argument limit exceeded'));for(const value of args)if(typeof value==='number')number(value);else if(typeof value!=='string'&&typeof value!=='boolean'||typeof value==='string'&&value.length>1024)fail(t('Invalid JSCAD entry argument'));}const outputs=geometries([call(main,args)]);if(!outputs.length)fail(t('JSCAD construction returned no solids'));const warnings=[t('JSCAD conversion is an evaluated snapshot; keep the original source for parametric edits.')];if(outputs.length>1)warnings.push(t('Multiple JSCAD outputs are combined into one rigid body in the code editor.'));if(coloursUsed)warnings.push(t('Only whole-output JSCAD colours are retained in conversion metadata; face colours are not converted.'));
 const make=(g:Geometry):CodeProgram=>{const program:CodeProgram={version:1,language:'brickwright-cad-script',parameters:{},source:`// Converted JSCAD snapshot. Units: millimetres; rotations converted to degrees.\nreturn ${g.source.replace(/,\s*(?=(?:box|cylinder|sphere|move|rotate|scale|union|subtract|intersect)\()/g,',\n  ')};\n`};try{compileCode(program);}catch(error){fail(t`Converted JSCAD construction: ${error instanceof CadCodeError?error.detail:error instanceof Error?error.message:String(error)}`,main.node);}return program;};
 return {program:make(merged('union',outputs)),outputs:outputs.map(g=>({program:make(g),...(g.color?{color:g.color}:{})})),warnings,parameters:metadata,evaluatedSnapshot:true};
}
