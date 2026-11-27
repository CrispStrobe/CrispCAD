// SPDX-License-Identifier: BSD-3-Clause
// Drawings from exact edges (Phase 6.1): the exact kernel's drawing data, the hidden-line
// projection from the B-rep (true circles and arcs, silhouettes on the exact surface, hidden lines
// clipped at exact positions), bodies the kernel cannot build drawn from their mesh and named, the
// sheet (notes, isometric view, PDF arcs), and edge and curve dimensions on exact geometry.
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createCadSession,createCommandRunner,identityTransform,setLocale} from '@brickwright/cad-core';
import type {AssemblyCurveDimension,CadDocument,DrawingInputs,ExactCommandHost,ExactDrawingData,Vec3} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,EXACT_LIMITS_TABLET,exactKernelIdentity,runExactRequest} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';
import {projectAssembly} from '../packages/editor/src/assembly-drawing.js';
import {saveAssemblyEdge} from '../packages/editor/src/assembly-edge-dimension.js';
import {layoutDrawing} from '../packages/editor/src/drawing-layout.js';
import {exportDrawingPdf} from '../packages/editor/src/drawing-pdf.js';
import {projectExactAssembly} from '../packages/editor/src/exact-drawing-projection.js';
import type {ExactAssemblyProjection} from '../packages/editor/src/exact-drawing-projection.js';

// Exact kernel work: seconds each under load.
vi.setConfig({testTimeout:120_000});
let exact:ExactBackend,manifold:GeometryKernel;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},120_000);
afterAll(()=>setLocale('en'));

const at=(position:Vec3,rotation:Vec3=[0,0,0])=>({...identityTransform(),position,rotation});
const sheet:DrawingInputs={title:'Exact drawing',source:{kind:'assembly'},scale:'1:1',hiddenLines:true};
const close=(a:number,b:number,tolerance=1e-9)=>Math.abs(a-b)<=tolerance;
const drawing=(doc:CadDocument):ExactDrawingData=>{
 const result=runExactRequest(exact,{operation:'drawing',document:doc,bodies:[]},0,{limits:EXACT_LIMITS_TABLET});
 if(result.operation!=='drawing')throw new Error('unexpected');
 return {bodies:result.bodies,failures:result.failures};
};
const project=(doc:CadDocument)=>projectExactAssembly(manifold.evaluate(doc),drawing(doc));
/** Segments of one view as [x1, y1, x2, y2, hidden] tuples. */
const segments=(projection:ExactAssemblyProjection,view:number)=>{
 const data=projection.views[view].segments,out:number[][]=[];
 for(let i=0;i<data.length;i+=5)out.push(Array.from(data.slice(i,i+5)));
 return out;
};
const vertical=(projection:ExactAssemblyProjection,view:number,x:number,hidden:boolean)=>projection.lines[view].polylines
 .filter(line=>line.hidden===hidden&&line.points.every(p=>close(p[0],x,1e-9))).map(line=>line.points.map(p=>p[1]).sort((a,b)=>a-b));
/** Equal to within the straight-edge margin of the hidden-line test (1e-6 mm). */
const near=(values:number[])=>values.map(value=>expect.closeTo(value,5));

/** A 40 × 30 × 10 plate (centred) with a through hole Ø10 at x −8 and a blind hole Ø6, 5 deep, from below at x 10. */
function plate(){
 const session=createCadSession();
 const base=session.add({kind:'box',size:[40,30,10]},{transform:identityTransform()});
 const through=session.add({kind:'cylinder',radius:5,height:30,segments:32},{transform:at([-8,0,0])});
 const blind=session.add({kind:'cylinder',radius:3,height:10,segments:32},{transform:at([10,0,-5])});
 session.setRole('hole',[through,blind]);
 session.combine('union',[base,through,blind]);
 return session;
}

