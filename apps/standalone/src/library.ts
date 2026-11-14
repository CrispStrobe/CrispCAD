import {t} from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession,parseDocument} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {appendPortableRevision} from '@brickwright/cad-history';
import {historyStore} from './project-store.js';
import {download} from './files.js';
export interface LibrarySettings {path:string;native:boolean}
type Request={action:string;id?:string;name?:string;data?:string};
function bridge(){return (window.webkit?.messageHandlers as unknown as {cadLibrary?:{postMessage(request:Request):Promise<unknown>}}|undefined)?.cadLibrary;}
async function native<T>(request:Request):Promise<T>{const handler=bridge();if(!handler)throw new Error(t('Native library folders are available in the macOS app'));return await handler.postMessage(request) as T;}
const bytes=(base64:string)=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
function base64(data:Uint8Array){let text='';for(let i=0;i<data.length;i+=16384)text+=String.fromCharCode(...data.subarray(i,i+16384));return btoa(text);}
export async function getLibrarySettings():Promise<LibrarySettings>{return bridge()?{...await native<{path:string}>({action:'settings'}),native:true}:{path:t('On this device · browser/app storage'),native:false};}
export async function chooseLibraryFolder(){const result=await native<{path:string;canceled?:boolean}>({action:'choose-folder'});if(!result.canceled){await recoverLibrary();const store=await historyStore;for(const project of await store.listProjects({includeTrashed:true}))await enqueueMirror(project.id);}return result;}
export async function recoverLibrary(){
 if(!bridge())return;const store=await historyStore;const files=await native<{name:string;id:string}[]>({action:'list'});
 // The canonical autosave wins over older exported copies with the same identity.
 files.sort((a,b)=>Number(b.name===b.id+'.bcad')-Number(a.name===a.id+'.bcad'));
 for(const file of files){if(await store.getProject(file.id))continue;const data=bytes(await native<string>({action:'read',name:file.name}));const metadata=JSON.parse(new TextDecoder().decode(data));if(metadata.format==='brickwright-cad-history')await store.importArchive(data,{preserveIdentity:true});}
}
export async function decodeProject(data:Uint8Array):Promise<CadDocument>{
 const text=new TextDecoder().decode(data),value=JSON.parse(text);
 if(value.format!=='brickwright-cad-history')return parseDocument(text);
 const store=await historyStore,project=await store.importArchive(data);return store.readDocument(project.headId);
}
export async function saveProject(doc:CadDocument){const store=await historyStore;await store.append(doc,'Saved project');await store.flush();const data=await store.exportArchive(doc.id);await download({name:`${doc.title.replace(/[^a-zA-Z0-9 _-]/g,'-')}.bcad`,bytes:data,mime:'application/vnd.brickwright.cad+json'});}
const timers=new Map<string,ReturnType<typeof setTimeout>>();let queue:Promise<void>=Promise.resolve();
function enqueueMirror(id:string){queue=queue.catch(()=>{}).then(()=>mirror(id));return queue;}
export async function initializeLibrary(){if(!bridge())return;queue=queue.catch(()=>{}).then(async()=>{await recoverLibrary();const store=await historyStore;await store.flush();for(const project of await store.listProjects({includeTrashed:true}))await mirror(project.id);});await queue;}
async function mirror(id:string){if(!bridge())return;const store=await historyStore;const data=await store.exportArchive(id);await native({action:'write',id,data:base64(data)});}
export function scheduleLibrarySave(id:string,onError:(error:unknown)=>void){
 if(!bridge())return;const previous=timers.get(id);if(previous)clearTimeout(previous);
 timers.set(id,setTimeout(()=>{timers.delete(id);void enqueueMirror(id).catch(onError);},800));
}
export async function flushLibrary(){const ids=[...timers.keys()];for(const timer of timers.values())clearTimeout(timer);timers.clear();const previous=queue,pending=ids.map(id=>enqueueMirror(id));await Promise.all([previous,...pending]);}

/** Import into the library as a separate project; never replace an existing journal. */
export async function importLibraryProject(data:Uint8Array){
 const value=JSON.parse(new TextDecoder().decode(data)),store=await historyStore;
 const archive=value.format==='brickwright-cad-history'?data:await appendPortableRevision(undefined,parseDocument(new TextDecoder().decode(data)),'Imported project');
 const project=await store.importArchive(archive);await enqueueMirror(project.id);return project;
}
export async function exportLibraryProject(id:string){const store=await historyStore;await store.flush();const project=await store.getProject(id);if(!project)throw new Error(t('Saved project is missing'));await download({name:`${project.title.replace(/[^a-zA-Z0-9 _-]/g,'-')}.bcad`,bytes:await store.exportArchive(id),mime:'application/vnd.brickwright.cad+json'});}
export async function duplicateLibraryProject(id:string){const store=await historyStore,copy=await store.importArchive(await store.exportArchive(id)),session=createCadSession(await store.readDocument(copy.headId));try{const suffix=t(' copy');session.rename(session.state.document.title.slice(0,160-suffix.length)+suffix);await store.append(session.state.document,'Duplicate project');}finally{session.dispose();}await enqueueMirror(copy.id);return copy;}
export async function renameLibraryProject(id:string,title:string){const store=await historyStore,project=await store.getProject(id);if(!project||project.trashedAt)throw new Error(t('Saved project is missing'));const session=createCadSession(await store.readDocument(project.headId));try{session.rename(title);await store.append(session.state.document,'Rename project');}finally{session.dispose();}await enqueueMirror(id);}
export async function setLibraryProjectTrashed(id:string,trashed:boolean){await flushLibrary();const store=await historyStore;await store.setProjectTrashed(id,trashed);await enqueueMirror(id);}
