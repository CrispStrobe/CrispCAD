// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import {prepareSketchDxf} from './import-sketch-dxf.js';
import {readSketchDwg} from './sketch-dwg-client.js';
import {maxSketchExchangeBytes} from './sketch-exchange-limits.js';

import type {DxfSketchImport} from './import-sketch-dxf.js';

type PreparedDxf=ReturnType<typeof prepareSketchDxf>;
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 return node;
};

export function mountDxfImportControls<P>(parent:HTMLElement,options:{
 active:()=>boolean; available?:()=>boolean; readState?:(reading:boolean)=>void;
 revision:()=>number; checkCurrent:()=>void;
 read:(drawing:PreparedDxf,assumeMm:boolean,layers?:readonly string[])=>DxfSketchImport<P>;
 imported:(profile:P,name:string)=>void; error:(error:unknown)=>void;
}){
 const units=element('label',t('Assume millimetres if the file has no units'));
 const assumeMm=element('input'),dxf=element('input'),dwg=element('input'),filename=element('p');
 assumeMm.type='checkbox';units.className='sketch-toggle';units.prepend(assumeMm);
 function fileField(input:HTMLInputElement,extension:string,label:string){
  input.type='file';input.accept=extension;input.setAttribute('aria-label',label);
  const field=element('label',label);
  field.append(input);
  return field;
 }
 const dxfField=fileField(dxf,'.dxf',t('Choose DXF file'));
 const dwgField=fileField(dwg,'.dwg',t('Choose DWG file'));
 const layoutNotice=element('small',t('Paper-space layout entities were skipped.'));
 layoutNotice.setAttribute('aria-live','polite');layoutNotice.hidden=true;
 const planeNotice=element('small',t('The source plane was unfolded into the selected sketch plane at actual size.'));
 planeNotice.hidden=true;
 const layers=element('fieldset'),list=element('div'),toggleAll=element('button'),apply=element('button',t('Import selected layers'));
 layers.className='dxf-layer-picker';list.className='dxf-layer-list';
 toggleAll.type=apply.type='button';
 const layerLabel=element('legend',t('DXF layers'));
 layers.append(layerLabel,toggleAll,list);
 layers.hidden=apply.hidden=true;
 parent.append(units,dxfField,dwgField,filename,layoutNotice,layers,apply,planeNotice);
 // Selecting a file or a layer never changes the enclosing sketch draft.
 for(const event of ['input','change'])parent.addEventListener(event,input=>input.stopPropagation());

 let prepared:PreparedDxf|undefined,choices:{name:string;input:HTMLInputElement}[]=[];
 let name='',reading=false;
 function setReading(value:boolean){
  reading=dxf.disabled=dwg.disabled=value;
  options.readState?.(value);
 }

 function refresh(){
  const checked=choices.filter(choice=>choice.input.checked).length;
  toggleAll.textContent=checked===choices.length?t('Deselect all layers'):t('Select all layers');
  apply.disabled=reading||(choices.length>0&&!checked);
 }
 toggleAll.onclick=()=>{
  const all=choices.every(choice=>choice.input.checked);
  for(const {input} of choices)input.checked=!all;
  refresh();
 };
 function applyImport(){
  if(!prepared||reading||!options.active()||options.available?.()===false)return;
  const selected=choices.length?choices.filter(choice=>choice.input.checked).map(choice=>choice.name):undefined;
  try{
   options.checkCurrent();
   const {profile,unfolded}=options.read(prepared,assumeMm.checked,selected);
   options.imported(profile,name);
   planeNotice.hidden=!unfolded;
   apply.hidden=!choices.length;
  }catch(error){
   apply.hidden=false;
   options.error(error);
  }
 }
 apply.onclick=applyImport;

 async function choose(file:HTMLInputElement,isDwg:boolean){
  const chosen=file.files?.[0],revision=options.revision();
  if(!chosen||reading||options.available?.()===false){file.value='';return;}
  prepared=undefined;choices=[];name='';
  list.replaceChildren();filename.textContent='';layers.hidden=apply.hidden=layoutNotice.hidden=planeNotice.hidden=true;
  setReading(true);
  const controller=new AbortController();
  const dialog=parent.closest('dialog');
  const close=()=>{if(!options.active())controller.abort();};
  dialog?.addEventListener('close',close);
  try{
   if(chosen.size>maxSketchExchangeBytes)throw new Error(isDwg?t('Choose a DWG file up to 1 MB.'):t('Choose a DXF file up to 1 MB.'));
   const bytes=isDwg?await chosen.arrayBuffer():undefined;
   if(!options.active())return;
   const text=bytes?await readSketchDwg(bytes,controller.signal):await chosen.text();
   if(!options.active())return;
   options.checkCurrent();
   if(revision!==options.revision())throw new Error(isDwg?t('The sketch changed while reading DWG. Choose the file again.'):t('The sketch changed while reading DXF. Choose the file again.'));
   prepared=prepareSketchDxf(text);
   name=chosen.name.replace(/\.(dxf|dwg)$/i,'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,160);
   filename.textContent=chosen.name;
   layerLabel.textContent=isDwg?t('DWG layers'):t('DXF layers');
   layoutNotice.hidden=!prepared.skippedPaperSpace;
   if(prepared.layers.length>1){
    choices=prepared.layers.map(name=>{
     const label=element('label',name),input=element('input');
     label.className='sketch-toggle';input.type='checkbox';input.checked=true;
     input.onchange=refresh;label.prepend(input);list.append(label);
     return {name,input};
    });
    layers.hidden=apply.hidden=false;
   }
  }catch(error){
   if(options.active())options.error(error);
  }finally{
   controller.abort();
   dialog?.removeEventListener('close',close);
   setReading(false);
   file.value='';
   refresh();
  }
  if(prepared&&!choices.length)applyImport();
 }
 dxf.onchange=()=>choose(dxf,false);
 dwg.onchange=()=>choose(dwg,true);
}
