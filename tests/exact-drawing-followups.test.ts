// SPDX-License-Identifier: BSD-3-Clause
// Follow-ups to drawings from exact edges (Phase 6.1): automatic dimensions and hole callouts,
// true ellipses (projection, PDF, SVG, DXF), exact silhouettes of cones and tori, exact sections,
// DXF and SVG export (parsed back, and read by acad-ts), the saved exact choice (document
// version 48), and the MCP tool and CLI verb.
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {DxfReader} from '@node-projects/acad-ts';
import {COUNTERBORE_4762,EXACT_DRAWING_DOCUMENT_VERSION,createCadSession,createCommandRunner,identityTransform,parseDocument,serializeDocument,setLocale,standardHole} from '@brickwright/cad-core';
import type {CadDocument,DrawingInputs,ExactDrawingData,ExactSectionData,Vec3} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {AssemblyCut,GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,EXACT_LIMITS_TABLET,runExactRequest} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';
import {layoutDrawing} from '../packages/editor/src/drawing-layout.js';
import type {DrawingLayout} from '../packages/editor/src/drawing-page.js';
import {exportDrawingPdf} from '../packages/editor/src/drawing-pdf.js';
import {drawingSvg} from '../packages/editor/src/drawing-svg.js';
import {drawingDxfBytes,DXF_ELLIPSE_TOLERANCE} from '../packages/editor/src/drawing-dxf.js';
import {canonicalEllipse,ellipseBeziers,ellipsePoint} from '../packages/editor/src/drawing-conic.js';
import {holeCallout,textBox} from '../packages/editor/src/drawing-auto-dimensions.js';
import {projectExactAssembly} from '../packages/editor/src/exact-drawing-projection.js';
import {clipSectionCurve} from '../packages/editor/src/exact-section-view.js';
import {editorMenu} from '../packages/editor/src/editor-menu.js';
import {createCodeHost} from '../apps/mcp/host.mjs';

vi.setConfig({testTimeout:180_000});
let exact:ExactBackend,manifold:GeometryKernel;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},180_000);
afterAll(()=>setLocale('en'));
const cleanups:(()=>Promise<unknown>|unknown)[]=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()!();});

const at=(position:Vec3,rotation:Vec3=[0,0,0])=>({...identityTransform(),position,rotation});
const drawing=(doc:CadDocument):ExactDrawingData=>{
 const result=runExactRequest(exact,{operation:'drawing',document:doc,bodies:[]},0,{limits:EXACT_LIMITS_TABLET});
 if(result.operation!=='drawing')throw new Error('unexpected');
 return {bodies:result.bodies,failures:result.failures};
};
const section=(doc:CadDocument,cut:AssemblyCut):ExactSectionData=>{
 const positions=[cut.position,...(cut.jog?[cut.jog.position,...(cut.additionalJogs??[]).map(j=>j.position)]:[])];
 const result=runExactRequest(exact,{operation:'section',document:doc,bodies:[],section:{axis:cut.axis,positions}},0,{limits:EXACT_LIMITS_TABLET});
 if(result.operation!=='section')throw new Error('unexpected');
 return {axis:result.axis,positions:result.positions,bodies:result.bodies,failures:result.failures};
};
const project=(doc:CadDocument)=>projectExactAssembly(manifold.evaluate(doc),drawing(doc));
const sheet:DrawingInputs={title:'Plate',source:{kind:'assembly'},scale:'1:1',hiddenLines:true,exactEdges:true,autoDimensions:true};

/** A 80 × 50 × 10 plate (centred) with four M5 clearance holes and an M5 counterbore in the middle. */
function drilledPlate(){
 const session=createCadSession();
 const plate=session.add({kind:'box',size:[80,50,10]},{name:'Plate',transform:identityTransform()});
 const runner=createCommandRunner(session);
 // The first hole turns the plate into a solid/hole union; the others join it.
 const body=()=>session.state.document.roots[0]??plate;
 for(const [x,y] of [[-30,-17.5],[30,-17.5],[-30,17.5],[30,17.5]])runner.run(`hole clearance M5 through 10 at ${x},${y},5 axis 0,0,-1 in ${body()}`);
 runner.run(`hole counterbore M5 through 10 at 0,0,5 axis 0,0,-1 in ${body()}`);
 return session;
}

