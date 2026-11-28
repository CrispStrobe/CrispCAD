// SPDX-License-Identifier: BSD-3-Clause
// Check for manufacturing, the checks added after Phase 6.3: CNC pocket depth against the tool,
// internal corners that need dogbones (with suggested positions), and injection moulding (draft,
// undercuts along the pull, wall uniformity). Exact B-rep and mesh, and the `check` command.
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {CAD_SCRIPT_REVISION,createCadSession,formatManufacturingReport,parseManufacturingCommand,resolveManufacturingSettings,setLocale} from '@brickwright/cad-core';
import type {CadDocument,ExactDrawingData,ManufacturingCheck,ManufacturingReport,ManufacturingSettings} from '@brickwright/cad-core';
import {checkManufacturing,createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,EXACT_LIMITS_TABLET,exactKernelIdentity,runExactRequest} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';

vi.setConfig({testTimeout:120_000});
let exact:ExactBackend,manifold:GeometryKernel;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},120_000);
afterAll(()=>setLocale('en'));

const kernels=[exactKernelIdentity];
function code(source:string,name='Part'){
 const session=createCadSession(undefined,{kernels});
 session.addCode({version:CAD_SCRIPT_REVISION,language:'brickwright-cad-script',source,parameters:{}},name);
 return session;
}
const drawing=(doc:CadDocument):ExactDrawingData=>{
 const result=runExactRequest(exact,{operation:'drawing',document:doc,bodies:[]},0,{limits:EXACT_LIMITS_TABLET});
 if(result.operation!=='drawing')throw new Error('unexpected');
 return {bodies:result.bodies,failures:result.failures};
};
const run=(doc:CadDocument,settings:Partial<ManufacturingSettings>)=>checkManufacturing({meshes:manifold.evaluate(doc).bodies,exact:settings.exact===false?undefined:drawing(doc),kernel:'smlib-exact'},settings);
const find=(report:ManufacturingReport,id:string,body=0):ManufacturingCheck=>{
 const found=report.bodies[body].checks.find(c=>c.id===id);
 if(!found)throw new Error(`no check ${id}: ${report.bodies[body].checks.map(c=>c.id).join(', ')}`);
 return found;
};
const near=(a:readonly number[],b:readonly number[],digits=6)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],digits));

/** 70 × 50 × 20 block (top at z 10) with a 30 × 30 pocket 10 deep and sharp corners. */
const squarePocket=()=>code('return subtract(box(70,50,20), move([0,0,6], box(30,30,12)));','Square pocket');
/** The same pocket with R2.5 corners (40 × 30). */
const filletedPocket=()=>code('return subtract(box(70,50,20), extrudeProfile(11, offset2d(2.5, true, 32, rectangle2d(35,25,true))));','Pocket block');

describe('CNC pocket depth',()=>{
 it('measures a pocket from its floor to the top of its walls, against 4 × the tool',()=>{
  const doc=squarePocket().state.document;
  const depth=find(run(doc,{process:'cnc'}),'cnc.pocket-depth');
  expect(depth.geometry).toBe('exact');
  expect(depth.status).toBe('pass');
  expect(depth.value).toBeCloseTo(10,9);
  expect(depth.limit).toBeCloseTo(24,9);
  expect(depth.summary).toContain('1 pockets, the deepest 10 mm');
  // A Ø2 end mill reaches 8 mm: the 10 mm pocket fails, with the floor marked.
  const small=find(run(doc,{process:'cnc',toolDiameterMm:2}),'cnc.pocket-depth');
  expect(small.status).toBe('fail');
  expect(small.findings).toHaveLength(1);
  expect(small.findings[0].value).toBeCloseTo(10,9);
  expect(small.findings[0].text).toContain('5 × the Ø2 end mill, beyond 4 ×');
  expect(small.findings[0].location[2]).toBeCloseTo(0,6);
  expect(small.findings[0].mark.triangles.length).toBeGreaterThan(0);
  expect(find(run(doc,{process:'cnc',toolDiameterMm:2,maxPocketDepthRatio:5}),'cnc.pocket-depth').status).toBe('pass');
 });
 it('takes a filleted pocket, a stepped pocket per step, and leaves steps and through holes alone',()=>{
  expect(find(run(filletedPocket().state.document,{process:'cnc',toolDiameterMm:2}),'cnc.pocket-depth').findings.map(f=>f.value)).toEqual([expect.closeTo(10,9)]);
  // A pocket from z −10 to the block's top at 25: 35 > 24.
  const deep=find(run(code('return subtract(box(60,60,50), move([0,0,10], box(20,20,40)));').state.document,{process:'cnc'}),'cnc.pocket-depth');
  expect(deep.status).toBe('fail');
  expect(deep.value).toBeCloseTo(35,9);
  // A pocket with a smaller pocket in its floor: two floors, each measured to its own rim.
  const stepped=find(run(code('return subtract(box(70,50,30), move([0,0,10], box(40,30,10)), move([0,0,0], box(20,10,10)));').state.document,{process:'cnc',toolDiameterMm:2}),'cnc.pocket-depth');
  expect(stepped.summary).toContain('2 of 2 pockets');
  // The inner floor is 20 mm below the top: 10 of its own under the outer pocket's 10.
  expect(stepped.findings.map(f=>f.value)).toEqual([expect.closeTo(20,9),expect.closeTo(10,9)]);
  expect(stepped.findings[0].text).toContain('10 mm below the pocket around it');
  // A step along one side is milled from the side: no pocket.
  expect(find(run(code('return subtract(box(70,50,20), move([30,0,10], box(20,60,10)));').state.document,{process:'cnc'}),'cnc.pocket-depth').summary).toBe('No pockets along the tool axes.');
  // A through hole in a pocket floor keeps it a pocket.
  const holed=find(run(code('return subtract(box(70,50,20), move([0,0,6], box(30,30,12)), cylinder(3,40,48));').state.document,{process:'cnc'}),'cnc.pocket-depth');
  expect(holed.summary).toContain('1 pockets, the deepest 10 mm');
 });
 it('is not checked on a mesh',()=>{
  const depth=find(run(squarePocket().state.document,{process:'cnc',exact:false}),'cnc.pocket-depth');
  expect(depth.status).toBe('not-checked');
  expect(depth.geometry).toBe('mesh');
 });
});