it('draws a drilled plate with true circles, exact hole silhouettes and no hidden lines along visible edges',()=>{
 const session=plate(),doc=session.state.document,data=drawing(doc);
 expect(data.failures).toEqual([]);
 expect(data.bodies).toHaveLength(1);
 const body=data.bodies[0];
 expect(body.edges.filter(edge=>edge.circle).map(edge=>edge.circle!.radius).sort()).toEqual([3,3,5,5]);
 const projection=projectExactAssembly(manifold.evaluate(doc),data);
 expect(projection.origin).toEqual([-20,-15,-5]);
 // Top view: the outline, the through hole as one visible circle (its far rim coincides), the
 // blind hole as one hidden circle; nothing is drawn as chords.
 const top=segments(projection,0);
 expect(top.filter(s=>!s[4])).toHaveLength(4);
 expect(top.filter(s=>s[4])).toEqual([]);
 expect(projection.lines[0].polylines).toEqual([]);
 expect(projection.lines[0].arcs).toEqual([
  {center:[12,15],radius:5,start:0,sweep:2*Math.PI,hidden:false},
  {center:[30,15],radius:3,start:0,sweep:2*Math.PI,hidden:true},
 ]);
 // Front view: hole walls are hidden lines at exactly x ± r, over the full thickness (through) and
 // up to the blind hole's floor; their rims seen edge-on lie on the outline and add no dashes.
 for(const x of [7,17])expect(vertical(projection,1,x,true)).toEqual([near([0,10])]);
 for(const x of [27,33]){
  const [line]=vertical(projection,1,x,true);
  expect(line[0]).toBeLessThan(.011);expect(line[1]).toBe(5);
 }
 const floor=projection.lines[1].polylines.filter(line=>line.hidden&&line.points.every(p=>close(p[1],5)));
 expect(floor).toHaveLength(1);
 expect(Math.min(...floor[0].points.map(p=>p[0]))).toBeCloseTo(27,2);
 expect(Math.max(...floor[0].points.map(p=>p[0]))).toBeCloseTo(33,2);
 expect(projection.lines[1].polylines.filter(line=>line.hidden&&line.points.every(p=>close(p[1],0)||close(p[1],10)))).toEqual([]);
 expect(projection.exact).toMatchObject({meshBodies:[],tessellatedSilhouettes:0,size:[40,30,10],
  holes:[{diameter:6,count:1},{diameter:10,count:1}]});
});

it('puts cylinder silhouettes on the exact radius where the mesh path shows its polygon',()=>{
 const session=createCadSession();
 // 12 segments turned by 15°: the display polygon's outline from the front is at 6 cos 15° = 5.80.
 const id=session.add({kind:'cylinder',radius:6,height:20,segments:12},{transform:at([0,0,10],[0,0,15])});
 const doc=session.state.document,geometry=manifold.evaluate(doc);
 const projection=projectExactAssembly(geometry,drawing(doc));
 expect(projection.bodyIds).toEqual([id]);
 const front=projection.lines[1].polylines.filter(line=>!line.hidden&&close(line.points[0][0],line.points.at(-1)![0])&&Math.abs(line.points[0][1]-line.points.at(-1)![1])>19);
 expect(front.map(line=>line.points[0][0]).sort((a,b)=>a-b)).toEqual([0,12].map(x=>expect.closeTo(x,9)));
 expect(projection.views[1].width).toBeCloseTo(12,9);
 // Top view: one circle of radius 6, not a heptagon.
 expect(projection.lines[0].arcs).toEqual([{center:[6,6],radius:6,start:0,sweep:2*Math.PI,hidden:false}]);
 expect(segments(projection,0)).toEqual([]);
 // The mesh path draws the heptagon's edges instead.
 const mesh=projectAssembly(geometry);
 expect(mesh.views[0].segments.length/5).toBeGreaterThanOrEqual(12);
 expect(mesh.views[1].width).toBeCloseTo(12*Math.cos(Math.PI/12),5);
});

it('draws a sphere as its exact outline circle in every view, also rotated',()=>{
 const session=createCadSession();
 session.add({kind:'sphere',radius:4,segments:24},{transform:at([0,0,0],[30,10,0])});
 const projection=project(session.state.document);
 for(const view of [0,1,2]){
  expect(projection.lines[view].arcs).toEqual([{center:[4,4],radius:4,start:expect.any(Number),sweep:2*Math.PI,hidden:false}]);
  expect(projection.lines[view].polylines).toEqual([]);
 }
 expect(projection.iso.lines.arcs).toHaveLength(1);
 expect(projection.iso.lines.arcs[0].radius).toBe(4);
});

