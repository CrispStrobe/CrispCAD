// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {compileModelSource,createCadSession,drawingSourceFor,identityTransform,parseDocument,validateDocument} from '@brickwright/cad-core';
import type {DrawingInputs} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {projectAssembly,resolveAssemblyCut} from '../packages/editor/src/assembly-drawing.js';
import {pickAssemblyEdge,saveAssemblyEdge} from '../packages/editor/src/assembly-edge-dimension.js';
import {layoutAssemblyPartsList} from '../packages/editor/src/assembly-parts-list.js';
import {layoutDrawing,layoutDrawingPages} from '../packages/editor/src/drawing-layout.js';
import {exportDrawingPdf,exportDrawingSetPdf} from '../packages/editor/src/drawing-pdf.js';

const assembly:DrawingInputs={title:'Assembly drawing',source:{kind:'assembly'},scale:'1:1',hiddenLines:true};
let kernel:GeometryKernel;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
});

it('clips partly obscured edges by depth and omits coplanar triangulation',()=>{
 const session=createCadSession();
 const frontId=session.add({kind:'box',size:[24,8,24]},{transform:identityTransform()});
 const rearId=session.add({kind:'box',size:[32,6,12]},{transform:{...identityTransform(),position:[8,20,0]}});
 const doc=session.state.document,geometry=kernel.evaluate(doc);
 const [front,rear]=[frontId,rearId].map(id=>geometry.bodies.find(body=>body.id===id)!.bounds);
 const originX=Math.min(front.min[0],rear.min[0]),originZ=Math.min(front.min[2],rear.min[2]);
 const y=47+rear.max[2]-originZ;
 const x=(value:number)=>24+value-originX;
 const page=layoutDrawing(doc,assembly,geometry);
 const projected=projectAssembly(geometry);
 expect(projected.views.every(view=>view.segments instanceof Float64Array&&view.segments.length%5===0)).toBe(true);
 expect(layoutDrawing(doc,assembly,structuredClone(projected))).toEqual(page);
 const topOfRear=page.paths.filter(path=>path.points.every(point=>Math.abs(point[1]-y)<1e-7));
 const hidden=topOfRear.find(path=>path.stroke==='hidden'&&path.points.map(point=>point[0]).includes(x(rear.min[0])));
 expect(hidden?.points.map(point=>point[0]).sort((a,b)=>a-b)).toEqual([x(rear.min[0]),x(front.max[0])]);
 const visible=topOfRear.find(path=>path.stroke==='visible'&&path.points.map(point=>point[0]).includes(x(rear.max[0])));
 expect(visible?.points.map(point=>point[0]).sort((a,b)=>a-b)).toEqual([x(front.max[0]),x(rear.max[0])]);
 expect(page.paths.filter(path=>path.stroke==='visible').every(path=>
  path.points[0][0]===path.points[1][0]||path.points[0][1]===path.points[1][1])).toBe(true);
 expect(layoutDrawing(doc,{...assembly,hiddenLines:false},geometry).paths.some(path=>path.stroke==='hidden')).toBe(false);
});

it('keeps a linked assembly across project and model source round trips and exports mixed sheet sets',()=>{
 const session=createCadSession();
 const partId=session.addSketchExtrusion({kind:'rectangle',id:'plate',width:30,depth:20},{distance:4});
 const id=session.saveDrawingSheet(assembly),before=session.state.document;
 expect(before.version).toBe(21);
 expect(parseDocument(session.serialize()).drawings).toEqual([{...assembly,id}]);
 expect(validateDocument(compileModelSource(session.modelSource,before)).drawings).toEqual(before.drawings);
 expect(()=>validateDocument({...before,version:20})).toThrow('drawing sheets');
 expect(()=>session.saveDrawingSheet({...assembly,section:{axis:'u',position:0,jog:{at:'',position:2}}})).toThrow('drawing sheets');
 expect(session.state.document).toBe(before);

 const source=drawingSourceFor(before,partId)!;
 session.saveDrawingSheet({...assembly,source,title:'Plate drawing'});
 const solid=session.add({kind:'box',size:[10,12,8]},{transform:{...identityTransform(),position:[32,8,4]}});
 const helper=session.add({kind:'box',size:[60,60,60]},{transform:{...identityTransform(),position:[500,0,0]}});
 session.setRole('hole',[helper]);
 const doc=session.state.document,geometry=kernel.evaluate(doc);
 const page=layoutDrawing(doc,doc.drawings![0],geometry);
 expect(page.texts.map(text=>text.text)).toContain('Assembly · 2 bodies');
 expect(page.texts.map(text=>text.text)).toEqual(expect.arrayContaining(['Top view','Front view','Right view']));
 const pdf=new TextDecoder().decode(exportDrawingSetPdf(doc,geometry).bytes);
 expect(pdf).toContain('/Type /Pages /Count 2');
 expect(pdf).toContain('[1.4 0.9] 0 d');
 session.update(solid,{transform:{...identityTransform(),position:[45,8,4]}});
 expect(()=>layoutDrawing(session.state.document,assembly,geometry)).toThrow('assembly geometry changed');
 session.undo();
 session.remove([partId,solid]);
 expect(()=>layoutDrawing(session.state.document,assembly,kernel.evaluate(session.state.document))).toThrow('Add a solid body');
 session.undo();
 expect(layoutDrawing(session.state.document,assembly,kernel.evaluate(session.state.document))).toEqual(page);
});

