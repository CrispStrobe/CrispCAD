// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {basicGeneratorPresets,generatorFields,setLocale,t,checkGenerator,defaultGenerator,createCadSession,parseDocument,validateDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
let kernel:GeometryKernel;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
for(const preset of basicGeneratorPresets)it(`${preset} retains edited dimensions through regeneration, source, undo and persistence`,()=>{
 const session=createCadSession(createPresetDocument(preset)),id=session.state.document.roots[0],before=session.serialize(),r=defaultGenerator(preset)!;
 if(r.values.height!==undefined)r.values.height*=1.4;else r.values.majorRadius*=1.4;
 if(r.values.radius!==undefined)r.values.radius=2;
 if(preset==='capsule')r.values.length=58;
 if(preset==='polygon')r.values.sides=7;
 if(preset==='tube'||preset==='washer'){r.values.outerDiameter=42;r.values.wallThickness=3;}
 session.replaceGenerated(id,createPresetDocument(preset,'BW',{recipe:r}));const g=kernel.evaluate(session.state.document);expect(g.volume).toBeGreaterThan(0);expect(g.bodies).toHaveLength(1);expect(session.state.document.nodes[id].generator).toEqual(r);validateDocument(session.state.document);
 if(r.values.height!==undefined)expect(g.bodies[0].bounds.max[2]-g.bodies[0].bounds.min[2]).toBeCloseTo(r.values.height,4);
 if(preset==='tube'||preset==='washer'){const analytic=Math.PI*(21**2-18**2)*r.values.height;expect(Math.abs(g.volume-analytic)/analytic).toBeLessThan(.002);}
 const after=session.serialize();expect(parseDocument(after).nodes[id].generator).toEqual(r);session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(after);
 session.enableModelSource();expect(session.modelSource).toContain('generated(');expect(session.modelSource.length).toBeLessThan(5000);const source=session.modelSource;
 const key=r.values.height!==undefined?'height':'majorRadius',value=r.values[key]+1;session.applyModelSource(source.replace(`${key}: ${r.values[key]}`,`${key}: ${value}`),{regenerate:recipe=>createPresetDocument(recipe.preset,'BW',{recipe})});expect(session.state.document.nodes[id].generator!.values[key]).toBe(value);expect(kernel.evaluate(session.state.document).volume).toBeGreaterThan(0);session.dispose();
});
it('keeps a bore editable inside a retained cut, preserving identity, role and material',()=>{
 const s=createCadSession();const base=s.add({kind:'box',size:[60,60,15]});s.insert(createPresetDocument('tube'));const id=s.state.selection[0];s.update(id,{name:'Bearing seat',color:'#abcdef',transform:{position:[5,8,1],rotation:[0,0,20],scale:[1,1,1]}});s.setRole('hole',[id]);s.combine('union',[base,id]);const before=s.serialize(),r=defaultGenerator('tube')!;r.values.outerDiameter=38;r.values.wallThickness=4;s.replaceGenerated(id,createPresetDocument('tube','BW',{recipe:r}));expect(s.state.document.nodes[id].name).toBe('Bearing seat');expect(s.state.document.nodes[id].role).toBe('hole');expect(s.state.document.nodes[id].transform.position).toEqual([5,8,1]);expect(s.state.document.nodes[id].color).toBe('#abcdef');expect(kernel.evaluate(s.state.document).volume).toBeGreaterThan(0);validateDocument(s.state.document);s.undo();expect(s.serialize()).toBe(before);s.dispose();
});
it('rejects impossible wall, radius and discrete detail combinations without touching a document',()=>{
 const s=createCadSession(createPresetDocument('tube')),before=s.serialize();
 for(const [preset,key,value] of [['tube','wallThickness',15],['washer','wallThickness',16],['rounded-box','radius',10],['capsule','length',10],['torus','tubeRadius',15],['polygon','sides',4.5],['ellipse','segments',64.2]] as const){const r=defaultGenerator(preset)!;r.values[key]=value;expect(()=>checkGenerator(r)).toThrow();expect(()=>createPresetDocument(preset,'BW',{recipe:r})).toThrow();}
 expect(s.serialize()).toBe(before);expect(()=>createPresetDocument('tube','BW',{recipe:defaultGenerator('washer')})).toThrow();s.dispose();
});
it('supports sharp rounded-box limits and circular capsules without silently clamping parameters',()=>{
 for(const [preset,patch]of [['rounded-box',{radius:0}],['rounded-box',{radius:9.9}],['capsule',{length:20,width:20}],['frustum',{topDiameter:30,bottomDiameter:14}],['torus',{majorRadius:6,tubeRadius:5}]] as const){const r=defaultGenerator(preset)!;Object.assign(r.values,patch);const g=kernel.evaluate(createPresetDocument(preset,'BW',{recipe:r}));expect(g.volume).toBeGreaterThan(0);}
});

it('keeps legacy meshes unchanged until an explicit regeneration upgrades them',()=>{
 const old=createPresetDocument('tube'),id=old.roots[0];delete old.nodes[id].generator;old.version=1;const s=createCadSession(old),before=s.serialize();expect(s.state.document.nodes[id].generator).toBeUndefined();expect(s.serialize()).toBe(before);s.replaceGenerated(id,createPresetDocument('tube'));expect(s.state.document.version).toBe(2);expect(s.state.document.nodes[id].generator?.preset).toBe('tube');s.undo();expect(s.serialize()).toBe(before);s.dispose();
});
it('translates every dynamic basic-parameter label into German',()=>{
 setLocale('de');try{for(const preset of basicGeneratorPresets)for(const field of generatorFields(preset))expect(t(field.label),field.label).not.toBe(field.label);}finally{setLocale('en');}
});
