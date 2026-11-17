// SPDX-License-Identifier: BSD-3-Clause
// Generate pre-qualified convex collision candidates for Cyclone 2-axis gantry sorter parts.
import {cycloneSorterPartPrograms,createCycloneSorterPart} from '../packages/editor/dist/cyclone-sorter.js';
import {generateRobotCollisionAssets} from './lib/robot-collision-candidates.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||(mode!=='--write'&&mode!=='--check')){
 throw Error('Usage: node scripts/generate-cyclone-sorter-collisions.mjs --write|--check');
}

await generateRobotCollisionAssets({
 mode,
 format:'brickwright-cyclone-sorter-collision-candidates',
 targetPath:'packages/editor/src/robot-assets/cyclone-sorter-collisions.json',
 partPrograms:cycloneSorterPartPrograms,
 createPartDocument:createCycloneSorterPart,
 parts:['frame','bridge','shuttle','paddle','puck'],
 quantities:{frame:1,bridge:1,shuttle:1,paddle:1,puck:2},
 baseHulls:1, // Adafruit micro-servo 1143 casing
 customCandidates:{
  puck:({simplifiedCandidates,mesh})=>simplifiedCandidates(mesh,.05),
 },
});
