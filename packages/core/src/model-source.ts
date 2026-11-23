// SPDX-License-Identifier: BSD-3-Clause
// An original declarative projection of the retained graph. No source JS executes.
import {parse} from 'acorn';
import type {CadDocument,SolidNode} from './document.js';
import {constructionInputs,identityTransform,validateDocument} from './document.js';
import {mapPatternScalars} from './features.js';
import {applyParametricBindings} from './parameters.js';
import type {DrivenProperty} from './parameters.js';
import {pruneModelProvenance} from './model-provenance.js';
import {CadCodeError} from './code.js';
import {t} from './i18n.js';
import {checkGenerator} from './generators.js';
import type {GeneratorRecipe} from './generators.js';
export interface ModelSource {version:1;language:'brickwright-design';source:string}
export const MODEL_SOURCE_LIMITS=Object.freeze({bytes:8*1024*1024,astNodes:500000,depth:64,records:10000});
type Ast={type:string;start:number;end:number;[key:string]:any};
class Formula {constructor(readonly expression:string){}}
class Asset {constructor(readonly id:string){}}
type RecordSpec={key:string;kind:string;args:any[]};
type SourceRecord=RecordSpec&{node:Ast;call:Ast};
const fields:Record<DrivenProperty,string[]>={width:['size','0'],depth:['size','1'],height:['height'],radius:['radius'],positionX:['transform','position','0'],positionY:['transform','position','1'],positionZ:['transform','position','2'],rotationX:['transform','rotation','0'],rotationY:['transform','rotation','1'],rotationZ:['transform','rotation','2'],scaleX:['transform','scale','0'],scaleY:['transform','scale','1'],scaleZ:['transform','scale','2']};
const pathFor=(node:SolidNode,property:DrivenProperty)=>node.kind==='box'&&property==='height'?['size','2']:fields[property];
const clean=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export const sameModelValue=(a:any,b:any):boolean=>{
 if(a===b)return true;if(a instanceof Formula||b instanceof Formula)return a instanceof Formula&&b instanceof Formula&&a.expression===b.expression;
 if(a instanceof Asset||b instanceof Asset)return a instanceof Asset&&b instanceof Asset&&a.id===b.id;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const keys=Object.keys(a).filter(k=>a[k]!==undefined),other=Object.keys(b).filter(k=>b[k]!==undefined);return keys.length===other.length&&keys.every(k=>Object.hasOwn(b,k)&&sameModelValue(a[k],b[k]));
};
function put(object:any,path:string[],value:any){let current=object;for(const key of path.slice(0,-1))current=current[key];current[path.at(-1)!]=value;}
function at(object:any,path:string[]){for(const key of path){if(object===undefined)return undefined;object=object[key];}return object;}
const kindFor=(node:SolidNode)=>node.kind==='boolean'?'combine':node.kind;
const geometryFields=['size','radius','height','segments','operation','inputs','positions','indices','program','sketchId','featureVersion','distance','symmetric','angle','axisOffset','source','plane','offset','pattern'];
function compactGenerators(document:CadDocument):Map<string,Set<string>>{
 const result=new Map<string,Set<string>>();for(const root of Object.values(document.nodes)){
  if(!root.generator)continue;const descendants=new Set<string>();const visit=(id:string)=>{if(descendants.has(id))return;descendants.add(id);const n=document.nodes[id];constructionInputs(n).forEach(visit);};visit(root.id);descendants.delete(root.id);
  if([...descendants].some(id=>document.roots.includes(id))||document.parametric?.bindings.some(b=>descendants.has(b.nodeId)||b.nodeId===root.id&&!/^(?:position|rotation|scale)/.test(b.property)))continue;
  if(Object.values(document.nodes).some(n=>n.id!==root.id&&!descendants.has(n.id)&&constructionInputs(n).some(id=>descendants.has(id))))continue;
  result.set(root.id,descendants);
 }return result;
}
const copyNode=(node:SolidNode):SolidNode=>({...node,transform:structuredClone(node.transform),...(node.kind==='box'?{size:[...node.size]}:{}),...(node.kind==='boolean'?{inputs:[...node.inputs]}:{})}) as SolidNode;
/** Canonical graph records, with buffers referenced rather than duplicated in code. */
function modelRecords(document:CadDocument):RecordSpec[]{
 const doc=document;let header:any={...doc};for(const key of ['nodes','roots','sketches','joints','provenance','modelSource'])delete header[key];
 header=clean(header);header.version=Math.max(6,doc.version);if(header.parametric)header.parametric={version:1,parameters:{},bindings:[]};
 const generators=compactGenerators(doc),hidden=new Set([...generators.values()].flatMap(ids=>[...ids]));
 const records:RecordSpec[]=[{key:'project',kind:'project',args:[header]}];
 for(const [name,value] of Object.entries(doc.parametric?.parameters??{}))records.push({key:`parameter:${name}`,kind:'parameter',args:[name,value]});
 for(const [id,raw] of Object.entries(doc.sketches??{})){
  const sketch:any=clean(raw);delete sketch.id;for(const key of ['width','depth','radius'])if(typeof sketch.profile[key]==='string')sketch.profile[key]=new Formula(sketch.profile[key]);
  records.push({key:`sketch:${id}`,kind:'sketch',args:[id,sketch]});
 }
 for(const [id,raw] of Object.entries(doc.nodes)){
  if(hidden.has(id))continue;
  let metadata:any={...raw};delete metadata.id;delete metadata.kind;if(raw.kind==='mesh'){delete metadata.positions;delete metadata.indices;}if(raw.kind==='code')delete metadata.program;metadata=clean(metadata);
  for(const binding of doc.parametric?.bindings??[])if(binding.nodeId===id)put(metadata,pathFor(raw,binding.property),new Formula(binding.expression));
  if(raw.kind==='extrusion'&&typeof raw.distance==='string')metadata.distance=new Formula(raw.distance);
  if(raw.kind==='pattern')metadata.pattern=mapPatternScalars(raw.pattern,value=>typeof value==='string'?new Formula(value):value);
  if(raw.kind==='mirror'&&typeof raw.offset==='string')metadata.offset=new Formula(raw.offset);
  if(raw.kind==='revolution')for(const key of ['angle','axisOffset'] as const){
   const value=raw[key];if(typeof value==='string')metadata[key]=new Formula(value);
  }
  if(generators.has(id)){for(const key of [...geometryFields,'generator'])delete metadata[key];records.push({key:`node:${id}`,kind:'generated',args:[id,metadata,raw.generator]});continue;}
  let args:any[]=[id,metadata];
  if(raw.kind==='code'){delete metadata.program;args=[id,metadata,raw.program.source,raw.program.parameters];}
  if(raw.kind==='mesh'){delete metadata.positions;delete metadata.indices;args=[id,metadata,new Asset(id)];}
  records.push({key:`node:${id}`,kind:kindFor(raw),args});
 }
 records.push({key:'roots',kind:'roots',args:[doc.roots]});
 if(doc.joints!==undefined)records.push({key:'joints',kind:'joints',args:[doc.joints]});
 if(doc.provenance!==undefined)records.push({key:'sources',kind:'sources',args:[]});
 return records;
}
function template(value:string):string{return 'cad`'+value.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$\{/g,'\\${')+'`';}
function format(value:any,preferTemplate=false,depth=0):string{
 if(value instanceof Formula)return `expr(${JSON.stringify(value.expression)})`;
 if(value instanceof Asset)return `asset(${JSON.stringify(value.id)})`;
 if(typeof value==='string')return preferTemplate?template(value):JSON.stringify(value);
 if(Array.isArray(value)){
  const items=value.map(v=>format(v,false,depth+1)),line='['+items.join(', ')+']';
  return line.length<160&&!items.some(item=>item.includes('\n'))?line:'[\n'+'  '.repeat(depth+1)+items.join(',\n'+'  '.repeat(depth+1))+'\n'+'  '.repeat(depth)+']';
 }
 if(value&&typeof value==='object'){
  const entries=Object.entries(value).filter(([,v])=>v!==undefined);if(!entries.length)return '{}';
  const items=entries.map(([k,v])=>`${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)?k:JSON.stringify(k)}: ${format(v,false,depth+1)}`);
  return '{\n'+'  '.repeat(depth+1)+items.join(',\n'+'  '.repeat(depth+1))+'\n'+'  '.repeat(depth)+'}';
 }
 return JSON.stringify(value);
}
const formatRecord=(record:RecordSpec)=>`${record.kind}(${record.args.map((arg,i)=>format(arg,record.kind==='code'&&i===2)).join(', ')});`;
export function generateModelSource(document:CadDocument):string{
 return '// Brickwright design source. Apply commits one model edit; GUI edits update these calls.\n'+modelRecords(document).map(formatRecord).join('\n')+'\n';
}
function parseRecords(source:string):SourceRecord[]{
 const fail=(detail:string,offset=0,code='invalid-source'):never=>{throw new CadCodeError(detail,offset,source,code);};
 if(typeof source!=='string'||new TextEncoder().encode(source).length>MODEL_SOURCE_LIMITS.bytes)fail(t('Model source exceeds 8 MiB'),0,'resource-limit');
 let tree:Ast;try{tree=parse(source,{ecmaVersion:2022,sourceType:'script'}) as Ast;}catch(error){if(error instanceof RangeError)fail(t('Model source nesting limit exceeded'),0,'resource-limit');fail(t('Invalid design source syntax'),(error as {pos?:number}).pos??0);}
 const stack=[{node:tree!,depth:0}];let count=0;while(stack.length){const item=stack.pop()!;if(++count>MODEL_SOURCE_LIMITS.astNodes||item.depth>MODEL_SOURCE_LIMITS.depth)fail(t('Model source syntax budget exceeded'),item.node.start,'resource-limit');for(const value of Object.values(item.node))for(const child of Array.isArray(value)?value:[value])if(child&&typeof child==='object'&&typeof child.type==='string')stack.push({node:child,depth:item.depth+1});}
 const safe=(key:string,node:Ast)=>{if(['constructor','prototype','__proto__'].includes(key))fail(t('Unsafe design source key'),node.start);return key;};
 function literal(node:Ast):any{
  if(node.type==='Literal'){if(node.value===null||typeof node.value==='string'||typeof node.value==='boolean')return node.value;if(typeof node.value==='number'&&Number.isFinite(node.value))return node.value;}
  if(node.type==='UnaryExpression'&&['+','-'].includes(node.operator)&&node.argument.type==='Literal'&&typeof node.argument.value==='number'){const value=node.operator==='-'?-node.argument.value:node.argument.value;if(Number.isFinite(value))return value;}
  if(node.type==='ArrayExpression'){if(node.elements.some((n:Ast|null)=>!n||n.type==='SpreadElement'))fail(t('Design arrays require explicit values'),node.start);return node.elements.map(literal);}
  if(node.type==='ObjectExpression'){const value:any=Object.create(null);for(const p of node.properties){if(p.type!=='Property'||p.kind!=='init'||p.method||p.computed||p.shorthand)fail(t('Design objects require explicit properties'),p.start);const key=safe(String(p.key.name??p.key.value),p);if(Object.hasOwn(value,key))fail(t('Duplicate design source property'),p.start);value[key]=literal(p.value);}return value;}
  if(node.type==='TaggedTemplateExpression'&&node.tag.type==='Identifier'&&node.tag.name==='cad'&&node.quasi.expressions.length===0){const text=node.quasi.quasis[0].value.cooked;if(typeof text==='string')return text;}
  if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&['expr','asset'].includes(node.callee.name)&&node.arguments.length===1&&node.arguments[0].type==='Literal'&&typeof node.arguments[0].value==='string')return node.callee.name==='expr'?new Formula(node.arguments[0].value):new Asset(node.arguments[0].value);
  // A dimensional expression is retained as native formula text, never executed.
  if(['Identifier','BinaryExpression','LogicalExpression','ConditionalExpression','UnaryExpression'].includes(node.type)||node.type==='CallExpression'&&node.callee.type==='Identifier')return new Formula(source.slice(node.start,node.end));
  return fail(t('Unsupported design source expression'),node.start,'unsupported-feature');
 }
 const allowed=new Set(['project','parameter','sketch','box','cylinder','sphere','combine','mesh','code','extrusion','revolution','mirror','pattern','generated','roots','joints','sources']);const records:SourceRecord[]=[],keys=new Set<string>();
 for(const node of tree!.body){if(node.type==='EmptyStatement')continue;const call=node.expression;if(node.type!=='ExpressionStatement'||call?.type!=='CallExpression'||call.callee.type!=='Identifier'||!allowed.has(call.callee.name)||call.arguments.some((arg:Ast)=>arg.type==='SpreadElement'))fail(t('Use declarative design calls only'),node.start,'unsupported-feature');
  const kind=call.callee.name,args=call.arguments.map(literal),isBody=['box','cylinder','sphere','combine','mesh','code','extrusion','revolution','mirror','pattern','generated'].includes(kind),identified=isBody||kind==='parameter'||kind==='sketch';
  if(identified&&(typeof args[0]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(args[0])||['constructor','prototype','__proto__'].includes(args[0])))fail(t('Design records require a stable identifier'),call.start);
  const key=identified?`${isBody?'node':kind}:${args[0]}`:kind;if(keys.has(key))fail(t('Duplicate design source record'),call.start);keys.add(key);records.push({key,kind,args,node,call});if(records.length>MODEL_SOURCE_LIMITS.records)fail(t('Too many design source records'),call.start,'resource-limit');
 }
 if(!keys.has('project')||!keys.has('roots'))fail(t('Design source requires project and roots calls'));
 return records;
}
/** Parse into a candidate graph. The caller validates and preflights before commit. */
export function compileModelSource(source:string,context:CadDocument,options:{regenerate?:(recipe:GeneratorRecipe,name:string)=>CadDocument}={}):CadDocument{
 const records=parseRecords(source),fail=(detail:string,record?:SourceRecord):never=>{throw new CadCodeError(detail,record?.node.start??0,source);};
 const project=records.find(r=>r.key==='project')!;if(project.args.length!==1||!project.args[0]||typeof project.args[0]!=='object'||Array.isArray(project.args[0]))fail(t('Invalid project declaration'),project);
 if(![6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38].includes(project.args[0].version))fail(t('Model source uses project version 6 through 38'),project);
 const doc:any={...project.args[0],nodes:Object.create(null),roots:[],modelSource:{version:1,language:'brickwright-design',source}};
 if(doc.id!==context.id)fail(t('Keep the current project identity in model source'),project);
 delete doc.provenance;delete doc.sketches;delete doc.joints;
 const declaredNodeIds=new Set(records.filter(r=>r.key.startsWith('node:')).map(r=>r.args[0]));
 const bindings:any[]=[],parameters:any=Object.assign(Object.create(null),doc.parametric?.parameters??{});let hasParameters=doc.parametric!==undefined;if(doc.parametric?.bindings?.length)fail(t('Use expr fields for driving bindings'),project);
 for(const record of records)if(record.kind==='parameter'){if(record.args.length!==2)fail(t('Invalid parameter declaration'),record);if(Object.hasOwn(parameters,record.args[0]))fail(t('Duplicate design source parameter'),record);parameters[record.args[0]]=record.args[1];hasParameters=true;}
 for(const record of records){const {kind,args}=record;
  if(kind==='project'||kind==='parameter')continue;
  if(kind==='roots'||kind==='joints'){if(args.length!==1||!Array.isArray(args[0]))fail(t('Invalid design list declaration'),record);doc[kind]=args[0];continue;}
  if(kind==='sources'){if(args.length||context.version<5)fail(t('Source provenance is retained from the project'),record);if(context.provenance)doc.provenance=clean(context.provenance);continue;}
  if(!args[1]||typeof args[1]!=='object'||Array.isArray(args[1]))fail(t('Design calls require an options object'),record);
  if(kind==='sketch'){
   if(args.length!==2)fail(t('Invalid sketch declaration'),record);const sketch:any={...args[1],id:args[0]};for(const key of ['width','depth','radius'])if(sketch.profile?.[key] instanceof Formula)sketch.profile[key]=sketch.profile[key].expression;
   doc.sketches??=Object.create(null);doc.sketches[args[0]]=sketch;continue;
  }
  const metadata=args[1];if(Object.hasOwn(metadata,'id')||Object.hasOwn(metadata,'kind'))fail(t('Identity and kind belong to the design call'),record);
  let node:any;
  if(kind==='generated'){
   if(args.length!==3||'generator'in metadata||geometryFields.some(key=>Object.hasOwn(metadata,key)))fail(t('Generator recipes belong to the generated call'),record);
   const recipe=args[2]===null?undefined:checkGenerator(args[2]);let prototype=Object.hasOwn(context.nodes,args[0])?context.nodes[args[0]]:undefined,construction:CadDocument=context;
   if(!prototype){
    if(!recipe||!options.regenerate)fail(t('Generator source edits need the shape reconstruction callback'),record);
    construction=validateDocument(options.regenerate!(recipe!,metadata.name??recipe!.preset));
    if(construction.roots.length!==1||construction.joints?.length||construction.parametric||construction.sketches||construction.provenance)fail(t('Expected one generated body'),record);
    prototype=construction.nodes[construction.roots[0]];
   }
   const root=prototype.id,seen=new Set<string>();const collect=(id:string)=>{if(seen.has(id))return;seen.add(id);const value=construction.nodes[id];constructionInputs(value).forEach(collect);};collect(root);
   for(const id of seen){if(id===root)continue;if(declaredNodeIds.has(id)){if(recipe)fail(t('Edit generated construction through its recipe, or detach the generator'),record);continue;}if(Object.hasOwn(doc.nodes,id))fail(t('Generated construction has conflicting identifiers'),record);doc.nodes[id]=copyNode(construction.nodes[id]);}
   node={...copyNode(prototype),...metadata,id:args[0]};if(recipe)node.generator=recipe;else delete node.generator;
  }else node={name:kind==='combine'?'Combination':kind[0].toUpperCase()+kind.slice(1),color:'#eea52b',transform:identityTransform(),...metadata,id:args[0],kind:kind==='combine'?'boolean':kind};
  if(kind==='code'){if(args.length!==4||typeof args[2]!=='string'||Object.hasOwn(metadata,'program'))fail(t('Code calls need source and input overrides'),record);node.program={version:1,language:'brickwright-cad-script',source:args[2],parameters:args[3]};}
  else if(kind==='mesh'){
   if(args.length!==3||!(args[2] instanceof Asset)||'positions'in metadata||'indices'in metadata)fail(t('Mesh calls require a project asset reference'),record);
   const original=Object.hasOwn(context.nodes,args[2].id)?context.nodes[args[2].id]:undefined;if(original?.kind!=='mesh')return fail(t('Referenced mesh asset is unavailable'),record);node.positions=original.positions;node.indices=original.indices;
   if(context.version>=5&&original.provenance?.length)node.provenance=[...new Set([...(node.provenance??[]),...original.provenance])];
  }else if(kind!=='generated'&&args.length!==2)fail(t('Unexpected design call arguments'),record);
  if(kind==='cylinder'||kind==='sphere')node.segments??=48;
  for(const [property,path] of Object.entries(fields)){
   const resolved=pathFor(node,property as DrivenProperty),value=at(node,resolved);if(!(value instanceof Formula))continue;
   bindings.push({nodeId:node.id,property,expression:value.expression});put(node,resolved,property.startsWith('scale')?1:1);hasParameters=true;
  }
  if(node.kind==='extrusion'&&node.distance instanceof Formula)node.distance=node.distance.expression;
  if(node.kind==='pattern'&&node.pattern&&typeof node.pattern==='object'){
   const restore=(value:unknown)=>value instanceof Formula?value.expression:value;
   const pattern=node.pattern;
   pattern.count=restore(pattern.count);
   if(pattern.mode==='linear')pattern.spacing=restore(pattern.spacing);
   if(pattern.mode==='circular'){
    if(Array.isArray(pattern.center))pattern.center=pattern.center.map(restore);
    pattern.sweep=restore(pattern.sweep);
   }
  }
  if(node.kind==='mirror'&&node.offset instanceof Formula)node.offset=node.offset.expression;
  if(node.kind==='revolution')for(const key of ['angle','axisOffset'])if(node[key] instanceof Formula)node[key]=node[key].expression;
  doc.nodes[node.id]=node;
 }
 if(hasParameters)doc.parametric={version:1,parameters,bindings};else delete doc.parametric;
 const rejectUnresolved=(value:any)=>{if(value instanceof Formula||value instanceof Asset)fail(t('Expression is not supported in this design field'));if(value&&typeof value==='object')for(const v of Object.values(value))rejectUnresolved(v);};for(const node of Object.values(doc.nodes) as any[])rejectUnresolved(node.kind==='mesh'?{...node,positions:undefined,indices:undefined}:node);rejectUnresolved(doc.sketches);rejectUnresolved(doc.joints);rejectUnresolved(Object.fromEntries(Object.entries(doc).filter(([key])=>!['nodes','sketches','joints','modelSource'].includes(key))));
 applyParametricBindings(doc);pruneModelProvenance(doc);
 return doc;
}
/** Minimal AST value patches preserve unrelated source, whitespace and comments. */
export function updateModelSource(previous:string|undefined,document:CadDocument):string{
 if(previous===undefined)return generateModelSource(document);return patchRecords(previous,modelRecords(document));
}
function patchRecords(previous:string,desired:RecordSpec[]):string{
 const original=previous;
 const records=parseRecords(previous),wanted=new Map(desired.map(record=>[record.key,record])),edits:{start:number;end:number;text:string}[]=[];
 function patch(node:Ast,old:any,next:any){if(sameModelValue(old,next))return;
  if(node.type==='ObjectExpression'&&old&&next&&typeof old==='object'&&typeof next==='object'&&!Array.isArray(next)&&!(next instanceof Formula)&&!(next instanceof Asset)){
   const a=Object.keys(old),b=Object.keys(next);if(a.length===b.length&&a.every(key=>Object.hasOwn(next,key))){for(const property of node.properties){const key=String(property.key.name??property.key.value);patch(property.value,old[key],next[key]);}return;}
  }
  if(node.type==='ArrayExpression'&&Array.isArray(old)&&Array.isArray(next)&&old.length===next.length){node.elements.forEach((element:Ast,i:number)=>patch(element,old[i],next[i]));return;}
  if(node.type==='CallExpression'&&(old instanceof Formula&&next instanceof Formula||old instanceof Asset&&next instanceof Asset)){patch(node.arguments[0],old instanceof Formula?old.expression:old.id,next instanceof Formula?next.expression:next.id);return;}
  edits.push({start:node.start,end:node.end,text:format(next,node.type==='TaggedTemplateExpression',Math.floor((/^[ \t]*/.exec(original.slice(original.lastIndexOf('\n',node.start-1)+1,node.start))?.[0].length??0)/2))});
 }
 for(const old of records){const next=wanted.get(old.key);wanted.delete(old.key);if(!next){edits.push({start:old.node.start,end:old.node.end,text:''});continue;}
  if(old.kind!==next.kind||old.args.length!==next.args.length){edits.push({start:old.node.start,end:old.node.end,text:formatRecord(next)});continue;}
  old.call.arguments.forEach((node:Ast,i:number)=>patch(node,old.args[i],next.args[i]));
 }
 if(wanted.size){const point=records.find(record=>record.key==='roots')!.node.start;edits.push({start:point,end:point,text:[...wanted.values()].map(formatRecord).join('\n')+'\n'});}
 let source=previous;for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);return source;
}
/** Three-way semantic merge. Disjoint GUI/draft edits merge without replaying commands. */
export function mergeModelSource(base:string,draft:string,current:string):string{
 const before=new Map(parseRecords(base).map(r=>[r.key,r])),edited=new Map(parseRecords(draft).map(r=>[r.key,r])),latest=new Map(parseRecords(current).map(r=>[r.key,r]));
 if(before.get('project')?.args[0]?.id!==latest.get('project')?.args[0]?.id)throw new CadCodeError(t('This source draft belongs to another project'),0,draft,'source-conflict');
 const missing=Symbol('missing'),result:RecordSpec[]=[];
 const conflict=(key:string):never=>{const record=edited.get(key)??before.get(key);throw new CadCodeError(t`Both GUI and source changed the same value in “${key}”. Resolve it before merging.`,record?.node.start??0,draft,'source-conflict');};
 function merge(a:any,b:any,c:any,key:string,rootList=false):any{
  if(sameModelValue(b,a))return c;if(sameModelValue(c,a)||sameModelValue(b,c))return b;
  if(a===missing||b===missing||c===missing)return conflict(key);
  if(rootList&&Array.isArray(a)&&Array.isArray(b)&&Array.isArray(c)&&b.length>=a.length&&c.length>=a.length&&a.every((v,i)=>sameModelValue(v,b[i])&&sameModelValue(v,c[i])))return [...a,...c.slice(a.length),...b.slice(a.length).filter(id=>!c.includes(id))];
  if(Array.isArray(a)&&Array.isArray(b)&&Array.isArray(c)&&a.length===b.length&&a.length===c.length)return a.map((v,i)=>merge(v,b[i],c[i],key));
  if(a&&b&&c&&typeof a==='object'&&typeof b==='object'&&typeof c==='object'&&!Array.isArray(a)&&!Array.isArray(b)&&!Array.isArray(c)&&![a,b,c].some(v=>v instanceof Formula||v instanceof Asset)){
   const out:any=Object.create(null);for(const property of new Set([...Object.keys(a),...Object.keys(b),...Object.keys(c)])){const value=merge(Object.hasOwn(a,property)?a[property]:missing,Object.hasOwn(b,property)?b[property]:missing,Object.hasOwn(c,property)?c[property]:missing,key);if(value!==missing)out[property]=value;}return out;
  }
  return conflict(key);
 }
 for(const key of new Set([...before.keys(),...edited.keys(),...latest.keys()])){
  const a=before.get(key),b=edited.get(key),c=latest.get(key);
  const data=(r:RecordSpec|undefined)=>r?{kind:r.kind,args:r.args}:missing;
  if(key==='roots'&&a&&b&&c){result.push({key,kind:'roots',args:[merge(a.args[0],b.args[0],c.args[0],key,true)]});continue;}
  const value=merge(data(a),data(b),data(c),key);if(value!==missing)result.push({key,...value});
 }
 return patchRecords(draft,result);
}
export function modelSourceEntityAt(source:string,offset:number):string|undefined{return parseRecords(source).find(record=>record.key.startsWith('node:')&&offset>=record.node.start&&offset<=record.node.end)?.args[0];}
export function modelSourceEntityRange(source:string,id:string):[number,number]|undefined{const record=parseRecords(source).find(record=>record.key===`node:${id}`);return record?[record.node.start,record.node.end]:undefined;}
export function checkModelSource(document:CadDocument):void{
 if(document.version<6)return;const saved=(document as CadDocument&{modelSource?:ModelSource}).modelSource;if(saved===undefined)return;
 if(!saved||typeof saved!=='object'||saved.version!==1||saved.language!=='brickwright-design'||typeof saved.source!=='string')throw new Error(t('Unsupported model source format'));
 const candidate=compileModelSource(saved.source,document);
 const keyed=(doc:CadDocument)=>Object.fromEntries(modelRecords(doc).map(record=>[record.key,{kind:record.kind,args:record.args}]));
 if(!sameModelValue(keyed(candidate),keyed(document)))throw new Error(t('Model source is stale relative to the design'));
}
