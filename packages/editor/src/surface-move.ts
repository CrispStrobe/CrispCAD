// SPDX-License-Identifier: BSD-3-Clause
import * as T from 'three';
import type {Transform,Vec3} from '@brickwright/cad-core';
import {placementFrame} from './surface-placement.js';
/** Rigidly carry the selection's original bottom plane onto a target face.
 * Relative positions, individual rotations and all scale factors are retained. */
export function surfaceMove(items:readonly {id:string;transform:Transform}[],base:Vec3,point:Vec3,normal:Vec3){
 const q=placementFrame(normal).q,delta=new T.Matrix4().makeTranslation(...point).multiply(new T.Matrix4().makeRotationFromQuaternion(q)).multiply(new T.Matrix4().makeTranslation(-base[0],-base[1],-base[2]));
 const updates=items.map(({id,transform})=>{const rotation=q.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(...transform.rotation.map(v=>v*Math.PI/180) as Vec3,'ZYX'))),e=new T.Euler().setFromQuaternion(rotation,'ZYX');return {id,transform:{position:new T.Vector3(...transform.position).sub(new T.Vector3(...base)).applyQuaternion(q).add(new T.Vector3(...point)).toArray() as Vec3,rotation:[e.x*180/Math.PI,e.y*180/Math.PI,e.z*180/Math.PI] as Vec3,scale:[...transform.scale] as Vec3}};});return {delta,updates};
}
