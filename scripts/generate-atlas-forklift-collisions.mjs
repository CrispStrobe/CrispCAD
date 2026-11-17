// SPDX-License-Identifier: BSD-3-Clause
// Generate pre-qualified convex collision candidates for Atlas forklift rover parts.
import {atlasForkliftPartPrograms,createAtlasForkliftPart} from '../packages/editor/dist/atlas-forklift.js';
import {compactSource,generateRobotCollisionAssets} from './lib/robot-collision-candidates.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||(mode!=='--write'&&mode!=='--check')){
 throw Error('Usage: node scripts/generate-atlas-forklift-collisions.mjs --write|--check');
}

function chassisCandidates({kernel,extrudedCandidates,partDocument}){
 const evalExpr=expression=>{
  const doc=partDocument('chassis');
  doc.nodes.chassis.program.source=compactSource(atlasForkliftPartPrograms.chassis.source.replace(/return[^]*$/,'return '+expression+';'));
  return kernel.evaluate(doc).bodies[0];
 };
 return [
  ...extrudedCandidates(evalExpr('rearSkid'),-13.5,0),
  ...extrudedCandidates(evalExpr('subtract(plate,ttBores,featherBores,mastBores,deckCutouts)'),0,4),
  ...extrudedCandidates(evalExpr('subtract(featherBosses,featherBores)'),4,7),
 ];
}

// Decompose by manufacturing layers rather than slicing these mostly planar
// parts into dozens of BSP slivers. Each result still passes live source CSG.
function expressionMesh(part,expression,context,rotation){
 const doc=context.partDocument(part);
 const result=rotation?`rotate([${rotation}],${expression})`:expression;
 doc.nodes[part].program.source=compactSource(atlasForkliftPartPrograms[part].source.replace(/return[^]*$/,'return '+result+';'));
 return context.kernel.evaluate(doc).bodies[0];
}
function alongY(part,expression,layers,context){
 const mesh=expressionMesh(part,expression,context,'90,0,0');
 return layers.flatMap(([min,max])=>context.extrudedCandidates(mesh,min,max)).map(piece=>({
  positions:new Float32Array(Array.from(piece.positions).flatMap((_,i)=>i%3===0?[piece.positions[i],piece.positions[i+2],-piece.positions[i+1]]:[])),indices:new Uint32Array(piece.indices),
 }));
}
function forksCandidates(context){
 const spine=expressionMesh('forks','subtract(spine,backrestWindows)',context,'0,90,0');
 const main=context.extrudedCandidates(spine,-6,0).map(piece=>({
  positions:new Float32Array(Array.from(piece.positions).flatMap((_,i)=>i%3===0?[-piece.positions[i+2],piece.positions[i+1],piece.positions[i]]:[])),indices:new Uint32Array(piece.indices),
 }));
 return [
  ...main,
  ...alongY('forks','subtract(ear,splineSocket,screwBore,screwCs)',[[-21,-19],[-19,-18.9],[-18.9,-16.5]],context),
  ...alongY('forks','subtract(union(leftTine,rightTine),tipBevels)',[[-18,-10],[10,18]],context),
 ];
}
function crateCandidates(context){
 const mesh=expressionMesh('crate','subtract(body,cargoPocket,sideSlots)',context);
 return [[0,6.5],[6.5,8],[8,14],[14,22],[22,35]].flatMap(([min,max])=>context.extrudedCandidates(mesh,min,max));
}

await generateRobotCollisionAssets({
 mode,
 format:'brickwright-atlas-forklift-collision-candidates',
 targetPath:'packages/editor/src/robot-assets/atlas-forklift-collisions.json',
 partPrograms:atlasForkliftPartPrograms,
 createPartDocument:createAtlasForkliftPart,
 parts:['chassis','cradle','wheel','mast','carriage','forks','crate'],
 quantities:{chassis:1,cradle:2,wheel:2,mast:1,carriage:1,forks:1,crate:1},
 baseHulls:2*(464+127)+(304+32)+4*16, // Twin TT motors (casing+shaft), tilt MG90S (casing+shaft), and 4 O-ring tires
 customCandidates:{
  chassis:chassisCandidates,
  forks:forksCandidates,
  crate:crateCandidates,
  wheel:({simplifiedCandidates,mesh})=>simplifiedCandidates(mesh,.05),
 },
});
