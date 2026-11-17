// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint,validateModelLibraryCatalogue} from '@brickwright/cad-core';
import {createTTRoverDocument,createTTRoverPart,ttRoverPartPrograms,ttRoverPrintQuantities,TT_ROVER_ID} from '../packages/editor/src/tt-rover.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});

it('ships an editable A/B rover with retained Adafruit provenance and a free moving base',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(TT_ROVER_ID)));
 expect(shapeCatalog.some(p=>p.id===TT_ROVER_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(false);
 const drives=doc.joints!.filter(j=>j.kind==='hinge');expect(drives.map(j=>j.control?.port)).toEqual(['A','B']);
 expect(drives.map(j=>j.bodyB)).toEqual(['left-shaft','right-shaft']);
 for(const joint of doc.joints!){
  const a=doc.nodes[joint.bodyA].transform,b=doc.nodes[joint.bodyB].transform;
  const pa=localToWorldPoint(joint.anchorA,a),pb=localToWorldPoint(joint.anchorB,b);
  expect(Math.hypot(...pa.map((v,i)=>v-pb[i]))).toBeLessThan(1e-8);
  expect(rotatePoint(joint.axisA,a.rotation)).toEqual(rotatePoint(joint.axisB,b.rotation));
 }
 const provenance=doc.provenance!.records;
 expect(provenance).toHaveLength(4);expect(provenance[0].asset.licence.spdx).toBe('MIT');
 expect(validateModelLibraryCatalogue({format:'brickwright-model-library',version:1,assets:provenance.map(p=>p.asset)}).valid).toBe(true);
 expect(doc.roots.filter(id=>doc.nodes[id].kind==='code'&&doc.nodes[id].physics?.sourcePreset===TT_ROVER_ID)).toHaveLength(12);
 expect(doc.roots.every(id=>doc.nodes[id].physics?.motion==='dynamic')).toBe(true);
 expect(Buffer.byteLength(serializeDocument(doc))).toBeLessThan(16*1024*1024);
});

it('separates manufacturing geometry from purchased hardware and imports in one history step',()=>{
 const print=createTTRoverDocument('robot-tt-rover-print');
 expect(print.roots).toHaveLength(12);expect(print.joints).toBeUndefined();expect(print.provenance).toBeUndefined();
 expect(print.roots.every(id=>print.nodes[id].kind==='code'&&print.nodes[id].physics?.sourcePreset===TT_ROVER_ID)).toBe(true);
 expect(Object.values(ttRoverPrintQuantities).reduce((a,b)=>a+b,0)).toBe(12);
 const session=createCadSession();session.insert(createTTRoverDocument());
 expect(session.state.document.simulation?.fixBase).toBe(false);
 expect(session.state.document.joints!.filter(j=>j.control).map(j=>j.control?.port)).toEqual(['A','B']);
 session.undo();expect(session.state.document.roots).toHaveLength(0);
 session.redo();expect(session.state.document.simulation?.fixBase).toBe(false);session.dispose();
});

for(const part of Object.keys(ttRoverPartPrograms) as (keyof typeof ttRoverPartPrograms)[])it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
 const geometry=kernel.evaluate(createTTRoverPart(part));expect(geometry.bodies).toHaveLength(1);
 const b=geometry.bodies[0];expect(b.bounds.min[2]).toBeCloseTo(0,5);expect(b.volume).toBeGreaterThan(0);
 for(let i=0;i<3;i++)expect(b.bounds.max[i]-b.bounds.min[i]).toBeLessThanOrEqual(180);
 const screened=await checkModelLibrarySTL(exportSTL(geometry.bodies),{checkedOn:'2026-11-15',toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],maxExtentMm:180});
 expect(Object.values(screened.checks)).toEqual(['pass','pass','pass','pass']);
});

it('retains a true double-D keyed bore and independently editable clearance',()=>{
 const doc=createTTRoverPart('wheel'),original=kernel.evaluate(doc).volume;
 const wheel=doc.nodes.wheel;if(wheel.kind!=='code')throw new Error('Expected retained code');
 wheel.program.parameters.clearance='0.55 mm';expect(kernel.evaluate(doc).volume).toBeLessThan(original);
 expect(wheel.program.source).toContain('shaftFlats');
});
