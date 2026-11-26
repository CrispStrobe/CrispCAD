// SPDX-License-Identifier: BSD-3-Clause
import {expect,it,vi} from 'vitest';
import {createCadSession,serializeDocument,pruneModelProvenance} from '@brickwright/cad-core';
import {createAtlasForkliftDocument} from '../packages/editor/src/atlas-forklift.js';
import {canAddRobotElectronics,addRobotElectronics} from '../packages/editor/src/robot-electronics.js';
// Manifold/Jolt suite: under a loaded machine (load ~150) its tests and hooks ran up to ~10x
// their idle time, past vitest's 5 s / 10 s defaults. Explicit per-test timeouts below still win.
vi.setConfig({testTimeout:60_000,hookTimeout:120_000});
function olderAtlas(){
 const d=createAtlasForkliftDocument();for(const id of Object.keys(d.nodes))if(id.startsWith('electronics-'))delete d.nodes[id];d.roots=d.roots.filter(id=>d.nodes[id]);d.joints=d.joints!.filter(j=>d.nodes[j.bodyA]&&d.nodes[j.bodyB]);pruneModelProvenance(d);return d;
}
it('adds missing hardware in one undoable action while preserving earlier edits and ownership',()=>{
 const session=createCadSession(olderAtlas());session.rename('My forklift');session.update('pallet-crate',{name:'My cargo'});
 const before=session.serialize(),previousHistory=[...session.history.past],revision=session.state.revision;
 expect(canAddRobotElectronics(session.state.document)).toBe(true);
 session.editAssembly('Add controller and power',addRobotElectronics,{expectedRevision:revision});
 expect(session.state.revision).toBe(revision+1);expect(session.state.document.id).toBe('robot-atlas-forklift');expect(session.state.document.title).toBe('My forklift');
 expect(session.state.document.nodes['pallet-crate'].name).toBe('My cargo');expect(session.state.document.nodes['electronics-controller']).toBeDefined();
 expect(session.state.document.joints!.filter(j=>j.control).map(j=>j.control!.port)).toEqual(['A','B','D','C']);
 expect(session.history.past.slice(0,-1)).toEqual(previousHistory);
 session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.state.document.nodes['electronics-controller']).toBeDefined();session.dispose();
});
it('places hardware relative to a moved example frame rather than the original world location',()=>{
 const doc=olderAtlas();for(const node of Object.values(doc.nodes)){node.transform.position[0]+=100;node.transform.position[1]-=80;}
 const session=createCadSession(doc);session.editAssembly('Add controller and power',addRobotElectronics);
 const stock=createAtlasForkliftDocument(),now=session.state.document;
 for(const id of now.roots.filter(id=>id.startsWith('electronics-')))expect(now.nodes[id].transform.position).toEqual(stock.nodes[id].transform.position.map((v,i)=>v+[100,-80,0][i]));
 session.dispose();
});
it('rejects stale ownership and project replacement without changing the current document or Undo',()=>{
 const session=createCadSession(olderAtlas()),revision=session.state.revision;session.rename('Current');const before=session.serialize(),history=[...session.history.past];
 expect(()=>session.editAssembly('Stale',addRobotElectronics,{expectedRevision:revision})).toThrow(/changed/);
 expect(()=>session.editAssembly('Wrong project',d=>{d.id='other-project';})).toThrow(/identity/);
 expect(()=>session.editAssembly('Async',async d=>{d.title='Later';})).toThrow(/synchronously/);
 expect(session.serialize()).toBe(before);expect(session.history.past).toEqual(history);session.dispose();
});
it('leaves already installed hardware and resized mounting frames alone',()=>{
 const installed=createAtlasForkliftDocument(),before=serializeDocument(installed);expect(canAddRobotElectronics(installed)).toBe(false);addRobotElectronics(installed);expect(serializeDocument(installed)).toBe(before);
 const resized=olderAtlas();resized.nodes.chassis.transform.scale=[2,2,2];expect(canAddRobotElectronics(resized)).toBe(false);
});
