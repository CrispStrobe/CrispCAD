// SPDX-License-Identifier: BSD-3-Clause
/**
 * A host-owned journal of accepted session commands, with a durable text
 * export. The journal is never stored in the document or its history; it
 * observes the session's commit boundary like any other subscriber.
 *
 * Export formats (data only; nothing here is ever evaluated as JavaScript):
 * - `cadscript`: bodies whose whole recorded life has a faithful CAD Script
 *   equivalent become `// @object` blocks, each a complete CAD Script program.
 *   Every other effective edit is kept as canonical replay text in a
 *   `// @replay … non-portable` block, prefixed with `//| `.
 * - `replay`: every recorded command as canonical replay text, one per line,
 *   runnable by the headless command runner (comment lines are skipped).
 */
import type {CadDocument,SolidNode,Transform} from './document.js';
import {compileCode} from './code.js';
import {evaluateSketch,featureValue} from './features.js';
import type {FeatureScalar,PlanarSketch} from './features.js';
import type {NamedParameter,ParametricDesign} from './parameters.js';
import type {CadSession} from './session.js';
import type {SessionCommandRecord,SessionCommandValue,SessionJsonValue,ApplySessionCommand} from './session-commands.js';

export interface CommandJournalEntry {
 readonly index:number;
 readonly record:SessionCommandRecord;
 /** Canonical command line that produced this record, when a registry command did. */
 readonly invocation?:string;
}
export type JournalExportFormat='cadscript'|'replay';
export interface JournalExportOptions {format?:JournalExportFormat;projectId?:string;dropped?:number}
export const JOURNAL_LIMITS=Object.freeze({entries:1000,bytes:8*1024*1024,entryBytes:2*1024*1024});
export const JOURNAL_FORMAT='crispcad-journal';

/** Bounded in memory; reset when another project is loaded. */
export function createCommandJournal(session:CadSession,limits:{entries?:number;bytes?:number}={}){
 const maxEntries=limits.entries??JOURNAL_LIMITS.entries,maxBytes=limits.bytes??JOURNAL_LIMITS.bytes;
 let entries:CommandJournalEntry[]=[],serial=0,bytes=0,dropped=0,invocation:string|undefined,projectId=session.state.document.id;
 const size=(entry:CommandJournalEntry)=>entry.record.text.length+(entry.invocation?.length??0);
 const unsubscribeCommands=session.subscribeCommands(record=>{
  const entry:CommandJournalEntry=Object.freeze({index:++serial,record,...(invocation!==undefined?{invocation}:{})});
  // Only the first record of an invocation belongs to it.
  invocation=undefined;
  entries.push(entry);bytes+=size(entry);
  while(entries.length>maxEntries||bytes>maxBytes&&entries.length>1){bytes-=size(entries.shift()!);dropped++;}
 });
 const unsubscribe=session.subscribe(state=>{if(state.document.id!==projectId){projectId=state.document.id;clear();}});
 function clear(){entries=[];bytes=0;dropped=0;}
 const journal={
  get entries():readonly CommandJournalEntry[]{return [...entries];},
  get dropped(){return dropped;},
  /** Attributes the next recorded command to `line` while `run` executes. */
  withInvocation<T>(line:string,run:()=>T):T{
   invocation=line;
   try{return run();}finally{invocation=undefined;}
  },
  summary():string{
   const plan=planJournal(entries);
   return `${entries.length} journal entries · ${topObjects(plan).length} portable objects · ${plan.replay.length} non-portable${dropped?` · ${dropped} dropped`:''}`;
  },
  export(format:JournalExportFormat='cadscript'):string{return exportCommandJournal(entries,{format,projectId,dropped});},
  clear,
  dispose(){unsubscribe();unsubscribeCommands();entries=[];},
 };
 return journal;
}
export type CommandJournal=ReturnType<typeof createCommandJournal>;

type PrimitiveNode=Extract<SolidNode,{kind:'box'|'sphere'|'cylinder'}>;
type FeatureNode=Extract<SolidNode,{kind:'extrusion'|'revolution'}>;
type BooleanNode=Extract<SolidNode,{kind:'boolean'}>;
type PortableNode=PrimitiveNode|FeatureNode|BooleanNode;
interface PortableObject {id:string;node:PortableNode;entries:CommandJournalEntry[];created:number}
interface PortableSketch {id:string;sketch:PlanarSketch;entries:CommandJournalEntry[]}
interface PortableParameter {name:string;parameter:NamedParameter;entries:CommandJournalEntry[]}
interface Fold {objects:Map<string,PortableObject>;sketches:Map<string,PortableSketch>;parameters:Map<string,PortableParameter>}
interface Plan extends Fold {replay:CommandJournalEntry[];omitted:number;undone:number}

