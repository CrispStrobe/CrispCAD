// SPDX-License-Identifier: BSD-3-Clause
// Candidate hulls only: prepareDocumentCollisions independently requalifies
// them against each live source mesh. Serialized certificates are never trusted.
import candidates from './robot-assets/tt-rover-collisions.json' with {type:'json'};
import {motorCollisionAssembly} from './motor-models.js';
import type {PartPhysics} from '@brickwright/cad-core';
type Assembly=NonNullable<PartPhysics['collisionAssembly']>;
export function ttRoverCollisionAssembly(part:string):Assembly|undefined{
 if(part==='casing'||part==='shaft')return motorCollisionAssembly('tt-gearmotor',part);
 const record=(candidates.records as Record<string,{hulls:Assembly}>)[part];
 return record?structuredClone(record.hulls):undefined;
}
