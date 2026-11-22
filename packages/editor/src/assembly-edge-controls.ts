// SPDX-License-Identifier: BSD-3-Clause
import {drawingAnnotationLimit,newId,t,validDrawingPosition} from '@brickwright/cad-core';
import type {AssemblyCurveDimension,AssemblyEdgeDimension,CadDocument,SketchPoint} from '@brickwright/cad-core';
import {supportsCurveDimension} from './assembly-curve-dimension.js';
import type {AssemblyDrawingCurve} from './assembly-curve-dimension.js';
import {pickAssemblyEdge,saveAssemblyEdge} from './assembly-edge-dimension.js';
import type {AssemblyDrawingEdge} from './assembly-edge-dimension.js';
import type {DrawingLayout} from './drawing-page.js';

type DimensionKind='aligned'|AssemblyCurveDimension['kind'];

export function mountAssemblyEdgeControls(
 panel:HTMLDetailsElement,preview:HTMLElement,status:HTMLElement,dimensions:AssemblyEdgeDimension[],
 curves:AssemblyCurveDimension[],current:()=>CadDocument,layout:()=>DrawingLayout|undefined,showDrawing:()=>void,render:()=>void
){
 const title=document.createElement('summary'),add=document.createElement('button'),list=document.createElement('ul');
 const field=document.createElement('label'),type=document.createElement('select');
 title.textContent=t('Model edge dimensions');
 add.textContent=t('Add edge dimension');
 field.textContent=t('Model edge dimension type');
 type.setAttribute('aria-label',t('Model edge dimension type'));
 const names:Record<DimensionKind,string>={aligned:t('Projected edge length'),radius:t('Radius dimension'),diameter:t('Diameter dimension'),'arc-length':t('Arc length dimension')};
 for(const [kind,name] of Object.entries(names))type.add(new Option(name,kind));
 field.append(type);
 list.className='drawing-dimension-list';
 panel.append(title,field,add,list);
 let picking=false,selected:{edge:AssemblyDrawingEdge}|{curve:AssemblyDrawingCurve;kind:AssemblyCurveDimension['kind']}|undefined;
 let editing:string|undefined;
 const mode=()=>type.value as DimensionKind;

 function reset(){
  picking=false;selected=undefined;editing=undefined;
  add.setAttribute('aria-pressed','false');
  preview.classList.remove('picking');
  preview.querySelector('.drawing-model-edge-marker')?.remove();
 }
 const prompt=(kind:DimensionKind)=>kind==='aligned'?t('Select a visible model edge in the drawing views.'):
  t('Select a visible circle or arc in a face-on drawing view.');
 function start(kind:DimensionKind,id?:string){
  if(!layout())return;
  reset();editing=id;picking=true;type.value=kind;
  add.setAttribute('aria-pressed','true');
  showDrawing();
  preview.classList.add('picking');
  preview.scrollIntoView({block:'nearest'});
  status.textContent=prompt(kind);
 }
 add.onclick=()=>{if(picking){reset();refresh();}else start(mode());};
 type.onchange=()=>{reset();refresh();};
 preview.addEventListener('pointerup',event=>{
  const page=layout(),svg=preview.querySelector('svg');
  if(!picking||!page||!svg||event.button!==0)return;
  const inverse=svg.getScreenCTM()?.inverse();
  if(!inverse)return;
  const picked=new DOMPoint(event.clientX,event.clientY).matrixTransform(inverse);
  const point:SketchPoint=[picked.x,page.height-picked.y];
  if(!selected){
   const kind=mode();
   if(kind==='aligned'){
    const edge=pickAssemblyEdge(page.assemblyEdges??[],point,3);
    if(edge)selected={edge};
   }else{
    const candidates=(page.assemblyCurves??[]).filter(curve=>supportsCurveDimension(curve,kind))
     .flatMap(curve=>curve.visible.map(visible=>({curve,visible})));
    const hit=pickAssemblyEdge(candidates,point,3);
    if(hit)selected={curve:hit.curve,kind};
   }
   if(!selected){status.textContent=prompt(kind);return;}
   const target='edge' in selected?selected.edge:selected.curve;
   const segments='edge' in selected?[selected.edge.visible]:selected.curve.visible;
   const marker=document.createElementNS(svg.namespaceURI,'path');
   marker.setAttribute('class','drawing-model-edge-marker');
   marker.setAttribute('d',segments.map(segment=>
    segment.map(([x,y],i)=>(i?'L ':'M ')+x+' '+(page.height-y)).join(' ')).join(' '));
   svg.append(marker);
   const name=current().nodes[target.bodyId].name;
   status.textContent=kind==='aligned'?t`Selected edge on ${name}. Pick where to place its projected length.`:
    t`Selected curve on ${name}. Pick where to place its dimension.`;
   return;
  }
  const at=point.map(value=>Number(value.toFixed(2))) as SketchPoint;
  if(!validDrawingPosition(...at)){status.textContent=t('Pick a position inside the drawing area.');return;}
  const id=editing??newId();
  if('edge' in selected)store(dimensions,saveAssemblyEdge(selected.edge,current(),at,id));
  else{
   const {bodyId,view,source}=selected.curve;
   store(curves,{id,bodyId,view,source,at,kind:selected.kind});
  }
  reset();
  render();
 });
 function store<T extends {id:string}>(items:T[],dimension:T){
  if(editing)items[items.findIndex(item=>item.id===editing)]=dimension;
  else items.push(dimension);
 }
 function refresh(){
  const page=layout();
  const allowed=(kind:DimensionKind)=>kind==='aligned'?!!page?.assemblyEdges?.length:
   !!page?.assemblyCurves?.some(curve=>supportsCurveDimension(curve,kind));
  for(const option of type.options)option.disabled=!allowed(option.value as DimensionKind);
  if(!allowed(mode())&&allowed('aligned'))type.value='aligned';
  field.hidden=!page?.assemblyCurves?.length&&!curves.length;
  add.disabled=!allowed(mode())||dimensions.length+curves.length>=drawingAnnotationLimit;
  list.replaceChildren();
  const show=(item:AssemblyEdgeDimension|AssemblyCurveDimension,kind:DimensionKind,i:number,removeItem:()=>void)=>{
   const row=document.createElement('li'),replace=document.createElement('button'),remove=document.createElement('button');
   replace.textContent=kind==='aligned'?t`Edit edge dimension ${i+1}`:t`Edit curve dimension ${i+1} · ${names[kind]}`;
   replace.disabled=!allowed(kind);
   replace.onclick=()=>start(kind,item.id);
   remove.textContent='×';
   remove.setAttribute('aria-label',t`Remove edge dimension ${i+1}`);
   remove.onclick=()=>{removeItem();render();};
   if(page?.annotationIssues.includes(item.id)){
    const warning=document.createElement('small');
    warning.textContent=t('Anchor unavailable');
    row.append(warning);
   }
   row.append(replace,remove);
   list.append(row);
  };
  dimensions.forEach((item,i)=>show(item,'aligned',i,()=>dimensions.splice(i,1)));
  curves.forEach((item,i)=>show(item,item.kind,dimensions.length+i,()=>curves.splice(i,1)));
  status.textContent=page?.annotationIssues.length?t('Repair or remove unavailable drawing dimensions before exporting.'):'';
 }
 reset();
 return {reset,refresh};
}