it('projects the bundled Scout rover at a reduced drawing scale',()=>{
 const document=parseDocument(readFileSync('examples/scout-tt-rover/scout-tt-rover.bcad','utf8'));
 const geometry=kernel.evaluate(document);
 const sheet=layoutDrawing(document,{...assembly,scale:'1:5'},geometry);
 expect(sheet.paths.filter(path=>path.stroke==='visible').length).toBeGreaterThan(30);
 expect(sheet.paths.filter(path=>path.stroke==='hidden').length).toBeGreaterThan(0);
});

it('stores the parts-list option and exports current solid names with assembly and mixed sheets',()=>{
 const session=createCadSession();
 const plate=session.addSketchExtrusion({kind:'rectangle',id:'plate',width:32,depth:18});
 session.update(plate,{name:'Base plate'});
 const detail=session.add({kind:'box',size:[8,8,6]},{name:'Filter lid',transform:{...identityTransform(),position:[18,6,3]}});
 const cutter=session.add({kind:'box',size:[2,2,4]},{name:'Hidden cutter'});
 session.setRole('hole',[cutter]);
 const id=session.saveDrawingSheet({...assembly,partsList:true});
 const source=drawingSourceFor(session.state.document,plate)!;
 expect(()=>session.saveDrawingSheet({...assembly,source,partsList:true})).toThrow('drawing sheets');
 session.saveDrawingSheet({...assembly,source,title:'Plate details'});
 const doc=session.state.document;
 expect(doc.version).toBe(22);
 expect(parseDocument(session.serialize()).drawings?.[0]).toMatchObject({id,partsList:true});
 expect(validateDocument(compileModelSource(session.modelSource,doc)).drawings).toEqual(doc.drawings);
 expect(()=>validateDocument({...doc,version:21})).toThrow('drawing sheets');
 session.update(detail,{name:'Replacement lid'});
 const current=session.state.document,mesh=kernel.evaluate(current);
 const [views,list]=layoutDrawingPages(current,current.drawings![0],mesh);
 expect(list.texts.map(text=>text.text)).toEqual(expect.arrayContaining(['Base plate','Replacement lid']));
 expect(list.texts.map(text=>text.text)).not.toContain('Filter lid');
 expect(list.texts.map(text=>text.text)).not.toContain('Hidden cutter');
 expect(list.texts.filter(text=>text.x===17&&/^\d+$/.test(text.text)).map(text=>text.text)).toEqual(['1','2']);
 const pdf=new TextDecoder().decode(exportDrawingPdf(views,assembly.title,[list]).bytes);
 expect(pdf).toContain('/Type /Pages /Count 2');
 expect(pdf).toContain('<'+Buffer.from('Replacement lid','latin1').toString('hex')+'>');
 const all=new TextDecoder().decode(exportDrawingSetPdf(current,mesh).bytes);
 expect(all).toContain('/Type /Pages /Count 3');
 expect(all).toContain('<'+Buffer.from('Sheet 3 of 3','latin1').toString('hex')+'>');
 expect(layoutDrawingPages(current,{...assembly,partsList:false},mesh)).toHaveLength(1);
});

