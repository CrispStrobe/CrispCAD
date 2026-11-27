// SPDX-License-Identifier: BSD-3-Clause
// The Assembly dialog (Phase 6.4): groups and suppression, exploded views, configurations and the
// mechanism check, with a bar over the 3D view that shows an exploded view or a joint's pose on a
// slider (and plays it). The bar only moves the displayed meshes; the model stays where it is.
// Touch first: selects, number fields, sliders and 44 px buttons, so it works on an iPad without a
// keyboard.
import {createPlanetaryDocument,explodeOffsets,formatMechanismReport,groupBodies,listJoints,mechanismPose,newId,planExplodedView,planMechanism,t} from '@brickwright/cad-core';
import type {CadDocument,CadSession,ExplodeBodyBounds,MechanismReport,MechanismSettings,RigidMotion,Vec3} from '@brickwright/cad-core';

export interface AssemblyPanelHost {
 /** Evaluated bounds of the bodies in the model now (for planning an exploded view). */
 bounds(doc:CadDocument,signal?:AbortSignal):Promise<ExplodeBodyBounds[]>;
 mechanism(doc:CadDocument,settings:MechanismSettings,signal:AbortSignal):Promise<MechanismReport>;
 /** Moves displayed meshes (world motions per body); null shows the model as it is. */
 present(motions:ReadonlyMap<string,RigidMotion>|null):void;
}
type Tab='groups'|'explode'|'configurations'|'mechanism';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text?:string)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
const button=(label:string,click:()=>void,className='')=>{const b=el('button',className,label);b.type='button';b.onclick=click;return b;};
const translationOnly=(offsets:ReadonlyMap<string,Vec3>)=>new Map([...offsets].map(([id,d])=>[id,[1,0,0,d[0],0,1,0,d[1],0,0,1,d[2]] as RigidMotion]));

