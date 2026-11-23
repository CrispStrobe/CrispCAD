// SPDX-License-Identifier: BSD-3-Clause
import {isOutlineCurveRule,maxConstrainedOutlinePoints,maxOutlineRelations,newId,outlineArcSweep,outlineBulgesForCurves,outlineCurvesSatisfied,outlineRelationsForSolve,outlineSatisfiesRelations,outlineSegmentsAdjoin,t} from '@brickwright/cad-core';
import type {FeatureScalar,OutlineArcSweep,OutlineRelation,SketchOutlineProfile} from '@brickwright/cad-core';
import {solveOutline} from './outline-constraint-solve.js';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 return node;
};
type OutlineConstraintKind=OutlineRelation['kind'];
type DraftConstraint={kind:OutlineConstraintKind; edge:number; other:number; expression:string; sweep?:OutlineArcSweep};
type OutlineGeometry=Pick<SketchOutlineProfile,'points'|'bulges'>;
const pairKinds=new Set(['parallel','perpendicular','equal','tangent','arc-tangent']);
const labels=()=>{
 return {horizontal:t('Horizontal'),vertical:t('Vertical'),length:t('Length'),radius:t('Arc radius'),
  parallel:t('Parallel'),perpendicular:t('Perpendicular'),equal:t('Equal lengths'),tangent:t('Arc tangent to line'),
  'arc-tangent':t('Arc tangent to arc')};
};

