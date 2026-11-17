// SPDX-License-Identifier: BSD-3-Clause
// Adafruit-derived MIT collision candidates. Every result passes the unchanged
// live source-mesh qualification; serialized certificates are informational.
import{readFileSync,writeFileSync}from'node:fs';
import Module from'manifold-3d';
import{createGeometryKernel}from'../packages/geometry/dist/index.js';
import{prepareCollision}from'../packages/physics/dist/index.js';
import{createMotorDocument}from'../packages/editor/dist/motor-models.js';
const mode=process.argv[2];if(!['--write','--check'].includes(mode)||process.argv.length!==3)throw Error('Usage: node scripts/generate-compact-motor-collisions.mjs --write|--check');
const wasmBinary=readFileSync('node_modules/manifold-3d/manifold.wasm'),M=await Module({wasmBinary});M.setup();const kernel=await createGeometryKernel({wasmBinary}),records={};
for(const id of ['tt-gearmotor','micro-servo-1143','dc-toy-motor']){
 const doc=createMotorDocument(id),geometry=kernel.evaluate(doc);records[id]={};
 for(const mesh of geometry.bodies){
  const input=new M.Mesh({numProp:3,vertProperties:new Float32Array(mesh.positions),triVerts:new Uint32Array(mesh.indices)});input.merge();const solid=new M.Manifold(input);
  try{for(const tolerance of[.5,.25,.15,.075,.025,0]){let simpler;try{
   simpler=solid.simplify(tolerance);const m=simpler.getMesh(),data={positions:new Float32Array(Array.from({length:m.numVert*3},(_,i)=>m.vertProperties[Math.floor(i/3)*m.numProp+i%3])),indices:new Uint32Array(m.triVerts)},start=performance.now(),hulls=kernel.partitionConvex(data),checked=await prepareCollision(mesh,kernel,{candidates:hulls});
   records[id][mesh.id]={simplifyMm:tolerance,certificate:checked.certificate,hulls:checked.hulls.map(h=>({positions:Array.from(h.positions),indices:Array.from(h.indices)}))};console.log(id,mesh.id,tolerance,hulls.length,checked.certificate.relativeError,checked.certificate.boundsErrorMm,performance.now()-start);break;
  }catch(e){console.log('reject',id,mesh.id,tolerance,e.message);}finally{simpler?.delete();}}}finally{solid.delete();}
 }
}
for(const id of ['tt-gearmotor','micro-servo-1143','dc-toy-motor'])for(const part of ['casing','shaft'])if(!records[id]?.[part])throw Error('No qualified candidates for '+id+' '+part);
const target='packages/editor/src/motor-assets/compact-collision-candidates.json',bytes=JSON.stringify({format:'brickwright-motor-collision-candidates',version:1,records})+'\n';
if(mode==='--write')writeFileSync(target,bytes);else if(readFileSync(target,'utf8')!==bytes)throw Error('Compact motor collision candidates differ; regenerate intentionally.');
