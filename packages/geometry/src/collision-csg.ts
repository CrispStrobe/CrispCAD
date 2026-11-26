// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {Manifold,ManifoldToplevel} from 'manifold-3d';
import {partitionConvex} from './convex.js';
import type {ConvexPiece} from './convex.js';
type MeshData={positions:ArrayLike<number>;indices:ArrayLike<number>};
export function collisionCSG(module:ManifoldToplevel,remember:(piece:ConvexPiece)=>ConvexPiece=piece=>piece){
 const maxHullVertices=64;
 const indexedEdges=new Uint8Array(maxHullVertices*maxHullVertices);
 const hasClosedIndices=(triangles:Uint32Array,vertexCount:number)=>{
  // Keep the cheap check bounded to the size of our convex pieces.
  if(!Number.isInteger(vertexCount)||vertexCount>maxHullVertices||triangles.length>384||triangles.length%3)return false;
  indexedEdges.fill(0,0,vertexCount*vertexCount);
  let pairs=0;
  for(let i=0;i<triangles.length;i++){
   const from=triangles[i],to=triangles[i%3===2?i-2:i+1];
   if(from===to||from>=vertexCount||to>=vertexCount)return false;
   const edge=from*vertexCount+to;
   if(indexedEdges[edge])return false;
   pairs+=indexedEdges[to*vertexCount+from];
   indexedEdges[edge]=1;
  }
  return pairs*2===triangles.length;
 };
 const build=(mesh:MeshData)=>{
  const vertices=new Float32Array(mesh.positions),triangles=new Uint32Array(mesh.indices);
  const data=new module.Mesh({numProp:3,vertProperties:vertices,triVerts:triangles});
  // Mesh.merge repairs open seams. Closed indexed hulls can be validated
  // directly by the native constructor without that additional round trip.
  if(!hasClosedIndices(triangles,vertices.length/3))data.merge();
  const solid=new module.Manifold(data);
  if(solid.status()!=='NoError'){
   solid.delete();
   throw new Error(t('Collision CSG requires a closed mesh'));
  }
  return solid;
 };
 const data=(solid:Manifold):ConvexPiece=>{const m=solid.getMesh();return {positions:new Float64Array(Array.from({length:m.numVert*3},(_,i)=>m.vertProperties[Math.floor(i/3)*m.numProp+i%3])),indices:new Uint32Array(m.triVerts)};};
 const difference=(aa:Manifold,bb:Manifold)=>{let missing:Manifold|undefined,extra:Manifold|undefined;try{missing=aa.subtract(bb);extra=bb.subtract(aa);if(missing.status()!=='NoError'||extra.status()!=='NoError')throw new Error(t('Collision comparison failed'));const m=Math.abs(missing.volume()),e=Math.abs(extra.volume()),residual=Math.abs((m-e)-(aa.volume()-bb.volume()));return {missingVolumeMm3:m,extraVolumeMm3:e,numericalResidualVolumeMm3:residual};}finally{extra?.delete();missing?.delete();}};
 return {
  /** Compare the live compound before exporting a Float32 union mesh. A fine
   * thread's nearly coplanar union can lose volume on that avoidable roundtrip. */
  measure(source:MeshData,pieces:ConvexPiece[]){const owned:Manifold[]=[];let compound:Manifold|undefined;try{const original=build(source);owned.push(original);const inputs=pieces.map(piece=>{const solid=build(piece);owned.push(solid);return solid;});compound=module.Manifold.union(inputs);if(compound.status()!=='NoError')throw new Error(t('Collision union is not a closed solid'));return {...difference(original,compound),bounds:compound.boundingBox()};}finally{compound?.delete();owned.reverse().forEach(s=>s.delete());}},
  grid(pieces:ConvexPiece[]){const owned:Manifold[]=[];const keep=(s:Manifold)=>{owned.push(s);return s;};try{let solids=pieces.map(piece=>keep(build(piece)));for(let axis=0;axis<3;axis++)for(let pass=0;pass<(axis===2?4:2);pass++){const next:Manifold[]=[];for(const solid of solids){const bounds=solid.boundingBox(),normal:[number,number,number]=[0,0,0];normal[axis]=1;const halves=solid.splitByPlane(normal,(bounds.max[axis]+bounds.min[axis])/2).map(keep);next.push(...halves.filter(s=>!s.isEmpty()&&s.volume()>1e-5));}solids=next;if(solids.length>2048)throw new Error(t('Collision grid exceeds its budget'));}return solids.map(data);}finally{for(const solid of owned.reverse())solid.delete();}},
  union(pieces:ConvexPiece[]){const solids=pieces.map(build);let solid:Manifold|undefined;try{solid=module.Manifold.union(solids);if(solid.status()!=='NoError')throw new Error(t('Collision union is not a closed solid'));return {...data(solid),volume:solid.volume(),bounds:solid.boundingBox()};}finally{solid?.delete();solids.forEach(s=>s.delete());}},
  compare(a:MeshData,b:MeshData){const aa=build(a),bb=build(b);try{const {missingVolumeMm3,extraVolumeMm3}=difference(aa,bb);return {missingVolumeMm3,extraVolumeMm3};}finally{bb.delete();aa.delete();}},
  intersect(pieces:ConvexPiece[],envelopes:MeshData[],maxPieces=2048){
   const clips=envelopes.map(build),result:ConvexPiece[]=[];let envelope:Manifold|undefined;
   try{envelope=module.Manifold.intersection(clips);for(const piece of pieces){const solid=build(piece);let clipped:Manifold|undefined;
    try{clipped=solid.intersect(envelope);if(!clipped.isEmpty()&&Math.abs(clipped.volume())>1e-5){const mesh=data(clipped);result.push(...partitionConvex(module,mesh.positions,mesh.indices,Math.max(1,maxPieces-result.length)).map(remember));}}
    finally{clipped?.delete();solid.delete();}
    if(result.length>maxPieces)throw new Error(t('Construction collision exceeds its compound budget'));
   }return result;}finally{envelope?.delete();clips.forEach(s=>s.delete());}
  },
  subtract(pieces:ConvexPiece[],cutters:MeshData[],maxPieces=2048){const cuts=cutters.map(build);let cutter:Manifold|undefined;const result:ConvexPiece[]=[];try{cutter=module.Manifold.union(cuts);const bounds=cutter.boundingBox();for(const piece of pieces){const outside=[0,1,2].some(axis=>{let min=Infinity,max=-Infinity;for(let i=axis;i<piece.positions.length;i+=3){min=Math.min(min,piece.positions[i]);max=Math.max(max,piece.positions[i]);}return max<=bounds.min[axis]||min>=bounds.max[axis];});if(outside){result.push(piece);continue;}const solid=build(piece);let clipped:Manifold|undefined;try{clipped=solid.subtract(cutter);if(!clipped.isEmpty()&&Math.abs(clipped.volume())>1e-5){const mesh=data(clipped);result.push(...partitionConvex(module,mesh.positions,mesh.indices,Math.max(1,maxPieces-result.length)).map(remember));}}finally{clipped?.delete();solid.delete();}if(result.length>maxPieces)throw new Error(t('Collision subtraction exceeds its compound budget'));}return result;}finally{cutter?.delete();cuts.forEach(c=>c.delete());}},
 };
}
