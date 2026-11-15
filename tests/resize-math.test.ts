// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import * as T from 'three';
import {resizeSelection,resizeToDimension,resizedTransforms} from '../packages/editor/src/resize-math.js';
import type {ResizeFrame} from '../packages/editor/src/resize-math.js';
import type {Transform,Vec3} from '@brickwright/cad-core';
const frame=(size:Vec3=[30,20,10]):ResizeFrame=>({center:[0,0,5],size,rotation:new T.Quaternion(),uniformOnly:false,ids:['body']});
const options={grid:1,uniform:false,center:false,fine:false};
it('snaps dimension deltas in physical units independently of initial size',()=>{
 for(const width of [2,30,300,30.25]){
  const f=frame([width,20,10]),r=resizeSelection(f,[1,0,0],[2.4,0,0],options);
  expect(r.frame.size[0]).toBeCloseTo(width+2);expect(r.frame.center[0]-r.frame.size[0]/2).toBeCloseTo(-width/2);
 }
 expect(resizeSelection(frame(),[1,0,0],[.24,0,0],{...options,fine:true}).frame.size[0]).toBeCloseTo(30.2);
 expect(resizeSelection(frame(),[1,0,0],[.24,0,0],{...options,grid:0}).frame.size[0]).toBeCloseTo(30.24);
});
it('keeps the opposite side fixed or scales about the centre on request',()=>{
 const f=frame();const negative=resizeSelection(f,[-1,0,0],[-5,0,0],options);
 expect(negative.frame.size).toEqual([35,20,10]);expect(negative.frame.center[0]+17.5).toBe(15);
 const centered=resizeSelection(f,[1,0,0],[5,0,0],{...options,center:true});expect(centered.frame.center).toEqual(f.center);expect(centered.frame.size).toEqual([40,20,10]);
});
it('derives uniform ratios from one snapped driving dimension and retains the base',()=>{
 const r=resizeSelection(frame(),[1,1,0],[3.3,1.5,0],{...options,uniform:true});
 expect(r.factors).toEqual([1.1,1.1,1.1]);expect(r.frame.center[2]-r.frame.size[2]/2).toBeCloseTo(0);
 const cube={...frame([30,30,30]),uniformOnly:true};expect(resizeSelection(cube,[1,0,0],[5,0,0],options).frame.size).toEqual([35,35,35]);
});
it('resizes a rotated body without shear and preserves the rotated opposite anchor',()=>{
 const pose:Transform={position:[0,0,5],rotation:[25,38,47],scale:[1,2,1]},f=frame();f.rotation.setFromEuler(new T.Euler(...pose.rotation.map(v=>v*Math.PI/180) as Vec3,'ZYX'));
 const r=resizeSelection(f,[1,0,0],[6,0,0],options),anchor=new T.Vector3(-15,0,0).applyQuaternion(f.rotation).add(new T.Vector3(...f.center));
 expect(anchor.clone().applyMatrix4(r.delta).distanceTo(anchor)).toBeLessThan(1e-10);
 const [updated]=resizedTransforms([{id:'body',transform:pose}],r);expect(updated.transform.rotation).toEqual(pose.rotation);expect(updated.transform.scale).toEqual([1.2,2,1]);
});
it('uniform resizing of a mixed-orientation selection preserves rigid body rotations',()=>{
 const f={...frame(),uniformOnly:true},r=resizeSelection(f,[1,0,0],[3,0,0],options);
 for(const rotation of [[0,0,0],[20,40,60]] as Vec3[]){const [next]=resizedTransforms([{id:'body',transform:{position:[5,2,1],rotation,scale:[1,1,1]}}],r);expect(next.transform.rotation).toEqual(rotation);expect(next.transform.scale).toEqual([1.1,1.1,1.1]);}
});
it('accepts exact typed dimensions without grid rounding and rejects invalid dimensions',()=>{
 expect(resizeToDimension(frame(),0,12.345,{uniform:false,center:false}).frame.size[0]).toBeCloseTo(12.345);
 for(const value of [0,-1,NaN,Infinity])expect(()=>resizeToDimension(frame(),0,value,{uniform:false,center:false})).toThrow('positive');
 expect(()=>resizeSelection(frame(),[1,0,0],[-31,0,0],options)).toThrow('positive');
});
