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
import type {CadSession} from './session.js';
import type {SessionCommandRecord,SessionJsonValue,ApplySessionCommand} from './session-commands.js';

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

type PortableNode=Extract<SolidNode,{kind:'box'|'sphere'|'cylinder'}>;
interface PortableObject {id:string;node:PortableNode;entries:CommandJournalEntry[];created:number}
interface Plan {objects:Map<string,PortableObject>;replay:CommandJournalEntry[];omitted:number;undone:number}

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const portableNode=(value:unknown):value is PortableNode=>record(value)&&['box','sphere','cylinder'].includes(value.kind as string)
 &&!value.reference&&value.role!=='hole'&&record(value.transform);
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

/**
 * Decide which bodies are portable. A body is portable when it was created in
 * the journal as a plain box, sphere or cylinder and every later edit that
 * touched it only changed its own properties while it stayed a plain
 * primitive. A non-portable edit that touches a body (or removes it from the
 * roots) makes that body non-portable too, and so on until nothing changes.
 */
function planJournal(entries:readonly CommandJournalEntry[]):Plan{
 const effective=effectiveEntries(entries);
 const tainted=new Set<string>();
 for(;;){
  const objects=new Map<string,PortableObject>(),replay:CommandJournalEntry[]=[],grown=new Set<string>();
  for(const entry of effective.entries){
   const command=entry.record.command;
   if(command.kind!=='apply'){replay.push(entry);continue;}
   const result=foldEntry(command,objects,tainted,entry);
   if(result.portable)continue;
   replay.push(entry);
   // Bodies a non-portable edit touched are no longer tracked; the next pass taints them from the start.
   for(const id of result.touched){objects.delete(id);if(!tainted.has(id))grown.add(id);}
  }
  if(!grown.size)return {objects,replay,omitted:effective.omitted,undone:effective.undone};
  for(const id of grown)tainted.add(id);
 }
}
function foldEntry(command:ApplySessionCommand,objects:Map<string,PortableObject>,tainted:ReadonlySet<string>,entry:CommandJournalEntry):{portable:boolean;touched:string[]}{
 const touched=new Set<string>(),deleted=new Set<string>();let portable=!command.context,roots:readonly unknown[]|undefined;
 for(const change of command.changes){
  const [head,id]=change.path;
  if(head==='nodes'&&id!==undefined){touched.add(id);if(change.path.length===2&&!change.after.present)deleted.add(id);}
  if(head==='roots'&&change.path.length===1&&change.after.present&&Array.isArray(change.after.value))roots=change.after.value;
  if(sideEffect(change.path))continue;
  if(head!=='nodes'||id===undefined||tainted.has(id)){portable=false;continue;}
  if(objects.has(id))continue;
  if(change.path.length===2&&!change.before.present&&change.after.present&&portableNode(change.after.value))continue;
  portable=false;
 }
 // A body that leaves the roots without being deleted was consumed, e.g. by a boolean.
 if(roots)for(const id of objects.keys())if(!roots.includes(id)&&!deleted.has(id)){touched.add(id);portable=false;}
 if(!portable)return {portable:false,touched:[...touched]};
 // Fold into a trial copy first: every touched body must remain a plain primitive.
 const trial=new Map([...objects].map(([id,object])=>[id,{...object,node:structuredClone(object.node)}]));
 for(const change of command.changes){
  if(sideEffect(change.path))continue;
  const id=change.path[1];
  if(change.path.length===2){
   if(change.after.present)trial.set(id,{id,node:structuredClone(change.after.value) as unknown as PortableNode,entries:[],created:entry.index});
   else trial.delete(id);
   continue;
  }
  setPath(trial.get(id)!.node as unknown as Record<string,unknown>,change.path.slice(2),change.after);
 }
 for(const id of touched){const object=trial.get(id);if(object&&!portableNode(object.node))return {portable:false,touched:[...touched]};}
 objects.clear();
 for(const [id,object] of trial){if(touched.has(id))object.entries=[...object.entries,entry];objects.set(id,object);}
 return {portable:true,touched:[...touched]};
}

const number=(value:number)=>{const n=Object.is(value,-0)?0:value;return String(n);};
const vector=(value:readonly number[])=>`[${value.map(number).join(', ')}]`;
const same=(value:readonly number[],expected:readonly number[])=>value.every((n,i)=>n===expected[i]);
/** CAD Script for one primitive at its node transform (scale, then XYZ rotation, then translation). */
export function primitiveCadScript(node:Pick<SolidNode,'transform'>&({kind:'box';size:readonly number[]}|{kind:'sphere';radius:number;segments:number}|{kind:'cylinder';radius:number;height:number;segments:number})):string{
 let shape=node.kind==='box'?`box(${node.size.map(number).join(', ')})`
  :node.kind==='sphere'?`sphere(${number(node.radius)}, ${node.segments})`
  :`cylinder(${number(node.radius)}, ${number(node.height)}, ${node.segments})`;
 const transform:Transform=node.transform;
 if(!same(transform.scale,[1,1,1]))shape=`scale(${vector(transform.scale)}, ${shape})`;
 if(!same(transform.rotation,[0,0,0]))shape=`rotate(${vector(transform.rotation)}, ${shape})`;
 if(!same(transform.position,[0,0,0]))shape=`move(${vector(transform.position)}, ${shape})`;
 return `return ${shape};`;
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
  const sources=object.entries.map(entry=>entry.invocation??entry.record.summary);
  blocks.push({index:object.created,lines:[
   `// @object ${++objectNumber} ${JSON.stringify(object.node.name??'')}${object.node.color?` color ${object.node.color}`:''}`,
   ...(sources.length?[`// from: ${comment(sources.join('; '))}`]:[]),
   primitiveCadScript(object.node),
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
 return [...planJournal(entries).objects.values()].sort((a,b)=>a.created-b.created).map(object=>({id:object.id,source:primitiveCadScript(object.node)}));
}

