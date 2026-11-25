// SPDX-License-Identifier: BSD-3-Clause
// Semantics of the `.kcad.ts` converter that the catalog cross-check pinned down
// (experiments/catalog-crosscheck): exact cylinders whatever the segment argument, tori
// faceted only in the tube, `await shape.boundingBox({ exact: true })`, negative box sizes
// and `extrudeRoundedRect` axes. Each case is checked against a closed form with the exact
// kernel (no faceting) and with Manifold (within the faceting of 48 segments).
import {readFileSync} from 'node:fs';
import {beforeAll,describe,expect,it} from 'vitest';
import {compileCode,createCadSession,importKernelCAD} from '@brickwright/cad-core';
import type {CodeProgram} from '@brickwright/cad-core';
import {createGeometryKernel,type GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,type ExactBackend} from '@brickwright/cad-exact';
import {exactShapeBounds} from '../packages/core/src/kcad-bounds.js';

let manifold:GeometryKernel,exact:ExactBackend;
beforeAll(async()=>{[manifold,exact]=await Promise.all([createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),createExactBackend()]);},120_000);
const mit="meta({ name: 'ref', license: 'MIT' });\n";
const convert=(source:string)=>importKernelCAD(mit+source);
const only=(source:string)=>{const c=convert(source);expect(c.parts).toHaveLength(1);return c.parts[0].program;};
function measure(program:CodeProgram){
 const s=createCadSession();s.addCode(program);const doc=s.state.document;
 try{const mesh=manifold.evaluate(doc).bodies[0],solid=exact.measure(doc).bodies[0];return {manifold:mesh,exact:solid};}finally{s.dispose();}
}
const rel=(a:number,b:number)=>Math.abs(a-b)/Math.abs(b);
const facet48=1-Math.sin(2*Math.PI/48)/(2*Math.PI/48); // inscribed 48-gon area deficit

