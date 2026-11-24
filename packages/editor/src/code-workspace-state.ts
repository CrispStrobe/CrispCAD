// SPDX-License-Identifier: BSD-3-Clause
import type {CodeProgram} from '@brickwright/cad-core';

/** Host-owned storage. Drafts never enter the CAD document or its Undo history. */
export interface CodeWorkspaceStorage {
 getItem(key:string):string|null;
 setItem(key:string,value:string):void;
}
export interface CodeWorkspaceDraft {
 projectId:string;
 targetId?:string;
 name:string;
 program:CodeProgram;
 /** The saved code from which this draft started; used to detect external edits. */
 baseline?:CodeProgram;
}
const storageKey='brickwright-cad:code-workspace:v1';
const maxDrafts=16,maxSourceBytes=32768,maxStoredCharacters=2_000_000;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256;
function readProgram(value:unknown):CodeProgram|undefined {
 if(!object(value)||value.version!==1||value.language!=='brickwright-cad-script'||typeof value.source!=='string'||new TextEncoder().encode(value.source).length>maxSourceBytes||!object(value.parameters))return;
 const entries=Object.entries(value.parameters);
 if(entries.length>256||entries.some(([key,text])=>!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)||['constructor','prototype','__proto__'].includes(key)||typeof text!=='string'||text.length>1024))return;
 return {version:1,language:'brickwright-cad-script',source:value.source,parameters:Object.fromEntries(entries) as Record<string,string>};
}
function readDraft(value:unknown):CodeWorkspaceDraft|undefined {
 if(!object(value)||!identifier(value.projectId)||value.targetId!==undefined&&!identifier(value.targetId)||typeof value.name!=='string'||value.name.length>2000)return;
 const program=readProgram(value.program),baseline=value.baseline===undefined?undefined:readProgram(value.baseline);
 if(!program||value.baseline!==undefined&&!baseline)return;
 return {projectId:value.projectId,...(typeof value.targetId==='string'?{targetId:value.targetId}:{}),name:value.name,program,...(baseline?{baseline}:{})};
}
const sameTarget=(a:Pick<CodeWorkspaceDraft,'projectId'|'targetId'>,projectId:string,targetId?:string)=>a.projectId===projectId&&a.targetId===targetId;

export function browserCodeWorkspaceStorage():CodeWorkspaceStorage|undefined {
 try{return typeof localStorage==='undefined'?undefined:localStorage;}catch{return;}
}

/** A bounded, defensive store; an unavailable host adapter still leaves in-session drafts. */
export function createCodeWorkspaceStore(storage?:CodeWorkspaceStorage) {
 type Change={projectId:string;targetId?:string;draft?:CodeWorkspaceDraft};
 let drafts:CodeWorkspaceDraft[]=[],pending:Change[]=[];
 function readStored():CodeWorkspaceDraft[]|null|undefined {
  if(!storage)return;
  let raw:string|null;
  try{raw=storage.getItem(storageKey);}catch{return;}
  if(!raw)return [];
  if(raw.length>maxStoredCharacters)return null;
  try{
   const parsed:unknown=JSON.parse(raw);
   if(object(parsed)&&parsed.version===1&&Array.isArray(parsed.drafts))return parsed.drafts.slice(-maxDrafts).flatMap(value=>{const draft=readDraft(value);return draft?[draft]:[];});
  }catch{/* Corrupt storage can be replaced by the next accepted draft. */}
  return null;
 }
 function applyChanges(current:CodeWorkspaceDraft[],changes:Change[]){
  for(const change of changes){
   current=current.filter(item=>!sameTarget(item,change.projectId,change.targetId));
   if(change.draft)current.push(change.draft);
  }
  return current.slice(-maxDrafts);
 }
 function refresh(){
  const stored=readStored();
  if(stored)drafts=applyChanges(stored,pending);
 }
 function remember(change:Change){
  pending=[...pending.filter(item=>!sameTarget(item,change.projectId,change.targetId)),change];
  drafts=applyChanges(drafts,[change]);
  // Evicted unsaved drafts must not grow an unbounded hidden source cache.
  pending=pending.filter(item=>!item.draft||drafts.some(draft=>sameTarget(draft,item.projectId,item.targetId)));
 }
 refresh();
 function persist(){
  if(!storage)return false;
  // Another editor/tab can have saved since this store was created. Merge only
  // this instance's outstanding changes into the latest saved collection.
  const stored=readStored();
  if(stored===undefined)return false;
  drafts=applyChanges(stored??drafts,pending);
  try{const encoded=JSON.stringify({version:1,drafts});if(encoded.length>maxStoredCharacters)return false;storage.setItem(storageKey,encoded);pending=[];return true;}catch{return false;}
 }
 return {
  load(projectId:string,targetId?:string){refresh();const found=[...drafts].reverse().find(draft=>sameTarget(draft,projectId,targetId));return found?structuredClone(found):undefined;},
  latest(projectId:string){refresh();const found=[...drafts].reverse().find(draft=>draft.projectId===projectId);return found?structuredClone(found):undefined;},
  save(value:CodeWorkspaceDraft){
   const draft=readDraft(value);
   if(!draft)return {accepted:false,persistent:false};
   remember({projectId:draft.projectId,targetId:draft.targetId,draft});
   return {accepted:true,persistent:persist()};
  },
  remove(projectId:string,targetId?:string){remember({projectId,targetId});persist();}
 };
}

/** Parameter completion also works while the rest of the source is unfinished. */
export function codeParameterCompletions(source:string,caret:number) {
 const position=Math.max(0,Math.min(source.length,caret));
 // Mask comments and text literals, retaining offsets and line breaks.
 let inIgnoredText=false;
 const masked=source.replace(/\/\/[^\n]*|"(?:\\.|[^"\\])*(?:"|$)/g,(match:string,offset:number)=>{if(position>offset&&position<=offset+match.length)inIgnoredText=true;return match.replace(/[^\n]/g,' ');});
 if(inIgnoredText)return {start:position,end:position,matches:[] as string[]};
 const prefix=masked.slice(0,position).match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0]??'';
 const suffix=masked.slice(position).match(/^[A-Za-z0-9_]*/)?.[0]??'';
 const names=[...masked.matchAll(/\bparam\s+([A-Za-z][A-Za-z0-9_]{0,39})\s*:/g)].map(match=>match[1]);
 return {start:position-prefix.length,end:position+suffix.length,matches:[...new Set(names)].filter(name=>name.startsWith(prefix)&&name!==prefix+suffix).sort()};
}
