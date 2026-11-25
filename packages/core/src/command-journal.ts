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
import type {SolidNode,Transform} from './document.js';
import {compileCode} from './code.js';
import {evaluateSketch} from './features.js';
import type {PlanarSketch} from './features.js';
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
   return `${entries.length} journal entries · ${plan.objects.size} portable objects · ${plan.replay.length} non-portable${dropped?` · ${dropped} dropped`:''}`;
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
type PortableNode=PrimitiveNode|FeatureNode;
interface PortableObject {id:string;node:PortableNode;entries:CommandJournalEntry[];created:number}
interface PortableSketch {id:string;sketch:PlanarSketch;entries:CommandJournalEntry[]}
interface Fold {objects:Map<string,PortableObject>;sketches:Map<string,PortableSketch>}
interface Plan extends Fold {replay:CommandJournalEntry[];omitted:number;undone:number}

/** The stored value of a recorded before/after slot, if present. */
const stored=(slot:SessionCommandValue)=>slot.present?slot.value:undefined;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const plainBody=(value:Record<string,unknown>)=>!value.reference&&value.role!=='hole'&&record(value.transform);
/** Plain primitives and literal sketch extrusions/revolutions have a CAD Script equivalent. */
const portableNode=(value:unknown):value is PortableNode=>{
 if(!record(value)||!plainBody(value))return false;
 if(['box','sphere','cylinder'].includes(value.kind as string))return true;
 if(value.featureVersion!==1||typeof value.sketchId!=='string')return false;
 if(value.kind==='extrusion')return finite(value.distance)&&typeof value.symmetric==='boolean';
 return value.kind==='revolution'&&finite(value.angle)&&(value.axisOffset===undefined||finite(value.axisOffset));
};
/** A closed sketch on a principal plane whose profile uses literal values only. */
const portableSketch=(value:unknown):value is PlanarSketch=>{
 if(!record(value)||!record(value.profile)||value.profile.kind==='path'||!['XY','XZ','YZ'].includes(value.plane as string))return false;
 try{evaluateSketch(value as unknown as PlanarSketch,{});return true;}catch{return false;}
};
const sketchKey=(id:string)=>'sketch:'+id;
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

/**
 * Decide which bodies are portable. A body is portable when it was created in
 * the journal as a plain box, sphere or cylinder, or as an extrusion or
 * revolution of a closed literal sketch created in the journal, and every
 * later edit that touched it (or its sketch) only changed their own
 * properties while they stayed portable. A non-portable edit that touches a
 * body or sketch (or removes a body from the roots) makes it non-portable too,
 * together with the sketch a feature uses and every other feature on that
 * sketch, and so on until nothing changes. A sketch that no portable body
 * uses has no CAD Script equivalent and stays replay text.
 */
