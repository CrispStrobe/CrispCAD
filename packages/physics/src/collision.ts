import {t} from '@brickwright/cad-core';
import {sha256Hex} from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
import type { GeometryKernel, BodyMesh } from '@brickwright/cad-geometry';
export interface ConvexPiece {positions:Float64Array;indices:Uint32Array}
export interface CollisionCertificate {sourceSHA256:string;algorithm:'manifold-compound/v1';strategy:'bsp'|'supplied';maxHulls:number;missingVolumeMm3:number;extraVolumeMm3:number;numericalResidualVolumeMm3?:number;relativeError:number;boundsErrorMm:number;tolerance:{volumeFraction:number;boundsMm:number}}
export interface PreparedCollision {hulls:ConvexPiece[];certificate:CollisionCertificate}
const verified=new WeakMap<PreparedCollision,string>();
async function collisionHash(hulls:readonly ConvexPiece[]){const bytes=new Uint8Array(4+hulls.reduce((sum,h)=>sum+8+h.positions.byteLength+h.indices.byteLength,0)),view=new DataView(bytes.buffer);view.setUint32(0,hulls.length,true);let offset=4;for(const h of hulls){view.setUint32(offset,h.positions.length,true);view.setUint32(offset+4,h.indices.length,true);offset+=8;bytes.set(new Uint8Array(h.positions.buffer,h.positions.byteOffset,h.positions.byteLength),offset);offset+=h.positions.byteLength;bytes.set(new Uint8Array(h.indices.buffer,h.indices.byteOffset,h.indices.byteLength),offset);offset+=h.indices.byteLength;}return sha256Hex(bytes);}
/** Serialized certificates and mutated candidate buffers require requalification. */
export async function isQualifiedCollision(prepared:PreparedCollision){const key=verified.get(prepared);return key!==undefined&&key===await collisionHash(prepared.hulls);}
export async function geometryHash(mesh:BodyMesh){const data=new Uint8Array(mesh.positions.byteLength+mesh.indices.byteLength);data.set(new Uint8Array(mesh.positions.buffer,mesh.positions.byteOffset,mesh.positions.byteLength));data.set(new Uint8Array(mesh.indices.buffer,mesh.indices.byteOffset,mesh.indices.byteLength),mesh.positions.byteLength);return sha256Hex(data);}
/** Expensive preprocessing: run in a host worker, cache by the complete mesh hash.
 * The error gate rejects approximations; it never silently substitutes an AABB
 * or single hull. Certification is geometric, not material/fit qualification. */
export async function prepareCollision(mesh:BodyMesh,kernel:GeometryKernel,options:{maxHulls?:number;volumeFraction?:number;boundsMm?:number;candidates?:ConvexPiece[]}={}):Promise<PreparedCollision>{
 if(mesh.reference||mesh.hole)throw new Error(t('Reference helpers are not physics bodies'));
 if(!Number.isFinite(mesh.volume)||mesh.volume<=0||!mesh.indices.length||mesh.indices.length>1500000||mesh.indices.length%3||mesh.positions.length%3||mesh.positions.length>750000||Array.from(mesh.positions).some(v=>!Number.isFinite(v)||Math.abs(v)>1e6)||Array.from(mesh.indices).some(i=>!Number.isInteger(i)||i<0||i>=mesh.positions.length/3))throw new Error(t('Collision mesh is empty or exceeds the geometry budget'));
 const maxHulls=options.maxHulls??2048,tolerance={volumeFraction:options.volumeFraction??.02,boundsMm:options.boundsMm??.2};
 if(!Number.isInteger(maxHulls)||maxHulls<1||maxHulls>2048||!Number.isFinite(tolerance.volumeFraction)||tolerance.volumeFraction<=0||tolerance.volumeFraction>.1||!Number.isFinite(tolerance.boundsMm)||tolerance.boundsMm<=0||tolerance.boundsMm>1)throw new Error(t('Invalid collision qualification limits'));
 const candidates=options.candidates??kernel.partitionConvex(mesh,maxHulls);for(const h of candidates)if(h.positions.length<12||h.positions.length>192||h.positions.length%3||Array.from(h.positions).some(v=>!Number.isFinite(v)||Math.abs(v)>1e6))throw new Error(t('Collision candidate violates the vertex budget'));const hulls=candidates.map(h=>kernel.isConvexPiece(h)?h:kernel.hullPoints(Array.from({length:h.positions.length/3},(_,i)=>[h.positions[i*3],h.positions[i*3+1],h.positions[i*3+2]] as [number,number,number])));if(hulls.length>maxHulls)throw new Error(t('Collision candidate exceeds the compound budget'));
 if(!hulls.length)throw new Error(t('Convex decomposition produced no collision shapes'));
 const collider=kernel.collisionCSG.measure(mesh,hulls);let boundsErrorMm=0;for(let i=0;i<3;i++)boundsErrorMm=Math.max(boundsErrorMm,Math.abs(collider.bounds.min[i]-mesh.bounds.min[i]),Math.abs(collider.bounds.max[i]-mesh.bounds.max[i]));
 // Independent differences detect BOTH missing solid and filled recesses/holes.
 // Charge volume-conservation residual to the same unchanged error budget.
 const {missingVolumeMm3,extraVolumeMm3,numericalResidualVolumeMm3}=collider,relativeError=(missingVolumeMm3+extraVolumeMm3+numericalResidualVolumeMm3)/mesh.volume;
 if(!Number.isFinite(relativeError)||relativeError>tolerance.volumeFraction||boundsErrorMm>tolerance.boundsMm)throw new Error(t`${mesh.name}: collision approximation rejected (${(relativeError*100).toFixed(2)}% volume difference, ${boundsErrorMm.toFixed(3)} mm bounds error). Supply a qualified collision assembly.`);
 const result:PreparedCollision={hulls,certificate:{sourceSHA256:await geometryHash(mesh),algorithm:'manifold-compound/v1',strategy:options.candidates?'supplied':'bsp',maxHulls,missingVolumeMm3,extraVolumeMm3,numericalResidualVolumeMm3,relativeError,boundsErrorMm,tolerance}};Object.freeze(tolerance);Object.freeze(result.certificate);for(const hull of hulls)Object.freeze(hull);Object.freeze(hulls);Object.freeze(result);verified.set(result,await collisionHash(hulls));return result;
}
