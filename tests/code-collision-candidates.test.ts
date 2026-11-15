// SPDX-License-Identifier: BSD-3-Clause
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,createDocument,defaultPartPhysics} from '@brickwright/cad-core';
import type {CodeProgram} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {appendPortableRevision,readPortableHistory} from '@brickwright/cad-history';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';

it('invalidates supplied code colliders on an actual edit while retaining undo and portable revisions',async()=>{
 const doc=createDocument();doc.version=8;const session=createCadSession(doc),program:CodeProgram={version:1,language:'brickwright-cad-script',parameters:{},source:'param width:mm=10; return box(width,10,10);'},id=session.addCode(program);
 const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),originalGeometry=kernel.evaluate(session.state.document),hulls=kernel.partitionConvex(originalGeometry.bodies[0]);
 session.update(id,{physics:{...defaultPartPhysics(),densityKgM3:1240,collisionAssembly:hulls.map(h=>({positions:Array.from(h.positions),indices:Array.from(h.indices)}))}});
 const before=session.serialize(),original=structuredClone(session.state.document),originalPrepared=await prepareDocumentCollisions(original,originalGeometry,kernel);
 let history=await appendPortableRevision(undefined,original,'Original candidate');
 session.updateCode(id,structuredClone(program));expect(session.serialize()).toBe(before);
 expect(()=>session.updateCode(id,{...program,parameters:{width:'-1'}})).toThrow();expect(session.serialize()).toBe(before);
 session.updateCode(id,{...program,parameters:{width:'20'}});
 expect(session.state.document.nodes[id].physics?.collisionAssembly).toBeUndefined();expect(session.state.document.nodes[id].physics?.densityKgM3).toBe(1240);expect(original.nodes[id].physics?.collisionAssembly).toHaveLength(1);
 const after=session.serialize(),geometry=kernel.evaluate(session.state.document);
 await expect(createPhysicsWorld(session.state.document,geometry,originalPrepared,{ground:false})).rejects.toThrow('missing or stale');
 const fresh=await prepareDocumentCollisions(session.state.document,geometry,kernel);expect(fresh.get(id)!.certificate.sourceSHA256).not.toBe(originalPrepared.get(id)!.certificate.sourceSHA256);
 history=await appendPortableRevision(history,session.state.document,'Edited code');const journal=await readPortableHistory(history);expect(journal.revisions).toHaveLength(2);expect(journal.readDocument(journal.revisions[0].id)).toEqual(original);expect(journal.readDocument(journal.revisions[1].id).nodes[id].physics?.collisionAssembly).toBeUndefined();
 session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(after);session.dispose();
});
