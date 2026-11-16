// SPDX-License-Identifier: BSD-3-Clause
// Deterministic candidates, not trusted certificates. Runtime always compares
// these compounds with the current full-resolution source geometry again.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {createDocument,identityTransform} from '../packages/core/dist/index.js';
import {createGeometryKernel} from '../packages/geometry/dist/index.js';
import {prepareCollision} from '../packages/physics/dist/index.js';
import {createTTRoverDocument,createTTRoverPart,ttRoverPartPrograms} from '../packages/editor/dist/tt-rover.js';
import {createMotorDocument} from '../packages/editor/dist/motor-models.js';

const args=process.argv.slice(2);if(args.length!==1||!['--write','--check'].includes(args[0]))throw Error('Usage: node scripts/generate-tt-rover-collisions.mjs --write|--check');
const wasmBinary=readFileSync('node_modules/manifold-3d/manifold.wasm'),M=await Module({wasmBinary});M.setup();
const kernel=await createGeometryKernel({wasmBinary}),hash=value=>createHash('sha256').update(value).digest('hex');
const data=solid=>{const m=solid.getMesh();return {positions:new Float32Array(Array.from({length:m.numVert*3},(_,i)=>m.vertProperties[Math.floor(i/3)*m.numProp+i%3])),indices:new Uint32Array(m.triVerts)};};
const solid=mesh=>{const m=new M.Mesh({numProp:3,vertProperties:new Float32Array(mesh.positions),triVerts:new Uint32Array(mesh.indices)});m.merge();return new M.Manifold(m);};

// Coarser collision sampling preserves the holes, socket and clamp slit.
// The printer always receives the original higher-resolution CodeProgram.
function compactSource(source,part){return part==='carrier'?source.replace(/,16\)/g,',12)'):part==='standoff'?source.replace(/,32\)/g,',24)'):source.replace(/sphere\(7,32\)/g,'sphere(7,24)').replace(/cylinder\(7,8,32\)/g,'cylinder(7,8,24)').replace(/,32\)/g,',12)').replace(/,48\)/g,',24)');}
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
function extrudedCandidates(mesh){const s=solid(mesh),section=s.slice((mesh.bounds.min[2]+mesh.bounds.max[2])/2);try{return convexProfiles(section.toPolygons()).map(poly=>kernel.hullPoints([mesh.bounds.min[2],mesh.bounds.max[2]].flatMap(z=>poly.map(([x,y])=>[x,y,z]))));}finally{section.delete();s.delete();}}
function radialCandidates(profile,segments){const polygons=convexProfiles(profile.toPolygons()),pieces=[];for(let i=0;i<segments;i++)for(const polygon of polygons)pieces.push(kernel.hullPoints([i,i+1].flatMap(j=>polygon.map(([r,z])=>[r*Math.cos(j*2*Math.PI/segments),r*Math.sin(j*2*Math.PI/segments),z]))));return pieces;}
function partDocument(part){const doc=createTTRoverPart(part);doc.nodes[part].transform=identityTransform();delete doc.nodes[part].physics.collisionAssembly;return doc;}
function wheelCandidates(){
 const owned=[],keep=s=>(owned.push(s),s),rect=(r0,r1,z0,z1)=>keep(new M.CrossSection([[[r0,z0],[r1,z0],[r1,z1],[r0,z1]]]));
 try{const disc=rect(0,30,0,3),rim=rect(25,30,0,8),base=keep(disc.add(rim)),circle=keep(M.CrossSection.circle(1.5,12)),first=keep(circle.translate([30,2])),second=keep(circle.translate([30,6])),cut=keep(base.subtract(first)),profile=keep(cut.subtract(second)),ring=radialCandidates(profile,32);
  const evaluate=expression=>{const doc=partDocument('wheel');doc.nodes.wheel.program.source=compactSource(ttRoverPartPrograms.wheel.source.replace(/return[^]*$/,'return '+expression+';'),'wheel');return kernel.evaluate(doc).bodies[0];};
  const coreBase=['hub','ears'].flatMap(expression=>kernel.partitionConvex(evaluate(expression))),core=kernel.collisionCSG.subtract(coreBase,[evaluate('union(socket,slit,clamp,nut)')]);return [...ring,...core];
 }finally{owned.reverse().forEach(s=>s.delete());}
}
function simplifiedCandidates(mesh,tolerance){const original=solid(mesh);let simpler;try{simpler=original.simplify(tolerance);return kernel.partitionConvex(data(simpler));}finally{simpler?.delete();original.delete();}}
function carrierCandidates(){
 // The plate and six bored bosses are prisms. Convex planar sections avoid
 // spending hundreds of tetrahedra on their constant-height regions; actual
 // conical screw seats are cut afterwards and remain part of the live check.
 const evaluate=expression=>{const doc=partDocument('carrier');doc.nodes.carrier.program.source=compactSource(ttRoverPartPrograms.carrier.source.replace(/return[^]*$/,'return '+expression+';'),'carrier');return kernel.evaluate(doc).bodies[0];};
 const base=extrudedCandidates(evaluate('subtract(plate,boardBores,deckBores)'));
 const bosses=extrudedCandidates(evaluate('subtract(bosses,boardBores)'));
 return [...kernel.collisionCSG.subtract(base,[evaluate('union(undersideHeads,deckHeads)')]),...bosses];
}