/** Group codes of a DXF as [code, value] pairs, and its entities. */
function parseDxf(bytes:Uint8Array){
 const lines=new TextDecoder('windows-1252').decode(bytes).split(/\r?\n/);
 const pairs:[number,string][]=[];
 for(let i=0;i+1<lines.length;i+=2)pairs.push([Number(lines[i]),lines[i+1]]);
 const start=pairs.findIndex(([c,v],i)=>c===2&&v==='ENTITIES'&&pairs[i-1][1]==='SECTION');
 const entities:{type:string;codes:Map<number,string[]>}[]=[];
 for(let i=start+1;pairs[i][1]!=='ENDSEC';i++){
  if(pairs[i][0]===0){entities.push({type:pairs[i][1],codes:new Map()});continue;}
  const codes=entities.at(-1)!.codes,list=codes.get(pairs[i][0]);
  if(list)list.push(pairs[i][1]);else codes.set(pairs[i][0],[pairs[i][1]]);
 }
 const header=(name:string)=>{const i=pairs.findIndex(([c,v])=>c===9&&v===name);return i<0?undefined:pairs[i+1][1];};
 const num=(e:{codes:Map<number,string[]>},code:number,k=0)=>Number(e.codes.get(code)![k]);
 return {pairs,entities,header,num};
}
const texts=(page:DrawingLayout)=>page.texts.map(text=>text.text);

it('dimensions a drilled plate automatically: overall size, hole positions, callouts, without overlaps',()=>{
 const doc=drilledPlate().state.document,projection=project(doc);
 const holes=projection.holes[0].map(h=>[...h.center.map(v=>Math.round(v*1e9)/1e9),h.radius]);
 expect(holes).toHaveLength(6);
 expect(holes).toEqual(expect.arrayContaining([[10,7.5,2.75],[70,42.5,2.75],[40,25,2.75],[40,25,COUNTERBORE_4762.M5.diameter/2]]));
 const page=layoutDrawing(doc,sheet,projection);
 const all=texts(page);
 // Overall size from the exact bounding box, hole positions from the left and bottom edges.
 for(const value of ['80','50','10','40','70','7.5','25','42.5'])expect(all).toContain(value);
 const cbore=standardHole({type:'counterbore',thread:'M5',depth:10,through:true});
 expect(all).toContain('4× M5 clearance Ø5.5 thru');
 expect(all).toEqual(expect.arrayContaining(['M5 counterbore Ø5.5 thru',`c'bore Ø${cbore.counterbore!.diameter} × ${cbore.counterbore!.depth} deep`]));
 expect(page.autoDimensions).toMatchObject({callouts:2,omitted:0});
 expect(page.autoDimensions!.placed).toBeGreaterThanOrEqual(9);
 // Vertical dimensions are turned; centre marks cross every hole.
 expect(page.texts.some(text=>text.angle===90&&text.text==='42.5')).toBe(true);
 expect(page.paths.filter(path=>path.stroke==='center').length).toBeGreaterThanOrEqual(2*5);
 // No two texts overlap, and every text stays inside the frame.
 const boxes=page.texts.map(textBox);
 for(let i=0;i<boxes.length;i++){
  expect(boxes[i].l>=8&&boxes[i].r<=289&&boxes[i].b>=8&&boxes[i].t<=202).toBe(true);
  for(let j=i+1;j<boxes.length;j++){
   const a=boxes[i],b=boxes[j];
   expect(a.l<b.r-1e-9&&a.r>b.l+1e-9&&a.b<b.t-1e-9&&a.t>b.b+1e-9,`${page.texts[i].text} / ${page.texts[j].text}`).toBe(false);
  }
 }
 // Off without the option, and German callouts with it.
 expect(texts(layoutDrawing(doc,{...sheet,autoDimensions:undefined},projection))).not.toContain('4× M5 clearance Ø5.5 thru');
 setLocale('de');
 try{
  expect(texts(layoutDrawing(doc,sheet,projection))).toContain('4× M5 Durchgangsbohrung Ø5.5 durchgehend');
 }finally{setLocale('en');}
});

