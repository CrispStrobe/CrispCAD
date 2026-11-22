// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll, expect, it} from 'vitest';
import {createCadSession, designGraph, parseDocument} from '@brickwright/cad-core';
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
  for (const entity of [square.replace('\n70\n1\n', '\n70\n0\n'), square + '\n43\n0.5',
    circle + '\n30\n1', circle + '\n210\n1']) {
    expect(() => readSketchDxf(drawing(entity))).toThrow('Use circles');
  }
  expect(() => readSketchDxf(drawing(square.replace('\n10\n1\n20\n2\n10\n2\n20\n2', '\n10\n2\n20\n2\n10\n1\n20\n2')))).toThrow('without crossings');
});

const plate = '0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n0\n20\n30\n10\n40\n20\n30\n10\n40\n20\n0';
const hole = (x: number, y: number, r: number) => `0\nCIRCLE\n10\n${x}\n20\n${y}\n40\n${r}`;

it('retains editable holes with the outer boundary listed after a hole', () => {
  const profile = readSketchDxf(drawing([hole(10, 15, 2), plate, hole(30, 15, 3)].join('\n')));
  if (profile.kind !== 'region') throw new Error('Expected a region');
  const session = createCadSession();
  const id = session.addSketchExtrusion(profile, {distance: 5});
  const saved = session.serialize();
  const doc = parseDocument(saved);
  const tessellatedAreaFactor = 32 * Math.sin(Math.PI / 32);
  const [body] = kernel.evaluate(doc).bodies;
  expect(body.volume).toBeCloseTo((1200 - (2 ** 2 + 3 ** 2) * tessellatedAreaFactor) * 5, 2);
  expect(readSketchDxf(new TextDecoder().decode(exportSketchDxf(doc, id).bytes))).toEqual(profile);
  const loops = profile.loops.map(loop => loop.id === 'dxf-loop-1' ? {...loop, radius: 4} : loop);
  session.editExtrusion(id, {sketch: {profile: {...profile, loops}}, distance: 5, symmetric: false});
  expect(kernel.evaluate(session.state.document).bodies[0].volume)
    .toBeCloseTo((1200 - (4 ** 2 + 3 ** 2) * tessellatedAreaFactor) * 5, 2);
  session.undo();
  expect(session.serialize()).toBe(saved);
  session.dispose();
});

it.each([
  {holes: [hole(2, 15, 2)]},
  {holes: [hole(1, 15, 2)]},
  {holes: [hole(45, 15, 2)]},
  {holes: [hole(10, 15, 2), hole(14, 15, 2)]},
  {holes: [hole(10, 15, 2), hole(13, 15, 2)]},
  {holes: [hole(10, 15, 2), hole(10, 15, 1)]},
])('rejects touching, crossing, separate or nested boundaries (%#)', ({holes}) => {
  expect(() => readSketchDxf(drawing([plate, ...holes].join('\n')))).toThrow('separate holes');
});