it('wraps long names and continues item numbers across parts-list pages',()=>{
 const session=createCadSession();
 const longName='W'.repeat(150);
 const ids=Array.from({length:31},(_,i)=>session.add(
  {kind:'box',size:[2,2,2]},{name:i===0?longName:`Component ${i+1}`}));
 const pages=layoutAssemblyPartsList(session.state.document,assembly,{views:[],origin:[0,0,0],bodyIds:ids});
 expect(pages).toHaveLength(2);
 const rows=pages.flatMap(page=>page.texts.filter(text=>text.x===17&&/^\d+$/.test(text.text)).map(text=>Number(text.text)));
 expect(rows).toEqual(Array.from({length:31},(_,i)=>i+1));
 expect(pages[0].texts.filter(text=>/^W+$/.test(text.text)).map(text=>text.text).join('')).toBe(longName);
 expect(pages[1].texts.map(text=>text.text)).toContain('Component 31');
 expect(pages[1].texts.map(text=>text.text)).toContain('Parts list 2 of 2');
 for(const page of pages)expect(page.texts.filter(text=>text.x===38).every(text=>text.y>=30)).toBe(true);
});

it('slices evaluated assemblies, preserves through openings and exports a linked section',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{cut:{expression:'0',unit:'mm'}},bindings:[]});
 const plate=session.addSketchExtrusion({kind:'region',id:'plate',loops:[
  {kind:'outline',id:'outside',points:[[-20,-15],[20,-15],[20,15],[-20,15]]},
  {kind:'circle',id:'bore',center:[0,0],radius:5,segments:64}
 ]},{distance:6});
 const body=session.add({kind:'box',size:[10,9,8]},
  {name:'Bracket',transform:{...identityTransform(),position:[28,0,0],rotation:[0,0,15]}});
 const cutter=session.add({kind:'box',size:[6,6,6]},{name:'Unused cutter'});
 session.setRole('hole',[cutter]);
 const draft:DrawingInputs={...assembly,section:{axis:'v',position:'cut'},partsList:true};
 session.saveDrawingSheet(draft);
 const doc=session.state.document;
 expect(doc.version).toBe(23);
 expect(parseDocument(session.serialize()).drawings).toEqual(doc.drawings);
 expect(validateDocument(compileModelSource(session.modelSource,doc)).drawings).toEqual(doc.drawings);
 expect(()=>validateDocument({...doc,version:22})).toThrow('drawing sheets');
 const geometry=kernel.evaluate(doc),cut=resolveAssemblyCut(doc,draft.section!);
 const section=kernel.sliceAssembly(geometry,cut);
 expect(section.bodies.map(solid=>[solid.id,solid.loops.length])).toEqual([[plate,2],[body,1]]);
 const normalCut=kernel.sliceAssembly(geometry,{axis:0,position:-10});
 expect(normalCut.bodies.map(solid=>[solid.id,solid.loops.length])).toEqual([[plate,1]]);
 const projection={...projectAssembly(geometry),sections:[section]};
 const [view,list]=layoutDrawingPages(doc,draft,projection);
 expect(view.paths.filter(path=>path.stroke==='section')).toHaveLength(3);
 expect(view.paths.filter(path=>path.stroke==='cut')).toHaveLength(1);
 expect(view.paths.some(path=>path.stroke==='hatch')).toBe(true);
 const rightX=44+projection.views[1].width;
 const leftOfHole=rightX+15,rightOfHole=rightX+25;
 expect(view.paths.filter(path=>path.stroke==='hatch').every(path=>
  Math.max(...path.points.map(([x])=>x))<=leftOfHole+1e-6||
  Math.min(...path.points.map(([x])=>x))>=rightOfHole-1e-6)).toBe(true);
 const pdf=new TextDecoder().decode(exportDrawingPdf(view,draft.title,[list]).bytes);
 expect(pdf).toContain('[3.5 1 0.7 1] 0 d');
 expect(pdf).toContain('<'+Buffer.from('World Y = 0 mm','latin1').toString('hex')+'>');
 const miss={axis:1 as const,position:100};
 expect(()=>layoutDrawing(doc,{...draft,section:{axis:'v',position:100}},
  {...projection,sections:[kernel.sliceAssembly(geometry,miss)]})).toThrow('misses the assembly solids');
 const parameters=structuredClone(doc.parametric!);
 parameters.parameters.cut.expression='10';
 session.setParametric(parameters);
 expect(kernel.sliceAssembly(geometry,resolveAssemblyCut(session.state.document,draft.section!))
  .bodies[0].loops).toHaveLength(1);
});

