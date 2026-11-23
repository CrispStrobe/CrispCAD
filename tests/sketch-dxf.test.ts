// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll, expect, it} from 'vitest';
import {compileModelSource, createCadSession, designGraph, parseDocument, validateDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {prepareSketchDxf,readSketchDxf,readSketchPathDxf} from '../packages/editor/src/import-sketch-dxf.js';
import {exportSketchDxf,exportSketchPathDxf} from '../packages/editor/src/sketch-dxf.js';

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

it('imports open polylines in source order and exports millimetres with signed arcs and layer',()=>{
 const entity=['0','LWPOLYLINE','8','Guides Ä','90',3,'70',128,
  '10',2,'20',1,'42',-.5,'10',1,'20',2,'10',0,'20',0,'42',1].join('\n');
 const imported=readSketchPathDxf(drawing(entity,1));
 expect(imported).toEqual({kind:'path',id:'dxf-profile',points:[[50.8,25.4],[25.4,50.8],[0,0]],bulges:[-.5,0,0],dxfLayer:'Guides Ä'});
 expect(()=>readSketchDxf(drawing(entity,1))).toThrow('Use circles');
 expect(readSketchPathDxf(drawing(entity.replace('\n70\n128',''),1))).toEqual(imported);
 const session=createCadSession();
 const id=session.addSketch(imported,{name:'Guide',plane:'XZ'});
 const doc=parseDocument(session.serialize());
 const dxf=new TextDecoder().decode(exportSketchPathDxf(doc,doc.sketches![id]).bytes);
 expect(dxf).toContain('$INSUNITS\r\n70\r\n4');
 expect(dxf).toContain('90\r\n3\r\n70\r\n0');
 expect(dxf).toContain('AcDbLayerTableRecord\r\n2\r\nGuides Ä');
 expect(readSketchPathDxf(dxf)).toEqual(imported);
 session.closeSketchPath(id,imported,{name:'Guide',plane:'XZ'});
 expect(session.state.document.sketches?.[id].profile).toMatchObject({kind:'outline',dxfLayer:'Guides Ä'});
});

const openArc=['0','ARC','8','Guides','10',0,'20',0,'40',1,'50',0,'51',90].join('\n');
const openLine=dxfLine([0,2],[0,1],'Guides');
it('orients a native chain from a terminal and reverses arc bulges when walking backward',()=>{
 const result=readSketchPathDxf(drawing([openLine,openArc].join('\n'),1));
 expect(result.points).toEqual([[0,50.8],[0,25.4],[25.4,0]]);
 expect(result.bulges).toEqual([0,-Math.tan(Math.PI/8),0]);
 expect(result.dxfLayer).toBe('Guides');
 expect(()=>readSketchPathDxf(drawing(openLine,0))).toThrow('has no units');
 expect(readSketchPathDxf(drawing(openLine,0),true).points).toEqual([[0,2],[0,1]]);
});

it('rejects branches, parallel paths, closed cycles, multiple layers and tilted paths',()=>{
 for(const entities of [
  [openLine,openArc,dxfLine([0,1],[-1,1],'Guides')],
  [openLine,openArc,dxfLine([3,3],[3,4],'Guides')],
  [openLine,...nativePlate],
  [openLine,openLine],
 ])expect(()=>readSketchPathDxf(drawing(entities.join('\n')))).toThrow('one open path');
 expect(()=>readSketchPathDxf(drawing([openLine,openArc.replace('Guides','Other')].join('\n')))).toThrow('same DXF layer');
 expect(()=>readSketchPathDxf(drawing(openLine+'\n31\n1'))).toThrow('planar');
 expect(()=>readSketchPathDxf(drawing(square))).toThrow('one open lightweight polyline');
});

it('filters a mixed drawing before validating geometry and preserves the selected layer names',()=>{
 const layered=(entity:string,layer:string)=>entity.replace(/^(0\n[^\n]+)/,'$1\n8\n'+layer);
 const source=drawing([
  layered(hole(10,15,2),'Bohrungen Ä'),plate,layered(hole(30,15,3),'BOHRUNGEN Ä'),
  '0\nTEXT\n8\nNotes\n1\nFabrication notes',
  '0\nPOLYLINE\n8\nLegacy\n70\n0\n0\nVERTEX\n10\n0\n20\n0\n0\nSEQEND',
  '0\nINSERT\n8\nLegacy\n66\n1\n2\nTitle\n0\nATTRIB\n1\nDrawing text\n0\nSEQEND',
  '0\nLINE\n8\nXref|Guides\n10\n0\n20\n0\n11\n2\n21\n2\n31\n1'
 ].join('\n'),1);
 const prepared=prepareSketchDxf(source);
 expect(prepared.layers).toEqual(['Bohrungen Ä','0','Notes','Legacy','Xref|Guides']);
 expect(()=>prepared.outline()).toThrow('Exclude layers');
 expect(()=>prepared.outline(false,['Legacy','0'])).toThrow('Exclude layers');
 expect(()=>prepared.outline(false,['Xref|Guides'])).toThrow('Invalid DXF layer name');
 expect(()=>prepared.outline(false,[])).toThrow('Select at least one');
 expect(()=>prepared.outline(false,['missing','0'])).toThrow('unavailable');
 const imported=prepared.outline(false,['0','bohrungen ä']);
 if(imported.kind!=='region')throw Error('Expected the boundary and two holes');
 expect(imported.loops.map(loop=>loop.dxfLayer)).toEqual(['Bohrungen Ä',undefined,'BOHRUNGEN Ä']);
 expect(imported.loops[0]).toMatchObject({center:[254,381],radius:50.8});
 expect(prepared.outline(false,['0'])).toMatchObject({kind:'outline',points:[[1016,0],[1016,762],[0,762],[0,0]]});
 const session=createCadSession();
 const id=session.addSketchExtrusion(imported,{distance:5});
 const exported=new TextDecoder().decode(exportSketchDxf(parseDocument(session.serialize()),id).bytes);
 expect(exported).toContain('8\r\nBohrungen Ä');
 for(const name of ['Notes','Legacy','Xref|Guides'])expect(exported).not.toContain(name);
 expect(readSketchDxf(exported)).toEqual({...imported,loops:imported.loops.map(loop=>
  loop.dxfLayer?{...loop,dxfLayer:'Bohrungen Ä'}:loop)});
});

it('selects a single open guide from unrelated geometry and can retry missing units',()=>{
 const decoration=dxfLine([5,5],[6,6],'Construction');
 const prepared=prepareSketchDxf(drawing([openArc,openLine,decoration].join('\n'),0));
 expect(prepared.layers).toEqual(['Guides','Construction']);
 expect(()=>prepared.path(false,['Guides'])).toThrow('has no units');
 expect(()=>prepared.path(true,['Guides','Construction'])).toThrow('one open path');
 expect(prepared.path(true,['guides'])).toEqual(readSketchPathDxf(drawing([openArc,openLine].join('\n'))));
});

const layerTables=[
 '0','SECTION','2','TABLES','0','TABLE','2','LTYPE',
 '0','LTYPE','2','Fixture dash','73',3,'40',1.5,'49',1,'74',0,'49',-.5,'74',0,'49',0,'74',0,
 '0','LTYPE','2','With text','73',1,'40',1,'49',1,'74',2,'9','label','0','ENDTAB',
 '0','TABLE','2','LAYER',
 '0','LAYER','2','0','70',0,'62',2,'290',0,'6','CONTINUOUS',
 '0','LAYER','2','Holes','70',21,'62',-3,'420',0x1fcf90,'290',0,'370',35,'6','Fixture dash',
 '0','LAYER','2','Guides','70',2,'62',6,'370',18,'6','Fixture dash',
 '0','LAYER','2','Extra','62',3,'6','With text','0','ENDTAB','0','ENDSEC'
].join('\n');
const styledDrawing=(entities:string[],units=4)=>drawing(entities.join('\n'),units)
 .replace('0\nSECTION\n2\nENTITIES',layerTables+'\n0\nSECTION\n2\nENTITIES');

it('round-trips selected layer styles, including layer zero and inch-based dash lengths',()=>{
 const cut=hole(10,15,2).replace('CIRCLE','CIRCLE\n8\nholes');
 const extra=hole(70,15,1).replace('CIRCLE','CIRCLE\n8\nExtra');
 const prepared=prepareSketchDxf(styledDrawing([plate,cut,extra],1));
 const profile=prepared.outline(false,['0','Holes']);
 if(profile.kind!=='region')throw Error('Expected the plate with a hole');
 expect(profile.loops[0]).toMatchObject({dxfLayerStyle:{color:2,plot:false}});
 expect(profile.loops[0].dxfLayer).toBeUndefined();
 expect(profile.loops[1]).toMatchObject({dxfLayer:'holes',dxfLayerStyle:{
  color:-3,trueColor:0x1fcf90,flags:5,plot:false,lineweight:35,
  linetype:{name:'Fixture dash',pattern:[25.4,-12.7,0]}
 }});
 expect(prepared.outline(false,['Extra'])).toMatchObject({dxfLayerStyle:{color:3}});
 expect(prepared.outline(false,['Extra'])).not.toHaveProperty('dxfLayerStyle.linetype');
 const session=createCadSession();
 const id=session.addSketchExtrusion(profile,{distance:5});
 const saved=parseDocument(session.serialize());
 expect(validateDocument(compileModelSource(session.modelSource,saved)).sketches).toEqual(saved.sketches);
 const exported=new TextDecoder().decode(exportSketchDxf(saved,id).bytes);
 expect(exported).toContain('2\r\nFixture dash\r\n70\r\n0');
 expect(exported).toContain('49\r\n25.4\r\n74\r\n0\r\n49\r\n-12.7');
 expect(exported).not.toContain('With text');
 expect(exported).not.toContain('Extra');
 expect(readSketchDxf(exported)).toEqual(profile);
});

it('preserves a line and arc guide layer style through export and closure',()=>{
 const guide=readSketchPathDxf(styledDrawing([openArc,openLine,dxfLine([0,2],[2,2],'Guides')]));
 expect(guide.dxfLayerStyle).toEqual({color:6,flags:2,lineweight:18,
  linetype:{name:'Fixture dash',pattern:[1,-.5,0]}});
 const session=createCadSession();
 const sketchId=session.addSketch(guide,{name:'Styled guide'});
 const doc=parseDocument(session.serialize());
 const exported=new TextDecoder().decode(exportSketchPathDxf(doc,doc.sketches![sketchId]).bytes);
 expect(readSketchPathDxf(exported)).toEqual(guide);
 session.closeSketchPath(sketchId,guide,{name:'Styled outline',plane:'XY'});
 expect(session.state.document.sketches![sketchId].profile).toMatchObject({kind:'outline',dxfLayerStyle:guide.dxfLayerStyle});
 expect(()=>session.addSketch({...guide,dxfLayerStyle:{...guide.dxfLayerStyle,linetype:{name:'Broken\n0',pattern:[1,0]}}}))
  .toThrow('Invalid DXF layer style');
});

it('excludes paper-space entities on shared layers before selecting sketch geometry',()=>{
 const tables=[
  '0','SECTION','2','TABLES','0','TABLE','2','BLOCK_RECORD',
  '0','BLOCK_RECORD','5','A1','2','*Paper_Space0',
  '0','BLOCK_RECORD','5','A2','2','*Model_Space','0','ENDTAB','0','ENDSEC'
 ].join('\n');
 const model=plate.replace('LWPOLYLINE','LWPOLYLINE\n330\nA2\n102\n{ACAD_REACTORS\n330\nA1\n102\n}\n410\nmOdEl');
 const layoutCircle=hole(100,100,50).replace('CIRCLE','CIRCLE\n67\n1\n410\nModel');
 const layoutText='0\nTEXT\n8\nTitle block\n410\nFabrication sheet\n1\nMaterial notes';
 const layoutOwner=hole(80,80,2).replace('CIRCLE','CIRCLE\n330\na1');
 const paperCompound='0\nPOLYLINE\n67\n1\n8\nSheet border\n0\nVERTEX\n10\n1\n20\n1\n0\nSEQEND';
 const input=(entities:string[])=>drawing(entities.join('\n'))
  .replace('0\nSECTION\n2\nENTITIES',tables+'\n0\nSECTION\n2\nENTITIES');
 const prepared=prepareSketchDxf(input([model,layoutCircle,layoutText,layoutOwner,paperCompound]));
 expect(prepared.layers).toEqual(['0']);
 expect(prepared.skippedPaperSpace).toBe(true);
 expect(prepared.outline()).toEqual(readSketchDxf(drawing(plate)));
 expect(()=>prepared.outline(false,['Title block'])).toThrow('unavailable');
 const paperOnly=prepareSketchDxf(input([layoutCircle,layoutText,layoutOwner,paperCompound]));
 expect(paperOnly.layers).toEqual([]);
 expect(()=>paperOnly.outline()).toThrow('no model-space entities');
 expect(()=>paperOnly.path()).toThrow('no model-space entities');
 expect(()=>readSketchDxf(drawing(plate.replace('LWPOLYLINE','LWPOLYLINE\n67\n2')))).toThrow('Use circles');
});

it('joins only model-space segments when a paper-space copy uses the same guide layer',()=>{
 const paper=openLine.replace('LINE','LINE\n410\nSheet 1');
 const prepared=prepareSketchDxf(drawing([openLine,openArc,paper].join('\n'),1));
 expect(prepared.layers).toEqual(['Guides']);
 expect(prepared.skippedPaperSpace).toBe(true);
 expect(prepared.path()).toEqual(readSketchPathDxf(drawing([openLine,openArc].join('\n'),1)));
});
