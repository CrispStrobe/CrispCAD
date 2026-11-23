// SPDX-License-Identifier: BSD-3-Clause
import {compileModelSource,createCadSession,drawingSourceFor,parseDocument,resolveDrawingSource,validateDocument} from '@brickwright/cad-core';
import type {DrawingInputs,DrawingSource,SketchPlane} from '@brickwright/cad-core';
import {expect,it} from 'vitest';
import {placeDrawingAnnotation} from '../packages/editor/src/drawing-annotation.js';
import {layoutDrawing} from '../packages/editor/src/drawing-layout.js';
import {offsetSectionMaterial,sectionMaterial} from '../packages/editor/src/drawing-section.js';
import {exportDrawingPdf,exportDrawingSetPdf} from '../packages/editor/src/drawing-pdf.js';

function fixture(plane:SketchPlane='XY'){
 const s=createCadSession();
 const design={version:1 as const,parameters:{spacing:{expression:'20',unit:'mm' as const}},bindings:[]};
 s.setParametric(design);
 const id=s.addSketchExtrusion({kind:'region',id:'plate',loops:[
  {kind:'outline',id:'boundary',points:[[0,0],[40,0],[40,30],[0,30]]},
  {kind:'circle',id:'first',center:['20 mm-spacing / 2',15],radius:2,segments:13},
  {kind:'circle',id:'second',center:['20 mm+spacing / 2',15],radius:3,segments:13}
 ]},{plane,name:'Motor plate',distance:6});
 const inputs:DrawingInputs&{source:DrawingSource}={title:'Plate drawing',source:drawingSourceFor(s.state.document,id)!,scale:'1:1',hiddenLines:true};
 return {s,id,inputs,design};
}

it('stores drawings in the project and model source with independent Undo',()=>{
 const {s,id,inputs}=fixture();
 const before=s.serialize();
 const geometryBefore=s.state.document.nodes[id];
 const sheetId=s.saveDrawingSheet(inputs);
 expect(s.state.document.version).toBe(9);
 expect(s.state.document.nodes[id]).toBe(geometryBefore);
 expect(parseDocument(s.serialize()).drawings).toEqual([{...inputs,id:sheetId}]);
 expect(validateDocument(compileModelSource(s.modelSource,s.state.document)).drawings).toEqual(s.state.document.drawings);
 expect(s.fragment([id]).drawings).toBeUndefined();
 expect(()=>validateDocument({...s.state.document,version:8})).toThrow('drawing sheets');
 s.undo();
 expect(s.serialize()).toBe(before);
 s.redo();
 s.removeDrawingSheet(sheetId);
 expect(s.state.document.drawings).toEqual([]);
 s.undo();
 expect(s.state.document.drawings?.[0].id).toBe(sheetId);
});

it('keeps unavailable drawings repairable across save and reopen',()=>{
 const {s,id,inputs}=fixture();
 const sheet=s.saveDrawingSheet(inputs);
 s.remove([id]);
 const removed=parseDocument(s.serialize());
 expect(removed.drawings?.[0].id).toBe(sheet);
 expect(resolveDrawingSource(removed,inputs.source)).toBeUndefined();
 expect(()=>layoutDrawing(removed,inputs)).toThrow('Drawing source unavailable');
 s.undo();
 expect(resolveDrawingSource(s.state.document,inputs.source)).toBeDefined();
 const newSource=s.addSketchExtrusion({kind:'rectangle',id:'new',width:30,depth:20});
 s.saveDrawingSheet({...inputs,source:drawingSourceFor(s.state.document,newSource)!},sheet);
 expect(s.state.document.drawings?.[0].source.featureId).toBe(newSource);
});

