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

function crateCandidates({kernel,extrudedCandidates,partDocument}){
 return [
  ...extrudedCandidates(evalPartExpr('crate',partDocument,kernel,'subtract(deck,tieBores)'),0,22),
  ...extrudedCandidates(evalPartExpr('crate',partDocument,kernel,'union(skidL,skidC,skidR)'),22,35),
 ];
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

function forksCandidates({kernel,extrudedCandidates,simplifiedCandidates,partDocument}){
 const spineMesh=evalPartExpr('forks',partDocument,kernel,'subtract(spine,backrestWindows)');
 const earMesh=evalPartExpr('forks',partDocument,kernel,'ear');
 const leftTineMesh=evalPartExpr('forks',partDocument,kernel,'subtract(leftTine,tipBevels)');
 const rightTineMesh=evalPartExpr('forks',partDocument,kernel,'subtract(rightTine,tipBevels)');
 return [
  ...extrudedCandidates(spineMesh,0,9),
  ...extrudedCandidates(spineMesh,9,19),
  ...extrudedCandidates(spineMesh,19,24),
  ...extrudedCandidates(earMesh,15,24),
  ...simplifiedCandidates(leftTineMesh,.05),
  ...simplifiedCandidates(rightTineMesh,.05),
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
 baseHulls:2*(782+140)+(490+55)+4*16, // Twin TT motors (casing+shaft), tilt MG90S (casing+shaft), and 4 O-ring tires
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