it('writes hole callouts in ISO 129 order for every standard hole type',()=>{
 expect(holeCallout(standardHole({type:'clearance',thread:'M5',depth:8,through:true}),4)).toEqual(['4× M5 clearance Ø5.5 thru']);
 expect(holeCallout(standardHole({type:'clearance',thread:'M4',fit:'close',depth:6}),1)).toEqual(['M4 clearance (close fit) Ø4.3 × 6 deep']);
 expect(holeCallout(standardHole({type:'tapped',thread:'M6',depth:12}),2)).toEqual(['2× M6 tapped, drill Ø5 × 12 deep']);
 const csk=standardHole({type:'countersink',thread:'M5',depth:8,through:true});
 expect(holeCallout(csk,1)).toEqual(['M5 countersink Ø5.5 thru',`c'sink Ø${csk.countersink!.diameter} × 90°`]);
 expect(holeCallout(standardHole({type:'heat-set',thread:'M3'}),3)[0]).toMatch(/^3× M3 heat-set insert pocket Ø4 × /);
});

it('projects circles seen at an angle as true ellipses, and draws them in PDF, SVG and DXF',()=>{
 const session=createCadSession();
 // A cylinder tilted 30° about X: its end circles are ellipses in the top view (ratio cos 30°).
 session.add({kind:'cylinder',radius:6,height:20,segments:24},{transform:at([0,0,0],[30,0,0])});
 const doc=session.state.document,projection=project(doc);
 const top=projection.lines[0].ellipses;
 expect(top.length).toBeGreaterThanOrEqual(2);
 for(const e of top){
  expect(Math.hypot(...e.major)).toBeCloseTo(6,9);
  expect(e.ratio).toBeCloseTo(Math.cos(Math.PI/6),9);
 }
 // The near end is one full visible ellipse; the far end is partly hidden.
 expect(top.some(e=>!e.hidden&&e.sweep>=2*Math.PI-1e-9)).toBe(true);
 expect(top.some(e=>e.hidden)).toBe(true);
 // The isometric view of a vertical cylinder: ellipses of ratio 1/√3.
 const upright=createCadSession();upright.add({kind:'cylinder',radius:5,height:10,segments:24},{transform:identityTransform()});
 const iso=project(upright.state.document).iso.lines.ellipses;
 expect(iso.length).toBeGreaterThanOrEqual(2);
 for(const e of iso){expect(Math.hypot(...e.major)).toBeCloseTo(5,9);expect(e.ratio).toBeCloseTo(1/Math.sqrt(3),9);}
 // The canonical form: M ⟂ N, counter-clockwise, and the same points as the conjugate form.
 const A:[number,number]=[3,1],B:[number,number]=[-.5,2],form=canonicalEllipse(A,B)!;
 for(const theta of [0,.7,2,4.5]){
  const p=ellipsePoint({center:[0,0],major:form.major,ratio:form.ratio},form.toT(theta));
  expect(p[0]).toBeCloseTo(A[0]*Math.cos(theta)+B[0]*Math.sin(theta),12);
  expect(p[1]).toBeCloseTo(A[1]*Math.cos(theta)+B[1]*Math.sin(theta),12);
 }
 // PDF Béziers stay within 2.7e-4 of the major semi-axis.
 const e={center:[10,20] as [number,number],major:[8,3] as [number,number],ratio:.4,start:.3,sweep:4};
 const {start,curves}=ellipseBeziers(e),a=Math.hypot(...e.major);
 let from=start,worst=0;
 for(const c of curves){
  for(let k=0;k<=20;k++){
   const s=k/20,bx=(1-s)**3*from[0]+3*(1-s)**2*s*c[0]+3*(1-s)*s*s*c[2]+s**3*c[4],by=(1-s)**3*from[1]+3*(1-s)**2*s*c[1]+3*(1-s)*s*s*c[3]+s**3*c[5];
   let best=Infinity;for(let j=0;j<=4000;j++){const p=ellipsePoint(e,e.start+e.sweep*j/4000);best=Math.min(best,Math.hypot(p[0]-bx,p[1]-by));}
   worst=Math.max(worst,best);
  }
  from=[c[4],c[5]];
 }
 expect(worst).toBeLessThanOrEqual(2.7e-4*a+2e-3);
 // The sheet: ellipses on paper, in the PDF as curves, in SVG as elliptical arcs, in DXF as ELLIPSE.
 const page=layoutDrawing(doc,{...sheet,autoDimensions:undefined},projection);
 expect(page.ellipses!.length).toBeGreaterThanOrEqual(top.length);
 expect(new TextDecoder().decode(exportDrawingPdf(page,'Tilted').bytes)).toMatch(/ c /);
 const svg=drawingSvg(page,'Tilted');
 expect(svg).toMatch(/A6 5\.1962 /);
 const dxf=parseDxf(drawingDxfBytes(page,'R2000'));
 const ellipses=dxf.entities.filter(x=>x.type==='ELLIPSE');
 expect(ellipses).toHaveLength(page.ellipses!.length);
 // Top view: ratio cos 30°; front view (the end circles at 60° to it): ratio sin 30°; the
 // isometric view's at its own angle and scale.
 const ratios=ellipses.filter(x=>Math.abs(Math.hypot(dxf.num(x,11),dxf.num(x,21))-6)<1e-5).map(x=>dxf.num(x,40));
 for(const r of [.5,Math.cos(Math.PI/6)])expect(ratios.some(value=>Math.abs(value-r)<1e-6)).toBe(true);
 // R12 has no ELLIPSE: polylines within the tolerance of the true ellipse.
 const r12=parseDxf(drawingDxfBytes(page,'R12'));
 expect(r12.entities.some(x=>x.type==='ELLIPSE')).toBe(false);
 // The polylines standing in for ellipses: the long ones on the outline layers.
 const polylines:[number,number][][]=[];
 for(const x of r12.entities){
  if(x.type==='POLYLINE'){polylines.push([]);continue;}
  if(x.type==='VERTEX')polylines.at(-1)!.push([r12.num(x,10),r12.num(x,20)]);
 }
 const vertices=polylines.find(list=>list.length>40)!;
 expect(vertices).toBeDefined();
 const ellipse=page.ellipses!.reduce((best,e)=>{
  const d=(f:typeof e)=>Math.hypot(f.center[0]-vertices[0][0],f.center[1]-vertices[0][1])-Math.hypot(...f.major);
  return Math.abs(d(e))<Math.abs(d(best))?e:best;
 });
 // Every vertex lies on the exact ellipse, and every chord midpoint within the tolerance.
 const distance=(p:[number,number])=>{let best=Infinity;for(let j=0;j<=20000;j++){const q=ellipsePoint(ellipse,ellipse.start+ellipse.sweep*j/20000);best=Math.min(best,Math.hypot(q[0]-p[0],q[1]-p[1]));}return best;};
 expect(distance(vertices[0])).toBeLessThan(1e-4);
 expect(distance([(vertices[0][0]+vertices[1][0])/2,(vertices[0][1]+vertices[1][1])/2])).toBeLessThanOrEqual(DXF_ELLIPSE_TOLERANCE);
});

