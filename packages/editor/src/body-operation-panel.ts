// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession,FeatureEvaluationError,t} from '@brickwright/cad-core';
import type {CadDocument,CadSession} from '@brickwright/cad-core';

export function mountBodyOperationPanel(parent:HTMLElement,session:CadSession,evaluate:(doc:CadDocument)=>Promise<unknown>,afterApply:()=>Promise<unknown>){
 const dialog=document.createElement('dialog');
 dialog.className='sketch-dialog body-operation-dialog';
 parent.append(dialog);
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 let epoch=0;
 dialog.addEventListener('close',()=>epoch++);

 function open(options:{
  title:string;
  closeLabel:string;
  applyLabel:string;
  hint:string;
  fields:HTMLElement;
  read:()=>(target:CadSession)=>unknown;
 }){
  const {document:doc,revision}=session.state;
  const ticket=++epoch;
  dialog.setAttribute('aria-label',options.title);
  dialog.replaceChildren();

  const header=document.createElement('header');
  const heading=document.createElement('h2');
  heading.textContent=options.title;
  const close=document.createElement('button');
  close.textContent='×';
  close.setAttribute('aria-label',options.closeLabel);
  close.onclick=()=>dialog.close();
  header.append(heading,close);

  const form=document.createElement('form');
  const hint=document.createElement('p');
  hint.textContent=options.hint;
  options.fields.className='sketch-fields';
  const footer=document.createElement('footer');
  const status=document.createElement('p');
  status.className='parameter-status';
  status.setAttribute('role','status');
  const apply=document.createElement('button');
  apply.type='submit';
  apply.className='primary';
  apply.textContent=options.applyLabel;
  footer.append(status,apply);
  form.append(hint,options.fields,footer);
  dialog.append(header,form);
  form.onsubmit=async event=>{
   event.preventDefault();
   if(apply.disabled)return;
   apply.disabled=true;
   status.textContent='';
   const trial=createCadSession(doc);
   try{
    if(session.state.revision!==revision)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
    const commit=options.read();
    commit(trial);
    await evaluate(trial.state.document);
    if(!dialog.open||epoch!==ticket)return;
    if(session.state.revision!==revision)throw new Error(t('The model changed while checking geometry. Close and reopen this dialog.'));
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

export function operationField<T extends HTMLElement>(text:string,input:T){
 const label=document.createElement('label');
 const caption=document.createElement('span');
 caption.textContent=text;
 label.append(caption,input);
 return {label,input};
}
export function operationScalar(input:HTMLInputElement){
 const text=input.value.trim();
 return text&&Number.isFinite(Number(text))?Number(text):text;
}
