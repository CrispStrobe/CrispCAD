// SPDX-License-Identifier: BSD-3-Clause
// Hole-driven fastening in the editor (convergence Phase 6.2): the Standard hole, Standard parts
// and Fasten dialogs. Touch first: every control is a select, a number field or a 44 px button,
// and "Pick on a face" places the hole (or part) where a finger taps the model, drilling along the
// face normal and reading the wall thickness from the evaluated mesh for a through hole.
import {CLEARANCE_FITS,HOLE_TYPES,METRIC_THREADS,PART_FAMILIES,PART_STANDARDS,STOCK_LENGTHS,applyFastenings,describeHole,familyThreads,frameFromAxis,parsePartCommand,placeInFrame,planFastenings,standardHole,t} from '@brickwright/cad-core';
import type {CadDocument,CadSession,FastenMode,GeneratedBuilder,HoleFeature,HoleType,MetricThread,PartDetail,PartFamily,ScrewFamily,SolidNode,Vec3} from '@brickwright/cad-core';
import type {BodyMesh} from '@brickwright/cad-geometry';
import {mountBodyOperationPanel,operationField} from './body-operation-panel.js';

export interface PickedPoint {bodyId:string;point:Vec3;normal:Vec3}
export interface FasteningPanelHost {
 evaluate(doc:CadDocument):Promise<unknown>;
 afterApply():Promise<unknown>;
 /** The viewport's one-tap point pick; resolves null when cancelled. */
 pickPoint(done:(point:PickedPoint|null)=>void):()=>void;
 /** The current evaluated bodies (for the wall thickness under a picked point). */
 bodies():readonly BodyMesh[]|undefined;
 generated:GeneratedBuilder;
}

const round=(v:number)=>Number(v.toFixed(4));
function select<T extends string>(values:readonly T[],label:(v:T)=>string,value:T){
 const s=document.createElement('select');
 for(const v of values){const o=document.createElement('option');o.value=v;o.textContent=label(v);s.append(o);}
 s.value=value;return s;
}
function number(value:number,step='0.1'){const i=document.createElement('input');i.type='number';i.step=step;i.inputMode='decimal';i.value=String(value);return i;}
const axes:Record<string,Vec3>={'-Z':[0,0,-1],'+Z':[0,0,1],'-X':[-1,0,0],'+X':[1,0,0],'-Y':[0,-1,0],'+Y':[0,1,0]};
const axisLabel=(key:string)=>({'-Z':t('Down (−Z), into a top face'),'+Z':t('Up (+Z), into a bottom face'),'-X':t('−X, into a right face'),'+X':t('+X, into a left face'),'-Y':t('−Y, into a back face'),'+Y':t('+Y, into a front face'),picked:t('Along the picked face normal')} as Record<string,string>)[key];

/** Distance from `point` along `direction` to where the ray leaves the body's mesh (Möller–Trumbore;
 * the farthest crossing of the first solid run, so a hole through a wall stops at its far face). */
export function wallThickness(body:Pick<BodyMesh,'positions'|'indices'>,point:Vec3,direction:Vec3):number|undefined{
 const l=Math.hypot(...direction),d=direction.map(v=>v/l) as Vec3,o=point.map((v,i)=>v+d[i]*1e-4) as Vec3,P=body.positions,I=body.indices,hits:{t:number;enter:boolean}[]=[];
 for(let i=0;i<I.length;i+=3){
  const a=I[i]*3,b=I[i+1]*3,c=I[i+2]*3;
  const e1=[P[b]-P[a],P[b+1]-P[a+1],P[b+2]-P[a+2]],e2=[P[c]-P[a],P[c+1]-P[a+1],P[c+2]-P[a+2]];
  const p=[d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]],det=e1[0]*p[0]+e1[1]*p[1]+e1[2]*p[2];
  if(Math.abs(det)<1e-12)continue;
  const s=[o[0]-P[a],o[1]-P[a+1],o[2]-P[a+2]],u=(s[0]*p[0]+s[1]*p[1]+s[2]*p[2])/det;if(u<0||u>1)continue;
  const q=[s[1]*e1[2]-s[2]*e1[1],s[2]*e1[0]-s[0]*e1[2],s[0]*e1[1]-s[1]*e1[0]],v=(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])/det;if(v<0||u+v>1)continue;
  const tt=(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])/det;if(tt<=0)continue;
  const n=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
  hits.push({t:tt,enter:n[0]*d[0]+n[1]*d[1]+n[2]*d[2]<0});
 }
 hits.sort((x,y)=>x.t-y.t);
 const exit=hits.find(h=>!h.enter);
 return exit?round(exit.t+1e-4):undefined;
}

