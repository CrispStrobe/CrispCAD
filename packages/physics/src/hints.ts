// SPDX-License-Identifier: BSD-3-Clause
import { documentGeometryKey, validateDocument } from '@brickwright/cad-core';
import type {CadDocument,Vec3,Transform} from '@brickwright/cad-core';
import type {GeometryKernel,GeometryResult} from '@brickwright/cad-geometry';
import {prepareCollision} from './collision.js';
import type {ConvexPiece,PreparedCollision} from './collision.js';
function point(p:Vec3,t:Transform):Vec3 {let [x,y,z]=p.map((v,i)=>v*t.scale[i]);for(let i=0;i<3;i++){const a=t.rotation[i]*Math.PI/180,c=Math.cos(a),s=Math.sin(a);if(i===0)[y,z]=[c*y-s*z,s*y+c*z];if(i===1)[x,z]=[c*x+s*z,-s*x+c*z];if(i===2)[x,y]=[c*x-s*y,s*x+c*y];}return [x+t.position[0],y+t.position[1],z+t.position[2]];}
function triangulate(profile:number[][]):number[][] {
 const ids=profile.map((_,i)=>i);if(Math.hypot(...profile[0].map((v,i)=>v-profile.at(-1)![i]))<1e-6)ids.pop();
 const cross=(a:number,b:number,c:number)=>(profile[b][0]-profile[a][0])*(profile[c][1]-profile[a][1])-(profile[b][1]-profile[a][1])*(profile[c][0]-profile[a][0]);
 const area=ids.reduce((s,a,i)=>{const b=ids[(i+1)%ids.length];return s+profile[a][0]*profile[b][1]-profile[b][0]*profile[a][1];},0);if(area<0)ids.reverse();
 const result:number[][]=[];let attempts=0;
 while(ids.length>3){if(++attempts>profile.length**2)throw new Error('Could not triangulate radial collision profile');let cut=false;for(let i=0;i<ids.length;i++){const a=ids[(i+ids.length-1)%ids.length],b=ids[i],c=ids[(i+1)%ids.length],turn=cross(a,b,c);if(Math.abs(turn)<1e-7){ids.splice(i,1);cut=true;break;}if(turn<0)continue;if(ids.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)>=-1e-7&&cross(b,c,p)>=-1e-7&&cross(c,a,p)>=-1e-7))continue;result.push([a,b,c]);ids.splice(i,1);cut=true;break;}if(!cut)throw new Error('Radial profile is not a simple polygon');}
 if(ids.length===3)result.push([...ids]);
 // Merge adjacent triangles only when their combined profile stays convex.
 // This keeps thin vessel walls accurate without spending a hull per triangle.
 let changed=true;while(changed){changed=false;outer:for(let a=0;a<result.length;a++)for(let b=a+1;b<result.length;b++){
  const edges=[result[a],result[b]].flatMap(poly=>poly.map((v,i)=>[v,poly[(i+1)%poly.length]]));const boundary=edges.filter(([u,v])=>!edges.some(([x,y])=>x===v&&y===u));if(boundary.length===edges.length||boundary.length>32)continue;
  const next=new Map(boundary.map(([u,v])=>[u,v])),poly=[boundary[0][0]];while(next.has(poly.at(-1)!)){const v=next.get(poly.at(-1)!)!;if(v===poly[0])break;if(poly.includes(v)){poly.length=0;break;}poly.push(v);}if(poly.length!==boundary.length||poly.some((v,i)=>cross(v,poly[(i+1)%poly.length],poly[(i+2)%poly.length])< -1e-7))continue;result[a]=poly;result.splice(b,1);changed=true;break outer;
 }}return result;
}
/** Candidate generation follows the retained construction graph, so a union
 * keeps its useful convex parts and a cutter is applied to those parts before
 * final qualification. Nothing bypasses the current source-mesh CSG gate. */
