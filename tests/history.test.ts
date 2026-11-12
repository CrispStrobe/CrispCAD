import 'fake-indexeddb/auto';
import {describe,it,expect,vi} from 'vitest';
import {openHistoryStore} from '../packages/history/src/index.js';
import {createCadSession} from '@brickwright/cad-core';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
describe('persistent model revisions',()=>{
 it('retains more than the undo limit, shares mesh assets, and branches without erasing later iterations',async()=>{
  const name=`history-${crypto.randomUUID()}`,store=await openHistoryStore(name),session=createCadSession(createPresetDocument('wedge'));const id=session.state.document.roots[0];const first=await store.append(session.state.document,'First');let latest=first;
  for(let i=1;i<=130;i++){session.update(id,{transform:{position:[i,0,0],rotation:[0,0,0],scale:[1,1,1]}});latest=await store.append(session.state.document,`Move ${i}`);}
  expect(latest.serial).toBe(131);expect((await store.readDocument(first.id)).nodes[id].transform.position[0]).toBe(0);
  const restored=await store.append(await store.readDocument(first.id),'Restore first',first.id);expect(restored.parentId).toBe(first.id);expect(restored.serial).toBe(132);expect((await store.readDocument(latest.id)).nodes[id].transform.position[0]).toBe(130);
  const archive=JSON.parse(new TextDecoder().decode(await store.exportArchive(session.state.document.id)));expect(archive.revisions).toHaveLength(132);expect(archive.objects.filter((o:any)=>o.kind==='mesh')).toHaveLength(1);
  expect(await store.listRevisions(session.state.document.id)).toHaveLength(50);expect((await store.listRevisions(session.state.document.id,{beforeSerial:83}))[0].serial).toBe(82);
  await store.close();const reopened=await openHistoryStore(name);expect((await reopened.readDocument(first.id)).nodes[id].transform.position[0]).toBe(0);await reopened.close();
 });
 it('portable backups preserve ancestry and import into a separate model; corrupt imports do not change the journal',async()=>{
  const store=await openHistoryStore(`history-${crypto.randomUUID()}`),s=createCadSession();s.add({kind:'box',size:[10,20,30]});const a=await store.append(s.state.document,'Base');s.rename('Changed');const b=await store.append(s.state.document,'Rename');const bytes=await store.exportArchive(s.state.document.id);const imported=await store.importArchive(bytes);expect(imported.id).not.toBe(s.state.document.id);const iterations=await store.listRevisions(imported.id);expect(iterations).toHaveLength(2);expect(iterations[0].parentId).toBe(iterations[1].id);expect((await store.readDocument(imported.headId)).title).toBe('Changed');expect((await store.getProject(s.state.document.id))?.headId).toBe(b.id);
  const bad=JSON.parse(new TextDecoder().decode(bytes));bad.objects[0].value+=' ';await expect(store.importArchive(new TextEncoder().encode(JSON.stringify(bad)))).rejects.toThrow('hash');expect(await store.listProjects()).toHaveLength(2);expect((await store.readDocument(a.id)).title).toBe('Untitled design');await store.close();
 });
 it('an aborted append leaves old revisions and head intact and permits a later retry',async()=>{
  const store=await openHistoryStore(`history-${crypto.randomUUID()}`),s=createCadSession();s.add({kind:'box',size:[10,10,10]});const a=await store.append(s.state.document);s.rename('Second');const spy=vi.spyOn(crypto,'randomUUID').mockReturnValue(a.id as `${string}-${string}-${string}-${string}-${string}`);await expect(store.append(s.state.document)).rejects.toBeTruthy();spy.mockRestore();expect((await store.getProject(s.state.document.id))?.headId).toBe(a.id);expect((await store.readDocument(a.id)).title).toBe('Untitled design');const retry=await store.append(s.state.document);expect(retry.serial).toBe(2);await store.close();
 });
 it('serializes concurrent writers through database transactions',async()=>{
  const name=`history-${crypto.randomUUID()}`,a=await openHistoryStore(name),b=await openHistoryStore(name),s=createCadSession();const first=s.state.document;const second={...first,title:'Second writer'};const revisions=await Promise.all([a.append(first),b.append(second)]);expect(revisions.map(r=>r.serial).sort()).toEqual([1,2]);expect(await a.listRevisions(first.id)).toHaveLength(2);await a.close();await b.close();
 });
});