it('reprojects named hole spacing and controls hidden lines and page scale',()=>{
 const {s,inputs,design}=fixture();
 const compute=(draft:DrawingInputs=inputs)=>layoutDrawing(s.state.document,draft);
 const spacing=(page:ReturnType<typeof compute>)=>Math.abs(page.circles[1].center[0]-page.circles[0].center[0]);
 const before=compute();
 expect(spacing(before)).toBe(20);
 expect(before.paths.filter(path=>path.stroke==='hidden')).toHaveLength(8);
 expect(before.texts.map(label=>label.text)).toEqual(expect.arrayContaining(['Top view','Front view','Right view','1 × Ø4 mm','1 × Ø6 mm']));
 s.setParametric({...design,parameters:{spacing:{expression:'28',unit:'mm'}}});
 const changed=compute();
 expect(spacing(changed)).toBe(28);
 expect(compute({...inputs,hiddenLines:false}).paths.some(path=>path.stroke==='hidden')).toBe(false);
 expect(spacing(compute({...inputs,scale:'2:1'}))).toBe(56);
 expect(()=>compute({...inputs,scale:'5:1'})).toThrow('does not fit on A4');
 const pdf=exportDrawingPdf(changed,inputs.title);
 const content=new TextDecoder().decode(pdf.bytes);
 expect(pdf).toMatchObject({name:'Plate drawing.pdf',mime:'application/pdf'});
 expect(content).toContain('/MediaBox [0 0 841.88976 595.27559]');
 expect(content).toContain('[1.4 0.9] 0 d');
 expect(content).toContain('229 14 m 279 14 l');
 expect(content).toContain(' c ');
 expect(content).not.toContain('/Subtype /Image');
});

it.each(['XZ','YZ'] as const)('places circles and exact radii on the proper face for %s extrusions',plane=>{
 const {s,inputs}=fixture(plane);
 const page=layoutDrawing(s.state.document,inputs);
 expect(page.circles.map(c=>c.radius).sort((a,b)=>a-b)).toEqual([2,3]);
 expect(page.paths.filter(path=>path.stroke==='hidden')).toHaveLength(8);
 const [first,second]=page.circles.map(c=>c.center);
 expect(Math.abs(second[0]-first[0])).toBe(20);
});

it('exports every saved sheet in order and identifies a broken sheet before exporting',()=>{
 const {s,id,inputs}=fixture();
 expect(()=>exportDrawingSetPdf(s.state.document)).toThrow('Save a drawing sheet');
 s.saveDrawingSheet(inputs);
 s.saveDrawingSheet({...inputs,title:'Plate overview',scale:'1:2',hiddenLines:false});
 const content=new TextDecoder().decode(exportDrawingSetPdf(s.state.document).bytes);
 expect(content).toContain('/Type /Pages /Count 2 /Kids [3 0 R 6 0 R]');
 expect((content.match(/\/MediaBox /g)??[])).toHaveLength(2);
 const hex=(text:string)=>Buffer.from(text,'latin1').toString('hex');
 expect(content.indexOf(hex('Sheet 1 of 2'))).toBeGreaterThan(0);
 expect(content.indexOf(hex('Sheet 2 of 2'))).toBeGreaterThan(content.indexOf(hex('Sheet 1 of 2')));
 s.remove([id]);
 expect(()=>exportDrawingSetPdf(s.state.document)).toThrow('Plate drawing · Drawing source unavailable');
});

it('intersects concave outlines, analytic holes, and coincident edges',()=>{
 const rect={points:[[0,0],[40,0],[40,30],[0,30]] as [number,number][]};
 const hole={points:[],circle:{center:[10,15] as [number,number],radius:2}};
 expect(sectionMaterial([rect,hole],1,15)).toEqual([[0,8],[12,40]]);
 expect(sectionMaterial([rect,hole],0,10)).toEqual([[0,13],[17,30]]);
 expect(sectionMaterial([rect,hole],1,17)).toEqual([[0,40]]);
 expect(sectionMaterial([rect,hole],1,31)).toEqual([]);
 const slot={points:[[16,12],[22,12],[22,18],[16,18]] as [number,number][]};
 expect(sectionMaterial([rect,slot],1,15)).toEqual([[0,16],[22,40]]);
 expect(sectionMaterial([rect,slot],1,12)).toEqual([[0,40]]);
 const openNotch={points:[[0,0],[40,0],[40,30],[30,30],[30,10],[10,10],[10,30],[0,30]] as [number,number][]};
 expect(sectionMaterial([openNotch],1,15)).toEqual([[0,10],[30,40]]);
});

