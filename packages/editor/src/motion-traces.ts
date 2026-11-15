// SPDX-License-Identifier: BSD-3-Clause
import {simulationTracers,localToWorldPoint} from '@brickwright/cad-core';
import type {CadDocument,Vec3} from '@brickwright/cad-core';
import type {SimulationFrame} from './simulation-protocol.js';
export interface TracePath {id:string;bodyId:string;color:string;samples:{time:number;point:Vec3}[]}
/** Bounded simulated-time samples; no document or history writes. */
export function createMotionTraces(){
 const paths=new Map<string,TracePath>();let lastTime=-Infinity;
 return {
  clear(){paths.clear();lastTime=-Infinity;},
  record(doc:CadDocument,frame:SimulationFrame){if(frame.time<=lastTime+1e-9||frame.time-lastTime<.02-1e-9)return;lastTime=frame.time;
   const poses=new Map(frame.poses.map(p=>[p.id,p]));
   for(const trace of simulationTracers(doc)){const pose=poses.get(trace.bodyId);if(!pose)continue;const source=localToWorldPoint(trace.point,doc.nodes[trace.bodyId].transform),[x,y,z,w]=pose.quaternion,[a,b,c]=source,u=2*(y*c-z*b),v=2*(z*a-x*c),t=2*(x*b-y*a);const point:Vec3=[a+w*u+y*t-z*v+pose.positionMm[0],b+w*v+z*u-x*t+pose.positionMm[1],c+w*t+x*v-y*u+pose.positionMm[2]];
    let path=paths.get(trace.id);if(!path){path={id:trace.id,bodyId:trace.bodyId,color:trace.color,samples:[]};paths.set(trace.id,path);}Object.freeze(point);path.samples.push(Object.freeze({time:frame.time,point}));if(path.samples.length>2000)path.samples.shift();
   }
  },
  paths(){return [...paths.values()].map(path=>({...path,samples:path.samples.slice()}));},
  csv(){const rows=['tracer_id,body_id,time_s,x_mm,y_mm,z_mm'];for(const path of paths.values())for(const sample of path.samples)rows.push([path.id,path.bodyId,sample.time,...sample.point].join(','));return rows.join('\r\n')+'\r\n';}
 };
}
