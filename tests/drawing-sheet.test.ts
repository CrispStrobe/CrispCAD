// SPDX-License-Identifier: BSD-3-Clause
import {compileModelSource,createCadSession,drawingSourceFor,parseDocument,resolveDrawingSource,validateDocument} from '@brickwright/cad-core';
import type {DrawingInputs,SketchPlane} from '@brickwright/cad-core';
import {expect,it} from 'vitest';
import {layoutDrawing} from '../packages/editor/src/drawing-layout.js';
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