const records={};
async function record(id,mesh,candidates,source,licence='BSD-3-Clause'){
 const checked=await prepareCollision(mesh,kernel,{candidates});records[id]={licence,source,certificate:checked.certificate,hulls:checked.hulls.map(h=>({positions:Array.from(h.positions),indices:Array.from(h.indices)}))};
 console.log(id,checked.hulls.length,'hulls',checked.certificate.relativeError,'volume fraction',checked.certificate.boundsErrorMm,'mm bounds error');
}
for(const part of ['chassis','cradle','wheel','deck','standoff','skid','carrier']){
 const doc=partDocument(part),mesh=kernel.evaluate(doc).bodies[0];doc.nodes[part].program.source=compactSource(doc.nodes[part].program.source,part);const compact=kernel.evaluate(doc).bodies[0];
 const candidates=part==='wheel'?wheelCandidates():part==='carrier'?carrierCandidates():['chassis','deck','standoff'].includes(part)?extrudedCandidates(compact):kernel.partitionConvex(compact);
 await record(part,mesh,candidates,{codeSHA256:hash(ttRoverPartPrograms[part].source),method:part==='wheel'?'32 radial sectors; retained socket, slit and bolt cuts':part==='carrier'?'12-facet planar prism sections for plate and annular bosses; conical screw-seat CSG; live 16-facet source qualification':'Reduced facet count; retained manufacturing cuts'});
}
const motor=createMotorDocument('tt-gearmotor'),motorGeometry=kernel.evaluate(motor);
for(const id of ['casing','shaft']){const mesh=motorGeometry.bodies.find(b=>b.id===id),tolerance=id==='shaft'?.02:.05;await record(id,mesh,simplifiedCandidates(mesh,tolerance),{asset:'adafruit-tt-gearmotor',original:structuredClone(motor.provenance.records[0].asset.original),method:`Manifold simplify(${tolerance} mm), convex decomposition, current-source CSG qualification`},'MIT');}
const assembly=createTTRoverDocument(),tire=structuredClone(assembly.nodes['left-tire-0']),tireDoc=createDocument();tireDoc.version=8;tire.id='tire';tire.transform=identityTransform();delete tire.physics.collisionAssembly;tireDoc.nodes={tire};tireDoc.roots=['tire'];
const circle=M.CrossSection.circle(1.5,12),profile=circle.translate([30,0]);try{await record('tire',kernel.evaluate(tireDoc).bodies[0],radialCandidates(profile,64),{codeSHA256:hash(tire.program.source),method:'64 convex angular sectors of the original 12-sided minor profile'});}finally{profile.delete();circle.delete();}
const quantities={chassis:1,cradle:2,wheel:2,deck:1,standoff:4,skid:1,carrier:1,casing:2,shaft:2,tire:4},sceneHulls=3+Object.entries(quantities).reduce((n,[id,q])=>n+q*records[id].hulls.length,0);
if(sceneHulls>4096)throw Error('Rover exceeds the unchanged 4096-piece scene budget: '+sceneHulls);
const output={format:'brickwright-rover-collision-candidates',version:1,qualification:{volumeFraction:.02,boundsMm:.2,sceneHulls,recheckedAtRuntime:true},records},target='packages/editor/src/robot-assets/tt-rover-collisions.json',bytes=JSON.stringify(output)+'\n';
if(args[0]==='--write'){mkdirSync('packages/editor/src/robot-assets',{recursive:true});writeFileSync(target,bytes);}else if(readFileSync(target,'utf8')!==bytes)throw Error('Rover collision candidates differ; regenerate intentionally.');
console.log(sceneHulls,'total scene hulls; candidates',args[0]==='--write'?'written':'reproduced exactly');