it('clips an edge hidden behind another body at exact positions',()=>{
 const session=createCadSession();
 session.add({kind:'box',size:[24,8,24]},{transform:identityTransform()});
 session.add({kind:'box',size:[32,6,12]},{transform:at([8,20,0])});
 const projection=project(session.state.document);
 // Front view (origin x −12): the rear box spans x 4…36, the front box x 0…24, so the rear box's
 // top and bottom edges are visible from x 24 on and hidden before.
 const rear=segments(projection,1).filter(s=>close(s[1],s[3])&&(close(s[1],6)||close(s[1],18)));
 const visible=rear.filter(s=>!s[4]).map(s=>[Math.min(s[0],s[2]),Math.max(s[0],s[2])]);
 expect(visible).toContainEqual(near([24,36]));
 // The hidden parts inside the front box are drawn (no visible line covers them).
 expect(rear.filter(s=>s[4]).map(s=>[Math.min(s[0],s[2]),Math.max(s[0],s[2])]).every(([a,b])=>a>=-1e-9&&b<=24+1e-9)).toBe(true);
 expect(rear.some(s=>s[4])).toBe(true);
});

it('draws an imported mesh from its mesh in the same pass and names it with the reason',()=>{
 const session=createCadSession();
 session.add({kind:'box',size:[20,20,20]},{transform:identityTransform()});
 const mesh=session.add({kind:'mesh',positions:[0,0,0,10,0,0,0,10,0,0,0,10],indices:[0,2,1,0,1,3,0,3,2,1,2,3]},{name:'Bracket scan',transform:at([0,30,0])});
 const doc=session.state.document,data=drawing(doc);
 expect(data.failures).toEqual([expect.objectContaining({id:mesh,name:'Bracket scan',code:'unsupported',message:expect.stringContaining('no exact B-rep')})]);
 const projection=projectExactAssembly(manifold.evaluate(doc),data);
 expect(projection.exact.exactBodies).toHaveLength(1);
 expect(projection.exact.meshBodies).toEqual([{id:mesh,name:'Bracket scan',reason:expect.stringContaining('no exact B-rep')}]);
 // The tetrahedron's base triangle in the top view (its other edges project onto it or to a point).
 const top=segments(projection,0).filter(s=>Math.min(s[1],s[3])>=40-1e-6);
 expect(top).toHaveLength(3);
 expect(top).toContainEqual(expect.arrayContaining([10,40,0]));
 const page=layoutDrawing(doc,sheet,projection);
 expect(page.texts.map(text=>text.text)).toContain('Edges: exact B-rep for 1 of 2 bodies; from the mesh: Bracket scan');
 setLocale('de');
 try{
  expect(layoutDrawing(doc,sheet,projection).texts.map(text=>text.text)).toContain('Kanten: exakte B-Rep für 1 von 2 Körpern; aus dem Netz: Bracket scan');
 }finally{setLocale('en');}
});

it('lays out the sheet with arcs, an isometric view and exact notes, and exports them as PDF arcs',()=>{
 const doc=plate().state.document,projection=project(doc);
 const page=layoutDrawing(doc,sheet,projection);
 const texts=page.texts.map(text=>text.text);
 expect(texts).toContain('Edges: exact B-rep (1 body)');
 expect(texts).toContain('Exact overall size 40 × 30 × 10 mm · Holes 1 × Ø6 · 1 × Ø10 mm');
 expect(texts).toContain('Isometric view');
 // Top view at (24, 47 + 10 + 20): the through hole is a full visible circle, the blind one dashed.
 expect(page.circles).toContainEqual({center:[24+12,77+15],radius:5});
 expect(page.circles).toContainEqual({center:[24+30,77+15],radius:3,hidden:true});
 // Arcs in the isometric view are ellipses (polylines); the PDF has Bézier circles and dashes.
 const pdf=new TextDecoder().decode(exportDrawingPdf(page,sheet.title).bytes);
 expect(pdf).toMatch(/ c /);
 expect(pdf).toContain('[1.4 0.9] 0 d');
 // Without hidden lines: no dashed arcs or polylines.
 const plain=layoutDrawing(doc,{...sheet,hiddenLines:false},projection);
 expect(plain.circles.some(circle=>circle.hidden)).toBe(false);
 expect(plain.paths.some(path=>path.stroke==='hidden')).toBe(false);
});

