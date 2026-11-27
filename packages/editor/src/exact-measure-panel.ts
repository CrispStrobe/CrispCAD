// SPDX-License-Identifier: BSD-3-Clause
// "Measure exactly": volume, area, bounds and centroid of the selected bodies (or all bodies) from
// the exact B-rep kernel, which loads on first use. The same request and text as the terminal's
// `measure exact`, shown in a dialog so a host's menu or a tablet needs no terminal.
import {formatExactResult,t} from '@brickwright/cad-core';
import type {CadSession,ExactCommandHost} from '@brickwright/cad-core';

export function mountExactMeasurePanel(parent:HTMLElement,session:CadSession,exact:ExactCommandHost){
 const dialog=document.createElement('dialog');
 dialog.className='sketch-dialog exact-measure-dialog';
 dialog.setAttribute('aria-label',t('Exact measurements'));
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 parent.append(dialog);
 let controller:AbortController|undefined,epoch=0;
 dialog.addEventListener('close',()=>{epoch++;controller?.abort();});
 async function open(){
  const doc=session.state.document;
  if(!doc.roots.length)throw new Error(t('Add a body to measure.'));
  const bodies=session.state.selection.filter(id=>doc.roots.includes(id)),ticket=++epoch;
  controller?.abort();controller=new AbortController();
  dialog.replaceChildren();
  const header=document.createElement('header'),heading=document.createElement('h2'),close=document.createElement('button');
  heading.textContent=t('Exact measurements');close.type='button';close.textContent='×';close.setAttribute('aria-label',t('Close exact measurements'));close.onclick=()=>dialog.close();
  header.append(heading,close);
  const scope=document.createElement('p');
  scope.textContent=bodies.length?t`Selected bodies: ${bodies.length}`:t('All bodies (select bodies to measure only those).');
  const output=document.createElement('pre');output.className='exact-measure-output';output.setAttribute('role','status');output.setAttribute('aria-live','polite');
  output.textContent=t('Measuring on the exact kernel…');
  const footer=document.createElement('footer'),done=document.createElement('button');
  done.type='button';done.className='primary';done.textContent=t('Done');done.onclick=()=>dialog.close();
  footer.append(done);
  dialog.append(header,scope,output,footer);
  dialog.showModal();
  try{
   const result=await exact.run({operation:'measure',document:doc,bodies},controller.signal);
   if(ticket!==epoch)return;
   output.textContent=formatExactResult(result,doc).output;
  }catch(error){
   if(ticket!==epoch)return;
   output.textContent=error instanceof Error?error.message:String(error);
   output.classList.add('error');
  }
 }
 return {open,get isOpen(){return dialog.open;},dispose(){epoch++;controller?.abort();dialog.close();dialog.remove();}};
}
