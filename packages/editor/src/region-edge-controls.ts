// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {RegionEdgeMatch,RegionPlacementEdge,SketchLoop} from '@brickwright/cad-core';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 return node;
};

export function mountRegionEdgeControls(form:HTMLElement,dialog:HTMLDialogElement,options:{
 initial:RegionEdgeMatch[];
 read:()=>SketchLoop[];
 visible:()=>boolean;
 available:()=>boolean;
 active:()=>boolean;
 pending:(solving:boolean)=>void;
 solve:(matches:RegionEdgeMatch[],signal:AbortSignal)=>Promise<void>;
 changed:()=>void;
}){
 const panel=element('details');panel.className='sketch-expressions';
 panel.append(element('summary',t('Region edge matches')));
 const reference=element('select'),target=element('select'),referenceEdge=element('select'),targetEdge=element('select');
 for(const [label,field] of [
  ['Edge reference loop',reference],['Reference length edge',referenceEdge],
  ['Edge target loop',target],['Target length edge',targetEdge]
 ] as const){
  const wrapper=element('label',t(label));field.setAttribute('aria-label',t(label));
  wrapper.append(field);panel.append(wrapper);
 }
 const add=element('button',t('Add edge length match')),solve=element('button',t('Solve region edge matches'));
 add.type=solve.type='button';
 const list=element('ul'),status=element('p');
 list.className='drawing-dimension-list';
 status.setAttribute('role','status');status.setAttribute('aria-label',t('Region edge match status'));
 panel.append(add,solve,list,status);form.append(panel);
 let matches=options.initial.slice(),controller:AbortController|undefined,loops:SketchLoop[]=[],loopKey='';
 panel.open=matches.length>0;
 const labelFor=(id:string)=>t`Outline loop ${loops.findIndex(loop=>loop.id===id)+1}`;
 function updateEdges(loopId:string,select:HTMLSelectElement){
  const loop=loops.find(loop=>loop.id===loopId);
  const edges=loop?.kind==='outline'?(loop.vertexIds??[]).flatMap((id,i,ids)=>loop.bulges?.[i]?[]:[{edge:[id,ids[(i+1)%ids.length]],index:i}]):[];
  const key=JSON.stringify([loopId,edges]);
  if(select.dataset.edgeKey===key)return;
  const previous=select.value;
  select.replaceChildren(...edges.map(({edge,index})=>new Option(t`Edge ${index+1}`,JSON.stringify(edge))));
  if(Array.from(select.options).some(option=>option.value===previous))select.value=previous;
  select.dataset.edgeKey=key;
 }
 function refreshButtons(){
  add.disabled=!!controller||!referenceEdge.value||!targetEdge.value||reference.value===target.value;
  solve.disabled=!!controller||!matches.length;
  for(const select of [reference,target,referenceEdge,targetEdge])select.disabled=!!controller;
  for(const remove of list.querySelectorAll('button'))remove.disabled=!!controller;
 }
 function refreshEdges(){
  updateEdges(reference.value,referenceEdge);
  updateEdges(target.value,targetEdge);
  refreshButtons();
 }
 function labelEdge(id:string,edge:RegionPlacementEdge){
  const loop=loops.find(loop=>loop.id===id);
  const index=loop?.kind==='outline'?(loop.vertexIds?.indexOf(edge[0])??-1):-1;
  return index>=0?t`${labelFor(id)} · Edge ${index+1}`:t('Missing edge');
 }
 function redraw(){
  list.replaceChildren(...matches.map((match,index)=>{
   const row=element('li'),remove=element('button',t('Remove'));remove.type='button';
   remove.setAttribute('aria-label',t`Remove edge match ${index+1}`);
   row.append(element('span',`${labelEdge(match.target,match.targetEdge)} ← ${labelEdge(match.reference,match.referenceEdge)}`),remove);
   remove.onclick=()=>{
    if(!options.available()||controller)return;
    matches=matches.filter((_,i)=>i!==index);status.textContent='';options.changed();
   };
   return row;
  }));
  refreshButtons();
 }
 function refresh(){
  panel.hidden=!options.visible();
  if(panel.hidden)return;
  try{loops=options.read();}catch{loops=[];}
  const ids=loops.filter(loop=>loop.kind==='outline').map(loop=>loop.id);
  panel.hidden=ids.length<2&&!matches.length;
  const key=JSON.stringify(ids);
  if(key!==loopKey){
   for(const [select,index] of [[reference,0],[target,1]] as const){
    const previous=select.value;
    select.replaceChildren(...ids.map(id=>new Option(labelFor(id),id)));
    select.value=ids.includes(previous)?previous:ids[index]??'';
   }
   if(target.value===reference.value&&ids.length>1)target.value=ids.find(id=>id!==reference.value)!;
   loopKey=key;
  }
  refreshEdges();redraw();
 }
 async function run(next:RegionEdgeMatch[]){
  if(controller||!options.available())return;
  const attempt=new AbortController();controller=attempt;
  const close=()=>{if(!options.active())attempt.abort();};
  dialog.addEventListener('close',close);
  options.pending(true);refreshButtons();status.textContent=t('Solving region edge matches…');
  try{
   await options.solve(next,attempt.signal);
   if(!options.active())return;
   matches=next;options.changed();status.textContent=t('Region edge matches solved.');
  }catch(error){
   if(options.active())status.textContent=error instanceof Error?error.message:String(error);
  }finally{
   dialog.removeEventListener('close',close);controller=undefined;
   if(options.active()){options.pending(false);refreshButtons();}
  }
 }
 reference.onchange=target.onchange=refreshEdges;
 add.onclick=()=>void run([...matches,{reference:reference.value,target:target.value,
  referenceEdge:JSON.parse(referenceEdge.value),targetEdge:JSON.parse(targetEdge.value)}]);
 solve.onclick=()=>void run(matches);
 for(const event of ['input','change'])panel.addEventListener(event,event=>event.stopPropagation());
 return {refresh,get edgeMatches(){return matches.length?matches:undefined;},
  get pending(){return controller!==undefined;}};
}
