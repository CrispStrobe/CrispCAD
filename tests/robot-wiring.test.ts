// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import * as T from 'three';
import {readFileSync} from 'node:fs';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {serializeDocument,localToWorldPoint} from '@brickwright/cad-core';
import {createTTRoverDocument} from '../packages/editor/src/tt-rover.js';
import {createAtlasForkliftDocument} from '../packages/editor/src/atlas-forklift.js';
import {robotWires,createRobotWiring} from '../packages/editor/src/robot-wiring.js';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function center(mesh:T.Mesh,index:number){const p=mesh.geometry.getAttribute('position');return [0,1,2].map(axis=>Array.from({length:6},(_,k)=>p.array[(index*7+k)*3+axis]).reduce((a,b)=>a+b)/6);}
it('derives Scout battery, controller and A/B motor harnesses without editing physics or program connections',()=>{
 const doc=createTTRoverDocument(),before=serializeDocument(doc),result=kernel.evaluate(doc),wires=robotWires(doc,result);
 expect(wires).toHaveLength(21);expect(new Set(wires.map(w=>w.id)).size).toBe(21);
 expect(wires.filter(w=>w.id.startsWith('motor-A'))).toHaveLength(2);
 expect(wires.filter(w=>w.id.startsWith('motor-B'))).toHaveLength(2);
 expect(wires.filter(w=>w.id.startsWith('power-reg-')).map(w=>w.to.bodyId)).toEqual(['electronics-regulator','electronics-regulator']);
 for(const wire of wires)for(const a of [wire.from,wire.to,...wire.via]){expect(doc.roots).toContain(a.bodyId);expect(a.point.every(Number.isFinite)).toBe(true);}
 expect(serializeDocument(doc)).toBe(before);
});
it('keeps cable endpoints on their bodies during separate simulation poses, reusing all tube buffers',()=>{
 const doc=createTTRoverDocument(),wires=robotWires(doc,kernel.evaluate(doc));const scene=new T.Scene(),bodies=new Map(doc.roots.map(id=>[id,new T.Object3D()]));
 const display=createRobotWiring(scene,()=>doc,id=>bodies.get(id));display.reset(wires);
 const group=scene.getObjectByName('Functional cable harnesses')!,mesh=group.children[0] as T.Mesh;
 const array=mesh.geometry.getAttribute('position').array,source=localToWorldPoint(wires[0].from.point,doc.nodes[wires[0].from.bodyId].transform),target=center(mesh,24);
 center(mesh,0).forEach((v,i)=>expect(v).toBeCloseTo(source[i],4));
 bodies.get(wires[0].from.bodyId)!.position.x=100;display.update();
 expect(mesh.geometry.getAttribute('position').array).toBe(array);
 center(mesh,0).forEach((v,i)=>expect(v).toBeCloseTo(source[i]+(i===0?100:0),4));
 center(mesh,24).forEach((v,i)=>expect(v).toBeCloseTo(target[i],4));
 const version=mesh.geometry.getAttribute('position').version;display.update();expect(mesh.geometry.getAttribute('position').version).toBe(version);
 bodies.delete(wires[0].from.bodyId);display.update();expect(mesh.visible).toBe(false);
 display.dispose();expect(scene.children).toHaveLength(0);
});
it('shows three servo conductors alongside the Atlas motor leads and omits print-only layouts',()=>{
 const doc=createAtlasForkliftDocument(),wires=robotWires(doc,kernel.evaluate(doc));
 expect(wires.filter(w=>w.id.startsWith('servo-C-'))).toHaveLength(3);
 expect(wires.some(w=>w.label.includes('signal'))).toBe(true);
 const print=createTTRoverDocument('robot-tt-rover-print');expect(robotWires(print,kernel.evaluate(print))).toEqual([]);
 const edited=createTTRoverDocument();delete edited.nodes['electronics-driver-0'];edited.roots=edited.roots.filter(id=>id!=='electronics-driver-0');edited.joints=edited.joints!.filter(j=>j.bodyA!=='electronics-driver-0'&&j.bodyB!=='electronics-driver-0');
 expect(robotWires(edited,kernel.evaluate(edited)).every(w=>w.to.bodyId!=='electronics-driver-0')).toBe(true);
});
