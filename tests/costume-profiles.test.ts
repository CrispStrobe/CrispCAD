// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {CubicBezierCurve,EllipseCurve,LineCurve,QuadraticBezierCurve,Vector2} from 'three';
import {costumeCurveSteps,costumeProfileBounds,costumeSketchProfile,matchCostumeProfile} from '../packages/editor/src/costume-profiles.js';
import type {CostumeRegion} from '../packages/editor/src/costume-profiles.js';
import {evaluateSketchRegion} from '@brickwright/cad-core';
import {costumeArcSweep,costumeCenterlinePreview} from '../packages/editor/src/costume-centerline.js';

const ring:CostumeRegion={
 origin:[10,-80],size:[20,60],
 loops:[{kind:'outline',points:[[10,-80],[30,-80],[30,-20],[10,-20]]},
  {kind:'circle',center:[20,-50],radius:4}]
};

it('scales the profile and its hole to the requested millimetres at the sketch origin',()=>{
 const profile=costumeSketchProfile(ring,40);
 expect(profile.kind).toBe('region');
 if(profile.kind!=='region')throw new Error('Expected a region with a hole');
 expect(profile.loops[0]).toMatchObject({kind:'outline',points:[[0,0],[40,0],[40,120],[0,120]]});
 expect(profile.loops[1]).toMatchObject({kind:'circle',center:[20,60],radius:8});
 expect(evaluateSketchRegion(profile.loops).holes).toHaveLength(1);
});

it('keeps a full circle analytic and rejects invalid scaling or a hole outside the outline',()=>{
 expect(costumeSketchProfile({
  origin:[-5,-5],size:[10,10],loops:[{kind:'circle',center:[0,0],radius:5}]
 },50)).toMatchObject({kind:'circle',center:[25,25],radius:25});
 expect(()=>costumeSketchProfile(ring,0)).toThrow();
 expect(()=>costumeSketchProfile({...ring,loops:[ring.loops[0],{kind:'circle',center:[40,-50],radius:4}]},40)).toThrow();
});

const vector=(x:number,y:number)=>new Vector2(x,y);
it.each([
 new QuadraticBezierCurve(vector(0,0),vector(15,35),vector(40,10)),
 new CubicBezierCurve(vector(0,0),vector(-15,25),vector(60,45),vector(40,10)),
 new EllipseCurve(20,10,40,12,.7,5.3,true,.4),
])('keeps sampled curves within their chord error and adds detail at smaller tolerances',curve=>{
 const tolerance=.05;
 const steps=costumeCurveSteps(curve,tolerance);
 expect(steps).toBeGreaterThan(costumeCurveSteps(curve,1));
 for(let segment=0;segment<steps;segment++){
  const start=curve.getPoint(segment/steps),end=curve.getPoint((segment+1)/steps);
  for(const frac of [.1,.25,.5,.75,.9]){
   expect(curve.getPoint((segment+frac)/steps).distanceTo(start.clone().lerp(end,frac))).toBeLessThanOrEqual(tolerance);
  }
 }
});

it('leaves lines alone and rejects a curve that exceeds the outline vertex budget',()=>{
 expect(costumeCurveSteps(new LineCurve(vector(0,0),vector(100,0)),.01)).toBe(1);
 expect(()=>costumeCurveSteps(new EllipseCurve(0,0,500,250,0,2*Math.PI),.001)).toThrow(/256 vertices/);
});


it('checks a closing edge at the final model scale, including the exact limit',()=>{
 const source:CostumeRegion={...ring,gapRepair:{edges:[[[10,-80],[10,-79.5]]],limitMm:1}};
 expect(costumeSketchProfile(source,40).kind).toBe('region');
 expect(()=>costumeSketchProfile(source,41)).toThrow(/gap exceeds/);
});


it('places a region and its circular hole together using its center or lower-left anchor',()=>{
 const placement={anchor:'center' as const,position:[-12,15] as [number,number]};
 expect(costumeProfileBounds(ring,40,placement)).toEqual({min:[-32,-45],max:[8,75]});
 expect(costumeSketchProfile(ring,40,placement)).toMatchObject({kind:'region',loops:[
  {kind:'outline',points:[[-32,-45],[8,-45],[8,75],[-32,75]]},
  {kind:'circle',center:[-12,15],radius:8},
 ]});
 expect(costumeProfileBounds(ring,40,{anchor:'lower-left',position:[10,-8]})).toEqual({min:[10,-8],max:[50,112]});
});

