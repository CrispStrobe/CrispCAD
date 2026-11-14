// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,identityTransform,parseDocument,validateDocument,compileModelSource} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,importSTL,export3MF} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {unzipSync,strFromU8} from 'fflate';
let kernel:GeometryKernel;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const setup=()=>{const s=createCadSession(),a=s.add({kind:'box',size:[10,10,10]}),b=s.add({kind:'box',size:[4,4,20]});s.setRole('hole',[b]);return {s,a,b};};
it('subtracts hole roles on Union regardless of selection order, retaining inputs and undo',()=>{
 const {s,a,b}=setup();expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(1000);const prior=s.serialize();const id=s.combine('union',[b,a]);expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(840);expect(s.state.document.nodes[id]).toMatchObject({kind:'boolean',operation:'union',useHoleRoles:true,inputs:[b,a]});s.undo();expect(s.serialize()).toBe(prior);s.redo();s.separate(id);expect(new Set(s.state.document.roots)).toEqual(new Set([a,b]));expect(s.state.document.nodes[b].role).toBe('hole');
});
it('unites multiple positive shapes before cutting and allows unions of only holes',()=>{
 const {s,a,b}=setup();const c=s.add({kind:'box',size:[10,10,10]},{transform:{...identityTransform(),position:[5,0,0]}});s.combine('union',[b,a,c]);expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(1340);
 const only=createCadSession(),x=only.add({kind:'box',size:[4,4,4]}),y=only.add({kind:'box',size:[2,2,2]});only.setRole('hole',[x,y]);const id=only.combine('union',[x,y]);expect(only.state.document.nodes[id].role).toBe('hole');expect(kernel.evaluate(only.state.document).volume).toBe(0);expect(kernel.evaluate(only.state.document).bodies[0].volume).toBeCloseTo(64);
});
it('keeps explicit subtract and intersect semantics and excludes uncombined holes from STL/3MF',()=>{
 const {s,a,b}=setup(),geometry=kernel.evaluate(s.state.document);const stl=importSTL(exportSTL(geometry.bodies));const restored=createCadSession();restored.add({kind:'mesh',...stl,id:'x',name:'x',color:'#ffffff',transform:identityTransform()});expect(kernel.evaluate(restored.state.document).volume).toBeCloseTo(1000);const xml=strFromU8(unzipSync(export3MF(geometry.bodies))['3D/3dmodel.model']);expect(xml.match(/<object /g)).toHaveLength(1);s.combine('intersect',[a,b]);expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(160);
});
it('round-trips roles in version 7 projects and synchronized model source without downgrading history',()=>{
 const {s,a,b}=setup();const doc=parseDocument(s.serialize());expect(doc.version).toBe(7);expect(doc.nodes[b].role).toBe('hole');const source=s.modelSource;const next=compileModelSource(source,doc);expect(next.version).toBe(7);expect(next.nodes[b].role).toBe('hole');s.applyModelSource(source);s.update(a,{name:'Plate'});expect(s.state.document.version).toBe(7);expect(s.modelSource).toContain('role: "hole"');const invalid=structuredClone(doc);invalid.version=6;expect(()=>validateDocument(invalid)).toThrow('role');
});
