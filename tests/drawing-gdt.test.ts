// SPDX-License-Identifier: BSD-3-Clause
// Datums and geometric tolerances on exact drawing sheets (document version 52), cosmetic threads
// and thread callouts of tapped standard holes, and DXF DIMENSION entities in R2000 exports.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {DxfReader} from '@node-projects/acad-ts';
import {GDT_DRAWING_DOCUMENT_VERSION,createCadSession,createCommandRunner,drawingSourceFor,identityTransform,parseDocument,serializeDocument,setLocale,standardHole} from '@brickwright/cad-core';
import type {CadDocument,DrawingDatum,DrawingInputs,DrawingToleranceFrame,ExactDrawingData} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,EXACT_LIMITS_TABLET,runExactRequest} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';
import {layoutDrawing} from '../packages/editor/src/drawing-layout.js';
import type {DrawingLayout} from '../packages/editor/src/drawing-page.js';
import {drawingDxfBytes,exportDrawingDxf} from '../packages/editor/src/drawing-dxf.js';
import {drawingSvg} from '../packages/editor/src/drawing-svg.js';
import {exportDrawingPdf} from '../packages/editor/src/drawing-pdf.js';
import {holeCallout} from '../packages/editor/src/drawing-auto-dimensions.js';
import {gdtCandidates,gdtTargetLines,resolveGdtTarget,toleranceFrameCells} from '../packages/editor/src/drawing-gdt.js';
import {toleranceFrameProblem} from '../packages/editor/src/drawing-gdt-controls.js';
import {THREAD_ARC} from '../packages/editor/src/drawing-threads.js';
import {helveticaWidth} from '../packages/editor/src/drawing-symbols.js';
import {projectExactAssembly} from '../packages/editor/src/exact-drawing-projection.js';
import type {ExactAssemblyProjection} from '../packages/editor/src/exact-drawing-projection.js';

vi.setConfig({testTimeout:180_000});
let exact:ExactBackend,manifold:GeometryKernel;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},180_000);
afterAll(()=>setLocale('en'));

const drawing=(doc:CadDocument):ExactDrawingData=>{
 const result=runExactRequest(exact,{operation:'drawing',document:doc,bodies:[]},0,{limits:EXACT_LIMITS_TABLET});
 if(result.operation!=='drawing')throw new Error('unexpected');
 return {bodies:result.bodies,failures:result.failures};
};
const project=(doc:CadDocument)=>projectExactAssembly(manifold.evaluate(doc),drawing(doc));
const base:DrawingInputs={title:'Plate',source:{kind:'assembly'},scale:'1:1',hiddenLines:true};
const exactSheet:DrawingInputs={...base,exactEdges:true};

/** The drilled plate of the v48 tests (80 × 50 × 10, four M5 clearance holes, an M5 counterbore), optionally with a blind M4 tapped hole. */
function plate(tapped=false){
 const session=createCadSession();
 const box=session.add({kind:'box',size:[80,50,10]},{name:'Plate',transform:identityTransform()});
 const runner=createCommandRunner(session);
 const body=()=>session.state.document.roots[0]??box;
 for(const [x,y] of [[-30,-17.5],[30,-17.5],[-30,17.5],[30,17.5]])runner.run(`hole clearance M5 through 10 at ${x},${y},5 axis 0,0,-1 in ${body()}`);
 runner.run(`hole counterbore M5 through 10 at 0,0,5 axis 0,0,-1 in ${body()}`);
 if(tapped)runner.run(`hole tapped M4 at 15,0,5 axis 0,0,-1 in ${body()}`);
 return {session,box};
}
const holes=(doc:CadDocument)=>Object.values(doc.nodes).filter(node=>node.kind==='hole');
/** The stable name of a face of `node` found by its surface and normal. */
function faceName(projection:ExactAssemblyProjection,node:string,surface:string,normal?:number[]){
 for(const body of projection.topology)for(const face of body.faces)
  if(face.name?.startsWith(node+':f')&&face.surface===surface&&(!normal||normal.every((v,i)=>Math.abs(face.normal[i]-v)<1e-9)))return face.name;
 throw new Error('no such face');
}
/** Paper y of world z in the front view, and paper x of world x. */
const front=(page:DrawingLayout,projection:ExactAssemblyProjection)=>({
 y:(z:number)=>page.gdt!.views[1].bottom+(z-projection.origin[2])*page.factor,
 x:(x:number)=>page.gdt!.views[1].left+(x-projection.origin[0])*page.factor,
});

