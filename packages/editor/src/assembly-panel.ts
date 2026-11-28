// SPDX-License-Identifier: BSD-3-Clause
// The Assembly dialog (Phase 6.4): groups and suppression, exploded views, configurations and the
// mechanism check, with a bar over the 3D view that shows an exploded view or a joint's pose on a
// slider (and plays it). The bar only moves the displayed meshes; the model stays where it is.
// Touch first: selects, number fields, sliders and 44 px buttons, so it works on an iPad without a
// keyboard. Names are edited in place (no browser prompt). Document version 51 adds linked instances
// (Groups tab) and mates between faces (Mates tab; the exact kernel names the faces).
import {MATE_KINDS,MateError,createPlanetaryDocument,explodeOffsets,formatMateSolution,formatMechanismReport,groupBodies,listJoints,mateLabel,mechanismPose,newId,planExplodedView,planMechanism,solveMates,t} from '@brickwright/cad-core';
import type {AssemblyMate,CadDocument,CadSession,ExplodeBodyBounds,MateBodyFaces,MateKind,MechanismReport,MechanismSettings,RigidMotion,Vec3} from '@brickwright/cad-core';

export interface AssemblyPanelHost {
 /** Evaluated bounds of the bodies in the model now (for planning an exploded view). */
 bounds(doc:CadDocument,signal?:AbortSignal):Promise<ExplodeBodyBounds[]>;
 mechanism(doc:CadDocument,settings:MechanismSettings,signal:AbortSignal):Promise<MechanismReport>;
 /** Moves displayed meshes (world motions per body); null shows the model as it is. */
 present(motions:ReadonlyMap<string,RigidMotion>|null):void;
 /** The named faces of bodies (exact kernel), for mates. */
 faces?(doc:CadDocument,ids:readonly string[],signal?:AbortSignal):Promise<MateBodyFaces[]>;
}
type Tab='groups'|'explode'|'configurations'|'mates'|'mechanism';
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
 let tab:Tab='groups',renaming:string|undefined;
 const tabButtons=new Map<Tab,HTMLButtonElement>();
 for(const [key,label] of [['groups','Groups'],['explode','Exploded view'],['configurations','Configurations'],['mates','Mates'],['mechanism','Mechanism']] as const){
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
  if(tab!=='groups')renaming=undefined;
  if(tab==='groups')renderGroups();else if(tab==='explode')renderExplode();else if(tab==='configurations')renderConfigurations();else if(tab==='mates')renderMates();else renderMechanism();
 }
 function renderGroups(){
  const a=doc().assembly,groups=a?.groups??[],off=new Set(a?.suppressed??[]);
  const tree=el('ul','assembly-tree');
  const bodyRow=(id:string)=>{const li=el('li','assembly-body-row');li.dataset.body=id;
   const node=doc().nodes[id],linked=node?.kind==='instance'?node.source:undefined;
   const label=button(linked?t`${name(id)} (linked to ${name(linked)})`:name(id),()=>session.select([id]),'assembly-name');if(off.has(id))label.classList.add('suppressed');
   li.append(label,button(off.has(id)?t('Unsuppress'):t('Suppress'),()=>attempt(()=>{session.setSuppressed([id],!off.has(id));return off.has(id)?t`${name(id)} is back in the model.`:t`${name(id)} is suppressed.`;})));
   if(linked){li.dataset.instance=linked;li.append(button(t('Unlink'),()=>attempt(()=>{session.unlinkInstances([id]);return t`${name(id)} is now an independent copy of ${name(linked)}.`;})));}
   return li;};
  const visit=(parent:string|undefined,into:HTMLElement)=>{
   for(const g of groups.filter(x=>x.parent===parent)){
    const li=el('li','assembly-group-row');li.dataset.group=g.id;
    const head=el('div','assembly-group-head');
    if(renaming===g.id){
     // Renamed in place: a field with Save and Cancel (Enter and Escape on a keyboard).
     const field=el('input');field.value=g.name;field.setAttribute('aria-label',t('New group name'));field.className='assembly-rename';field.enterKeyHint='done';
     const save=()=>{const value=field.value;renaming=undefined;attempt(()=>{session.renameGroup(g.id,value);return t`Renamed the group to ${value.trim()}.`;});};
     field.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();save();}else if(event.key==='Escape'){event.preventDefault();renaming=undefined;render();}});
     head.append(field,button(t('Save'),save,'primary'),button(t('Cancel'),()=>{renaming=undefined;render();}));
     queueMicrotask(()=>{field.focus();field.select();});
    }else head.append(button(`▸ ${g.name} (${groupBodies(a,g.id).length})`,()=>session.select(groupBodies(a,g.id)),'assembly-name'),
     button(t('Rename'),()=>{renaming=g.id;report('');render();}),
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
  const link=el('div','assembly-row'),linkCount=el('input');linkCount.type='number';linkCount.min='1';linkCount.max='100';linkCount.step='1';linkCount.value='1';linkCount.inputMode='numeric';linkCount.setAttribute('aria-label',t('Linked copies'));
  link.append(linkCount,button(t('Linked copies of the selected body'),()=>void (async()=>{
   try{
    const ids=session.state.selection.filter(id=>doc().roots.includes(id));if(ids.length!==1)throw new Error(t('Select one top-level body to link'));
    const count=Number(linkCount.value);if(!Number.isInteger(count)||count<1||count>100)throw new Error(t('Count must be a whole number from 1 to 100'));
    const revision=session.state.revision,box=(await host.bounds(doc())).find(b=>b.id===ids[0]);
    if(session.state.revision!==revision)throw new Error(t('The design changed before this edit could be applied.'));
    // Side by side along X, one body width (and 5 mm) apart.
    const step=box?box.bounds.max[0]-box.bounds.min[0]+5:10,from=doc().nodes[ids[0]].transform;
    const made=session.addInstances(ids[0],Array.from({length:count},(_,i)=>({position:[from.position[0]+step*(i+1),from.position[1],from.position[2]] as Vec3,rotation:[...from.rotation] as Vec3})));
    report(t`Placed ${made.length} linked instances of ${name(ids[0])}: editing the part changes every instance.`);render();
   }catch(error){report(error instanceof Error?error.message:String(error),true);}
  })()));
  body.append(el('p','assembly-hint',t('Tap a group or body to select it. Suppressed bodies are left out of the model (not built, exported, simulated or drawn) until you put them back.')),tree,make,link);
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
 let mateFaces:MateBodyFaces[]|undefined,mateBusy:AbortController|undefined;
 function renderMates(){
  const d=doc(),mates=d.assembly?.mates??[];
  const list=el('ul','assembly-list');
  mates.forEach(m=>{const li=el('li','assembly-row');li.dataset.mate=m.id;
   li.append(el('span','',`${mateLabel(mates,m)}${m.kind==='distance'?` ${+m.distance!.toFixed(4)} mm`:''}${m.aligned?t(' (aligned)'):''}: ${name(m.a.body)} – ${name(m.b.body)}`),button(t('Delete'),()=>attempt(()=>{session.setMates('Delete mate',mates.filter(x=>x!==m));return t`Deleted ${mateLabel(mates,m)}; the bodies stay where they are.`;})));
   list.append(li);});
  if(!mates.length)list.append(el('li','assembly-hint',t('No mates yet.')));
  if(!host.faces){body.append(list,el('p','assembly-hint',t('Mates need the exact kernel, which this host does not provide.')));return;}
  const roots=d.roots.filter(id=>!d.nodes[id].reference&&d.nodes[id].role!=='hole');
  const labelled=(text:string,input:HTMLElement)=>{const l=el('label','',text);l.append(input);return l;};
  const kind=el('select');kind.setAttribute('aria-label',t('Mate'));for(const k of MATE_KINDS){const o=el('option','',t(k));o.value=k;kind.append(o);}
  const distance=el('input');distance.type='number';distance.step='any';distance.inputMode='decimal';distance.value='0';distance.setAttribute('aria-label',t('Distance (mm)'));
  const aligned=el('input');aligned.type='checkbox';aligned.setAttribute('aria-label',t('Aligned'));
  const sides=(['a','b'] as const).map(side=>{
   const bodySelect=el('select');bodySelect.setAttribute('aria-label',side==='a'?t('First body'):t('Second body'));bodySelect.dataset.side=side;
   for(const id of roots){const o=el('option','',name(id));o.value=id;bodySelect.append(o);}
   const selected=session.state.selection.filter(id=>roots.includes(id));
   bodySelect.value=(side==='a'?selected[0]:selected[1])??roots[side==='a'?0:Math.min(1,roots.length-1)]??'';
   const faceSelect=el('select');faceSelect.setAttribute('aria-label',side==='a'?t('First face'):t('Second face'));faceSelect.dataset.side=side;
   const fill=()=>{faceSelect.replaceChildren();const faces=mateFaces?.find(b=>b.id===bodySelect.value)?.faces??[];
    faces.forEach((f,i)=>{const o=el('option','',`${i+1}: ${t(f.surface)} · ${+f.area.toFixed(1)} mm² · ${f.axis?'⊙':`↑ ${f.normal.map(v=>+v.toFixed(2)).join(', ')}`}`);o.value=f.name;faceSelect.append(o);});
    faceSelect.disabled=!faces.length;};
   bodySelect.onchange=fill;fill();
   return {bodySelect,faceSelect,fill};
  });
  const load=button(t('Load faces'),()=>void (async()=>{
   mateBusy?.abort();mateBusy=new AbortController();load.disabled=true;report(t('Reading faces from the exact kernel…'));
   try{mateFaces=await host.faces!(doc(),roots.slice(0,64),mateBusy.signal);for(const s of sides)s.fill();report(t`${mateFaces.length} bodies: choose a face of each.`);}
   catch(error){report(error instanceof Error?error.message:String(error),true);}
   finally{load.disabled=false;}
  })());
  const solveWith=async(next:AssemblyMate[],title:string)=>{
   const revision=session.state.revision,bodies=[...new Set(next.flatMap(m=>[m.a.body,m.b.body]))];
   const faces=await host.faces!(doc(),bodies,mateBusy?.signal);
   if(session.state.revision!==revision)throw new Error(t('The design changed before this edit could be applied.'));
   const solution=solveMates(doc(),next,faces);
   session.setMates(title,next,solution.placements);
   return formatMateSolution(doc(),next,solution);
  };
  const add=button(t('Add mate'),()=>void (async()=>{
   add.disabled=true;
   try{
    const [a,b]=sides,k=kind.value as MateKind;
    if(!mateFaces)throw new Error(t('Load the faces first.'));
    if(a.bodySelect.value===b.bodySelect.value)throw new Error(t('a mate joins two different bodies'));
    if(!a.faceSelect.value||!b.faceSelect.value)throw new Error(t('Choose a face of each body.'));
    const mate:AssemblyMate={id:newId(),kind:k,a:{body:a.bodySelect.value,face:a.faceSelect.value},b:{body:b.bodySelect.value,face:b.faceSelect.value},...(k==='distance'?{distance:Number(distance.value)||0}:{}),...(aligned.checked&&k!=='concentric'?{aligned:true as const}:{})};
    report(t('Solving…'));report(await solveWith([...(doc().assembly?.mates??[]),mate],'Add mate'));mateFaces=undefined;render();
   }catch(error){report(error instanceof MateError||error instanceof Error?error.message:String(error),true);}
   finally{add.disabled=false;}
  })(),'primary');
  const solve=button(t('Solve mates'),()=>void (async()=>{
   try{if(!mates.length)throw new Error(t('No mates to solve.'));report(t('Solving…'));report(await solveWith([...mates],'Solve mates'));render();}
   catch(error){report(error instanceof Error?error.message:String(error),true);}
  })());
  const form=el('div','assembly-form');
  form.append(labelled(t('Mate'),kind),labelled(t('First body'),sides[0].bodySelect),labelled(t('First face'),sides[0].faceSelect),labelled(t('Second body'),sides[1].bodySelect),labelled(t('Second face'),sides[1].faceSelect),labelled(t('Distance (mm)'),distance),labelled(t('Aligned'),aligned),load,add,solve);
  body.append(el('p','assembly-hint',t('A mate places the second body against the first: coincident or a distance between two flat faces, concentric between two round ones. The first body of the first mate stays where it is; mates that cannot all hold are refused, and nothing moves.')),list,form);
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