it('retains cuts and hatches only material as parameters and extrusion depth change',()=>{
 const {s,id,inputs,design}=fixture();
 s.setParametric({...design,parameters:{...design.parameters,cut:{expression:'15',unit:'mm'}}});
 const section={...inputs,section:{axis:'v' as const,position:'cut'}};
 const sheetId=s.saveDrawingSheet(section);
 const before=layoutDrawing(s.state.document,section);
 const widths=(layout:typeof before)=>layout.paths.filter(p=>p.stroke==='section').map(
  p=>p.points[1][0]-p.points[0][0]
 );
 expect(widths(before)).toEqual([8,15,7]);
 expect(before.paths.filter(p=>p.stroke==='cut')).toHaveLength(1);
 const material=before.paths.filter(p=>p.stroke==='section');
 for(const {points} of before.paths.filter(p=>p.stroke==='hatch')){
  expect(material.some(rect=>points.every(([x,y])=>
   x>=rect.points[0][0]&&x<=rect.points[1][0]&&y>=rect.points[0][1]&&y<=rect.points[2][1]
  ))).toBe(true);
 }
 const parsed=parseDocument(s.serialize());
 expect(parsed.version).toBe(10);
 expect(parsed.drawings?.[0]).toMatchObject({id:sheetId,section:{axis:'v',position:'cut'}});
 expect(()=>validateDocument({...parsed,version:9})).toThrow('drawing sheets');
 expect(validateDocument(compileModelSource(s.modelSource,parsed)).drawings).toEqual(parsed.drawings);
 s.setParametric({...design,parameters:{spacing:{expression:'28',unit:'mm'},cut:{expression:'15',unit:'mm'}}});
 s.editExtrusion(id,{distance:10,symmetric:true});
 const updated=layoutDrawing(s.state.document,section);
 expect(widths(updated)).toEqual([4,23,3]);
 const block=updated.paths.find(path=>path.stroke==='section')!;
 expect(block.points[2][1]-block.points[0][1]).toBe(10);
 const pdf=new TextDecoder().decode(exportDrawingPdf(updated,'Cut plate').bytes);
 expect(pdf).toContain('[3.5 1 0.7 1] 0 d');
 expect(pdf).toContain('0.10 w');
 expect(()=>layoutDrawing(s.state.document,{...section,section:{axis:'v',position:50}})).toThrow('misses the part');
 s.saveDrawingSheet(inputs);
 expect(s.state.document.version).toBe(10);
});

it('updates placed spacing and diameter dimensions at their saved paper positions',()=>{
 const {s,id,inputs,design}=fixture();
 const dimensions={
  ...inputs,annotations:[
   {id:'spacing',sketchId:inputs.source.sketchId,kind:'linear-x' as const,from:'circle:first',to:'circle:second',at:[70,125] as [number,number]},
   {id:'diameter',sketchId:inputs.source.sketchId,kind:'diameter' as const,from:'circle:first',at:[86,141] as [number,number]}
  ]
 };
 s.saveDrawingSheet(dimensions);
 let layout=layoutDrawing(s.state.document,dimensions);
 expect(layout.annotationIssues).toEqual([]);
 expect(layout.texts).toContainEqual({x:71.6,y:126.6,text:'20 mm',size:2.8});
 expect(layout.texts).toContainEqual({x:87,y:142.5,text:'Ø4 mm',size:2.8});
 expect(layout.paths.filter(p=>p.stroke==='annotation')).toHaveLength(6);
 const saved=parseDocument(s.serialize());
 expect(saved.version).toBe(11);
 expect(validateDocument(compileModelSource(s.modelSource,saved)).drawings).toEqual(saved.drawings);
 expect(()=>validateDocument({...saved,version:10})).toThrow('drawing sheets');

 s.setParametric({...design,parameters:{spacing:{expression:'28',unit:'mm'}}});
 const original=s.state.document.sketches![inputs.source.sketchId].profile;
 if(original.kind!=='region')throw Error('Expected mounting plate');
 const loops=original.loops.map(loop=>loop.kind==='circle'&&loop.id==='first'?{...loop,radius:2.5}:loop);
 s.editExtrusion(id,{distance:6,symmetric:false,sketch:{profile:{...original,loops}}});
 layout=layoutDrawing(s.state.document,dimensions);
 expect(layout.texts).toContainEqual({x:71.6,y:126.6,text:'28 mm',size:2.8});
 expect(layout.texts).toContainEqual({x:87,y:142.5,text:'Ø5 mm',size:2.8});
 const pdf=new TextDecoder().decode(exportDrawingSetPdf(s.state.document).bytes);
 expect(pdf).toContain(Buffer.from('28 mm','latin1').toString('hex'));
 expect(pdf).toContain(Buffer.from('Ø5 mm','latin1').toString('hex'));

 s.editExtrusion(id,{distance:6,symmetric:false,sketch:{profile:{...original,loops:loops.filter(loop=>loop.id!=='first')}}});
 const orphaned=layoutDrawing(s.state.document,dimensions);
 expect(orphaned.annotationIssues).toEqual(['spacing','diameter']);
 expect(()=>exportDrawingSetPdf(s.state.document)).toThrow('Repair or remove unavailable drawing dimensions');
 s.undo();
 expect(layoutDrawing(s.state.document,dimensions).annotationIssues).toEqual([]);
});