describe('dogbones',()=>{
 it('lists the sharp corners of a pocket, and suggests a dogbone through each corner on request',()=>{
  const doc=squarePocket().state.document;
  const plain=find(run(doc,{process:'cnc'}),'cnc.dogbones');
  expect(plain.status).toBe('warn');
  expect(plain.findings).toHaveLength(4);
  expect(plain.summary).toContain('Turn on Suggest dogbones');
  for(const f of plain.findings){expect(f.text).toContain('10 mm long');expect(f.edges).toHaveLength(1);}
  const suggested=find(run(doc,{process:'cnc',dogbones:true}),'cnc.dogbones');
  expect(suggested.findings).toHaveLength(4);
  const r=3,offset=r/Math.SQRT2;
  for(const f of suggested.findings){
   const [x,y,z]=f.location;
   // On the bisector, one tool radius from the corner (±15, ±15), toward the pocket.
   near([Math.abs(x),Math.abs(y),z],[15-offset,15-offset,5],6);
   expect(Math.hypot(Math.abs(x)-15,Math.abs(y)-15)).toBeCloseTo(r,9);
   expect(f.text).toMatch(/dogbone Ø6 centred at \[/);
   // The corner edge and two circles (floor and rim) and the axis line.
   expect(f.mark.lines).toHaveLength(4);
   expect(f.mark.points).toHaveLength(3);
  }
 });
 it('places the dogbone of a corner fillet below the tool radius at the corner it rounds',()=>{
  const found=find(run(filletedPocket().state.document,{process:'cnc',dogbones:true}),'cnc.dogbones');
  expect(found.findings).toHaveLength(4);
  const offset=3/Math.SQRT2;
  for(const f of found.findings){
   expect(f.value).toBeCloseTo(2.5,9);
   near([Math.abs(f.location[0]),Math.abs(f.location[1])],[20-offset,15-offset],4);
  }
  // A Ø4 tool (R2) cuts R2.5 as modelled: nothing to relieve.
  expect(find(run(filletedPocket().state.document,{process:'cnc',toolDiameterMm:4,dogbones:true}),'cnc.dogbones').status).toBe('pass');
 });
 it('counts corners that already have dogbones',()=>{
  const c=15-3/Math.SQRT2;
  const source=`return subtract(box(70,50,20), move([0,0,6], box(30,30,12)), move([${c},${c},6], cylinder(3,12,64)), move([${-c},${c},6], cylinder(3,12,64)), move([${c},${-c},6], cylinder(3,12,64)), move([${-c},${-c},6], cylinder(3,12,64)));`;
  const found=find(run(code(source).state.document,{process:'cnc'}),'cnc.dogbones');
  expect(found.status).toBe('pass');
  expect(found.summary).toContain('4 corners are already relieved');
 });
});

describe('injection moulding',()=>{
 /** A cup 40 across and 20 tall, open at the top, wall 2 mm, with the given draft on every side wall. */
 const cup=(draftDeg:number)=>{
  const k=Math.tan(draftDeg*Math.PI/180)*20;
  // Widening upward outside and in, so the outside releases toward −z and the inside toward +z.
  return code(`return subtract(move([0,0,10], frustum(18, ${18+k}, 20, 96)), move([0,0,12], frustum(${16+k*.1}, ${16+k*1.1}, 20, 96)));`,'Cup');
 };
 it('passes the draft of a drafted cup and fails vertical walls',()=>{
  const drafted=run(cup(2).state.document,{process:'molding'});
  const draft=find(drafted,'mold.draft');
  expect(draft.geometry).toBe('exact');
  expect(draft.status).toBe('pass');
  expect(draft.value).toBeCloseTo(2,1);
  expect(find(run(cup(2).state.document,{process:'molding',minDraftDeg:3}),'mold.draft').status).toBe('fail');
  const box=run(squarePocket().state.document,{process:'molding'}),vertical=find(box,'mold.draft');
  expect(vertical.status).toBe('fail');
  expect(vertical.value).toBeCloseTo(0,9);
  // Four outer sides and four pocket walls.
  expect(vertical.findings).toHaveLength(8);
  expect(vertical.findings.every(f=>f.faces?.length===1&&f.text.includes('plane'))).toBe(true);
  // Pulled along X instead, the top, the floor and the bottom have no draft.
  expect(find(run(squarePocket().state.document,{process:'molding',pullAxis:'+x'}),'mold.draft').findings.length).toBeGreaterThanOrEqual(3);
 });
 it('finds undercuts along the pull in both mould halves',()=>{
  const groove=code('return subtract(box(70,50,20), move([35,0,0], box(20,60,6)));','Side groove').state.document;
  const undercuts=find(run(groove,{process:'molding'}),'mold.undercuts');
  expect(undercuts.status).toBe('fail');
  expect(undercuts.value).toBeCloseTo(1300,6);
  expect(undercuts.summary).toContain('side action');
  // Opening along X, the groove releases toward +x; the pocketed block has none along Z.
  expect(find(run(groove,{process:'molding',pullAxis:'+x'}),'mold.undercuts').status).toBe('pass');
  expect(find(run(squarePocket().state.document,{process:'molding'}),'mold.undercuts').status).toBe('pass');
 });
 it('measures wall uniformity around a nominal wall, ignoring the height of a rim',()=>{
  const even=find(run(cup(2).state.document,{process:'molding'}),'mold.wall-uniformity');
  expect(even.geometry).toBe('exact');
  expect(even.status).toBe('pass');
  expect(even.value!).toBeGreaterThan(1.8);
  expect(even.value!).toBeLessThan(2.2);
  // A 2 mm plate with a solid 12 mm block on it: the block is thick against the plate's 2 mm.
  const lumpy=find(run(code('return union(box(80,80,2), move([0,0,7], box(12,12,12)));','Plate').state.document,{process:'molding'}),'mold.wall-uniformity');
  expect(lumpy.status).toBe('warn');
  expect(lumpy.value).toBeCloseTo(2,1);
  expect(lumpy.findings.length).toBeGreaterThan(0);
  expect(lumpy.findings[0].value!).toBeGreaterThan(4);
  expect(lumpy.findings[0].text).toMatch(/nominal/);
  // The mesh gives the same nominal.
  const mesh=find(run(code('return union(box(80,80,2), move([0,0,7], box(12,12,12)));','Plate').state.document,{process:'molding',exact:false}),'mold.wall-uniformity');
  expect(mesh.geometry).toBe('mesh');
  expect(mesh.status).toBe('warn');
  expect(mesh.value).toBeCloseTo(2,1);
 });
 it('runs the edge-radius and minimum-wall checks for moulding too',()=>{
  const report=run(cup(2).state.document,{process:'molding',minWallMm:2.5});
  expect(report.bodies[0].checks.map(c=>c.id)).toEqual(['mold.draft','mold.undercuts','mold.min-wall','mold.wall-uniformity','edges.radius']);
  expect(find(report,'mold.min-wall').status).toBe('fail');
 });
});

describe('the check command and settings',()=>{
 it('parses the new options into a canonical invocation, and refuses bad values',()=>{
  const session=squarePocket();
  const cnc=parseManufacturingCommand(session,'cnc all --dogbones --depth-ratio 3 --tool 4');
  expect(cnc.settings.dogbones).toBe(true);
  expect(cnc.settings.maxPocketDepthRatio).toBe(3);
  expect(cnc.invocation).toBe('check cnc all --tool 4 --depth-ratio 3 --dogbones');
  const mold=parseManufacturingCommand(session,'molding all --pull x --draft 2 --max-wall 3 --variation 0.25');
  expect(mold.settings).toMatchObject({process:'molding',pullAxis:'+x',minDraftDeg:2,maxWallMm:3,wallVariation:.25});
  expect(mold.invocation).toBe('check molding all --pull +x --draft 2 --max-wall 3 --variation 0.25');
  expect(()=>resolveManufacturingSettings({wallVariation:1.5})).toThrow(/fraction/);
  expect(()=>resolveManufacturingSettings({minDraftDeg:50})).toThrow(/draft/);
  expect(()=>resolveManufacturingSettings({pullAxis:'z' as never})).toThrow(/pull/);
  expect(()=>resolveManufacturingSettings({minWallMm:3,maxWallMm:2})).toThrow(/thicker/);
  expect(()=>resolveManufacturingSettings({maxPocketDepthRatio:0})).toThrow(/ratio/);
 });
 it('formats the moulding report, in German too',()=>{
  const report=run(squarePocket().state.document,{process:'molding'});
  expect(formatManufacturingReport(report)).toContain('Injection moulding');
  setLocale('de');
  try{
   const german=run(squarePocket().state.document,{process:'cnc',dogbones:true});
   const text=formatManufacturingReport(german);
   expect(text).toContain('Taschentiefe');
   expect(text).toContain('Freistich');
  }finally{setLocale('en');}
 });
});