export function mountFasteningPanel(parent:HTMLElement,session:CadSession,host:FasteningPanelHost){
 const panel=mountBodyOperationPanel(parent,session,doc=>host.evaluate(doc),()=>host.afterApply());
 const dialog=parent.lastElementChild instanceof HTMLDialogElement?parent.lastElementChild:null;
 dialog?.classList.add('fastening-dialog');
 const button=(label:string,click:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.className='fastening-pick';b.onclick=click;return b;};
 const roots=()=>session.state.document.roots.filter(id=>{const n=session.state.document.nodes[id];return !n.reference&&n.role!=='hole';});

 /** Position, axis and target fields shared by the hole and part dialogs, with face picking. */
 function placement(reopen:()=>void,options:{target:boolean;onPick?:(point:PickedPoint)=>void}){
  const wrap=document.createElement('div');wrap.className='fastening-placement';
  const xyz=[0,0,0].map(()=>number(0)),axis=select([...Object.keys(axes),'picked'],axisLabel,'-Z');
  let picked:Vec3|undefined;
  const axisOption=axis.querySelector('option[value="picked"]') as HTMLOptionElement;axisOption.hidden=true;
  const target=select(['',...roots()],id=>id?session.state.document.nodes[id].name:t('No body (a free hole cutter)'),'');
  const selected=session.state.selection.find(id=>roots().includes(id));if(selected)target.value=selected;
  const position=document.createElement('div');position.className='fastening-xyz';
  ['X','Y','Z'].forEach((name,i)=>position.append(operationField(name,xyz[i]).label));
  const pick=button(t('Pick on a face'),()=>{
   dialog?.close();
   host.pickPoint(point=>{
    if(point){
     xyz.forEach((input,i)=>{input.value=String(round(point.point[i]));});
     picked=point.normal.map(v=>-v) as Vec3;axisOption.hidden=false;axis.value='picked';
     if(options.target&&roots().includes(point.bodyId))target.value=point.bodyId;
     options.onPick?.(point);
    }
    reopen();
   });
  });
  pick.dataset.testid='fastening-pick';
  wrap.append(pick,position,operationField(t('Axis into the material'),axis).label,...(options.target?[operationField(t('Cut body'),target).label]:[]));
  return {wrap,
   at:():Vec3=>xyz.map(input=>{const v=Number(input.value);if(!Number.isFinite(v))throw new Error(t('Enter a finite number.'));return v;}) as Vec3,
   axis:():Vec3=>axis.value==='picked'&&picked?picked:axes[axis.value]??[0,0,-1],
   target:()=>target.value||undefined,
   setAxis(v:Vec3){picked=v;axisOption.hidden=false;axis.value='picked';},
   setAt(v:Vec3){xyz.forEach((input,i)=>{input.value=String(round(v[i]));});},
  };
 }

 /** Standard hole dialog; with `editId`, edits that hole's type, size and depth in place. */
 function openHole(editId?:string){
  const editing=editId?session.state.document.nodes[editId] as SolidNode&HoleFeature:undefined;
  const fields=document.createElement('div');
  const type=select(HOLE_TYPES,v=>t(({clearance:'Clearance (ISO 273)',tapped:'Tapped (tap drill)',counterbore:'Counterbore (ISO 4762 head)',countersink:'Countersink (ISO 10642 head)','heat-set':'Heat-set insert pocket'} as Record<HoleType,string>)[v]),editing?.standard.type??'clearance');
  const thread=select(METRIC_THREADS,v=>v,editing?.standard.thread??'M3');
  const fit=select(CLEARANCE_FITS,v=>v==='close'?t('Close (fine series)'):v==='loose'?t('Loose (coarse series)'):t('Normal (medium series)'),editing?.standard.fit??'normal');
  const through=document.createElement('input');through.type='checkbox';through.checked=editing?!!editing.through:true;
  const depth=number(editing?.depth??10);
  const summary=document.createElement('p');summary.className='hint fastening-summary';summary.setAttribute('aria-live','polite');
  const place=editing?undefined:placement(()=>show(),{target:true,onPick:point=>{
   const body=host.bodies()?.find(b=>b.id===point.bodyId),wall=body&&wallThickness(body,point.point,point.normal.map(v=>-v) as Vec3);
   if(wall){depth.value=String(wall);through.checked=true;}
   refresh();
  }});
  const fitLabel=operationField(t('Fit class'),fit).label;
  const request=()=>({type:type.value as HoleType,thread:thread.value as MetricThread,fit:['clearance','counterbore','countersink'].includes(type.value)?fit.value as 'normal':undefined,depth:depth.value.trim()?Number(depth.value):undefined,through:through.checked&&type.value!=='heat-set'});
  function refresh(){
   fitLabel.hidden=!['clearance','counterbore','countersink'].includes(type.value);
   if(type.value==='heat-set'&&through.checked){through.checked=false;}
   try{summary.textContent=describeHole(standardHole(request()))+(()=>{const h=standardHole(request());return h.counterbore?t`; counterbore Ø${h.counterbore.diameter} × ${h.counterbore.depth}`:h.countersink?t`; countersink Ø${h.countersink.diameter} at ${h.countersink.angle}°`:'';})();summary.classList.remove('error');}
   catch(error){summary.textContent=error instanceof Error?error.message:String(error);summary.classList.add('error');}
  }
  for(const input of [type,thread,fit,through,depth])input.addEventListener('input',refresh);
  for(const input of [type,thread,fit,through])input.addEventListener('change',refresh);
  const throughLabel=operationField(t('Through (depth is the wall thickness)'),through).label;throughLabel.classList.add('fastening-check');
  fields.append(operationField(t('Hole type'),type).label,operationField(t('Thread'),thread).label,fitLabel,throughLabel,operationField(t('Depth (mm)'),depth).label,...(place?[place.wrap]:[]),summary);
  refresh();
  function show(){
   panel.open({title:t(editing?'Edit standard hole':'Standard hole'),closeLabel:t('Close standard hole'),applyLabel:t(editing?'Apply hole changes':'Add hole'),
    hint:t('Clearance sizes follow ISO 273; tapped holes use the coarse-thread tap drill; counterbores and countersinks fit ISO 4762 and ISO 10642 heads. Tap Pick on a face to drill where you tap.'),fields,
    read:()=>{
     const hole=standardHole(request());
     if(editing)return target=>{const {kind:_kind,...rest}=hole;void _kind;target.update(editId!,{...rest,through:rest.through,counterbore:rest.counterbore,countersink:rest.countersink,segments:editing.segments} as Partial<SolidNode>);};
     const at=place!.at(),axis=place!.axis(),body=place!.target();
     return target=>target.addStandardHoles([{hole,transform:placeInFrame(frameFromAxis(at,axis),0)}],body);
    }});
  }
  show();
 }

 function openPart(){
  const fields=document.createElement('div');
  const family=select(PART_FAMILIES,v=>`${t(({'socket-head':'Socket head cap screw','button-head':'Button head screw',countersunk:'Countersunk screw','hex-bolt':'Hex head screw','set-screw':'Set screw','hex-nut':'Hex nut',washer:'Washer','heat-set-insert':'Heat-set insert'} as Record<PartFamily,string>)[v])} (${PART_STANDARDS[v]==='heat-set insert'?t('typical'):PART_STANDARDS[v]})`,'socket-head');
  const thread=document.createElement('select'),length=document.createElement('select');
  const detail=select(['threaded','envelope'] as const,v=>t(v==='threaded'?'Threaded (screw generator)':'Envelope (fast, no thread)'),'threaded');
  const place=placement(()=>show(),{target:false});
  const lengthLabel=operationField(t('Length (mm)'),length).label;
  function fill(){
   const f=family.value as PartFamily,previous=thread.value;thread.replaceChildren(...familyThreads(f).map(m=>{const o=document.createElement('option');o.value=o.textContent=m;return o;}));thread.value=familyThreads(f).includes(previous as MetricThread)?previous:familyThreads(f).includes('M3')?'M3':familyThreads(f)[0];
   fillLengths();
  }
  function fillLengths(){
   const f=family.value as PartFamily,lengths=f in STOCK_LENGTHS?STOCK_LENGTHS[f as ScrewFamily][thread.value as MetricThread]??[]:[];
   const previous=length.value;length.replaceChildren(...lengths.map(l=>{const o=document.createElement('option');o.value=o.textContent=String(l);return o;}));
   if(lengths.map(String).includes(previous))length.value=previous;else if(lengths.includes(10))length.value='10';
   lengthLabel.hidden=!lengths.length;
  }
  family.addEventListener('change',fill);thread.addEventListener('change',fillLengths);fill();
  fields.append(operationField(t('Part'),family).label,operationField(t('Thread'),thread).label,lengthLabel,operationField(t('Detail'),detail).label,place.wrap);
  function show(){
   panel.open({title:t('Standard parts'),closeLabel:t('Close standard parts'),applyLabel:t('Insert part'),
    hint:t('ISO dimensions from the tables (nominal, not certified). The part’s bearing face goes to the position; the axis points along the shank.'),fields,
    read:()=>{
     const at=place.at(),axis=place.axis(),tail=[family.value,thread.value,...(lengthLabel.hidden?[]:[length.value]),'at',at.join(','),'axis',axis.join(','),...(detail.value==='envelope'?['envelope']:[])].join(' ');
     return target=>parsePartCommand(target,tail,{generated:host.generated}).run();
    }});
  }
  show();
 }

 /** Holes to fasten for the current selection: selected holes, holes inside selected bodies, or all. */
 function selectedHoles():string[]{
  const doc=session.state.document,out=new Set<string>();
  const walk=(id:string)=>{const n=doc.nodes[id];if(!n)return;if(n.kind==='hole')out.add(id);if(n.kind==='boolean')n.inputs.forEach(walk);};
  session.state.selection.forEach(walk);
  if(!out.size)Object.values(doc.nodes).forEach(n=>{if(n.kind==='hole')out.add(n.id);});
  return [...out];
 }
 function openFasten(ids=selectedHoles()){
  if(!ids.length)throw new Error(t('The model has no standard holes to fasten. Add one with hole.'));
  const fields=document.createElement('div');
  const family=select(['auto','socket-head','button-head','countersunk','hex-bolt'] as const,v=>v==='auto'?t('As the hole is made for'):`${t(({'socket-head':'Socket head cap screw','button-head':'Button head screw',countersunk:'Countersunk screw','hex-bolt':'Hex head screw'} as Record<string,string>)[v])} (${PART_STANDARDS[v as PartFamily]})`,'auto');
  const mode=select(['auto','screw','bolt'] as const,v=>t(v==='auto'?'Automatic: bolt and nut through, screw in blind holes':v==='bolt'?'Bolt with washers and nut':'Screw only'),'auto');
  const detail=select(['threaded','envelope'] as const,v=>t(v==='threaded'?'Threaded (screw generator)':'Envelope (fast, no thread)'),'threaded');
  const list=document.createElement('ul');list.className='fastening-plan';list.setAttribute('aria-live','polite');
  const request=()=>({...(family.value!=='auto'?{family:family.value as ScrewFamily}:{}),...(mode.value!=='auto'?{mode:mode.value as FastenMode}:{})});
  function refresh(){
   list.replaceChildren();
   for(const id of ids){
    const li=document.createElement('li'),doc=session.state.document;
    try{const [plan]=planFastenings(doc,[id],request());li.textContent=`${doc.nodes[id].name}: ${plan.parts.map(p=>p.part.designation).join(' + ')}${plan.protrusion!==undefined?t`, ${round(plan.protrusion)} mm past the nut`:''}`;}
    catch(error){li.textContent=`${doc.nodes[id].name}: ${error instanceof Error?error.message:String(error)}`;li.className='error';}
    list.append(li);
   }
  }
  for(const input of [family,mode])input.addEventListener('change',refresh);refresh();
  fields.append(operationField(t('Screw'),family).label,operationField(t('Stack'),mode).label,operationField(t('Detail'),detail).label,list);
  panel.open({title:t('Fasten holes'),closeLabel:t('Close fasten holes'),applyLabel:t('Insert fasteners'),
   hint:t('Bolts take the shortest stocked length that reaches two pitches past the nut; blind holes take the longest screw that fits.'),fields,
   read:()=>{const plans=planFastenings(session.state.document,ids,request());return target=>applyFastenings(target,plans,{generated:host.generated,detail:detail.value as PartDetail});}});
 }
 return {openHole,openPart,openFasten,selectedHoles,dispose:panel.dispose};
}
