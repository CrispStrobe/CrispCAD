// SPDX-License-Identifier: BSD-3-Clause
import * as T from 'three';
/** Evaluated vertices are already in world space. Keep their compact source
 * buffer for exact bounds; rendering may duplicate vertices for crease normals. */
export function createMeshBounds(){
 const records=new WeakMap<T.Object3D,{positions:ArrayLike<number>;base:T.Box3;box:T.Box3;matrix:number[];scans:number}>();
 function register(mesh:T.Object3D,positions:ArrayLike<number>,bounds:{min:readonly number[];max:readonly number[]}){records.set(mesh,{positions,base:new T.Box3(new T.Vector3(...bounds.min as [number,number,number]),new T.Vector3(...bounds.max as [number,number,number])),box:new T.Box3(),matrix:[],scans:0});}
 function read(mesh:T.Object3D,target=new T.Box3()){
  const r=records.get(mesh);if(!r)return target.setFromObject(mesh,true);mesh.updateWorldMatrix(true,false);const m=mesh.matrixWorld.elements;
  if(r.matrix.length!==16||m.some((v,i)=>v!==r.matrix[i])){
   // Axis permutations/scales/translations preserve the source AABB exactly.
   const axisAligned=[0,1,2].every(row=>[0,1,2].filter(col=>m[col*4+row]!==0).length<=1)&&[0,1,2].every(col=>[0,1,2].filter(row=>m[col*4+row]!==0).length<=1);
   if(r.matrix.length===16&&[0,1,2,3,4,5,6,7,8,9,10,11,15].every(i=>m[i]===r.matrix[i]))r.box.translate(new T.Vector3(m[12]-r.matrix[12],m[13]-r.matrix[13],m[14]-r.matrix[14]));
   else if(axisAligned)r.box.copy(r.base).applyMatrix4(mesh.matrixWorld);
   else{r.box.makeEmpty();const p=new T.Vector3();for(let i=0;i<r.positions.length;i+=3)r.box.expandByPoint(p.set(r.positions[i],r.positions[i+1],r.positions[i+2]).applyMatrix4(mesh.matrixWorld));r.scans++;}
   r.matrix=[...m];
  }
  return target.copy(r.box);
 }
 return {register,read,positions:(mesh:T.Object3D)=>records.get(mesh)?.positions,scans:(mesh:T.Object3D)=>records.get(mesh)?.scans??0};
}