it('attaches datums and feature control frames to exact faces by stable name, and follows them through edits',()=>{
 const {session,box}=plate(),doc=session.state.document,projection=project(doc);
 const top=faceName(projection,box,'plane',[0,0,1]);
 expect(top).toMatch(new RegExp(`^${box}:f\\d+$`));
 const bore=holes(doc)[0],boreFace=faceName(projection,bore.id,'cylinder');
 const datums:DrawingDatum[]=[
  {id:'datumA',letter:'A',target:top,view:1,at:[60,75]},
  {id:'datumB',letter:'B',target:boreFace,view:0,at:[20,160]},
 ];
 const tolerances:DrawingToleranceFrame[]=[
  {id:'flat',characteristic:'flatness',tolerance:.05,target:top,view:1,at:[95,72]},
  {id:'pos',characteristic:'position',tolerance:.1,diameter:true,modifier:'M',datums:['A','B'],target:boreFace,view:0,at:[60,165]},
 ];
 const page=layoutDrawing(doc,{...exactSheet,datums,tolerances},projection);
 expect(page.annotationIssues).toEqual([]);
 const texts=page.texts.map(text=>text.text);
 for(const text of ['A','B','0.05','Ø0.1','M'])expect(texts).toContain(text);
 // The datum triangle stands on the plate's top face, which the front view shows as a line at z = 5.
 const paper=front(page,projection);
 const triangles=page.paths.filter(path=>path.closed&&path.points.length===3&&path.stroke==='annotation');
 const onTop=triangles.filter(path=>{const [a,,c]=path.points;return Math.abs((a[1]+c[1])/2-paper.y(5))<1e-9;});
 expect(onTop.length).toBe(1); // datum A's triangle
 // The flatness frame's arrowhead ends on the same line.
 expect(triangles.some(path=>path!==onTop[0]&&Math.abs(path.points[0][1]-paper.y(5))<1e-9)).toBe(true);
 for(const line of gdtTargetLines(page,top,1))for(const [,y] of line)expect(y).toBeCloseTo(paper.y(5),9);
 // The frame: symbol cell, tolerance cell (Ø0.1 Ⓜ), two datum cells.
 const {cells,width}=toleranceFrameCells(tolerances[1]);
 expect(cells.length).toBe(4);
 expect(width).toBeCloseTo(6+1.6+helveticaWidth('Ø0.1',2.5)+.4+5*.64+10,9);
 // Picking: a tap on the top line of the front view offers the top face first (seen edge-on).
 const candidates=gdtCandidates(page,doc,[paper.x(0),paper.y(5)+.2]);
 expect(candidates[0]).toMatchObject({target:top,view:1});
 expect(candidates.some(c=>c.target.includes('+'))).toBe(true);
 // An edge reference resolves to one exact edge.
 const edge=candidates.find(c=>c.target.includes('+'))!.target;
 expect(resolveGdtTarget(projection.topology,edge)).toMatchObject({polylines:[expect.any(Array)]});
 // Moving the hole moves datum B's leader with it: the name follows the face.
 const moved=structuredClone(doc);
 moved.nodes[bore.id].transform.position=[-25,-12.5,5];
 const movedProjection=project(moved);
 const before=resolveGdtTarget(projection.topology,boreFace),after=resolveGdtTarget(movedProjection.topology,boreFace);
 const centre=(r:ReturnType<typeof resolveGdtTarget>)=>{if(!('polylines' in r))throw new Error('stale');const p=r.polylines.flat();return [0,1].map(i=>(Math.min(...p.map(q=>q[i]))+Math.max(...p.map(q=>q[i])))/2);};
 expect(centre(before)[0]).toBeCloseTo(-30,6);expect(centre(after)[0]).toBeCloseTo(-25,6);
 expect(layoutDrawing(moved,{...exactSheet,datums,tolerances},movedProjection).annotationIssues).toEqual([]);
 // PDF, SVG and DXF carry the frames as lines and text.
 expect(exportDrawingPdf(page,'Plate').bytes.length).toBeGreaterThan(1000);
 expect(drawingSvg(page,'Plate')).toContain('>Ø0.1<');
 expect(new TextDecoder('windows-1252').decode(drawingDxfBytes(page,'R2000'))).toContain('\r\nØ0.1\r\n');
});

