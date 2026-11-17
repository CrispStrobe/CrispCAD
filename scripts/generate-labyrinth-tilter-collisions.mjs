// SPDX-License-Identifier: BSD-3-Clause
// Generate pre-qualified low-hull-count convex collision candidates for Labyrinth 2-axis tilt maze parts.
import {identityTransform} from '../packages/core/dist/index.js';
import {labyrinthTilterPartPrograms,createLabyrinthTilterPart} from '../packages/editor/dist/labyrinth-tilter.js';
import {compactSource,generateRobotCollisionAssets} from './lib/robot-collision-candidates.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||(mode!=='--write'&&mode!=='--check')){
 throw Error('Usage: node scripts/generate-labyrinth-tilter-collisions.mjs --write|--check');
}

function evalPartExpr(part,partDocument,kernel,expression){
 const doc=partDocument(part);
 doc.nodes[part].transform=identityTransform();
 delete doc.nodes[part].physics.collisionAssembly;
 doc.nodes[part].program.source=compactSource(labyrinthTilterPartPrograms[part].source.replace(/return[^]*$/,'return '+expression+';'));
 return kernel.evaluate(doc).bodies[0];
}

function standCandidates({kernel,extrudedCandidates,simplifiedCandidates,partDocument}){
 const baseMesh=evalPartExpr('stand',partDocument,kernel,'subtract(union(base,ears,featherBay),baseBores,featherBores,wireSlot)');
 const bossMesh=evalPartExpr('stand',partDocument,kernel,'subtract(featherBosses,featherBores)');
 const pillarMesh=evalPartExpr('stand',partDocument,kernel,'subtract(pillar,pillarCuts)');
 return [
  ...extrudedCandidates(baseMesh,0,6),
  ...extrudedCandidates(bossMesh,6,9),
  ...simplifiedCandidates(pillarMesh,.08),
 ];
}

function outerRingCandidates({kernel,extrudedCandidates,simplifiedCandidates,partDocument}){
 const threeBars=evalPartExpr('outerRing',partDocument,kernel,'subtract(union(rightBar,frontBar,rearBar),innerM2Bores,reliefBores)');
 const leftBarMesh=evalPartExpr('outerRing',partDocument,kernel,'subtract(leftBar,splineSocket,screwBore,screwCs,reliefBores)');
 return [
  ...extrudedCandidates(threeBars,0,8),
  ...simplifiedCandidates(leftBarMesh,.08),
 ];
}

function mazeTrayCandidates({kernel,extrudedCandidates,partDocument}){
 const floorMesh=evalPartExpr('mazeTray',partDocument,kernel,'subtract(floor,gateBores)');
 const wallsMesh=evalPartExpr('mazeTray',partDocument,kernel,'union(north,south,west,east,baffle,cornerGuide)');
 return [
  ...extrudedCandidates(floorMesh,0,4),
  ...extrudedCandidates(wallsMesh,4,16),
 ];
}

await generateRobotCollisionAssets({
 mode,
 format:'brickwright-labyrinth-tilter-collision-candidates',
 targetPath:'packages/editor/src/robot-assets/labyrinth-tilter-collisions.json',
 partPrograms:labyrinthTilterPartPrograms,
 createPartDocument:createLabyrinthTilterPart,
 parts:['stand','outerRing','mazeTray','diverter','marble'],
 quantities:{stand:1,outerRing:1,mazeTray:1,diverter:1,marble:1},
 baseHulls:3*(490+55), // Three Adafruit micro-servo 1143 casings & shafts
 customCandidates:{
  stand:standCandidates,
  outerRing:outerRingCandidates,
  mazeTray:mazeTrayCandidates,
  marble:({simplifiedCandidates,mesh})=>simplifiedCandidates(mesh,.05),
 },
});
