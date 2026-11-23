// SPDX-License-Identifier: BSD-3-Clause
import {ACadVersion} from '@node-projects/acad-ts';
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
