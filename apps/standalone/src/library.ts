import {t} from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
import {parseDocument} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {historyStore} from './project-store.js';
import {download} from './files.js';
export interface LibrarySettings {path:string;native:boolean}
type Request={action:string;id?:string;name?:string;data?:string};
function bridge(){return (window.webkit?.messageHandlers as unknown as {cadLibrary?:{postMessage(request:Request):Promise<unknown>}}|undefined)?.cadLibrary;}
async function native<T>(request:Request):Promise<T>{const handler=bridge();if(!handler)throw new Error(t('Native library folders are available in the macOS app'));return await handler.postMessage(request) as T;}
const bytes=(base64:string)=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
function base64(data:Uint8Array){let text='';for(let i=0;i<data.length;i+=16384)text+=String.fromCharCode(...data.subarray(i,i+16384));return btoa(text);}
export async function getLibrarySettings():Promise<LibrarySettings>{return bridge()?{...await native<{path:string}>({action:'settings'}),native:true}:{path:t('On this device · browser/app storage'),native:false};}
export async function chooseLibraryFolder(){const result=await native<{path:string;canceled?:boolean}>({action:'choose-folder'});if(!result.canceled){await recoverLibrary();const store=await historyStore;for(const project of await store.listProjects())await mirror(project.id);}return result;}
export async function recoverLibrary(){
 if(!bridge())return;const store=await historyStore;const files=await native<{name:string;id:string}[]>({action:'list'});
 for(const file of files){if(await store.getProject(file.id))continue;const data=bytes(await native<string>({action:'read',name:file.name}));const metadata=JSON.parse(new TextDecoder().decode(data));if(metadata.format==='brickwright-cad-history')await store.importArchive(data,{preserveIdentity:true});}
}
export async function decodeProject(data:Uint8Array):Promise<CadDocument>{
 const text=new TextDecoder().decode(data),value=JSON.parse(text);
 if(value.format!=='brickwright-cad-history')return parseDocument(text);
 const store=await historyStore,project=await store.importArchive(data);return store.readDocument(project.headId);
}
export async function saveProject(doc:CadDocument){const store=await historyStore;await store.append(doc,'Saved project');await store.flush();const data=await store.exportArchive(doc.id);await download({name:`${doc.title.replace(/[^a-zA-Z0-9 _-]/g,'-')}.bcad`,bytes:data,mime:'application/vnd.brickwright.cad+json'});}
const timers=new Map<string,ReturnType<typeof setTimeout>>();let queue:Promise<void>=Promise.resolve();
export async function initializeLibrary(){if(!bridge())return;queue=queue.catch(()=>{}).then(async()=>{await recoverLibrary();const store=await historyStore;await store.flush();for(const project of await store.listProjects())await mirror(project.id);});await queue;}
async function mirror(id:string){if(!bridge())return;const store=await historyStore;const data=await store.exportArchive(id);await native({action:'write',id,data:base64(data)});}
export function scheduleLibrarySave(id:string,onError:(error:unknown)=>void){
 if(!bridge())return;const previous=timers.get(id);if(previous)clearTimeout(previous);
 timers.set(id,setTimeout(()=>{timers.delete(id);queue=queue.catch(()=>{}).then(()=>mirror(id));void queue.catch(onError);},800));
}
export async function flushLibrary(){const ids=[...timers.keys()];for(const timer of timers.values())clearTimeout(timer);timers.clear();await queue;for(const id of ids)await mirror(id);}
