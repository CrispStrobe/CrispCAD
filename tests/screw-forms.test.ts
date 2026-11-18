// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {BufferGeometry,Float32BufferAttribute,Mesh,MeshBasicMaterial,DoubleSide,Raycaster,Vector3} from 'three';
import {screwVariant,screwTipStyles,parseDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function components(indices:readonly number[]){
 const parent=new Map<number,number>(),find=(i:number):number=>{if(!parent.has(i))parent.set(i,i);const p=parent.get(i)!;if(p!==i)parent.set(i,find(p));return parent.get(i)!;};
 for(let i=0;i<indices.length;i+=3){parent.set(find(indices[i+1]),find(indices[i]));parent.set(find(indices[i+2]),find(indices[i]));}
 return new Set([...parent.keys()].map(find)).size;
}
function sectionRadius(positions:readonly number[],indices:readonly number[],z:number){
 let radius=0;
 for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){
  const a=indices[i+j]*3,b=indices[i+(j+1)%3]*3,za=positions[a+2],zb=positions[b+2];
  if((za<=z&&zb>z)||(zb<=z&&za>z)){const t=(z-za)/(zb-za);radius=Math.max(radius,Math.hypot(positions[a]+t*(positions[b]-positions[a]),positions[a+1]+t*(positions[b+1]-positions[a+1])));}
 }
 return radius;
}
for(const headStyle of ['cylindrical','hex','countersunk','pan','headless'] as const)for(const [tipStyle]of screwTipStyles){
 it(`${headStyle} / ${tipStyle}: connected real solid, bounded thread and sensible point/head profile`,()=>{
  const recipe=screwVariant('socket-head-screw')!;Object.assign(recipe,{headStyle,tipStyle,tipLength:5,tipDiameter:6,cupDepth:1,driveStyle:headStyle==='hex'?'none':'cross',driveDepth:.8});recipe.values.slotWidth=2;
  const doc=createPresetDocument('screw','BW',{recipe}),body=kernel.evaluate(doc).bodies[0],{positions,indices}=body;
  expect(components(indices),'head, shaft and point must form one connected boundary').toBe(1);
  expect(body.bounds.min[2],'no free last half-profile past the shaft').toBeCloseTo(-20,4);
  if(headStyle==='pan'){expect(body.bounds.max[2]).toBeGreaterThan(4.9);expect(body.bounds.max[2]).toBeLessThanOrEqual(5);}
  else expect(body.bounds.max[2]).toBeCloseTo(headStyle==='headless'?0:headStyle==='countersunk'?3:5,4);
  const end=sectionRadius(positions,indices,-19.5);
  if(tipStyle==='gimlet'){expect(end).toBeGreaterThan(.52);expect(end).toBeLessThan(.7);}
  if(tipStyle==='cone')expect(end).toBeCloseTo(.6,2);
  if(tipStyle==='chamfer'){expect(end).toBeGreaterThan(3);expect(end).toBeLessThan(3.4);}
  if(tipStyle==='dog')expect(end).toBeCloseTo(3,2);
  if(tipStyle==='oval')expect(end).toBeGreaterThan(2);
  if(['flat','cup'].includes(tipStyle))expect(end,'thread must reach the end instead of stopping above a smooth band').toBeGreaterThan(5.5);
  if(headStyle!=='headless'){
   expect(sectionRadius(positions,indices,.4),'head must sit above its bearing plane').toBeGreaterThan(6);
   if(headStyle==='countersunk')expect(sectionRadius(positions,indices,2.5)).toBeGreaterThan(sectionRadius(positions,indices,.5));
   if(headStyle==='pan')expect(sectionRadius(positions,indices,4.8)).toBeLessThan(sectionRadius(positions,indices,2));
  }
  if(tipStyle==='cup'){
   const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex([...indices]);const material=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(geometry,material);mesh.updateMatrixWorld();
   const ray=new Raycaster(new Vector3(0,0,-20.1),new Vector3(0,0,1),0,.8);expect(ray.intersectObject(mesh)).toHaveLength(0);ray.ray.origin.x=4;expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);geometry.dispose();material.dispose();
  }
 });
}
it('both hands and two thread starts stay joined along a pointed lead-in',()=>{
 for(const hand of [-1,1]){const recipe=screwVariant('wood-screw')!;recipe.values.hand=hand;recipe.values.starts=2;const body=kernel.evaluate(createPresetDocument('screw','BW',{recipe})).bodies[0];expect(components(body.indices)).toBe(1);expect(body.bounds.min[2]).toBeCloseTo(-20,4);expect(sectionRadius(body.positions,body.indices,-19.5)).toBeGreaterThan(.43);}
});

it('headless drives use the shaft size, independent of the hidden former head diameter',()=>{
 const a=screwVariant('set-screw')!;a.driveStyle='cross';a.values.slotWidth=2;const b=structuredClone(a);b.values.headDiameter=120;
 const first=kernel.evaluate(createPresetDocument('screw','BW',{recipe:a})),second=kernel.evaluate(createPresetDocument('screw','BW',{recipe:b}));expect(first.volume).toBeCloseTo(second.volume,6);expect(first.bodies[0].bounds).toEqual(second.bodies[0].bounds);
 b.values.slotWidth=9;expect(()=>createPresetDocument('screw','BW',{recipe:b})).toThrow('material');
});

it('generic Screw and Thread also stop at their core ends while retaining legacy recipes',()=>{
 for(const preset of ['screw','thread']){const doc=createPresetDocument(preset),root=doc.nodes[doc.roots[0]],body=kernel.evaluate(doc).bodies[0];expect(root.generator?.version).toBe(1);expect(body.bounds.max[2]).toBeCloseTo(20,4);expect(body.bounds.min[2]).toBeCloseTo(preset==='screw'?-5:0,4);expect(components(body.indices)).toBe(1);}
});

it('retains older saved geometry even when a new recess of that size would be rejected',()=>{
 const d=createPresetDocument('set-screw'),id=d.roots[0];d.nodes[id].generator!.values.slotWidth=9;expect(parseDocument(JSON.stringify(d)).nodes[id].generator!.values.slotWidth).toBe(9);expect(()=>createPresetDocument('screw','BW',{recipe:d.nodes[id].generator})).toThrow('material');
});