it('marks a datum or tolerance whose face is gone and never attaches it to another face',()=>{
 const {session}=plate(),doc=session.state.document,projection=project(doc);
 const bore=holes(doc)[0],boreFace=faceName(projection,bore.id,'cylinder');
 const datums:DrawingDatum[]=[{id:'datumB',letter:'B',target:boreFace,view:0,at:[20,160]}];
 const tolerances:DrawingToleranceFrame[]=[{id:'round',characteristic:'circularity',tolerance:.02,target:boreFace,view:0,at:[60,165]}];
 // The hole is deleted: its faces are gone, the other holes' faces have other names.
 const without=structuredClone(doc),union=without.nodes[without.roots[0]] as {inputs:string[]};
 union.inputs=union.inputs.filter(input=>input!==bore.id);delete without.nodes[bore.id];
 const stale=project(without);
 expect(resolveGdtTarget(stale.topology,boreFace)).toEqual({reason:'missing'});
 const page=layoutDrawing(without,{...exactSheet,datums,tolerances},stale);
 expect(page.annotationIssues).toEqual(['datumB','round']);
 expect(page.paths.filter(path=>path.stroke==='error').length).toBe(4);
 const notes=page.texts.filter(text=>text.text.includes('reference lost'));
 expect(notes.map(note=>note.text)).toEqual([expect.stringMatching(/^Datum B: reference lost \(.* face \d+ no longer exists\)$/),expect.stringMatching(/^Tolerance 1: reference lost/)]);
 // No leader is drawn to any face: no datum triangle, no arrowhead.
 expect(page.paths.some(path=>path.closed&&path.points.length===3)).toBe(false);
 expect(()=>exportDrawingDxf(page,'Plate')).toThrow('Repair or remove');
 // An edge whose faces no longer meet is stale too.
 const top=faceName(stale,Object.values(without.nodes).find(n=>n.kind==='box')!.id,'plane',[0,0,1]);
 expect(resolveGdtTarget(stale.topology,`${boreFace}+${top}`)).toMatchObject({reason:'missing'});
 setLocale('de');
 expect(layoutDrawing(without,{...exactSheet,datums},stale).texts.some(text=>text.text.startsWith('Bezug B: Bezug verloren'))).toBe(true);
 setLocale('en');
});

