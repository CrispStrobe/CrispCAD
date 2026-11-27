// SPDX-License-Identifier: BSD-3-Clause
import {it,expect,vi} from 'vitest';
import {BufferAttribute} from 'three';
import {createCadSession,identityTransform} from '@brickwright/cad-core';
import {createMotionTraces,createTraceVertices} from '../packages/editor/src/motion-traces.js';
import type {TraceSample} from '../packages/editor/src/motion-traces.js';
it('applies authored transforms before physical deltas and bounds trace samples without model edits',()=>{
 const s=createCadSession(),id=s.add({kind:'box',size:[10,10,10]},{transform:{...identityTransform(),position:[10,20,30],rotation:[0,0,90],scale:[2,1,1]}});s.addTracer(id,[1,0,0]);const before=s.serialize(),traces=createMotionTraces();
 const frame=(time:number)=>({time,poses:[{id,positionMm:[5,0,0],quaternion:[0,0,Math.SQRT1_2,Math.SQRT1_2]}],angles:{},speeds:{},linearPositions:{},linearSpeeds:{}});
 traces.record(s.state.document,frame(0));expect(traces.paths()[0].samples[0].point[0]).toBeCloseTo(-17);expect(traces.paths()[0].samples[0].point[1]).toBeCloseTo(10);expect(traces.paths()[0].samples[0].point[2]).toBeCloseTo(30);
 for(let i=1;i<2200;i++)traces.record(s.state.document,frame(i*.02));expect(traces.paths()[0].samples).toHaveLength(2000);const path=traces.paths()[0];path.samples.length=0;expect(traces.paths()[0].samples).toHaveLength(2000);expect(traces.csv().split('\r\n')).toHaveLength(2002);expect(s.serialize()).toBe(before);traces.clear();expect(traces.paths()).toEqual([]);traces.record(s.state.document,frame(0));expect(traces.paths()[0].samples).toHaveLength(1);
});

it('writes only appended vertices and reuses uploaded prefixes when seeking',()=>{
 const buffer=new BufferAttribute(new Float32Array(600*3),3),{write}=createTraceVertices(buffer);
 const writes=vi.spyOn(buffer,'setXYZ');
 const samples:TraceSample[]=Array.from({length:600},(_,i)=>({time:i*.02,point:[i,i+1,-i]}));
 for(let count=1;count<=samples.length;count++){
  buffer.clearUpdateRanges();
  write(samples.slice(0,count));
  expect(buffer.updateRanges).toEqual([{start:(count-1)*3,count:3}]);
 }
 expect(writes).toHaveBeenCalledTimes(600);
 const version=buffer.version;
 buffer.clearUpdateRanges();
 write(samples.slice(0,150));write(samples.slice(0,450));write(samples.slice());
 expect(buffer.version).toBe(version);
 expect(buffer.updateRanges).toEqual([]);
 expect(Array.from(buffer.array)).toEqual(samples.flatMap(sample=>sample.point));
 // A trimmed view moves the start index with no upload. A new trail
 // starts at the first slot even if it has a similar length.
 const shifted=samples.slice(1);
 expect(write(shifted)).toBe(1);
 expect(buffer.updateRanges).toEqual([]);
 write([{time:0,point:[-1,-2,-3]}]);
 expect(Array.from(buffer.array.slice(0,3))).toEqual([-1,-2,-3]);
});

it('retains chronological draw order across wraps and uploads only overwritten slots',()=>{
 const capacity=5,buffer=new BufferAttribute(new Float32Array(capacity*3),3);
 const {indices,write}=createTraceVertices(buffer);
 const samples:TraceSample[]=Array.from({length:17},(_,i)=>({time:i*.02,point:[i,i*2,0]}));
 expect(write(samples.slice(0,capacity))).toBe(0);
 for(let end=capacity+1;end<=samples.length;end++){
  buffer.clearUpdateRanges();
  const window=samples.slice(end-capacity,end),offset=write(window);
  const drawn=Array.from(indices.slice(offset,offset+window.length),slot=>buffer.getX(slot));
  expect(drawn).toEqual(window.map(sample=>sample.point[0]));
  expect(buffer.updateRanges).toEqual([{start:((end-1)%capacity)*3,count:3}]);
 }
 const final=samples.slice(-capacity),version=buffer.version;
 expect(write(final.slice(0,2))).toBe(write(final));
 expect(buffer.version).toBe(version);
 buffer.clearUpdateRanges();
 for(let i=0;i<15;i++)write([{time:i,point:[i,i,i]}]);
 expect(buffer.updateRanges.length).toBeLessThanOrEqual(4);
});
