// SPDX-License-Identifier: BSD-3-Clause
// Check for manufacturing (Phase 6.3): CNC internal corner radius, undercuts, edge radius, wall
// thickness and hole size measured on the exact B-rep; laser-cut sheets; the mesh checks for
// bodies without one; Manifold and exact wall thickness agreeing; the `check` command.
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {CAD_SCRIPT_REVISION,createCadSession,createCommandRunner,formatManufacturingReport,identityTransform,manufacturingVerdict,parseManufacturingCommand,setLocale} from '@brickwright/cad-core';
import type {CadDocument,CadSession,ExactCommandHost,ExactDrawingData,ManufacturingCheck,ManufacturingHost,ManufacturingReport,ManufacturingSettings} from '@brickwright/cad-core';
import {checkManufacturing,checkPrintability,createGeometryKernel} from '@brickwright/cad-geometry';
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
const exactHost:ExactCommandHost={run:async request=>runExactRequest(exact,request,0,{limits:EXACT_LIMITS_TABLET})};
function code(source:string,name='Part',session=createCadSession(undefined,{kernels})){
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

/** 70 × 50 × 20 block (centred) with a 40 × 30 × 10 pocket from the top, its corners R2.5. */
const filletedPocket=()=>code('return subtract(box(70,50,20), extrudeProfile(11, offset2d(2.5, true, 32, rectangle2d(35,25,true))));','Pocket block');
/** The same with a 30 × 30 × 10 pocket with sharp corners. */
const squarePocket=()=>code('return subtract(box(70,50,20), move([0,0,6], box(30,30,12)));','Square pocket');
/** A groove 10 deep and 6 tall along the whole +X side. */
const sideGroove=()=>code('return subtract(box(70,50,20), move([35,0,0], box(20,60,6)));','Side groove');

describe('CNC milling on the exact B-rep',()=>{
 it('finds corner fillets below the tool radius, and passes them with a smaller tool',()=>{
  const doc=filletedPocket().state.document,report=run(doc,{process:'cnc'});
  expect(report.bodies[0].geometry).toBe('exact');
  expect(report.kernel).toBe('smlib-exact');
  const corners=find(report,'cnc.internal-corners');
  expect(corners.status).toBe('fail');
  expect(corners.geometry).toBe('exact');
  expect(corners.findings).toHaveLength(4);
  for(const finding of corners.findings){
   expect(finding.value).toBeCloseTo(2.5,9);
   expect(finding.faces).toHaveLength(1);
   expect(finding.mark.triangles.length).toBeGreaterThan(0);
   expect(Math.abs(finding.location[0])).toBeGreaterThan(17);
  }
  expect(corners.summary).toContain('R2.5');
  expect(find(report,'cnc.undercuts').status).toBe('pass');
  // A Ø4 end mill (R2) reaches every corner; R2.5 is a quarter of the 10 mm depth, so it warns.
  const smaller=find(run(doc,{process:'cnc',toolDiameterMm:4}),'cnc.internal-corners');
  expect(smaller.status).toBe('warn');
  expect(smaller.findings.every(f=>f.text.includes('deep'))).toBe(true);
  expect(find(run(code('return subtract(box(70,50,20), extrudeProfile(11, offset2d(4, true, 32, rectangle2d(32,22,true))));').state.document,{process:'cnc',toolDiameterMm:4}),'cnc.internal-corners').status).toBe('pass');
 });

 it('finds sharp vertical corners with their length, and not the floor edges',()=>{
  const report=run(squarePocket().state.document,{process:'cnc'}),corners=find(report,'cnc.internal-corners');
  expect(corners.status).toBe('fail');
  expect(corners.findings).toHaveLength(4);
  for(const finding of corners.findings){
   expect(finding.value).toBe(0);
   expect(finding.text).toContain('10 mm long');
   expect(finding.edges).toHaveLength(1);
   expect(Math.abs(finding.location[0])).toBeCloseTo(15,9);
   expect(Math.abs(finding.location[1])).toBeCloseTo(15,9);
  }
 });

 it('measures the unreachable area of a side groove per face, and passes it with a side setup',()=>{
  const doc=sideGroove().state.document,undercuts=find(run(doc,{process:'cnc'}),'cnc.undercuts');
  expect(undercuts.status).toBe('fail');
  // Floor 500, ceiling 500 and back wall 300 mm² (exact face areas from the face-wise mesh).
  expect(undercuts.value).toBeCloseTo(1300,6);
  expect(undercuts.findings.map(f=>Math.round(f.value!)).sort((a,b)=>a-b)).toEqual([300,500,500]);
  expect(find(run(doc,{process:'cnc',approachAxes:['+z','+x']}),'cnc.undercuts').status).toBe('pass');
 });

 it('measures thin walls exactly between the faces that bound them',()=>{
  // A 1.5 mm wall between the pocket and the +X side (pocket 30 wide, from x −16.5 to 13.5... to x 33.5).
  const doc=code('return subtract(box(70,50,20), move([18.5,0,6], box(30,30,12)));').state.document;
  const wall=find(run(doc,{process:'cnc',minWallMm:2}),'cnc.min-wall');
  expect(wall.status).toBe('fail');
  expect(wall.value).toBeCloseTo(1.5,9);
  expect(wall.findings[0].faces).toHaveLength(2);
  expect(wall.findings[0].mark.lines[0]).toHaveLength(6);
  expect(find(run(doc,{process:'cnc',minWallMm:1.5}),'cnc.min-wall').status).toBe('pass');
 });
});

describe('edge radius on the exact B-rep',()=>{
 async function rounded(radius:number){
  const session=createCadSession(undefined,{kernels});
  session.add({kind:'box',size:[30,20,10]},{name:'Block',transform:{...identityTransform(),position:[0,0,5]}});
  await createCommandRunner(session,{exact:exactHost}).runAsync(`fillet ${radius} Block`);
  return session.state.document;
 }
 it('lists the rounds of a filleted block and checks them against a minimum and a maximum',async()=>{
  const doc=await rounded(2);
  const info=find(run(doc,{process:'cnc'}),'edges.radius');
  expect(info.status).toBe('info');
  expect(info.summary).toMatch(/fillets and rounds \(R2\)/);
  expect(info.summary).toContain('0 sharp external and 0 sharp internal edges');
  expect(find(run(doc,{process:'cnc',minRadiusMm:2,maxRadiusMm:2,edgeBreak:'all'}),'edges.radius').status).toBe('pass');
  const small=find(run(doc,{process:'cnc',minRadiusMm:3}),'edges.radius');
  expect(small.status).toBe('fail');
  expect(small.findings.length+small.more).toBeGreaterThanOrEqual(12);
  for(const f of small.findings){expect(f.value).toBeCloseTo(2,9);expect(f.text).toContain('below the minimum R3');}
  expect(find(run(doc,{process:'cnc',maxRadiusMm:1}),'edges.radius').findings[0].text).toContain('above the maximum R1');
 });
 it('refuses the sharp edges a rule names',()=>{
  const session=createCadSession(undefined,{kernels});
  session.add({kind:'box',size:[30,20,10]},{name:'Block',transform:identityTransform()});
  const doc=session.state.document;
  const external=find(run(doc,{process:'cnc',edgeBreak:'external'}),'edges.radius');
  expect(external.status).toBe('fail');
  expect(external.findings).toHaveLength(12);
  expect(external.findings.every(f=>f.edges?.length===1&&f.mark.lines.length===1)).toBe(true);
  expect(find(run(doc,{process:'cnc',edgeBreak:'internal'}),'edges.radius').status).toBe('pass');
  // A pocket's walls and floor meet in concave edges: 4 vertical and 4 floor edges.
  expect(find(run(squarePocket().state.document,{process:'cnc',edgeBreak:'internal'}),'edges.radius').findings).toHaveLength(8);
 });
 it('counts an exact chamfer strip as an edge break',async()=>{
  const session=createCadSession(undefined,{kernels});
  session.add({kind:'box',size:[30,20,10]},{name:'Block',transform:{...identityTransform(),position:[0,0,5]}});
  await createCommandRunner(session,{exact:exactHost}).runAsync('chamfer 1 Block --face top');
  const edges=find(run(session.state.document,{process:'cnc',edgeBreak:'external'}),'edges.radius');
  expect(edges.summary).toContain('4 chamfers');
  // The top's four edges are bevelled; the four vertical and four bottom edges stay sharp.
  expect(edges.findings).toHaveLength(8);
 });
});

describe('FDM printing',()=>{
 const rib='return subtract(union(box(40,20,4), move([0,0,7], box(40,0.6,10))), move([-15,-6,0], cylinder(0.75,10,48)));';
 it('measures a 0.6 mm rib and a Ø1.5 hole on the exact body; Manifold agrees on the wall',()=>{
  const doc=code(rib,'Bracket').state.document,report=run(doc,{process:'fdm'});
  const wall=find(report,'fdm.min-wall');
  expect(wall.geometry).toBe('exact');
  expect(wall.status).toBe('fail');
  expect(wall.value).toBeCloseTo(.6,9);
  const holes=find(report,'fdm.min-hole');
  expect(holes.status).toBe('fail');
  expect(holes.value).toBeCloseTo(1.5,9);
  expect(find(report,'fdm.overhangs').geometry).toBe('mesh');
  // The mesh check (the existing printability screen) sees the same rib.
  const mesh=checkPrintability(manifold.evaluate(doc).bodies,{minWallMm:.8}).bodies[0].minWall.thinnestMm!;
  expect(Math.abs(mesh-wall.value!)).toBeLessThan(1e-3);
  const meshReport=run(doc,{process:'fdm',exact:false});
  expect(meshReport.bodies[0].geometry).toBe('mesh');
  expect(meshReport.bodies[0].reason).toBe('exact geometry not requested');
  expect(find(meshReport,'fdm.min-wall').value).toBeCloseTo(wall.value!,3);
  expect(find(meshReport,'fdm.min-hole').status).toBe('not-checked');
  expect(find(meshReport,'edges.radius').status).toBe('not-checked');
 });
 it('passes the fixed part',()=>{
  const report=run(code('return subtract(union(box(40,20,4), move([0,0,7], box(40,1.2,10))), move([-15,-6,0], cylinder(1.7,10,48)));').state.document,{process:'fdm'});
  expect(find(report,'fdm.min-wall').status).toBe('pass');
  expect(find(report,'fdm.min-hole').status).toBe('pass');
 });
});

describe('laser-cut sheet',()=>{
 it('recognises a 3 mm sheet and warns about a small hole and a narrow web',()=>{
  // Ø2 hole (below the 3 mm thickness), and a Ø10 hole 2 mm from the +X edge.
  const doc=code('return subtract(box(100,50,3), cylinder(1,10,48), move([43,0,0], cylinder(5,10,48)));','Plate').state.document;
  const report=run(doc,{process:'laser'});
  const sheet=find(report,'laser.sheet');
  expect(sheet.status).toBe('pass');
  expect(sheet.value).toBeCloseTo(3,9);
  const hole=find(report,'laser.min-hole');
  expect(hole.status).toBe('warn');
  expect(hole.findings).toHaveLength(1);
  expect(hole.findings[0].value).toBeCloseTo(2,9);
  const web=find(report,'laser.min-web');
  expect(web.status).toBe('warn');
  expect(web.value).toBeCloseTo(2,6);
 });
 it('refuses a part that is not a flat sheet, naming the faces',()=>{
  const report=run(filletedPocket().state.document,{process:'laser'});
  expect(find(report,'laser.sheet').status).toBe('fail');
  expect(find(report,'laser.sheet').findings.length).toBeGreaterThan(0);
  expect(find(report,'laser.min-web').status).toBe('not-checked');
 });
});

describe('bodies without an exact B-rep',()=>{
 it('checks an imported mesh on its mesh and says why, in English and German',()=>{
  const session=squarePocket();
  session.add({kind:'mesh',positions:[0,0,0,10,0,0,0,10,0,0,0,10],indices:[0,2,1,0,1,3,0,3,2,1,2,3]},{name:'Bracket scan',transform:{...identityTransform(),position:[0,80,0]}});
  const doc=session.state.document,report=run(doc,{process:'cnc'});
  const scan=report.bodies.find(b=>b.name==='Bracket scan')!;
  expect(scan.geometry).toBe('mesh');
  expect(scan.reason).toMatch(/^no exact B-rep: /);
  expect(scan.checks.every(c=>c.geometry==='mesh')).toBe(true);
  expect(scan.checks.find(c=>c.id==='edges.radius')!.status).toBe('not-checked');
  expect(report.bodies.find(b=>b.name==='Square pocket')!.geometry).toBe('exact');
  // The mesh crease search finds the square pocket's four corners too.
  const meshCorners=find(run(squarePocket().state.document,{process:'cnc',exact:false}),'cnc.internal-corners');
  expect(meshCorners.geometry).toBe('mesh');
  expect(meshCorners.findings).toHaveLength(4);
  setLocale('de');
  try{
   const text=formatManufacturingReport(run(doc,{process:'cnc'}));
   expect(text).toContain('Fertigungsprüfung');
   expect(text).toContain('Netz');
   expect(text).toContain('Innenecken');
  }finally{setLocale('en');}
 });
});

describe('the check command',()=>{
 const host=(calls:unknown[]=[]):ManufacturingHost=>({async check(document,request){calls.push(request);return checkManufacturing({meshes:manifold.evaluate(document).bodies,exact:request.settings.exact?drawing(document):undefined,bodies:request.bodies},request.settings);}});
 it('parses options into canonical settings',()=>{
  const session:CadSession=squarePocket();
  const parsed=parseManufacturingCommand(session,'cnc "Square pocket" --tool 4 --axes z,+x --edge-break external --min-radius 0.5');
  expect(parsed.settings).toMatchObject({process:'cnc',toolDiameterMm:4,approachAxes:['+z','+x'],edgeBreak:'external',minRadiusMm:.5,exact:true});
  expect(parsed.invocation).toBe(`check cnc ${session.state.document.roots[0]} --tool 4 --axes +z,+x --min-radius 0.5 --edge-break external`);
  expect(()=>parseManufacturingCommand(session,'mill')).toThrow(/Usage: check/);
  expect(()=>parseManufacturingCommand(session,'cnc --axes +w')).toThrow(/approach axes/);
 });
 it('runs headlessly, read-only, with no history entry',async()=>{
  const session=squarePocket(),before=session.state.revision,calls:unknown[]=[];
  const result=await createCommandRunner(session,{manufacturing:host(calls)}).runAsync('check cnc all --tool 6');
  expect(result.edited).toBe(false);
  expect(session.state.revision).toBe(before);
  expect(result.invocation).toBe('check cnc all');
  expect(result.output).toContain('Internal corner radius [exact B-rep]');
  expect(result.output).toContain('4 sharp internal corners');
  expect(calls).toHaveLength(1);
  await expect(createCommandRunner(session).runAsync('check fdm')).rejects.toThrow(/manufacturing check/);
  expect(manufacturingVerdict(run(session.state.document,{process:'cnc'}))).toBe('fail');
 });
});
