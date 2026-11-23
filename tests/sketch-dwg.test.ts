// SPDX-License-Identifier: BSD-3-Clause
import {ACadVersion} from '@node-projects/acad-ts';
import {createCadSession} from '@brickwright/cad-core';
import {encodeSketchDwg} from '../packages/editor/src/encode-sketch-dwg.js';
import {describeSketchExchange,sketchForExchange} from '../packages/editor/src/sketch-exchange.js';
import {expect,it} from 'vitest';
import {decodeSketchDwg} from '../packages/editor/src/decode-sketch-dwg.js';
import {prepareSketchDxf} from '../packages/editor/src/import-sketch-dxf.js';
import {sketchDwgFixture} from './sketch-dwg-fixture.js';

const buffer=(bytes:Uint8Array)=>new Uint8Array(bytes).buffer;

it.each([ACadVersion.AC1015,ACadVersion.AC1032])('decodes %s units, layers, curves, and tapered widths',version=>{
 const source=sketchDwgFixture({version});
 const drawing=prepareSketchDxf(decodeSketchDwg(buffer(source)));
 expect(drawing.layers).toEqual(['CUT','GUIDES']);
 expect(drawing.skippedPaperSpace).toBe(true);
 expect(()=>drawing.outline()).toThrow();
 const {profile}=drawing.outline(false,['CUT']);
 expect(profile).toMatchObject({kind:'outline',dxfLayer:'CUT',
  points:[[0,0],[50.8,0],[50.8,25.4],[0,25.4]],bulges:[.25,0,0,0]});
 if(profile.kind!=='outline')throw new Error('outline fixture');
 expect(profile.dxfWidths?.[0]?.[0]).toBeCloseTo(2.54);
 expect(profile.dxfWidths?.[0]?.[1]).toBeCloseTo(5.08);
});

it('requires an explicit millimetre assumption for a unitless open DWG',()=>{
 const drawing=prepareSketchDxf(decodeSketchDwg(buffer(sketchDwgFixture({closed:false,units:0,extraLayers:false}))));
 expect(()=>drawing.path()).toThrow('has no units');
 expect(drawing.path(true).profile).toMatchObject({kind:'path',points:[[0,0],[2,0],[2,1]],bulges:[.25,0,0]});
});

it('rejects invalid and truncated DWG without producing a sketch',()=>{
 expect(()=>decodeSketchDwg(buffer(new TextEncoder().encode('not a DWG')))).toThrow();
 expect(()=>decodeSketchDwg(buffer(sketchDwgFixture({}).subarray(0,20)))).toThrow();
 expect(()=>decodeSketchDwg(new ArrayBuffer(1024*1024+1))).toThrow();
});

it('writes a measured region as native 2018 DWG entities and retains its sketch geometry',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{spacing:{expression:'24',unit:'mm'}},bindings:[]});
 const id=session.addSketchExtrusion({kind:'region',id:'plate',loops:[
  {kind:'outline',id:'edge',points:[[0,0],[40,0],[40,30],[0,30]],bulges:[.25,0,0,0],
   dxfWidths:[[1.2,2.4],[0,0],[0,0],[0,0]],dxfLayer:'Fräsen',
   dxfLayerStyle:{trueColor:0x123456,color:-5,flags:4,plot:false,lineweight:35,linetype:{name:'Dashed',pattern:[2,-.5,0,-.5]}}},
  {kind:'circle',id:'holeA',center:['20 mm - spacing / 2',15],radius:3,segments:32,dxfLayer:'Bohrungen Ä',dxfLayerStyle:{color:3}},
  {kind:'circle',id:'holeB',center:['20 mm + spacing / 2',15],radius:2,segments:32,dxfLayer:'BOHRUNGEN Ä'}
 ]},{name:'Test plate',plane:'XZ'});
 const doc=session.state.document;
 const bytes=encodeSketchDwg(describeSketchExchange(doc,sketchForExchange(doc,id,'DWG')));
 expect(new TextDecoder().decode(bytes.slice(0,6))).toBe('AC1032');
 const drawing=prepareSketchDxf(decodeSketchDwg(bytes));
 expect(drawing.layers).toEqual(['Fräsen','Bohrungen Ä']);
 expect(drawing.outline().profile).toMatchObject({kind:'region',loops:[
  {kind:'outline',points:[[0,0],[40,0],[40,30],[0,30]],bulges:[.25,0,0,0],
   dxfWidths:[[1.2,2.4],[0,0],[0,0],[0,0]],dxfLayer:'Fräsen',
   dxfLayerStyle:{trueColor:0x123456,color:-1,flags:4,plot:false,lineweight:35,linetype:{name:'Dashed',pattern:[2,-.5,0,-.5]}}},
  {kind:'circle',center:[8,15],radius:3,dxfLayer:'Bohrungen Ä',dxfLayerStyle:{color:3}},
  {kind:'circle',center:[32,15],radius:2,dxfLayer:'Bohrungen Ä',dxfLayerStyle:{color:3}}
 ]});
 expect(session.state.document).toBe(doc);
});

it('writes resolved open-path constraints at full size with constant widths and no closing edge',()=>{
 const session=createCadSession();
 const id=session.addSketch({kind:'path',id:'guide',points:[[0,0],[15,0],[35,20]],
  vertexIds:['a','b','c'],anchors:[{vertexId:'a',x:5,y:7}],
  segmentConstraints:[{from:'a',to:'b',distance:25,direction:0},{from:'b',to:'c',distance:15,direction:90}],
  dxfLayer:'Guide',bulges:[0,-.5,0],dxfWidths:[[2,2],[2,2],[0,0]]});
 const doc=session.state.document;
 const bytes=encodeSketchDwg(describeSketchExchange(doc,doc.sketches![id]));
 const drawing=prepareSketchDxf(decodeSketchDwg(bytes));
 expect(drawing.path().profile).toMatchObject({kind:'path',points:[[5,7],[30,7],[30,22]],
  dxfLayer:'Guide',bulges:[0,-.5,0],dxfWidths:[[2,2],[2,2],[0,0]]});
 expect(()=>drawing.outline()).toThrow();
});
