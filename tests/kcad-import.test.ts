// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,importKernelCAD} from '@brickwright/cad-core';
import {createGeometryKernel,type GeometryKernel} from '@brickwright/cad-geometry';
// @ts-expect-error untyped script module
import {convertKernelCAD} from '../scripts/convert-kcad.mjs';

let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const evaluate=(program:import('@brickwright/cad-core').CodeProgram)=>{const s=createCadSession();s.addCode(program);const r=kernel.evaluate(s.state.document);s.dispose();return r;};
const mit="meta({ name: 'ref', license: 'MIT' });\n";

// Scorecard sources from kernelCAD's assets/reference-parts/scorecard (MIT) with
// their analytic volumes and bboxes. Default conversion uses 48 segments, so curved
// parts carry the inscribed-polygon error (about 3e-3).
const parts:[string,string,number,number[],number[],number][]=[
 ['rectangular-block','return box(40, 30, 20);',24000,[0,0,0],[40,30,20],1e-9],
 ['centered-block','return box(24, 18, 6, true);',2592,[-12,-9,-3],[12,9,3],1e-9],
 ['cylinder','return cylinder(50, 10);',15707.963267948966,[-10,-10,0],[10,10,50],5e-3],
 ['cone-frustum-revolve','return path().moveTo(0, 0).lineTo(10, 0).lineTo(6, 20).lineTo(0, 20).close().revolve();',4105.014400690663,[-10,-10,0],[10,10,20],5e-3],
 ['annular-cylinder','return cylinder(20, 15).subtract(cylinder(20, 5));',12566.370614359172,[-15,-15,0],[15,15,20],5e-3],
 ['l-bracket-union','const base = box(40, 20, 8);\nconst wall = box(8, 20, 20).translate(0, 0, 8);\nreturn base.union(wall);',9600,[0,0,0],[40,20,28],1e-9],
 ['boolean-intersection','const a = box(20, 20, 20);\nconst b = box(10, 30, 20).translate(5, -5, 0);\nreturn a.intersect(b);',4000,[5,0,0],[15,20,20],1e-9],
 ['plate-through-slot','const plate = box(50, 30, 10);\nconst slot = box(20, 8, 12).translate(15, 11, -1);\nreturn plate.subtract(slot);',13400,[0,0,0],[50,30,10],1e-9],
 ['mirrored-blocks',"const block = box(10, 10, 10).translate(10, 0, 0);\nreturn block.union(block.mirror('yz'));",2000,[-20,0,0],[20,10,10],1e-9],
 ['loft-square-frustum','const bottom = path().moveTo(-10, -10).lineTo(10, -10).lineTo(10, 10).lineTo(-10, 10).close();\nconst top = path().moveTo(-6, -6).lineTo(6, -6).lineTo(6, 6).lineTo(-6, 6).close();\nreturn bottom.loft(top, { spacing: 10 });',2613.3333333333335,[-10,-10,0],[10,10,10],1e-9],
 ['stepped-shaft-revolve','return path().moveTo(0, 0).lineTo(4, 0).lineTo(4, 10).lineTo(8, 10).lineTo(8, 20).lineTo(0, 20).close().revolve();',2513.2741228718346,[-8,-8,0],[8,8,20],5e-3],
 ['rotated-box','return box(40, 20, 5).rotate([0, 0, 1], 30);',4000,[-10,0,0],[34.64101615137755,37.32050807568877,5],1e-9],
 ['loft-circular-frustum',`function circularSection(radius) {
  const diagonal = Math.SQRT1_2;
  return path().moveTo(radius, 0)
    .threePointsArc(0, radius, radius * diagonal, radius * diagonal)
    .threePointsArc(-radius, 0, -radius * diagonal, radius * diagonal)
    .threePointsArc(0, -radius, -radius * diagonal, -radius * diagonal)
    .threePointsArc(radius, 0, radius * diagonal, -radius * diagonal)
    .close();
}
return circularSection(10).loft(circularSection(5), { spacing: 20 });`,3665.1914291880917,[-10,-10,0],[10,10,20],2e-2],
];

describe('kernelCAD .kcad converter',()=>{
 for(const [id,source,volume,min,max,tolerance] of parts)it(`matches the ${id} reference part`,()=>{
  const converted=importKernelCAD(mit+source);expect(converted.parts).toHaveLength(1);
  const r=evaluate(converted.parts[0].program);
  expect(Math.abs(r.volume-volume)/volume).toBeLessThanOrEqual(tolerance);
  for(let i=0;i<3;i++){expect(r.bodies[0].bounds.min[i]).toBeCloseTo(min[i],1);expect(r.bodies[0].bounds.max[i]).toBeCloseTo(max[i],1);}
 });

 it('refuses models without an accepted content licence',()=>{
  expect(()=>importKernelCAD('return box(1, 1, 1);')).toThrow(/CC-BY-4.0 is not accepted/);
  expect(()=>importKernelCAD("meta({ license: 'CC-BY-SA-4.0' });\nreturn box(1, 1, 1);")).toThrow(/not accepted/);
  expect(importKernelCAD("meta({ license: 'CC0-1.0' });\nreturn box(1, 1, 1);").license).toBe('CC0-1.0');
 });

 it('reports unsupported constructs and never executes the source',()=>{
  expect(()=>importKernelCAD(mit+'return box(10, 10, 10).fillet(1);')).toThrow(/Unsupported kernelCAD feature “shape.fillet”/);
  expect(()=>importKernelCAD(mit+'globalThis.x = 1; return box(1, 1, 1);')).toThrow(/Unknown kernelCAD name/);
  expect(()=>importKernelCAD(mit+'while (true) {}')).toThrow(/loop limit/);
  expect(()=>importKernelCAD(mit+'const s: number = 1; return box(s, s, s);')).toThrow(/strip TypeScript/);
 });

 it('converts a CC0 catalog assembly into coloured parts with parameter overrides',()=>{
  const source=readFileSync('tests/fixtures/kcad/reflector-board.kcad.ts','utf8'),converted=convertKernelCAD(source);
  expect(converted.license).toBe('CC0-1.0');expect(converted.title).toBe('Reflector board');
  expect(converted.parts.map((p:{name:string})=>p.name)).toEqual(['left-panel','right-panel','hinge','kickstand','kickstand-foot']);
  expect(converted.parts[0].color).toBe('#d0d7d7');
  const base=evaluate(converted.parts[0].program).volume,scaled=evaluate(convertKernelCAD(source,{scale:1.2}).parts[0].program).volume;
  expect(scaled/base).toBeCloseTo(1.2**3,6);
 });

 for(const file of ['tripod-work-light','air-rinse-enclosure'])it(`evaluates every part of the CC0 ${file} model`,()=>{
  const converted=convertKernelCAD(readFileSync(`tests/fixtures/kcad/${file}.kcad.ts`,'utf8'));
  expect(converted.skippedParts).toEqual([]);expect(converted.parts.length).toBeGreaterThan(3);
  for(const part of converted.parts)expect(evaluate(part.program).volume).toBeGreaterThan(0);
 });
});
