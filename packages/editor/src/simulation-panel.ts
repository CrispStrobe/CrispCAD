// SPDX-License-Identifier: BSD-3-Clause
import {getLocale,t} from '@brickwright/cad-core';
import type {CadSession} from '@brickwright/cad-core';
import {createSimulationClient} from './simulation-client.js';
import type {SimulationFrame,SimulationPose} from './simulation-protocol.js';
/** Preview state lives outside the document and undo history. */
export function mountSimulationPanel(parent:HTMLElement,session:CadSession,wasmURL:string,ready:()=>Promise<unknown>,poses:(value:SimulationPose[]|null)=>void){
 const panel=document.createElement('section');panel.hidden=true;panel.className='simulation-panel';panel.setAttribute('aria-label',t('Assembly simulation'));
 Object.assign(panel.style,{position:'absolute',right:'12px',bottom:'48px',zIndex:'12',background:'#fff',color:'#172a36',border:'1px solid #94a3b8',borderRadius:'8px',padding:'12px',maxHeight:'60%',overflow:'auto',maxWidth:'calc(100% - 48px)',boxShadow:'0 4px 16px #0003'});
 parent.append(panel);
 const heading=document.createElement('strong');heading.textContent=t('Assembly simulation');panel.append(heading);
 const note=document.createElement('p');note.textContent=t('Drive existing hinge joints. Preview changes do not alter the design.');panel.append(note);
 const controls=document.createElement('div');controls.style.display='flex';controls.style.gap='6px';controls.style.flexWrap='wrap';panel.append(controls);
 const add=(label:string,action:()=>unknown)=>{const b=document.createElement('button');b.type='button';b.textContent=t(label);b.setAttribute('aria-label',t(label));b.onclick=()=>{Promise.resolve().then(action).catch(fail);};controls.append(b);return b;};
 const run=add('Run simulation',start),pauseButton=add('Pause simulation',pause),stop=add('Stop motors',stopMotors),resetButton=add('Reset simulation',reset);add('Close simulation',()=>{reset();panel.hidden=true;});
 const baseLabel=document.createElement('label'),base=document.createElement('input');base.type='checkbox';base.checked=true;baseLabel.append(base,document.createTextNode(t('Fix first body as base')));panel.append(baseLabel);
 base.onchange=reset;
 const joints=document.createElement('div');panel.append(joints);
 const status=document.createElement('p');status.setAttribute('role','status');panel.append(status);
 let client:ReturnType<typeof createSimulationClient>|undefined,generation=0,playing=false,starting=false,disposed=false,raf=0,previous=0,accumulator=0;
 const rows=new Map<string,{speed:HTMLInputElement;torque:HTMLInputElement;angle:HTMLOutputElement}>();
 function update(){run.disabled=playing||starting;pauseButton.disabled=!playing;stop.disabled=!client||starting;resetButton.disabled=!client&&!starting;base.disabled=!!client||starting;panel.dataset.state=starting?'preparing':playing?'running':client?'paused':'idle';}
 function show(frame:SimulationFrame){poses(frame.poses);panel.dataset.time=String(frame.time);for(const [id,row]of rows)row.angle.value=`${(frame.angles[id]??0).toFixed(1)}°`;}
 function pause(){playing=false;cancelAnimationFrame(raf);previous=0;accumulator=0;update();}
 function reset(){generation++;pause();client?.dispose();client=undefined;starting=false;poses(null);delete panel.dataset.time;for(const row of rows.values())row.angle.value='0.0°';status.textContent='';update();}
 function fail(error:unknown){if(disposed)return;reset();status.textContent=error instanceof Error?error.message:String(error);}
 async function motor(id:string){const row=rows.get(id)!;const speedDps=Number(row.speed.value),torqueNm=Number(row.torque.value);if(!Number.isFinite(speedDps)||Math.abs(speedDps)>720||!Number.isFinite(torqueNm)||torqueNm<=0||torqueNm>100)throw new Error(t('Enter a speed from -720 to 720 and a torque above 0 up to 100 Nm'));if(client&&!starting)await client.send({op:'motor',id,speedDps,torqueNm});}
 async function start(){
  if(playing||starting||disposed)return;
  const token=generation;
  try{
   if(!client){starting=true;update();status.textContent=t('Preparing simulation');await ready();if(disposed||token!==generation)return;
    client=createSimulationClient();const frame=await client.send({op:'start',document:structuredClone(session.state.document),wasmURL:new URL(wasmURL,document.baseURI).href,fixBase:base.checked,locale:getLocale()});if(disposed||token!==generation)return;show(frame);starting=false;
    for(const id of rows.keys())await motor(id);
   }
   if(disposed||token!==generation)return;playing=true;previous=0;accumulator=0;status.textContent='';update();raf=requestAnimationFrame(tick);
  }catch(error){if(token===generation)fail(error);}
 }
 async function tick(now:number){
  if(!playing||!client)return;const token=generation;
  if(document.hidden||!panel.getClientRects().length){pause();return;}
  accumulator+=previous?Math.min((now-previous)/1000,.05):0;previous=now;
  const steps=Math.min(10,Math.floor(accumulator/.005));
  try{if(steps){accumulator-=steps*.005;const frame=await client.send({op:'step',seconds:steps*.005});if(token!==generation||disposed)return;show(frame);}
   if(playing)raf=requestAnimationFrame(tick);
  }catch(error){if(token===generation)fail(error);}
 }
 async function stopMotors(){for(const row of rows.values())row.speed.value='0';if(client)await client.send({op:'stop-motors'});}
 function rebuild(){joints.replaceChildren();rows.clear();
  const hinges=(session.state.document.joints??[]).filter(j=>j.kind==='hinge');
  if(!hinges.length){const p=document.createElement('p');p.textContent=t('This assembly has no hinge joints. Add a hinge joint to control a motor.');joints.append(p);}
  for(const joint of hinges){const row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=joint.id;row.append(legend);
   const input=(label:string,value:string,min:string,max:string,step:string)=>{const l=document.createElement('label'),i=document.createElement('input');i.type='number';i.value=value;i.min=min;i.max=max;i.step=step;i.style.width='90px';i.setAttribute('aria-label',`${joint.id}: ${t(label)}`);l.append(document.createTextNode(t(label)),i);row.append(l);return i;};
   const speed=input('Speed (degrees/s)','0','-720','720','15'),torque=input('Torque limit (Nm)','0.02','0.001','100','0.01'),angle=document.createElement('output');angle.value='0.0°';angle.setAttribute('aria-label',`${joint.id}: ${t('Joint angle')}`);row.append(angle);rows.set(joint.id,{speed,torque,angle});speed.onchange=torque.onchange=()=>{void motor(joint.id).catch(fail);};joints.append(row);
  }
 }
 let revision=session.state.revision;
 const unsubscribe=session.subscribe(state=>{if(state.revision!==revision){revision=state.revision;reset();rebuild();}});
 const hidden=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',pause);
 rebuild();update();
 return {open(){panel.hidden=false;},reset,pause,get active(){return !!client||starting;},dispose(){disposed=true;reset();unsubscribe();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',pause);panel.remove();}};
}
