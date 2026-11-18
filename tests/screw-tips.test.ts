// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {checkGenerator,screwVariant,screwTipStyles,parseDocument,createCadSession} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
let kernel:GeometryKernel;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
for(const [tipStyle]of screwTipStyles)for(const preset of ['socket-head-screw','set-screw'])it(`${preset}: ${tipStyle} is a closed, single solid with nominal length and a retained recipe`,()=>{
 const recipe=screwVariant(preset)!;Object.assign(recipe,{tipStyle,tipLength:4,tipDiameter:6,cupDepth:1});const doc=createPresetDocument(preset,'BW',{recipe}),g=kernel.evaluate(doc);expect(g.bodies).toHaveLength(1);expect(g.volume).toBeGreaterThan(50);expect(g.bodies[0].bounds.min[2]).toBeCloseTo(-20,4);expect(g.bodies[0].bounds.max[2]).toBeCloseTo(preset==='set-screw'?0:5,4);expect(parseDocument(JSON.stringify(doc)).nodes[doc.roots[0]].generator).toEqual(recipe);
 const body=g.bodies[0],edges=new Map<string,number>();for(let i=0;i<body.indices.length;i+=3)for(let j=0;j<3;j++){const a=body.indices[i+j],b=body.indices[i+(j+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`;edges.set(key,(edges.get(key)??0)+1);}expect([...edges.values()].every(v=>v===2)).toBe(true);
});
it('an omitted point style generates a bounded flat end without a floating half-profile',()=>{const recipe=screwVariant('socket-head-screw')!,doc=createPresetDocument('socket-head-screw','BW',{recipe}),g=kernel.evaluate(doc);expect(recipe.tipStyle).toBeUndefined();expect(g.bodies[0].bounds.min[2]).toBeCloseTo(-20,4);});
it('refuses impossible pilot, cup and length parameters',()=>{for(const patch of [{tipLength:20},{tipDiameter:12},{tipStyle:'dog',tipDiameter:11},{tipStyle:'cup',cupDepth:3.8},{tipStyle:'patented-brand'}]){const r={...screwVariant('set-screw')!,tipStyle:'cup',tipLength:4,tipDiameter:6,cupDepth:1,...patch};expect(()=>checkGenerator(r)).toThrow('point');}});
it('regeneration preserves identity, placement and undo with editable point dimensions',()=>{const s=createCadSession(createPresetDocument('wood-screw')),id=s.state.document.roots[0];s.transform([{id,transform:{position:[12,3,4],rotation:[0,25,13],scale:[1,1,1]}}]);const before=s.serialize(),r=screwVariant('wood-screw')!;r.tipLength=8;s.replaceGenerated(id,createPresetDocument('wood-screw','BW',{recipe:r}));expect(s.state.document.nodes[id].generator?.tipLength).toBe(8);expect(s.state.document.nodes[id].transform.position).toEqual([12,3,4]);s.undo();expect(s.serialize()).toBe(before);});