it('drives hole center spacing and radius through named dimensions and exports the evaluated circles', () => {
  const session = createCadSession();
  const parameters = {version: 1 as const, parameters: {
    spacing: {expression:'20', unit:'mm' as const}, radius: {expression:'2', unit:'mm' as const},
    unused: {expression:'5', unit:'mm' as const}
  }, bindings: []};
  session.setParametric(parameters);
  const profile = readSketchDxf(drawing([plate, hole(10, 15, 2), hole(30, 15, 2)].join('\n')));
  if (profile.kind !== 'region') throw new Error('Expected region');
  const id = session.addSketchExtrusion({...profile, loops: profile.loops.map((loop, i) => loop.kind === 'circle'
    ? {...loop, center: [i === 1 ? '20 mm - spacing / 2' : '20 mm + spacing / 2', 15], radius: 'radius'}
    : loop)}, {distance: 5});
  const centers = () => {
    const imported = readSketchDxf(new TextDecoder().decode(exportSketchDxf(session.state.document, id).bytes));
    if (imported.kind !== 'region') throw new Error('Expected exported region');
    return imported.loops.flatMap(loop => loop.kind === 'circle' ? [[...loop.center, loop.radius]] : []);
  };
  expect(centers()).toEqual([[10, 15, 2], [30, 15, 2]]);
  const first = session.serialize();
  const firstVolume = kernel.evaluate(session.state.document).volume;
  const edited = structuredClone(parameters);
  edited.parameters.spacing.expression = '28';
  edited.parameters.radius.expression = '3';
  session.setParametric(edited);
  expect(centers()).toEqual([[6, 15, 3], [34, 15, 3]]);
  expect(kernel.evaluate(session.state.document).volume).toBeLessThan(firstVolume);
  const saved = session.serialize();
  expect(designGraph(parseDocument(saved)).find(entry => entry.kind === 'sketch')?.dependencies)
    .toEqual(['parameter:spacing', 'parameter:radius']);
  edited.parameters.spacing.expression = '40';
  expect(() => session.setParametric(edited)).toThrow('separate holes');
  expect(session.serialize()).toBe(saved);
  const fragment = session.fragment([id]);
  expect(Object.keys(fragment.parametric!.parameters).sort()).toEqual(['radius','spacing']);
  const target = createCadSession();
  target.setParametric(parameters);
  target.insert(fragment, [0,0,0], {mergeParameters:true});
  expect(Object.values(target.state.document.sketches!)[0].profile).toMatchObject({
    loops: [{kind:'outline'}, {center:['20 mm - spacing_2 / 2',15], radius:'radius_2'}, {center:['20 mm + spacing_2 / 2',15], radius:'radius_2'}]
  });
  session.undo();
  expect(session.serialize()).toBe(first);
  target.dispose();
  session.dispose();
});

it('retains named DXF layers on both mixed regions and single loops', () => {
  const track = (entity:string, layer:string) => entity.replace(/^(0\n\w+)\n/, '$1\n8\n' + layer + '\n');
  const entities = [track(plate,'Cut perimeter'), track(hole(10, 15, 2),'Bohrungen Ä')];
  const session = createCadSession();
  for (const drawingEntities of [entities, entities.slice(0,1), entities.slice(1)]) {
    const profile = readSketchDxf(drawing(drawingEntities.join('\n')));
    const id = session.addSketchExtrusion(profile, {distance:5});
    const output = new TextDecoder().decode(exportSketchDxf(parseDocument(session.serialize()), id).bytes);
    expect(readSketchDxf(output)).toEqual(profile);
    const layer = drawingEntities[0] === entities[0] ? 'Cut perimeter' : 'Bohrungen Ä';
    expect(output).toContain('0\r\nLAYER\r\n100\r\nAcDbSymbolTableRecord\r\n100\r\nAcDbLayerTableRecord\r\n2\r\n'+layer);
  }
  expect(() => readSketchDxf(drawing(track(plate,'Bad/Layer')))).toThrow('Invalid DXF layer name');
  session.dispose();
});

const halfRoundPlate = '0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n42\n1\n10\n40\n20\n0\n10\n40\n20\n30\n10\n0\n20\n30';

it('keeps native curved polyline segments when extruding, reopening and exporting a rounded plate', () => {
  const profile = readSketchDxf(drawing([halfRoundPlate, hole(20, -10, 2)].join('\n')));
  expect(profile).toMatchObject({
    kind:'region', loops:[{kind:'outline',bulges:[1,0,0,0]}, {kind:'circle'}]
  });
  const session = createCadSession();
  const id = session.addSketchExtrusion(profile, {distance:5});
  const doc = parseDocument(session.serialize());
  const [body] = kernel.evaluate(doc).bodies;
  expect(body.bounds.min[1]).toBeCloseTo(-20);
  expect(body.bounds.max[1]).toBeCloseTo(30);
  expect(body.volume).toBeCloseTo((1200 + Math.PI * (200 - 4)) * 5, -1);
  const text = new TextDecoder().decode(exportSketchDxf(doc, id).bytes);
  expect(text).toContain('10\r\n0\r\n20\r\n0\r\n42\r\n1');
  expect(readSketchDxf(text)).toEqual(profile);
  session.dispose();
});