it('saves datums and tolerances with an exact sheet in document version 52, and refuses malformed ones',()=>{
 const {session,box}=plate(),before=session.state.document.version,projection=project(session.state.document);
 expect(before).toBe(47);
 const top=faceName(projection,box,'plane',[0,0,1]);
 const datums:DrawingDatum[]=[{id:'datumA',letter:'A',target:top,view:1,at:[60,75]}];
 const tolerances:DrawingToleranceFrame[]=[{id:'par',characteristic:'parallelism',tolerance:.1,datums:['A'],target:faceName(projection,box,'plane',[0,0,-1]),view:1,at:[95,40]}];
 const nodes=structuredClone(session.state.document.nodes);
 session.saveDrawingSheet({...exactSheet,datums,tolerances});
 const doc=session.state.document;
 expect(doc.version).toBe(GDT_DRAWING_DOCUMENT_VERSION);
 expect(GDT_DRAWING_DOCUMENT_VERSION).toBe(52);
 expect(doc.nodes).toEqual(nodes); // saved geometry is untouched
 const reopened=parseDocument(serializeDocument(doc));
 expect(reopened.drawings![0]).toMatchObject({datums,tolerances});
 session.undo();
 expect(session.state.document.version).toBe(before);
 // A sheet without them keeps the version its other fields need (48 for exact edges).
 session.saveDrawingSheet(exactSheet);
 expect(session.state.document.version).toBe(48);
 const bad=(change:(d:CadDocument)=>void)=>{const copy=structuredClone(doc);change(copy);return ()=>parseDocument(serializeDocument(copy));};
 expect(bad(()=>{})).not.toThrow();
 expect(bad(d=>{d.version=50;})).toThrow();
 expect(bad(d=>{(d as {version:number}).version=51;})).toThrow();
 expect(bad(d=>{delete d.drawings![0].exactEdges;})).toThrow();
 expect(bad(d=>{d.drawings![0].datums![0].target='not a face';})).toThrow();
 expect(bad(d=>{d.drawings![0].datums![0].letter='I';})).toThrow();
 expect(bad(d=>{d.drawings![0].datums!.push({...datums[0],id:'again'});})).toThrow(); // letter twice
 expect(bad(d=>{d.drawings![0].tolerances![0].datums=['B'];})).toThrow(); // no datum B
 expect(bad(d=>{delete d.drawings![0].tolerances![0].datums;})).toThrow(); // parallelism needs a datum
 expect(bad(d=>{d.drawings![0].tolerances![0].characteristic='flatness';})).toThrow(); // form: no datum
 expect(bad(d=>{d.drawings![0].tolerances![0].tolerance=0;})).toThrow();
 expect(bad(d=>{(d.drawings![0].tolerances![0] as DrawingToleranceFrame).diameter=true;d.drawings![0].tolerances![0].characteristic='symmetry';})).toThrow();
 expect(bad(d=>{d.drawings![0].tolerances![0].at=[0,0];})).toThrow();
 expect(toleranceFrameProblem({characteristic:'flatness',tolerance:.05,datums:['A']})).toBe('A form tolerance has no datums.');
 expect(toleranceFrameProblem({characteristic:'position',tolerance:.1,diameter:true,modifier:'M'})).toBeUndefined();
 // Version 52 opens documents of every earlier version unchanged.
 const old=parseDocument(serializeDocument({...doc,version:48,drawings:[{...doc.drawings![0],datums:undefined,tolerances:undefined}]}));
 expect(old.version).toBe(48);
});

it('draws cosmetic threads of tapped holes and calls them out with the thread designation and depth symbol',()=>{
 expect(holeCallout(standardHole({type:'tapped',thread:'M4'}),1)).toEqual(['M4×0.7 - 6H ↧ 8','tap drill Ø3.3 ↧ 8']);
 expect(holeCallout(standardHole({type:'tapped',thread:'M6',through:true,depth:10}),2)).toEqual(['2× M6×1 - 6H thru','tap drill Ø5 thru']);
 setLocale('de');
 expect(holeCallout(standardHole({type:'tapped',thread:'M4'}),1)).toEqual(['M4×0.7 - 6H ↧ 8','Kernloch Ø3.3 ↧ 8']);
 setLocale('en');
 const {session}=plate(true),doc=session.state.document,projection=project(doc);
 const page=layoutDrawing(doc,{...exactSheet,autoDimensions:true},projection);
 // Top view: a thin 3/4 circle of the M4 major diameter around the Ø3.3 drill.
 const thread=page.circles.filter(circle=>circle.thin);
 expect(thread.length).toBe(1);
 expect(thread[0].radius).toBeCloseTo(2,12);
 expect(thread[0].arc).toEqual(THREAD_ARC);
 const drill=page.circles.find(circle=>!circle.thin&&Math.abs(circle.radius-1.65)<1e-9&&Math.hypot(circle.center[0]-thread[0].center[0],circle.center[1]-thread[0].center[1])<1e-6);
 expect(drill).toBeDefined();
 // Front view: hidden major-diameter lines at x = 15 ± 2 from z = 5 down 8 mm, and the end line.
 const paper=front(page,projection);
 const side=page.paths.filter(path=>path.stroke==='hidden'&&path.points.length===2&&
  path.points.every(([x])=>Math.abs(x-paper.x(13))<1e-9||Math.abs(x-paper.x(17))<1e-9));
 expect(side.map(path=>path.points.map(([,y])=>Number(((y-paper.y(0))).toFixed(9))).sort())).toEqual(expect.arrayContaining([[-3,5],[-3,5],[-3,-3]]));
 // The callout: text either side of the depth symbol, which is drawn as lines.
 const texts=page.texts.map(text=>text.text);
 expect(texts).toContain('M4×0.7 - 6H ');
 expect(texts).toContain('tap drill Ø3.3 ');
 expect(texts.filter(text=>text===' 8').length).toBe(2);
 expect(texts.some(text=>text.includes('↧'))).toBe(false);
 // DXF: the thread circle is an ARC on the THREAD layer; the SVG styles it thin.
 const dxf=new TextDecoder('windows-1252').decode(drawingDxfBytes(page,'R2000'));
 expect(dxf).toMatch(/\r\n {2}0\r\nARC\r\n(?:.*\r\n){7}THREAD\r\n/);
 expect(drawingSvg(page,'Plate')).toContain('.thread{');
});

