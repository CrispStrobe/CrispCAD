// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {SketchLoop,SketchOutlineProfile} from '@brickwright/cad-core';
import {mountOutlineConstraintControls} from './outline-constraint-controls.js';

type OutlineOptions=Parameters<typeof mountOutlineConstraintControls>[2];
type LoopOptions=Omit<OutlineOptions,'initial'|'read'|'apply'|'changed'> & {
  initial:SketchLoop[];
  read:()=>SketchLoop[];
  apply:(id:string,geometry:Pick<SketchOutlineProfile,'points'|'bulges'>)=>void;
};

export function mountRegionConstraintControls(form:HTMLElement,dialog:HTMLDialogElement,options:LoopOptions){
 const panel=document.createElement('details'),summary=document.createElement('summary');
 panel.className='sketch-expressions';
 summary.textContent=t('Region loop constraints');
 const picker=document.createElement('select'),label=document.createElement('label');
 label.textContent=t('Constrained loop');
 picker.setAttribute('aria-label',t('Constrained loop'));
 label.append(picker);
 const status=document.createElement('p');
 status.setAttribute('role','status');
 status.setAttribute('aria-label',t('Region constraint status'));
 const clear=document.createElement('button');
 clear.type='button';
 clear.textContent=t('Clear region constraints');
 const host=document.createElement('div');
 panel.append(summary,label,status,clear,host);
 form.append(panel);

 const entries=new Map<string,{holder:HTMLElement;controls:ReturnType<typeof mountOutlineConstraintControls>}>();
 let initial=new Map(options.initial.filter(loop=>loop.kind==='outline').map(loop=>[loop.id,loop]));
 const signature=(loops:SketchLoop[])=>JSON.stringify(loops.map(loop=>[loop.id,loop.kind]));
 let locked=Array.from(initial.values()).some(loop=>loop.relations?.length)?signature(options.initial):undefined;
 panel.open=locked!==undefined;
 let current:SketchLoop[]=[];
 let changedTopology=false;
 const hasConstraints=()=>Array.from(entries.values()).some(({controls})=>controls.hasConstraints);
 const pending=()=>Array.from(entries.values()).some(({controls})=>controls.pending);
 const topologyMessage=t('Restore the original region loops or clear their constraints.');
 function ensure(id:string){
  if(entries.has(id))return;
  const holder=document.createElement('div');
  host.append(holder);
  const loop=current.find(loop=>loop.id===id);
  const controls=mountOutlineConstraintControls(holder,dialog,{
   ...options,initial:initial.get(id)?.vertexIds?initial.get(id):loop?.kind==='outline'?loop:undefined,
   visible:()=>options.visible()&&picker.value===id,
   available:()=>options.available()&&!changedTopology,
   pending:solving=>{picker.disabled=clear.disabled=solving;options.pending(solving);},
   changed:()=>{locked=hasConstraints()?(locked??signature(current)):undefined;},
   read:()=>{
    const loop=options.read().find(loop=>loop.id===id);
    if(loop?.kind!=='outline')throw new Error(topologyMessage);
    return loop;
   },
   apply:geometry=>options.apply(id,geometry)
  });
  entries.set(id,{holder,controls});
 }
 function select(){
  if(picker.value)ensure(picker.value);
  for(const [id,{holder,controls}] of entries){
   holder.hidden=id!==picker.value;
   controls.refresh();
  }
 }
 function refresh(){
  panel.hidden=!options.visible();
  if(panel.hidden)return;
  let loops:SketchLoop[];
  try{loops=options.read();}catch{loops=[];}
  current=loops;
  changedTopology=locked!==undefined&&locked!==signature(loops);
  status.textContent=changedTopology?topologyMessage:'';
  status.hidden=!changedTopology;
  picker.disabled=changedTopology||pending();
  clear.hidden=!changedTopology;
  clear.disabled=pending();
  host.hidden=changedTopology;
  if(changedTopology)return;
  const outlines=loops.flatMap((loop,index)=>loop.kind==='outline'?[{loop,index}]:[]);
  panel.hidden=outlines.length===0;
  const selected=picker.value;
  picker.replaceChildren(...outlines.map(({loop,index})=>new Option(t`Outline loop ${index+1}`,loop.id)));
  if(outlines.some(({loop})=>loop.id===selected))picker.value=selected;
  for(const {loop} of outlines)if(initial.get(loop.id)?.relations?.length)ensure(loop.id);
  select();
 }
 picker.onchange=select;
 clear.onclick=()=>{
  initial=new Map(Array.from(initial,([id,loop])=>[id,{...loop,relations:undefined}]));
  entries.clear();
  host.replaceChildren();
  locked=undefined;
  refresh();
 };
 for(const event of ['input','change'])panel.addEventListener(event,event=>event.stopPropagation());
 return {
  refresh,
  forSave(loops:SketchLoop[]){
   if(locked!==undefined&&locked!==signature(loops))throw new Error(topologyMessage);
   return loops.map(loop=>loop.kind==='outline'?{...loop,...entries.get(loop.id)?.controls.forSave(loop)}:loop);
  },
  get hasConstraints(){return hasConstraints()||locked!==undefined;},
  get pending(){return pending();}
 };
}
