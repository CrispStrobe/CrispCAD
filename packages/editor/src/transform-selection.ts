// SPDX-License-Identifier: BSD-3-Clause
import * as T from 'three';
import type {Transform,Vec3} from '@brickwright/cad-core';
const RAD=Math.PI/180;
const rotation=(pose:Transform)=>new T.Quaternion().setFromEuler(new T.Euler(...pose.rotation.map(v=>v*RAD) as Vec3,'ZYX'));
export const transformMatrix=(pose:Transform)=>new T.Matrix4().compose(new T.Vector3(...pose.position),rotation(pose),new T.Vector3(...pose.scale));
/** A scale gizmo must inherit a single body's local orientation. Same-oriented
 * selections can share that frame; other groups retain a world frame. */
export function scalePivotRotation(poses:readonly Transform[]):T.Quaternion {
 if(!poses.length)return new T.Quaternion();const first=rotation(poses[0]);
 return poses.every(p=>Math.abs(first.dot(rotation(p)))>1-1e-12)?first:new T.Quaternion();
}
export function applyGizmoDelta(original:Transform,delta:T.Matrix4,mode:'translate'|'rotate'|'scale',factors:Vec3=[1,1,1]):Transform {
 const desired=delta.clone().multiply(transformMatrix(original)),p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();desired.decompose(p,q,s);
 const e=new T.Euler().setFromQuaternion(q,'ZYX');
 const next:Transform={position:p.toArray() as Vec3,rotation:mode==='rotate'?[e.x/RAD,e.y/RAD,e.z/RAD]:[...original.rotation],scale:mode==='scale'?original.scale.map((v,i)=>v*factors[i]) as Vec3:[...original.scale]};
 if(next.scale.some(v=>!Number.isFinite(v)||v<.001||v>1000))throw new Error('Scale must stay between 0.001 and 1000. Drag outward without crossing the opposite side.');
 // Keep unchanged driven inputs exact instead of introducing decomposition noise.
 next.position=next.position.map((v,i)=>Math.abs(v-original.position[i])<1e-10*Math.max(1,Math.abs(v))?original.position[i]:v) as Vec3;
 const rebuilt=transformMatrix(next);
 if(rebuilt.elements.some((v,i)=>Math.abs(v-desired.elements[i])>1e-7*Math.max(1,Math.abs(v),Math.abs(desired.elements[i]))))throw new Error('These bodies have different orientations. Use uniform scaling or scale one body at a time.');
 return next;
}