it('accepts an authored two-arc circle and preserves clockwise signs', () => {
  const source = '0\nLWPOLYLINE\n90\n2\n70\n1\n10\n-10\n20\n0\n42\n-1\n10\n10\n20\n0\n42\n-1';
  const profile = readSketchDxf(drawing(source));
  expect(profile).toMatchObject({kind:'outline',points:[[-10,0],[10,0]],bulges:[-1,-1]});
  const session = createCadSession();
  const id = session.addSketchExtrusion(profile, {distance:2});
  const [body] = kernel.evaluate(session.state.document).bodies;
  expect(body.bounds.min[1]).toBeCloseTo(-10);
  expect(body.bounds.max[1]).toBeCloseTo(10);
  expect(body.volume).toBeCloseTo(200*Math.PI, -1);
  expect(readSketchDxf(new TextDecoder().decode(exportSketchDxf(session.state.document,id).bytes))).toEqual(profile);
  session.dispose();
});

it('rejects malformed, off-workspace and self-crossing curved polylines', () => {
  expect(() => readSketchDxf(drawing(halfRoundPlate.replace('42\n1','42\n1\n42\n1')))).toThrow('supported text DXF');
  expect(() => readSketchDxf(drawing(halfRoundPlate.replace('42\n1','42\n10000')))).toThrow('curve size or detail limit');
  expect(() => readSketchDxf(drawing(halfRoundPlate.replace('42\n1','42\n-2')))).toThrow('without crossings');
});

const dxfLine=(a:[number,number],b:[number,number],layer='Profile')=>
 ['0','LINE','8',layer,'10',a[0],'20',a[1],'11',b[0],'21',b[1]].join('\n');
const nativeArc=['0','ARC','8','Profile','10',2,'20',0,'40',2,'50',180,'51',0].join('\n');
const nativePlate=[dxfLine([0,3],[4,3]),dxfLine([0,0],[0,3]),nativeArc,dxfLine([4,0],[4,3])];

it('joins unordered native lines and arcs with signed winding and inch dimensions',()=>{
 const profile=readSketchDxf(drawing(nativePlate.join('\n'),1));
 expect(profile).toMatchObject({kind:'outline',dxfLayer:'Profile',bulges:[0,0,-1,0]});
 const session=createCadSession();
 const id=session.addSketchExtrusion(profile,{distance:3});
 const [body]=kernel.evaluate(parseDocument(session.serialize())).bodies;
 expect(Math.abs(body.bounds.min[1]+50.8)).toBeLessThan(.0251);
 expect(body.bounds.max[0]).toBeCloseTo(101.6);
 expect(body.volume).toBeCloseTo((12+2*Math.PI)*25.4**2*3,-2);
 const exported=new TextDecoder().decode(exportSketchDxf(session.state.document,id).bytes);
 expect(readSketchDxf(exported)).toEqual(profile);
 session.dispose();
});

it('reports open branches, tilted lines and layer changes instead of dropping parts of a chain',()=>{
 expect(()=>readSketchDxf(drawing(nativePlate.slice(0,3).join('\n')))).toThrow('must join into closed loops');
 expect(()=>readSketchDxf(drawing([...nativePlate,dxfLine([4,0],[5,0])].join('\n')))).toThrow('without branches');
 expect(()=>readSketchDxf(drawing(nativePlate.join('\n')+'\n31\n1'))).toThrow('Use circles');
 expect(()=>readSketchDxf(drawing(nativePlate.join('\n').replace('8\nProfile','8\nOutline')))).toThrow('same DXF layer');
});

it('joins endpoints across serialization roundoff while preserving analytic arc bulges',()=>{
 const drifted=dxfLine([4.0000004,0],[4,3]);
 expect(readSketchDxf(drawing([...nativePlate.slice(0,3),drifted].join('\n'))))
  .toMatchObject({kind:'outline',bulges:[0,0,-1,0]});
});