it('puts cone and torus silhouettes on the exact surface',()=>{
 const session=createCadSession();
 session.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:'return frustum(10, 0, 20, 24);'},'Cone');
 session.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:'return move([40, 0, 0], torus(12, 3, 16, 24));'},'Ring');
 const doc=session.state.document,data=drawing(doc);
 expect(data.failures).toEqual([]);
 expect(new Set(data.bodies.flatMap(body=>body.faces.map(face=>face.surface)))).toEqual(new Set(['cone','plane','torus']));
 const projection=projectExactAssembly(manifold.evaluate(doc),data);
 expect(projection.exact.tessellatedSilhouettes).toBe(0);
 const [x0,,z0]=projection.origin;
 // Front view: the cone's outlines are its generators, |x| = 10 (1 − z / 20) about its axis.
 const coneLines=projection.lines[1].polylines.filter(line=>!line.hidden&&line.points.every(p=>p[0]+x0<10.5));
 expect(coneLines.length).toBe(2);
 for(const line of coneLines)for(const [u,v] of line.points){
  const x=u+x0,z=v+z0;
  expect(Math.abs(x)).toBeCloseTo(10*(1-(z-z0)/20),9);
 }
 // Top view: the torus outlines are the circles of radius 15 and 9 about its centre.
 const rings=projection.lines[0].arcs.filter(arc=>arc.center[0]+x0>30);
 expect(rings.map(arc=>arc.radius).sort((a,b)=>a-b)).toEqual([9,15].map(r=>expect.closeTo(r,9)));
 // Front view: torus outline points are r = 3 from the tube circle (radius 12 in the XY plane).
 const torusLines=projection.lines[1].polylines.filter(line=>!line.hidden&&line.points.every(p=>p[0]+x0>26));
 expect(torusLines.length).toBeGreaterThan(0);
 const errors:number[]=[];
 for(const line of torusLines)for(const [u,v] of line.points){
  const x=u+x0-40,z=v+z0;
  // The outline: the tube circles in the plane y = 0 (3 from (±12, 0)), and the lines z = ±3.
  errors.push(Math.min(Math.abs(Math.hypot(x-12,z)-3),Math.abs(Math.hypot(x+12,z)-3),Math.abs(Math.abs(z)-3)));
 }
 // Snapped points are exact; where a line turns hidden the split point lies on a chord between
 // two of them (within the chord tolerance).
 errors.sort((a,b)=>a-b);
 expect(errors[Math.floor(errors.length/2)]).toBeLessThan(1e-9);
 expect(errors.at(-1)!).toBeLessThan(projection.exact.tolerance);
});