it('projects the material from both offset legs onto one section without a jog seam',()=>{
 const rect={points:[[0,0],[40,0],[40,30],[0,30]] as [number,number][]};
 const circular=(center:[number,number],radius:number)=>({points:[],circle:{center,radius}});
 const contours=[rect,circular([10,8],2),circular([30,22],3)];
 expect(offsetSectionMaterial(contours,1,8,22,20)).toEqual([[0,8],[12,27],[33,40]]);
 expect(offsetSectionMaterial(contours,0,10,30,15)).toEqual([[0,6],[10,19],[25,30]]);
 expect(()=>offsetSectionMaterial(contours,1,8,22,41)).toThrow('Both legs');
 expect(()=>offsetSectionMaterial(contours,1,8,41,20)).toThrow('Both legs');
});

it('preserves named offset section settings through project and model source and re-evaluates the cut',()=>{
 const {s,inputs,design}=fixture('XZ');
 const section={axis:'v' as const,position:15,jog:{at:'spacing',position:'spacing - 4 mm'}};
 const draft={...inputs,section};
 const sheetId=s.saveDrawingSheet(draft);
 const document=s.state.document;
 expect(document.version).toBe(17);
 expect(parseDocument(s.serialize()).drawings).toEqual([{...draft,id:sheetId}]);
 expect(validateDocument(compileModelSource(s.modelSource,document)).drawings).toEqual(document.drawings);
 expect(()=>validateDocument({...document,version:16})).toThrow('drawing sheets');
 expect(()=>s.saveDrawingSheet({...draft,section:{...section,jog:{...section.jog,at:''}}},sheetId)).toThrow('drawing sheets');
 expect(s.state.document).toBe(document);
 const before=layoutDrawing(document,draft);
 expect(before.paths.filter(path=>path.stroke==='section')).toHaveLength(3);
 expect(before.paths.find(path=>path.stroke==='cut')?.points).toHaveLength(4);
 expect(before.texts.map(item=>item.text)).toContain('Offset section A-A');
 expect(before.texts.map(item=>item.text)).toContain('Sketch Y = 15 / 16 mm');
 const pdf=new TextDecoder().decode(exportDrawingPdf(before,draft.title).bytes);
 expect(pdf).toContain('[3.5 1 0.7 1] 0 d');
 expect(pdf).toContain(Buffer.from('Offset section A-A','latin1').toString('hex'));
 s.setParametric({...design,parameters:{spacing:{expression:'22',unit:'mm'}}});
 const after=layoutDrawing(s.state.document,draft);
 expect(after.texts.map(item=>item.text)).toContain('Sketch Y = 15 / 18 mm');
 expect(after.paths.filter(path=>path.stroke==='section')).toHaveLength(2);
 expect(()=>layoutDrawing(s.state.document,{...draft,section:{...section,jog:{at:20,position:15}}})).toThrow('different positions');
 s.undo();
 expect(s.state.document.drawings).toEqual(document.drawings);
 expect(layoutDrawing(s.state.document,draft)).toEqual(before);
});

