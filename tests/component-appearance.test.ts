// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {parseDocument,serializeDocument,identityTransform} from '@brickwright/cad-core';
import {componentAppearance} from '../packages/editor/src/component-appearance.js';
import {createTTRoverDocument} from '../packages/editor/src/tt-rover.js';
import {createSteerableRoverDocument} from '../packages/editor/src/steerable-rover.js';
import {createMotorDocument} from '../packages/editor/src/motor-models.js';

it('saves explicit licensed display references while preserving Scout colliders and drive ownership',()=>{
 const doc=parseDocument(serializeDocument(createTTRoverDocument('robot-tt-rover')));
 expect(doc.nodes['electronics-controller'].kind).toBe('box');
 expect(doc.nodes['battery-envelope'].kind).toBe('box');
 expect(doc.joints!.filter(j=>j.control).map(j=>j.control?.port)).toEqual(['A','B']);
 expect(doc.provenance!.records.map(r=>r.id)).toContain('adafruit-metro-mini-2590-appearance');
 expect(doc.provenance!.records.map(r=>r.id)).toContain('adafruit-holder-830-appearance');
 expect(doc.nodes['electronics-driver-0'].name).toContain('H-bridge');
 expect(doc.nodes['electronics-controller']).not.toHaveProperty('positions');
 expect(doc.nodes['battery-envelope']).not.toHaveProperty('positions');
 const before=serializeDocument(doc);
 for(const id of ['electronics-controller','battery-envelope','electronics-driver-0']){
  const node=doc.nodes[id];const g=componentAppearance(node,doc.nodes)!;
  expect(g.getAttribute('position').count).toBeGreaterThan(100);
  expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
  expect([...g.getAttribute('position').array].every(Number.isFinite)).toBe(true);
  g.computeBoundingBox();expect(g.boundingBox!.isEmpty()).toBe(false);g.dispose();
 }
 expect(serializeDocument(doc)).toBe(before);
});
it('uses actual 22.86 x 50.8 mm Feather outline and USB geometry, without stretching to its envelope',()=>{
 const doc=createTTRoverDocument('robot-tt-rover');const node=structuredClone(doc.nodes['electronics-controller']);node.transform=identityTransform();
 if(node.kind==='box')node.size=[22.86,50.8,8];node.physics!.sourcePreset='visual-feather-rp2040';
 const g=componentAppearance(node)!;g.computeBoundingBox();const b=g.boundingBox!;
 expect(b.min.x).toBeCloseTo(-11.43,1);expect(b.max.x).toBeCloseTo(11.43,1);
 expect(b.min.y).toBeLessThan(-25.4);expect(b.max.y).toBeCloseTo(25.4,1);
 expect(b.min.z).toBeCloseTo(-4,1);expect(b.max.z).toBeGreaterThan(2);g.dispose();
});
it('tracks body transforms and falls back to editable geometry after a collider dimension change',()=>{
 const doc=createTTRoverDocument('robot-tt-rover');const node=doc.nodes['electronics-controller'];
 const a=componentAppearance(node)!;node.transform.position[0]+=100;const b=componentAppearance(node)!;
 expect(b.getAttribute('position').getX(0)-a.getAttribute('position').getX(0)).toBeCloseTo(100,4);a.dispose();b.dispose();
 if(node.kind==='box')node.size[0]+=1;expect(componentAppearance(node)).toBeUndefined();
});
it('does not substitute a differently sized Trident battery with an incompatible holder',()=>{
 const doc=createSteerableRoverDocument('robot-steerable-rover');
 const feather=componentAppearance(doc.nodes['electronics-controller']);expect(feather).toBeDefined();feather!.dispose();
 expect(doc.nodes['battery-envelope'].physics!.sourcePreset).toBe('visual-power-source');
 const battery=componentAppearance(doc.nodes['battery-envelope']);expect(battery).toBeDefined();battery!.dispose();
});
for(const id of ['tt-gearmotor','dc-toy-motor','micro-servo-1143'])it(`${id}: distinct source-solid materials keep the articulated shaft and edited shapes intact`,()=>{
 const doc=createMotorDocument(id);const before=serializeDocument(doc);
 const g=componentAppearance(doc.nodes.casing,doc.nodes)!;expect(g).toBeDefined();
 const c=g.getAttribute('color'),colours=new Set(Array.from({length:c.count},(_,i)=>[c.getX(i),c.getY(i),c.getZ(i)].join(',')));
 expect(colours.size).toBeGreaterThan(1);expect(componentAppearance(doc.nodes.shaft,doc.nodes)).toBeUndefined();
 expect(serializeDocument(doc)).toBe(before);g.dispose();
 const casing=doc.nodes.casing;if(casing.kind==='boolean'){
  const child=doc.nodes[casing.inputs[0]];if(child.kind==='mesh')child.positions[0]+=.2;
 }
 expect(componentAppearance(doc.nodes.casing,doc.nodes)).toBeUndefined();
});
