// SPDX-License-Identifier: BSD-3-Clause
import {drawingAnnotationLimit,newId,t,validDrawingPosition} from '@brickwright/cad-core';
import type {AssemblyEdgeDimension,CadDocument,SketchPoint} from '@brickwright/cad-core';
import {pickAssemblyEdge,saveAssemblyEdge} from './assembly-edge-dimension.js';
import type {AssemblyDrawingEdge} from './assembly-edge-dimension.js';
import type {DrawingLayout} from './drawing-page.js';

export function mountAssemblyEdgeControls(panel:HTMLDetailsElement,preview:HTMLElement,status:HTMLElement,dimensions:AssemblyEdgeDimension[],current:()=>CadDocument,layout:()=>DrawingLayout|undefined,showDrawing:()=>void,render:()=>void){
 const title=document.createElement('summary'),add=document.createElement('button'),list=document.createElement('ul');
 title.textContent=t('Model edge dimensions');
 add.textContent=t('Add edge dimension');
 list.className='drawing-dimension-list';
 panel.append(title,add,list);
 let picking=false,selected:AssemblyDrawingEdge|undefined,editing:string|undefined;

 function reset(){
  picking=false;selected=undefined;editing=undefined;
  add.setAttribute('aria-pressed','false');
  preview.classList.remove('picking');
  preview.querySelector('.drawing-model-edge-marker')?.remove();
 }
 function start(id?:string){
  if(!layout())return;
  reset();editing=id;picking=true;
  add.setAttribute('aria-pressed','true');
  showDrawing();
  preview.classList.add('picking');
  preview.scrollIntoView({block:'nearest'});
  status.textContent=t('Select a visible model edge in the drawing views.');
 }
 add.onclick=()=>{if(picking){reset();refresh();}else start();};
 preview.addEventListener('pointerup',event=>{
  const page=layout(),svg=preview.querySelector('svg');
  if(!picking||!page||!svg||event.button!==0)return;
  const inverse=svg.getScreenCTM()?.inverse();
  if(!inverse)return;
  const picked=new DOMPoint(event.clientX,event.clientY).matrixTransform(inverse);
  const point:SketchPoint=[picked.x,page.height-picked.y];
  if(!selected){
   selected=pickAssemblyEdge(page.assemblyEdges??[],point,3);
   if(!selected){status.textContent=t('Select a visible model edge in the drawing views.');return;}
   const marker=document.createElementNS(svg.namespaceURI,'path');
   marker.setAttribute('class','drawing-model-edge-marker');
   marker.setAttribute('d',selected.visible.map(([x,y],i)=>(i?'L ':'M ')+x+' '+(page.height-y)).join(' '));
   svg.append(marker);
   status.textContent=t`Selected edge on ${current().nodes[selected.bodyId].name}. Pick where to place its projected length.`;
   return;
  }
  const at=point.map(value=>Number(value.toFixed(2))) as SketchPoint;
  if(!validDrawingPosition(...at)){status.textContent=t('Pick a position inside the drawing area.');return;}
  const dimension=saveAssemblyEdge(selected,current(),at,editing??newId());
  if(editing)dimensions[dimensions.findIndex(item=>item.id===editing)]=dimension;
  else dimensions.push(dimension);
  reset();
  render();
 });

 function refresh(){
  const page=layout();
  add.disabled=!page?.assemblyEdges?.length||dimensions.length>=drawingAnnotationLimit;
  list.replaceChildren();
  for(const [i,item] of dimensions.entries()){
   const row=document.createElement('li'),replace=document.createElement('button'),remove=document.createElement('button');
   replace.textContent=t`Edit edge dimension ${i+1}`;
   replace.disabled=!page?.assemblyEdges?.length;
   replace.onclick=()=>start(item.id);
   remove.textContent='×';
   remove.setAttribute('aria-label',t`Remove edge dimension ${i+1}`);
   remove.onclick=()=>{dimensions.splice(i,1);render();};
   if(page?.annotationIssues.includes(item.id)){
    const warning=document.createElement('small');
    warning.textContent=t('Anchor unavailable');
    row.append(warning);
   }
   row.append(replace,remove);
   list.append(row);
  }
  status.textContent=page?.annotationIssues.length?t('Repair or remove unavailable drawing dimensions before exporting.'):'';
 }
 reset();
 return {reset,refresh};
}