it('draws sections from the exact cut faces: true circles, ellipses and clipped jogs',()=>{
 const session=createCadSession();
 const plate=session.add({kind:'box',size:[40,30,10]},{transform:identityTransform()});
 const straight=session.add({kind:'cylinder',radius:5,height:30,segments:16},{transform:at([-8,0,0])});
 const tilted=session.add({kind:'cylinder',radius:3,height:40,segments:16},{transform:at([10,0,0],[30,0,0])});
 session.setRole('hole',[straight,tilted]);
 session.combine('union',[plate,straight,tilted]);
 const doc=session.state.document,geometry=manifold.evaluate(doc);
 const cut:AssemblyCut={axis:1,position:0};
 const data=section(doc,cut);
 expect(data.failures).toEqual([]);
 const edges=data.bodies[0].legs[0];
 // The straight hole's walls are lines at x = −13 and −3; the tilted hole's cut is elliptical.
 const vertical=edges.filter(e=>e.curve==='line'&&Math.abs(e.points[0]-e.points[3])<1e-12).map(e=>e.points[0]).sort((a,b)=>a-b);
 expect(vertical).toEqual(expect.arrayContaining([-20,-13,-3,20].map(v=>expect.closeTo(v,9))));
 expect(edges.some(e=>e.curve==='ellipse')).toBe(true);
 const projection={...projectExactAssembly(geometry,drawing(doc)),sections:[{...manifold.sliceAssembly(geometry,cut),exact:data}]};
 const page=layoutDrawing(doc,{...sheet,autoDimensions:undefined,section:{axis:'v',position:0}},projection);
 // Section view at (rightX, topY): rightX = 24 + 40 + 20, topY = 47 + 10 + 20.
 const sectionEllipses=page.ellipses!.filter(e=>e.center[0]>=84&&e.center[1]>=77);
 expect(sectionEllipses.length).toBeGreaterThan(0);
 for(const e of sectionEllipses){
  // The axis meets the plane y = 0 at 60°: semi-axes 3 / sin 30° = 6 along Z and 3 along X.
  expect(Math.hypot(...e.major)).toBeCloseTo(6,9);
  expect(e.ratio).toBeCloseTo(.5,9);
 }
 const sectionLines=page.paths.filter(p=>p.stroke==='section');
 for(const x of [84,84+7,84+17,84+40])expect(sectionLines.some(p=>p.points.every(q=>Math.abs(q[0]-x)<1e-9))).toBe(true);
 // Hatch lines end on the exact outline: none crosses the straight hole (x 91 … 101).
 const hatch=page.paths.filter(p=>p.stroke==='hatch'&&p.points[0][0]>=84-1e-9);
 expect(hatch.length).toBeGreaterThan(5);
 for(const [[a],[b]] of hatch.map(p=>p.points))expect(Math.min(a,b)<91+1e-6&&Math.max(a,b)>101-1e-6).toBe(false);
 // A stepped cut: leg 1 at y = 0 up to x = 0, leg 2 at y = 10 after it. The tilted hole (x 7…13)
 // is not on leg 2's plane, the straight hole is only on leg 1's: the jog line at x = 0 runs where
 // exactly one leg has material.
 const stepped:AssemblyCut={axis:1,position:0,jog:{at:0,position:10}};
 const steppedData=section(doc,stepped);
 const curves=clipSectionCurve({kind:'conic',center:[0,0],A:[5,0],B:[0,5],radius:5,from:0,to:2*Math.PI},-1,1);
 expect(curves).toHaveLength(2);
 const steppedPage=layoutDrawing(doc,{...sheet,autoDimensions:undefined,section:{axis:'v',position:0,jog:{at:0,position:10}}},
  {...projection,sections:[{...manifold.sliceAssembly(geometry,stepped),exact:steppedData}]});
 const jogLines=steppedPage.paths.filter(p=>p.stroke==='section'&&p.points.every(q=>Math.abs(q[0]-(84+20))<1e-9));
 // Both legs are solid across the full thickness at x = 0: no jog line.
 expect(jogLines).toEqual([]);
 // Leg 2 (y = 10) misses both holes: its outline after the jog is the plate's rectangle only.
 expect(steppedPage.ellipses!.filter(e=>e.center[0]>=84&&e.center[1]>=77)).toEqual([]);
});