/** The stored value of a recorded before/after slot, if present. */
const stored=(slot:SessionCommandValue)=>slot.present?slot.value:undefined;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
/** The parameters the journal created, as a design to evaluate expressions with. */
type Design=Pick<CadDocument,'parametric'>;
const designOf=(parameters:ReadonlyMap<string,PortableParameter>):Design=>({parametric:{version:1,parameters:Object.fromEntries([...parameters].map(([name,p])=>[name,p.parameter])),bindings:[]}});
/** A literal, or an expression of the journal's parameters that evaluates in `unit`. */
const scalar=(value:unknown,design:Design,unit:'mm'|'deg'='mm')=>{
 if(finite(value))return true;
 if(typeof value!=='string')return false;
 try{featureValue(value,design,unit);return true;}catch{return false;}
};
const portableParameter=(value:unknown):value is NamedParameter=>record(value)&&typeof value.expression==='string'&&!!value.expression.trim()&&['mm','deg','scalar'].includes(value.unit as string);
const plainBody=(value:Record<string,unknown>)=>!value.reference&&record(value.transform);
/**
 * Plain primitives, extrusions and revolutions whose values are literals or expressions of the
 * journal's parameters, and Booleans (their inputs are checked where they are folded) have a CAD
 * Script equivalent. A hole is portable only as an input of a portable Boolean (checked at export).
 */
const portableNode=(value:unknown,design:Design):value is PortableNode=>{
 if(!record(value)||!plainBody(value))return false;
 if(['box','sphere','cylinder'].includes(value.kind as string))return true;
 if(value.kind==='boolean')return ['union','subtract','intersect'].includes(value.operation as string)&&Array.isArray(value.inputs)&&value.inputs.length>=2&&value.inputs.every(id=>typeof id==='string')&&(value.useHoleRoles===undefined||value.useHoleRoles===true);
 if(value.featureVersion!==1||typeof value.sketchId!=='string')return false;
 if(value.kind==='extrusion')return scalar(value.distance,design)&&typeof value.symmetric==='boolean';
 return value.kind==='revolution'&&scalar(value.angle,design,'deg')&&(value.axisOffset===undefined||scalar(value.axisOffset,design));
};
/** A closed sketch on a principal plane. Rectangles and circles may use expressions of the
 * journal's parameters; other profiles use literal values only. */
const portableSketch=(value:unknown,design:Design):value is PlanarSketch=>{
 if(!record(value)||!record(value.profile)||value.profile.kind==='path'||!['XY','XZ','YZ'].includes(value.plane as string))return false;
 const parametric=value.profile.kind==='rectangle'||value.profile.kind==='circle';
 try{evaluateSketch(value as unknown as PlanarSketch,parametric?design:{});return true;}catch{return false;}
};
const sketchKey=(id:string)=>'sketch:'+id;
const parameterKey=(name:string)=>'param:'+name;
// Derived bookkeeping that every model edit may rewrite.
const sideEffect=(path:readonly string[])=>path[0]==='roots'||path[0]==='version'||path[0]==='modelSource';

/** Apply one leaf change to a detached copy (the change was validated when recorded). */
function setPath(target:Record<string,unknown>,path:readonly string[],value:{present:boolean;value?:SessionJsonValue}){
 let parent:Record<string,unknown>=target;
 for(const key of path.slice(0,-1)){if(!record(parent[key]))parent[key]={};parent=parent[key] as Record<string,unknown>;}
 const key=path[path.length-1];
 if(value.present)parent[key]=structuredClone(value.value);else delete parent[key];
}

/** Effective model edits: undo/redo pairs known to the journal cancel out. */
function effectiveEntries(entries:readonly CommandJournalEntry[]){
 const done:CommandJournalEntry[]=[],redo:CommandJournalEntry[]=[],kept=new Set<CommandJournalEntry>();let omitted=0,undone=0;
 for(const entry of entries){
  const kind=entry.record.command.kind;
  if(kind==='apply'){done.push(entry);redo.length=0;}
  else if(kind==='undo'){if(done.length){redo.push(done.pop()!);omitted++;}else kept.add(entry);}
  else if(kind==='redo'){if(redo.length){done.push(redo.pop()!);omitted++;}else kept.add(entry);}
  // Selection does not change the model; apply records carry their own selection.
  else omitted++;
 }
 for(const entry of done)kept.add(entry);
 undone=redo.length;
 return {entries:entries.filter(entry=>kept.has(entry)),omitted,undone};
}

