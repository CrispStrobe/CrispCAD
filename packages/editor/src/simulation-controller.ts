// SPDX-License-Identifier: BSD-3-Clause
import {getLocale,t} from '@brickwright/cad-core';
import type {CadSession} from '@brickwright/cad-core';
import {createSimulationClient} from './simulation-client.js';
import type {SimulationFrame} from './simulation-protocol.js';
export interface CadMotor {port:string;id:string;name:string}
export function createSimulationController(session:CadSession,wasmURL:string,ready:()=>Promise<unknown>,changed:()=>void,frameChanged:(frame:SimulationFrame|null)=>void){
 let client:ReturnType<typeof createSimulationClient>|undefined,preparing:Promise<void>|undefined,epoch=0,commandEpoch=0,playing=false,program=false,disposed=false,fixBase=true,timer:ReturnType<typeof setTimeout>|undefined,lastTime=0,accumulator=0;
 let frame:SimulationFrame={time:0,poses:[],angles:{},speeds:{}},error='';
 const tickets=new Map<string,number>();
 const ticket=(id:string)=>{const value=(tickets.get(id)??0)+1;tickets.set(id,value);return value;};
 const settings=new Map<string,{speed:number;torque:number}>();
 const waits=new Map<string,{target:number;direction:number;speed:number;deadline:number;resolve:(value:string)=>void;reject:(error:Error)=>void;lastSpeed:number}>();
 const motors=():CadMotor[]=>(session.state.document.joints??[]).filter(j=>j.kind==='hinge').map((j,i)=>({port:j.control?.port??j.id,id:j.id,name:session.state.document.nodes[j.bodyB].name}));
 const find=(ref:string)=>{const list=motors(),exact=list.find(m=>m.id===ref)??list.find(m=>m.port===ref.toUpperCase());if(exact)return exact;const named=list.filter(m=>m.name===ref);if(named.length===1)return named[0];throw new Error(t('Unknown or ambiguous CAD motor'));};
 const cancel=(reason:string,id?:string)=>{for(const [key,w]of waits)if(id===undefined||key===id){waits.delete(key);w.reject(new Error(reason));}};
 const notify=()=>{if(!disposed)changed();};
 function pause(){commandEpoch++;playing=false;program=false;clearTimeout(timer);timer=undefined;lastTime=0;accumulator=0;cancel(t('Simulation was stopped'));notify();}
 function reset(){epoch++;pause();client?.dispose();client=undefined;preparing=undefined;frame={time:0,poses:[],angles:{},speeds:{}};error='';frameChanged(null);notify();}
 function fail(value:unknown){if(disposed)return;reset();error=value instanceof Error?value.message:String(value);notify();}
 async function prepare(){
  if(disposed)throw new Error(t('Editor was disposed'));if(client&&!preparing)return;if(preparing)return preparing;
  const expected=epoch;error='';
  const pending=(async()=>{await ready();if(expected!==epoch||disposed)throw new Error(t('Simulation was stopped'));client=createSimulationClient();const first=await client.send({op:'start',document:structuredClone(session.state.document),wasmURL:new URL(wasmURL,document.baseURI).href,fixBase,locale:getLocale()});if(expected!==epoch||disposed)throw new Error(t('Simulation was stopped'));frame=first;frameChanged(frame);})();
  preparing=pending;notify();
  try{await pending;}catch(e){if(expected===epoch)fail(e);throw e;}finally{if(preparing===pending)preparing=undefined;notify();}
 }
 async function start(asProgram=false){const command=commandEpoch;await prepare();if(command!==commandEpoch)throw new Error(t('Simulation was stopped'));if(document.hidden)throw new Error(t('Simulation cannot run in a background page'));program=asProgram;if(playing){notify();return;}playing=true;lastTime=performance.now();accumulator=0;notify();schedule();}
 const schedule=()=>{if(playing&&!disposed)timer=setTimeout(()=>{void tick();},16);};
 async function sendMotor(id:string,speed:number,torque:number){if(!Number.isFinite(speed)||Math.abs(speed)>720||!Number.isFinite(torque)||torque<=0||torque>100)throw new Error(t('Enter a speed from -720 to 720 and a torque above 0 up to 100 Nm'));await client!.send({op:'motor',id,speedDps:speed,torqueNm:torque});settings.set(id,{speed,torque});}
 async function tick(){
  if(!playing||!client)return;const expected=epoch,command=commandEpoch;
  const now=performance.now();accumulator+=Math.min(.05,Math.max(0,(now-lastTime)/1000));lastTime=now;
  const steps=Math.min(10,Math.floor((accumulator+1e-9)/.005));
  try{if(steps){accumulator-=steps*.005;const next=await client.send({op:'step',seconds:steps*.005});if(expected!==epoch||command!==commandEpoch||disposed)return;frame=next;frameChanged(frame);
    for(const [id,w]of [...waits]){
     if(expected!==epoch||command!==commandEpoch||waits.get(id)!==w)return;
     const remaining=w.target-frame.angles[id];
     if(Math.abs(remaining)<=.5&&Math.abs(frame.speeds[id]??0)<=10){await client.send({op:'stop-motor',id,action:'brake'});if(waits.get(id)===w){waits.delete(id);settings.set(id,{speed:0,torque:settings.get(id)?.torque??.02});w.resolve('completed');}}
     else if(frame.time>w.deadline){await client.send({op:'stop-motor',id,action:'brake'});if(waits.get(id)===w){waits.delete(id);w.reject(new Error(t('CAD motor did not reach its target')));}}
     else {const speed=Math.sign(remaining)*Math.min(w.speed,Math.abs(remaining)*4);if(Math.abs(speed-w.lastSpeed)>.25){w.lastSpeed=speed;await sendMotor(id,speed,settings.get(id)?.torque??.02);}}
    }
   }
   if(expected===epoch&&playing)schedule();
  }catch(e){if(expected===epoch)fail(e);}
 }
 async function setMotor(ref:string,speed:number,torque=.02,asProgram=true){const m=find(ref);if(!Number.isFinite(speed)||Math.abs(speed)>720||!Number.isFinite(torque)||torque<=0||torque>100)throw new Error(t('Enter a speed from -720 to 720 and a torque above 0 up to 100 Nm'));const command=commandEpoch,version=ticket(m.id);cancel(t('Motor command was replaced'),m.id);if(asProgram)await start(true);else await prepare();if(command!==commandEpoch||tickets.get(m.id)!==version)throw new Error(t('Motor command was replaced'));await sendMotor(m.id,speed,torque);notify();}
 async function stopMotor(ref:string,action:'brake'|'coast'='brake'){const m=find(ref);if(action!=='brake'&&action!=='coast')throw new Error(t('Unsupported CAD stop action'));ticket(m.id);cancel(t('Motor command was replaced'),m.id);if(client)await client.send({op:'stop-motor',id:m.id,action});settings.set(m.id,{speed:0,torque:settings.get(m.id)?.torque??.02});notify();}
 async function stopMotors(){for(const m of motors())ticket(m.id);cancel(t('Simulation was stopped'));if(client&&!preparing)await client.send({op:'stop-motors'});for(const m of motors())settings.set(m.id,{speed:0,torque:settings.get(m.id)?.torque??.02});notify();}
 async function stop(){pause();await stopMotors();}
 async function runDegrees(ref:string,degrees:number,speed:number){
  const m=find(ref);if(!Number.isFinite(degrees)||Math.abs(degrees)>36000||!Number.isFinite(speed)||Math.abs(speed)>720||speed===0)throw new Error(t('Invalid CAD motor travel command'));const command=commandEpoch,version=ticket(m.id);cancel(t('Motor command was replaced'),m.id);await start(true);if(command!==commandEpoch||tickets.get(m.id)!==version)throw new Error(t('Motor command was replaced'));if(degrees===0){await stopMotor(m.id);return 'completed';}
  const direction=Math.sign(degrees),magnitude=Math.abs(speed),expected=epoch,target=frame.angles[m.id]+degrees;
  await sendMotor(m.id,direction*magnitude,settings.get(m.id)?.torque??.02);if(expected!==epoch||command!==commandEpoch||tickets.get(m.id)!==version)throw new Error(t('Simulation was stopped'));
  return new Promise<string>((resolve,reject)=>{waits.set(m.id,{target,direction,speed:magnitude,deadline:frame.time+Math.min(180,Math.max(3,Math.abs(degrees)/magnitude*4+2)),resolve,reject,lastSpeed:direction*magnitude});});
 }
 const hidden=()=>{if(document.hidden){void stop().catch(fail);}};
 const blur=()=>{if(!program){if(preparing)reset();else pause();}};
 document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',blur);
 let revision=session.state.revision;const unsubscribe=session.subscribe(state=>{if(state.revision!==revision){revision=state.revision;settings.clear();reset();}});
 return {motors,prepare,start,pause,reset,stop,stopMotor,stopMotors,setMotor,runDegrees,
  get state(){return {state:preparing?'preparing':playing?'running':client?'paused':'idle',program,error,time:frame.time};},
  angle(ref:string){return frame.angles[find(ref).id]??0;},speed(ref:string){return frame.speeds[find(ref).id]??0;},setting(ref:string){return settings.get(find(ref).id)??{speed:0,torque:.02};},
  setFixBase(value:boolean){if(fixBase!==value){reset();fixBase=value;}},get fixBase(){return fixBase;},refresh(){if(client)frameChanged(frame);},
  dispose(){if(disposed)return;reset();disposed=true;unsubscribe();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',blur);}
 };
}
