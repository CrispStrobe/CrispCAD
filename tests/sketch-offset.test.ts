// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {createCadSession,evaluateSketch,sketchBulgeArc} from '@brickwright/cad-core';
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

it('rejects topological splits and radius collapse without changing the editable source',()=>{
 const dumbbell=sketch({kind:'outline',id:'dumbbell',points:[
  [0,0],[8,0],[8,3],[18,3],[18,0],[26,0],[26,8],[18,8],[18,5],[8,5],[8,8],[0,8]
 ]});
 expect(()=>kernel.offsetSketch(dumbbell,context,-1.5)).toThrow('splits');
 const arc=sketch({kind:'outline',id:'arc',points:[[0,0],[10,0],[10,10],[0,10]],bulges:[.2,0,0,0]});
 expect(()=>kernel.offsetSketch(arc,context,-20)).toThrow('collapses');
 expect(arc.profile).toMatchObject({bulges:[.2,0,0,0]});
 expect(()=>kernel.offsetSketch(dumbbell,context,0)).toThrow('magnitude');
});

it('keeps true concentric arcs, joins outward corners with arcs and accepts either winding',()=>{
 const forward=sketch({kind:'outline',id:'arc',points:[[0,0],[10,0],[10,8],[0,8]],bulges:[1,0,0,0]});
 const backward=sketch({kind:'outline',id:'arc-cw',points:[[0,0],[0,8],[10,8],[10,0]],bulges:[0,0,0,-1]});
 for(const outline of [forward,backward]){
  const expanded=kernel.offsetSketch(outline,context,1);
  if(expanded.kind!=='outline'||!expanded.bulges)throw Error('fixture');
  const arcs=expanded.points.flatMap((a,i)=>{
   const arc=sketchBulgeArc(a,expanded.points[(i+1)%expanded.points.length],expanded.bulges![i]);
   return arc?[arc]:[];
  });
  expect(arcs.map(arc=>Math.round(arc.radius)).sort()).toEqual([1,1,6]);
  const foot=arcs.find(arc=>arc.radius>5)!;
  expect(foot.center[0]).toBeCloseTo(5);
  expect(foot.center[1]).toBeCloseTo(0);
  const [minX,minY,maxX,maxY]=bounds(evaluateSketch({...outline,profile:expanded},context).contour);
  expect(minX).toBeCloseTo(-1);
  expect(minY).toBeCloseTo(-6);
  expect(maxX).toBeCloseTo(11);
  expect(maxY).toBeCloseTo(9);
 }
});

it('trims line–arc and arc–arc supports when curved outlines shrink',()=>{
 const panel=sketch({kind:'outline',id:'foot',points:[[0,0],[10,0],[10,8],[0,8]],bulges:[.2,0,0,0]});
 const inset=kernel.offsetSketch(panel,context,-.5);
 if(inset.kind!=='outline'||!inset.bulges)throw Error('fixture');
 const foot=sketchBulgeArc(inset.points[0],inset.points[1],inset.bulges[0])!;
 expect(inset.points[0][0]).toBeCloseTo(.5);
 expect(inset.points[1][0]).toBeCloseTo(9.5);
 expect(foot.center[0]).toBeCloseTo(5);
 expect(foot.center[1]).toBeCloseTo(12);
 expect(foot.radius).toBeCloseTo(12.5);

 const lens=sketch({kind:'outline',id:'lens',points:[[0,-3],[0,3]],bulges:[.5,.5]});
 const smaller=kernel.offsetSketch(lens,context,-.5);
 if(smaller.kind!=='outline'||!smaller.bulges)throw Error('fixture');
 expect(smaller.points).toHaveLength(2);
 expect(Math.abs(smaller.points[0][1])).toBeCloseTo(Math.sqrt(3.25**2-2.25**2));
 const arc=sketchBulgeArc(smaller.points[0],smaller.points[1],smaller.bulges[0])!;
 expect(arc.radius).toBeCloseTo(3.25);
 expect(Math.abs(arc.center[0])).toBeCloseTo(2.25);
});

it('keeps curved hole identities and applies the inverse offset to their radii',()=>{
 const source=sketch({kind:'region',id:'plate',loops:[
  {kind:'outline',id:'hole',points:[[12,5],[12,11]],bulges:[1,1],dxfLayer:'Holes'},
  {kind:'outline',id:'wall',points:[[0,0],[24,0],[24,18],[0,18]]}
 ]});
 const profile=kernel.offsetSketch(source,context,1);
 if(profile.kind!=='region')throw Error('fixture');
 const [hole]=profile.loops;
 if(hole.kind!=='outline'||!hole.bulges)throw Error('fixture');
 expect(hole).toMatchObject({id:'hole',dxfLayer:'Holes'});
 const arc=sketchBulgeArc(hole.points[0],hole.points[1],hole.bulges[0])!;
 expect(arc.center).toEqual([12,8]);
 expect(arc.radius).toBeCloseTo(2);
});
