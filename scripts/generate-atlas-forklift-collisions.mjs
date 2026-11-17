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
  wheel:({simplifiedCandidates,mesh})=>simplifiedCandidates(mesh,.05),
 },
});
