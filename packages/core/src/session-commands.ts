// SPDX-License-Identifier: BSD-3-Clause
import {constructionInputs} from './document.js';
import type {CadDocument} from './document.js';

/** Data only: recorded commands never evaluate JavaScript or contain callbacks. */
export type SessionJsonValue = null | boolean | number | string | SessionJsonValue[] | {[key:string]:SessionJsonValue};
export type SessionCommandValue = {present:false} | {present:true;value:SessionJsonValue};
export interface SessionValueChange {
  /** Object properties only; arrays are replaced atomically, never patched by index. */
  path:string[];
  before:SessionCommandValue;
  after:SessionCommandValue;
}
export interface SessionSketchJointContext {
  sketchId:string;
  /** Only relationships affect the sketch-edit guard; joint settings may vary. */
  joints:{id:string;bodyA:string;bodyB:string}[];
}
export interface ApplySessionCommand {
  version:1;
  kind:'apply';
  projectId:string;
  label:string;
  changes:SessionValueChange[];
  selection:string[];
  /** Optional read dependencies. Older version-1 records contain only writes. */
  context?:{sketchJoints:SessionSketchJointContext[]};
}
export type SessionCommand = ApplySessionCommand
  | {version:1;kind:'select';ids:string[]}
  | {version:1;kind:'undo'}
  | {version:1;kind:'redo'};
export interface SessionCommandRecord {
  /** A detached, deeply frozen command. Use text to replay it in the terminal. */
  readonly command:SessionCommand;
  readonly text:string;
  readonly summary:string;
}

const forbidden=new Set(['__proto__','prototype','constructor']);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
  &&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function fail(message:string):never{throw new Error(`Invalid session command: ${message}`);}
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)&&!forbidden.has(value);
function onlyKeys(value:Record<string,unknown>,keys:readonly string[]){
  if(Object.keys(value).some(key=>!keys.includes(key)))fail('unsupported property');
}
function checkIds(value:unknown):asserts value is string[]{
  if(!Array.isArray(value)||value.length>2000||!Array.from(value).every(validId)||new Set(value).size!==value.length)fail('expected distinct object identifiers');
}
function checkJson(value:unknown):asserts value is SessionJsonValue{
  // Validate iteratively so opaque saved extension data has no new depth limit.
  // Numeric mesh buffers do not allocate one work item per scalar.
  const ancestors=new Set<object>(),work:{value:object;exit?:boolean}[]=[];
  function visit(item:unknown){
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'){if(!Number.isFinite(item))fail('numbers must be finite');return;}
    if(!Array.isArray(item)&&!object(item))fail('values must be JSON data');
    work.push({value:item});
  }
  visit(value);
  while(work.length){
    const next=work.pop()!;
    if(next.exit){ancestors.delete(next.value);continue;}
    if(ancestors.has(next.value))fail('values must not be cyclic');
    ancestors.add(next.value);work.push({value:next.value,exit:true});
    for(const item of Array.isArray(next.value)?next.value:Object.values(next.value))visit(item);
  }
}
function checkValue(value:unknown):asserts value is SessionCommandValue{
  if(!object(value)||typeof value.present!=='boolean')fail('expected a before/after value');
  onlyKeys(value,value.present?['present','value']:['present']);
  if(value.present){if(!Object.hasOwn(value,'value'))fail('missing value');checkJson(value.value);}
}
function checkContext(value:unknown):asserts value is NonNullable<ApplySessionCommand['context']>{
  if(!object(value))fail('expected command context');
  onlyKeys(value,['sketchJoints']);
  if(!Array.isArray(value.sketchJoints)||!value.sketchJoints.length||value.sketchJoints.length>256)fail('expected sketch joint context');
  const sketches=new Set<string>();
  for(const entry of value.sketchJoints){
    if(!object(entry))fail('expected sketch joint context');
    onlyKeys(entry,['sketchId','joints']);
    if(!validId(entry.sketchId)||sketches.has(entry.sketchId))fail('expected distinct sketch identifiers');
    sketches.add(entry.sketchId);
    if(!Array.isArray(entry.joints)||entry.joints.length>2000)fail('expected joint relationships');
    const joints=new Set<string>();
    for(const joint of entry.joints){
      if(!object(joint))fail('expected joint relationship');
      onlyKeys(joint,['id','bodyA','bodyB']);
      // Joint IDs follow the existing physics schema, which permits _ or - first.
      if(typeof joint.id!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(joint.id)||joints.has(joint.id)
        ||!validId(joint.bodyA)||!validId(joint.bodyB)||joint.bodyA===joint.bodyB)fail('invalid joint relationship');
      joints.add(joint.id);
    }
  }
}