describe('kcad cylinder and torus semantics',()=>{
 it('emits a true cylinder whatever the segment argument',()=>{
  for(const n of ['', ', 6', ', 8', ', 64']){
   const program=only(`return cylinder(30, 10${n});`);
   expect(program.source).toBe('return move([0, 0, 15], cylinder(10, 30));');
   const m=measure(program),V=Math.PI*100*30;
   expect(rel(m.exact.volume,V)).toBeLessThan(1e-9);
   expect(rel(m.manifold.volume,V)).toBeLessThan(facet48*1.01);
   expect(m.exact.bounds.min).toEqual([expect.closeTo(-10,6),expect.closeTo(-10,6),expect.closeTo(0,6)]);
   expect(m.exact.bounds.max).toEqual([expect.closeTo(10,6),expect.closeTo(10,6),expect.closeTo(30,6)]);
  }
 });

 it('builds an exact torus without a segment count',()=>{
  const program=only('return torus(20, 5);');
  expect(program.source).toBe('return torus(20, 5);');
  const V=2*Math.PI**2*20*25,m=measure(program);
  expect(rel(m.exact.volume,V)).toBeLessThan(1e-6);
  expect(rel(m.manifold.volume,V)).toBeLessThan(2.2*facet48);
 });

 it('facets only the tube of torus(R, r, n): an n-gon revolved exactly',()=>{
  // Pappus: V = 2πR · A, A = (n/2) r² sin(2π/n) for the regular n-gon tube.
  for(const n of [6,8,12]){
   const program=only(`return torus(20, 5, ${n});`);
   expect(program.source).toMatch(/^return revolve\(polygon2d\(/);
   const V=2*Math.PI*20*(n/2)*25*Math.sin(2*Math.PI/n),m=measure(program);
   expect(rel(m.exact.volume,V)).toBeLessThan(1e-6);
   expect(rel(m.manifold.volume,V)).toBeLessThan(facet48*1.01);
   // The first vertex sits on the outer equator, so the ring reaches R + r.
   expect(m.exact.bounds.max[0]).toBeCloseTo(25,6);
  }
 });

 it('keeps path().circle exact without a count and polygonal with one',()=>{
  const exactCircle=only('return path().circle(3, 4, 10).extrude(5);');
  expect(exactCircle.source).toBe('return extrudeProfile(5, move2d(3, 4, circle2d(10)));');
  expect(rel(measure(exactCircle).exact.volume,Math.PI*100*5)).toBeLessThan(1e-9);
  const hexagon=only('return path().circle(0, 0, 10, 6).extrude(5);');
  expect(hexagon.source).toMatch(/polygon2d/);
  expect(rel(measure(hexagon).exact.volume,1.5*Math.sqrt(3)*100*5)).toBeLessThan(1e-7); // vertices written to 6 decimals
 });
});

describe('kcad boxes and rounded rectangles',()=>{
 it('spans [size, 0] for negative box sizes and |size| when centred',()=>{
  const corner=measure(only('return box(-10, 20, -5);'));
  expect(corner.exact.volume).toBeCloseTo(1000,6);
  expect(corner.exact.bounds.min).toEqual([expect.closeTo(-10,6),expect.closeTo(0,6),expect.closeTo(-5,6)]);
  expect(corner.manifold.bounds.max).toEqual([expect.closeTo(0,4),expect.closeTo(20,4),expect.closeTo(0,4)]);
  const centred=measure(only('return box(-10, 20, 4, true);'));
  expect(centred.manifold.bounds.min).toEqual([expect.closeTo(-5,4),expect.closeTo(-10,4),expect.closeTo(-2,4)]);
  expect(()=>convert('return box(0, 1, 1);')).toThrow(/nonzero/);
 });

 it('maps extrudeRoundedRect axes and clamps the radius',()=>{
  // 40 × 30 rectangle with r = 5 corners, swept 10 mm: A = 40·30 − (4 − π)·25.
  const A=1200-(4-Math.PI)*25,V=A*10;
  const z=measure(only('return extrudeRoundedRect(40, 30, 5, 10);'));
  expect(rel(z.exact.volume,V)).toBeLessThan(1e-9);
  expect(z.exact.bounds.min).toEqual([expect.closeTo(-20,6),expect.closeTo(-15,6),expect.closeTo(0,6)]);
  // axis 'x': (x, y, z) -> (z, x, y): sweep +X, width along Y, height along Z.
  const x=measure(only("return extrudeRoundedRect(40, 30, 5, 10, { axis: 'x' });"));
  expect(rel(x.exact.volume,V)).toBeLessThan(1e-9);
  expect(x.exact.bounds.min).toEqual([expect.closeTo(0,6),expect.closeTo(-20,6),expect.closeTo(-15,6)]);
  expect(x.exact.bounds.max).toEqual([expect.closeTo(10,6),expect.closeTo(20,6),expect.closeTo(15,6)]);
  // axis 'y': (x, y, z) -> (x, z, -y): sweep +Y, width along X, height along Z.
  const y=measure(only("return extrudeRoundedRect(40, 30, 5, 10, { axis: 'y' });"));
  expect(y.exact.bounds.min).toEqual([expect.closeTo(-20,6),expect.closeTo(0,6),expect.closeTo(-15,6)]);
  expect(y.exact.bounds.max).toEqual([expect.closeTo(20,6),expect.closeTo(10,6),expect.closeTo(15,6)]);
  // An oversized radius is clamped just below half the shorter side (a near-stadium), not refused.
  const clamped=measure(only('return extrudeRoundedRect(40, 30, 20, 10);'));
  expect(rel(clamped.exact.volume,(1200-(4-Math.PI)*225)*10)).toBeLessThan(1e-3);
  expect(()=>convert("return extrudeRoundedRect(40, 30, 5, 10, { axis: 'w' });")).toThrow(/extrudeRoundedRect axis w/);
  expect(()=>convert('return extrudeRoundedRect(40, 30, 5, 10, { twistAngle: 15 });')).toThrow(/twistAngle/);
 });
});

describe('kcad boundingBox',()=>{
 it('evaluates await shape.boundingBox({ exact: true }) at conversion time',()=>{
  const c=convert(`const parts = [box(10, 10, 10).translate(0, 0, -3), sphere(4).translate(20, 0, 2), cylinder(6, 2, 8).rotateX(90)];
let lowest = Infinity;
for (const shape of parts) lowest = Math.min(lowest, (await shape.boundingBox({ exact: true })).min[2]);
const a = assembly('a');
parts.forEach((shape, i) => a.part('p' + i, shape.translate(0, 0, -lowest)));
return a.model();`);
  // Lowest point: the box at z = -3 (the sphere reaches -2, the lying cylinder -2).
  expect(c.parts.map(p=>p.program.source)[0]).toBe('return move([0, 0, 3], move([0, 0, -3], move([5, 5, 5], box(10, 10, 10))));');
  const bb=convert('const b = await cylinder(10, 3).rotateX(90).boundingBox({ exact: true });\nreturn box(b.size[0], b.size[1], b.size[2]).translate(b.min[0], b.min[1], b.min[2]);');
  const m=measure(bb.parts[0].program);
  expect(m.exact.bounds.min).toEqual([expect.closeTo(-3,9),expect.closeTo(-10,9),expect.closeTo(-3,9)]);
  expect(m.exact.bounds.max).toEqual([expect.closeTo(3,9),expect.closeTo(0,9),expect.closeTo(3,9)]);
 });

 it('refuses bounds it cannot guarantee and the padded variant, with precise messages',()=>{
  expect(()=>convert('const b = await box(10, 10, 10).subtract(box(20, 20, 2)).boundingBox({ exact: true });\nreturn box(1, 1, b.min[2] + 1);')).toThrow(/shape.boundingBox side of a cut/);
  expect(()=>convert('const b = await box(1, 1, 1).boundingBox();\nreturn box(1, 1, 1);')).toThrow(/without \{ exact: true \}/);
  // An uncertain side still resolves in Math.min when another operand is certainly lower:
  // a body with an arch cut through its floor (min z ≥ 10) and a wheel reaching z = 0.
  const floor=convert(`const parts = [box(40, 10, 20).translate(0, 0, 10).subtract(cylinder(10, 8).rotateX(90).translate(20, 15, 10)), cylinder(4, 5).rotateX(90).translate(20, 2, 5)];
let lowest = Infinity;
for (const shape of parts) lowest = Math.min(lowest, (await shape.boundingBox({ exact: true })).min[2]);
return parts[0].translate(0, 0, -lowest - 1);`);
  expect(floor.parts[0].program.source).toMatch(/^return move\(\[0, 0, -1\], /);
  expect(()=>convert(`const b = await box(40, 10, 20).subtract(box(10, 20, 5).translate(0, -5, -1)).boundingBox({ exact: true });
return box(1, 1, Math.min(5, b.min[2]) + 1);`)).toThrow(/side of a cut/);
 });

 it('computes exact support bounds through transforms, cuts and revolutions',()=>{
  const bounds=(source:string)=>exactShapeBounds(compileCode({version:1,language:'brickwright-cad-script',parameters:{},source}).shape);
  // A cylinder tilted 30° about X: z extent h/2·cos30 + r·sin30.
  const tilted=bounds('return rotate([30, 0, 0], cylinder(2, 10, 8));')!;
  expect(tilted.max[2]).toBeCloseTo(5*Math.cos(Math.PI/6)+2*Math.sin(Math.PI/6),12);
  expect(tilted.max[0]).toBeCloseTo(2,12);
  // An inner cavity keeps the box's bounds exact; a hole through the faces makes them uncertain.
  expect(bounds('return subtract(box(10, 10, 10), sphere(2));')!.min[2]).toBeCloseTo(-5,12);
  expect(bounds('return subtract(box(10, 10, 10), cylinder(2, 12));')).toBeUndefined();
  // A torus from revolve: ring reaches R + r, tube height ±r; axisRotate and mirror compose.
  const ring=bounds('return axisRotate([1, 0, 0], 90, torus(20, 5, 6, 6));')!;
  expect(ring.max).toEqual([expect.closeTo(25,12),expect.closeTo(5,12),expect.closeTo(25,12)]);
  expect(bounds('return mirror([1, 0, 0], move([3, 0, 0], box(2, 2, 2)));')!.min[0]).toBeCloseTo(-4,12);
  expect(bounds('return intersect(box(2, 2, 2), sphere(1.2));')).toBeUndefined();
 });
});

describe('kcad assembly connectors',()=>{
 it('ignores connectors and pose-0 mates (the as-built pose) and refuses other poses',()=>{
  const rig=(pose:number)=>`const a = assembly('rig');
a.part('base', box(10, 10, 2)).connector('hinge', { type: 'axis', origin: [0, 0, 2], axis: [1, 0, 0] });
a.part('arm', box(2, 2, 20).translate(0, 0, 2)).connector('hinge', { type: 'axis', origin: [0, 0, 2], axis: [1, 0, 0] });
a.mate('hinge', 'base.hinge', 'arm.hinge', 'revolute', { pose: ${pose}, limitsDeg: [-90, 90] });
return a.model();`;
  const c=convert(rig(0));
  expect(c.parts.map(p=>p.name)).toEqual(['base','arm']);
  expect(c.warnings.some(w=>/connector\(\)/.test(w))).toBe(true);
  expect(()=>convert(rig(30))).toThrow(/assembly.mate with a nonzero pose/);
 });
});

describe('kcad JavaScript helpers used by the catalog',()=>{
 it('supports string replace/replaceAll, findIndex, splice, array rest and hyperbolic Math',()=>{
  const c=convert(`const label = 'm1.5'.replace('m', '').replaceAll('.', 'p');
const list = [4, 5, 6, 7];
const i = list.findIndex((v) => v === 6);
list.splice(1, 1);
const [first, ...rest] = list;
return box(label === '1p5' ? 1 : 100, i + rest.length, Math.cosh(0) + first);`);
  expect(c.parts[0].program.source).toBe('return move([0.5, 2, 2.5], box(1, 4, 5));');
  // Seeded generators pass 1e9 in intermediates; `in` on records; for-of over strings.
  const d=convert(`let seed = 233279;
const next = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const r = next();
const hz = { a: 1 };
let n = 0;
for (const ch of 'abca') if (ch in hz) n++;
return box(r > 0 && r < 1 ? 1 : 100, n, 1);`);
  expect(d.parts[0].program.source).toBe('return move([0.5, 1, 0.5], box(1, 2, 1));');
 });
});
