// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {compileModelSource,createCadSession,drawingSourceFor,identityTransform,parseDocument,validateDocument} from '@brickwright/cad-core';
import type {DrawingInputs} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {projectAssembly} from '../packages/editor/src/assembly-drawing.js';
import {layoutDrawing} from '../packages/editor/src/drawing-layout.js';
import {exportDrawingSetPdf} from '../packages/editor/src/drawing-pdf.js';

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
 expect(()=>session.saveDrawingSheet({...assembly,section:{axis:'u',position:0}})).toThrow('drawing sheets');
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
