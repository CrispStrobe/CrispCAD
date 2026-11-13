// SPDX-License-Identifier: BSD-3-Clause
import { validateDocument, newId, sha256Hex } from '@brickwright/cad-core';
import type { CadDocument, SolidNode } from '@brickwright/cad-core';
export interface ModelRevision {id:string;projectId:string;parentId:string|null;serial:number;createdAt:number;label:string;header:Omit<CadDocument,'nodes'>;nodeRefs:Record<string,string>;snapshotHash:string}
export interface ModelProject {id:string;title:string;headId:string;serial:number;updatedAt:number}
interface ContentObject {hash:string;kind:'node'|'mesh';value:string}
interface Archive {format:'brickwright-cad-history';version:1;project:ModelProject;revisions:ModelRevision[];objects:ContentObject[]}
const ARCHIVE_LIMIT=64*1024*1024;
const request=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error??new Error('History request failed'));});
const complete=(tx:IDBTransaction)=>new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error??new Error('History transaction failed'));});
const hash=(text:string)=>sha256Hex(new TextEncoder().encode(text));
const contentHash=(kind:'node'|'mesh',value:string)=>hash(kind+'\0'+value);
const projectRange=(id:string,before=Number.MAX_SAFE_INTEGER)=>IDBKeyRange.bound([id,0],[id,before],false,true);
async function encode(input:CadDocument){
 const doc=validateDocument(input),objects=new Map<string,ContentObject>(),nodeRefs:Record<string,string>={};
 for(const [id,node] of Object.entries(doc.nodes)){
  let stored:unknown=node;
  if(node.kind==='mesh'){const value=JSON.stringify({positions:node.positions,indices:node.indices}),asset=await contentHash('mesh',value);objects.set(asset,{hash:asset,kind:'mesh',value});const {positions,indices,...metadata}=node;stored={...metadata,meshAsset:asset};}
  const value=JSON.stringify(stored),key=await contentHash('node',value);objects.set(key,{hash:key,kind:'node',value});nodeRefs[id]=key;
 }
 const {nodes,...header}=doc;return {header,nodeRefs,objects:[...objects.values()],snapshotHash:await hash(JSON.stringify([header,nodeRefs]))};
}
function decode(revision:ModelRevision,objects:ReadonlyMap<string,ContentObject>):CadDocument{
 const nodes:Record<string,SolidNode>=Object.create(null);
 for(const [id,key] of Object.entries(revision.nodeRefs)){const object=objects.get(key);if(!object||object.kind!=='node')throw new Error('History node is missing');const stored=JSON.parse(object.value);if(stored.kind==='mesh'){const asset=objects.get(stored.meshAsset);if(!asset||asset.kind!=='mesh')throw new Error('History mesh data is missing');const {meshAsset,...node}=stored;nodes[id]={...node,...JSON.parse(asset.value)};}else nodes[id]=stored;}
 return validateDocument({...revision.header,nodes});
}
/** Validate the same archive contract for browser and headless hosts. */
async function readArchiveContent(bytes:Uint8Array){
   if(bytes.byteLength>ARCHIVE_LIMIT)throw new Error('History backup exceeds 64 MiB');const archive=JSON.parse(new TextDecoder().decode(bytes)) as Archive;
   if(archive?.format!=='brickwright-cad-history'||archive.version!==1||!archive.project||!Array.isArray(archive.objects)||!Array.isArray(archive.revisions)||!archive.revisions.length)throw new Error('Unsupported history backup');
   const objects=new Map<string,ContentObject>();for(const object of archive.objects){if(!object||!['node','mesh'].includes(object.kind)||typeof object.value!=='string'||object.hash!==await contentHash(object.kind,object.value)||objects.has(object.hash))throw new Error('History content hash is invalid');objects.set(object.hash,object);}
   const ids=new Set<string>(),serials=new Set<number>();for(const r of archive.revisions){if(!r||typeof r.id!=='string'||ids.has(r.id)||r.projectId!==archive.project.id||!Number.isSafeInteger(r.serial)||r.serial<1||serials.has(r.serial)||!Number.isFinite(r.createdAt)||typeof r.label!=='string'||r.label.length>160)throw new Error('History revision metadata is invalid');ids.add(r.id);serials.add(r.serial);const doc=decode(r,objects);if(doc.id!==archive.project.id||r.snapshotHash!==await hash(JSON.stringify([r.header,r.nodeRefs])))throw new Error('History snapshot is corrupt');}
   const byId=new Map(archive.revisions.map(r=>[r.id,r]));for(const r of archive.revisions)if(r.parentId!==null&&(!byId.has(r.parentId)||byId.get(r.parentId)!.serial>=r.serial))throw new Error('History ancestry is invalid');const oldHead=byId.get(archive.project.headId);if(!oldHead)throw new Error('History head is missing');
   return {archive,objects,oldHead};
}
/** Lazy snapshot access avoids expanding shared mesh assets for every revision. */
export async function readPortableHistory(bytes:Uint8Array){
 const {archive,objects,oldHead}=await readArchiveContent(bytes),byId=new Map(archive.revisions.map(r=>[r.id,r]));
 const project:ModelProject={id:oldHead.projectId,title:oldHead.header.title,headId:oldHead.id,serial:archive.revisions.reduce((max,r)=>Math.max(max,r.serial),0),updatedAt:oldHead.createdAt};
 return {project,revisions:structuredClone(archive.revisions),readDocument(id:string){const revision=byId.get(id);if(!revision)throw new Error('History revision not found');return decode(revision,objects);}};
}
/** Append one accepted edit without rewriting or removing any old revision. */
export async function appendPortableRevision(previous:Uint8Array|undefined,document:CadDocument,label:string,parentId?:string):Promise<Uint8Array>{
 if(typeof label!=='string'||!label.trim()||label.length>160)throw new Error('Invalid history label');
 const old=previous?await readArchiveContent(previous):undefined,doc=validateDocument(document);
 if(old&&old.archive.project.id!==doc.id)throw new Error('Cannot append another model to this history');
 const serial=(old?.archive.revisions.reduce((n,r)=>Math.max(n,r.serial),0)??0)+1;if(!Number.isSafeInteger(serial))throw new Error('History serial exceeds supported range');
 const parent=parentId??old?.archive.project.headId??null;if(parent!==null&&!old?.archive.revisions.some(r=>r.id===parent))throw new Error('History parent is missing');
 const encoded=await encode(doc),objects=new Map(old?.objects??[]);for(const record of encoded.objects)objects.set(record.hash,record);
 const {header,nodeRefs,snapshotHash}=encoded,revision:ModelRevision={id:newId(),projectId:doc.id,parentId:parent,serial,createdAt:Date.now(),label,header,nodeRefs,snapshotHash};
 const archive:Archive={format:'brickwright-cad-history',version:1,project:{id:doc.id,title:doc.title,headId:revision.id,serial,updatedAt:revision.createdAt},revisions:[...(old?.archive.revisions??[]),revision],objects:[...objects.values()]};
 const result=new TextEncoder().encode(JSON.stringify(archive));if(result.byteLength>ARCHIVE_LIMIT)throw new Error('History backup exceeds 64 MiB. No revisions were removed.');return result;
}
/** Append-only revision journal. No retention count, expiry or automatic pruning.
 * Native/Tauri hosts may implement the same API over a file/object store. */