/** Validate and detach callers' data before any part of a command is applied. */
export function copySessionCommand(value:unknown):SessionCommand{
  if(!object(value)||value.version!==1)fail('unsupported command version');
  if(value.kind==='undo'||value.kind==='redo'){
    onlyKeys(value,['version','kind']);
    return {version:1,kind:value.kind};
  }
  if(value.kind==='select'){
    onlyKeys(value,['version','kind','ids']);checkIds(value.ids);
    return {version:1,kind:'select',ids:[...value.ids]};
  }
  if(value.kind!=='apply')fail('unknown command kind');
  onlyKeys(value,['version','kind','projectId','label','changes','selection','context']);
  if(!validId(value.projectId)||typeof value.label!=='string')fail('missing project identity or label');
  checkIds(value.selection);
  if(value.context!==undefined)checkContext(value.context);
  if(!Array.isArray(value.changes)||!value.changes.length)fail('expected document changes');
  const paths:string[][]=[];
  for(const change of value.changes){
    if(!object(change))fail('expected a property change');
    onlyKeys(change,['path','before','after']);
    const path=change.path;
    if(!Array.isArray(path)||!path.length||path.length>128||!Array.from(path).every(key=>typeof key==='string'))fail('invalid property path');
    if(path[0]==='id')fail('commands must preserve the project identity');
    checkValue(change.before);checkValue(change.after);
    if(sameSessionValue(change.before,change.after))fail('empty property change');
    paths.push(path);
  }
  // Overlapping writes make the meaning depend on their order. Refuse them.
  const sorted=paths.map(path=>JSON.stringify(path)).sort();
  if(new Set(sorted).size!==sorted.length)fail('duplicate property path');
  const writes=new Set(sorted);
  for(const path of paths)for(let n=1;n<path.length;n++)if(writes.has(JSON.stringify(path.slice(0,n))))fail('overlapping property paths');
  return structuredClone(value) as unknown as ApplySessionCommand;
}

export function serializeSessionCommand(value:SessionCommand):string{
  const command=copySessionCommand(value);
  if(command.kind==='undo'||command.kind==='redo')return command.kind;
  if(command.kind==='select')return `select ${JSON.stringify(command.ids)}`;
  return `apply ${JSON.stringify(command)}`;
}

