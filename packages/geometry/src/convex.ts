// SPDX-License-Identifier: BSD-3-Clause
// Original bounded BSP partitioner. Manifold (Apache-2.0) performs exact solid
// splits. A hull is accepted only when its added volume is below tolerance;
// nonconvex voids are never replaced by a single unqualified hull.
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
export interface ConvexPiece {positions:Float64Array;indices:Uint32Array}
export function partitionConvex(module:ManifoldToplevel,positions:ArrayLike<number>,indices:ArrayLike<number>,maxPieces=2048,maxVertices=64):ConvexPiece[]{
 if(!Number.isInteger(maxPieces)||maxPieces<1||maxPieces>2048||!Number.isInteger(maxVertices)||maxVertices<4||maxVertices>64)throw new Error('Invalid convex partition budget');
 const owned=new Set<Manifold>();const keep=(s:Manifold)=>{owned.add(s);return s;};
 try {
  const mesh=new module.Mesh({numProp:3,vertProperties:new Float32Array(positions),triVerts:new Uint32Array(indices)});mesh.merge();const source=keep(new module.Manifold(mesh));if(source.status()!=='NoError'||source.volume()<=0)throw new Error('Convex partition requires a closed positive-volume solid');
  const queue=source.decompose().map(keep),out:ConvexPiece[]=[];let steps=0;
  while(queue.length){if(++steps>maxPieces*8||out.length+queue.length>maxPieces)throw new Error('Exact convex collision exceeds its piece budget; simplify the model or supply a qualified collision assembly');
   const solid=queue.pop()!,volume=solid.volume();if(volume<=1e-5)continue;const hull=keep(solid.hull());const excess=Math.max(0,hull.volume()-volume);
   if(excess<=Math.max(1e-7,volume*1e-3)&&hull.numVert()<=maxVertices){const m=hull.getMesh();out.push({positions:new Float64Array(Array.from({length:m.numVert*3},(_,i)=>m.vertProperties[Math.floor(i/3)*m.numProp+i%3])),indices:new Uint32Array(m.triVerts)});continue;}
   const m=solid.getMesh(),points=Array.from({length:m.numVert},(_,i)=>[m.vertProperties[i*m.numProp],m.vertProperties[i*m.numProp+1],m.vertProperties[i*m.numProp+2]]);let plane:{normal:[number,number,number];offset:number}|undefined,best=-Infinity;
   if(excess>Math.max(1e-7,volume*1e-3)){
    const edges=new Map<string,{a:number[];b:number[];normal:number[];third:number[]}>();
    const key=(p:number[])=>p.map(v=>Math.round(v*1e5)).join(',');
    for(let t=0;t<m.numTri;t++) {
     const vertices=[0,1,2].map(j=>points[m.triVerts[t*3+j]]),[a,b,c]=vertices,u=b.map((v,i)=>v-a[i]),v=c.map((value,i)=>value-a[i]),raw=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...raw);if(len<1e-12)continue;const n=raw.map(x=>x/len);
     for(let e=0;e<3;e++) {
      const aa=vertices[e],bb=vertices[(e+1)%3],third=vertices[(e+2)%3],keys=[key(aa),key(bb)].sort(),edgeKey=keys.join('|'),other=edges.get(edgeKey);
      if(!other){edges.set(edgeKey,{a:aa,b:bb,normal:n,third});continue;}
      // An adjacent face's third vertex lies in front of this face only at a
      // concave edge. Bisect THROUGH the edge, not along its supporting face.
      if(n.reduce((sum,x,i)=>sum+x*(other.third[i]-aa[i]),0)<=1e-5)continue;
      const direction=bb.map((x,i)=>x-aa[i]),mean=n.map((x,i)=>x+other.normal[i]),cross=[direction[1]*mean[2]-direction[2]*mean[1],direction[2]*mean[0]-direction[0]*mean[2],direction[0]*mean[1]-direction[1]*mean[0]],length=Math.hypot(...cross);if(length<1e-10)continue;const normal=cross.map(x=>x/length) as [number,number,number],offset=normal.reduce((sum,x,i)=>sum+x*aa[i],0);let pos=0,neg=0;for(const p of points){const distance=p.reduce((sum,x,i)=>sum+x*normal[i],-offset);if(distance>1e-5)pos++;if(distance< -1e-5)neg++;}const score=Math.min(pos,neg)/(points.length||1);if(pos&&neg&&score>best){best=score;plane={normal,offset};}
     }
    }
   }
   if(!plane){const b=solid.boundingBox(),sizes=b.max.map((v,i)=>v-b.min[i]),axis=sizes.indexOf(Math.max(...sizes));const normal:[number,number,number]=[0,0,0];normal[axis]=1;plane={normal,offset:(b.max[axis]+b.min[axis])/2};}
   let [a,b]=solid.splitByPlane(plane.normal,plane.offset).map(keep);
   if(a.isEmpty()||b.isEmpty()||Math.max(a.volume(),b.volume())>volume*(1-1e-9)){const bounds=solid.boundingBox(),sizes=bounds.max.map((value,i)=>value-bounds.min[i]),axis=sizes.indexOf(Math.max(...sizes)),normal:[number,number,number]=[0,0,0];normal[axis]=1;[a,b]=solid.splitByPlane(normal,(bounds.max[axis]+bounds.min[axis])/2).map(keep);}
   if(a.isEmpty()||b.isEmpty()||Math.max(a.volume(),b.volume())>volume*(1-1e-9))throw new Error('Exact convex collision could not partition this feature robustly');queue.push(...a.decompose().map(keep),...b.decompose().map(keep));
  }
  return out;
 }finally{for(const s of [...owned].reverse())s.delete();}
}
