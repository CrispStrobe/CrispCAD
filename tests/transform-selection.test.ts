import {expect,it} from 'vitest';
import * as T from 'three';
import {applyGizmoDelta,scalePivotRotation,transformMatrix} from '../packages/editor/src/transform-selection.js';
import type {Transform,Vec3} from '@brickwright/cad-core';
function scaleDelta(poses:Transform[],center:Vec3,factor:Vec3){const frame=scalePivotRotation(poses),start=new T.Matrix4().compose(new T.Vector3(...center),frame,new T.Vector3(1,1,1)),end=new T.Matrix4().compose(new T.Vector3(...center),frame,new T.Vector3(...factor));return end.multiply(start.invert());}
it('scales a rotated, already nonuniform body on its local axes without shear or rotation drift',()=>{
 const original:Transform={position:[14,7,18],rotation:[25,38,47],scale:[1.4,.8,1.2]},factors:Vec3=[1.7,1,.6],delta=scaleDelta([original],[10,4,20],factors),next=applyGizmoDelta(original,delta,'scale',factors);
 expect(next.rotation).toEqual(original.rotation);expect(next.scale).toEqual([2.38,.8,.72]);const expected=delta.multiply(transformMatrix(original));transformMatrix(next).elements.forEach((v,i)=>expect(v).toBeCloseTo(expected.elements[i],9));
});
it('supports same-oriented groups and uniform scaling of differently oriented groups',()=>{
 const a:Transform={position:[-10,0,0],rotation:[0,0,45],scale:[1,1,1]},b:Transform={position:[10,0,0],rotation:[0,0,45],scale:[1,1,1]};
 for(const pose of [a,b])expect(applyGizmoDelta(pose,scaleDelta([a,b],[0,0,0],[2,1,1]),'scale',[2,1,1]).scale).toEqual([2,1,1]);
 b.rotation=[10,25,80];for(const pose of [a,b])expect(applyGizmoDelta(pose,scaleDelta([a,b],[0,0,0],[2,2,2]),'scale',[2,2,2]).position).toEqual(pose.position.map(v=>v*2));
 expect(()=>applyGizmoDelta(a,scaleDelta([a,b],[0,0,0],[2,1,1]),'scale',[2,1,1])).toThrow('different orientations');
});
it('preserves exact unchanged inputs and rejects reflections instead of silently corrupting the pose',()=>{
 const pose:Transform={position:[12,7,20],rotation:[13,27,44],scale:[1,2,1]};const moved=applyGizmoDelta(pose,new T.Matrix4().makeTranslation(3,0,0),'translate');expect(moved.position).toEqual([15,7,20]);expect(moved.rotation).toEqual(pose.rotation);expect(moved.scale).toEqual(pose.scale);
 expect(()=>applyGizmoDelta(pose,new T.Matrix4().makeScale(-1,1,1),'scale',[-1,1,1])).toThrow('Scale must');
});
