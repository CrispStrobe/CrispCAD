// SPDX-License-Identifier: BSD-3-Clause
import type {GeometryResult} from '@brickwright/cad-geometry';
import {getLocale,t,newId,simulationSettings} from '@brickwright/cad-core';
import type {CadSession,Vec3} from '@brickwright/cad-core';
import {createSimulationClient} from './simulation-client.js';
import {createMotionTraces} from './motion-traces.js';
import {createSimulationReplay} from './simulation-replay.js';
import type {SimulationFrame,SimulationRay,SimulationServo} from './simulation-protocol.js';
export interface CadMotor {port:string;id:string;name:string}
type Drive='hinge'|'slider';
type Travel={kind:Drive;target:number;speed:number;deadline:number;lastSpeed:number;resolve:(value:string)=>void;reject:(error:Error)=>void};
const emptyFrame=():SimulationFrame=>({time:0,poses:[],angles:{},speeds:{},linearPositions:{},linearSpeeds:{}});
/** One clock for manual controls and program execution. Preview never edits the design. */
export function createSimulationController(session:CadSession,wasmURL:string,ready:()=>Promise<GeometryResult|void>,changed:()=>void,frameChanged:(frame:SimulationFrame|null)=>void,interruptProgram?:()=>void){
 let client:ReturnType<typeof createSimulationClient>|undefined,preparing:Promise<void>|undefined,epoch=0,commandEpoch=0,playing=false,program=false,disposed=false,fixBaseOverride:boolean|undefined,rigidPreview=false,timeScale=1,timer:ReturnType<typeof setTimeout>|undefined,lastTime=0,accumulator=0;
 let externalOwner:symbol|undefined;
 let externalPause:Promise<void>|undefined;
 let standby:ReturnType<typeof createSimulationClient>|undefined;
 let workerRevision:number|undefined;
 let frame=emptyFrame(),error='',replayTime:number|undefined,replayPlaying=false,replayTimer:ReturnType<typeof setTimeout>|undefined;const replay=createSimulationReplay();
 const traces=createMotionTraces(),tickets=new Map<string,number>(),settings=new Map<string,{speed:number;limit:number;enabled:boolean}>(),waits=new Map<string,Travel>();
 const fixBase=()=>fixBaseOverride??simulationSettings(session.state.document).fixBase??!!session.state.document.joints?.length;
 const present=(value:SimulationFrame|null)=>{if(value){traces.record(session.state.document,value);replay.record(value);}else traces.clear();frameChanged(value);};
 const notify=()=>{if(!disposed)changed();};
 const list=(kind:Drive):CadMotor[]=>(session.state.document.joints??[]).filter(j=>j.kind===kind).map(j=>({port:j.control?.port??j.id,id:j.id,name:session.state.document.nodes[j.bodyB].name}));
 const motors=()=>list('hinge'),sliders=()=>list('slider');
 const find=(ref:string,kind:Drive='hinge')=>{const items=list(kind),exact=items.find(m=>m.id===ref)??items.find(m=>m.port===ref.toUpperCase());if(exact)return exact;const named=items.filter(m=>m.name===ref);if(named.length===1)return named[0];throw new Error(t(kind==='hinge'?'Unknown or ambiguous CAD motor':'Unknown slider connector'));};
 const ticket=(id:string)=>{const value=(tickets.get(id)??0)+1;tickets.set(id,value);return value;};
 const cancel=(reason:string,id?:string)=>{for(const [key,wait]of waits)if(id===undefined||key===id){waits.delete(key);wait.reject(new Error(reason));}};
 function stopReplay(){replayPlaying=false;clearTimeout(replayTimer);replayTimer=undefined;}
 function showReplay(time:number){const saved=replay.at(time);if(saved){replayTime=saved.time;frameChanged(saved);}}
 function pause(){externalOwner=undefined;stopReplay();if(client&&!preparing)void client.send({op:'release-grab'}).catch(()=>{});commandEpoch++;playing=false;program=false;clearTimeout(timer);timer=undefined;lastTime=0;accumulator=0;cancel(t('Simulation was stopped'));notify();}
 function releaseClient(discard=false){
  if(discard){standby?.dispose();standby=undefined;}
  if(client){
   const active=client;
   if(discard||preparing||!active.available)active.dispose();
   else{
    standby=active;
    void active.send({op:'park'}).catch(()=>{
     if(standby===active)standby=undefined;
     active.dispose();
    });
   }
  }
  client=undefined;preparing=undefined;
 }
 function reset(discard=false){epoch++;pause();releaseClient(discard);frame=emptyFrame();error='';replay.clear();replayTime=undefined;present(null);notify();}
 function fail(value:unknown){if(disposed)return;reset(true);error=value instanceof Error?value.message:String(value);notify();}
 async function prepare(){
  if(disposed)throw new Error(t('Editor was disposed'));if(client&&!preparing)return;if(preparing)return preparing;
  replay.clear();traces.clear();replayTime=undefined;
  const expected=epoch;error='';
  const pending=(async()=>{
   const geometry=await ready();
   if(expected!==epoch||disposed)throw new Error(t('Simulation was stopped'));
   const parked=standby?.available?standby:undefined;
   client=parked??createSimulationClient();
   standby=undefined;
   // A parked worker can reuse qualified construction for a new revision.
   // Only an unchanged revision can omit the authored snapshot.
   const revision=session.state.revision;
   const source=parked&&workerRevision===revision?{}:{document:session.state.document,geometry:geometry||undefined};
   const first=await client.send({
    op:'start',...source,
    wasmURL:new URL(wasmURL,document.baseURI).href,fixBase:fixBase(),rigidPreview,locale:getLocale(),
   });
   if(expected!==epoch||disposed)throw new Error(t('Simulation was stopped'));
   workerRevision=revision;frame=first;present(frame);
  })();
  preparing=pending;notify();
  try{await pending;}catch(e){if(expected===epoch)fail(e);throw e;}finally{if(preparing===pending)preparing=undefined;notify();}
 }
 async function start(asProgram=false){if(externalOwner)throw new Error(t('The circuit owns this simulation clock'));stopReplay();if(replayTime!==undefined){replayTime=undefined;frameChanged(frame);}const command=commandEpoch;program=asProgram||program;await prepare();if(command!==commandEpoch)throw new Error(t('Simulation was stopped'));if(document.hidden)throw new Error(t('Simulation cannot run in a background page'));program=asProgram||playing&&program;if(playing){notify();return;}playing=true;lastTime=performance.now();accumulator=0;notify();schedule();}
 const schedule=()=>{if(playing&&!disposed)timer=setTimeout(()=>{void tick();},16);};
 function validateDrive(kind:Drive,speed:number,limit:number){if(!Number.isFinite(speed)||Math.abs(speed)>(kind==='hinge'?720:1000)||!Number.isFinite(limit)||limit<=0||limit>(kind==='hinge'?100:10000))throw new Error(t(kind==='hinge'?'Enter a speed from -720 to 720 and a torque above 0 up to 100 Nm':'Enter a speed from -1000 to 1000 and a force above 0 up to 10000 N'));}
 async function sendDrive(id:string,kind:Drive,speed:number,limit:number){validateDrive(kind,speed,limit);await client!.send(kind==='hinge'?{op:'motor',id,speedDps:speed,torqueNm:limit}:{op:'slider',id,speedMmS:speed,forceN:limit});settings.set(id,{speed,limit,enabled:true});}
 async function brake(id:string,kind:Drive,action:'brake'|'coast'='brake'){if(client)await client.send(kind==='hinge'?{op:'stop-motor',id,action}:{op:'stop-slider',id,action});settings.set(id,{speed:0,enabled:action==='brake',limit:settings.get(id)?.limit??(kind==='hinge'?.02:10)});}
 async function tick(){
  if(!playing||!client)return;const expected=epoch,command=commandEpoch;
  const now=performance.now();accumulator=Math.min(.1,accumulator+Math.min(.05,Math.max(0,(now-lastTime)/1000))*timeScale);lastTime=now;
  const steps=Math.min(10,Math.floor((accumulator+1e-9)/.005));
  try{if(steps){accumulator-=steps*.005;const next=await client.send({op:'step',seconds:steps*.005});if(expected!==epoch||command!==commandEpoch||disposed)return;frame=next;present(frame);
    for(const [id,wait]of [...waits]){
     if(expected!==epoch||command!==commandEpoch)return;if(waits.get(id)!==wait)continue;
     const position=wait.kind==='hinge'?frame.angles[id]:frame.linearPositions[id],velocity=wait.kind==='hinge'?frame.speeds[id]:frame.linearSpeeds[id],remaining=wait.target-position;
     if(Math.abs(remaining)<=(wait.kind==='hinge'?.5:.05)&&Math.abs(velocity??0)<=(wait.kind==='hinge'?10:2)){
      await brake(id,wait.kind);if(waits.get(id)===wait){waits.delete(id);wait.resolve('completed');}
     }else if(frame.time>wait.deadline){await brake(id,wait.kind);if(waits.get(id)===wait){waits.delete(id);wait.reject(new Error(t('CAD motor did not reach its target')));}}
     else{const speed=Math.sign(remaining)*Math.min(wait.speed,Math.abs(remaining)*4);if(Math.abs(speed-wait.lastSpeed)>(wait.kind==='hinge'?.25:.025)){wait.lastSpeed=speed;await sendDrive(id,wait.kind,speed,settings.get(id)?.limit??(wait.kind==='hinge'?.02:10));}}
    }
   }
   if(expected===epoch&&playing)schedule();
  }catch(e){if(expected===epoch)fail(e);}
 }
 async function setDrive(ref:string,kind:Drive,speed:number,limit:number,asProgram=true){if(externalOwner)throw new Error(t('The circuit owns this simulation clock'));const motor=find(ref,kind);validateDrive(kind,speed,limit);const command=commandEpoch,version=ticket(motor.id);cancel(t('Motor command was replaced'),motor.id);if(asProgram)await start(true);else await prepare();if(command!==commandEpoch||tickets.get(motor.id)!==version)throw new Error(t('Motor command was replaced'));await sendDrive(motor.id,kind,speed,limit);notify();}
 async function stopDrive(ref:string,kind:Drive,action:'brake'|'coast'='brake'){if(externalOwner)throw new Error(t('The circuit owns this simulation clock'));const motor=find(ref,kind);if(!['brake','coast'].includes(action))throw new Error(t('Unsupported CAD stop action'));ticket(motor.id);cancel(t('Motor command was replaced'),motor.id);await brake(motor.id,kind,action);notify();}
 async function stopMotors(){if(externalOwner)throw new Error(t('The circuit owns this simulation clock'));stopReplay();for(const motor of [...motors(),...sliders()])ticket(motor.id);cancel(t('Simulation was stopped'));if(client&&!preparing)await client.send({op:'stop-motors'});for(const [id,value]of settings)settings.set(id,{...value,speed:0});notify();}
 async function stop(){
  // Stop returns the viewport to the design. Keep the previous recording for
  // replay/export; a new preparation starts a fresh recording.
  epoch++;pause();releaseClient();
  for(const [id,value]of settings)settings.set(id,{...value,speed:0});
  replayTime=undefined;frameChanged(null);notify();
 }
 async function travel(ref:string,kind:Drive,distance:number,speed:number){
  const motor=find(ref,kind);if(!Number.isFinite(distance)||Math.abs(distance)>(kind==='hinge'?36000:100000)||!Number.isFinite(speed)||Math.abs(speed)>(kind==='hinge'?720:1000)||speed===0)throw new Error(t('Invalid CAD motor travel command'));
  const command=commandEpoch,version=ticket(motor.id);cancel(t('Motor command was replaced'),motor.id);await start(true);if(command!==commandEpoch||tickets.get(motor.id)!==version)throw new Error(t('Motor command was replaced'));if(distance===0){await stopDrive(motor.id,kind);return 'completed';}
  const magnitude=Math.abs(speed),expected=epoch,target=(kind==='hinge'?frame.angles[motor.id]:frame.linearPositions[motor.id])+distance;
  await sendDrive(motor.id,kind,Math.sign(distance)*magnitude,settings.get(motor.id)?.limit??(kind==='hinge'?.02:10));if(expected!==epoch||command!==commandEpoch||tickets.get(motor.id)!==version)throw new Error(t('Simulation was stopped'));
  return new Promise<string>((resolve,reject)=>waits.set(motor.id,{kind,target,speed:magnitude,deadline:frame.time+Math.min(180,Math.max(3,Math.abs(distance)/magnitude*4+2)),resolve,reject,lastSpeed:Math.sign(distance)*magnitude}));
 }
 function seekReplay(time:number){if(!Number.isFinite(time))throw new Error(t('Invalid replay time'));if(program)interruptProgram?.();pause();const saved=replay.at(time);if(saved){replayTime=saved.time;frameChanged(saved);notify();}}
 const hidden=()=>{if(document.hidden){if(program)interruptProgram?.();void stop().catch(fail);}};
 const blur=()=>{if(!program&&!externalOwner){if(preparing)reset();else pause();}};
 document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',blur);
 let revision=session.state.revision,documentId=session.state.document.id;
 const unsubscribe=session.subscribe(state=>{
  if(state.revision===revision)return;
  revision=state.revision;
  const changedDocument=state.document.id!==documentId;
  if(changedDocument){documentId=state.document.id;fixBaseOverride=undefined;}
  if(program)interruptProgram?.();
  settings.clear();
  reset(changedDocument);
 });
 async function acquireExternalClock(){
  // Paused release retains the live world. Its final full snapshot must be
  // received before a successor can observe or advance that world.
  if(externalPause)await externalPause;
  if(externalOwner||playing||program||preparing)throw new Error(t('Stop the current simulation before connecting a circuit'));
  const owner=Symbol('external mechanical clock');externalOwner=owner;
  try{await prepare();if(externalOwner!==owner)throw new Error(t('Simulation was stopped'));program=true;notify();}catch(e){if(externalOwner===owner)externalOwner=undefined;throw e;}
  let pending=false,pendingRequest:Promise<unknown>|undefined,pausedRelease:Promise<void>|undefined;
  const track=<T>(request:Promise<T>)=>{pendingRequest=request;return request;};
  return {
   snapshot:()=>structuredClone(frame),
   async sense(rays:SimulationRay[]){if(externalOwner!==owner||disposed||pending)throw new Error(t('Simulation was stopped'));pending=true;try{const next=await track(client!.send({op:'sense',rays}));if(externalOwner!==owner||disposed)throw new Error(t('Simulation was stopped'));frame=next;return structuredClone(frame);}finally{pending=false;pendingRequest=undefined;}},
   async step(impulses:{id:string;impulse:number}[],rays:SimulationRay[]=[],servos:SimulationServo[]=[],display=true){
    if(externalOwner!==owner||disposed)throw new Error(t('Simulation was stopped'));if(pending)throw new Error(t('A mechanical step is already pending'));
    if(impulses.some(v=>!Number.isFinite(v.impulse)||Math.abs(v.impulse)>1))throw new Error(t('Invalid actuator impulse'));
    pending=true;try{const next=await track(client!.send({op:'actuator-step',impulses,rays,servos}));if(externalOwner!==owner||disposed)throw new Error(t('Simulation was stopped'));frame=next;if(display){present(frame);notify();}return structuredClone(frame);}finally{pending=false;pendingRequest=undefined;}
   },
   // Opt-in intermediate feedback. Finish each displayed batch with step(),
   // which refreshes the complete snapshot before present()/replay consume it.
   // The retained full snapshot is never labelled with a newer telemetry time.
   async stepTelemetry(impulses:{id:string;impulse:number}[],rays:SimulationRay[]=[],servos:SimulationServo[]=[]){
    if(externalOwner!==owner||disposed)throw new Error(t('Simulation was stopped'));if(pending)throw new Error(t('A mechanical step is already pending'));
    if(impulses.some(v=>!Number.isFinite(v.impulse)||Math.abs(v.impulse)>1))throw new Error(t('Invalid actuator impulse'));
    pending=true;try{const next=await track(client!.send({op:'actuator-step',impulses,rays,servos,telemetryOnly:true}));if(externalOwner!==owner||disposed)throw new Error(t('Simulation was stopped'));return structuredClone(next);}finally{pending=false;pendingRequest=undefined;}
   },
   present(){if(externalOwner!==owner||disposed)throw new Error(t('Simulation was stopped'));present(frame);notify();},
   release(){if(externalOwner===owner)void stop();},
   /** Release ownership while retaining live time, poses and velocities.
    * Invalidates this lease synchronously. A step already sent to the worker
    * may finish; the returned promise resolves after its full final snapshot
    * is available. Drives coast without stepping, braking or editing history.
    */
   releasePaused(){
    if(externalOwner!==owner)return pausedRelease??Promise.resolve();
    const active=client!,expected=epoch,outstanding=pendingRequest;
    const current=()=>!disposed&&expected===epoch&&client===active;
    const settling=Promise.resolve().then(async()=>{
     // An invalidated caller rejects its own result. The world may still have
     // advanced, so do not reuse the caller's last public snapshot as truth.
     await outstanding?.catch(()=>{});
     if(!current())return;
     await active.send({op:'stop-motors',action:'coast'});
     if(!current())return;
     await active.send({op:'release-grab'});
     if(!current())return;
     const next=await active.send({op:'sense',rays:[]});
     if(!current())return;
     frame=next;replayTime=undefined;
     for(const [id,value]of settings)settings.set(id,{...value,speed:0,enabled:false});
     present(frame);
    }).catch(e=>{if(current())fail(e);throw e;}).finally(()=>{
     if(preparing===settling)preparing=undefined;
     if(externalPause===settling)externalPause=undefined;
     notify();
    });
    // Publish the barrier before pause notifies observers, so a synchronous
    // observer cannot obtain a replacement lease before the worker settles.
    pausedRelease=settling;externalPause=settling;preparing=settling;pause();
    return settling;
   }
  };
 }
 return {motors,sliders,prepare,start,pause,reset:()=>reset(),stop,stopMotors,acquireExternalClock,
  setMotor:(ref:string,speed:number,torque=.02,asProgram=true)=>setDrive(ref,'hinge',speed,torque,asProgram),
  setSlider:(ref:string,speed:number,force=10,asProgram=true)=>setDrive(ref,'slider',speed,force,asProgram),
  stopMotor:(ref:string,action:'brake'|'coast'='brake')=>stopDrive(ref,'hinge',action),stopSlider:(ref:string,action:'brake'|'coast'='brake')=>stopDrive(ref,'slider',action),
  runDegrees:(ref:string,degrees:number,speed:number)=>travel(ref,'hinge',degrees,speed),runDistance:(ref:string,distanceMm:number,speedMmS:number)=>travel(ref,'slider',distanceMm,speedMmS),
  angle(ref:string){return frame.angles[find(ref).id]??0;},speed(ref:string){return frame.speeds[find(ref).id]??0;},sliderPosition(ref:string){return frame.linearPositions[find(ref,'slider').id]??0;},sliderSpeed(ref:string){return frame.linearSpeeds[find(ref,'slider').id]??0;},
  setting(ref:string){const value=settings.get(find(ref).id);return {speed:value?.speed??0,torque:value?.limit??.02,enabled:value?.enabled??false};},sliderSetting(ref:string){const value=settings.get(find(ref,'slider').id);return {speed:value?.speed??0,force:value?.limit??10,enabled:value?.enabled??false};},
  async step(){stopReplay();replayTime=undefined;if(playing||preparing||externalOwner)throw new Error(t('Pause simulation before stepping'));const expected=epoch,command=commandEpoch;await prepare();if(expected!==epoch||command!==commandEpoch)throw new Error(t('Simulation was stopped'));const next=await client!.send({op:'step',seconds:.005});if(expected!==epoch||command!==commandEpoch)throw new Error(t('Simulation was stopped'));frame=next;present(frame);notify();},
  async throwBody(id:string,velocityMmS:Vec3){const command=commandEpoch;await start();if(command!==commandEpoch)throw new Error(t('Simulation was stopped'));await client!.send({op:'velocity',id,velocityMmS});},
  async impulse(id:string,impulseNs:Vec3,pointMm?:Vec3){const command=commandEpoch;await start();if(command!==commandEpoch)throw new Error(t('Simulation was stopped'));await client!.send({op:'impulse',id,impulseNs,pointMm});},
  async dragBody(id:string,pointMm:Vec3,targetMm:Vec3){if(!playing||!client)throw new Error(t('Run simulation before dragging'));await client.send({op:'grab',id,pointMm,targetMm});},
  async releaseDrag(){if(client&&!preparing)await client.send({op:'release-grab'});},
  async throwBox(positionMm:Vec3,velocityMmS:Vec3,halfSizeMm=6){const command=commandEpoch;await start();if(command!==commandEpoch)throw new Error(t('Simulation was stopped'));await client!.send({op:'ball',shape:'box',id:'preview-'+newId(),positionMm,velocityMmS,radiusMm:halfSizeMm});},
  async throwBall(positionMm:Vec3,velocityMmS:Vec3,radiusMm=6){const command=commandEpoch;await start();if(command!==commandEpoch)throw new Error(t('Simulation was stopped'));await client!.send({op:'ball',id:'preview-'+newId(),positionMm,velocityMmS,radiusMm});},
  tracePaths:()=>traces.paths().map(path=>({...path,samples:replayTime===undefined?path.samples:path.samples.filter(sample=>sample.time<=replayTime!+1e-9)})),traceCSV:()=>traces.csv(),clearTraces(){traces.clear();frameChanged(replayTime===undefined?frame:replay.at(replayTime)??frame);},
  setTimeScale(value:number){if(!Number.isFinite(value)||value<.1||value>2)throw new Error(t('Simulation speed must be between 0.1 and 2'));timeScale=value;lastTime=performance.now();accumulator=0;notify();},get timeScale(){return timeScale;},
  setRigidPreview(value:boolean){if(rigidPreview!==value){rigidPreview=value;reset();}},get rigidPreview(){return rigidPreview;},
  setFixBase(value:boolean){if(fixBase()!==value){fixBaseOverride=value;reset();}},get fixBase(){return fixBase();},refresh(){if(client)frameChanged(replayTime===undefined?frame:replay.at(replayTime)??frame);},
  replayRange:()=>replay.range(),get replayTime(){return replayTime;},
  seekReplay,
  previousFrame(){const saved=replay.previous(replayTime??frame.time);if(saved)seekReplay(saved.time);},
  playReplay(){if(program)interruptProgram?.();pause();const range=replay.range();if(range.count<2)return;let cursor=replayTime===undefined||replayTime>=range.last?range.first:replayTime,last=performance.now();replayPlaying=true;showReplay(cursor);notify();const tick=()=>{if(!replayPlaying||disposed)return;const now=performance.now();cursor=Math.min(range.last,cursor+Math.min(.1,Math.max(0,(now-last)/1000))*timeScale);last=now;showReplay(cursor);if(cursor>=range.last){stopReplay();notify();}else replayTimer=setTimeout(tick,16);};replayTimer=setTimeout(tick,16);},
  pauseReplay(){stopReplay();notify();},get replayPlaying(){return replayPlaying;},
  live(){stopReplay();replayTime=undefined;frameChanged(client?frame:null);notify();},
  snapshot:()=>structuredClone(frame),
  get state(){return {state:preparing?'preparing':playing||externalOwner?'running':client||replayTime!==undefined?'paused':'idle',program,error,time:frame.time};},
  dispose(){if(disposed)return;if(program){program=false;interruptProgram?.();}reset(true);disposed=true;unsubscribe();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',blur);}
 };
}
