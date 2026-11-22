// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {trimSketchProfile,sketchBulgeArc,evaluateSketch} from '@brickwright/cad-core';
import type {PlanarSketch,SketchProfile} from '@brickwright/cad-core';

const sketch=(profile:SketchProfile):PlanarSketch=>({id:'source',name:'Source',version:1,plane:'XY',profile});
const context={};
const box=sketch({kind:'outline',id:'panel',dxfLayer:'Panel',points:[[0,0],[40,0],[40,30],[0,30]]});

it('cuts a straight outline at exact line crossings and keeps either side',()=>{
 const first:[number,number]=[25,-5],second:[number,number]=[25,35];
 const left=trimSketchProfile(box,context,first,second,'left'),right=trimSketchProfile(box,context,first,second,'right');
 expect(left).toMatchObject({id:'panel',dxfLayer:'Panel',points:[[25,30],[0,30],[0,0],[25,0]]});
 expect(right).toMatchObject({id:'panel',points:[[25,0],[40,0],[40,30],[25,30]]});
 expect(box.profile).toMatchObject({points:[[0,0],[40,0],[40,30],[0,30]]});
});

it('splits an authored arc at the analytic point and retains its circle center and radius',()=>{
 const arc=sketch({kind:'outline',id:'arc',points:[[0,0],[10,0],[10,8],[0,8]],bulges:[1,0,0,0]});
 const result=trimSketchProfile(arc,context,[5,10],[5,-10],'left');
 if(result.kind!=='outline'||!result.bulges)throw Error('fixture');
 expect(result.points[0][0]).toBeCloseTo(5);
 expect(result.points[0][1]).toBeCloseTo(-5);
 expect(result.points.slice(1)).toEqual([[10,0],[10,8],[5,8]]);
 expect(result.bulges[0]).toBeCloseTo(Math.tan(Math.PI/8));
 expect(result.bulges.slice(1)).toEqual([0,0,0]);
 const solved=sketchBulgeArc(result.points[0],result.points[1],result.bulges[0])!;
 expect(solved.center[0]).toBeCloseTo(5);
 expect(solved.center[1]).toBeCloseTo(0);
 expect(solved.radius).toBeCloseTo(5);
});

it('retains existing holes and refuses a cut across or outside a hole',()=>{
 const profile=sketch({kind:'region',id:'plate',loops:[
  {kind:'circle',id:'bore',center:[12,15],radius:4,segments:32,dxfLayer:'Bore'},
  {kind:'outline',id:'wall',points:[[0,0],[40,0],[40,30],[0,30]]}
 ]});
 const result=trimSketchProfile(profile,context,[25,-5],[25,35],'left');
 expect(result).toMatchObject({loops:[{id:'bore',center:[12,15],radius:4,dxfLayer:'Bore'},{id:'wall'}]});
 const evaluated=evaluateSketch({...profile,profile:result},context);
 expect(evaluated.loopIds).toEqual(['wall','bore']);
 expect(Math.max(...evaluated.contour.map(point=>point[0]))).toBe(25);
 expect(()=>trimSketchProfile(profile,context,[12,-5],[12,35],'left')).toThrow('outside boundary');
 expect(()=>trimSketchProfile(profile,context,[6,-5],[6,35],'left')).toThrow('outside boundary');
});

it('rejects degenerate, tangent and multi-part cuts without editing the source',()=>{
 expect(()=>trimSketchProfile(box,context,[1,1],[1,1],'right')).toThrow('distinct');
 expect(()=>trimSketchProfile(box,context,[0,30],[40,30],'right')).toThrow('must cross');
 const u=sketch({kind:'outline',id:'fork',points:[[0,0],[20,0],[20,12],[15,12],[15,3],[5,3],[5,12],[0,12]]});
 expect(()=>trimSketchProfile(u,context,[-5,6],[25,6],'left')).toThrow('more than twice');
});
