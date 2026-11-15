// SPDX-License-Identifier: BSD-3-Clause
import {it,expect} from 'vitest';
import {createCadSession,identityTransform} from '@brickwright/cad-core';
import {createMotionTraces} from '../packages/editor/src/motion-traces.js';
it('applies authored transforms before physical deltas and bounds trace samples without model edits',()=>{
 const s=createCadSession(),id=s.add({kind:'box',size:[10,10,10]},{transform:{...identityTransform(),position:[10,20,30],rotation:[0,0,90],scale:[2,1,1]}});s.addTracer(id,[1,0,0]);const before=s.serialize(),traces=createMotionTraces();
 const frame=(time:number)=>({time,poses:[{id,positionMm:[5,0,0],quaternion:[0,0,Math.SQRT1_2,Math.SQRT1_2]}],angles:{},speeds:{},linearPositions:{},linearSpeeds:{}});
 traces.record(s.state.document,frame(0));expect(traces.paths()[0].samples[0].point[0]).toBeCloseTo(-17);expect(traces.paths()[0].samples[0].point[1]).toBeCloseTo(10);expect(traces.paths()[0].samples[0].point[2]).toBeCloseTo(30);
 for(let i=1;i<2200;i++)traces.record(s.state.document,frame(i*.02));expect(traces.paths()[0].samples).toHaveLength(2000);const path=traces.paths()[0];path.samples.length=0;expect(traces.paths()[0].samples).toHaveLength(2000);expect(traces.csv().split('\r\n')).toHaveLength(2002);expect(s.serialize()).toBe(before);traces.clear();expect(traces.paths()).toEqual([]);traces.record(s.state.document,frame(0));expect(traces.paths()[0].samples).toHaveLength(1);
});
