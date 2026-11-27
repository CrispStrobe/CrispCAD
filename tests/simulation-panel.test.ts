// @vitest-environment happy-dom
// SPDX-License-Identifier: BSD-3-Clause
import {expect,it,vi} from 'vitest';
import {createCadSession} from '@brickwright/cad-core';
import {mountSimulationPanel} from '../packages/editor/src/simulation-panel.js';
import type {SimulationFrame} from '../packages/editor/src/simulation-protocol.js';

const client=vi.hoisted(()=>({available:true,send:vi.fn(),dispose:vi.fn()}));
vi.mock('../packages/editor/src/simulation-client.js',()=>({createSimulationClient:()=>client}));

it('keeps hidden controls idle and hydrates them from the latest presented frame on open',async()=>{
 const session=createCadSession();
 const base=session.add({kind:'box',size:[10,10,10]}),arm=session.add({kind:'box',size:[10,10,10]});
 const hinge=session.addJoint('hinge',base,arm,[0,0,0],[0,0,1]);
 session.addTracer(arm,[2,0,0],'#ef8354');
 const frame=(time:number):SimulationFrame=>({
  time,poses:[{id:arm,positionMm:[time*100,0,0],quaternion:[0,0,0,1]}],
  angles:{[hinge]:time*100},speeds:{[hinge]:100},linearPositions:{},linearSpeeds:{}
 });
 client.send.mockReset().mockResolvedValue(frame(0));
 const parent=document.createElement('div');
 document.body.append(parent);
 const poses=vi.fn(),traces=vi.fn(),dragEnabled=vi.fn();
 const simulation=mountSimulationPanel(parent,session,'/manifold.wasm',async()=>{},poses,{traces,dragEnabled});
 const panel=parent.querySelector('section')!,observer=new MutationObserver(()=>{});
 observer.observe(panel,{attributes:true,childList:true,subtree:true,characterData:true});
 const elapsed=panel.querySelector<HTMLOutputElement>('[aria-label="Simulation time"]')!;
 const position=panel.querySelector<HTMLOutputElement>(`[aria-label="${hinge}: Joint angle"]`)!;
 const replay=panel.querySelector<HTMLInputElement>('[aria-label="Replay time"]')!;
 try{
  const lease=await simulation.acquireExternalClock();
  client.send.mockResolvedValueOnce(frame(.1));
  await lease.step([],[],[],false);lease.present();
  expect(panel.hidden).toBe(true);
  expect(observer.takeRecords()).toHaveLength(0);
  expect(elapsed.value).toBe('0.000 s');
  expect(poses).toHaveBeenLastCalledWith(frame(.1).poses);
  expect(traces.mock.lastCall?.[0][0].samples.at(-1).time).toBe(.1);
  expect(dragEnabled).toHaveBeenLastCalledWith(true);
  simulation.open();
  expect(panel.hidden).toBe(false);
  expect(elapsed.value).toBe('0.100 s');
  expect(position.value).toBe('10.0°');
  expect(replay.value).toBe('0.1');
  expect(replay.disabled).toBe(false);
  client.send.mockResolvedValueOnce(frame(.2));
  await lease.step([]);
  expect(elapsed.value).toBe('0.200 s');
  simulation.close();simulation.open();
  expect(elapsed.value).toBe('0.000 s');
  expect(position.value).toBe('0.0°');
  expect(replay.disabled).toBe(true);
 }finally{observer.disconnect();simulation.dispose();session.dispose();parent.remove();}
});
