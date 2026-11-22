// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession,FeatureEvaluationError,t} from '@brickwright/cad-core';
import type {CadDocument,CadSession,SketchPlane} from '@brickwright/cad-core';

export function mountMirrorPanel(parent:HTMLElement,session:CadSession,evaluate:(doc:CadDocument)=>Promise<unknown>,afterApply:()=>Promise<unknown>){
 const dialog=document.createElement('dialog');
 dialog.className='sketch-dialog mirror-dialog';
 parent.append(dialog);
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 let epoch=0;
 dialog.addEventListener('close',()=>epoch++);

 function open(id:string,edit=false){
  const {document:doc,revision}=session.state;
  const node=doc.nodes[id];
  if(!node||(edit?node.kind!=='mirror':node.reference||!doc.roots.includes(id)))throw new Error(t('Select one top-level body to mirror'));
  const previous=edit&&node.kind==='mirror'?node:undefined;
  const title=t(previous?'Edit mirror':'Mirror body');
  const ticket=++epoch;
  dialog.setAttribute('aria-label',title);
  dialog.replaceChildren();

  const header=document.createElement('header');
  const heading=document.createElement('h2');
  heading.textContent=title;
  const close=document.createElement('button');
  close.textContent='×';
  close.setAttribute('aria-label',t('Close mirror'));
  close.onclick=()=>dialog.close();
  header.append(heading,close);

  const form=document.createElement('form');
  const hint=document.createElement('p');
  hint.textContent=t('The offset sets the plane’s position along its perpendicular axis. The source stays editable under Inputs.');
  const fields=document.createElement('div');
  fields.className='sketch-fields';
  const planeLabel=document.createElement('label');
  planeLabel.textContent=t('Mirror plane');
  const plane=document.createElement('select');
  for(const [value,label] of [['YZ',t('YZ (X offset)')],['XZ',t('XZ (Y offset)')],['XY',t('XY (Z offset)')]]){
   const option=document.createElement('option');
   option.value=value;
   option.textContent=label;
   plane.append(option);
  }
  plane.value=previous?.plane??'YZ';
  planeLabel.append(plane);
  const offsetLabel=document.createElement('label');
  offsetLabel.textContent=t('Plane offset (mm)');
  const offset=document.createElement('input');
  offset.type='text';
  offset.value=String(previous?.offset??0);
  offsetLabel.append(offset);
  fields.append(planeLabel,offsetLabel);

  const footer=document.createElement('footer');
  const status=document.createElement('p');
  status.className='parameter-status';
  status.setAttribute('role','status');
  const apply=document.createElement('button');
  apply.type='submit';
  apply.className='primary';
  apply.textContent=t(previous?'Apply mirror changes':'Mirror body');
  footer.append(status,apply);
  form.append(hint,fields,footer);
  dialog.append(header,form);
  form.onsubmit=async event=>{
   event.preventDefault();
   if(apply.disabled)return;
   apply.disabled=true;
   status.textContent='';
   const text=offset.value.trim();
   const inputs={plane:plane.value as SketchPlane,offset:text&&Number.isFinite(Number(text))?Number(text):text};
   const commit=(target:CadSession)=>previous?target.editMirror(id,inputs):target.mirrorBody(id,inputs);
   const current=()=>session.state.revision===revision;
   const trial=createCadSession(doc);
   try{
    if(!current())throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
    commit(trial);
    await evaluate(trial.state.document);
    if(!dialog.open||epoch!==ticket)return;
    if(!current())throw new Error(t('The model changed while checking geometry. Close and reopen this dialog.'));
    commit(session);
    dialog.close();
    await afterApply();
   }catch(error){
    if(dialog.open&&epoch===ticket)status.textContent=error instanceof FeatureEvaluationError?error.diagnostic.message:error instanceof Error?error.message:String(error);
   }finally{
    trial.dispose();
    apply.disabled=false;
   }
  };
  dialog.showModal();
 }
 return {open,dispose(){epoch++;dialog.close();dialog.remove();}};
}