/** Sketch IDs that the created or changed feature nodes of a command refer to. */
function referencedSketches(command:ApplySessionCommand):string[]{
 const ids:string[]=[];
 for(const change of command.changes){
  if(change.path[0]!=='nodes')continue;
  const value=change.path.length===2?stored(change.after):change.path.length===1?undefined:change.path[2]==='sketchId'?{sketchId:stored(change.after)}:undefined;
  if(record(value)&&typeof value.sketchId==='string')ids.push(value.sketchId);
  {const all=stored(change.after);if(change.path.length===1&&record(all))for(const node of Object.values(all))if(record(node)&&typeof node.sketchId==='string')ids.push(node.sketchId);}
 }
 return ids;
}

/** Bodies that tracked Booleans consume (their inputs). */
const consumedBy=(objects:ReadonlyMap<string,PortableObject>)=>new Set([...objects.values()].flatMap(object=>object.node.kind==='boolean'?object.node.inputs:[]));

/**
 * Decide which bodies are portable. A body is portable when it was created in
 * the journal as a plain box, sphere or cylinder, as an extrusion or revolution
 * of a closed sketch created in the journal (literal, or a rectangle or circle
 * driven by parameters created in the journal), or as a Boolean of portable
 * bodies, and every later edit that touched it (or its sketch, parameters or
 * inputs) only changed their own properties while they stayed portable. A
 * non-portable edit that touches a body, sketch or parameter (or removes a body
 * from the roots without a portable Boolean taking it) makes it non-portable
 * too, together with the sketch a feature uses and every other feature on that
 * sketch, and so on until nothing changes. Sketches and parameters that no
 * portable body uses, and holes that no portable Boolean takes, have no CAD
 * Script equivalent and stay replay text.
 */
