// SPDX-License-Identifier: BSD-3-Clause
// Generate pre-qualified low-hull-count convex collision candidates for Vortex 3-axis pinball arena parts.
import {identityTransform} from '../packages/core/dist/index.js';
import {vortexPinballPartPrograms,createVortexPinballPart} from '../packages/editor/dist/vortex-pinball.js';
import {compactSource,generateRobotCollisionAssets} from './lib/robot-collision-candidates.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||(mode!=='--write'&&mode!=='--check')){
 throw Error('Usage: node scripts/generate-vortex-pinball-collisions.mjs --write|--check');
}

function evalPartExpr(part,partDocument,kernel,expression,compact=true){
 const doc=partDocument(part);
 doc.nodes[part].transform=identityTransform();
 delete doc.nodes[part].physics.collisionAssembly;
 const src=vortexPinballPartPrograms[part].source.replace(/return[^]*$/,'return '+expression+';');
 doc.nodes[part].program.source=compact?compactSource(src):src;
 return kernel.evaluate(doc).bodies[0];
}

function arenaCandidates({kernel,extrudedCandidates,partDocument}){
 return [
  ...extrudedCandidates(evalPartExpr('arena',partDocument,kernel,'subtract(deck,cornerBores,featherBores,flipperM2Bores)'),0,6),
  ...extrudedCandidates(evalPartExpr('arena',partDocument,kernel,'subtract(union(leftWall,rightWall,topWall,bottomWall,bumper,featherBosses),cornerBores,featherBores)'),6,9),
  ...extrudedCandidates(evalPartExpr('arena',partDocument,kernel,'subtract(union(leftWall,rightWall,topWall,bottomWall,bumper),cornerBores)'),9,20),
 ];
}

await generateRobotCollisionAssets({
 mode,
 format:'brickwright-vortex-pinball-collision-candidates',
 targetPath:'packages/editor/src/robot-assets/vortex-pinball-collisions.json',
 partPrograms:vortexPinballPartPrograms,
 createPartDocument:createVortexPinballPart,
 parts:['arena','leftFlipper','rightFlipper','plunger','puck'],
 quantities:{arena:1,leftFlipper:1,rightFlipper:1,plunger:1,puck:1},
 baseHulls:2*(490+55),
 customCandidates:{
  arena:arenaCandidates,
  plunger:({kernel,extrudedCandidates,partDocument})=>extrudedCandidates(evalPartExpr('plunger',partDocument,kernel,'block'),0,14),
  puck:({kernel,extrudedCandidates,partDocument})=>extrudedCandidates(evalPartExpr('puck',partDocument,kernel,'move([0,0,7],cylinder(8,14,24))',false),0,14),
 },
});
