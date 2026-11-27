// SPDX-License-Identifier: BSD-3-Clause
import type {GeometryResult} from '@brickwright/cad-geometry';
import {t} from '@brickwright/cad-core';
import type {CadSession,Vec3} from '@brickwright/cad-core';
import {createSimulationController} from './simulation-controller.js';
import {mountSimulationAuthoring} from './simulation-authoring.js';
import {createSimulationVideo} from './simulation-video.js';
import type {SimulationPoint} from './simulation-authoring.js';
import type {TracePath} from './motion-traces.js';
import type {SimulationFrame,SimulationPose} from './simulation-protocol.js';
export interface SimulationViewOptions {connectorHandles?:(visible:boolean)=>void;dragEnabled?:(enabled:boolean)=>void;pickPoint?:(done:(point:SimulationPoint|null)=>void)=>()=>void;traces?:(paths:TracePath[])=>void;onInterrupt?:()=>void;onExport?:(file:{name:string;bytes:Uint8Array;mime:string})=>unknown;canvas?:HTMLCanvasElement}
export function mountSimulationPanel(parent:HTMLElement,session:CadSession,wasmURL:string,ready:()=>Promise<GeometryResult|void>,poses:(value:SimulationPose[]|null)=>void,view:SimulationViewOptions={}){
 const panel=document.createElement('section');panel.hidden=true;panel.className='simulation-panel';panel.setAttribute('aria-label',t('Assembly simulation'));
 Object.assign(panel.style,{position:'absolute',right:'12px',bottom:'48px',zIndex:'12',background:'var(--cad-panel)',color:'var(--cad-text)',border:'1px solid var(--cad-border)',borderRadius:'8px',padding:'12px',maxHeight:'65%',overflow:'auto',width:'360px',maxWidth:'calc(100% - 48px)',boxShadow:'0 4px 16px #0003'});parent.append(panel);
 const style=document.createElement('style');style.textContent='.simulation-panel[hidden],.simulation-panel [hidden]{display:none!important}.simulation-panel fieldset{min-width:0;border:1px solid #c5cdd5;margin:8px 0;display:flex;flex-direction:column;gap:6px}.simulation-panel label{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}.simulation-panel select{min-width:0;max-width:100%}.simulation-panel details{margin:8px 0}.simulation-panel output{display:block;font-variant-numeric:tabular-nums}.simulation-panel button{margin:2px}.simulation-panel small{display:block}';panel.append(style);
 const header=document.createElement('header');Object.assign(header.style,{display:'flex',alignItems:'center',gap:'6px',position:'sticky',top:'-12px',background:'var(--cad-panel)',zIndex:'1',padding:'6px 0'});const heading=document.createElement('strong');heading.textContent=t('Assembly simulation');heading.style.flex='1';header.append(heading);panel.append(header);
 const note=document.createElement('p');note.textContent=t('Simulate gravity, collisions and connectors. Preview changes do not alter the design.');panel.append(note);
 const controls=document.createElement('div');Object.assign(controls.style,{display:'flex',gap:'6px',flexWrap:'wrap'});panel.append(controls);
 const add=(label:string,action:()=>unknown,host:HTMLElement=controls)=>{const b=document.createElement('button');b.type='button';b.textContent=t(label);b.setAttribute('aria-label',t(label));b.onclick=()=>{Promise.resolve().then(action).catch(fail);};host.append(b);return b;};
 let compact=false;const compactToggle=document.createElement('button');compactToggle.type='button';Object.assign(compactToggle.style,{minWidth:'44px',height:'44px',fontSize:'22px'});header.append(compactToggle);
 function setCompact(value:boolean){compact=value;panel.dataset.compact=String(value);compactToggle.textContent=value?'＋':'−';compactToggle.setAttribute('aria-label',t(value?'Expand simulation controls':'Minimize simulation controls'));compactToggle.title=compactToggle.getAttribute('aria-label')!;const keep=new Set<HTMLElement>([header,controls,status,style]);for(const child of [...panel.children])if(child instanceof HTMLElement&&!keep.has(child))child.hidden=value;}
 compactToggle.setAttribute('aria-label',t('Minimize simulation controls'));compactToggle.title=t('Minimize simulation controls');compactToggle.textContent='−';compactToggle.onclick=()=>setCompact(!compact);
 const interrupt=()=>{if(controller.state.program)view.onInterrupt?.();};
 const run=add('Run simulation',async()=>{const desired=[...rows].map(([id,row])=>({id,kind:row.kind,speed:Number(row.speed.value),limit:Number(row.limit.value),enabled:row.enabled.checked}));await controller.prepare();for(const value of desired)await(value.enabled?(value.kind==='hinge'?controller.setMotor(value.id,value.speed,value.limit,false):controller.setSlider(value.id,value.speed,value.limit,false)):(value.kind==='hinge'?controller.stopMotor(value.id,'coast'):controller.stopSlider(value.id,'coast')));await controller.start();});
 const pauseButton=add('Pause simulation',()=>{interrupt();controller.pause();}),step=add('Step simulation',()=>controller.step()),stop=add('Stop motors',()=>{interrupt();return controller.stopMotors();}),resetButton=add('Reset simulation',()=>{interrupt();controller.reset();});const closeButton=add('Close simulation',close,header);closeButton.textContent='×';Object.assign(closeButton.style,{minWidth:'44px',height:'44px',fontSize:'24px'});
 function close(){panel.hidden=true;try{interrupt();video?.stop();controller.reset();}catch(error){fail(error);}finally{panel.hidden=true;panel.setAttribute('aria-hidden','true');view.connectorHandles?.(false);view.dragEnabled?.(false);view.canvas?.focus({preventScroll:true});}}
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
 const label=document.createElement('label'),speed=document.createElement('select');label.textContent=t('Playback speed');speed.setAttribute('aria-label',t('Playback speed'));for(const value of [.1,.25,.5,1,2]){const option=document.createElement('option');option.value=String(value);option.textContent=`${value}×`;speed.append(option);}speed.value='1';label.append(speed);panel.append(label);speed.onchange=()=>controller.setTimeScale(Number(speed.value));
 const replayLabel=document.createElement('label'),replay=document.createElement('input');replay.type='range';replay.min='0';replay.max='0';replay.step='.05';replay.value='0';replay.setAttribute('aria-label',t('Replay time'));replayLabel.append(document.createTextNode(t('Replay time')),replay);panel.append(replayLabel);replay.oninput=()=>{try{controller.seekReplay(Number(replay.value));}catch(error){fail(error);}};
 const historyControls=document.createElement('div');panel.append(historyControls);const replayPlay=add('Play recorded motion',()=>controller.replayPlaying?controller.pauseReplay():controller.playReplay(),historyControls);const previous=add('Previous recorded frame',()=>controller.previousFrame(),historyControls),live=add('Return to latest state',()=>controller.live(),historyControls);
 const replayHint=document.createElement('small');replayHint.textContent=t('Replay shows recorded poses. Run resumes from the latest simulation state.');panel.append(replayHint);
 const elapsed=document.createElement('output');elapsed.setAttribute('aria-label',t('Simulation time'));elapsed.setAttribute('aria-live','off');elapsed.value='0.000 s';panel.append(elapsed);
 const checkbox=(text:string,action:(value:boolean)=>void)=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';label.append(input,document.createTextNode(t(text)));input.onchange=()=>{try{action(input.checked);}catch(e){fail(e);}};panel.append(label);return input;};
 const dragging=checkbox('Drag simulated bodies',()=>view.dragEnabled?.(dragging.checked&&controller.state.state==='running'));dragging.checked=true;
 const base=checkbox('Fix first body as base',value=>controller.setFixBase(value)),rigid=checkbox('Rigid geometry preview',value=>controller.setRigidPreview(value));
 const rigidHint=document.createElement('small');rigidHint.textContent=t('Rigid preview does not model elastic springs or unconfigured mechanical couplings.');panel.append(rigidHint);
 const joints=document.createElement('div');panel.append(joints);const status=document.createElement('p');status.setAttribute('role','status');panel.append(status);
 const rows=new Map<string,{kind:'hinge'|'slider';speed:HTMLInputElement;limit:HTMLInputElement;enabled:HTMLInputElement;position:HTMLOutputElement}>();
 let displayedFrame:SimulationFrame|null=null,hasTraceSamples=false;
 const controller=createSimulationController(session,wasmURL,ready,update,frame=>{
  displayedFrame=frame;
  poses(frame?.poses??null);
  const paths=controller.tracePaths();
  view.traces?.(paths);
  hasTraceSamples=paths.some(path=>path.samples.length);
  if(!panel.hidden){updateReadouts();updateReplayControls();}
 },view.onInterrupt);
 function updateReadouts(){
  const frame=displayedFrame;
  if(frame)panel.dataset.time=String(frame.time);
  else delete panel.dataset.time;
  elapsed.value=`${(frame?.time??0).toFixed(3)} s`;
  for(const [id,row]of rows)row.position.value=row.kind==='hinge'
   ?`${(frame?.angles[id]??0).toFixed(1)}°`
   :`${(frame?.linearPositions[id]??0).toFixed(2)} mm`;
  csv.disabled=!hasTraceSamples;
 }
 const authoring=mountSimulationAuthoring(panel,session,fail,view.pickPoint?done=>{const previous=compact;setCompact(true);const cancel=view.pickPoint!(point=>{setCompact(previous);done(point);});return()=>{cancel();setCompact(previous);};}:undefined);
 const recording=document.createElement('div');panel.append(recording);
 const deliver=(file:{name:string;bytes:Uint8Array;mime:string})=>{if(view.onExport)return view.onExport(file);const url=URL.createObjectURL(new Blob([file.bytes.slice().buffer],{type:file.mime})),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
 const csv=add('Export motion CSV',()=>deliver({name:'motion-traces.csv',bytes:new TextEncoder().encode(controller.traceCSV()),mime:'text/csv'}),recording);csv.disabled=true;
 add('Clear motion trails',()=>{controller.clearTraces();view.traces?.(controller.tracePaths());},recording);
 const video=view.canvas?createSimulationVideo(view.canvas,deliver,()=>{if(recordButton){const label=t(video?.recording?'Save video':'Record simulation');recordButton.textContent=label;recordButton.setAttribute('aria-label',label);}},fail):undefined;
 const recordButton=video?.available?add('Record simulation',async()=>{if(video.recording)video.stop();else{if(!controller.replayPlaying)await controller.start();video.start();}},recording):undefined;
 const launch=document.createElement('details'),launchTitle=document.createElement('summary');launchTitle.textContent=t('Throw selected body');launch.append(launchTitle);panel.append(launch);
 const velocities=['X','Y','Z'].map(axis=>{const label=document.createElement('label'),input=document.createElement('input');label.textContent=t(`Launch velocity ${axis} (mm/s)`);input.setAttribute('aria-label',t(`Launch velocity ${axis} (mm/s)`));input.type='number';input.min='-10000';input.max='10000';input.value=axis==='X'?'500':axis==='Z'?'300':'0';input.style.width='80px';label.append(input);launch.append(label);return input;});
 add('Throw selected body',()=>{const ids=session.state.selection.filter(id=>session.state.document.roots.includes(id));if(ids.length!==1)throw new Error(t('Select one physical body to throw'));return controller.throwBody(ids[0],velocities.map(input=>Number(input.value)) as Vec3);},launch);
 const ballPosition=['X','Y','Z'].map(axis=>{const l=document.createElement('label'),i=document.createElement('input');i.type='number';i.value=axis==='Y'?'-60':axis==='Z'?'80':'0';l.textContent=t(`Preview position ${axis} (mm)`);i.setAttribute('aria-label',t(`Preview position ${axis} (mm)`));l.append(i);launch.append(l);return i;});
 const shapeLabel=document.createElement('label'),shape=document.createElement('select');shapeLabel.append(document.createTextNode(t('Preview object')),shape);shape.setAttribute('aria-label',t('Preview object'));for(const [id,label]of [['sphere','Ball'],['box','Box']]){const option=document.createElement('option');option.value=id;option.textContent=t(label);shape.append(option);}launch.append(shapeLabel);
 const sizeLabel=document.createElement('label'),size=document.createElement('input');size.type='number';size.value='12';size.min='2';size.max='100';sizeLabel.append(document.createTextNode(t('Preview diameter or edge (mm)')),size);size.setAttribute('aria-label',t('Preview diameter or edge (mm)'));launch.append(sizeLabel);
 add('Throw preview object',()=>controller[shape.value==='box'?'throwBox':'throwBall'](ballPosition.map(i=>Number(i.value)) as Vec3,velocities.map(i=>Number(i.value)) as Vec3,Number(size.value)/2),launch);
 function updateReplayControls(){const range=controller.replayRange();replay.min=String(range.first);replay.max=String(range.last);replay.value=String(controller.replayTime??range.last);replay.disabled=previous.disabled=range.count<2;live.disabled=controller.replayTime===undefined;replayPlay.disabled=range.count<2;const replayLabel=t(controller.replayPlaying?'Pause replay':'Play recorded motion');replayPlay.textContent=replayLabel;replayPlay.setAttribute('aria-label',replayLabel);}
 function update(){
  const state=controller.state;
  view.connectorHandles?.(!panel.hidden&&state.state==='idle');
  view.dragEnabled?.(dragging.checked&&state.state==='running');
  if(panel.hidden)return;
  updateReplayControls();panel.dataset.state=state.state;panel.dataset.owner=state.program?'program':'manual';run.disabled=['running','preparing'].includes(state.state);pauseButton.disabled=state.state!=='running';step.disabled=['running','preparing'].includes(state.state);stop.disabled=state.state==='idle'||state.state==='preparing';resetButton.disabled=state.state==='idle';base.disabled=rigid.disabled=state.state!=='idle';base.checked=controller.fixBase;rigid.checked=controller.rigidPreview;authoring.setDisabled(state.state!=='idle');status.textContent=state.error||(state.state==='preparing'?t('Preparing simulation'):'');for(const [id,row]of rows){const exists=(row.kind==='hinge'?controller.motors():controller.sliders()).some(m=>m.id===id);if(!exists)continue;const value=row.kind==='hinge'?controller.setting(id):controller.sliderSetting(id);if(state.state!=='idle'){row.enabled.checked=value.enabled;if((row.speed.getRootNode() as ShadowRoot).activeElement!==row.speed&&document.activeElement!==row.speed)row.speed.value=String(value.speed);}}
 }
 function fail(error:unknown){status.textContent=error instanceof Error?error.message:String(error);}
 function rebuild(){joints.replaceChildren();rows.clear();const motors=[...controller.motors().map(m=>({...m,kind:'hinge' as const})),...controller.sliders().map(m=>({...m,kind:'slider' as const}))];
  for(const motor of motors){const row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=`${motor.port} · ${motor.name}`;row.append(legend);
   const portLabel=document.createElement('label'),port=document.createElement('input');port.value=session.state.document.joints?.find(j=>j.id===motor.id)?.control?.port??'';port.placeholder='A';port.maxLength=16;port.setAttribute('aria-label',`${motor.id}: ${t('Program motor port')}`);portLabel.append(document.createTextNode(t('Program motor port')),port);row.append(portLabel);port.onchange=()=>{try{session.setMotorPort(motor.id,port.value.trim().toUpperCase()||null);}catch(error){fail(error);}};
   const input=(label:string,value:string,min:string,max:string,step:string)=>{const l=document.createElement('label'),i=document.createElement('input');i.type='number';i.value=value;i.min=min;i.max=max;i.step=step;i.style.width='90px';i.setAttribute('aria-label',`${motor.id}: ${t(label)}`);l.append(document.createTextNode(t(label)),i);row.append(l);return i;};
   const enabledLabel=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';enabled.setAttribute('aria-label',`${motor.id}: ${t('Drive joint')}`);enabledLabel.append(enabled,document.createTextNode(t('Drive joint')));row.append(enabledLabel);
   const linear=motor.kind==='slider',speed=input(linear?'Speed (mm/s)':'Speed (degrees/s)','0',linear?'-1000':'-720',linear?'1000':'720',linear?'10':'15'),limit=input(linear?'Force limit (N)':'Torque limit (Nm)',linear?'10':'0.02','0.001',linear?'10000':'100','0.01'),position=document.createElement('output');position.value=linear?'0.00 mm':'0.0°';position.setAttribute('aria-live','off');position.setAttribute('aria-label',`${motor.id}: ${t(linear?'Slider position':'Joint angle')}`);row.append(position);rows.set(motor.id,{kind:motor.kind,speed,limit,enabled,position});const applyDrive=()=>{if(controller.state.state==='idle')return;void(enabled.checked?(linear?controller.setSlider(motor.id,Number(speed.value),Number(limit.value),false):controller.setMotor(motor.id,Number(speed.value),Number(limit.value),false)):(linear?controller.stopSlider(motor.id,'coast'):controller.stopMotor(motor.id,'coast'))).catch(fail);};speed.onchange=()=>{enabled.checked=true;applyDrive();};limit.onchange=enabled.onchange=applyDrive;joints.append(row);
  }
 }
 let revision=session.state.revision;const unsubscribe=session.subscribe(state=>{if(state.revision!==revision){revision=state.revision;rebuild();update();}});rebuild();update();
 return {...controller,close,open(){panel.hidden=false;panel.removeAttribute('aria-hidden');updateReadouts();update();},get active(){return controller.state.state!=='idle';},get state(){return controller.state;},get fixBase(){return controller.fixBase;},get rigidPreview(){return controller.rigidPreview;},get replayPlaying(){return controller.replayPlaying;},get replayTime(){return controller.replayTime;},get timeScale(){return controller.timeScale;},dispose(){view.connectorHandles?.(false);unsubscribe();authoring.dispose();video?.dispose();controller.dispose();panel.remove();}};
}
