// SPDX-License-Identifier: BSD-3-Clause
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createDocument,identityTransform,validateDocument} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {prepareDocumentCollisions} from '../packages/physics/src/index.js';
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
