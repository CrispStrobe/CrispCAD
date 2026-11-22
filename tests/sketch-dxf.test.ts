// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll, expect, it} from 'vitest';
import {createCadSession, parseDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {readSketchDxf} from '../packages/editor/src/import-sketch-dxf.js';
import {exportSketchDxf} from '../packages/editor/src/sketch-dxf.js';

const drawing = (entity: string, units = 4) =>
  ['0','SECTION','2','HEADER','9','$INSUNITS','70',units,'0','ENDSEC','0','SECTION','2','ENTITIES',
   entity,'0','ENDSEC','0','EOF'].join('\n');
const square = ['0','LWPOLYLINE','90',4,'70',1,'10',1,'20',1,'10',1,'20',2,
  '10',2,'20',2,'10',2,'20',1].join('\n');
const circle = '0\nCIRCLE\n10\n2\n20\n-1\n40\n1.5';
let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await createGeometryKernel({wasmBinary: readFileSync('node_modules/manifold-3d/manifold.wasm')});
});

it('imports a clockwise inch outline at its actual size and position as an editable extrusion', () => {
  const s = createCadSession();
  const profile = readSketchDxf(drawing(square, 1));
  const id = s.addSketchExtrusion(profile, {name: 'Plate', distance: 2});
  const saved = s.serialize();
  const doc = parseDocument(saved);
  const body = kernel.evaluate(doc).bodies[0];
  expect(body.volume).toBeCloseTo(25.4 ** 2 * 2, 3);
  expect(body.bounds.min[0]).toBeCloseTo(25.4);
  expect(body.bounds.max[1]).toBeCloseTo(50.8);
  expect(readSketchDxf(new TextDecoder().decode(exportSketchDxf(doc, id).bytes))).toEqual(profile);
  if (profile.kind !== 'outline') throw new Error('Expected an outline');
  s.editExtrusion(id, {sketch: {profile: {...profile, points: [[0,0],[40,0],[30,20],[0,20]]}}, distance: 2, symmetric: false});
  expect(kernel.evaluate(s.state.document).bodies[0].volume).toBeCloseTo(1400);
  s.undo();
  expect(s.serialize()).toBe(saved);
  s.dispose();
});

it('keeps a translated analytic circle through export and reimport', () => {
  const s = createCadSession();
  const profile = readSketchDxf(drawing(circle, 5));
  expect(profile).toMatchObject({kind: 'circle', radius: 15, center: [20,-10]});
  const id = s.addSketchExtrusion(profile, {distance: 5});
  const [body] = kernel.evaluate(s.state.document).bodies;
  expect(body.bounds.min[0]).toBeCloseTo(5);
  expect(body.bounds.max[1]).toBeCloseTo(5);
  expect(readSketchDxf(new TextDecoder().decode(exportSketchDxf(s.state.document, id).bytes))).toEqual(profile);
  s.dispose();
});

it('requires explicit missing-unit consent and rejects unsupported or self-crossing geometry', () => {
  expect(() => readSketchDxf(drawing(circle, 0))).toThrow('has no units');
  expect(readSketchDxf(drawing(circle, 0), true)).toMatchObject({radius: 1.5});
  for (const entity of [square.replace('\n70\n1\n', '\n70\n0\n'), square + '\n42\n0.5',
    circle + '\n30\n1', circle + '\n210\n1', circle + '\n' + square]) {
    expect(() => readSketchDxf(drawing(entity))).toThrow('Use one circle');
  }
  expect(() => readSketchDxf(drawing(square.replace('\n10\n1\n20\n2\n10\n2\n20\n2', '\n10\n2\n20\n2\n10\n1\n20\n2')))).toThrow('without crossings');
});