it('rejects invalid placement and profiles outside the supported sketch coordinates',()=>{
 expect(()=>costumeSketchProfile(ring,40,{anchor:'center',position:[Infinity,0]})).toThrow(/Enter sketch coordinates/);
 expect(()=>costumeSketchProfile(ring,40,{anchor:'lower-left',position:[99961,0]})).toThrow(/coordinate limits/);
 expect(costumeProfileBounds(ring,40,{anchor:'lower-left',position:[99960,0]}).max[0]).toBe(100000);
});


it('scales and places a vertical open path by its longer span',()=>{
 const source:CostumeRegion={origin:[2,1],size:[0,8],loops:[],centerline:{points:[[2,1],[2,9]],d:''}};
 const placement={anchor:'center' as const,position:[10,5] as [number,number]};
 expect(costumeProfileBounds(source,40,placement)).toEqual({min:[10,-15],max:[10,25]});
 expect(costumeSketchProfile(source,40,placement)).toMatchObject({kind:'path',points:[[10,-15],[10,25]]});
});

it('preserves signed arc bulges and measures the curve past its endpoints',()=>{
 const points:[[number,number],[number,number]]=[[0,0],[20,0]];
 const {d,extrema}=costumeCenterlinePreview(points,[1,0]);
 expect(d).toBe('M 0 0 A 10 10 0 0 0 20 0');
 expect(Math.min(...extrema.map(point=>point[1]))).toBe(-10);
 expect(costumeSketchProfile({origin:[0,-10],size:[20,10],loops:[],centerline:{points,bulges:[1,0],d}},40))
  .toMatchObject({kind:'path',points:[[0,20],[40,20]],bulges:[1,0]});
});

it('recovers a rounded authored circular cubic and keeps general artwork curves separate',()=>{
 const arc=new CubicBezierCurve(vector(20,0),vector(20,11.04569),vector(11.04569,20),vector(0,20));
 expect(costumeArcSweep(arc,true)).toBeCloseTo(Math.PI/2,10);
 expect(costumeArcSweep(arc,false)).toBeUndefined();
 arc.v1.y += .2;
 expect(costumeArcSweep(arc,true)).toBeUndefined();
 expect(costumeArcSweep(new EllipseCurve(0,0,20,20,0,Math.PI/2,true),false)).toBeCloseTo(-3*Math.PI/2,10);
 expect(costumeArcSweep(new EllipseCurve(0,0,20,10,0,Math.PI/2),false)).toBeUndefined();
});


it('matches a named artwork region after reordering or changing its geometry',()=>{
 const saved={mode:'fill',signature:'25:10:20',sourceKey:'svg:target'} as const;
 const changed={...ring,artworkProfile:{...saved,signature:'38:11:22'}};
 const other={...ring,artworkProfile:{...saved,sourceKey:'svg:other'}};
 expect(matchCostumeProfile([other,changed],saved)).toBe(1);
 expect(matchCostumeProfile([other],saved)).toBeUndefined();
 expect(matchCostumeProfile([changed,changed],saved)).toBeUndefined();
 expect(matchCostumeProfile([{...changed,ambiguousSourceKey:true}],saved)).toBeUndefined();
});

it('requires unique exact geometry and the same source mode for an anonymous region',()=>{
 const saved={mode:'fill',signature:'25:10:20'} as const;
 const exact={...ring,artworkProfile:saved};
 const changed={...ring,artworkProfile:{...saved,signature:'38:11:22'}};
 const stroke={...ring,artworkProfile:{...saved,mode:'stroke' as const}};
 expect(matchCostumeProfile([changed,stroke,exact],saved)).toBe(2);
 expect(matchCostumeProfile([changed,stroke],saved)).toBeUndefined();
 expect(matchCostumeProfile([changed,exact,exact],saved)).toBeUndefined();
});
