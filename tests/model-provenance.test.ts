// SPDX-License-Identifier: BSD-3-Clause
import 'fake-indexeddb/auto';
import {describe,it,expect} from 'vitest';
import {createCadSession,createDocument,documentGeometryKey,parseDocument,validateDocument} from '@brickwright/cad-core';
import type {ModelProvenanceRecord} from '@brickwright/cad-core';
import {appendPortableRevision,readPortableHistory,openHistoryStore} from '../packages/history/src/index.js';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
function record(id='source'):ModelProvenanceRecord {
 const file={url:'https://example.org/block.stl',format:'stl',sha256:'a'.repeat(64),bytes:684};
 return {id,selectedFile:{...file},modificationNotes:'Imported without geometric changes.',asset:{id:'block',version:'1',title:'Block',author:'Creator',sourceUrl:'https://example.org/block',sourceRevision:{repositoryUrl:'https://example.org/repo',commit:'b'.repeat(40)},licence:{spdx:'CC-BY-4.0',scope:'asset',attribution:'Creator, Block, CC-BY-4.0',evidenceUrl:'https://example.org/grant',capturedOn:'2026-11-13',review:'accepted',reviewer:'Curator'},original:{...file},derivatives:[],modificationNotes:'Unchanged original.',conversion:{sourceUnits:'mm',unitAssumption:'Explicit source units.',sourceUpAxis:'Z',toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}}};
}
function attributed(){const s=createCadSession();const id=s.add({kind:'box',size:[10,10,10]});s.attachProvenance([id],record());return {s,id};}
describe('retained project model provenance',()=>{
 it('opens old documents unchanged, requires v5 for metadata, and records immutable snapshots atomically',()=>{
  for(const version of [1,2,3,4] as const){const doc={...createDocument(),version};expect(parseDocument(JSON.stringify(doc))).toEqual(doc);}
  const s=createCadSession(),id=s.add({kind:'box',size:[10,10,10]}),before=s.serialize(),key=documentGeometryKey(s.state.document),source=record();
  s.attachProvenance([id],source);source.asset.author='Changed externally';expect(s.state.document.version).toBe(5);expect(s.state.document.provenance!.records[0].asset.author).toBe('Creator');expect(documentGeometryKey(s.state.document)).toBe(key);
  const after=s.serialize();s.attachProvenance([id],record());expect(s.serialize()).toBe(after);s.undo();expect(s.serialize()).toBe(before);s.redo();expect(s.serialize()).toBe(after);
  for(const version of [1,2,3,4] as const){const opaque={...s.state.document,version};expect(validateDocument(opaque)).toEqual(opaque);expect(()=>createCadSession(opaque).attachProvenance([id],record())).toThrow('legacy opaque');}
 });
 it('preserves formerly opaque extension fields in old documents without interpreting them',async()=>{
  for(const version of [1,2,3,4] as const){
   const original=createCadSession();const id=original.add({kind:'box',size:[10,10,10]});
   const doc=JSON.parse(original.serialize());doc.version=version;doc.provenance={custom:'legacy document field'};doc.nodes[id].provenance={custom:'legacy node field'};
   expect(parseDocument(JSON.stringify(doc))).toEqual(doc);const s=createCadSession(doc);s.rename('Legacy edit');s.transform([{id,transform:{position:[3,0,0],rotation:[0,0,0],scale:[1,1,1]}}]);
   expect(s.state.document.provenance).toEqual(doc.provenance);expect(s.state.document.nodes[id].provenance).toEqual(doc.nodes[id].provenance);expect(s.fragment([id]).provenance).toEqual(doc.provenance);
   s.duplicate([id]);expect(s.state.document.nodes[s.state.document.roots[1]].provenance).toEqual(doc.nodes[id].provenance);s.remove([id]);expect(s.state.document.provenance).toEqual(doc.provenance);
   const archived=await appendPortableRevision(undefined,doc,'Legacy');const journal=await readPortableHistory(archived);expect(journal.readDocument(journal.revisions[0].id)).toEqual(doc);
   const attributedDoc=attributed().s.state.document,before=s.serialize();expect(()=>s.insert(attributedDoc)).toThrow('legacy opaque');expect(s.serialize()).toBe(before);expect(()=>createCadSession(attributedDoc).insert(doc)).toThrow('legacy opaque');
   const legacyReplacement=structuredClone(doc);delete legacyReplacement.provenance;expect(()=>createCadSession(attributedDoc).replaceGenerated(attributedDoc.roots[0],legacyReplacement)).toThrow('legacy opaque');
  }
 });
 it('rejects malformed snapshots and links without changing live state or history',()=>{
  const {s,id}=attributed(),before=s.serialize(),revision=s.state.revision;
  const bad=record('other');bad.selectedFile.sha256='f'.repeat(64);expect(()=>s.attachProvenance([id],bad)).toThrow('selected file');
  const conflict=record();conflict.asset.author='Other';expect(()=>s.attachProvenance([id],conflict)).toThrow('different metadata');
  expect(()=>s.update(id,{provenance:[]})).toThrow('attachProvenance');expect(s.serialize()).toBe(before);expect(s.state.revision).toBe(revision);
  const mutations:((d:any)=>void)[]=[d=>delete d.provenance,d=>d.nodes[id].provenance=['missing'],d=>d.nodes[id].provenance=['source','source'],d=>d.provenance.version=2,d=>d.provenance.records.push(record('unused')),d=>d.provenance.records[0].asset.licence.spdx='CC-BY-NC-4.0',d=>d.provenance.records[0].extra=true];
  for(const mutate of mutations){const doc=JSON.parse(before);mutate(doc);expect(()=>validateDocument(doc)).toThrow('provenance');}
 });
 it('retains sources through boolean edits, duplication, selection copy, paste collisions, separation and deletion',()=>{
  const {s,id}=attributed();s.transform([{id,transform:{position:[2,0,0],rotation:[0,0,15],scale:[1,1,1]}}]);s.update(id,{name:'Moved source'});expect(s.state.document.nodes[id].provenance).toEqual(['source']);const other=s.add({kind:'sphere',radius:5,segments:24});const combined=s.combine('union',[id,other]);s.attachProvenance([combined],record('operation'));
  s.duplicate([combined]);const copy=s.state.document.roots[1];const fragment=s.fragment([copy]);expect(fragment.provenance!.records.map(r=>r.id)).toEqual(['source','operation']);
  s.insert(fragment);const pasted=s.state.document.roots[2];expect(s.state.document.provenance!.records).toHaveLength(4);expect(s.state.document.nodes[pasted].provenance![0]).not.toBe('operation');
  s.separate(combined);expect(s.state.document.nodes[id].provenance).toEqual(['source','operation']);expect(s.state.document.nodes[other].provenance).toEqual(['operation']);
  s.remove([id,other,copy]);expect(s.state.document.provenance!.records).toHaveLength(2);expect(s.fragment([pasted]).provenance!.records).toHaveLength(2);
  const before=s.serialize();s.remove([pasted]);expect(s.state.document.provenance!.records).toEqual([]);s.undo();expect(s.serialize()).toBe(before);
 });
 it('keeps descendant provenance when regenerating and never downgrades attributed code projects',()=>{
  const s=createCadSession(createPresetDocument('screw')),root=s.state.document.roots[0],child=Object.keys(s.state.document.nodes).find(id=>id!==root)!;
  s.attachProvenance([child],record());s.replaceGenerated(root,createPresetDocument('screw'));expect(s.state.document.nodes[root].provenance).toEqual(['source']);expect(s.state.document.provenance!.records[0]).toEqual(record());
  const blocked=s.fragment([root]),before=s.serialize();expect(()=>s.replaceGenerated(root,blocked)).toThrow('Expected one generated body');expect(s.serialize()).toBe(before);
  s.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:'return box(10, 10, 10);'});expect(s.state.document.version).toBe(5);expect(parseDocument(s.serialize()).provenance!.records).toHaveLength(1);
 });
 it('preserves every old and attributed revision across portable and database archives, restore and branch',async()=>{
  const s=createCadSession(),id=s.add({kind:'box',size:[10,10,10]}),old=structuredClone(s.state.document);
  const first=await appendPortableRevision(undefined,old,'Original');s.attachProvenance([id],record());const attributed=structuredClone(s.state.document);
  const second=await appendPortableRevision(first,attributed,'Sources');s.update(id,{name:'Edited'});const third=await appendPortableRevision(second,s.state.document,'Edit');const history=await readPortableHistory(third);
  expect(history.revisions).toHaveLength(3);expect(history.readDocument(history.revisions[0].id)).toEqual(old);expect(history.readDocument(history.revisions[1].id)).toEqual(attributed);
  const store=await openHistoryStore(`provenance-${crypto.randomUUID()}`),project=await store.importArchive(third,{preserveIdentity:true});const revisions=await store.listRevisions(project.id);const branch=await store.append(await store.readDocument(revisions[1].id),'Restore sources',revisions[1].id);
  expect(branch.serial).toBe(4);expect((await store.readDocument(revisions[0].id)).nodes[id].name).toBe('Edited');expect((await store.readDocument(revisions[2].id))).toEqual(old);
  const archive=await store.exportArchive(project.id);const recovered=await readPortableHistory(archive);expect(recovered.revisions).toHaveLength(4);expect(recovered.readDocument(branch.id).provenance).toEqual(attributed.provenance);await store.close();
 });
});