it('clips both assembly cuts at the jog and joins material separately for each body',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{second:{expression:'12',unit:'mm'}},bindings:[]});
 const plate=session.addSketchExtrusion({kind:'region',id:'plate',loops:[
  {kind:'outline',id:'outside',points:[[-20,-10],[20,-10],[20,22],[-20,22]]},
  {kind:'circle',id:'first',center:[-10,0],radius:3,segments:64},
  {kind:'circle',id:'second',center:[10,12],radius:3,segments:64}
 ]},{distance:6});
 const bracket=session.add({kind:'box',size:[10,8,8]},
  {name:'Bracket',transform:{...identityTransform(),position:[30,12,0]}});
 const options:DrawingInputs={...assembly,section:{axis:'v',position:0,jog:{at:0,position:'second'}}};
 session.saveDrawingSheet(options);
 const doc=session.state.document;
 expect(doc.version).toBe(24);
 expect(parseDocument(session.serialize()).drawings).toEqual(doc.drawings);
 expect(validateDocument(compileModelSource(session.modelSource,doc)).drawings).toEqual(doc.drawings);
 expect(()=>validateDocument({...doc,version:23})).toThrow('drawing sheets');
 const geometry=kernel.evaluate(doc),cut=resolveAssemblyCut(doc,options.section!);
 const section=kernel.sliceAssembly(geometry,cut);
 expect(section.bodies.map(body=>[body.id,body.loops.length])).toEqual([[plate,3],[bracket,1]]);
 const span=section.bodies[0].loops.map(loop=>{
  const xs=loop.map(point=>point[0]);
  return [Math.round(Math.min(...xs)),Math.round(Math.max(...xs))];
 }).sort((a,b)=>a[0]-b[0]);
 expect(span).toEqual([[-20,-13],[-7,7],[13,20]]);
 const projection={...projectAssembly(geometry),sections:[section]};
 const page=layoutDrawing(doc,options,projection);
 expect(page.paths.find(path=>path.stroke==='cut')?.points).toHaveLength(4);
 expect(page.texts.map(text=>text.text)).toContain('Offset section A-A');
 expect(page.texts.map(text=>text.text)).toContain('World Y = 0 / 12 mm');
 expect(()=>layoutDrawing(doc,{...options,section:{axis:'v',position:0,jog:{at:1,position:12}}},projection))
  .toThrow('needs evaluated cut geometry');
 expect(()=>kernel.sliceAssembly(geometry,{...cut,jog:{at:40,position:12}})).toThrow('Both legs');
 expect(()=>kernel.sliceAssembly(geometry,{...cut,jog:{at:0,position:0}})).toThrow('different positions');
});

it('saves a projected model-edge measurement across project formats and body placement changes',()=>{
 const session=createCadSession();
 const bodyId=session.add({kind:'box',size:[30,18,12]},{transform:identityTransform()});
 const initial=session.state.document;
 const draft={...assembly,hiddenLines:false};
 const page=layoutDrawing(initial,draft,kernel.evaluate(initial));
 const edge=page.assemblyEdges!.find(item=>item.bodyId===bodyId&&item.view===0&&
  Math.abs(item.projected[1][0]-item.projected[0][0])>29)!;
 const [a,b]=edge.visible;
 expect(pickAssemblyEdge([edge],[(a[0]+b[0])/2,(a[1]+b[1])/2],3)).toBe(edge);
 expect(pickAssemblyEdge([edge],[0,0],3)).toBeUndefined();
 const id=session.saveDrawingSheet({...draft,edgeDimensions:[saveAssemblyEdge(edge,initial,[80,120],'edge-dim')]});
 const saved=session.state.document;
 expect(saved.version).toBe(25);
 expect(parseDocument(session.serialize()).drawings).toEqual(saved.drawings);
 expect(validateDocument(compileModelSource(session.modelSource,saved)).drawings).toEqual(saved.drawings);
 expect(()=>validateDocument({...saved,version:24})).toThrow('drawing sheets');

 const drawn=()=>{
  const doc=session.state.document;
  return layoutDrawing(doc,doc.drawings!.find(sheet=>sheet.id===id)!,kernel.evaluate(doc));
 };
 expect(drawn().texts.map(text=>text.text)).toContain('30 mm');
 expect(drawn().paths.filter(path=>path.stroke==='annotation')).toHaveLength(5);
 expect(new TextDecoder().decode(exportDrawingPdf(drawn(),draft.title).bytes))
  .toContain('<'+Buffer.from('30 mm','latin1').toString('hex')+'>');
 session.update(bodyId,{transform:{...identityTransform(),position:[12,8,3],rotation:[0,0,90]}});
 expect(drawn().annotationIssues).toEqual([]);
 expect(drawn().texts.map(text=>text.text)).toContain('30 mm');
 session.update(bodyId,{size:[40,18,12]});
 expect(drawn().annotationIssues).toEqual(['edge-dim']);
 session.undo();
 expect(drawn().annotationIssues).toEqual([]);
});

