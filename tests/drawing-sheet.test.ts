// SPDX-License-Identifier: BSD-3-Clause
import {compileModelSource,createCadSession,drawingSourceFor,parseDocument,resolveDrawingSource,validateDocument} from '@brickwright/cad-core';
import type {DrawingInputs,SketchPlane} from '@brickwright/cad-core';
import {expect,it} from 'vitest';
import {layoutDrawing} from '../packages/editor/src/drawing-layout.js';
import {sectionMaterial} from '../packages/editor/src/drawing-section.js';
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
 const inputs:DrawingInputs={title:'Plate drawing',source:drawingSourceFor(s.state.document,id)!,scale:'1:1',hiddenLines:true};
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