function planJournal(entries:readonly CommandJournalEntry[]):Plan{
 const effective=effectiveEntries(entries);
 const tainted=new Set<string>();
 for(;;){
  const fold:Fold={objects:new Map(),sketches:new Map(),parameters:new Map()},replay:CommandJournalEntry[]=[],grown=new Set<string>();
  const taint=(key:string)=>{if(!tainted.has(key))grown.add(key);};
  for(const entry of effective.entries){
   const command=entry.record.command;
   if(command.kind!=='apply'){replay.push(entry);continue;}
   const before=new Map([...fold.objects].map(([id,object])=>[id,object.node]));
   const result=foldEntry(command,fold,tainted,entry);
   if(result.portable)continue;
   replay.push(entry);
   // Bodies, sketches and parameters a non-portable edit touched are no longer tracked; the next pass taints them from the start.
   const pending=[...result.touched];
   while(pending.length){
    const key=pending.pop()!;
    if(key.startsWith('sketch:'))fold.sketches.delete(key.slice(7));
    else if(key.startsWith('param:'))fold.parameters.delete(key.slice(6));
    else{
     const node=before.get(key);
     if(node&&'sketchId' in node)taint(sketchKey(node.sketchId));
     // A Boolean's inputs go with it: they are only in the model as its operands.
     if(node?.kind==='boolean')for(const input of node.inputs)if(fold.objects.has(input)&&!result.touched.includes(input))pending.push(input);
     fold.objects.delete(key);
    }
    taint(key);
   }
   for(const id of referencedSketches(command))taint(sketchKey(id));
  }
  if(!grown.size){
   // Sketches and parameters without a portable body, holes outside a portable Boolean, and
   // programs the compiler refuses stay replay text.
   const used=new Set([...fold.objects.values()].flatMap(object=>'sketchId' in object.node?[object.node.sketchId]:[]));
   for(const id of fold.sketches.keys())if(!used.has(id))taint(sketchKey(id));
   const consumed=consumedBy(fold.objects),top=[...fold.objects.values()].filter(object=>!consumed.has(object.id));
   for(const object of top)if(object.node.role==='hole')taint(object.id);
   const needed=new Set(top.flatMap(object=>parametersOf(object.node,fold)));
   for(const name of fold.parameters.keys())if(!needed.has(name))taint(parameterKey(name));
   for(const object of top)if(!grown.size&&!compiles(objectCadScript(object.node,fold)))taint(object.id);
  }
  if(!grown.size)return {...fold,replay,omitted:effective.omitted,undone:effective.undone};
  for(const key of grown)tainted.add(key);
 }
}
function compiles(source:string|undefined){
 if(source===undefined)return false;
 try{compileCode({version:1,language:'brickwright-cad-script',source,parameters:{}});return true;}catch{return false;}
}
/** The parameter names a parameter change concerns. */
function parameterNames(path:readonly string[],change:{before:SessionCommandValue;after:SessionCommandValue}):string[]|undefined{
 if(path.length>=3&&path[1]==='parameters')return [path[2]];
 const names=new Set<string>();
 for(const slot of [change.before,change.after]){
  const value=stored(slot),parameters=path.length===1?(record(value)?value.parameters:undefined):value;
  if(record(parameters))for(const name of Object.keys(parameters))names.add(name);
 }
 return path.length===1||path[1]==='parameters'?[...names]:undefined;
}
function foldEntry(command:ApplySessionCommand,fold:Fold,tainted:ReadonlySet<string>,entry:CommandJournalEntry):{portable:boolean;touched:string[]}{
 const {objects,sketches,parameters}=fold;
 const touched=new Set<string>(),deleted=new Set<string>();let portable=!command.context?.kernel&&!command.context?.bodyOperations,roots:readonly unknown[]|undefined;
 for(const change of command.changes){
  const [head,id]=change.path;
  if(head==='nodes'&&id!==undefined){touched.add(id);if(change.path.length===2&&!change.after.present)deleted.add(id);}
  if(head==='sketches'){
   if(id!==undefined)touched.add(sketchKey(id));
   else for(const value of [stored(change.before),stored(change.after)])if(record(value))for(const key of Object.keys(value))touched.add(sketchKey(key));
  }
  if(head==='parametric'){
   const names=parameterNames(change.path,change);
   for(const name of names??[])touched.add(parameterKey(name));
   // Bindings drive body properties from parameters: not portable, and every tracked body may depend on them.
   const bindings=(value:unknown)=>record(value)&&Array.isArray(value.bindings)&&value.bindings.length>0;
   if(names===undefined||change.path.length===1&&(bindings(stored(change.before))||bindings(stored(change.after)))){portable=false;for(const object of objects.keys())touched.add(object);}
  }
  if(head==='roots'&&change.path.length===1&&change.after.present&&Array.isArray(change.after.value))roots=change.after.value;
  if(sideEffect(change.path))continue;
  if(head==='parametric'){
   const names=parameterNames(change.path,change)??[];
   if(names.some(name=>tainted.has(parameterKey(name)))){portable=false;continue;}
   // Created here (the design, its parameter collection or one parameter), or changing tracked ones.
   if(change.path.length<=3&&!change.before.present)continue;
   if(change.path.length>=3&&parameters.has(names[0]))continue;
   portable=false;continue;
  }
  if(head==='sketches'){
   // The first sketch of a document creates the whole collection.
   if(id===undefined){
    {const created=stored(change.after);if(change.before.present||!record(created)||Object.keys(created).some(key=>tainted.has(sketchKey(key))))portable=false;}
    continue;
   }
   if(tainted.has(sketchKey(id))){portable=false;continue;}
   if(sketches.has(id))continue;
   if(change.path.length===2&&!change.before.present&&change.after.present)continue;
   portable=false;continue;
  }
  if(head!=='nodes'||id===undefined||tainted.has(id)){portable=false;continue;}
  if(objects.has(id))continue;
  if(change.path.length===2&&!change.before.present&&change.after.present)continue;
  portable=false;
 }
 // Sketch joint context only exists when a sketch with joints changed; joints are not portable.
 if(command.context?.sketchJoints?.some(item=>item.joints.length))portable=false;
 // A body that leaves the roots without being deleted was consumed: by a Boolean, which must be portable itself.
 const consumed=consumedBy(objects);
 const leaving=roots?[...objects.keys()].filter(id=>!roots!.includes(id)&&!deleted.has(id)&&!consumed.has(id)):[];
 for(const id of leaving)touched.add(id);
 if(!portable)return {portable:false,touched:[...touched]};
 // Fold into a trial copy first: every touched body, sketch and parameter must remain portable.
 const trialObjects=new Map([...objects].map(([id,object])=>[id,{...object,node:structuredClone(object.node)}]));
 const trialSketches=new Map([...sketches].map(([id,sketch])=>[id,{...sketch,sketch:structuredClone(sketch.sketch)}]));
 const trialParameters=new Map([...parameters].map(([name,parameter])=>[name,{...parameter,parameter:structuredClone(parameter.parameter)}]));
 for(const change of command.changes){
  if(sideEffect(change.path))continue;
  const [head,id]=change.path;
  if(head==='parametric'){
   const path=change.path;
   if(path.length<3){
    const value=stored(change.after),collection=path.length===1?(record(value)?value.parameters:undefined):value;
    if(record(collection))for(const [name,parameter] of Object.entries(collection))trialParameters.set(name,{name,parameter:structuredClone(parameter) as unknown as NamedParameter,entries:[]});
    continue;
   }
   const name=path[2];
   if(path.length===3){
    if(change.after.present)trialParameters.set(name,{name,parameter:structuredClone(stored(change.after)) as unknown as NamedParameter,entries:trialParameters.get(name)?.entries??[]});
    else trialParameters.delete(name);
    continue;
   }
   setPath(trialParameters.get(name)!.parameter as unknown as Record<string,unknown>,path.slice(3),change.after);
   continue;
  }
  if(head==='sketches'){
   if(id===undefined){for(const [key,value] of Object.entries(stored(change.after) as Record<string,unknown>))trialSketches.set(key,{id:key,sketch:structuredClone(value) as unknown as PlanarSketch,entries:[]});continue;}
   if(change.path.length===2){
    if(change.after.present)trialSketches.set(id,{id,sketch:structuredClone(stored(change.after)) as unknown as PlanarSketch,entries:[]});
    else trialSketches.delete(id);
    continue;
   }
   setPath(trialSketches.get(id)!.sketch as unknown as Record<string,unknown>,change.path.slice(2),change.after);
   continue;
  }
  if(change.path.length===2){
   if(change.after.present)trialObjects.set(id,{id,node:structuredClone(stored(change.after)) as unknown as PortableNode,entries:[],created:entry.index});
   else trialObjects.delete(id);
   continue;
  }
  setPath(trialObjects.get(id)!.node as unknown as Record<string,unknown>,change.path.slice(2),change.after);
 }
 const refuse={portable:false,touched:[...touched]};
 for(const parameter of trialParameters.values())if(!portableParameter(parameter.parameter))return refuse;
 const design=designOf(trialParameters);
 // Every tracked sketch and body must stay portable with the parameters as they are now (a
 // parameter edit can make a profile invalid without touching it).
 for(const sketch of trialSketches.values())if(!portableSketch(sketch.sketch,design))return refuse;
 for(const object of trialObjects.values())if(!portableNode(object.node,design))return refuse;
 // Every feature must still use a tracked sketch, and every Boolean tracked inputs that no other Boolean takes.
 const taken=new Set<string>();
 for(const object of trialObjects.values()){
  if('sketchId' in object.node&&!trialSketches.has(object.node.sketchId))return refuse;
  if(object.node.kind==='boolean')for(const input of object.node.inputs){if(!trialObjects.has(input)||taken.has(input)||input===object.id)return refuse;taken.add(input);}
 }
 // Bodies leaving the roots must be taken by a Boolean; the Boolean's entries shape them as well.
 for(const id of leaving)if(!taken.has(id))return refuse;
 objects.clear();sketches.clear();parameters.clear();
 for(const [id,object] of trialObjects){if(touched.has(id))object.entries=[...object.entries,entry];objects.set(id,object);}
 for(const [id,sketch] of trialSketches){if(touched.has(sketchKey(id)))sketch.entries=[...sketch.entries,entry];sketches.set(id,sketch);}
 for(const [name,parameter] of trialParameters){if(touched.has(parameterKey(name)))parameter.entries=[...parameter.entries,entry];parameters.set(name,parameter);}
 return {portable:true,touched:[...touched]};
}

