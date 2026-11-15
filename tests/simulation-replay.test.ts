// SPDX-License-Identifier: BSD-3-Clause
import {it,expect} from 'vitest';
import {createSimulationReplay} from '../packages/editor/src/simulation-replay.js';
import type {SimulationFrame} from '../packages/editor/src/simulation-protocol.js';
const frame=(time:number,bodies=1):SimulationFrame=>({time,poses:Array.from({length:bodies},(_,i)=>({id:String(i),positionMm:[time,0,0],quaternion:[0,0,0,1]})),angles:{a:time},speeds:{a:1},linearPositions:{},linearSpeeds:{}});
it('selects only recorded physical poses, isolates callers and retains a bounded replay window',()=>{
 const replay=createSimulationReplay();replay.record(frame(0));replay.record(frame(.005));expect(replay.range().count).toBe(1);replay.record(frame(.05));replay.record(frame(.1));expect(replay.at(.075)?.time).toBe(.05);expect(replay.previous(.1)?.time).toBe(.05);expect(replay.at(-1)?.time).toBe(0);expect(replay.at(100)?.time).toBe(.1);expect(()=>replay.at(NaN)).toThrow();const value=replay.at(.05)!;value.poses[0].positionMm[0]=99;expect(replay.at(.05)!.poses[0].positionMm[0]).toBe(.05);
 for(let i=3;i<1500;i++)replay.record(frame(i*.05,256));expect(replay.range().count*256).toBeLessThanOrEqual(20000);expect(replay.range().first).toBeGreaterThan(70);replay.clear();expect(replay.range()).toEqual({first:0,last:0,count:0});expect(replay.at(0)).toBeUndefined();
});
