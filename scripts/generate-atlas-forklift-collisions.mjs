// SPDX-License-Identifier: BSD-3-Clause
// Generate pre-qualified convex collision candidates for Atlas forklift rover parts.
import {identityTransform} from '../packages/core/dist/index.js';
import {atlasForkliftPartPrograms,createAtlasForkliftPart} from '../packages/editor/dist/atlas-forklift.js';
import {compactSource,generateRobotCollisionAssets} from './lib/robot-collision-candidates.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||(mode!=='--write'&&mode!=='--check')){
 throw Error('Usage: node scripts/generate-atlas-forklift-collisions.mjs --write|--check');
}

function evalPartExpr(part,partDocument,kernel,expression,compact=true){
 const doc=partDocument(part);
 doc.nodes[part].transform=identityTransform();
 delete doc.nodes[part].physics.collisionAssembly;
 const src=atlasForkliftPartPrograms[part].source.replace(/return[^]*$/,'return '+expression+';');
 doc.nodes[part].program.source=compact?compactSource(src):src;
 return kernel.evaluate(doc).bodies[0];
}

function chassisCandidates({kernel,extrudedCandidates,partDocument}){
 return [
  ...extrudedCandidates(evalPartExpr('chassis',partDocument,kernel,'rearSkid'),-13.5,0),
  ...extrudedCandidates(evalPartExpr('chassis',partDocument,kernel,'subtract(plate,ttBores,featherBores,mastBores,deckCutouts)'),0,4),
  ...extrudedCandidates(evalPartExpr('chassis',partDocument,kernel,'subtract(featherBosses,featherBores)'),4,7),
 ];
}

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


function wheelCandidates({kernel,extrudedCandidates,partDocument}){
 return [
  ...extrudedCandidates(evalPartExpr('wheel',partDocument,kernel,'subtract(move([0,0,4],cylinder(30,8,24)),move([0,0,4],box(5.6,3.9,14)),spokes)',false),0,8),
  ...extrudedCandidates(evalPartExpr('wheel',partDocument,kernel,'subtract(hub,move([0,0,10],box(5.6,3.9,16)))'),8,14),
 ];
}

function cradleCandidates({kernel,extrudedCandidates,partDocument}){
 return [
  ...extrudedCandidates(evalPartExpr('cradle',partDocument,kernel,'subtract(foot,mountBores)'),0,2.8),
  ...extrudedCandidates(evalPartExpr('cradle',partDocument,kernel,'union(rails,stop)'),2.8,8.8),
 ];
}

function mastCandidates({kernel,extrudedCandidates,partDocument}){
 return [
  ...extrudedCandidates(evalPartExpr('mast',partDocument,kernel,'subtract(union(flange,leftRail,rightRail,midBrace,topBar),railSlots,topBores)'),0,4),
  ...extrudedCandidates(evalPartExpr('mast',partDocument,kernel,'subtract(union(flange,leftRail,rightRail,topBar),railSlots,topBores)'),4,8),
  ...extrudedCandidates(evalPartExpr('mast',partDocument,kernel,'flange'),8,14),
 ];
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
  wheel:wheelCandidates,
  crate:crateCandidates,
  cradle:cradleCandidates,
  mast:mastCandidates,
  forks:forksCandidates,
  carriage:({simplifiedCandidates,compact})=>simplifiedCandidates(compact,.08),
 },
});