export async function prepareDocumentCollisions(input:CadDocument,result:GeometryResult,kernel:GeometryKernel):Promise<Map<string,PreparedCollision>>{
 const doc=validateDocument(input);if(result.sourceKey!==documentGeometryKey(doc))throw new Error('Geometry is stale for collision preparation');const prepared=new Map<string,PreparedCollision>();
 const localCache=new Map<string,import('@brickwright/cad-geometry').BodyMesh>();
 const worldPoint=(p:Vec3,transforms:Transform[])=>transforms.reduceRight((value,t)=>point(value,t),p);
 function worldMesh(id:string,parents:Transform[]){let body=localCache.get(id);if(!body){const nodes:CadDocument['nodes']={};const visit=(key:string)=>{if(nodes[key])return;const n=doc.nodes[key];nodes[key]=n;if(n.kind==='boolean')n.inputs.forEach(visit);};visit(id);body=kernel.evaluate({...doc,nodes,roots:[id],joints:undefined,parametric:doc.parametric?{...doc.parametric,bindings:doc.parametric.bindings.filter(b=>Object.hasOwn(nodes,b.nodeId))}:undefined}).bodies[0];localCache.set(id,body);}if(!parents.length)return body;const positions=new Float32Array(body.positions.length),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i+=3){const p=worldPoint([body.positions[i],body.positions[i+1],body.positions[i+2]],parents);for(let j=0;j<3;j++){positions[i+j]=p[j];min[j]=Math.min(min[j],p[j]);max[j]=Math.max(max[j],p[j]);}}return {...body,positions,bounds:{min,max}};}
 function candidatesFor(id:string,parents:Transform[]):ConvexPiece[]{
  const node=doc.nodes[id],hint=node.physics?.collisionHint;
  if(node.kind==='boolean'&&node.operation==='union'){const pieces=node.inputs.flatMap(child=>candidatesFor(child,[...parents,node.transform]));if(pieces.length>2048)throw new Error('Construction collision exceeds its compound budget');return pieces;}
  if(node.kind==='boolean'&&node.operation==='subtract'){const transforms=[...parents,node.transform],base=candidatesFor(node.inputs[0],transforms),cuts=node.inputs.slice(1).map(child=>worldMesh(child,transforms));const seeded=node.physics?.sourcePreset==='nut'?kernel.collisionCSG.grid(candidatesFor(node.inputs[0],[])).map(piece=>{const positions=new Float64Array(piece.positions.length);for(let i=0;i<positions.length;i+=3){const p=worldPoint([piece.positions[i],piece.positions[i+1],piece.positions[i+2]],transforms);positions.set(p,i);}return {...piece,positions};}):base;return kernel.collisionCSG.subtract(seeded,cuts);}
  if(node.kind==='mesh'&&node.physics?.sourcePreset==='bent-tube'){
   const points=(theta:number,phi:number,radius:number):Vec3=>[(20+radius*Math.cos(phi))*Math.cos(theta),(20+radius*Math.cos(phi))*Math.sin(theta),radius*Math.sin(phi)];const pieces:ConvexPiece[]=[];
   for(let i=0;i<12;i++)for(let j=0;j<32;j++){const vertices:Vec3[]=[];for(const step of [i,i+.5,i+1])for(const side of [j,j+1])for(const radius of [3,5])vertices.push(worldPoint(points(step/12*Math.PI/2,side/32*Math.PI*2,radius),[...parents,node.transform]));pieces.push(kernel.hullPoints(vertices));}return pieces;
  }
  if(hint&&node.kind==='mesh'){
   const stride=hint.stride??1,perSide=hint.sides+(hint.seam===false?0:1),at=(ring:number,side:number):Vec3=>{const i=hint.layout==='rows'?ring*perSide+side:side*(hint.segments+1)+ring;return [node.positions[i*3],node.positions[i*3+1],node.positions[i*3+2]];},transforms=[...parents,node.transform],pieces:ConvexPiece[]=[];
   if(hint.kind==='tube-grid')for(let ring=0;ring<hint.segments;ring+=stride){const points:Vec3[]=[];for(let r=ring;r<=Math.min(hint.segments,ring+stride);r++)for(let side=0;side<hint.sides;side++)points.push(worldPoint(at(r,side),transforms));pieces.push(kernel.hullPoints(points));}
   else {const profile=Array.from({length:hint.sides+1},(_,i)=>{const p=at(0,i);return [Math.hypot(p[0],p[1]),p[2]];}),polygons=triangulate(profile),step=Math.max(1,Math.ceil(hint.segments*polygons.length/2048));for(let ring=0;ring<hint.segments;ring+=step)for(const polygon of polygons){const points:Vec3[]=[];for(const r of [ring,Math.min(hint.segments,ring+step)])for(const side of polygon)points.push(worldPoint(at(r,side),transforms));pieces.push(kernel.hullPoints(points));}}
   return pieces;
  }
  return kernel.partitionConvex(worldMesh(id,parents));
 }
 for(const mesh of result.bodies.filter(b=>!b.reference)){try{prepared.set(mesh.id,await prepareCollision(mesh,kernel,{candidates:candidatesFor(mesh.id,[])}));}catch(first){try{prepared.set(mesh.id,await prepareCollision(mesh,kernel));}catch(second){throw new Error(`${mesh.name}: source construction failed (${first instanceof Error?first.message:String(first)}); whole-mesh preparation also failed. ${second instanceof Error?second.message:String(second)}`);}}}
 return prepared;
}
