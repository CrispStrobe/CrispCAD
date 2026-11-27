// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {SimulationActuatorStep,SimulationCommand,SimulationFrame,SimulationTelemetry} from './simulation-protocol.js';
type FrameCommand=Exclude<SimulationCommand,SimulationActuatorStep>|(SimulationActuatorStep&{telemetryOnly?:false});
export function createSimulationClient(){
 const worker=new Worker(new URL('./simulation.worker.js',import.meta.url),{type:'module'});
 let sequence=0,disposed=false;
 const pending=new Map<number,{resolve:(frame:SimulationTelemetry)=>void;reject:(error:Error)=>void;deadline:number}>();
 let watchdog:ReturnType<typeof setTimeout>|undefined,watchingUntil=Infinity;
 const clearWatchdog=()=>{
  if(watchdog!==undefined)clearTimeout(watchdog);
  watchdog=undefined;watchingUntil=Infinity;
 };
 const fail=(error:Error)=>{clearWatchdog();worker.terminate();disposed=true;for(const entry of pending.values())entry.reject(error);pending.clear();};
 // Reuse one watchdog for the worker. Replies at 200 Hz need no timer
 // operations. A new earlier deadline still takes precedence over startup.
 function watch(deadline:number,now:number){
  if(deadline>=watchingUntil)return;
  clearWatchdog();watchingUntil=deadline;
  watchdog=setTimeout(()=>{
   watchdog=undefined;watchingUntil=Infinity;
   let earliest=Infinity;
   for(const entry of pending.values())earliest=Math.min(earliest,entry.deadline);
   const checkedAt=performance.now();
   if(earliest<=checkedAt)fail(new Error(t('Simulation exceeded its time budget')));
   else watch(earliest,checkedAt);
  },Math.max(0,Math.ceil(deadline-now)));
 }
 worker.onmessage=event=>{const {request,error,frame}=event.data,entry=pending.get(request);if(!entry)return;pending.delete(request);if(error)entry.reject(new Error(error));else entry.resolve(frame);};
 worker.onerror=event=>fail(new Error(event.message||t('Simulation worker failed')));
 function send(command:SimulationActuatorStep&{telemetryOnly:true}):Promise<SimulationTelemetry>;
 function send(command:FrameCommand):Promise<SimulationFrame>;
 function send(command:SimulationCommand):Promise<SimulationTelemetry>{
   if(disposed)return Promise.reject(new Error(t('Simulation was stopped')));
   const request=++sequence;
   return new Promise((resolve,reject)=>{
    const now=performance.now(),deadline=now+(command.op==='start'?60000:10000);
    pending.set(request,{resolve,reject,deadline});watch(deadline,now);
    try{worker.postMessage({...command,request});}catch(error){fail(error instanceof Error?error:new Error(String(error)));}
   });
 }
 return {
  send,
  get available(){return !disposed;},
  dispose(){if(!disposed)fail(new Error(t('Simulation was stopped')));}
 };
}