export function mountAssemblyPanel(shell:HTMLElement,viewHost:HTMLElement,session:CadSession,host:AssemblyPanelHost){
 const dialog=el('dialog','export-dialog assembly-dialog');dialog.setAttribute('aria-label',t('Assembly'));
 const heading=el('h2','',t('Assembly'));
 const tabs=el('div','assembly-tabs');tabs.setAttribute('role','tablist');
 const body=el('div','assembly-body');
 const status=el('p','assembly-status');status.setAttribute('aria-live','polite');
 const footer=el('footer'),close=button(t('Close'),()=>dialog.close());footer.append(close);
 dialog.append(heading,tabs,body,status,footer);
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 shell.append(dialog);
 let tab:Tab='groups';
 const tabButtons=new Map<Tab,HTMLButtonElement>();
 for(const [key,label] of [['groups','Groups'],['explode','Exploded view'],['configurations','Configurations'],['mechanism','Mechanism']] as const){
  const b=button(t(label),()=>{tab=key;render();});b.setAttribute('role','tab');b.dataset.tab=key;tabButtons.set(key,b);tabs.append(b);
 }
 const report=(message:string,error=false)=>{status.textContent=message;status.dataset.error=String(error);};
 const attempt=(fn:()=>unknown)=>{try{const result=fn();if(typeof result==='string')report(result);render();}catch(error){report(error instanceof Error?error.message:String(error),true);}};
 const doc=()=>session.state.document;
 const name=(id:string)=>doc().nodes[id]?.name??id;

 // --- The bar over the 3D view: an exploded view or a joint pose on a slider -----------------
 const bar=el('div','manufacturing-finding-bar assembly-bar');bar.hidden=true;bar.setAttribute('role','toolbar');bar.setAttribute('aria-label',t('Assembly presentation'));
 const barLabel=el('span','manufacturing-finding-text'),slider=el('input');slider.type='range';slider.min='0';slider.max='1000';slider.value='0';slider.className='assembly-slider';slider.setAttribute('aria-label',t('Explosion'));
 const play=button(t('Play'),()=>togglePlay()),back=button(t('Back to assembly'),()=>{endBar();dialog.showModal();render();}),done=button(t('Done'),()=>endBar(),'primary');
 bar.append(barLabel,slider,play,back,done);viewHost.append(bar);
 let barMode:{kind:'explode';view:string}|{kind:'pose';joint:string;range:[number,number];unit:'deg'|'mm'}|undefined,frame=0,playing=false,started=0;
 const sliderValue=()=>Number(slider.value)/1000;
 function showBar(){
  if(!barMode)return;
  const f=sliderValue();
  if(barMode.kind==='explode'){
   const view=doc().assembly?.views?.find(v=>v.id===(barMode as {view:string}).view);
   if(!view){endBar();return;}
   barLabel.textContent=t`${view.name}: ${Math.round(f*100)} %`;
   host.present(translationOnly(explodeOffsets(doc(),view.id,f)));
  }else{
   const value=barMode.range[0]+(barMode.range[1]-barMode.range[0])*f;
   try{
    const plan=planMechanism(doc(),barMode.joint,barMode.range);
    host.present(mechanismPose(doc(),plan,value));
    barLabel.textContent=t`Joint pose: ${barMode.unit==='deg'?`${value.toFixed(1)}°`:`${value.toFixed(2)} mm`}`;
   }catch(error){barLabel.textContent=error instanceof Error?error.message:String(error);}
  }
  bar.dataset.value=f.toFixed(3);
 }
 function togglePlay(){
  playing=!playing;play.textContent=playing?t('Pause'):t('Play');
  if(!playing){cancelAnimationFrame(frame);return;}
  if(sliderValue()>=1)slider.value='0';
  started=performance.now()-sliderValue()*2500;
  const step=(now:number)=>{if(!playing)return;const f=Math.min(1,(now-started)/2500);slider.value=String(Math.round(f*1000));showBar();if(f>=1){playing=false;play.textContent=t('Play');return;}frame=requestAnimationFrame(step);};
  frame=requestAnimationFrame(step);
 }
 slider.addEventListener('input',()=>{if(playing){playing=false;cancelAnimationFrame(frame);play.textContent=t('Play');}showBar();});
 function startBar(mode:NonNullable<typeof barMode>,value=0){barMode=mode;slider.value=String(Math.round(value*1000));bar.hidden=false;bar.dataset.mode=mode.kind;dialog.close();showBar();}
 function endBar(){playing=false;cancelAnimationFrame(frame);play.textContent=t('Play');barMode=undefined;bar.hidden=true;host.present(null);}

 // --- Tabs ----------------------------------------------------------------------------------
 let mechanismReport:MechanismReport|undefined,controller:AbortController|undefined;
 function render(){
  for(const [key,b] of tabButtons){b.setAttribute('aria-selected',String(key===tab));b.classList.toggle('primary',key===tab);}
  body.replaceChildren();body.dataset.tab=tab;
  if(tab==='groups')renderGroups();else if(tab==='explode')renderExplode();else if(tab==='configurations')renderConfigurations();else renderMechanism();
 }
 function renderGroups(){
  const a=doc().assembly,groups=a?.groups??[],off=new Set(a?.suppressed??[]);
  const tree=el('ul','assembly-tree');
  const bodyRow=(id:string)=>{const li=el('li','assembly-body-row');li.dataset.body=id;
   const label=button(name(id),()=>session.select([id]),'assembly-name');if(off.has(id))label.classList.add('suppressed');
   li.append(label,button(off.has(id)?t('Unsuppress'):t('Suppress'),()=>attempt(()=>{session.setSuppressed([id],!off.has(id));return off.has(id)?t`${name(id)} is back in the model.`:t`${name(id)} is suppressed.`;})));return li;};
  const visit=(parent:string|undefined,into:HTMLElement)=>{
   for(const g of groups.filter(x=>x.parent===parent)){
    const li=el('li','assembly-group-row');li.dataset.group=g.id;
    const head=el('div','assembly-group-head');
    head.append(button(`▸ ${g.name} (${groupBodies(a,g.id).length})`,()=>session.select(groupBodies(a,g.id)),'assembly-name'),
     button(t('Rename'),()=>{const value=prompt(t('Group name'),g.name);if(value!==null)attempt(()=>{session.renameGroup(g.id,value);return t`Renamed the group to ${value}.`;});}),
     button(t('Ungroup'),()=>attempt(()=>{session.ungroup(g.id);return t`Dissolved the group ${g.name}.`;})));
    const children=el('ul');visit(g.id,children);g.members.forEach(m=>children.append(bodyRow(m)));
    li.append(head,children);into.append(li);
   }
  };
  visit(undefined,tree);
  const grouped=new Set(groups.flatMap(g=>g.members));
  doc().roots.filter(id=>!grouped.has(id)).forEach(id=>tree.append(bodyRow(id)));
  const make=el('div','assembly-row'),groupName=el('input');groupName.placeholder=t('Group name');groupName.setAttribute('aria-label',t('Group name'));groupName.value=t('Group');
  make.append(groupName,button(t('Group selected bodies'),()=>attempt(()=>{const ids=session.state.selection.filter(id=>doc().roots.includes(id));if(!ids.length)throw new Error(t('Select top-level bodies to group'));session.groupBodies(groupName.value,ids);return t`Grouped ${ids.length} bodies as ${groupName.value}.`;}),'primary'));
  body.append(el('p','assembly-hint',t('Tap a group or body to select it. Suppressed bodies are left out of the model (not built, exported, simulated or drawn) until you put them back.')),tree,make);
 }
 function renderExplode(){
  const views=doc().assembly?.views??[];
  const list=el('ul','assembly-list');
  for(const v of views){const li=el('li','assembly-row');li.dataset.view=v.id;li.append(el('span','',t`${v.name} · ${v.steps.length} steps`),button(t('Show'),()=>startBar({kind:'explode',view:v.id},1),'primary'),button(t('Delete'),()=>attempt(()=>{session.removeExplodedView(v.id);return t`Deleted the exploded view ${v.name}.`;})));list.append(li);}
  if(!views.length)list.append(el('li','assembly-hint',t('No exploded views yet.')));
  const form=el('div','assembly-form');
  const mode=el('select');mode.setAttribute('aria-label',t('Explode mode'));for(const [value,label] of [['axis','Along an axis'],['radial','Away from the centre']] as const){const o=el('option','',t(label));o.value=value;mode.append(o);}
  const axis=el('select');axis.setAttribute('aria-label',t('Axis'));for(const key of ['+Z','-Z','+X','-X','+Y','-Y']){const o=el('option','',key);o.value=key;axis.append(o);}
  const groups=doc().assembly?.groups??[],within=el('select');within.setAttribute('aria-label',t('Explode inside'));const top=el('option','',t('The whole design'));top.value='';within.append(top);for(const g of groups){const o=el('option','',g.name);o.value=g.id;within.append(o);}
  const spacing=el('input');spacing.type='number';spacing.min='0';spacing.step='1';spacing.inputMode='decimal';spacing.placeholder=t('auto');spacing.setAttribute('aria-label',t('Spacing (mm)'));
  const labelled=(text:string,input:HTMLElement)=>{const l=el('label','',text);l.append(input);return l;};
  const create=button(t('New exploded view'),()=>void (async()=>{
   create.disabled=true;report(t('Planning…'));
   try{
    const vectors:Record<string,Vec3>={'+Z':[0,0,1],'-Z':[0,0,-1],'+X':[1,0,0],'-X':[-1,0,0],'+Y':[0,1,0],'-Y':[0,-1,0]};
    const revision=session.state.revision,bounds=await host.bounds(doc());
    if(session.state.revision!==revision)throw new Error(t('The model changed while planning the exploded view. Run explode auto again.'));
    const view=planExplodedView(doc(),bounds,{mode:mode.value as 'axis'|'radial',axis:vectors[axis.value],...(spacing.value.trim()?{spacing:Number(spacing.value)}:{}),...(within.value?{group:within.value}:{})},newId);
    session.setExplodedView(view);
    report(t`Made the exploded view ${view.name}: ${view.steps.length} steps.`);
    startBar({kind:'explode',view:view.id},1);
   }catch(error){report(error instanceof Error?error.message:String(error),true);render();}
   finally{create.disabled=false;}
  })(),'primary');
  form.append(labelled(t('Mode'),mode),labelled(t('Axis'),axis),labelled(t('Explode inside'),within),labelled(t('Spacing (mm)'),spacing),create);
  body.append(el('p','assembly-hint',t('An exploded view moves groups and bodies apart for display and drawings; the model does not move. Show it to slide or play the explosion.')),list,form);
 }
 function renderConfigurations(){
  const a=doc().assembly,configs=a?.configurations??[];
  const list=el('ul','assembly-list');
  for(const c of configs){
   const li=el('li','assembly-row');li.dataset.configuration=c.name;
   const text=`${c.id===a?.active?'✓ ':''}${c.name}: ${Object.entries(c.parameters).map(([k,v])=>`${k} = ${v}`).join(', ')||t('no parameters')}${c.suppressed.length?t`; ${c.suppressed.length} suppressed`:''}`;
   li.append(el('span','',text),button(t('Use'),()=>attempt(()=>{session.useConfiguration(c.id);return t`Switched to the configuration ${c.name}.`;}),'primary'),button(t('Delete'),()=>attempt(()=>{session.removeConfiguration(c.id);return t`Deleted the configuration ${c.name}.`;})));
   list.append(li);
  }
  if(!configs.length)list.append(el('li','assembly-hint',t('No configurations yet.')));
  const save=el('div','assembly-row'),configName=el('input');configName.placeholder=t('Configuration name');configName.setAttribute('aria-label',t('Configuration name'));
  save.append(configName,button(t('Save current as configuration'),()=>attempt(()=>{if(!configName.value.trim())throw new Error(t('Name the configuration (at most 160 characters)'));session.saveConfiguration(configName.value);return t`Saved the configuration ${configName.value.trim()}: the current parameters and suppressed bodies.`;}),'primary'));
  body.append(el('p','assembly-hint',t('A configuration keeps the values of every parameter and which bodies are suppressed. Change parameters (Parameters panel) and suppression (Groups), then save; Use switches in one Undo step.')),list,save);
 }
 function renderMechanism(){
  const joints=doc().joints??[];
  if(!joints.length){body.append(el('p','assembly-hint',t('The design has no joints. Add hinges or sliders in the simulation workbench, or insert a planetary gear set.')),button(t('Insert planetary gear set'),()=>attempt(()=>{session.insert(createPlanetaryDocument(),[0,0,0],{label:'Insert planetary gear set'});return t('Inserted a planetary gear set.');}),'primary'));return;}
  const pick=el('select');pick.setAttribute('aria-label',t('Joint'));
  listJoints(doc()).split('\n').forEach((line,i)=>{const o=el('option','',line.replace(/\s+\S+$/,''));o.value=joints[i].id;pick.append(o);});
  const steps=el('input');steps.type='number';steps.min='1';steps.max='720';steps.step='1';steps.value='36';steps.inputMode='numeric';steps.setAttribute('aria-label',t('Steps'));
  const clearance=el('input');clearance.type='number';clearance.min='0';clearance.step='0.1';clearance.inputMode='decimal';clearance.placeholder=t('none');clearance.setAttribute('aria-label',t('Clearance (mm)'));
  const from=el('input'),to=el('input');for(const input of [from,to]){input.type='number';input.step='any';input.inputMode='decimal';input.placeholder=t('limit');}
  from.setAttribute('aria-label',t('From'));to.setAttribute('aria-label',t('To'));
  const labelled=(text:string,input:HTMLElement)=>{const l=el('label','',text);l.append(input);return l;};
  const results=el('div','assembly-results');results.setAttribute('aria-live','polite');
  const settings=():MechanismSettings=>({joint:pick.value,steps:Number(steps.value)||36,...(clearance.value.trim()?{clearanceMm:Number(clearance.value)}:{}),...(from.value.trim()&&to.value.trim()?{range:[Number(from.value),Number(to.value)] as [number,number]}:{})});
  const showResults=(r:MechanismReport)=>{
   results.replaceChildren();
   const text=formatMechanismReport(r).split('\n');
   results.append(el('p','',text[0]));
   if(r.clear)results.append(el('p','assembly-pass',t('No collisions at any sampled pose.')));
   const items=el('ul','manufacturing-findings');
   for(const c of r.collisions){const item=el('li'),open=button(t`${c.aName} and ${c.bName}: ${r.unit==='deg'?`${+c.firstAt.toFixed(2)}° – ${+c.lastAt.toFixed(2)}°`:`${+c.firstAt.toFixed(3)} – ${+c.lastAt.toFixed(3)} mm`}, ${+c.maxVolumeMm3.toFixed(3)} mm³`,()=>{const span=r.range[1]-r.range[0];startBar({kind:'pose',joint:r.joint,range:r.range,unit:r.unit},span?(c.firstAt-r.range[0])/span:0);},'manufacturing-finding');open.title=t('Show this pose in the 3D view');item.append(open);items.append(item);}
   for(const n of r.near)items.append(el('li','',t`Closer than the clearance: ${n.aName} and ${n.bName}, ${+n.gapMm.toFixed(3)} mm`));
   results.append(items,el('p','manufacturing-note',text.at(-1)!));
  };
  const run=button(t('Check mechanism'),()=>void (async()=>{
   controller?.abort();controller=new AbortController();run.disabled=true;results.replaceChildren(el('p','',t('Sweeping the joint…')));
   try{mechanismReport=await host.mechanism(doc(),settings(),controller.signal);showResults(mechanismReport);report('');}
   catch(error){results.replaceChildren(el('p','manufacturing-error',error instanceof Error?error.message:String(error)));}
   finally{run.disabled=false;}
  })(),'primary');
  const pose=button(t('Move on a slider'),()=>{try{const s=settings(),plan=planMechanism(doc(),s.joint,s.range);startBar({kind:'pose',joint:s.joint,range:plan.range,unit:plan.unit},0);}catch(error){report(error instanceof Error?error.message:String(error),true);}});
  const form=el('div','assembly-form');
  form.append(labelled(t('Joint'),pick),labelled(t('From'),from),labelled(t('To'),to),labelled(t('Steps'),steps),labelled(t('Clearance (mm)'),clearance),run,pose);
  body.append(el('p','assembly-hint',t('Sweeps the joint (and the gears it drives through gear meshes) through its limits, or a full turn, and measures every pair of bodies at each pose. Pairs a joint connects are not checked against each other. Reads the model; changes nothing.')),form,results);
  if(mechanismReport&&joints.some(j=>j.id===mechanismReport!.joint)){pick.value=mechanismReport.joint;showResults(mechanismReport);}
 }

 const unsubscribe=session.subscribe(()=>{if(dialog.open)render();if(barMode)showBar();});
 return {
  open(which:Tab='groups'){endBar();tab=which;report('');render();dialog.showModal();},
  showExploded(viewId?:string){const views=doc().assembly?.views??[];const view=views.find(v=>v.id===viewId)??views[0];if(!view){this.open('explode');return;}startBar({kind:'explode',view:view.id},1);},
  get presenting(){return !!barMode;},
  dispose(){unsubscribe();endBar();controller?.abort();dialog.remove();bar.remove();},
 };
}