it('exports DXF R2000 and R12 with real ARC and CIRCLE entities, layers and millimetre units, readable by acad-ts',()=>{
 const doc=drilledPlate().state.document,page=layoutDrawing(doc,sheet,project(doc));
 for(const version of ['R2000','R12'] as const){
  const bytes=drawingDxfBytes(page,version),dxf=parseDxf(bytes);
  expect(dxf.header('$ACADVER')).toBe(version==='R2000'?'AC1015':'AC1009');
  if(version==='R2000'){expect(dxf.header('$INSUNITS')).toBe('4');expect(Number.parseInt(dxf.header('$HANDSEED')!,16)).toBeGreaterThan(0x20);}
  const circles=dxf.entities.filter(x=>x.type==='CIRCLE');
  // Top view at 1:1: four Ø5.5 holes, the Ø5.5 bore and the counterbore as true circles.
  expect(circles.filter(x=>Math.abs(dxf.num(x,40)-2.75)<1e-9).length).toBe(5);
  expect(circles.some(x=>Math.abs(dxf.num(x,40)-COUNTERBORE_4762.M5.diameter/2)<1e-9)).toBe(true);
  expect(circles.every(x=>x.codes.get(8)![0]==='VISIBLE'||x.codes.get(8)![0]==='HIDDEN')).toBe(true);
  const callout=dxf.entities.find(x=>x.type==='TEXT'&&x.codes.get(1)![0]==='4× M5 clearance Ø5.5 thru');
  expect(callout?.codes.get(8)![0]).toBe('TEXT');
  expect(dxf.entities.some(x=>x.type==='TEXT'&&Number(x.codes.get(50)?.[0])===90)).toBe(true);
  // An independent reader opens it with the same entities.
  const read=DxfReader.readFromStream(bytes);
  const types=new Map<string,number>();
  for(const entity of read.entities)types.set(entity.objectName,(types.get(entity.objectName)??0)+1);
  expect(types.get('CIRCLE')).toBe(circles.length);
  expect(types.get('TEXT')).toBe(dxf.entities.filter(x=>x.type==='TEXT').length);
 }
 // SVG: millimetre paper, circles of the hole radius, the callout text.
 const svg=drawingSvg(page,'Plate');
 expect(svg).toContain('width="297mm" height="210mm" viewBox="0 0 297 210"');
 expect(svg).toMatch(/<circle class="visible" cx="[\d.]+" cy="[\d.]+" r="2.75"\/>/);
 expect(svg).toContain('4× M5 clearance Ø5.5 thru');
});

