import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {shapeCatalog,createPresetDocument} from '../packages/editor/src/shapes.js';
import {createCadSession,parseDocument,serializeDocument} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {solidMassProperties} from '../packages/physics/src/mass.js';
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
describe('independent shape catalog',()=>{
 for(const preset of shapeCatalog)it(`${preset.name} is a closed solid with finite physical mass and portable project data`,()=>{
  const doc=createPresetDocument(preset.id,'ABC');const result=kernel.evaluate(parseDocument(serializeDocument(doc)));
  expect(result.bodies.length).toBeGreaterThan(0);
  for(const body of result.bodies){expect(body.positions.every(Number.isFinite)).toBe(true);expect(body.volume).toBeGreaterThan(0);const mass=solidMassProperties(body,1050);expect(mass.massKg).toBeCloseTo(body.volume*1050e-9,8);expect(mass.inertiaKgM2.every((row,i)=>row[i]>0)).toBe(true);}
  if(preset.id==='ruler'){expect(result.volume).toBe(0);expect(()=>exportSTL(result.bodies)).toThrow('no solid');}else{expect(result.volume).toBeGreaterThan(0);expect(exportSTL(result.bodies).length).toBeGreaterThan(84);}
 });
 it('inserts an articulated hinge as one undoable edit and keeps joints through duplicate/delete/load',()=>{
  const s=createCadSession();s.insert(createPresetDocument('hinge'));expect(s.state.document.roots).toHaveLength(3);expect(s.state.document.joints).toHaveLength(2);
  const doc=JSON.parse(s.serialize());expect(parseDocument(JSON.stringify(doc)).joints).toHaveLength(2);
  s.duplicate();expect(s.state.document.joints).toHaveLength(4);expect(s.state.document.roots).toHaveLength(6);s.remove();expect(s.state.document.joints).toHaveLength(2);s.undo();expect(s.state.document.joints).toHaveLength(4);s.undo();s.undo();expect(s.state.document.roots).toHaveLength(0);expect(s.state.document.joints).toBeUndefined();
 });
 it('refuses to erase joints or mix densities by a boolean operation',()=>{
  const s=createCadSession();s.insert(createPresetDocument('hinge'));expect(()=>s.combine('union')).toThrow('Detach');s.detachJoints();s.combine('union');expect(kernel.evaluate(s.state.document).volume).toBeGreaterThan(0);
  const a=s.add({kind:'box',size:[10,10,10]}),b=s.add({kind:'box',size:[10,10,10]});s.update(b,{physics:{version:1,motion:'dynamic',densityKgM3:7800,friction:.4,restitution:.05,intent:'rigid'}});expect(()=>s.combine('union',[a,b])).toThrow('density');
 });
 it('rejects malformed physics metadata and dangling joints before replacement',()=>{
  const d=structuredClone(createPresetDocument('hinge'));d.joints![0].bodyA='missing';expect(()=>parseDocument(JSON.stringify(d))).toThrow('physics');
  const body=structuredClone(createPresetDocument('box'));body.nodes[body.roots[0]].physics!.densityKgM3=-1;expect(()=>parseDocument(JSON.stringify(body))).toThrow('physics');
 });
});

it('keeps reference helpers out of printable boolean graphs on both edit and import',()=>{
 const s=createCadSession(createPresetDocument('ruler'));const helper=s.state.document.roots[0];const box=s.add({kind:'box',size:[10,10,10]});expect(()=>s.combine('union',[helper,box])).toThrow('Reference');const doc=structuredClone(s.state.document);doc.nodes['invalid-union']={id:'invalid-union',name:'Invalid union',kind:'boolean',operation:'union',inputs:[helper,box],color:'#ffffff',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}};doc.roots=['invalid-union'];expect(()=>parseDocument(JSON.stringify(doc))).toThrow('reference');
});