it('resolves multiple jog expressions and clips each leg to its interval',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{spacing:{expression:'14',unit:'mm'}},bindings:[]});
 const plate=session.addSketchExtrusion({kind:'region',id:'plate',loops:[
  {kind:'outline',id:'outside',points:[[-22,-16],[22,-16],[22,16],[-22,16]]},
  {kind:'circle',id:'left',center:[-14,-10],radius:2,segments:32},
  {kind:'circle',id:'middle',center:[0,0],radius:2,segments:32},
  {kind:'circle',id:'right',center:[14,10],radius:2,segments:32}
 ]},{distance:6});
 const outline:DrawingInputs={...assembly,section:{
  axis:'v',position:-10,jog:{at:'-spacing / 2',position:0},additionalJogs:[{at:'spacing / 2',position:10}]
 }};
 session.saveDrawingSheet(outline);
 const doc=session.state.document;
 expect(doc.version).toBe(26);
 expect(parseDocument(session.serialize()).drawings).toEqual(doc.drawings);
 expect(validateDocument(compileModelSource(session.modelSource,doc)).drawings).toEqual(doc.drawings);
 expect(()=>validateDocument({...doc,version:25})).toThrow('drawing sheets');
 expect(()=>session.saveDrawingSheet({...outline,source:drawingSourceFor(doc,plate)!})).toThrow('drawing sheets');
 expect(()=>session.saveDrawingSheet({...outline,section:{...outline.section!,jog:undefined}})).toThrow('drawing sheets');
 expect(()=>session.saveDrawingSheet({...outline,section:{...outline.section!,additionalJogs:
  Array.from({length:4},(_,i)=>({at:i+1,position:i+1}))}})).toThrow('drawing sheets');
 const geometry=kernel.evaluate(doc),cut=resolveAssemblyCut(doc,outline.section!);
 expect(cut.additionalJogs).toEqual([{at:7,position:10}]);
 const section=kernel.sliceAssembly(geometry,cut);
 const span=section.bodies[0].loops.map(loop=>{
  const xs=loop.map(point=>point[0]);
  return [Math.round(Math.min(...xs)),Math.round(Math.max(...xs))];
 }).sort((a,b)=>a[0]-b[0]);
 expect(span).toEqual([[-22,-16],[-12,-2],[2,12],[16,22]]);
 const projection={...projectAssembly(geometry),sections:[section]};
 const page=layoutDrawing(doc,outline,projection);
 expect(page.paths.find(path=>path.stroke==='cut')?.points).toHaveLength(6);
 const legend='World Y = -10 / 0 / 10 mm';
 expect(page.texts.map(text=>text.text)).toContain(legend);
 expect(new TextDecoder().decode(exportDrawingPdf(page,outline.title).bytes))
  .toContain('<'+Buffer.from(legend,'latin1').toString('hex')+'>');
 expect(()=>kernel.sliceAssembly(geometry,{...cut,additionalJogs:[{at:-7,position:10}]})).toThrow('in increasing order');
 expect(()=>kernel.sliceAssembly(geometry,{...cut,additionalJogs:[{at:7,position:0}]})).toThrow('legs 2 and 3');
 expect(()=>kernel.sliceAssembly(geometry,{...cut,additionalJogs:[{at:7,position:20}]})).toThrow('Section leg 3 misses');
 expect(()=>layoutDrawing(doc,{...outline,section:{...outline.section!,additionalJogs:[{at:8,position:10}]}},projection))
  .toThrow('needs evaluated cut geometry');
});
