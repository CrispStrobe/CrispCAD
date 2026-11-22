// SPDX-License-Identifier: BSD-3-Clause
import {evaluateSketch,newId,t,trimSketchProfile,FeatureEvaluationError} from '@brickwright/cad-core';
import type {CadSession,PlanarSketch,SketchPlane,SketchProfile} from '@brickwright/cad-core';
import {formatSketchPoints,parseSketchOutline,parseSketchPoint} from './sketch-point-entry.js';
import {operationField} from './body-operation-panel.js';

type Path=Extract<SketchProfile,{kind:'path'}>;
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,value?:string)=>{
 const node=document.createElement(tag);
 if(value!==undefined)node.textContent=value;
 return node;
};
const svgNS='http://www.w3.org/2000/svg';

export function mountPathPanel(parent:HTMLElement,session:CadSession,showObjects:()=>void){
 const dialog=element('dialog');
 dialog.className='sketch-dialog';
 dialog.setAttribute('aria-label',t('Sketch path'));
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 parent.append(dialog);

 function open(id?:string){
  const {document:doc,revision}=session.state,existing=id?doc.sketches?.[id]:undefined;
  if(id&&existing?.profile.kind!=='path')throw new Error(t('Select an open sketch path'));
  const profile=existing?.profile.kind==='path'?existing.profile:undefined;
  const profileId=profile?.id??newId();
  dialog.replaceChildren();

  const header=element('header'),close=element('button','×');
  close.setAttribute('aria-label',t('Close path editor'));
  close.onclick=()=>dialog.close();
  header.append(element('h2',t('Sketch path')),close);

  const preview=element('div');
  preview.className='sketch-preview path-preview';
  preview.setAttribute('aria-label',t('Open path preview'));
  const fields=element('div');
  fields.className='sketch-fields';
  const name=element('input'),plane=element('select'),points=element('textarea');
  name.value=existing?.name??t('Sketch path');
  for(const axis of ['XY','XZ','YZ'])plane.add(new Option(axis,axis));
  plane.value=existing?.plane??'XY';
  points.rows=6;
  points.maxLength=65536;
  points.spellcheck=false;
  points.value=profile?formatSketchPoints(profile.points,profile.bulges).join('\n'):'0, 0\n30, 0\n30, 20';
  fields.append(operationField(t('Sketch name'),name).label,operationField(t('Sketch plane'),plane).label,
   operationField(t('Path points X, Y (mm)'),points).label,
   element('small',t('Enter one point per line. Use @dX, dY for a relative point. Add a third value for an arc bulge on the outgoing edge.')));

  const trim=element('details');
  trim.className='sketch-expressions';
  const first=element('input'),second=element('input'),side=element('select');
  side.add(new Option(t('Left of line'),'left'));side.add(new Option(t('Right of line'),'right'));
  const trimButton=element('button',t('Trim path draft'));
  trim.append(element('summary',t('Trim by line')),element('p',t('Choose two points and keep the left or right side looking from the first point to the second.')),
   operationField(t('First trim point X, Y (mm)'),first).label,operationField(t('Second trim point X, Y (mm)'),second).label,
   operationField(t('Keep side'),side).label,trimButton);
  fields.append(trim);

  const body=element('div');
  body.className='sketch-body';
  body.append(preview,fields);
  const status=element('p');
  status.className='parameter-status';
  status.setAttribute('role','status');
  status.setAttribute('aria-label',t('Sketch status'));
  const save=element('button',t('Save path')),closePath=element('button',t('Close into outline'));
  save.className='primary';
  const footer=element('footer');
  footer.append(status,closePath,save);
  if(id){
   const remove=element('button',t('Delete path'));
   remove.onclick=()=>change(()=>session.removeSketchPath(id));
   footer.insertBefore(remove,closePath);
  }
  dialog.append(header,body,footer);

  function read():PlanarSketch&{profile:Path}{
   return {version:1,id:id??'preview-path',name:name.value.trim(),plane:plane.value as SketchPlane,
    profile:{kind:'path',id:profileId,...parseSketchOutline(points.value.trim().split(/\r?\n/))}};
  }
  function report(error:unknown){
   status.textContent=error instanceof FeatureEvaluationError?error.diagnostic.message:error instanceof Error?error.message:String(error);
  }
  function draw(){
   preview.replaceChildren();
   status.textContent='';
   save.disabled=closePath.disabled=trimButton.disabled=true;
   try{
    const {contour}=evaluateSketch(read(),doc),x=contour.map(point=>point[0]),y=contour.map(point=>-point[1]);
    const left=Math.min(...x),top=Math.min(...y),width=Math.max(...x)-left,height=Math.max(...y)-top,margin=Math.max(width,height,1)*.15;
    const svg=document.createElementNS(svgNS,'svg');
    svg.setAttribute('viewBox',`${left-margin} ${top-margin} ${width+2*margin} ${height+2*margin}`);
    svg.setAttribute('aria-hidden','true');
    const line=document.createElementNS(svgNS,'polyline');
    line.setAttribute('points',contour.map(([x,y])=>`${x},${-y}`).join(' '));
    line.setAttribute('class','sketch-path-line');
    svg.append(line);
    for(const point of [contour[0],contour.at(-1)!]){
     const endpoint=document.createElementNS(svgNS,'circle');
     endpoint.setAttribute('cx',String(point[0]));
     endpoint.setAttribute('cy',String(-point[1]));
     endpoint.setAttribute('r',String(margin*.15));
     endpoint.setAttribute('class','sketch-handle');
     svg.append(endpoint);
    }
    preview.append(svg);
    save.disabled=closePath.disabled=trimButton.disabled=false;
   }catch(error){report(error);}
  }
  fields.addEventListener('input',draw);
  fields.addEventListener('change',draw);

  function change(commit:()=>void){
   try{
    if(session.state.revision!==revision)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
    commit();
    dialog.close();
    showObjects();
   }catch(error){report(error);}
  }
  save.onclick=()=>change(()=>{
   const {name,plane,profile}=read();
   if(id)session.updateSketch(id,{name,plane,profile});
   else session.addSketch(profile,{name,plane});
  });
  closePath.onclick=()=>change(()=>{
   const {name,plane,profile}=read();
   if(id)session.closeSketchPath(id,profile,{name,plane});
   else session.addSketch({...profile,kind:'outline'},{name,plane});
  });
  trimButton.onclick=()=>{
   try{
    const path=trimSketchProfile(read(),doc,parseSketchPoint(first.value),parseSketchPoint(second.value),side.value==='left'?'left':'right');
    if(path.kind!=='path')return;
    points.value=formatSketchPoints(path.points,path.bulges).join('\n');
    draw();
   }catch(error){report(error);}
  };
  draw();
  dialog.showModal();
 }
 return {open,dispose(){dialog.close();dialog.remove();}};
}
