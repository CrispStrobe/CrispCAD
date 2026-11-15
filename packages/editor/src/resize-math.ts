// SPDX-License-Identifier: BSD-3-Clause
import * as T from 'three';
import {t} from '@brickwright/cad-core';
import type {Vec3,Transform} from '@brickwright/cad-core';
import {applyGizmoDelta} from './transform-selection.js';
export interface ResizeFrame {center:Vec3;size:Vec3;rotation:T.Quaternion;uniformOnly:boolean;ids:string[]}
export interface ResizeResult {delta:T.Matrix4;factors:Vec3;frame:ResizeFrame}
export type ResizeSigns=readonly [number,number,number];
/** Snap movement in model units; preserve a fractional starting size. Uniform
 * resizing snaps one driving dimension and derives every other size by ratio. */
export function resizeSelection(frame:ResizeFrame,signs:ResizeSigns,travel:readonly number[],options:{grid:number;uniform:boolean;center:boolean;fine:boolean}):ResizeResult{
 const active=[0,1,2].filter(i=>signs[i]!==0),uniform=options.uniform||frame.uniformOnly,step=options.grid/(options.fine?10:1),changes=frame.size.map((_,i)=>active.includes(i)?travel[i]*signs[i]*(options.center?2:1):0),snap=(n:number)=>step>0?Math.round(n/step)*step:n;
 const driver=active.reduce((best,i)=>Math.abs(changes[i]/frame.size[i])>Math.abs(changes[best]/frame.size[best])?i:best,active[0]??0);
 const factors=frame.size.map((v,i)=>uniform?1+snap(changes[driver])/frame.size[driver]:1+snap(changes[i])/v) as Vec3;
 if(factors.some(n=>!Number.isFinite(n)||n<=0))throw new Error(t('Resize must keep every dimension positive'));
 const anchor=new T.Vector3(...frame.center),local=frame.size.map((v,i)=>options.center?0:signs[i]?-signs[i]*v/2:i===2&&uniform?-v/2:0) as Vec3;anchor.add(new T.Vector3(...local).applyQuaternion(frame.rotation));
 const rotate=new T.Matrix4().makeRotationFromQuaternion(frame.rotation),delta=new T.Matrix4().makeTranslation(...anchor.toArray()).multiply(rotate).multiply(new T.Matrix4().makeScale(...factors)).multiply(rotate.clone().invert()).multiply(new T.Matrix4().makeTranslation(...anchor.clone().negate().toArray()));
 const center=new T.Vector3(...frame.center).applyMatrix4(delta).toArray() as Vec3;
 return {delta,factors,frame:{...frame,center,size:frame.size.map((v,i)=>v*factors[i]) as Vec3}};
}
export function resizeToDimension(frame:ResizeFrame,axis:number,size:number,options:{uniform:boolean;center:boolean}):ResizeResult{
 if(!Number.isFinite(size)||size<=0)throw new Error(t('Enter a positive dimension'));const signs:[number,number,number]=[0,0,0];signs[axis]=1;const travel=[0,0,0];travel[axis]=(size-frame.size[axis])/(options.center?2:1);return resizeSelection(frame,signs,travel,{...options,grid:0,fine:false});
}
export function resizedTransforms(poses:readonly {id:string;transform:Transform}[],result:ResizeResult){return poses.map(({id,transform})=>({id,transform:applyGizmoDelta(transform,result.delta,'scale',result.factors)}));}