/** Group codes of a DXF file, its entities by section, and its blocks. */
function parse(bytes:Uint8Array){
 const lines=new TextDecoder('windows-1252').decode(bytes).split('\r\n'),pairs:[number,string][]=[];
 for(let i=0;i+1<lines.length;i+=2)pairs.push([Number(lines[i]),lines[i+1]]);
 const section=(name:string)=>{
  const start=pairs.findIndex(([c,v],i)=>c===2&&v===name&&pairs[i-1][1]==='SECTION'),out:{type:string;codes:[number,string][]}[]=[];
  for(let i=start+1;pairs[i][1]!=='ENDSEC';i++){if(pairs[i][0]===0)out.push({type:pairs[i][1],codes:[]});else out.at(-1)!.codes.push(pairs[i]);}
  return out;
 };
 return {entities:section('ENTITIES'),blocks:section('BLOCKS'),tables:section('TABLES')};
}
const code=(entity:{codes:[number,string][]},c:number)=>entity.codes.filter(([k])=>k===c).map(([,v])=>v);
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

it('exports dimensions as DXF DIMENSION entities with their block geometry, and sheets without dimensions byte for byte as before',()=>{
 const {session}=plate(),doc=session.state.document,projection=project(doc),geometry=manifold.evaluate(doc);
 const auto=layoutDrawing(doc,{...exactSheet,autoDimensions:true},projection);
 expect(auto.dimensions?.length).toBe(9);
 const bytes=drawingDxfBytes(auto,'R2000'),dxf=parse(bytes);
 const dims=dxf.entities.filter(e=>e.type==='DIMENSION');
 expect(dims.length).toBe(9);
 expect(dims.map(d=>code(d,2)[0])).toEqual(Array.from({length:9},(_,i)=>`*D${i+1}`));
 expect(dims.map(d=>Number(code(d,42)[0])).sort((a,b)=>a-b)).toEqual([7.5,10,10,25,40,42.5,50,70,80]);
 for(const d of dims){
  expect(Number(code(d,70)[0])&7).toBe(0);
  expect(code(d,100)).toEqual(['AcDbEntity','AcDbDimension','AcDbAlignedDimension','AcDbRotatedDimension']);
  expect(code(d,1000)).toEqual(['DSTYLE']);expect(Number(code(d,1040)[0])).toBe(1);
 }
 // Each block holds its dimension's lines and text; ENTITIES does not repeat them.
 const blocks=dxf.blocks.filter(e=>e.type==='BLOCK'&&code(e,2)[0]?.startsWith('*D'));
 expect(blocks.length).toBe(9);
 expect(dxf.blocks.filter(e=>e.type==='TEXT').length).toBe(9);
 const plain=parse(drawingDxfBytes(auto,'R12')).entities;
 const lines=(list:{type:string}[])=>list.filter(e=>e.type==='LINE').length;
 expect(lines(dxf.entities)+lines(dxf.blocks)).toBe(lines(plain));
 expect(dxf.entities.filter(e=>e.type==='TEXT').length+9).toBe(plain.filter(e=>e.type==='TEXT').length);
 expect(plain.some(e=>e.type==='DIMENSION')).toBe(false);
 // The block record table lists model space, paper space and the nine blocks.
 const records=dxf.tables.filter(e=>e.type==='BLOCK_RECORD').map(e=>code(e,2)[0]);
 expect(records).toEqual(['*Model_Space','*Paper_Space',...Array.from({length:9},(_,i)=>`*D${i+1}`)]);
 // An independent reader opens it and sees the dimensions.
 const read=DxfReader.readFromStream(bytes);
 expect([...read.entities].filter((e:{objectName:string})=>e.objectName==='DIMENSION').length).toBe(9);
 // Sketch sheets: horizontal, aligned, diameter and radius dimensions; arc lengths stay lines.
 const s=createCadSession();
 const id=s.addSketchExtrusion({kind:'region',id:'plate',loops:[
  {kind:'outline',id:'boundary',points:[[0,0],[40,0],[40,30],[0,30]]},{kind:'circle',id:'hole',center:[20,15],radius:3,segments:24},
 ]},{name:'Motor plate',distance:6});
 const source=drawingSourceFor(s.state.document,id)!;
 const sketch={...base,source,annotations:[
  {id:'w',sketchId:source.sketchId,kind:'linear-x' as const,from:'vertex:boundary:p0',to:'vertex:boundary:p1',at:[60,40] as [number,number]},
  {id:'d',sketchId:source.sketchId,kind:'aligned' as const,from:'vertex:boundary:p0',to:'vertex:boundary:p2',at:[50,60] as [number,number]},
  {id:'o',sketchId:source.sketchId,kind:'diameter' as const,from:'circle:hole',at:[80,80] as [number,number]},
  {id:'r',sketchId:source.sketchId,kind:'radius' as const,from:'circle:hole',at:[80,100] as [number,number]},
 ]};
 const sheet=layoutDrawing(s.state.document,sketch);
 const types=parse(drawingDxfBytes(sheet,'R2000')).entities.filter(e=>e.type==='DIMENSION').map(e=>Number(code(e,70)[0])&7);
 expect(types.filter(type=>type===0).length).toBe(7); // six view sizes and the horizontal dimension
 expect(types.filter(type=>type!==0).sort()).toEqual([1,3,4]);
 // Sheets without dimensions, and every R12 file, are byte-identical to the writer before DIMENSION entities.
 const noDims=layoutDrawing(doc,exactSheet,projection),mesh=layoutDrawing(doc,base,geometry);
 expect(noDims.dimensions).toBeUndefined();
 expect(sha(drawingDxfBytes(noDims,'R2000'))).toBe('3d4fd8a13aa09c7fb379d989319070725d3128cfac1fdf93a33c5933eb244955');
 expect(sha(drawingDxfBytes(noDims,'R12'))).toBe('39184c8fa0a81289c5820928f6d54ada8a2b1565927e352da356fe1d50094f41');
 expect(sha(drawingDxfBytes(mesh,'R2000'))).toBe('6e170b1e29c3bb864314374b058dc20df90a184c0a0bd445290cf1494e75dda1');
 expect(sha(drawingDxfBytes(mesh,'R12'))).toBe('fc55763def1b5398fef807cf2c324fd45600c6158084d2c883263f6737a884a5');
 expect(sha(drawingDxfBytes(auto,'R12'))).toBe('d31a61b6ff6a6bd9c51cc6df5d6afcdcdc72f00742b22374744b14c54975bf32');
 const tapped=plate(true).session.state.document;
 const tappedMesh=layoutDrawing(tapped,base,manifold.evaluate(tapped));
 expect(sha(drawingDxfBytes(tappedMesh,'R2000'))).toBe('812fe6f1aca9f033be0b337c023c8f2461963d382326ca8730b4d22b87d5ecf1');
 expect(sha(drawingDxfBytes(tappedMesh,'R12'))).toBe('393e5d0e26bfa1dffe5de161681b74e9240d591af1e6ca698b5bdee934558a4b');
});
