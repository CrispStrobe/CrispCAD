import {beforeAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
import {createCadSession} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createPhysicsWorld,prepareDocumentCollisions,solidMassProperties} from '../packages/physics/src/index.js';
let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});J=await initJolt();});
describe('qualified Jolt physics boundary',()=>{
 it('requires fresh collision qualification after a driving parameter changes',async()=>{
  const s=createCadSession(),id=s.add({kind:'box',size:[20,20,10]},{transform:{position:[0,0,50],rotation:[0,0,0],scale:[1,1,1]}});
  s.setParametric({version:1,parameters:{width:{expression:'20',unit:'mm'}},bindings:[{nodeId:id,property:'width',expression:'width'}]});
  const before=kernel.evaluate(s.state.document),old=await prepareDocumentCollisions(s.state.document,before,kernel);
  const d=structuredClone(s.state.document.parametric!);d.parameters.width.expression='40';s.setParametric(d);const result=kernel.evaluate(s.state.document);
  expect(solidMassProperties(result.bodies[0],1050).massKg).toBeCloseTo(.0084,10);
  await expect(createPhysicsWorld(s.state.document,before,old,{J})).rejects.toThrow('stale');
  await expect(createPhysicsWorld(s.state.document,result,old,{J})).rejects.toThrow();
  const prepared=await prepareDocumentCollisions(s.state.document,result,kernel),world=await createPhysicsWorld(s.state.document,result,prepared,{J});
  try{for(let i=0;i<200;i++)world.step();expect(world.geometryBoundsMm(id).min[2]).toBeGreaterThan(-.25);}finally{world.dispose();}
 });
 it('computes mass, center and inertia from actual solid geometry in SI units',()=>{
  const doc=structuredClone(createPresetDocument('box'));const node=doc.nodes[doc.roots[0]];if(node.kind!=='box')throw Error('fixture');node.size=[10,20,30];node.transform.position=[10000,-2000,45];const body=kernel.evaluate(doc).bodies[0],p=solidMassProperties(body,1050);expect(p.massKg).toBeCloseTo(.0063,10);[10,-2,.045].forEach((v,i)=>expect(p.centerM[i]).toBeCloseTo(v,10));expect(p.inertiaKgM2[0][0]).toBeCloseTo(.0063*(.02**2+.03**2)/12,12);expect(p.inertiaKgM2[0][1]).toBeCloseTo(0,12);
 });
 it('drops a box at 200 Hz onto the floor, refuses stale geometry and disposes on the debug build',async()=>{
  const doc=structuredClone(createPresetDocument('box'));doc.nodes[doc.roots[0]].transform.position[2]=70;const result=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,result,kernel);const world=await createPhysicsWorld(doc,result,prepared,{J});for(let i=0;i<200;i++)world.step();expect(world.pose(doc.roots[0]).positionMm[2]).toBeCloseTo(-60.02,1);expect(()=>world.step(.001)).toThrow('1/200');world.dispose();world.dispose();expect(()=>world.pose(doc.roots[0])).toThrow('disposed');doc.nodes[doc.roots[0]].transform.position[0]=10;await expect(createPhysicsWorld(doc,result,prepared,{J})).rejects.toThrow('stale');
 });
 it('preserves a tube bore in actual Jolt ray queries instead of filling it with a hull',async()=>{
  const doc=structuredClone(createPresetDocument('tube'));doc.nodes[doc.roots[0]].transform.position[2]=70;const result=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,result,kernel);expect(prepared.get(doc.roots[0])!.certificate.relativeError).toBeLessThan(.005);const world=await createPhysicsWorld(doc,result,prepared,{J,ground:false});try{expect(world.raycast([0,0,100],[0,0,40])).toBeNull();expect(world.raycast([30,1,70],[0,1,70])?.bodyId).toBe(doc.roots[0]);for(let i=0;i<20;i++)world.step();expect(world.pose(doc.roots[0]).positionMm[2]).toBeLessThan(0);}finally{world.dispose();}
 });
 it('builds an articulated hinge with separate bodies and keeps its pivot while rotating a leaf',async()=>{
  const doc=structuredClone(createPresetDocument('hinge'));for(const id of doc.roots)doc.nodes[id].transform.position[2]=70;doc.nodes[doc.roots[0]].physics!.motion='static';const result=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,result,kernel),world=await createPhysicsWorld(doc,result,prepared,{J,ground:false});try{world.setAngularVelocity(doc.roots[1],[0,0,1]);for(let i=0;i<50;i++)world.step();expect(Math.abs(world.hingeAngle(doc.joints![0].id))).toBeGreaterThan(.1);expect(Math.abs(world.pose(doc.roots[1]).positionMm[2])).toBeLessThan(.1);}finally{world.dispose();}
 });
 it('provides collision-ready coil geometry but refuses to claim an unconfigured elastic mechanism',async()=>{
  const doc=structuredClone(createPresetDocument('spring'));doc.nodes[doc.roots[0]].transform.position[2]=70;const result=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,result,kernel);expect(prepared.get(doc.roots[0])!.certificate.relativeError).toBeLessThan(.02);await expect(createPhysicsWorld(doc,result,prepared,{J})).rejects.toThrow('qualified mechanical model');const world=await createPhysicsWorld(doc,result,prepared,{J,mode:'rigid-preview',ground:false});try{world.step(.1);expect(world.pose(doc.roots[0]).positionMm[2]).toBeLessThan(-40);}finally{world.dispose();}
 });
 it('excludes ruler helpers and rejects malformed body metadata before native allocation',async()=>{
  const doc=createPresetDocument('ruler');const result=kernel.evaluate(doc);expect((await prepareDocumentCollisions(doc,result,kernel)).size).toBe(0);await expect(createPhysicsWorld(doc,result,new Map(),{J})).rejects.toThrow('no physical');
 });
});

it('keeps millimetre knurl tips above the floor and rejects tampered collider buffers',async()=>{
 const doc=structuredClone(createPresetDocument('knurl'));doc.nodes[doc.roots[0]].transform.position[2]=70;const result=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,result,kernel);const world=await createPhysicsWorld(doc,result,prepared,{J});try{for(let i=0;i<200;i++)world.step();expect(world.geometryBoundsMm(doc.roots[0]).min[2]).toBeGreaterThan(-.1);}finally{world.dispose();}
 const asset=prepared.get(doc.roots[0])!;expect(Object.isFrozen(asset.certificate)).toBe(true);asset.hulls[0].positions[0]+=1;await expect(createPhysicsWorld(doc,result,prepared,{J})).rejects.toThrow('missing or stale');
});
