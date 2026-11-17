// SPDX-License-Identifier: BSD-3-Clause
// Generate pre-qualified low-hull-count convex collision candidates for Orion 3-axis sorting carousel parts.
import {identityTransform} from '../packages/core/dist/index.js';
import {orionCarouselPartPrograms,createOrionCarouselPart} from '../packages/editor/dist/orion-carousel.js';
import {compactSource,generateRobotCollisionAssets} from './lib/robot-collision-candidates.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||(mode!=='--write'&&mode!=='--check')){
 throw Error('Usage: node scripts/generate-orion-carousel-collisions.mjs --write|--check');
}

function evalPartExpr(part,partDocument,kernel,expression){
 const doc=partDocument(part);
 doc.nodes[part].transform=identityTransform();
 delete doc.nodes[part].physics.collisionAssembly;
 doc.nodes[part].program.source=compactSource(orionCarouselPartPrograms[part].source.replace(/return[^]*$/,'return '+expression+';'));
 return kernel.evaluate(doc).bodies[0];
}

function baseCandidates({kernel,extrudedCandidates,partDocument}){
 return [
  ...extrudedCandidates(evalPartExpr('base',partDocument,kernel,'subtract(deck,cornerBores,featherBores,servoM2Bores)'),0,6),
  ...extrudedCandidates(evalPartExpr('base',partDocument,kernel,'union(chuteWall,backstop,subtract(featherBosses,featherBores))'),6,9),
  ...extrudedCandidates(evalPartExpr('base',partDocument,kernel,'chuteWall'),9,18),
  ...extrudedCandidates(evalPartExpr('base',partDocument,kernel,'backstop'),9,24),
 ];
}

function turntableCandidates({kernel,extrudedCandidates,partDocument}){
 return [
  ...extrudedCandidates(evalPartExpr('turntable',partDocument,kernel,'union(east,west,north,south)'),0,27),
  ...extrudedCandidates(evalPartExpr('turntable',partDocument,kernel,'subtract(hub,splineSocket,screwBore,cornerRelief)'),27,31),
  ...extrudedCandidates(evalPartExpr('turntable',partDocument,kernel,'subtract(hub,screwBore,screwCs,cornerRelief)'),31,35),
 ];
}

await generateRobotCollisionAssets({
 mode,
 format:'brickwright-orion-carousel-collision-candidates',
 targetPath:'packages/editor/src/robot-assets/orion-carousel-collisions.json',
 partPrograms:orionCarouselPartPrograms,
 createPartDocument:createOrionCarouselPart,
 parts:['base','turntable','pusher','diverter','cargoCube'],
 quantities:{base:1,turntable:1,pusher:1,diverter:1,cargoCube:1},
 baseHulls:2*(490+55),
 customCandidates:{
  base:baseCandidates,
  turntable:turntableCandidates,
  pusher:({kernel,extrudedCandidates,partDocument})=>extrudedCandidates(evalPartExpr('pusher',partDocument,kernel,'block'),0,14),
  cargoCube:({kernel,extrudedCandidates,partDocument})=>extrudedCandidates(evalPartExpr('cargoCube',partDocument,kernel,'cube'),0,14),
 },
});
