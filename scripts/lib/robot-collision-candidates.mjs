// SPDX-License-Identifier: BSD-3-Clause
// Deterministic convex collision candidate generator for Brickwright CAD robot parts.
// Candidates are never trusted blindly: runtime prepareCollision independently checks them
// against live Manifold CSG source meshes within volume (<= 2%) and bounds (<= 0.2 mm) tolerances.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {identityTransform} from '../../packages/core/dist/index.js';
import {createGeometryKernel} from '../../packages/geometry/dist/index.js';
import {prepareCollision} from '../../packages/physics/dist/index.js';

export function compactSource(source){
 return source
  .replace(/(cylinder\([^,]+,[^,]+,)32\)/g,'$116)')
  .replace(/(cylinder\([^,]+,[^,]+,)(?:24|20)\)/g,'$112)');
}

export async function generateRobotCollisionAssets({
 mode,
 format,
 targetPath,
 partPrograms,
 createPartDocument,
 parts,
 quantities,
 baseHulls=0,
 customCandidates,
}){
 if(mode!=='--write'&&mode!=='--check')throw Error('Expected --write or --check');
 const wasmBinary=readFileSync('node_modules/manifold-3d/manifold.wasm');
 const M=await Module({wasmBinary});
 M.setup();
 const kernel=await createGeometryKernel({wasmBinary});
 const hash=value=>createHash('sha256').update(value).digest('hex');

 const toMeshData=solid=>{
  const m=solid.getMesh();
  return {
   positions:new Float32Array(Array.from({length:m.numVert*3},(_,i)=>m.vertProperties[Math.floor(i/3)*m.numProp+i%3])),
   indices:new Uint32Array(m.triVerts),
  };
 };
 const toManifold=mesh=>{
  const m=new M.Mesh({numProp:3,vertProperties:new Float32Array(mesh.positions),triVerts:new Uint32Array(mesh.indices)});
  m.merge();
  return new M.Manifold(m);
 };
 const convexProfiles=contours=>{
  const points=contours.flat();
  const cross=(a,b,c)=>(points[b][0]-points[a][0])*(points[c][1]-points[b][1])-(points[b][1]-points[a][1])*(points[c][0]-points[b][0]);
  let polygons=M.triangulate(contours).map(tri=>cross(...tri)<0?tri.toReversed():tri);
  let changed=true;
  while(changed){
   changed=false;
   const edges=new Map(),used=new Set(),next=[];
   for(let i=0;i<polygons.length;i++)for(let j=0;j<polygons[i].length;j++)edges.set(polygons[i][j]+','+polygons[i][(j+1)%polygons[i].length],i);
   for(let i=0;i<polygons.length;i++){
    if(used.has(i))continue;
    let merged=false;
    const a=polygons[i];
    for(let j=0;j<a.length;j++){
     const neighbor=edges.get(a[(j+1)%a.length]+','+a[j]);
     if(neighbor===undefined||neighbor===i||used.has(neighbor))continue;
     const b=polygons[neighbor];
     const all=[a,b].flatMap(poly=>poly.map((u,n)=>[u,poly[(n+1)%poly.length]]));
     const boundary=all.filter(([u,v])=>!all.some(([x,y])=>x===v&&y===u));
     if(boundary.length===all.length)continue;
     const adjacency=new Map(boundary),out=[boundary[0][0]];
     while(adjacency.has(out.at(-1))){
      const v=adjacency.get(out.at(-1));
      if(v===out[0])break;
      if(out.includes(v)){out.length=0;break;}
      out.push(v);
     }
     if(out.length!==boundary.length||out.length>32||out.some((v,n)=>cross(out[(n+out.length-1)%out.length],v,out[(n+1)%out.length])<-1e-7))continue;
     next.push(out);used.add(i);used.add(neighbor);changed=merged=true;break;
    }
    if(!merged){used.add(i);next.push(a);}
   }
   polygons=next;
  }
  return polygons.map(poly=>poly.map(idx=>points[idx]));
 };

 const extrudedCandidates=(mesh,zMin=mesh.bounds.min[2],zMax=mesh.bounds.max[2])=>{
  const s=toManifold(mesh),section=s.slice((zMin+zMax)/2);
  try{
   return convexProfiles(section.toPolygons()).map(poly=>kernel.hullPoints([zMin,zMax].flatMap(z=>poly.map(([x,y])=>[x,y,z]))));
  }finally{
   section.delete();
   s.delete();
  }
 };

 const simplifiedCandidates=(mesh,tolerance)=>{
  const original=toManifold(mesh);
  let simpler;
  try{
   simpler=original.simplify(tolerance);
   return kernel.partitionConvex(toMeshData(simpler));
  }finally{
   simpler?.delete();
   original.delete();
  }
 };

 const partDocument=part=>{
  const doc=createPartDocument(part);
  doc.nodes[part].transform=identityTransform();
  delete doc.nodes[part].physics.collisionAssembly;
  return doc;
 };

 const records={};
 for(const part of parts){
  const doc=partDocument(part);
  const mesh=kernel.evaluate(doc).bodies[0];
  doc.nodes[part].program.source=compactSource(doc.nodes[part].program.source);
  const compact=kernel.evaluate(doc).bodies[0];
  const candidates=customCandidates?.[part]
   ?customCandidates[part]({kernel,extrudedCandidates,simplifiedCandidates,partDocument,mesh,compact})
   :simplifiedCandidates(compact,.05);
  const checked=await prepareCollision(mesh,kernel,{candidates});
  records[part]={
   licence:'BSD-3-Clause',
   source:{
    codeSHA256:hash(partPrograms[part].source),
    method:customCandidates?.[part]
     ?'Planar/layered 12-facet convex prism candidates, live source CSG qualification'
     :'Reduced facet count, Manifold simplify(0.05 mm), convex partition, live source CSG qualification',
   },
   certificate:checked.certificate,
   hulls:checked.hulls.map(h=>({positions:Array.from(h.positions),indices:Array.from(h.indices)})),
  };
  console.log(part,checked.hulls.length,'hulls',checked.certificate.relativeError.toFixed(5),'volume fraction',checked.certificate.boundsErrorMm.toFixed(5),'mm bounds error');
 }

 const sceneHulls=baseHulls+Object.entries(quantities).reduce((n,[id,q])=>n+q*records[id].hulls.length,0);
 if(sceneHulls>4096)throw Error(`${format} exceeds the 4096-piece scene budget: ${sceneHulls}`);
 const output={
  format,
  version:1,
  qualification:{volumeFraction:.02,boundsMm:.2,sceneHulls,recheckedAtRuntime:true},
  records,
 };
 const bytes=JSON.stringify(output)+'\n';
 if(mode==='--write'){
  mkdirSync('packages/editor/src/robot-assets',{recursive:true});
  writeFileSync(targetPath,bytes);
 }else if(readFileSync(targetPath,'utf8')!==bytes){
  throw Error(`${targetPath} collision candidates differ; regenerate intentionally.`);
 }
 console.log(sceneHulls,'total scene hulls; candidates',mode==='--write'?'written':'reproduced exactly');
}
