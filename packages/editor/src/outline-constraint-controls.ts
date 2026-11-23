// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';
import {solveOutline} from './outline-constraint-solve.js';
import type {OutlineConstraint} from './outline-constraint-solve.js';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 return node;
};
type OutlineConstraintKind=OutlineConstraint['kind'];
type DraftConstraint={kind:OutlineConstraintKind; edge:number; other:number; expression:string};
const pairKinds=new Set(['parallel','perpendicular','equal']);
const labels=()=>{
 return {horizontal:t('Horizontal'),vertical:t('Vertical'),length:t('Length'),
  parallel:t('Parallel'),perpendicular:t('Perpendicular'),equal:t('Equal lengths')};
};

export function mountOutlineConstraintControls(form:HTMLElement,dialog:HTMLDialogElement,options:{
 visible:()=>boolean;
 active:()=>boolean;
 available:()=>boolean;
 revision:()=>number;
 read:()=>SketchPoint[];
 readLength:(value:string)=>number;
 apply:(points:SketchPoint[])=>void;
 pending:(solving:boolean)=>void;
}){
 const panel=element('details');
 panel.className='sketch-expressions';
 const constraint=element('select'),edge=element('select'),other=element('select'),length=element('input');
 const field=(label:string,control:HTMLElement)=>{
  const wrapper=element('label',label);
  control.setAttribute('aria-label',label);
  wrapper.append(control);
  panel.append(wrapper);
  return wrapper;
 };
 panel.append(element('summary',t('Outline constraints')),
  element('p',t('Point 1 stays fixed. Solve updates the draft points. Save the sketch to keep the resulting shape.')));
 for(const [value,label] of Object.entries(labels()))constraint.add(new Option(label,value));
 field(t('Constraint'),constraint);
 field(t('Constrained segment'),edge);
 const otherLabel=field(t('Second segment'),other);
 const lengthLabel=field(t('Segment length (mm)'),length);
 length.maxLength=160;
 const add=element('button',t('Add constraint')),solve=element('button',t('Solve outline'));
 add.type=solve.type='button';
 const list=element('ul');
 list.className='drawing-dimension-list';
 const status=element('p');
 status.setAttribute('role','status');
 status.setAttribute('aria-label',t('Outline constraint status'));
 panel.append(add,list,solve,status);
 form.append(panel);
 let count=0,solving=false;
 const constraints:DraftConstraint[]=[];
 const segmentLabel=(index:number)=>t`Segment ${index+1}–${(index+1)%count+1}`;
 const refreshButtons=()=>{
  otherLabel.hidden=!pairKinds.has(constraint.value);
  lengthLabel.hidden=constraint.value!=='length';
  add.disabled=solving||count<3||count>32||constraints.length>=48;
  solve.disabled=solving||count<3||count>32||!constraints.length;
  for(const input of [constraint,edge,other,length])input.disabled=solving;
  for(const remove of list.querySelectorAll('button'))remove.disabled=solving;
 };
 function redrawList(){
  list.replaceChildren(...constraints.map((row,index)=>{
   const entry=element('li'),remove=element('button',t('Remove'));
   const label=labels()[row.kind],segment=segmentLabel(row.edge);
   const detail=row.kind==='length'?row.expression:pairKinds.has(row.kind)?segmentLabel(row.other):'';
   entry.append(element('span',[label,segment,detail].filter(Boolean).join(' · ')),remove);
   remove.type='button';
   remove.setAttribute('aria-label',t`Remove constraint ${index+1}`);
   remove.onclick=()=>{constraints.splice(index,1);status.textContent='';redrawList();};
   return entry;
  }));
  refreshButtons();
 }
 function refresh(){
  panel.hidden=!options.visible();
  if(panel.hidden)return;
  let size:number;
  try{size=options.read().length;}catch{size=0;}
  if(size!==count){
   const old=count,previousEdge=edge.value,previousOther=other.value;
   count=size;
   for(const select of [edge,other]){
    select.replaceChildren(...Array.from({length:count},(_,index)=>new Option(segmentLabel(index),String(index))));
   }
   if(Number(previousEdge)<count&&previousEdge)edge.value=previousEdge;
   if(Number(previousOther)<count&&previousOther)other.value=previousOther;
   else if(count>1)other.value='1';
   if(old&&constraints.length){
    constraints.length=0;
    status.textContent=t('The number of points changed. Add the outline constraints again.');
   }
   redrawList();
  }
  refreshButtons();
 }
 for(const event of ['input','change'])panel.addEventListener(event,event=>event.stopPropagation());
 constraint.onchange=refreshButtons;
 add.onclick=()=>{
  const kind=constraint.value as OutlineConstraintKind,row={kind,edge:Number(edge.value),other:Number(other.value),expression:length.value.trim()};
  if(pairKinds.has(kind)&&row.edge===row.other){
   status.textContent=t('Choose two different segments.');
   return;
  }
  if(kind==='length'){
   try{options.readLength(row.expression);}
   catch(error){status.textContent=error instanceof Error?error.message:String(error);return;}
  }
  constraints.push(row);
  status.textContent='';
  redrawList();
 };
 solve.onclick=async()=>{
  if(!options.available()||solving)return;
  const controller=new AbortController(),revision=options.revision();
  const close=()=>{if(!options.active())controller.abort();};
  dialog.addEventListener('close',close);
  solving=true;
  options.pending(true);
  refreshButtons();
  status.textContent=t('Solving outline…');
  try{
   const points=options.read();
   const relations=constraints.map(({kind,edge,other,expression}):OutlineConstraint=>{
    if(kind==='length')return {kind,edge,length:options.readLength(expression)};
    if(kind==='horizontal'||kind==='vertical')return {kind,edge};
    return {kind,edge,other};
   });
   const result=await solveOutline({points,constraints:relations},controller.signal);
   if(!options.active())return;
   if(revision!==options.revision()||!options.available()){
    throw new Error(t('The sketch changed during the solve. Solve the outline again.'));
   }
   options.apply(result.points);
   status.textContent=result.degrees===null?t('Outline solved.'):
    result.degrees===0?t('Outline solved. Fully constrained.'):
     t`Outline solved. Degrees of freedom: ${result.degrees}.`;
  }catch(error){
   if(options.active())status.textContent=error instanceof Error?error.message:String(error);
  }finally{
   dialog.removeEventListener('close',close);
   solving=false;
   if(options.active()){options.pending(false);refreshButtons();}
  }
 };
 return {refresh,get pending(){return solving;}};
}
