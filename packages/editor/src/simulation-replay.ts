// SPDX-License-Identifier: BSD-3-Clause
import type {SimulationFrame} from './simulation-protocol.js';
/** View-only, bounded physical snapshots. Seeking never mutates the solver. */
export function createSimulationReplay(){
 const frames:SimulationFrame[]=[];let poses=0;
 const locate=(time:number,strict=false)=>{for(let i=frames.length-1;i>=0;i--)if(strict?frames[i].time<time-1e-9:frames[i].time<=time+1e-9)return frames[i];return frames[0];};
 return {
  clear(){frames.length=0;poses=0;},
  record(frame:SimulationFrame){if(frames.length&&frame.time-frames.at(-1)!.time<.05-1e-9)return;const saved=structuredClone(frame);frames.push(saved);poses+=saved.poses.length;while(frames.length>1&&(frames.length>1200||poses>20000))poses-=frames.shift()!.poses.length;},
  range(){return {first:frames[0]?.time??0,last:frames.at(-1)?.time??0,count:frames.length};},
  at(time:number){if(!Number.isFinite(time))throw new Error('Invalid replay time');const frame=locate(time);return frame?structuredClone(frame):undefined;},
  previous(time:number){const frame=locate(time,true);return frame?structuredClone(frame):undefined;}
 };
}
