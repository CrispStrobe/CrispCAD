// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {applyParametricBindings,createCadSession,validateDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import type {Vec3} from '@brickwright/cad-core';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';
import {placeFragment,placementFrame} from '../packages/editor/src/surface-placement.js';
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const anchor=(doc:ReturnType<typeof createPresetDocument>):Vec3=>{const boxes=kernel.evaluate(doc).bodies.map(b=>b.bounds),min=[0,1,2].map(i=>Math.min(...boxes.map(b=>b.min[i]))),max=[0,1,2].map(i=>Math.max(...boxes.map(b=>b.max[i])));return [(min[0]+max[0])/2,(min[1]+max[1])/2,min[2]];};
it('builds orthonormal, right-handed placement frames on top, sides and tilted surfaces',()=>{
 for(const normal of [[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,1,0],[.3,.5,.8]] as Vec3[]){const f=placementFrame(normal);expect(f.x.dot(f.y)).toBeCloseTo(0);expect(f.x.clone().cross(f.y).dot(f.z)).toBeCloseTo(1);expect(new T.Vector3(0,0,1).applyQuaternion(f.q).distanceTo(new T.Vector3(...normal).normalize())).toBeLessThan(1e-10);}
});
it('places every essential preset on a face without flattening recipes, joints or source',()=>{
 for(const preset of shapeCatalog.filter(p=>!p.additional)){const doc=createPresetDocument(preset.id,'BW'),before=JSON.stringify(doc),placed=placeFragment(doc,{point:[40,20,30],normal:[1,0,0],rotation:[0,90,0],base:anchor(doc),snapped:true});validateDocument(placed);const result=kernel.evaluate(placed),min=Math.min(...result.bodies.map(b=>b.bounds.min[0]));expect(min,preset.id).toBeCloseTo(40,3);expect(JSON.stringify(doc)).toBe(before);expect(placed.nodes[placed.roots[0]].generator).toEqual(doc.nodes[doc.roots[0]].generator);expect(placed.joints).toEqual(doc.joints);}
},30000); // Batch evaluates every essential preset twice; keep geometric assertions unchanged.
it('retains driven translations and rotations after placement and later parameter edits',()=>{
 const s=createCadSession(),id=s.add({kind:'box',size:[10,8,6]});s.setParametric({version:1,parameters:{distance:{expression:'12',unit:'mm'},angle:{expression:'20',unit:'deg'}},bindings:[{nodeId:id,property:'positionX',expression:'distance'},{nodeId:id,property:'rotationZ',expression:'angle'}]});
 const source=s.state.document,base=anchor(source),normal:[number,number,number]=[.3,.5,.8],placed=placeFragment(source,{point:[40,20,30],normal,rotation:placementFrame(normal).rotation,base,snapped:true});validateDocument(placed);placed.parametric!.parameters.distance.expression='24';placed.parametric!.parameters.angle.expression='40';applyParametricBindings(placed);validateDocument(placed);
 const expected=structuredClone(source);expected.parametric!.parameters.distance.expression='24';expected.parametric!.parameters.angle.expression='40';applyParametricBindings(expected);const fresh=placeFragment(expected,{point:[40,20,30],normal,rotation:placementFrame(normal).rotation,base,snapped:true});for(let i=0;i<3;i++){expect(placed.nodes[id].transform.position[i]).toBeCloseTo(fresh.nodes[id].transform.position[i],6);expect(placed.nodes[id].transform.rotation[i]).toBeCloseTo(fresh.nodes[id].transform.rotation[i],6);}
});
