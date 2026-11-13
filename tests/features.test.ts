import 'fake-indexeddb/auto';
import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,designGraph,affectedDesignEntries,evaluateExtrusion,validateDocument,parseDocument,resolveDesignReference,FeatureEvaluationError,documentGeometryKey} from '@brickwright/cad-core';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {openHistoryStore} from '@brickwright/cad-history';
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function fixture(){const s=createCadSession();s.setParametric({version:1,parameters:{width:{expression:'40',unit:'mm'},thickness:{expression:'width / 8',unit:'mm'}},bindings:[]});const id=s.addSketchExtrusion({kind:'rectangle',id:'rectangle-profile',width:'width',depth:20},{name:'Plate sketch',distance:'thickness'});const node=s.state.document.nodes[id];if(node.kind!=='extrusion')throw Error('fixture');return {s,id,sketchId:node.sketchId};}
describe('retained sketch extrusion features',()=>{
 it('recomputes actual solids through retained booleans and preserves stable feature, sketch and profile identities',()=>{
  const {s,id,sketchId}=fixture(),cutter=s.add({kind:'cylinder',radius:3,height:30,segments:64}),cut=s.combine('subtract',[id,cutter]),before=kernel.evaluate(s.state.document).volume;
  const parameters=structuredClone(s.state.document.parametric!);parameters.parameters.width.expression='60';s.setParametric(parameters);
  const after=kernel.evaluate(s.state.document);expect(after.volume).toBeGreaterThan(before*2);expect(after.bodies[0].id).toBe(cut);expect(s.state.document.nodes[id].kind).toBe('extrusion');expect(s.state.document.sketches![sketchId].profile.id).toBe('rectangle-profile');expect(s.state.document.version).toBe(3);
  expect(parseDocument(s.serialize())).toEqual(s.state.document);
 });
 it('uses right-handed principal planes and symmetric extrusions with predictable bounds',()=>{
  for(const plane of ['XY','XZ','YZ'] as const){const s=createCadSession();s.addSketchExtrusion({kind:'rectangle',id:'profile',width:20,depth:10},{plane,distance:6,symmetric:true});const body=kernel.evaluate(s.state.document).bodies[0];expect(body.volume).toBeCloseTo(1200);const extents=body.bounds.max.map((v,i)=>v-body.bounds.min[i]);expect(extents).toEqual(plane==='XY'?[20,10,6]:plane==='XZ'?[20,6,10]:[6,20,10]);body.bounds.min.forEach((v,i)=>expect(v).toBeCloseTo(-extents[i]/2));}
  const s=createCadSession();s.addSketchExtrusion({kind:'circle',id:'circle',radius:10,segments:128},{distance:3});expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(Math.PI*100*3,0);
 });
 it('reports a deterministic dependency order and the transitive features affected by a dimension change',()=>{
  const {s,id,sketchId}=fixture(),other=s.add({kind:'sphere',radius:3,segments:32}),root=s.combine('union',[id,other]);
  const graph=designGraph(s.state.document),keys=graph.map(e=>e.key);expect(keys.indexOf('parameter:width')).toBeLessThan(keys.indexOf('parameter:thickness'));expect(keys.indexOf(`sketch:${sketchId}`)).toBeLessThan(keys.indexOf(`feature:${id}`));expect(keys.indexOf(`feature:${id}`)).toBeLessThan(keys.indexOf(`feature:${root}`));
  const affected=affectedDesignEntries(s.state.document,['parameter:width']).map(e=>e.key);expect(affected).toEqual(['parameter:width','parameter:thickness',`sketch:${sketchId}`,`feature:${id}`,`feature:${root}`]);expect(affected).not.toContain(`feature:${other}`);
 });
 it('edits sketch and feature inputs as one undoable transaction and rejects invalid drafts atomically',()=>{
  const {s,id,sketchId}=fixture(),before=s.serialize(),revision=s.state.revision,sketch=s.state.document.sketches![sketchId];
  s.editExtrusion(id,{sketch:{profile:{...sketch.profile,kind:'rectangle',width:30,depth:10}},distance:8,symmetric:true});expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(2400);expect(s.state.revision).toBe(revision+1);s.undo();expect(s.serialize()).toBe(before);s.redo();const edited=s.serialize();
  expect(()=>s.editExtrusion(id,{sketch:{profile:{kind:'rectangle',id:sketch.profile.id,width:-1,depth:10}},distance:3,symmetric:false})).toThrow('Dimension');expect(s.serialize()).toBe(edited);
  expect(()=>s.updateSketch(sketchId,{profile:{kind:'rectangle',id:'replacement',width:10,depth:10}})).toThrow('identity');
 });
 it('attributes expression errors to stable sketch and feature IDs without committing the bad edit',()=>{
  const {s,id,sketchId}=fixture(),before=s.serialize();
  try{s.updateSketch(sketchId,{profile:{kind:'rectangle',id:'rectangle-profile',width:'missing',depth:20}});throw Error('expected failure');}catch(e){expect(e).toBeInstanceOf(FeatureEvaluationError);expect((e as FeatureEvaluationError).diagnostic).toMatchObject({source:'sketch',id:sketchId});}
  try{s.update(id,{distance:'90 deg'});throw Error('expected failure');}catch(e){expect((e as FeatureEvaluationError).diagnostic).toMatchObject({source:'feature',id});}
  expect(s.serialize()).toBe(before);const d=structuredClone(s.state.document.parametric!);d.parameters.width.expression='-10';expect(()=>s.setParametric(d)).toThrow('Dimension');expect(s.serialize()).toBe(before);
 });
 it('duplicates independent sketches while retaining named parameter links and a distinct profile identity',()=>{
  const {s,id,sketchId}=fixture();s.duplicate([id]);const copy=s.state.document.nodes[s.state.selection[0]];if(copy.kind!=='extrusion')throw Error('fixture');expect(copy.sketchId).not.toBe(sketchId);expect(s.state.document.sketches![copy.sketchId].profile.id).not.toBe('rectangle-profile');
  const profile=s.state.document.sketches![copy.sketchId].profile;if(profile.kind!=='rectangle')throw Error('fixture');s.updateSketch(copy.sketchId,{profile:{...profile,depth:8}});expect(s.state.document.sketches![sketchId].profile).toMatchObject({depth:20});
  const parameters=structuredClone(s.state.document.parametric!);parameters.parameters.width.expression='48';s.setParametric(parameters);expect(evaluateExtrusion(copy,s.state.document).distance).toBe(6);
 });
 it('copies only required design inputs and namespaces expressions and sketch IDs on paste',()=>{
  const {s,id,sketchId}=fixture();const d=structuredClone(s.state.document.parametric!);d.parameters.unused={expression:'99',unit:'mm'};s.setParametric(d);const fragment=s.fragment([id]);expect(fragment.parametric!.parameters).not.toHaveProperty('unused');expect(Object.keys(fragment.sketches!)).toEqual([sketchId]);
  const host=createCadSession();host.setParametric({version:1,parameters:{width:{expression:'9',unit:'mm'}},bindings:[]});host.insert(fragment,[5,0,0],{mergeParameters:true});const pasted=host.state.document.nodes[host.state.selection[0]];if(pasted.kind!=='extrusion')throw Error('fixture');expect(pasted.sketchId).not.toBe(sketchId);expect(host.state.document.parametric!.parameters.width_2.expression).toBe('40');expect(host.state.document.sketches![pasted.sketchId].profile).toMatchObject({width:'width_2'});expect(kernel.evaluate(host.state.document).volume).toBeCloseTo(4000);expect(pasted.transform.position[0]).toBe(5);
  expect(()=>createCadSession().insert(fragment)).toThrow('namespace');
 });
 it('retains sketch definitions across history archives and a restored branch',async()=>{
  const {s,id,sketchId}=fixture(),store=await openHistoryStore(`features-${crypto.randomUUID()}`);const first=await store.append(s.state.document,'Plate');s.editExtrusion(id,{distance:9,symmetric:false});const second=await store.append(s.state.document,'Thicker');s.load(await store.readDocument(first.id));await store.append(s.state.document,'Restore plate',first.id);const project=await store.importArchive(await store.exportArchive(s.state.document.id)),doc=await store.readDocument(project.headId);expect(doc.sketches![sketchId]).toEqual(s.state.document.sketches![sketchId]);expect(doc.nodes[id]).toMatchObject({distance:'thickness'});expect((await store.readDocument(second.id)).nodes[id]).toMatchObject({distance:9});await store.close();
 });
 it('rejects missing references, bad versions, incompatible expressions and invalid sketch budgets on import',()=>{
  const {s,id}=fixture();for(const mutate of [(d:any)=>d.version=2,(d:any)=>d.nodes[id].sketchId='missing',(d:any)=>Object.values(d.sketches)[0].version=2,(d:any)=>Object.values(d.sketches)[0].profile.width='1 deg',(d:any)=>Object.values(d.sketches)[0].profile.kind='arbitrary',(d:any)=>d.nodes[id].distance=null]){const doc=structuredClone(s.state.document);mutate(doc);expect(()=>validateDocument(doc)).toThrow();}
  const old=createCadSession();old.add({kind:'box',size:[10,20,30]});expect(parseDocument(old.serialize()).version).toBe(1);
 });
 it('opens the shipped shared-sketch plate and recomputes both bore placements',()=>{
  const s=createCadSession(parseDocument(readFileSync('examples/parametric-sketch-plate.bcad','utf8')));expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(8717.7106,3);const p=structuredClone(s.state.document.parametric!);p.parameters.width.expression='80';p.parameters.holeDiameter.expression='8';s.setParametric(p);expect(s.state.document.nodes['bore-left'].transform.position[0]).toBe(-20);expect(s.state.document.nodes['bore-right'].transform.position[0]).toBe(20);expect(kernel.evaluate(s.state.document).volume).toBeGreaterThan(15000);
 });
 it('resolves semantic references by identity and refuses deleted or replaced targets',()=>{
  const {s,id,sketchId}=fixture();expect(resolveDesignReference(s.state.document,{kind:'feature-output',featureId:id}).id).toBe(id);expect(resolveDesignReference(s.state.document,{kind:'sketch-profile',sketchId,profileId:'rectangle-profile'}).id).toBe(sketchId);expect(()=>resolveDesignReference(s.state.document,{kind:'sketch-profile',sketchId,profileId:'missing'})).toThrow();s.remove([id]);expect(()=>resolveDesignReference(s.state.document,{kind:'feature-output',featureId:id})).toThrow();
 });
 it('supports one reusable sketch feeding distinct features, and keeps an unused sketch editable',()=>{
  const s=createCadSession(),sketch=s.addSketch({kind:'rectangle',id:'shared-profile',width:20,depth:10});expect(s.state.document.roots).toHaveLength(0);expect(parseDocument(s.serialize()).sketches![sketch]).toBeDefined();const a=s.extrudeSketch(sketch,{distance:5}),b=s.extrudeSketch(sketch,{distance:10});expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(3000);s.updateSketch(sketch,{profile:{kind:'rectangle',id:'shared-profile',width:30,depth:10}});expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(4500);s.remove([a]);expect(s.state.document.nodes[b]).toMatchObject({sketchId:sketch});
 });
 it('invalidates geometry identity when a shared sketch changes',()=>{const {s,sketchId}=fixture(),key=documentGeometryKey(s.state.document),p=s.state.document.sketches![sketchId].profile;s.updateSketch(sketchId,{profile:{...p,kind:'rectangle',width:50,depth:20}});expect(documentGeometryKey(s.state.document)).not.toBe(key);});
});