it('links dimensions to authored points and preserves those links through moves and topology changes',()=>{
 const s=createCadSession();
 const profile={kind:'outline' as const,id:'outline',points:[[0,0],[40,0],[40,30],[15,35],[0,30]] as [number,number][]};
 const feature=s.addSketchExtrusion(profile,{plane:'XZ',name:'Bracket section'});
 const source=drawingSourceFor(s.state.document,feature)!;
 const draft:DrawingInputs={title:'Bracket section',source,scale:'1:1',hiddenLines:false,
  annotations:[{id:'span',sketchId:source.sketchId,kind:'linear-x',from:'vertex:outline:p0',to:'vertex:outline:p3',at:[100,115]}]};
 const position=(sheet:DrawingInputs)=>layoutDrawing(s.state.document,sheet);
 expect(position(draft).texts.map(item=>item.text)).toContain('15 mm');
 const id=s.saveDrawingSheet(draft),sheet=s.state.document.drawings![0];
 expect(s.state.document.version).toBe(18);
 expect(sheet.annotations![0].from).not.toBe(draft.annotations![0].from);
 expect(sheet.annotations![0].to).not.toBe(draft.annotations![0].to);
 expect(parseDocument(s.serialize()).drawings).toEqual([sheet]);
 expect(validateDocument(compileModelSource(s.modelSource,s.state.document)).sketches).toEqual(s.state.document.sketches);
 expect(()=>validateDocument({...s.state.document,version:17})).toThrow();
 const invalid=structuredClone(s.state.document);
 const invalidProfile=invalid.sketches![source.sketchId].profile;
 if(invalidProfile.kind!=='outline')throw Error('fixture');
 invalidProfile.vertexIds![1]=invalidProfile.vertexIds![0];
 expect(()=>validateDocument(invalid)).toThrow('Invalid outline vertex identities');

 const moved={...profile,points:structuredClone(profile.points)};
 moved.points[3]=[22,35];
 s.editExtrusion(feature,{distance:10,symmetric:false,sketch:{profile:moved}});
 expect(position(sheet).texts.map(item=>item.text)).toContain('22 mm');
 expect(position(sheet).annotationIssues).toEqual([]);
 const rotated={...moved,points:[...moved.points.slice(2),...moved.points.slice(0,2)]};
 s.updateSketch(source.sketchId,{profile:rotated});
 expect(position(sheet).annotationIssues).toEqual([]);
 expect(position(sheet).texts.map(item=>item.text)).toContain('22 mm');

 const removed={...rotated,points:rotated.points.filter((_,i)=>i!==1)};
 s.updateSketch(source.sketchId,{profile:removed});
 expect(position(sheet).annotationIssues).toEqual(['span']);
 expect(()=>exportDrawingSetPdf(s.state.document)).toThrow('Repair or remove');
 s.updateSketch(source.sketchId,{profile:moved});
 expect(position(sheet).annotationIssues).toEqual(['span']);
 s.undo();
 s.undo();
 expect(position(sheet).annotationIssues).toEqual([]);
 expect(s.state.document.drawings![0].id).toBe(id);
});

it('lists vertices of polygonal holes and signed-arc endpoints from the authored sketch',()=>{
 const s=createCadSession();
 const feature=s.addSketchExtrusion({kind:'region',id:'profile',loops:[
  {kind:'outline',id:'outside',points:[[0,0],[40,0],[40,30],[0,30]],bulges:[.5,0,0,0]},
  {kind:'outline',id:'hole',points:[[5,4],[9,4],[8,9]]}
 ]},{name:'Curved plate'});
 const source=drawingSourceFor(s.state.document,feature)!;
 const drawing=layoutDrawing(s.state.document,{title:'Plate',source,scale:'1:1',hiddenLines:false});
 expect(drawing.anchors.filter(item=>item.id.startsWith('vertex:outside:'))).toHaveLength(4);
 expect(drawing.anchors.filter(item=>item.id.startsWith('vertex:hole:'))).toHaveLength(3);
 expect(drawing.anchors.find(item=>item.id==='vertex:hole:p2')?.label).toBe('Outline 2, point 3 (8, 9)');
});

