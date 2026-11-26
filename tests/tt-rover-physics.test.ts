// SPDX-License-Identifier: BSD-3-Clause
import {it,expect} from 'vitest';
import {createTTRoverDocument} from '../packages/editor/src/tt-rover.js';
import {prepareDocumentCollisions,createPhysicsWorld} from '../packages/physics/src/index.js';
import {qualifyTTRoverPhysics} from '../scripts/qualify-tt-rover-physics.mjs';

it('qualifies the complete rover and drives forward, backward and in a differential turn with a free base',async()=>{
 const document=createTTRoverDocument();expect(document.simulation?.fixBase).toBe(false);
 const report=await qualifyTTRoverPhysics({document,prepare:prepareDocumentCollisions,createWorld:createPhysicsWorld,engine:'wasm-compat'});
 expect(report.passed).toBe(true);expect(report.bodyCount).toBe(26);expect(report.rigidBodyCount).toBe(3);expect(report.separatedHingePairCount).toBe(2);expect(report.hulls).toBeLessThanOrEqual(4096);expect(report.maxRelativeError).toBeLessThan(.02);expect(report.maxBoundsErrorMm).toBeLessThan(.2);
 expect(report.nativeSteps).toBe(1520);expect(report.movingHingeSamplingHz).toBe(200);expect(report.peakMovingHingeAnchorErrorMm).toBeLessThan(.25);expect(report.peakMovingHingeDriftBoundMm).toBeLessThan(.249);
 expect(report.forwardMm).toBeGreaterThan(50);expect(report.reverseMm).toBeLessThan(-50);expect(report.turnDegrees).toBeGreaterThan(30);expect(report.sourceUnchanged).toBe(true);
 const phases=Object.fromEntries(report.phases.map((p:{phase:string})=>[p.phase,p]));
 for(const port of ['A','B']as const){expect(phases.forward.rotationDegrees[port]-phases.settled.rotationDegrees[port]).toBeGreaterThan(180);expect(phases.reverse.rotationDegrees[port]-phases['braked-forward'].rotationDegrees[port]).toBeLessThan(-180);}
 expect(phases.turn.rotationDegrees.A-phases['braked-reverse'].rotationDegrees.A).toBeLessThan(-180);expect(phases.turn.rotationDegrees.B-phases['braked-reverse'].rotationDegrees.B).toBeGreaterThan(180);
},60000);
