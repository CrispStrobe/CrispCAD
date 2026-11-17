// SPDX-License-Identifier: BSD-3-Clause
// Deterministic candidates, not trusted certificates. Runtime always compares
// these compounds with the current full-resolution source geometry again.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {identityTransform} from '../packages/core/dist/index.js';
import {createGeometryKernel} from '../packages/geometry/dist/index.js';
import {prepareCollision} from '../packages/physics/dist/index.js';
import {createMantisWalkerPart,mantisWalkerPartPrograms} from '../packages/editor/dist/mantis-walker.js';

const args=process.argv.slice(2);
if(args.length!==1||!['--write','--check'].includes(args[0]))throw Error('Usage: node scripts/generate-mantis-walker-collisions.mjs --write|--check');
const wasmBinary=readFileSync('node_modules/manifold-3d/manifold.wasm'),M=await Module({wasmBinary});M.setup();
const kernel=await createGeometryKernel({wasmBinary}),hash=value=>createHash('sha256').update(value).digest('hex');
const data=solid=>{const m=solid.getMesh();return {positions:new Float32Array(Array.from({length:m.numVert*3},(_,i)=>m.vertProperties[Math.floor(i/3)*m.numProp+i%3])),indices:new Uint32Array(m.triVerts)};};
const solid=mesh=>{const m=new M.Mesh({numProp:3,vertProperties:new Float32Array(mesh.positions),triVerts:new Uint32Array(mesh.indices)});m.merge();return new M.Manifold(m);};

function compactSource(source){
 return source.replace(/,32\)/g,',16)').replace(/,24\)/g,',12)').replace(/,20\)/g,',12)');
}
function convexProfiles(contours){
 const points=contours.flat(),cross=(a,b,c)=>(points[b][0]-points[a][0])*(points[c][1]-points[b][1])-(points[b][1]-points[a][1])*(points[c][0]-points[b][0]);
 let polygons=M.triangulate(contours).map(t=>cross(...t)<0?t.toReversed():t),changed=true;
 while(changed){changed=false;const edges=new Map(),used=new Set(),next=[];
  for(let i=0;i<polygons.length;i++)for(let j=0;j<polygons[i].length;j++)edges.set(polygons[i][j]+','+polygons[i][(j+1)%polygons[i].length],i);
  for(let i=0;i<polygons.length;i++){if(used.has(i))continue;let merged=false;const a=polygons[i];
   for(let j=0;j<a.length;j++){const neighbor=edges.get(a[(j+1)%a.length]+','+a[j]);if(neighbor===undefined||neighbor===i||used.has(neighbor))continue;
    const b=polygons[neighbor],all=[a,b].flatMap(p=>p.map((u,n)=>[u,p[(n+1)%p.length]])),boundary=all.filter(([u,v])=>!all.some(([x,y])=>x===v&&y===u));if(boundary.length===all.length)continue;
    const adjacency=new Map(boundary),out=[boundary[0][0]];while(adjacency.has(out.at(-1))){const v=adjacency.get(out.at(-1));if(v===out[0])break;if(out.includes(v)){out.length=0;break;}out.push(v);}
    if(out.length!==boundary.length||out.length>32||out.some((v,n)=>cross(out[(n+out.length-1)%out.length],v,out[(n+1)%out.length])< -1e-7))continue;
    next.push(out);used.add(i);used.add(neighbor);changed=merged=true;break;
   }if(!merged){used.add(i);next.push(a);}
  }polygons=next;
 }return polygons.map(p=>p.map(i=>points[i]));
}
function extrudedCandidates(mesh,zMin=mesh.bounds.min[2],zMax=mesh.bounds.max[2]){
 const s=solid(mesh),section=s.slice((zMin+zMax)/2);
 try{return convexProfiles(section.toPolygons()).map(poly=>kernel.hullPoints([zMin,zMax].flatMap(z=>poly.map(([x,y])=>[x,y,z]))));}
 finally{section.delete();s.delete();}
}
function simplifiedCandidates(mesh,tolerance){
 const original=solid(mesh);let simpler;
 try{simpler=original.simplify(tolerance);return kernel.partitionConvex(data(simpler));}
 finally{simpler?.delete();original.delete();}
}
function partDocument(part){
 const doc=createMantisWalkerPart(part);
 doc.nodes[part].transform=identityTransform();
 delete doc.nodes[part].physics.collisionAssembly;
 return doc;
}
function carrierCandidates(){
 const evaluate=expression=>{
  const doc=partDocument('carrier');
  doc.nodes.carrier.program.source=compactSource(mantisWalkerPartPrograms.carrier.source.replace(/return[^]*$/,'return '+expression+';'));
  return kernel.evaluate(doc).bodies[0];
 };
 return [
  ...extrudedCandidates(evaluate('subtract(legs,mountBores)'),0,2),
  ...extrudedCandidates(evaluate('subtract(plate,mountBores,boardBores,wireSlot)'),2,5),
  ...extrudedCandidates(evaluate('subtract(bosses,boardBores)'),5,7.5),
 ];
}

const records={};
async function record(id,mesh,candidates,source,licence='BSD-3-Clause'){
 const checked=await prepareCollision(mesh,kernel,{candidates});
 records[id]={licence,source,certificate:checked.certificate,hulls:checked.hulls.map(h=>({positions:Array.from(h.positions),indices:Array.from(h.indices)}))};
 console.log(id,checked.hulls.length,'hulls',checked.certificate.relativeError.toFixed(5),'volume fraction',checked.certificate.boundsErrorMm.toFixed(5),'mm bounds error');
}

for(const part of ['torso','leg','pendulum','carrier']){
 const doc=partDocument(part),mesh=kernel.evaluate(doc).bodies[0];
 doc.nodes[part].program.source=compactSource(doc.nodes[part].program.source);
 const compact=kernel.evaluate(doc).bodies[0];
 const candidates=part==='carrier'?carrierCandidates():simplifiedCandidates(compact,.05);
 await record(part,mesh,candidates,{codeSHA256:hash(mantisWalkerPartPrograms[part].source),method:part==='carrier'?'12-facet planar prism layers for legs, plate, and Feather bosses':'Reduced facet count, Manifold simplify(0.05 mm), convex partition, live source CSG qualification'});
}

const quantities={torso:1,leg:2,pendulum:1,carrier:1};
const sceneHulls=2+Object.entries(quantities).reduce((n,[id,q])=>n+q*records[id].hulls.length,0);
if(sceneHulls>4096)throw Error('Mantis walker exceeds the unchanged 4096-piece scene budget: '+sceneHulls);
const output={format:'brickwright-mantis-walker-collision-candidates',version:1,qualification:{volumeFraction:.02,boundsMm:.2,sceneHulls,recheckedAtRuntime:true},records};
const target='packages/editor/src/robot-assets/mantis-walker-collisions.json',bytes=JSON.stringify(output)+'\n';
if(args[0]==='--write'){mkdirSync('packages/editor/src/robot-assets',{recursive:true});writeFileSync(target,bytes);}
else if(readFileSync(target,'utf8')!==bytes)throw Error('Mantis walker collision candidates differ; regenerate intentionally.');
console.log(sceneHulls,'total scene hulls; candidates',args[0]==='--write'?'written':'reproduced exactly');
