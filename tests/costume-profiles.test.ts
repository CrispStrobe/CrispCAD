// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {costumeSketchProfile} from '../packages/editor/src/costume-profiles.js';
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
