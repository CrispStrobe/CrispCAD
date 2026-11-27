// SPDX-License-Identifier: BSD-3-Clause
import {simulationTracers,localToWorldPoint} from '@brickwright/cad-core';
import type {CadDocument,Vec3} from '@brickwright/cad-core';
import type {BufferAttribute} from 'three';
import type {SimulationFrame} from './simulation-protocol.js';
export interface TraceSample {time:number;point:Vec3}
export interface TracePath {id:string;bodyId:string;color:string;samples:TraceSample[]}
export const TRACE_SAMPLE_LIMIT=2000;
/** Reuse the immutable prefix when a trail grows or replay seeks within it. */
export function createTraceVertices(attribute:BufferAttribute){
 let cached:readonly TraceSample[]=[];
 return (samples:readonly TraceSample[])=>{
  const shared=Math.min(samples.length,cached.length);
  const samePrefix=shared>0&&samples[0]===cached[0]&&samples[shared-1]===cached[shared-1];
  if(samePrefix&&samples.length<=cached.length)return;
  const start=samePrefix?shared:0;
  cached=samples;
  if(start===samples.length)return;
  for(let i=start;i<samples.length;i++)attribute.setXYZ(i,...samples[i].point);
  const first=start*3,end=samples.length*3;
  const range=attribute.updateRanges[0];
  if(range){
   const last=Math.max(end,range.start+range.count);
   range.start=Math.min(first,range.start);range.count=last-range.start;
  }else attribute.addUpdateRange(first,end-first);
  attribute.needsUpdate=true;
 };
}
/** Bounded simulated-time samples; no document or history writes. */
export function createMotionTraces(){
 const paths=new Map<string,TracePath>();let lastTime=-Infinity;
 return {
  clear(){paths.clear();lastTime=-Infinity;},
  record(doc:CadDocument,frame:SimulationFrame){if(frame.time<=lastTime+1e-9||frame.time-lastTime<.02-1e-9)return;lastTime=frame.time;
   const definitions=simulationTracers(doc);
   if(!definitions.length)return;
   const poses=new Map(frame.poses.map(p=>[p.id,p]));
   for(const trace of definitions){const pose=poses.get(trace.bodyId);if(!pose)continue;const source=localToWorldPoint(trace.point,doc.nodes[trace.bodyId].transform),[x,y,z,w]=pose.quaternion,[a,b,c]=source,u=2*(y*c-z*b),v=2*(z*a-x*c),t=2*(x*b-y*a);const point:Vec3=[a+w*u+y*t-z*v+pose.positionMm[0],b+w*v+z*u-x*t+pose.positionMm[1],c+w*t+x*v-y*u+pose.positionMm[2]];
    let path=paths.get(trace.id);if(!path){path={id:trace.id,bodyId:trace.bodyId,color:trace.color,samples:[]};paths.set(trace.id,path);}Object.freeze(point);path.samples.push(Object.freeze({time:frame.time,point}));if(path.samples.length>TRACE_SAMPLE_LIMIT)path.samples.shift();
   }
  },
  paths(){return [...paths.values()].map(path=>({...path,samples:path.samples.slice()}));},
  csv(){const rows=['tracer_id,body_id,time_s,x_mm,y_mm,z_mm'];for(const path of paths.values())for(const sample of path.samples)rows.push([path.id,path.bodyId,sample.time,...sample.point].join(','));return rows.join('\r\n')+'\r\n';}
 };
}
