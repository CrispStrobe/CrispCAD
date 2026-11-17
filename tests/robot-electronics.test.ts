// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
import {robotElectronicsMounts,robotElectricalPlan} from '../packages/editor/src/robot-electronics.js';
import {componentAppearance} from '../packages/editor/src/component-appearance.js';
import {robotWires} from '../packages/editor/src/robot-wiring.js';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const expected:Record<string,[number,number]>={
 'tt-rover':[2,0],'steerable-rover':[2,1],'atlas-forklift':[3,1],'mantis-walker':[0,3],
 'cyclone-sorter':[2,1],'helios-catapult':[0,3],'labyrinth-tilter':[0,3],'apex-scara':[1,2],
 'orion-carousel':[1,2],'vortex-pinball':[1,2],'titan-vise':[2,1],'hermes-crane':[2,1],
 'chronos-drawbridge':[1,2],'polaris-tracker':[1,2],'boreal-launcher':[2,1],'zephyr-conveyor':[2,1],
 'quasar-press':[2,1],'nova-loader':[2,1],'vector-plotter':[2,1],'aegis-sentry':[1,2],
 'stratos-gimbal':[0,3],'kestrel-arm':[0,3],
};
for(const [name,[motors,servos]]of Object.entries(expected))it(`${name}: controller, power, driver capacity, mounts and complete actuator harnesses`,()=>{
 const id='robot-'+name,doc=parseDocument(serializeDocument(createPresetDocument(id))),plan=robotElectricalPlan(doc),geometry=kernel.evaluate(doc);
 expect(Object.keys(robotElectronicsMounts)).toHaveLength(22);
 expect(plan.motors).toHaveLength(motors);expect(plan.servos).toHaveLength(servos);
 expect(doc.nodes['electronics-controller'].physics?.parameters).toEqual({clockHz:16000000,logicV:5,motorSupplyV:6});
 expect(doc.nodes['electronics-controller'].physics?.sourcePreset).toBe('visual-metro-mini');
 expect(doc.provenance!.records.some(r=>r.id==='adafruit-metro-mini-2590-appearance'&&r.asset.licence.spdx==='MIT')).toBe(true);
 expect(doc.provenance!.records.some(r=>r.id==='adafruit-buck-4739-appearance')).toBe(true);
 expect(doc.roots.filter(id=>id.startsWith('electronics-driver-'))).toHaveLength(Math.ceil(motors/2));
 expect(doc.roots.includes('electronics-servo-bus')).toBe(servos>0);
 const power=doc.nodes['electronics-power']??doc.nodes['battery-envelope'];expect(power).toBeDefined();
 expect(['visual-power-source','visual-aa-holder-830']).toContain(power.physics?.sourcePreset);
 for(const id of ['electronics-controller','electronics-regulator']){
  expect(doc.roots).toContain(id);const mesh=componentAppearance(doc.nodes[id])!;expect(mesh).toBeDefined();expect(mesh.getAttribute('position').count).toBeGreaterThan(1000);mesh.dispose();
 }
 for(const joint of doc.joints!.filter(j=>j.id.startsWith('electronics-fixed-'))){
  const a=doc.nodes[joint.bodyA].transform,b=doc.nodes[joint.bodyB].transform;
  const pa=localToWorldPoint(joint.anchorA,a),pb=localToWorldPoint(joint.anchorB,b),aa=rotatePoint(joint.axisA,a.rotation),ab=rotatePoint(joint.axisB,b.rotation);
  expect(Math.hypot(...pa.map((v,i)=>v-pb[i]))).toBeLessThan(1e-8);expect(Math.hypot(...aa.map((v,i)=>v-ab[i]))).toBeLessThan(1e-8);
 }
 for(const node of Object.values(doc.nodes).filter(n=>['visual-power-source','visual-encoder','visual-dc-drive','visual-servo-bus'].includes(n.physics?.sourcePreset??''))){const visual=componentAppearance(node)!;expect(visual,node.id).toBeDefined();expect(visual.getAttribute('position').count).toBeGreaterThan(24);visual.dispose();}
 const wires=robotWires(doc,geometry);expect(wires.length).toBeGreaterThan(10);expect(new Set(wires.map(w=>w.id)).size).toBe(wires.length);
 for(const {joint,driver,pins}of plan.motors){
  const port=joint.control!.port;
  expect(wires.filter(w=>w.id.startsWith('motor-'+port+'-'))).toHaveLength(2);
  for(let i=0;i<3;i++)expect(wires.find(w=>w.id==='control-'+port+'-'+i)?.label).toContain('D'+pins[i]);
  expect(wires.some(w=>w.from.bodyId===driver)).toBe(true);
 }
 for(const {joint,pin}of plan.servos){const cables=wires.filter(w=>w.id.startsWith('servo-'+joint.control!.port+'-'));expect(cables).toHaveLength(3);expect(cables.some(w=>w.label.includes('D'+pin))).toBe(true);}
 // Component clearance boxes must not overlap each other. The tray/posts are
 // intentionally separate supports; moving ballast is checked by motion tests.
 const equipment=geometry.bodies.filter(b=>/^electronics-(controller|regulator|power$|driver-|servo-bus$)/.test(b.id));
 for(let i=0;i<equipment.length;i++)for(let j=i+1;j<equipment.length;j++){
  const a=equipment[i],b=equipment[j];const overlap=a.bounds.min.every((v,k)=>Math.min(a.bounds.max[k],b.bounds.max[k])-Math.max(v,b.bounds.min[k])>1e-5);
  expect(overlap,`${id}: ${a.id} intersects ${b.id}`).toBe(false);
 }
});