it('saves the exact-edges and automatic-dimensions choice with an assembly sheet (document version 48)',()=>{
 const session=drilledPlate(),before=session.state.document.version;
 expect(before).toBe(47);
 session.saveDrawingSheet({...sheet,title:'Exact'});
 const doc=session.state.document;
 expect(doc.version).toBe(EXACT_DRAWING_DOCUMENT_VERSION);
 expect(doc.drawings![0]).toMatchObject({exactEdges:true,autoDimensions:true});
 expect(parseDocument(serializeDocument(doc)).drawings![0]).toMatchObject({exactEdges:true,autoDimensions:true});
 session.undo();
 expect(session.state.document.version).toBe(before);
 // A sheet without the choice keeps the earlier version; the fields need version 48 and exact edges.
 session.saveDrawingSheet({...sheet,exactEdges:undefined,autoDimensions:undefined});
 expect(session.state.document.version).toBe(before);
 const bad=(change:(doc:CadDocument)=>void)=>{const copy=structuredClone(doc);change(copy);return ()=>parseDocument(serializeDocument(copy));};
 expect(bad(d=>{d.version=47;})).toThrow();
 expect(bad(d=>{delete d.drawings![0].exactEdges;})).toThrow();
 expect(bad(d=>{(d.drawings![0] as {exactEdges:unknown}).exactEdges=false;})).toThrow();
 expect(editorMenu.find(item=>item.command==='drawing-export')).toMatchObject({section:'drawing',requires:'canDraw'});
});

it('renders drawing sheets through the MCP tool and the CLI',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cad-drawing-')),path=join(folder,'plate.bcad');cleanups.push(()=>rm(folder,{recursive:true,force:true}));
 const host=await createCodeHost({project:path});cleanups.push(()=>host.dispose());
 const {revision}=await host.call('cad_get_model');
 await host.call('cad_run_commands',{commands:'box 60,40,8\nhole clearance M4 through 8 at -20,0,4 axis 0,0,-1 in "Box"',expectedRevision:revision});
 const dxf=await host.call('cad_drawing',{format:'dxf'});
 expect(dxf).toMatchObject({exact:true,mime:'image/vnd.dxf',scale:'2:1'});
 expect(dxf.notes).toEqual(expect.arrayContaining(['Edges from the exact B-rep: 1 bodies',expect.stringMatching(/^Automatic dimensions: \d+ placed, 1 hole callouts, 0 left off/)]));
 const parsed=parseDxf(Buffer.from(dxf.base64,'base64'));
 // At 2:1 the Ø4.5 hole is a circle of radius 4.5 on paper.
 expect(parsed.entities.some(x=>x.type==='CIRCLE'&&Math.abs(parsed.num(x,40)-4.5)<1e-9)).toBe(true);
 expect(parsed.entities.some(x=>x.type==='TEXT'&&x.codes.get(1)![0]==='M4 clearance Ø4.5 thru')).toBe(true);
 const mesh=await host.call('cad_drawing',{format:'svg',exact:false,scale:'1:1'});
 expect(mesh).toMatchObject({exact:false,scale:'1:1',notes:[]});
 expect(Buffer.from(mesh.base64,'base64').toString()).toContain('<svg');
 await expect(host.call('cad_drawing',{format:'pdf',sheet:'Missing'})).rejects.toThrow('No drawing sheet Missing');
 await host.dispose();
 // CLI: the format from the file name.
 const cli=(...args:string[])=>promisify(execFile)(process.execPath,[resolve('apps/cli/crispcad.mjs'),...args]);
 const out=join(folder,'plate.pdf');
 const result=JSON.parse((await cli('drawing',path,out,'--dxf','r12')).stdout);
 expect(result).toMatchObject({exact:true,mime:'application/pdf',path:out});
 expect((await readFile(out)).subarray(0,8).toString()).toBe('%PDF-1.6');
 await expect(cli('drawing',path,join(folder,'plate.png'))).rejects.toMatchObject({stderr:expect.stringMatching(/\.pdf, \.svg or \.dxf/)});
});