const number=(value:number)=>{const n=Object.is(value,-0)?0:value;return String(n);};
const vector=(value:readonly number[])=>`[${value.map(number).join(', ')}]`;
const same=(value:readonly number[],expected:readonly number[])=>value.every((n,i)=>n===expected[i]);
/** Wraps a shape in a node transform: scale, then XYZ rotation, then translation (the model's order). */
function placed(shape:string,transform:Transform){
 if(!same(transform.scale,[1,1,1]))shape=`scale(${vector(transform.scale)}, ${shape})`;
 if(!same(transform.rotation,[0,0,0]))shape=`rotate(${vector(transform.rotation)}, ${shape})`;
 if(!same(transform.position,[0,0,0]))shape=`move(${vector(transform.position)}, ${shape})`;
 return shape;
}
function primitiveShape(node:Pick<SolidNode,'transform'>&({kind:'box';size:readonly number[]}|{kind:'sphere';radius:number;segments:number}|{kind:'cylinder';radius:number;height:number;segments:number})):string{
 const shape=node.kind==='box'?`box(${node.size.map(number).join(', ')})`
  :node.kind==='sphere'?`sphere(${number(node.radius)}, ${node.segments})`
  :`cylinder(${number(node.radius)}, ${number(node.height)}, ${node.segments})`;
 return placed(shape,node.transform);
}
/** CAD Script for one primitive at its node transform (scale, then XYZ rotation, then translation). */
export function primitiveCadScript(node:Parameters<typeof primitiveShape>[0]):string{
 return `return ${primitiveShape(node)};`;
}
/** A literal as a number; an expression of parameters as itself, in parentheses. */
const identifier=/^[A-Za-z_][A-Za-z0-9_]*$/;
const scalarText=(value:FeatureScalar)=>typeof value==='number'?number(value):identifier.test(value.trim())?value.trim():`(${value})`;
const negatedText=(value:FeatureScalar)=>typeof value==='number'?number(-value):`-${scalarText(value)}`;
const point2=(point:readonly number[])=>`[${number(point[0])}, ${number(point[1])}]`;
/** `x` and `y` are numbers or finished CAD Script expressions. */
const moved2d=(x:number|string,y:number|string,profile:string)=>x===0&&y===0?profile:`move2d(${typeof x==='number'?number(x):x}, ${typeof y==='number'?number(y):y}, ${profile})`;
/**
 * CAD Script profile expression for a closed sketch, in sketch coordinates.
 * Rectangles and circles keep their analytic form, with their parameter
 * expressions; other (literal) profiles use the sketch's own evaluated polygon
 * (tessellated arcs and holes included).
 */
