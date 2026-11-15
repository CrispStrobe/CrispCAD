import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,defaultGenerator,checkGenerator,validateDocument,parseDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
let kernel:GeometryKernel;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
describe('editable shape recipes',()=>{
 it('regenerates screws with pitch, diameter, starts and handedness while retaining identity and placement',()=>{
  const s=createCadSession();s.insert(createPresetDocument('screw'),[20,10,8]);const id=s.state.document.roots[0],before=s.serialize();
  const recipe=defaultGenerator('screw')!;recipe.values.pitch=2.5;recipe.values.diameter=8;recipe.values.starts=2;recipe.values.hand=-1;
  const fragment=createPresetDocument('screw','BW',{recipe});expect(kernel.evaluate(fragment).volume).toBeGreaterThan(500);
  s.replaceGenerated(id,fragment);expect(s.state.document.roots).toEqual([id]);expect(s.state.document.nodes[id].transform.position).toEqual([20,10,8]);expect(s.state.document.nodes[id].generator?.values).toEqual(recipe.values);validateDocument(s.state.document);
  s.undo();expect(s.serialize()).toBe(before);s.redo();expect(parseDocument(s.serialize()).nodes[id].generator?.values.pitch).toBe(2.5);
 });
 it('keeps a generated operand editable inside a retained boolean without orphaned construction nodes',()=>{
  const s=createCadSession();s.insert(createPresetDocument('screw'));const screw=s.state.document.roots[0];const box=s.add({kind:'box',size:[5,5,5]});s.combine('union',[screw,box]);
  const recipe=defaultGenerator('screw')!;recipe.values.length=24;s.replaceGenerated(screw,createPresetDocument('screw','BW',{recipe}));expect(s.state.document.roots).toHaveLength(1);validateDocument(s.state.document);expect(kernel.evaluate(s.state.document).volume).toBeGreaterThan(1000);
 });
 it('builds bent and rounded heart variants as closed solids',()=>{
  for(const bend of [-30,0,30]){const recipe=defaultGenerator('heart')!;recipe.values.bend=bend;recipe.values.roundness=1.2;const doc=createPresetDocument('heart','BW',{recipe});expect(kernel.evaluate(doc).volume).toBeGreaterThan(1000);expect(parseDocument(JSON.stringify(doc)).nodes[doc.roots[0]].generator?.values.bend).toBe(bend);}
 });
 it('refuses unsupported and folded variants without changing the current object',()=>{
  const s=createCadSession(createPresetDocument('heart')),before=s.serialize(),bad=defaultGenerator('heart')!;bad.values.width=5;bad.values.bend=90;bad.values.thickness=30;expect(()=>checkGenerator(bad)).toThrow('folded');expect(s.serialize()).toBe(before);
  const screw=defaultGenerator('screw')!;screw.values.pitch=.5;screw.values.length=100;expect(()=>checkGenerator(screw)).toThrow('turns');
  expect(()=>validateDocument({...s.state.document,version:1})).toThrow('version 2');
 });
});

it('retains rounded name tags, Unicode text and selectable bundled fonts through regeneration and undo',()=>{
 const s=createCadSession(createPresetDocument('name-tag','Grüße',{font:'sans'})),id=s.state.document.roots[0],before=s.serialize();const original=s.state.document.nodes[id].generator!;expect(original.text).toBe('Grüße');expect(original.font).toBe('sans');expect(original.values.cornerRadius).toBe(3);const first=kernel.evaluate(s.state.document);expect(first.volume).toBeGreaterThan(100);expect(first.bodies[0].bounds.max[2]-first.bodies[0].bounds.min[2]).toBeCloseTo(original.values.baseThickness+original.values.textDepth,5);
 s.update(id,{name:'My tag',transform:{position:[12,8,4],rotation:[0,0,25],scale:[1.1,1,1]}});const recipe=structuredClone(original);recipe.text='Hallo';recipe.font='serif';recipe.values.cornerRadius=5;s.replaceGenerated(id,createPresetDocument('name-tag','unused',{recipe}));expect(s.state.document.nodes[id].generator?.text).toBe('Hallo');expect(s.state.document.nodes[id].name).toBe('My tag');expect(s.state.document.nodes[id].transform.position).toEqual([12,8,4]);expect(kernel.evaluate(s.state.document).volume).toBeGreaterThan(100);expect(parseDocument(s.serialize()).nodes[id].generator?.font).toBe('serif');s.undo();expect(s.state.document.nodes[id].generator?.text).toBe('Grüße');
 const mono=createPresetDocument('text','Hallo',{font:'mono'});expect(kernel.evaluate(mono).volume).toBeGreaterThan(0);const invalid=structuredClone(recipe);invalid.font='block';invalid.text='Grüße';expect(()=>checkGenerator(invalid)).toThrow('block');expect(before).toContain('Grüße');
});