it('keeps an aligned dimension parallel to its anchors and labels the model distance at any scale',()=>{
 const kind='aligned' as const;
 const at:[number,number]=[60,90];
 const dimension={kind,at,id:'aligned',sketchId:'sketch',from:'a',to:'b'};
 const anchors=[
  {id:'a',label:'A',point:[60,80] as [number,number]},
  {id:'b',label:'B',point:[66,88] as [number,number]}
 ];
 const placed=placeDrawingAnnotation(dimension,'sketch',anchors,2)!;
 expect(placed.text).toBe('5 mm');
 const [first,second,line]=placed.paths;
 expect(first[0]).toEqual([60,80]);
 expect(second[0]).toEqual([66,88]);
 expect(first[1][0]).toBeCloseTo(55.2);
 expect(first[1][1]).toBeCloseTo(83.6);
 expect(second[1][0]-first[1][0]).toBeCloseTo(6);
 expect(second[1][1]-first[1][1]).toBeCloseTo(8);
 expect((at[0]-line[0][0])*8-(at[1]-line[0][1])*6).toBeCloseTo(0);
 expect(placeDrawingAnnotation(dimension,'sketch',[anchors[0],{...anchors[1],point:anchors[0].point}],2)).toBeUndefined();
 expect(placeDrawingAnnotation(dimension,'sketch',anchors.slice(0,1),2)).toBeUndefined();
});

it('persists aligned dimensions in a versioned sheet and exports the diagonal at its model length',()=>{
 const {s,inputs}=fixture();
 const sheet:DrawingInputs={...inputs,scale:'1:2',annotations:[
  {id:'diagonal',sketchId:inputs.source.sketchId,kind:'aligned',from:'bounds:sw',to:'bounds:ne',at:[90,120]}
 ]};
 const id=s.saveDrawingSheet(sheet);
 const doc=s.state.document;
 expect(doc.version).toBe(19);
 expect(parseDocument(s.serialize()).drawings).toEqual([{...sheet,id}]);
 expect(validateDocument(compileModelSource(s.modelSource,doc)).drawings).toEqual(doc.drawings);
 expect(()=>validateDocument({...doc,version:18})).toThrow('drawing sheets');
 const layout=layoutDrawing(doc,sheet);
 expect(layout.annotationIssues).toEqual([]);
 expect(layout.texts.filter(item=>item.text==='50 mm')).toHaveLength(1);
 const pdf=new TextDecoder().decode(exportDrawingPdf(layout,sheet.title).bytes);
 expect(pdf).toContain('<'+Buffer.from('50 mm','latin1').toString('hex')+'>');
});

it('measures authored circular arcs and keeps both dimensions linked as curvature changes',()=>{
 const s=createCadSession();
 const profile={kind:'outline' as const,id:'outline',points:[[0,0],[40,0],[40,30],[0,30]] as [number,number][],bulges:[0,0,-.5,0]};
 const feature=s.addSketchExtrusion(profile,{plane:'YZ',name:'Curved plate'});
 const source=drawingSourceFor(s.state.document,feature)!;
 const arc={sketchId:source.sketchId,from:'arc:outline:p2:p3',at:[68,117] as [number,number]};
 const draft:DrawingInputs={title:'Curved plate',source,scale:'1:1',hiddenLines:false,annotations:[
  {...arc,id:'r',kind:'radius'},
  {...arc,id:'l',kind:'arc-length',at:[85,117]}
 ]};
 const layout=layoutDrawing(s.state.document,draft);
 expect(layout.texts.map(item=>item.text)).toEqual(expect.arrayContaining(['R25 mm','Arc length 46.365 mm']));
 expect(layout.paths.filter(path=>path.stroke==='annotation').some(path=>path.points.length>20)).toBe(true);
 expect(layoutDrawing(s.state.document,{...draft,scale:'1:2'}).texts.map(item=>item.text)).toContain('Arc length 46.365 mm');
 const id=s.saveDrawingSheet(draft),saved=s.state.document.drawings![0],doc=s.state.document;
 expect(doc.version).toBe(20);
 expect(saved.annotations![0].from).not.toBe(arc.from);
 expect(saved.annotations![1].from).toBe(saved.annotations![0].from);
 expect(parseDocument(s.serialize()).drawings).toEqual([saved]);
 expect(validateDocument(compileModelSource(s.modelSource,doc)).drawings).toEqual([saved]);
 expect(()=>validateDocument({...doc,version:19})).toThrow('drawing sheets');
 const invalid=structuredClone(saved);
 invalid.annotations![1].from='circle:outside';
 expect(()=>s.saveDrawingSheet(invalid,id)).toThrow('drawing sheets');

 s.updateSketch(source.sketchId,{profile:{...profile,bulges:[0,0,-.25,0]}});
 const revised=layoutDrawing(s.state.document,saved);
 expect(revised.texts.map(item=>item.text)).toEqual(expect.arrayContaining(['R42.5 mm','Arc length 41.646 mm']));
 expect(new TextDecoder().decode(exportDrawingPdf(revised,saved.title).bytes))
  .toContain('<'+Buffer.from('Arc length 41.646 mm','latin1').toString('hex')+'>');
 s.updateSketch(source.sketchId,{profile:{...profile,bulges:undefined}});
 expect(layoutDrawing(s.state.document,saved).annotationIssues).toEqual(['r','l']);
 expect(()=>exportDrawingSetPdf(s.state.document)).toThrow('Repair or remove');
 s.undo();
 expect(layoutDrawing(s.state.document,saved).annotationIssues).toEqual([]);
});

