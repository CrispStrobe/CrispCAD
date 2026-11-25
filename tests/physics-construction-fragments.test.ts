// SPDX-License-Identifier: BSD-3-Clause
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createDocument,identityTransform,validateDocument} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {geometryHash,isQualifiedCollision,prepareCollision,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createMotorDocument} from '../packages/editor/src/motor-models.js';

it('reuses the evaluated root and keeps only child provenance in collision fragments',async()=>{
 const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),doc=createDocument();doc.version=8;
 const record=createMotorDocument('tt-gearmotor').provenance!.records[0];
 doc.provenance={version:1,records:[{...structuredClone(record),id:'source-a'},{...structuredClone(record),id:'source-b'}]};
 for(const [i,id]of ['a','b','plain'].entries())doc.nodes[id]={id,name:id,kind:'box',size:[10,10,10],transform:{...identityTransform(),position:[i*20,0,10]},color:'#123456',...(id==='plain'?{}:{provenance:['source-'+id]})};
 doc.nodes.union={id:'union',name:'Union',kind:'boolean',operation:'union',inputs:['a','b','plain'],transform:identityTransform(),color:'#123456'};
 doc.roots=['union'];doc.tracers=[{id:'trace-union',bodyId:'union',point:[0,0,0],color:'#123456'}];
 validateDocument(doc);const before=JSON.stringify(doc),fragments:CadDocument[]=[],geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,{...kernel,evaluate(fragment){fragments.push(structuredClone(fragment));return kernel.evaluate(fragment);}});
 expect([...prepared.keys()]).toEqual(['union']);expect(fragments.map(fragment=>fragment.roots)).toEqual([['a'],['b'],['plain']]);
 for(const fragment of fragments){const id=fragment.roots[0];expect(()=>validateDocument(fragment)).not.toThrow();expect(Object.keys(fragment.nodes)).toEqual([id]);expect(fragment.provenance!.records.map(r=>r.id)).toEqual(id==='plain'?[]:['source-'+id]);expect(fragment.tracers).toEqual([]);}
 expect(JSON.stringify(doc)).toBe(before);
});

it('binds a background collision measurement to its original geometry bytes',async()=>{
 const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 const doc=createDocument();
 doc.nodes.box={id:'box',name:'Box',kind:'box',size:[10,10,10],transform:identityTransform(),color:'#123456'};
 doc.roots=['box'];
 const [mesh]=kernel.evaluate(doc).bodies;
 const originalHash=await geometryHash(mesh);
 const prepared=await prepareCollision(mesh,kernel,{async measure(source,hulls){
  const measurement=kernel.collisionCSG.measure(source,hulls);
  await Promise.resolve();
  source.positions[0]+=1;
  hulls[0].positions[0]+=1;
  return measurement;
 }});
 expect(prepared.certificate.sourceSHA256).toBe(originalHash);
 expect(await geometryHash(mesh)).not.toBe(originalHash);
 expect(await isQualifiedCollision(prepared)).toBe(false);
});

it('starts the background measurement before local CSG and retains body order',async()=>{
 const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 const doc=createDocument();
 for(const id of ['local','remote'])doc.nodes[id]={id,name:id,kind:'box',size:[10,10,10],transform:identityTransform(),color:'#123456'};
 doc.roots=['local','remote'];
 const geometry=kernel.evaluate(doc);
 const expected=await prepareDocumentCollisions(doc,geometry,kernel);
 const calls:string[]=[];
 let announce!:()=>void;
 const started=new Promise<void>(resolve=>{announce=resolve;});
 const local={...kernel,collisionCSG:{...kernel.collisionCSG,measure(...args:Parameters<typeof kernel.collisionCSG.measure>){
  calls.push('local');
  return kernel.collisionCSG.measure(...args);
 }}};
 const result=prepareDocumentCollisions(doc,geometry,local,{bodyId:'remote',started,async measure(source,hulls){
  calls.push('remote');
  await started;
  return kernel.collisionCSG.measure(source,hulls);
 }});
 expect(calls).toEqual(['remote']);
 announce();
 const prepared=await result;
 expect(calls).toEqual(['remote','local']);
 expect([...prepared.keys()]).toEqual(doc.roots);
 expect([...prepared.values()].map(value=>value.certificate)).toEqual([...expected.values()].map(value=>value.certificate));
});