export function sketchProfileCadScript(sketch:PlanarSketch):string{
 const profile=sketch.profile;
 if(profile.kind==='rectangle')return `rectangle2d(${scalarText(profile.width)}, ${scalarText(profile.depth)}, true)`;
 if(profile.kind==='circle'){const [x,y]=profile.center??[0,0];return moved2d(x,y,`circle2d(${scalarText(profile.radius)}, ${profile.segments})`);}
 const evaluated=evaluateSketch(sketch,{});
 if(profile.kind==='outline'&&!profile.bulges&&profile.points.length===4){
  const xs=profile.points.map(p=>p[0]),ys=profile.points.map(p=>p[1]),x0=Math.min(...xs),y0=Math.min(...ys),x1=Math.max(...xs),y1=Math.max(...ys);
  const axisAligned=profile.points.every(([x,y])=>(x===x0||x===x1)&&(y===y0||y===y1))&&new Set(profile.points.map(p=>p.join(','))).size===4;
  if(axisAligned&&x1>x0&&y1>y0)return moved2d(x0,y0,`rectangle2d(${number(x1-x0)}, ${number(y1-y0)})`);
 }
 const loops=[evaluated.contour,...(evaluated.holes??[])];
 if(loops.length===1)return `polygon2d([${evaluated.contour.map(point2).join(', ')}])`;
 let next=0;
 const paths=loops.map(loop=>`[${loop.map(()=>next++).join(', ')}]`);
 return `polygon2d([${loops.flat().map(point2).join(', ')}], [${paths.join(', ')}])`;
}
/** The profile's smallest sketch X, the revolution's default axis: an expression for parametric rectangles and circles. */
function defaultAxis(sketch:PlanarSketch):FeatureScalar{
 const profile=sketch.profile;
 if(profile.kind==='rectangle'&&typeof profile.width==='string')return `${negatedText(profile.width)} / 2`;
 if(profile.kind==='circle'&&typeof profile.radius==='string')return `${number((profile.center??[0,0])[0])} - ${scalarText(profile.radius)}`;
 return Math.min(...evaluateSketch(sketch,{}).contour.map(p=>p[0]));
}
/** CAD Script shape of an extrusion or revolution of `sketch`, built like the model's feature evaluator. */
function featureShape(node:FeatureNode,sketch:PlanarSketch):string{
 const profile=sketchProfileCadScript(sketch);
 let shape:string;
 if(node.kind==='extrusion'){
  const distance=node.distance;
  shape=`extrudeProfile(${scalarText(distance)}, ${profile})`;
  if(node.symmetric)shape=`move([0, 0, ${typeof distance==='number'?number(-distance/2):`${negatedText(distance)} / 2`}], ${shape})`;
  if(sketch.plane==='XZ')shape=`rotate([90, 0, 0], ${shape})`;
  else if(sketch.plane==='YZ')shape=`rotate([90, 0, 90], ${shape})`;
 }else{
  // The axis is parallel to sketch Y at sketch X = axisOffset (default: the profile's smallest X).
  const axis=node.axisOffset===undefined?defaultAxis(sketch):node.axisOffset;
  shape=`revolve(${moved2d(typeof axis==='number'?-axis:negatedText(axis),0,profile)}, ${scalarText(node.angle)}, 128)`;
  if(sketch.plane==='XY')shape=`rotate([-90, 0, 0], ${shape})`;
  else if(sketch.plane==='YZ')shape=`rotate([0, 0, 90], ${shape})`;
  if(axis!==0){const at=scalarText(axis);shape=`move(${sketch.plane==='YZ'?`[0, ${at}, 0]`:`[${at}, 0, 0]`}, ${shape})`;}
 }
 return placed(shape,node.transform);
}
/** CAD Script for an extrusion or revolution of `sketch` (literal or parametric, see `sketchProfileCadScript`). */
export function featureCadScript(node:FeatureNode,sketch:PlanarSketch):string{
 return `return ${featureShape(node,sketch)};`;
}
/** CAD Script shape of a portable body: primitives and features as above, Booleans of their inputs. */
function shapeCadScript(node:PortableNode,fold:Fold,depth=0):string|undefined{
 if(depth>64)return undefined;
 if(node.kind==='extrusion'||node.kind==='revolution'){
  const sketch=fold.sketches.get(node.sketchId);
  try{return sketch&&featureShape(node,sketch.sketch);}catch{return undefined;}
 }
 if(node.kind!=='boolean')return primitiveShape(node);
 const inputs=node.inputs.map(id=>fold.objects.get(id));
 if(inputs.some(input=>!input))return undefined;
 const operands=inputs.map(input=>shapeCadScript(input!.node,fold,depth+1));
 if(operands.some(operand=>operand===undefined))return undefined;
 let shape:string;
 if(node.useHoleRoles){
  // As the evaluator: the union of the solid inputs minus the holes; only holes: their union.
  const solids=operands.filter((_,i)=>inputs[i]!.node.role!=='hole'),holes=operands.filter((_,i)=>inputs[i]!.node.role==='hole');
  shape=!solids.length?`union(${holes.join(', ')})`:!holes.length?(solids.length>1?`union(${solids.join(', ')})`:solids[0]!)
   :`subtract(${solids.length>1?`union(${solids.join(', ')})`:solids[0]}, ${holes.join(', ')})`;
 }else shape=`${node.operation}(${operands.join(', ')})`;
 return placed(shape,node.transform);
}
/** Expressions a portable body uses: its own, its sketch's, its inputs'. */
function expressionsOf(node:PortableNode,fold:Fold,depth=0):string[]{
 if(depth>64)return [];
 if(node.kind==='boolean')return node.inputs.flatMap(id=>{const input=fold.objects.get(id);return input?expressionsOf(input.node,fold,depth+1):[];});
 if(node.kind!=='extrusion'&&node.kind!=='revolution')return [];
 const profile=fold.sketches.get(node.sketchId)?.sketch.profile;
 const values:unknown[]=node.kind==='extrusion'?[node.distance]:[node.angle,node.axisOffset];
 if(profile?.kind==='rectangle')values.push(profile.width,profile.depth);
 if(profile?.kind==='circle')values.push(profile.radius);
 return values.filter((value):value is string=>typeof value==='string');
}
/** The journal's parameters a body's expressions use, directly or through other parameters, in the order they were created. */
function parametersOf(node:PortableNode,fold:Fold):string[]{
 const names=new Set<string>(),pending=[...expressionsOf(node,fold)];
 while(pending.length){
  for(const [word] of pending.pop()!.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)){
   const parameter=fold.parameters.get(word);
   if(parameter&&!names.has(word)){names.add(word);pending.push(parameter.parameter.expression);}
  }
 }
 return [...fold.parameters.keys()].filter(name=>names.has(name));
}
/** A complete CAD Script program for a portable body: the parameters it uses, then its shape. */
function objectCadScript(node:PortableNode,fold:Fold):string|undefined{
 const shape=shapeCadScript(node,fold);
 if(shape===undefined)return undefined;
 const parameters=parametersOf(node,fold).map(name=>{const {unit,expression}=fold.parameters.get(name)!.parameter;return `param ${name}: ${unit} = ${expression};`;});
 return [...parameters,`return ${shape};`].join('\n');
}
/** Entries that shaped an object: its own, those of the sketch it uses, of its inputs and of the parameters it uses. */
function objectEntries(object:PortableObject,fold:Fold,depth=0):CommandJournalEntry[]{
 const node=object.node,sketch='sketchId' in node?fold.sketches.get(node.sketchId):undefined;
 const inputs=node.kind==='boolean'&&depth<64?node.inputs.flatMap(id=>{const input=fold.objects.get(id);return input?objectEntries(input,fold,depth+1):[];}):[];
 const parameters=depth?[]:parametersOf(node,fold).flatMap(name=>fold.parameters.get(name)!.entries);
 return [...new Set([...parameters,...(sketch?.entries??[]),...inputs,...object.entries])].sort((a,b)=>a.index-b.index);
}
/** Portable bodies that no portable Boolean takes: one program each. */
const topObjects=(fold:Fold)=>{const consumed=consumedBy(fold.objects);return [...fold.objects.values()].filter(object=>!consumed.has(object.id)).sort((a,b)=>a.created-b.created);};

