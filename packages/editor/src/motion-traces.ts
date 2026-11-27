// SPDX-License-Identifier: BSD-3-Clause
import {simulationTracers,localToWorldPoint} from '@brickwright/cad-core';
import type {CadDocument,Vec3} from '@brickwright/cad-core';
import type {BufferAttribute} from 'three';
import type {SimulationFrame} from './simulation-protocol.js';
export interface TraceSample {time:number;point:Vec3}
export interface TracePath {id:string;bodyId:string;color:string;samples:TraceSample[]}
export const TRACE_SAMPLE_LIMIT=2000;
/** Keep immutable samples in circular vertex slots. The doubled index order
 * lets a line strip cross the last slot without splitting the draw. */
export function createTraceVertices(attribute:BufferAttribute){
 const capacity=attribute.count;
 const indices=Uint16Array.from({length:capacity*2},(_,index)=>index%capacity);
 let cached:readonly TraceSample[]=[],cachedOffset=0;
 function mark(start:number,count:number){
  const first=start*3,size=count*3;
  const ranges=attribute.updateRanges,last=ranges.at(-1);
  if(last&&first>=last.start&&first<=last.start+last.count){
   last.count=Math.max(last.count,first+size-last.start);
  }else if(ranges.length<4)attribute.addUpdateRange(first,size);
  else{
   // Bound the queued uploads if presentation has not drawn for several frames.
   attribute.clearUpdateRanges();
   attribute.addUpdateRange(0,capacity*3);
  }
 }
 return {indices,write(samples:readonly TraceSample[]){
  const index=cached.indexOf(samples[0]);
  const shared=index<0?0:Math.min(samples.length,cached.length-index);
  // The producer only appends immutable samples, trims the head, or resets.
  const overlap=shared>0&&samples[shared-1]===cached[index+shared-1];
  const offset=overlap?(cachedOffset+index)%capacity:0;
  const start=overlap?shared:0;
  if(overlap&&start===samples.length)return offset;
  cached=samples;cachedOffset=offset;
  const count=samples.length-start;
  if(count){
   for(let i=start;i<samples.length;i++)attribute.setXYZ((offset+i)%capacity,...samples[i].point);
   const first=(offset+start)%capacity,contiguous=Math.min(count,capacity-first);
   mark(first,contiguous);
   if(contiguous<count)mark(0,count-contiguous);
   attribute.needsUpdate=true;
  }
  return offset;
 }};
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
