// SPDX-License-Identifier: BSD-3-Clause
import {drawingScales,drawingSourceFor,evaluateExtrusion,resolveDrawingSource,t} from '@brickwright/cad-core';
import type {CadSession,DrawingInputs,DrawingScale} from '@brickwright/cad-core';
import type {CadFile} from './index.js';
import {layoutDrawing} from './drawing-layout.js';
import type {DrawingLayout} from './drawing-layout.js';
import {exportDrawingPdf} from './drawing-pdf.js';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{
 const el=document.createElement(tag);
 if(text!==undefined)el.textContent=text;
 return el;
};

function previewDrawing(layout:DrawingLayout) {
 const ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);
 svg.setAttribute('aria-label',t('Drawing preview'));
 svg.setAttribute('role','img');
 for(const {points,stroke,closed} of layout.paths){
  const path=document.createElementNS(ns,'path');
  path.setAttribute('d',points.map(([x,y],i)=>(i?'L ':'M ')+x+' '+(layout.height-y)).join(' ')+(closed?' Z':''));
  path.setAttribute('class','drawing-'+stroke);
  svg.append(path);
 }
 for(const {center:[x,y],radius} of layout.circles){
  const circle=document.createElementNS(ns,'circle');
  circle.setAttribute('cx',String(x));circle.setAttribute('cy',String(layout.height-y));circle.setAttribute('r',String(radius));
  circle.setAttribute('class','drawing-visible');svg.append(circle);
 }
 for(const {x,y,size,text} of layout.texts){
  const label=document.createElementNS(ns,'text');
  label.setAttribute('x',String(x));label.setAttribute('y',String(layout.height-y));
  label.setAttribute('font-size',String(size));label.textContent=text;svg.append(label);
 }
 return svg;
}