it('measures model edges and curves on exact geometry',()=>{
 const session=createCadSession();
 const block=session.add({kind:'box',size:[30,18,12]},{transform:identityTransform()});
 const boss=session.add({kind:'cylinder',radius:7,height:8,segments:12},{transform:at([38,0,4],[0,0,41])});
 const doc=session.state.document,projection=project(doc);
 const page=layoutDrawing(doc,{...sheet,hiddenLines:false},projection);
 const edge=page.assemblyEdges!.find(item=>item.bodyId===block&&item.view===0&&Math.abs(item.projected[1][0]-item.projected[0][0])>29)!;
 expect(edge).toBeDefined();
 const curve=page.assemblyCurves!.find(item=>item.bodyId===boss&&item.view===0)!;
 expect(curve.anchor.radius).toBe(7);
 expect(curve.visible.length).toBeGreaterThan(8);
 const dimension:AssemblyCurveDimension={id:'boss',kind:'diameter',bodyId:boss,source:'cylinder',view:0,at:[141,112]};
 session.saveDrawingSheet({...sheet,hiddenLines:false,edgeDimensions:[saveAssemblyEdge(edge,doc,[80,120],'edge')],curveDimensions:[dimension]});
 const saved=session.state.document,stored=saved.drawings![0];
 const drawn=layoutDrawing(saved,stored,project(saved));
 expect(drawn.annotationIssues).toEqual([]);
 expect(drawn.texts.map(text=>text.text)).toEqual(expect.arrayContaining(['30 mm','Ø14 mm']));
 // The same saved dimensions resolve on the mesh projection too.
 expect(layoutDrawing(saved,stored,manifold.evaluate(saved)).annotationIssues).toEqual([]);
});

it('draws a filleted block with quarter arcs at the corners and its outline on the exact surface',async()=>{
 const host:ExactCommandHost={run:async request=>runExactRequest(exact,request)};
 const session=createCadSession(undefined,{kernels:[exactKernelIdentity]});
 session.add({kind:'box',size:[20,30,10]},{name:'Block',transform:identityTransform()});
 await createCommandRunner(session,{exact:host}).runAsync('fillet 2 Block');
 const doc=session.state.document,data=drawing(doc);
 expect(data.failures).toEqual([]);
 expect(new Set(data.bodies[0].faces.map(face=>face.surface))).toEqual(new Set(['plane','cylinder','sphere']));
 const projection=projectExactAssembly(manifold.evaluate(doc),data);
 expect(projection.exact.tessellatedSilhouettes).toBe(0);
 // Each view: four quarter arcs of radius 2 (no fragments, nothing hidden), centred 2 mm inside the corners.
 const sizes=[[20,30],[20,10],[30,10]];
 for(const view of [0,1,2]){
  const [w,h]=sizes[view],arcs=projection.lines[view].arcs;
  expect(arcs).toHaveLength(4);
  for(const arc of arcs){
   expect(arc).toMatchObject({radius:expect.closeTo(2,9),sweep:expect.closeTo(Math.PI/2,9),hidden:false});
   expect([[2,2],[w-2,2],[2,h-2],[w-2,h-2]]).toContainEqual(arc.center.map(v=>Math.round(v*1e6)/1e6));
  }
  expect(projection.views[view].width).toBeCloseTo(w,9);
  // The outline's straight sides lie on the exact extent.
  const outline=segments(projection,view).filter(s=>!s[4]&&(close(s[0],0,1e-9)&&close(s[2],0,1e-9)||close(s[0],w,1e-9)&&close(s[2],w,1e-9)));
  expect(outline.length).toBeGreaterThanOrEqual(2);
 }
});
