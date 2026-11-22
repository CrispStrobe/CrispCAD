// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {createCadSession,evaluateSketch} from '@brickwright/cad-core';
import type {PlanarSketch,SketchProfile} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';

let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const sketch=(profile:SketchProfile):PlanarSketch=>({id:'source',name:'Source',version:1,plane:'XY',profile});
const context={};
const bounds=(points:[number,number][])=>{
 const x=points.map(point=>point[0]),y=points.map(point=>point[1]);
 return [Math.min(...x),Math.min(...y),Math.max(...x),Math.max(...y)];
};

it('offsets native rectangles and circles while preserving source formulas and identities',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{span:{unit:'scalar',expression:'30'},rim:{unit:'mm',expression:'10'}},bindings:[]});
 const {parametric}=session.state.document;
 const plate=sketch({kind:'rectangle',id:'plate',width:'span',depth:20});
 const shifted=kernel.offsetSketch(plate,{parametric},2);
 expect(shifted).toMatchObject({kind:'rectangle',id:'plate',width:'(span) * 1 mm + 4 mm',depth:24});
 expect(bounds(evaluateSketch({...plate,profile:shifted},{parametric}).contour)).toEqual([-17,-12,17,12]);
 const ring=sketch({kind:'circle',id:'ring',radius:'rim',center:[3,5],segments:48,dxfLayer:'Bores'});
 expect(kernel.offsetSketch(ring,{parametric},-2)).toMatchObject({id:'ring',radius:'(rim) + -2 mm',center:[3,5],dxfLayer:'Bores'});
 expect(()=>kernel.offsetSketch(ring,{parametric},-10)).toThrow('Dimension');
});

it('offsets concave polygon loops, preserving layer and polygon kind',()=>{
 const l=sketch({kind:'outline',id:'bracket',dxfLayer:'Bracket',points:[[0,0],[30,0],[30,8],[8,8],[8,30],[0,30]]});
 const expanded=kernel.offsetSketch(l,context,2);
 expect(expanded).toMatchObject({kind:'outline',id:'bracket',dxfLayer:'Bracket'});
 expect(bounds(evaluateSketch({...l,profile:expanded},context).contour)).toEqual([-2,-2,32,32]);
 const shrunk=kernel.offsetSketch(l,context,-2);
 expect(bounds(evaluateSketch({...l,profile:shrunk},context).contour)).toEqual([2,2,28,28]);
 expect(()=>kernel.offsetSketch(l,context,-5)).toThrow('collapses');
});

it('offsets region exteriors and holes with opposite signs, even when a hole is listed first',()=>{
 const plate=sketch({kind:'region',id:'plate',loops:[
  {kind:'circle',id:'bore',center:[8,8],radius:4,segments:48,dxfLayer:'Hole'},
  {kind:'outline',id:'edge',points:[[0,0],[35,0],[35,30],[0,30]],dxfLayer:'Outline'},
  {kind:'outline',id:'opening',points:[[20,10],[28,10],[28,18],[20,18]]}
 ]});
 const expanded=kernel.offsetSketch(plate,context,1);
 if(expanded.kind!=='region')throw Error('fixture');
 expect(expanded.loops[0]).toMatchObject({id:'bore',radius:3,dxfLayer:'Hole'});
 const evaluated=evaluateSketch({...plate,profile:expanded},context);
 expect(evaluated.loopIds).toEqual(['edge','opening','bore']);
 expect(bounds(evaluated.contour)).toEqual([-1,-1,36,31]);
 expect(bounds(evaluated.holes![0])).toEqual([21,11,27,17]);
 expect(()=>kernel.offsetSketch(plate,context,-3)).toThrow('outside boundary');
 expect(plate.profile).toMatchObject({loops:[expect.objectContaining({radius:4}),expect.anything(),expect.anything()]});
});

it('rejects topological splits and curved bulges without changing the editable source',()=>{
 const dumbbell=sketch({kind:'outline',id:'dumbbell',points:[
  [0,0],[8,0],[8,3],[18,3],[18,0],[26,0],[26,8],[18,8],[18,5],[8,5],[8,8],[0,8]
 ]});
 expect(()=>kernel.offsetSketch(dumbbell,context,-1.5)).toThrow('splits');
 const arc=sketch({kind:'outline',id:'arc',points:[[0,0],[10,0],[10,10],[0,10]],bulges:[.2,0,0,0]});
 expect(()=>kernel.offsetSketch(arc,context,1)).toThrow('contains arcs');
 expect(arc.profile).toMatchObject({bulges:[.2,0,0,0]});
 expect(()=>kernel.offsetSketch(dumbbell,context,0)).toThrow('magnitude');
});