const comment=(text:string)=>text.replace(/[\r\n\u2028\u2029]+/g,' ');
function replayLine(entry:CommandJournalEntry){
 const text=entry.record.text;
 return text.length>JOURNAL_LIMITS.entryBytes?`//| (replay text of ${text.length} characters exceeds the export limit)`:'//| '+text;
}

/** Text export of journal entries. The result is data; never evaluate it. */
export function exportCommandJournal(entries:readonly CommandJournalEntry[],options:JournalExportOptions={}):string{
 const format=options.format??'cadscript';
 const header=[`// ${JOURNAL_FORMAT} 1 · ${format}`,'// Data only. Never evaluate this text as JavaScript.'];
 if(options.projectId)header.push(`// project: ${options.projectId}`);
 if(options.dropped)header.push(`// ${options.dropped} earlier entries exceeded the journal limit and are not included.`);
 if(format==='replay'){
  header.push('// Canonical replay commands, one per line, for the recorded project.');
  return [...header,...entries.map(entry=>entry.record.text.length>JOURNAL_LIMITS.entryBytes?`// (entry ${entry.index}: replay text of ${entry.record.text.length} characters exceeds the export limit)`:entry.record.text)].join('\n')+'\n';
 }
 const plan=planJournal(entries);
 header.push('// Each "@object" block is a complete CAD Script program for one body.',
  '// "@replay" blocks are non-portable: canonical replay text (prefixed "//| ")',
  '// that only applies to the recorded project.');
 if(plan.omitted)header.push(`// ${plan.omitted} selection, undo and redo entries were resolved and omitted.`);
 if(plan.undone)header.push(`// ${plan.undone} undone edits are not included.`);
 const blocks:{index:number;lines:string[]}[]=[];
 let objectNumber=0;
 for(const object of topObjects(plan)){
  const sources=objectEntries(object,plan).map(entry=>entry.invocation??entry.record.summary);
  blocks.push({index:object.created,lines:[
   `// @object ${++objectNumber} ${JSON.stringify(object.node.name??'')}${object.node.color?` color ${object.node.color}`:''}`,
   ...(sources.length?[`// from: ${comment(sources.join('; '))}`]:[]),
   objectCadScript(object.node,plan)!,
  ]});
 }
 for(const entry of plan.replay)blocks.push({index:entry.index,lines:[
  `// @replay ${entry.index} non-portable: ${comment(entry.invocation??entry.record.summary)}`,
  replayLine(entry),
 ]});
 blocks.sort((a,b)=>a.index-b.index);
 if(!blocks.length)header.push('// No model edits recorded.');
 return [...header,...blocks.flatMap(block=>['',...block.lines])].join('\n')+'\n';
}
/** @internal Exposed for tests: the bodies the export treats as portable. */
export function portableJournalObjects(entries:readonly CommandJournalEntry[]):{id:string;source:string}[]{
 const plan=planJournal(entries);
 return topObjects(plan).map(object=>({id:object.id,source:objectCadScript(object.node,plan)!}));
}

