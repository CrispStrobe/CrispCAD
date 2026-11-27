// SPDX-License-Identifier: BSD-3-Clause
// The status bar's exact-kernel indicator: what the exact worker is doing, for how long, and a
// Cancel button. Cancelling terminates the exact worker, which is safe: exact results are
// committed only after the kernel answers, so a stopped job leaves the model and history as they
// were (a stale exact feature keeps its stale marker and the last geometry).
import {t} from '@brickwright/cad-core';
import type {ExactActivity} from './geometry-client.js';

const labels:Record<NonNullable<ExactActivity['operation']>,string>={
 'feature-display':'Exact feature',
 'export-step':'STEP export',
 measure:'Exact measure',
 edges:'Exact edges',
 'import-step':'STEP import',
 drawing:'Exact drawing',
 section:'Exact section',
};

export function mountExactActivity(parent:HTMLElement,source:{readonly exactActivity:ExactActivity;onExactActivity(listener:(activity:ExactActivity)=>void):()=>void;cancelExact():void}){
 const chip=document.createElement('span'),text=document.createElement('span'),cancel=document.createElement('button');
 chip.className='exact-activity';chip.hidden=true;
 text.setAttribute('aria-live','polite');
 cancel.type='button';cancel.textContent=t('Cancel');cancel.title=t('Stop the exact kernel. The model is not changed.');
 cancel.setAttribute('aria-label',t('Cancel exact kernel job'));
 cancel.onclick=()=>source.cancelExact();
 chip.append(text,cancel);parent.append(chip);
 let timer:ReturnType<typeof setInterval>|undefined;
 const render=(activity:ExactActivity)=>{
  chip.hidden=!activity.busy;
  if(!activity.busy){clearInterval(timer);timer=undefined;return;}
  const seconds=Math.floor((Date.now()-(activity.since??Date.now()))/1000);
  text.textContent=t`${t(labels[activity.operation??'feature-display'])} on the exact kernel… ${seconds} s`;
 };
 const unsubscribe=source.onExactActivity(activity=>{
  render(activity);
  if(activity.busy&&!timer)timer=setInterval(()=>render(source.exactActivity),1000);
 });
 render(source.exactActivity);
 return {element:chip,dispose(){unsubscribe();clearInterval(timer);chip.remove();}};
}