export function mountDrawingPanel(parent:HTMLElement,session:CadSession,onExport?: (file:CadFile)=>void|Promise<void>){
 const dialog=element('dialog');dialog.className='sketch-dialog drawing-dialog';
 dialog.setAttribute('aria-label',t('Drawing sheet'));parent.append(dialog);
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 let refresh:(()=>void)|undefined;
 const unsubscribe=session.subscribe(()=>{if(dialog.open)refresh?.();});
 return {
  open(options:{featureId:string}|{sheetId:string}){
   const doc=session.state.document;
   const saved='sheetId' in options?doc.drawings?.find(sheet=>sheet.id===options.sheetId):undefined;
   const initial= 'featureId' in options ? drawingSourceFor(doc,options.featureId) : saved?.source;
   if(!initial)throw new Error(t('Choose an available drawing source.'));
   dialog.replaceChildren();
   const title=element('input');title.maxLength=80;title.value=saved?.title??(doc.sketches?.[initial.sketchId]?.name??t('Drawing sheet')).slice(0,80);
   const source=element('select');
   const scale=element('select');
   for(const ratio of drawingScales)scale.add(new Option(ratio,ratio));
   scale.value=saved?.scale??'1:1';
   const hidden=element('input');hidden.type='checkbox';hidden.checked=saved?.hiddenLines??true;
   const form=element('div');form.className='drawing-form';
   const label=(text:string,control:HTMLInputElement|HTMLSelectElement)=>{
    control.setAttribute('aria-label',t(text));
    const field=element('label',t(text));field.append(control);form.append(field);
   };
   label('Sheet title',title);label('Drawing source',source);label('Drawing scale',scale);label('Show hidden lines',hidden);
   const section=element('input');section.type='checkbox';section.checked=!!saved?.section;
   const axis=element('select');
   axis.add(new Option(t('Sketch X'),'u'));axis.add(new Option(t('Sketch Y'),'v'));
   axis.value=saved?.section?.axis??'v';
   const position=element('input');position.type='text';position.maxLength=160;
   position.value=String(saved?.section?.position??'0');
   label('Show section A-A',section);
   label('Section axis',axis);label('Section position (mm)',position);
   const heading=element('header');
   const close=element('button','×');close.setAttribute('aria-label',t('Close drawing'));
   close.onclick=()=>dialog.close();heading.append(element('h2',t('Drawing sheet')),close);
   const preview=element('div');preview.className='drawing-preview';
   const status=element('p');status.setAttribute('role','status');status.setAttribute('aria-label',t('Drawing status'));
   const footer=element('footer');
   const save=element('button',t('Save drawing sheet'));save.className='primary';
   const pdf=element('button',t('Export drawing PDF'));
   const remove=element('button',t('Remove drawing sheet'));
   footer.append(status);
   if(saved)footer.append(remove);
   if(onExport)footer.append(pdf);
   footer.append(save);
   const body=element('div');body.className='drawing-body';body.append(preview,form);
   dialog.append(heading,body,footer);
   let choice=initial.featureId,lastRevision=-1;
   const listSources=()=>{
    const current=session.state.document;
    const valid=Object.values(current.nodes).flatMap(node=>{
     const ref=drawingSourceFor(current,node.id);
     return ref?[{ref,name:current.sketches![ref.sketchId].name+' · '+node.name}]:[];
    });
    source.replaceChildren(...valid.map(({ref,name})=>new Option(name,ref.featureId)));
    const initialMissing=choice===initial.featureId&&!resolveDrawingSource(current,initial);
    if(initialMissing||!valid.some(item=>item.ref.featureId===choice)){
     source.add(new Option(t('Unavailable drawing source'),''),0);source.value='';
    }else source.value=choice;
   };
   let centerAutomatically=!saved?.section;
   const centerCut=()=>{
    const current=session.state.document,ref=drawingSourceFor(current,source.value);
    if(!ref)return;
    const resolved=resolveDrawingSource(current,ref)!;
    const coordinate=axis.value==='u'?0:1;
    const values=evaluateExtrusion(resolved.node,current).contour.map(point=>point[coordinate]);
    position.value=String(Number(((Math.min(...values)+Math.max(...values))/2).toFixed(6)));
   };
   const read=():DrawingInputs=>{
    const current=session.state.document;
    const ref=drawingSourceFor(current,source.value);
    if(!ref)throw new Error(t('Drawing source unavailable. Choose another sketch extrusion.'));
    if(!title.value.trim())throw new Error(t('Enter a drawing sheet title.'));
    const cut=position.value.trim();
    if(section.checked&&!cut)throw new Error(t('Enter a section position in millimetres.'));
    const value=Number(cut);
    return {title:title.value.trim(),source:ref,scale:scale.value as DrawingScale,hiddenLines:hidden.checked,
     ...(section.checked?{section:{axis:axis.value==='u'?'u':'v',position:Number.isFinite(value)?value:cut}}:{})};
   };
   let layout:DrawingLayout|undefined;
   const render=()=>{
    axis.parentElement!.hidden=position.parentElement!.hidden=!section.checked;
    preview.replaceChildren();layout=undefined;status.textContent='';
    try{
     layout=layoutDrawing(session.state.document,read());
     preview.append(previewDrawing(layout));
    }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
    save.disabled=pdf.disabled=!layout;
   };
   refresh=()=>{
    const current=session.state;
    if(current.document.id!==doc.id||(saved&&!current.document.drawings?.some(sheet=>sheet.id===saved.id))){
     dialog.close();return;
    }
    if(current.revision===lastRevision)return;
    lastRevision=current.revision;
    listSources();if(centerAutomatically)centerCut();render();
   };
   source.onchange=()=>{choice=source.value;if(centerAutomatically)centerCut();render();};
   axis.onchange=()=>{if(centerAutomatically)centerCut();render();};
   position.oninput=()=>{centerAutomatically=false;render();};
   section.onchange=render;
   title.oninput=scale.onchange=hidden.onchange=render;
   save.onclick=()=>{
    try{session.saveDrawingSheet(read(),saved?.id);dialog.close();}
    catch(error){status.textContent=error instanceof Error?error.message:String(error);}
   };
   remove.onclick=()=>{if(saved){session.removeDrawingSheet(saved.id);if(dialog.open)dialog.close();}};
   pdf.onclick=async()=>{
    if(!layout||!onExport)return;
    pdf.disabled=true;
    try{await onExport(exportDrawingPdf(layout,read().title));}
    catch(error){if(dialog.open)status.textContent=error instanceof Error?error.message:String(error);}
    finally{pdf.disabled=!layout;}
   };
   refresh();dialog.showModal();
  },
  dispose(){unsubscribe();dialog.close();dialog.remove();}
 };
}
