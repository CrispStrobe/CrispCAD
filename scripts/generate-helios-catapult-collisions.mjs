// SPDX-License-Identifier: BSD-3-Clause
// Generate pre-qualified convex collision candidates for Helios turret catapult parts.
import {heliosCatapultPartPrograms,createHeliosCatapultPart} from '../packages/editor/dist/helios-catapult.js';
import {generateRobotCollisionAssets} from './lib/robot-collision-candidates.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||(mode!=='--write'&&mode!=='--check')){
 throw Error('Usage: node scripts/generate-helios-catapult-collisions.mjs --write|--check');
}

await generateRobotCollisionAssets({
 mode,
 format:'brickwright-helios-catapult-collision-candidates',
 targetPath:'packages/editor/src/robot-assets/helios-catapult-collisions.json',
 partPrograms:heliosCatapultPartPrograms,
 createPartDocument:createHeliosCatapultPart,
 parts:['pedestal','turret','arm','payload','gateBase','goalie'],
 quantities:{pedestal:1,turret:1,arm:1,payload:1,gateBase:1,goalie:1},
 baseHulls:3, // Three Adafruit micro-servo 1143 casings
 customCandidates:{
  payload:({simplifiedCandidates,mesh})=>simplifiedCandidates(mesh,.05),
  goalie:({simplifiedCandidates,mesh})=>simplifiedCandidates(mesh,.05),
 },
});
