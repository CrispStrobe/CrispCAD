// SPDX-License-Identifier: BSD-3-Clause
import {afterEach,expect,it,vi} from 'vitest';
import type {SketchPoint} from '@brickwright/cad-core';
import {scheduleSketchDragPreview} from '../packages/editor/src/sketch-drag-preview.js';

afterEach(()=>vi.useRealTimers());

it('coalesces pointer changes while solving and cancels the queued and in-flight frames',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
 const calls:{point:SketchPoint;signal:AbortSignal;finish:(value:SketchPoint)=>void}[]=[];
 const render=vi.fn();
 const live=scheduleSketchDragPreview<SketchPoint>((point,signal)=>new Promise(finish=>calls.push({point,signal,finish})),render);
 live.update([1,2]);
 await vi.advanceTimersByTimeAsync(0);
 expect(calls.map(call=>call.point)).toEqual([[1,2]]);
 live.update([3,4]);
 live.update([5,6]);
 await vi.advanceTimersByTimeAsync(40);
 expect(calls).toHaveLength(1);
 calls[0].finish([1,2]);
 await vi.advanceTimersByTimeAsync(10);
 expect(render).toHaveBeenCalledOnce();
 expect(calls.map(call=>call.point)).toEqual([[1,2],[5,6]]);
 live.update([7,8]);
 live.close();
 expect(calls[1].signal.aborted).toBe(true);
 calls[1].finish([5,6]);
 await vi.runAllTimersAsync();
 expect(calls).toHaveLength(2);
 expect(render).toHaveBeenCalledOnce();
});

it('clears the overlay when the latest candidate fails validation',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
 const render=vi.fn();
 const live=scheduleSketchDragPreview(async(point)=>{
  if(point[0]<0)throw new Error('outside boundary');
  return point;
 },render);
 live.update([1,0]);
 await vi.runAllTimersAsync();
 live.update([-1,0]);
 await vi.runAllTimersAsync();
 expect(render.mock.calls).toEqual([[[1,0]],[undefined]]);
 live.close();
});