/** Parse canonical command text. Friendly command aliases belong to the editor. */
export function parseSessionCommand(text:string):SessionCommand{
  const match=/^(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if(!match)fail('expected a command');
  const name=match[1].toLowerCase(),payload=match[2];
  if(name==='undo'||name==='redo'){
    if(payload)fail(`${name} does not accept arguments`);
    return {version:1,kind:name};
  }
  if(name!=='apply'&&name!=='select')fail('expected apply, select, undo or redo');
  if(!payload)fail('missing JSON arguments');
  let value:unknown;
  try{value=JSON.parse(payload);}catch{fail('malformed JSON arguments');}
  if(name==='select')return copySessionCommand({version:1,kind:'select',ids:value});
  const command=copySessionCommand(value);
  if(command.kind!=='apply')fail('apply requires a document command');
  return command;
}

const jsonCopy=(value:unknown):SessionJsonValue=>JSON.parse(JSON.stringify(value)) as SessionJsonValue;
// Undefined optional properties and absent properties have the same saved meaning.
const storedValue=(value:unknown):SessionCommandValue=>value===undefined?{present:false}:{present:true,value:jsonCopy(value)};

/** @internal Equality of saved JSON values, including opaque legacy extensions.
 * Array holes/undefined save as null; unlike object properties, they occupy a slot.
 * Existing immutable mesh buffers take the identity fast path. */
export function sameSessionValue(left:unknown,right:unknown):boolean{
  if(left===right)return true;
  const normalize=(value:unknown)=>typeof value==='number'&&!Number.isFinite(value)?null
    :value&&typeof value==='object'&&!Array.isArray(value)&&!object(value)?jsonCopy(value):value;
  const a=normalize(left),b=normalize(right);
  if(a===b)return true;
  if(Array.isArray(a)||Array.isArray(b)){
    if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
    for(let i=0;i<a.length;i++)if(!sameSessionValue(a[i]===undefined?null:a[i],b[i]===undefined?null:b[i]))return false;
    return true;
  }
  if(!object(a)||!object(b))return false;
  const keys=Object.keys(a).filter(key=>a[key]!==undefined),other=Object.keys(b).filter(key=>b[key]!==undefined);
  return keys.length===other.length&&keys.every(key=>Object.hasOwn(b,key)&&sameSessionValue(a[key],b[key]));
}

function sketchJointRelationships(document:CadDocument,sketchId:string):SessionSketchJointContext['joints']{
  const related=new Map<string,boolean>();
  function uses(id:string):boolean{
    if(related.has(id))return related.get(id)!;
    const node=document.nodes[id];
    const result=!!node&&(node.kind==='extrusion'||node.kind==='revolution'
      ?node.sketchId===sketchId:constructionInputs(node).some(uses));
    related.set(id,result);return result;
  }
  return (document.joints??[]).filter(joint=>uses(joint.bodyA)||uses(joint.bodyB))
    .map(({id,bodyA,bodyB})=>({id,bodyA,bodyB})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}

/** @internal Capture the accepted result, including derived parameter/source edits. */
export function createDocumentCommand(before:CadDocument,after:CadDocument,label:string,selection:readonly string[]):ApplySessionCommand{
  if(before.id!==after.id)fail('commands must preserve the project identity');
  const changes:SessionValueChange[]=[];
  function visit(a:unknown,b:unknown,path:string[]){
    if(sameSessionValue(a,b))return;
    if(object(a)&&object(b)&&path.length<128){
      for(const key of new Set([...Object.keys(a),...Object.keys(b)]))visit(Object.hasOwn(a,key)?a[key]:undefined,Object.hasOwn(b,key)?b[key]:undefined,[...path,key]);
      return;
    }
    changes.push({path,before:storedValue(a),after:storedValue(b)});
  }
  visit(before,after,[]);
  // A sketch edit reads its joint relationships even when it does not write them.
  // Capture the before-context so accepted assembly edits can still replay their
  // coordinated sketch/joint changes, while newly attached joints make it stale.
  const sketchJoints=Object.entries(before.sketches??{})
    .filter(([id,sketch])=>!sameSessionValue(sketch,after.sketches?.[id]))
    .map(([sketchId])=>({sketchId,joints:sketchJointRelationships(before,sketchId)}));
  return {version:1,kind:'apply',projectId:before.id,label,changes,selection:[...selection],
    ...(sketchJoints.length?{context:{sketchJoints}}:{})};
}

function location(document:CadDocument,path:readonly string[]):{parent:Record<string,unknown>;key:string}{
  let parent:unknown=document;
  for(const key of path.slice(0,-1)){
    if(!object(parent)||!Object.hasOwn(parent,key))throw new Error(`Recorded command is stale at ${path.join('.')}`);
    parent=parent[key];
  }
  if(!object(parent))throw new Error(`Recorded command is stale at ${path.join('.')}`);
  return {parent,key:path[path.length-1]};
}

/** @internal Apply to a private candidate only, after checking every precondition. */
export function applyDocumentCommand(document:CadDocument,command:ApplySessionCommand):CadDocument{
  if(command.projectId!==document.id)throw new Error('Recorded command belongs to a different project');
  for(const entry of command.context?.sketchJoints??[]){
    if(!document.sketches||!Object.hasOwn(document.sketches,entry.sketchId)
      ||!sameSessionValue(sketchJointRelationships(document,entry.sketchId),entry.joints))
      throw new Error(`Recorded command is stale: joint relationships changed for sketch ${entry.sketchId}`);
  }
  for(const change of command.changes){
    const {parent,key}=location(document,change.path),current=Object.hasOwn(parent,key)?parent[key]:undefined;
    if(change.before.present?current===undefined||!sameSessionValue(current,change.before.value):current!==undefined)
      throw new Error(`Recorded command is stale at ${change.path.join('.')}`);
  }
  const candidate=structuredClone(document);
  for(const change of command.changes){
    const {parent,key}=location(candidate,change.path);
    if(change.after.present)Object.defineProperty(parent,key,{value:structuredClone(change.after.value),enumerable:true,writable:true,configurable:true});
    else delete parent[key];
  }
  if(candidate.id!==document.id)fail('commands must preserve the project identity');
  if(!object(candidate.nodes)||!command.selection.every(id=>Object.hasOwn(candidate.nodes,id)))fail('selection refers to a missing object');
  return candidate;
}

/** @internal Observers share immutable data, never live model references. */
export function sessionCommandRecord(command:SessionCommand,summary:string):SessionCommandRecord{
  const text=serializeSessionCommand(command);
  function freeze(value:unknown){
    if(!value||typeof value!=='object'||Object.isFrozen(value))return;
    Object.freeze(value);for(const item of Object.values(value))freeze(item);
  }
  freeze(command);
  return Object.freeze({command,text,summary});
}
