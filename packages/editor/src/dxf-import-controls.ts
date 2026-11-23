// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import {maxSketchDxfBytes,prepareSketchDxf} from './import-sketch-dxf.js';

type PreparedDxf=ReturnType<typeof prepareSketchDxf>;
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 return node;
};

export function mountDxfImportControls<P>(parent:HTMLElement,options:{
 active:()=>boolean; available?:()=>boolean; readState?:(reading:boolean)=>void;
 revision:()=>number; checkCurrent:()=>void;
 read:(drawing:PreparedDxf,assumeMm:boolean,layers?:readonly string[])=>P;
 imported:(profile:P,name:string)=>void; error:(error:unknown)=>void;
}){
 const units=element('label',t('Assume millimetres if the file has no units'));
 const assumeMm=element('input'),file=element('input'),filename=element('p');
 assumeMm.type='checkbox';units.className='sketch-toggle';units.prepend(assumeMm);
 file.type='file';file.accept='.dxf';file.setAttribute('aria-label',t('Choose DXF file'));
 const layers=element('fieldset'),list=element('div'),toggleAll=element('button'),apply=element('button',t('Import selected layers'));
 layers.className='dxf-layer-picker';list.className='dxf-layer-list';
 toggleAll.type=apply.type='button';
 layers.append(element('legend',t('DXF layers')),toggleAll,list);
 layers.hidden=apply.hidden=true;
 parent.append(units,file,filename,layers,apply);

 let prepared:PreparedDxf|undefined,choices:{name:string;input:HTMLInputElement}[]=[];
 let name='',reading=false;

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
   options.imported(options.read(prepared,assumeMm.checked,selected),name);
   apply.hidden=!choices.length;
  }catch(error){
   apply.hidden=false;
   options.error(error);
  }
 }
 apply.onclick=applyImport;

 file.onchange=async()=>{
  const chosen=file.files?.[0],revision=options.revision();
  if(!chosen||reading||options.available?.()===false){file.value='';return;}
  prepared=undefined;choices=[];name='';
  list.replaceChildren();filename.textContent='';layers.hidden=apply.hidden=true;
  reading=file.disabled=true;
  options.readState?.(true);
  try{
   if(chosen.size>maxSketchDxfBytes)throw new Error(t('Choose a DXF file up to 1 MB.'));
   const text=await chosen.text();
   if(!options.active())return;
   options.checkCurrent();
   if(revision!==options.revision())throw new Error(t('The sketch changed while reading DXF. Choose the file again.'));
   prepared=prepareSketchDxf(text);
   name=chosen.name.replace(/\.dxf$/i,'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,160);
   filename.textContent=chosen.name;
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
   reading=file.disabled=false;
   file.value='';
   options.readState?.(false);
   refresh();
  }
  if(prepared&&!choices.length)applyImport();
 };
}
