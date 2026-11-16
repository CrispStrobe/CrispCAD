// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {SimulationActuatorStep,SimulationCommand,SimulationFrame,SimulationTelemetry} from './simulation-protocol.js';
type FrameCommand=Exclude<SimulationCommand,SimulationActuatorStep>|(SimulationActuatorStep&{telemetryOnly?:false});
export function createSimulationClient(){
 const worker=new Worker(new URL('./simulation.worker.js',import.meta.url),{type:'module'});
 let sequence=0,disposed=false;
 const pending=new Map<number,{resolve:(frame:SimulationTelemetry)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const fail=(error:Error)=>{worker.terminate();disposed=true;for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();};
 worker.onmessage=event=>{const {request,error,frame}=event.data,entry=pending.get(request);if(!entry)return;clearTimeout(entry.timer);pending.delete(request);if(error)entry.reject(new Error(error));else entry.resolve(frame);};
 worker.onerror=event=>fail(new Error(event.message||t('Simulation worker failed')));
 function send(command:SimulationActuatorStep&{telemetryOnly:true}):Promise<SimulationTelemetry>;
 function send(command:FrameCommand):Promise<SimulationFrame>;
 function send(command:SimulationCommand):Promise<SimulationTelemetry>{
   if(disposed)return Promise.reject(new Error(t('Simulation was stopped')));
   const request=++sequence;
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>fail(new Error(t('Simulation exceeded its time budget'))),command.op==='start'?60000:10000);pending.set(request,{resolve,reject,timer});try{worker.postMessage({...command,request});}catch(error){fail(error instanceof Error?error:new Error(String(error)));}});
 }
 return {
  send,
  dispose(){if(!disposed)fail(new Error(t('Simulation was stopped')));}
 };
}