export function mountOutlineConstraintControls(form:HTMLElement,dialog:HTMLDialogElement,options:{
 initial?:SketchOutlineProfile;
 visible:()=>boolean;
 active:()=>boolean;
 available:()=>boolean;
 revision:()=>number;
 read:()=>OutlineGeometry;
 readLength:(value:FeatureScalar)=>number;
 apply:(geometry:OutlineGeometry)=>void;
 pending:(solving:boolean)=>void;
}){
 const panel=element('details');
 panel.className='sketch-expressions';
 const constraint=element('select'),edge=element('select'),other=element('select'),length=element('input'),radius=element('input');
 const field=(label:string,control:HTMLElement)=>{
  const wrapper=element('label',label);
  control.setAttribute('aria-label',label);
  wrapper.append(control);
  panel.append(wrapper);
  return wrapper;
 };
 panel.append(element('summary',t('Outline constraints')),
  element('p',t('Point 1 stays fixed. Lengths measure from vertex to vertex. Save keeps the constraints and solved points.')));
 for(const [value,label] of Object.entries(labels()))constraint.add(new Option(label,value));
 field(t('Constraint'),constraint);
 field(t('Constrained segment'),edge);
 const otherLabel=field(t('Second segment'),other);
 const tangentHint=element('small',t('Choose the arc first, then an adjoining straight segment.'));
 const arcTangentHint=element('small',t('The first arc follows the adjoining reference arc.'));
 otherLabel.append(tangentHint,arcTangentHint);
 const lengthLabel=field(t('Segment length (mm)'),length);
 const radiusLabel=field(t('Arc radius (mm)'),radius);
 radiusLabel.append(element('small',t('Choose an existing arc. Solving keeps the side and sweep branch of that arc.')));
 length.maxLength=radius.maxLength=160;
 const add=element('button',t('Add constraint')),solve=element('button',t('Solve outline'));
 const cancel=element('button',t('Cancel constraint edit')),clear=element('button',t('Clear constraints'));
 add.type=solve.type=cancel.type=clear.type='button';
 const list=element('ul');
 list.className='drawing-dimension-list';
 const status=element('p');
 status.setAttribute('role','status');
 status.setAttribute('aria-label',t('Outline constraint status'));
 panel.append(add,cancel,list,solve,clear,status);
 form.append(panel);
 const initial=options.initial;
 let vertexIds=initial?.vertexIds?.slice(),count=0,solving=false,wrongCount=false,checkedInitial=false,editIndex:number|undefined;
 const topologyMessage=t('Restore the original point count or clear the outline constraints.');
 const constraints:DraftConstraint[]=initial?.relations?.length?
  outlineRelationsForSolve(initial,()=>1).map((rule,index)=>{
   const saved=initial.relations![index];
   return {kind:rule.kind,edge:rule.edge,other:'other' in rule?rule.other:0,
    expression:saved.kind==='length'?String(saved.length):saved.kind==='radius'?String(saved.radius):'',
    sweep:saved.kind==='radius'?saved.sweep:undefined};
  }):[];
 if(constraints.length)panel.open=true;

 const segmentLabel=(index:number)=>t`Segment ${index+1}–${(index+1)%count+1}`;
 const refreshButtons=()=>{
  otherLabel.hidden=!pairKinds.has(constraint.value);
  tangentHint.hidden=constraint.value!=='tangent';
  arcTangentHint.hidden=constraint.value!=='arc-tangent';
  lengthLabel.hidden=constraint.value!=='length';
  radiusLabel.hidden=constraint.value!=='radius';
  const ready=count>=3&&count<=maxConstrainedOutlinePoints&&!wrongCount;
  add.textContent=t(editIndex===undefined?'Add constraint':'Update constraint');
  add.disabled=solving||!ready||editIndex===undefined&&constraints.length>=maxOutlineRelations;
  solve.disabled=solving||!ready||!constraints.length;
  cancel.hidden=editIndex===undefined;
  cancel.disabled=clear.disabled=solving;
  clear.hidden=!constraints.length;
  for(const input of [constraint,edge,other,length,radius])input.disabled=solving;
  for(const button of list.querySelectorAll('button'))button.disabled=solving;
 };
 function redrawList(){
  list.replaceChildren(...constraints.map((row,index)=>{
   const entry=element('li'),edit=element('button',t('Edit')),remove=element('button',t('Remove'));
   const label=labels()[row.kind],segment=segmentLabel(row.edge);
   const detail=row.kind==='length'||row.kind==='radius'?row.expression:pairKinds.has(row.kind)?segmentLabel(row.other):'';
   entry.append(element('span',[label,segment,detail].filter(Boolean).join(' · ')),edit,remove);
   edit.type=remove.type='button';
   edit.setAttribute('aria-label',t`Edit constraint ${index+1}`);
   remove.setAttribute('aria-label',t`Remove constraint ${index+1}`);
   edit.onclick=()=>{
    editIndex=index;
    constraint.value=row.kind;
    edge.value=String(row.edge);
    other.value=String(row.other);
    length.value=radius.value=row.expression;
    refreshButtons();
    constraint.focus();
   };
   remove.onclick=()=>{
    constraints.splice(index,1);
    editIndex=undefined;
    status.textContent='';
    refresh();
    redrawList();
   };
   return entry;
  }));
  refreshButtons();
 }
 function refresh(){
  panel.hidden=!options.visible();
  if(panel.hidden)return;
  let size:number;
  try{size=options.read().points.length;}catch{size=0;}
  wrongCount=constraints.length>0&&size!==vertexIds?.length;
  if(wrongCount)status.textContent=topologyMessage;
  else if(status.textContent===topologyMessage)status.textContent='';
  const next=constraints.length?vertexIds!.length:size;
  if(next!==count){
   const previousEdge=edge.value,previousOther=other.value;
   count=next;
   for(const select of [edge,other]){
    select.replaceChildren(...Array.from({length:count},(_,index)=>new Option(segmentLabel(index),String(index))));
   }
   if(Number(previousEdge)<count&&previousEdge)edge.value=previousEdge;
   if(Number(previousOther)<count&&previousOther)other.value=previousOther;
   else if(count>1)other.value='1';
   redrawList();
  }
  if(!checkedInitial&&initial?.relations){
   checkedInitial=true;
   try{forSave(initial);}
   catch{status.textContent=t('Solve the outline to use the current dimensions.');}
  }
  refreshButtons();
 }
 cancel.onclick=()=>{editIndex=undefined;refreshButtons();};
 clear.onclick=()=>{
  constraints.length=0;
  editIndex=undefined;
  status.textContent='';
  refresh();
  redrawList();
 };
 function retainedRelations():Pick<SketchOutlineProfile,'vertexIds'|'relations'>{
  const ids=vertexIds!;
  const segment=(index:number):[string,string]=>[ids[index],ids[(index+1)%ids.length]];
  const relations=constraints.map(({kind,edge,other,expression,sweep}):OutlineRelation=>{
   if(kind==='length')return {kind,edge:segment(edge),length:expression};
   if(kind==='radius')return {kind,edge:segment(edge),radius:expression,sweep:sweep!};
   if(kind==='horizontal'||kind==='vertical')return {kind,edge:segment(edge)};
   return {kind,edge:segment(edge),other:segment(other)};
  });
  return {vertexIds:ids,relations};
 }
 function plan({points}:OutlineGeometry){
  if(points.length!==vertexIds?.length)throw new Error(topologyMessage);
  const rules=outlineRelationsForSolve({points,...retainedRelations()},options.readLength);
  return {request:{points,constraints:rules.filter(rule=>!isOutlineCurveRule(rule))},curves:rules.filter(isOutlineCurveRule)};
 }
 function forSave(geometry:OutlineGeometry){
  if(!constraints.length)return {};
  const {request,curves}=plan(geometry);
  if(!outlineSatisfiesRelations(request,geometry.points)||!outlineCurvesSatisfied(geometry.points,geometry.bulges,curves))
   throw new Error(t('Solve the outline before saving its constraints.'));
  return retainedRelations();
 }
 for(const event of ['input','change'])panel.addEventListener(event,event=>event.stopPropagation());
 constraint.onchange=refreshButtons;
 add.onclick=()=>{
  const kind=constraint.value as OutlineConstraintKind;
  const row:DraftConstraint={kind,edge:Number(edge.value),other:Number(other.value),expression:(kind==='radius'?radius:length).value.trim()};
  if(pairKinds.has(kind)&&row.edge===row.other){
   status.textContent=t('Choose two different segments.');
   return;
  }
  if(kind==='tangent'||kind==='arc-tangent'){
   try{
    const {points,bulges}=options.read();
    if(!bulges?.[row.edge])throw new Error(t('Curve the first segment before adding tangency.'));
    if(!outlineSegmentsAdjoin(row.edge,row.other,points.length)||Boolean(bulges[row.other])!==(kind==='arc-tangent'))
     throw new Error(t(kind==='tangent'?'Choose an adjoining straight segment for tangency.':'Choose an adjoining arc as the tangent reference.'));
    if(constraints.some((entry,index)=>index!==editIndex&&entry.kind===kind&&entry.edge===row.edge&&entry.other===row.other))
     throw new Error(t('This tangent is already defined.'));
   }catch(error){status.textContent=error instanceof Error?error.message:String(error);return;}
  }
  if(kind==='length'||kind==='radius'){
   try{
    options.readLength(row.expression);
    if(kind==='radius'){
     if(constraints.some((entry,index)=>index!==editIndex&&entry.kind==='radius'&&entry.edge===row.edge))
      throw new Error(t('An arc can have only one driving radius.'));
     const previous=editIndex===undefined?undefined:constraints[editIndex];
     const bulge=options.read().bulges?.[row.edge];
     if(previous?.kind==='radius'&&previous.edge===row.edge)row.sweep=previous.sweep;
     else if(bulge)row.sweep=outlineArcSweep(bulge);
     else throw new Error(t('Curve the segment before adding a driving radius.'));
    }
   }
   catch(error){status.textContent=error instanceof Error?error.message:String(error);return;}
  }
  if(!constraints.length&&vertexIds?.length!==count)vertexIds=Array.from({length:count},newId);
  if(editIndex===undefined)constraints.push(row);
  else constraints[editIndex]=row;
  editIndex=undefined;
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
   const geometry=options.read();
   const {request,curves}=plan(geometry);
   const result=request.constraints.length?await solveOutline(request,controller.signal):{points:geometry.points,degrees:null};
   if(!options.active())return;
   if(revision!==options.revision()||!options.available()){
    throw new Error(t('The sketch changed during the solve. Solve the outline again.'));
   }
   options.apply({points:result.points,bulges:outlineBulgesForCurves(result.points,geometry.bulges,curves)});
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
 return {refresh,forSave,get pending(){return solving;},get hasConstraints(){return constraints.length>0;}};
}