export async function openHistoryStore(name='brickwright-cad-history-v1'){
 if(!globalThis.indexedDB)throw new Error('Persistent model history is unavailable in this environment');
 const opening=indexedDB.open(name,1);opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore('objects',{keyPath:'hash'});const revisions=db.createObjectStore('revisions',{keyPath:'id'});revisions.createIndex('byProject',['projectId','serial'],{unique:true});const projects=db.createObjectStore('projects',{keyPath:'id'});projects.createIndex('updatedAt','updatedAt');};
 const db=await request(opening);
 const write=(stores:string[])=>{try{return db.transaction(stores,'readwrite',{durability:'strict'});}catch{return db.transaction(stores,'readwrite');}};let queue:Promise<unknown>=Promise.resolve(),closed=false;db.onversionchange=()=>{closed=true;db.close();};
 const ensure=()=>{if(closed)throw new Error('History store is closed');};
 const serial=<T>(operation:()=>Promise<T>)=>{ensure();const run=queue.then(operation);queue=run.catch(()=>{});return run;};
 async function getRevision(id:string){ensure();const tx=db.transaction('revisions','readonly');const found=await request<ModelRevision|undefined>(tx.objectStore('revisions').get(id));if(!found)throw new Error('Saved revision was not found');return found;}
 async function readDocument(id:string){const revision=await getRevision(id);const tx=db.transaction('objects','readonly'),store=tx.objectStore('objects');const records=await Promise.all(Object.values(revision.nodeRefs).map(key=>request<ContentObject|undefined>(store.get(key))));const objects=new Map(records.filter((r):r is ContentObject=>!!r).map(r=>[r.hash,r]));const meshes=[...objects.values()].flatMap(r=>{const n=JSON.parse(r.value);return n.kind==='mesh'?[n.meshAsset as string]:[];});if(meshes.length){const t=db.transaction('objects','readonly');const assets=await Promise.all(meshes.map(key=>request<ContentObject|undefined>(t.objectStore('objects').get(key))));for(const asset of assets)if(asset)objects.set(asset.hash,asset);}return decode(revision,objects);}
 return {
  append(input:CadDocument,label='Edit',parentId?:string|null){const snapshot=validateDocument(input);return serial(async()=>{const encoded=await encode(snapshot);return new Promise<ModelRevision>((resolve,reject)=>{
   const tx=write(['projects','revisions','objects']);let saved:ModelRevision|undefined;tx.oncomplete=()=>saved?resolve(saved):reject(new Error('Revision was not committed'));tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Revision save failed'));
   const projects=tx.objectStore('projects'),revisions=tx.objectStore('revisions'),objects=tx.objectStore('objects');
   const head=projects.get(snapshot.id);head.onsuccess=()=>{const project=head.result as ModelProject|undefined;const commit=(parent:ModelRevision|undefined)=>{
    if(parentId===undefined&&parent?.snapshotHash===encoded.snapshotHash){saved=parent;return;}
    const serial=(project?.serial??0)+1;saved={id:newId(),projectId:snapshot.id,parentId:parent?.id??null,serial,createdAt:Date.now(),label:label.trim().slice(0,160)||'Edit',header:encoded.header,nodeRefs:encoded.nodeRefs,snapshotHash:encoded.snapshotHash};
    for(const object of encoded.objects){const existing=objects.get(object.hash);existing.onsuccess=()=>{if(!existing.result)objects.add(object);};}
    revisions.add(saved);projects.put({id:snapshot.id,title:snapshot.title,headId:saved.id,serial,updatedAt:saved.createdAt} satisfies ModelProject);
   };const parent=parentId===undefined?project?.headId:parentId;if(parent){const existing=revisions.get(parent);existing.onsuccess=()=>{const record=existing.result as ModelRevision|undefined;if(!record||record.projectId!==snapshot.id){tx.abort();return;}commit(record);};}else commit(undefined);};
  });});},
  getRevision,readDocument,
  async getProject(id:string){ensure();const tx=db.transaction('projects','readonly');return await request<ModelProject|undefined>(tx.objectStore('projects').get(id));},
  async listProjects(){ensure();const tx=db.transaction('projects','readonly');const records=await request<ModelProject[]>(tx.objectStore('projects').getAll());return records.sort((a,b)=>b.updatedAt-a.updatedAt);},
  async listRevisions(projectId:string,options:{beforeSerial?:number;limit?:number}={}){ensure();const limit=options.limit??50;if(!Number.isInteger(limit)||limit<1||limit>200)throw new Error('Invalid history page size');const tx=db.transaction('revisions','readonly');const cursor=tx.objectStore('revisions').index('byProject').openCursor(projectRange(projectId,options.beforeSerial),'prev');return await new Promise<ModelRevision[]>((resolve,reject)=>{const records:ModelRevision[]=[];cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const row=cursor.result;if(!row||records.length>=limit){resolve(records);return;}records.push(row.value);row.continue();};});},
  async exportArchive(projectId:string){ensure();await queue;const tx=db.transaction(['projects','revisions'],'readonly');const [project,revisions]=await Promise.all([request<ModelProject|undefined>(tx.objectStore('projects').get(projectId)),request<ModelRevision[]>(tx.objectStore('revisions').index('byProject').getAll(projectRange(projectId)))]);if(!project)throw new Error('Model not found');const needed=new Set(revisions.flatMap(r=>Object.values(r.nodeRefs))),objects=new Map<string,ContentObject>();let bytes=0;const fetch=async(keys:string[])=>{const tx=db.transaction('objects','readonly');const records=await Promise.all(keys.map(key=>request<ContentObject|undefined>(tx.objectStore('objects').get(key))));for(const object of records){if(!object)throw new Error('History backup has missing content');bytes+=object.value.length*2;if(bytes>ARCHIVE_LIMIT)throw new Error('History is too large for this in-memory backup. No revisions were removed.');objects.set(object.hash,object);}};await fetch([...needed]);const assets=new Set([...objects.values()].flatMap(object=>{const n=JSON.parse(object.value);return n.kind==='mesh'?[n.meshAsset as string]:[];}));await fetch([...assets]);const archive:Archive={format:'brickwright-cad-history',version:1,project,revisions,objects:[...objects.values()]};const output=new TextEncoder().encode(JSON.stringify(archive));if(output.length>ARCHIVE_LIMIT)throw new Error('History backup exceeds 64 MiB. No revisions were removed.');return output;},
  importArchive(bytes:Uint8Array,options:{preserveIdentity?:boolean}={}){return serial(async()=>{
   const {archive,objects,oldHead}=await readArchiveContent(bytes);
   // Import as a new model: an old backup can never overwrite current history.
   const projectId=options.preserveIdentity?archive.project.id:newId();
   if(options.preserveIdentity&&await request(db.transaction('projects').objectStore('projects').get(projectId)))throw new Error('This model already exists; refusing to replace its history');
   const remap=new Map(archive.revisions.map(r=>[r.id,options.preserveIdentity?r.id:newId()]));const revisions:ModelRevision[]=[];for(const original of archive.revisions){const header={...original.header,id:projectId};revisions.push({...original,id:remap.get(original.id)!,projectId,parentId:original.parentId?remap.get(original.parentId)!:null,header,snapshotHash:await hash(JSON.stringify([header,original.nodeRefs]))});}
   const project:ModelProject={id:projectId,title:oldHead.header.title,headId:remap.get(oldHead.id)!,serial:revisions.reduce((max,r)=>Math.max(max,r.serial),0),updatedAt:Date.now()};
   const tx=write(['projects','revisions','objects']);const done=complete(tx);for(const object of objects.values())tx.objectStore('objects').put(object);for(const revision of revisions)tx.objectStore('revisions').add(revision);tx.objectStore('projects').add(project);await done;return project;
  });},
  async flush(){await queue;},
  async close(){if(closed)return;closed=true;await queue;db.close();},
 };
}
export type HistoryStore=Awaited<ReturnType<typeof openHistoryStore>>;
