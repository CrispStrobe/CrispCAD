// SPDX-License-Identifier: BSD-3-Clause
import {validateDocument} from './document.js';
import type {CadDocument} from './document.js';
import {sameModelValue} from './model-source.js';

type Slot=[]|[unknown];
type Change=[key:string,before:Slot,after:Slot];
export interface RecordedCadEdit {
  version:1; projectId:string; label:string; header:Change[]; nodes:Change[]; selection:string[];
}
const safeKey=(key:unknown):key is string=>typeof key==='string'&&key.length>0&&key.length<=160&&!['__proto__','prototype','constructor'].includes(key);
const slot=(record:Record<string,unknown>,key:string):Slot=>Object.hasOwn(record,key)&&record[key]!==undefined?[record[key]]:[];
function changes(before:Record<string,unknown>,after:Record<string,unknown>,skip:readonly string[]=[]):Change[]{
  return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>{
    if(skip.includes(key))return [];
    const a=slot(before,key),b=slot(after,key);
    return sameModelValue(a,b)?[]:[[key,a,b] as Change];
  });
}
/** The retained document is the authority. Serialize only changed fields and nodes,
 * including their preconditions, never transient geometry or localized action names. */
export function recordCadEdit(before:CadDocument,after:CadDocument,label:string,selection:readonly string[]):RecordedCadEdit{
  if(before.id!==after.id)throw new Error('A recorded edit must keep the project identity.');
  return {version:1,projectId:before.id,label,header:changes({...before},{...after},['nodes','id']),nodes:changes(before.nodes,after.nodes),selection:[...selection]};
}
function applyChanges(target:Record<string,unknown>,input:unknown,protectedKeys:readonly string[]){
  if(!Array.isArray(input)||input.length>4000)throw new Error('Invalid recorded edit changes.');
  const seen=new Set<string>();
  for(const item of input){
    if(!Array.isArray(item)||item.length!==3)throw new Error('Invalid recorded edit entry.');
    const [key,before,after]=item;
    if(!safeKey(key)||protectedKeys.includes(key)||seen.has(key)||!Array.isArray(before)||before.length>1||!Array.isArray(after)||after.length>1)
      throw new Error('Invalid or duplicate recorded edit field.');
    seen.add(key);
    if(!sameModelValue(slot(target,key),before))throw new Error('Recorded edit conflicts with the current model: '+key);
    if(after.length)Object.defineProperty(target,key,{value:structuredClone(after[0]),enumerable:true,writable:true,configurable:true});
    else delete target[key];
  }
}
/** Validate the entire candidate before changing the live session or its history. */
export function prepareRecordedCadEdit(current:CadDocument,value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid recorded edit.');
  const edit=value as Partial<RecordedCadEdit>;
  if(edit.version!==1||edit.projectId!==current.id||typeof edit.label!=='string'||!edit.label.trim()||edit.label.length>256||
      /[\u0000-\u001f]/.test(edit.label)||!Array.isArray(edit.selection)||edit.selection.length>2000||
      !edit.selection.every(id=>typeof id==='string')||new Set(edit.selection).size!==edit.selection.length)
    throw new Error('Invalid recorded edit or different project.');
  const candidate=structuredClone(current);
  applyChanges(candidate.nodes,edit.nodes,[]);
  applyChanges(candidate as unknown as Record<string,unknown>,edit.header,['id','nodes']);
  const document=validateDocument(candidate);
  if(!edit.selection.every(id=>Object.hasOwn(document.nodes,id)))throw new Error('Recorded selection does not exist.');
  return {document,label:edit.label,selection:[...edit.selection]};
}