it('distinguishes opposite arcs on a two-point outline and measures a circle radius',()=>{
 const s=createCadSession();
 const lens=s.addSketchExtrusion({kind:'outline',id:'lens',points:[[0,0],[20,0]],bulges:[2,.25]});
 const inputs:DrawingInputs={title:'Lens',source:drawingSourceFor(s.state.document,lens)!,scale:'1:1',hiddenLines:false};
 const arcs=layoutDrawing(s.state.document,inputs).anchors.filter(item=>item.arc);
 expect(arcs.map(item=>item.id)).toEqual(['arc:lens:p0:p1','arc:lens:p1:p0']);
 expect(Math.abs(arcs[0].arc!.sweep)).toBeGreaterThan(Math.PI);
 const circle=s.addSketchExtrusion({kind:'circle',id:'disk',radius:12,segments:32});
 const source=drawingSourceFor(s.state.document,circle)!;
 const radius:DrawingInputs={...inputs,source,annotations:[{
  id:'r',kind:'radius',sketchId:source.sketchId,from:'circle:disk',at:[70,120]
 }]};
 expect(layoutDrawing(s.state.document,radius).texts.map(item=>item.text)).toContain('R12 mm');
});

it('retains an optional title block with the sheet and places it clear of the scale bar',()=>{
 const {s,id,inputs}=fixture();
 const titleBlock={number:'PL-0042',revision:'B.1',drawnBy:'A. Müller'};
 const sheetId=s.saveDrawingSheet(inputs);
 const before=s.state.document,legacy=layoutDrawing(before,inputs);
 expect(before.version).toBe(9);
 expect(legacy.texts.some(label=>label.text==='Drawing number')).toBe(false);
 s.saveDrawingSheet({...inputs,titleBlock},sheetId);
 const updated=s.state.document;
 expect(updated.version).toBe(29);
 expect(updated.nodes[id]).toBe(before.nodes[id]);
 const restored=parseDocument(s.serialize());
 expect(restored.drawings?.[0].titleBlock).toEqual(titleBlock);
 expect(compileModelSource(s.modelSource,restored).drawings).toEqual(restored.drawings);
 expect(()=>validateDocument({...restored,version:28})).toThrow('drawing sheets');
 for(const invalid of [{},{number:' '},{revision:'a\nb'},{drawnBy:'w'.repeat(17)},{unrecognized:'value'}]){
  expect(()=>s.saveDrawingSheet({...inputs,titleBlock:invalid},sheetId)).toThrow('drawing sheets');
 }
 expect(s.state.document).toBe(updated);

 const page=layoutDrawing(restored,restored.drawings![0]);
 expect(page.texts.filter(label=>label.y===10.5).map(label=>label.text)).toEqual(Object.values(titleBlock));
 expect(page.paths).toContainEqual(expect.objectContaining({points:[[229,14],[279,14]]}));
 const pdf=new TextDecoder().decode(exportDrawingSetPdf(restored).bytes);
 for(const value of Object.values(titleBlock))expect(pdf).toContain('<'+Buffer.from(value,'latin1').toString('hex')+'>');
 expect(pdf).toContain('229 22 Td');
 s.saveDrawingSheet(inputs,sheetId);
 expect(s.state.document.drawings?.[0].titleBlock).toBeUndefined();
 s.undo();
 expect(s.state.document.drawings?.[0].titleBlock).toEqual(titleBlock);
 s.undo();
 expect(s.state.document).toEqual(before);
});
