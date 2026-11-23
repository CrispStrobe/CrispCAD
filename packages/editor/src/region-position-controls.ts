// SPDX-License-Identifier: BSD-3-Clause
import {regionLoopAnchor,t} from '@brickwright/cad-core';
import type {FeatureScalar,RegionLoopPlacement,RegionPlacementEdge,SketchLoop} from '@brickwright/cad-core';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 return node;
};

export function mountRegionPositionControls(form:HTMLElement,options:{
 initial:RegionLoopPlacement[];
 initialLoops:SketchLoop[];
 visible:()=>boolean;
 available:()=>boolean;
 read:()=>SketchLoop[];
 scalar:(value:string)=>FeatureScalar;
 apply:(placements:RegionLoopPlacement[])=>void;
 changed:()=>void;
}){
 const panel=element('details');panel.className='sketch-expressions';
 panel.append(element('summary',t('Region loop positions')),
  element('p',t('Set X and Y offsets between a first vertex or edge midpoint on each loop.')));
 const reference=element('select'),target=element('select');
 const referenceAnchor=element('select'),targetAnchor=element('select'),x=element('input'),y=element('input');
 for(const [label,field] of [
  ['Reference loop',reference],['Reference anchor',referenceAnchor],['Positioned loop',target],
  ['Positioned anchor',targetAnchor],['X offset (mm)',x],['Y offset (mm)',y]
 ] as const){
  const wrapper=element('label',t(label));
  field.setAttribute('aria-label',t(label));
  wrapper.append(field);panel.append(wrapper);
 }
 x.maxLength=y.maxLength=160;
 const add=element('button'),cancel=element('button',t('Cancel position edit')),list=element('ul'),status=element('p');
 add.type=cancel.type='button';
 list.className='drawing-dimension-list';
 status.setAttribute('role','status');status.setAttribute('aria-label',t('Region position status'));
 panel.append(add,cancel,list,status);
 form.append(panel);
 const topology=(loops:SketchLoop[])=>JSON.stringify(loops.map(loop=>[loop.id,loop.kind]));
 let placements=options.initial.slice(),locked=placements.length?topology(options.initialLoops):undefined;
 let editing:number|undefined,loops:SketchLoop[]=[],optionsKey='';
 panel.open=placements.length>0;
 const topologyMessage=t('Restore the original region loops or remove their positions.');
 const labelFor=(id:string)=>t`Outline loop ${loops.findIndex(loop=>loop.id===id)+1}`;
 const changedTopology=()=>locked!==undefined&&topology(loops)!==locked;
 const selectedEdge=(input:HTMLSelectElement):RegionPlacementEdge|undefined=>input.value?JSON.parse(input.value):undefined;
 const outline=(id:string)=>loops.find(loop=>loop.id===id&&loop.kind==='outline');
 function updateAnchors(picker:HTMLSelectElement,selector:HTMLSelectElement){
  const loop=outline(picker.value);
  const ids=loop?.kind==='outline'?loop.vertexIds??[]:[];
  const key=JSON.stringify([picker.value,ids]);
  if(selector.dataset.loopKey===key)return;
  const value=selector.value;
  selector.replaceChildren(new Option(t('First vertex'),''),...ids.map((id,i)=>
   new Option(t`Edge ${i+1} midpoint`,JSON.stringify([id,ids[(i+1)%ids.length]]))));
  if(Array.from(selector.options).some(option=>option.value===value))selector.value=value;
  selector.dataset.loopKey=key;
 }
 function updateAnchorOptions(){
  updateAnchors(reference,referenceAnchor);
  updateAnchors(target,targetAnchor);
 }
 function refill(){
  const a=outline(reference.value),b=outline(target.value);
  if(a?.kind!=='outline'||b?.kind!=='outline'||!a.points.length||!b.points.length)return;
  const start=regionLoopAnchor(a,selectedEdge(referenceAnchor)),end=regionLoopAnchor(b,selectedEdge(targetAnchor));
  x.value=String(end[0]-start[0]);y.value=String(end[1]-start[1]);
 }
 function render(){
  add.textContent=t(editing===undefined?'Add loop position':'Update loop position');
  add.disabled=changedTopology()||target.options.length<2;
  cancel.hidden=editing===undefined;
  list.replaceChildren(...placements.map((placement,index)=>{
   const row=element('li'),edit=element('button',t('Edit')),remove=element('button',t('Remove'));
   edit.type=remove.type='button';edit.disabled=changedTopology();
   edit.setAttribute('aria-label',t`Edit loop position ${index+1}`);
   remove.setAttribute('aria-label',t`Remove loop position ${index+1}`);
   row.append(element('span',`${labelFor(placement.target)} ← ${labelFor(placement.reference)} · ${placement.offset.join(', ')}`),edit,remove);
   edit.onclick=()=>{
    editing=index;reference.value=placement.reference;target.value=placement.target;
    updateAnchorOptions();
    referenceAnchor.value=placement.referenceEdge?JSON.stringify(placement.referenceEdge):'';
    targetAnchor.value=placement.targetEdge?JSON.stringify(placement.targetEdge):'';
    [x.value,y.value]=placement.offset.map(String);render();
   };
   remove.onclick=()=>{
    if(!options.available())return;
    placements=placements.filter((_,i)=>i!==index);
    if(!placements.length)locked=undefined;
    editing=undefined;status.textContent=changedTopology()?topologyMessage:'';
    options.changed();
   };
   return row;
  }));
 }
 function refresh(){
  panel.hidden=!options.visible();
  if(panel.hidden)return;
  try{loops=options.read();}catch{loops=[];}
  const key=topology(loops);
  const updateLoops=key!==optionsKey;
  if(updateLoops){
   const outlines=loops.filter(loop=>loop.kind==='outline');
   for(const picker of [reference,target]){
    const current=picker.value;
    picker.replaceChildren(...outlines.map(loop=>new Option(labelFor(loop.id),loop.id)));
    if(outlines.some(loop=>loop.id===current))picker.value=current;
    else if(picker===target&&outlines[1])picker.value=outlines[1].id;
   }
   if(target.value===reference.value&&outlines.length>1)target.value=outlines.find(loop=>loop.id!==reference.value)!.id;
   optionsKey=key;
  }
  updateAnchorOptions();
  if(updateLoops&&editing===undefined)refill();
  panel.hidden=reference.options.length<2&&!placements.length;
  if(changedTopology())status.textContent=topologyMessage;
  else if(status.textContent===topologyMessage)status.textContent='';
  render();
 }
 reference.onchange=target.onchange=()=>{updateAnchorOptions();if(editing===undefined)refill();};
 referenceAnchor.onchange=targetAnchor.onchange=()=>{if(editing===undefined)refill();};
 cancel.onclick=()=>{editing=undefined;refill();render();};
 add.onclick=()=>{
  if(!options.available()||changedTopology())return;
  try{
   const next=placements.slice();
   const referenceEdge=selectedEdge(referenceAnchor),targetEdge=selectedEdge(targetAnchor);
   next[editing??next.length]={reference:reference.value,target:target.value,offset:[options.scalar(x.value),options.scalar(y.value)],
    ...(referenceEdge?{referenceEdge}:{}),...(targetEdge?{targetEdge}:{})};
   options.apply(next);
   placements=next;locked=topology(loops);editing=undefined;status.textContent='';options.changed();
  }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
 };
 for(const event of ['input','change'])panel.addEventListener(event,event=>event.stopPropagation());
 return {refresh,forSave(loops:SketchLoop[]){
  if(locked!==undefined&&locked!==topology(loops))throw new Error(topologyMessage);
  return placements.length?{placements}:{};},
 get hasConstraints(){return placements.length>0;}};
}