function planJournal(entries:readonly CommandJournalEntry[]):Plan{
 const effective=effectiveEntries(entries);
 const tainted=new Set<string>();
 for(;;){
  const fold:Fold={objects:new Map(),sketches:new Map()},replay:CommandJournalEntry[]=[],grown=new Set<string>();
  const taint=(key:string)=>{if(!tainted.has(key))grown.add(key);};
  for(const entry of effective.entries){
   const command=entry.record.command;
   if(command.kind!=='apply'){replay.push(entry);continue;}
   const before=new Map([...fold.objects].map(([id,object])=>[id,object.node]));
   const result=foldEntry(command,fold,tainted,entry);
   if(result.portable)continue;
   replay.push(entry);
   // Bodies and sketches a non-portable edit touched are no longer tracked; the next pass taints them from the start.
   for(const key of result.touched){
    if(!key.startsWith('sketch:')){const node=before.get(key);if(node&&'sketchId' in node)taint(sketchKey(node.sketchId));fold.objects.delete(key);}
    else fold.sketches.delete(key.slice(7));
    taint(key);
   }
   for(const id of referencedSketches(command))taint(sketchKey(id));
  }
  if(!grown.size){
   // Sketches without a portable body, and programs the compiler refuses, stay replay text.
   const used=new Set([...fold.objects.values()].flatMap(object=>'sketchId' in object.node?[object.node.sketchId]:[]));
   for(const id of fold.sketches.keys())if(!used.has(id))taint(sketchKey(id));
   for(const object of fold.objects.values())if(!grown.size&&!compiles(objectCadScript(object.node,fold.sketches)))taint(object.id);
  }
  if(!grown.size)return {...fold,replay,omitted:effective.omitted,undone:effective.undone};
  for(const key of grown)tainted.add(key);
 }
}
function compiles(source:string|undefined){
 if(source===undefined)return false;
 try{compileCode({version:1,language:'brickwright-cad-script',source,parameters:{}});return true;}catch{return false;}
}
function foldEntry(command:ApplySessionCommand,fold:Fold,tainted:ReadonlySet<string>,entry:CommandJournalEntry):{portable:boolean;touched:string[]}{
 const {objects,sketches}=fold;
 const touched=new Set<string>(),deleted=new Set<string>();let portable=!command.context?.kernel&&!command.context?.bodyOperations,roots:readonly unknown[]|undefined;
 for(const change of command.changes){
  const [head,id]=change.path;
  if(head==='nodes'&&id!==undefined){touched.add(id);if(change.path.length===2&&!change.after.present)deleted.add(id);}
  if(head==='sketches'){
   if(id!==undefined)touched.add(sketchKey(id));
   else for(const value of [stored(change.before),stored(change.after)])if(record(value))for(const key of Object.keys(value))touched.add(sketchKey(key));
  }
  if(head==='roots'&&change.path.length===1&&change.after.present&&Array.isArray(change.after.value))roots=change.after.value;
  if(sideEffect(change.path))continue;
  if(head==='sketches'){
   // The first sketch of a document creates the whole collection.
   if(id===undefined){
    {const created=stored(change.after);if(change.before.present||!record(created)||Object.entries(created).some(([key,value])=>tainted.has(sketchKey(key))||!portableSketch(value)))portable=false;}
    continue;
   }
   if(tainted.has(sketchKey(id))){portable=false;continue;}
   if(sketches.has(id))continue;
   if(change.path.length===2&&!change.before.present&&change.after.present&&portableSketch(stored(change.after)))continue;
   portable=false;continue;
  }
  if(head!=='nodes'||id===undefined||tainted.has(id)){portable=false;continue;}
  if(objects.has(id))continue;
  if(change.path.length===2&&!change.before.present&&change.after.present&&portableNode(stored(change.after)))continue;
  portable=false;
 }
 // Sketch joint context only exists when a sketch with joints changed; joints are not portable.
 if(command.context?.sketchJoints?.some(item=>item.joints.length))portable=false;
 // A body that leaves the roots without being deleted was consumed, e.g. by a boolean.
 if(roots)for(const id of objects.keys())if(!roots.includes(id)&&!deleted.has(id)){touched.add(id);portable=false;}
 if(!portable)return {portable:false,touched:[...touched]};
 // Fold into a trial copy first: every touched body and sketch must remain portable.
 const trialObjects=new Map([...objects].map(([id,object])=>[id,{...object,node:structuredClone(object.node)}]));
 const trialSketches=new Map([...sketches].map(([id,sketch])=>[id,{...sketch,sketch:structuredClone(sketch.sketch)}]));
 for(const change of command.changes){
  if(sideEffect(change.path))continue;
  const [head,id]=change.path;
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
 for(const key of touched){
  if(key.startsWith('sketch:')){const sketch=trialSketches.get(key.slice(7));if(sketch&&!portableSketch(sketch.sketch))return {portable:false,touched:[...touched]};continue;}
  const object=trialObjects.get(key);
  if(object&&!portableNode(object.node))return {portable:false,touched:[...touched]};
 }
 // Every feature must still use a tracked, portable sketch.
 for(const object of trialObjects.values())if('sketchId' in object.node&&!trialSketches.has(object.node.sketchId))return {portable:false,touched:[...touched]};
 objects.clear();sketches.clear();
 for(const [id,object] of trialObjects){if(touched.has(id))object.entries=[...object.entries,entry];objects.set(id,object);}
 for(const [id,sketch] of trialSketches){if(touched.has(sketchKey(id)))sketch.entries=[...sketch.entries,entry];sketches.set(id,sketch);}
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
/** CAD Script for one primitive at its node transform (scale, then XYZ rotation, then translation). */
export function primitiveCadScript(node:Pick<SolidNode,'transform'>&({kind:'box';size:readonly number[]}|{kind:'sphere';radius:number;segments:number}|{kind:'cylinder';radius:number;height:number;segments:number})):string{
 const shape=node.kind==='box'?`box(${node.size.map(number).join(', ')})`
  :node.kind==='sphere'?`sphere(${number(node.radius)}, ${node.segments})`
  :`cylinder(${number(node.radius)}, ${number(node.height)}, ${node.segments})`;
 return `return ${placed(shape,node.transform)};`;
}
const point2=(point:readonly number[])=>`[${number(point[0])}, ${number(point[1])}]`;
const moved2d=(x:number,y:number,profile:string)=>x===0&&y===0?profile:`move2d(${number(x)}, ${number(y)}, ${profile})`;
/**
 * CAD Script profile expression for a closed literal sketch, in sketch coordinates.
 * Rectangles and circles keep their analytic form; other profiles use the
 * sketch's own evaluated polygon (tessellated arcs and holes included).
 */
export function sketchProfileCadScript(sketch:PlanarSketch):string{
 const profile=sketch.profile;
 if(profile.kind==='rectangle'&&finite(profile.width)&&finite(profile.depth))return `rectangle2d(${number(profile.width)}, ${number(profile.depth)}, true)`;
 if(profile.kind==='circle'&&finite(profile.radius)){const [x,y]=profile.center??[0,0];return moved2d(x,y,`circle2d(${number(profile.radius)}, ${profile.segments})`);}
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
/** CAD Script for a literal extrusion or revolution of `sketch`, built like the model's feature evaluator. */
export function featureCadScript(node:FeatureNode,sketch:PlanarSketch):string{
 const profile=sketchProfileCadScript(sketch);
 let shape:string;
 if(node.kind==='extrusion'){
  const distance=node.distance as number;
  shape=`extrudeProfile(${number(distance)}, ${profile})`;
  if(node.symmetric)shape=`move([0, 0, ${number(-distance/2)}], ${shape})`;
  if(sketch.plane==='XZ')shape=`rotate([90, 0, 0], ${shape})`;
  else if(sketch.plane==='YZ')shape=`rotate([90, 0, 90], ${shape})`;
 }else{
  // The axis is parallel to sketch Y at sketch X = axisOffset (default: the profile's smallest X).
  const axis=node.axisOffset===undefined?Math.min(...evaluateSketch(sketch,{}).contour.map(p=>p[0])):node.axisOffset as number;
  shape=`revolve(${moved2d(-axis,0,profile)}, ${number(node.angle as number)}, 128)`;
  if(sketch.plane==='XY')shape=`rotate([-90, 0, 0], ${shape})`;
  else if(sketch.plane==='YZ')shape=`rotate([0, 0, 90], ${shape})`;
  if(axis)shape=`move(${vector(sketch.plane==='YZ'?[0,axis,0]:[axis,0,0])}, ${shape})`;
 }
 return `return ${placed(shape,node.transform)};`;
}
function objectCadScript(node:PortableNode,sketches:ReadonlyMap<string,PortableSketch>):string|undefined{
 if(node.kind==='extrusion'||node.kind==='revolution'){
  const sketch=sketches.get(node.sketchId);
  try{return sketch&&featureCadScript(node,sketch.sketch);}catch{return undefined;}
 }
 return primitiveCadScript(node);
}
/** Entries that shaped an object: its own and those of the sketch it uses. */
function objectEntries(object:PortableObject,sketches:ReadonlyMap<string,PortableSketch>){
 const sketch='sketchId' in object.node?sketches.get(object.node.sketchId):undefined;
 return [...new Set([...(sketch?.entries??[]),...object.entries])].sort((a,b)=>a.index-b.index);
}

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
 const objects=[...plan.objects.values()].sort((a,b)=>a.created-b.created);
 for(const object of objects){
  const sources=objectEntries(object,plan.sketches).map(entry=>entry.invocation??entry.record.summary);
  blocks.push({index:object.created,lines:[
   `// @object ${++objectNumber} ${JSON.stringify(object.node.name??'')}${object.node.color?` color ${object.node.color}`:''}`,
   ...(sources.length?[`// from: ${comment(sources.join('; '))}`]:[]),
   objectCadScript(object.node,plan.sketches)!,
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
 return [...plan.objects.values()].sort((a,b)=>a.created-b.created).map(object=>({id:object.id,source:objectCadScript(object.node,plan.sketches)!}));
}

