// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {CubicBezierCurve,EllipseCurve,LineCurve,QuadraticBezierCurve,Vector2} from 'three';
import {costumeCurveSteps,costumeSketchProfile} from '../packages/editor/src/costume-profiles.js';
import type {CostumeRegion} from '../packages/editor/src/costume-profiles.js';
import {evaluateSketchRegion} from '@brickwright/cad-core';

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
