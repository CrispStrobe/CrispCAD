// SPDX-License-Identifier: BSD-3-Clause
// Datums and tolerances in the drawing dialog (exact assembly sheets, document version 52): choose a
// datum letter or a tolerance, tap a face or edge in a drawing view (the nearest outline; faces seen
// edge-on first, and every face or edge near the tap is offered in "Attached to"), then tap where the
// symbol goes. Touch first: no keyboard is needed, and every control is at least 44 px high.
import {drawingGdtLimit,gdtCharacteristics,gdtDatumCharacteristics,gdtDatumLetters,gdtDiameterCharacteristics,gdtFormCharacteristics,newId,t,validDrawingPosition} from '@brickwright/cad-core';
import type {CadDocument,DrawingDatum,DrawingToleranceFrame,GdtCharacteristic,SketchPoint} from '@brickwright/cad-core';
import {describeGdtTarget,gdtCandidates,gdtTargetLines} from './drawing-gdt.js';
import type {GdtCandidate} from './drawing-gdt.js';
import type {DrawingLayout} from './drawing-page.js';

export const gdtCharacteristicNames=():Record<GdtCharacteristic,string>=>({
 straightness:t('Straightness'),flatness:t('Flatness'),circularity:t('Circularity'),cylindricity:t('Cylindricity'),
 'profile-line':t('Profile of a line'),'profile-surface':t('Profile of a surface'),parallelism:t('Parallelism'),
 perpendicularity:t('Perpendicularity'),angularity:t('Angularity'),position:t('Position'),concentricity:t('Concentricity'),
 symmetry:t('Symmetry'),'circular-runout':t('Circular runout'),'total-runout':t('Total runout'),
});

/** Why a tolerance frame cannot be saved as given, or undefined. */
export function toleranceFrameProblem(frame:Pick<DrawingToleranceFrame,'characteristic'|'tolerance'|'diameter'|'modifier'|'datums'>):string|undefined{
 if(!(frame.tolerance>0&&frame.tolerance<=100))return t('Enter a tolerance between 0 and 100 mm.');
 if(gdtFormCharacteristics.includes(frame.characteristic)&&frame.datums)return t('A form tolerance has no datums.');
 if(gdtDatumCharacteristics.includes(frame.characteristic)&&!frame.datums)return t('This tolerance needs at least one datum. Add a datum first.');
 if((frame.diameter||frame.modifier)&&!gdtDiameterCharacteristics.includes(frame.characteristic))return t('This tolerance has no Ø zone or material condition.');
 return undefined;
}

export function mountDrawingGdtControls(panel:HTMLDetailsElement,preview:HTMLElement,status:HTMLElement,datums:DrawingDatum[],tolerances:DrawingToleranceFrame[],
 current:()=>CadDocument,layout:()=>DrawingLayout|undefined,showDrawing:()=>void,render:()=>void){
 const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const field=(text:string,control:HTMLSelectElement|HTMLInputElement)=>{const label=el('label',text);control.setAttribute('aria-label',text);label.append(control);return label;};
 const kind=el('select'),letter=el('select'),characteristic=el('select'),tolerance=el('input'),diameter=el('input'),modifier=el('select');
 const datumSelects=[el('select'),el('select'),el('select')],attach=el('select'),add=el('button',t('Add datum or tolerance')),list=el('ul');
 kind.add(new Option(t('Datum feature'),'datum'));kind.add(new Option(t('Tolerance frame'),'tolerance'));
 const names=gdtCharacteristicNames();
 for(const value of gdtCharacteristics)characteristic.add(new Option(names[value],value));
 characteristic.value='flatness';
 tolerance.type='number';tolerance.min='0.001';tolerance.max='100';tolerance.step='0.01';tolerance.value='0.05';tolerance.inputMode='decimal';
 diameter.type='checkbox';
 modifier.add(new Option(t('No modifier'),''));modifier.add(new Option(t('Ⓜ maximum material'),'M'));modifier.add(new Option(t('Ⓛ least material'),'L'));
 list.className='drawing-dimension-list';
 const fields={letter:field(t('Datum letter'),letter),characteristic:field(t('Characteristic'),characteristic),tolerance:field(t('Tolerance (mm)'),tolerance),
  diameter:field(t('Cylindrical zone (Ø)'),diameter),modifier:field(t('Material condition'),modifier),
  datums:datumSelects.map((select,i)=>field([t('Primary datum'),t('Secondary datum'),t('Tertiary datum')][i],select)),attach:field(t('Attached to'),attach)};
 panel.append(el('summary',t('Datums and tolerances')),field(t('Symbol'),kind),fields.letter,fields.characteristic,fields.tolerance,fields.diameter,fields.modifier,...fields.datums,fields.attach,add,list);
 let picking=false,candidates:GdtCandidate[]=[],chosen:GdtCandidate|undefined,editing:string|undefined;

 const usedLetters=()=>new Set(datums.filter(d=>d.id!==editing).map(d=>d.letter));
 function updateFields(){
  const datum=kind.value==='datum',c=characteristic.value as GdtCharacteristic;
  fields.letter.hidden=!datum;
  for(const item of [fields.characteristic,fields.tolerance,fields.diameter,fields.modifier,...fields.datums])item.hidden=datum;
  const axis=gdtDiameterCharacteristics.includes(c);
  diameter.disabled=modifier.disabled=!axis;if(!axis){diameter.checked=false;modifier.value='';}
  const form=gdtFormCharacteristics.includes(c);
  // Datum choices: the sheet's letters, each once, in order.
  const letters=datums.map(d=>d.letter);
  for(const [i,select] of datumSelects.entries()){
   const previous=select.value;
   select.replaceChildren(new Option(t('None'),''),...letters.map(l=>new Option(l,l)));
   select.value=letters.includes(previous)?previous:'';
   select.disabled=form||(i>0&&!datumSelects[i-1].value);
   if(select.disabled)select.value='';
  }
  const previous=letter.value,used=usedLetters();
  letter.replaceChildren(...gdtDatumLetters.filter(l=>!used.has(l)).map(l=>new Option(l,l)));
  if([...letter.options].some(o=>o.value===previous))letter.value=previous;
  fields.attach.hidden=!chosen;
 }
 function clearMarker(){preview.querySelectorAll('.drawing-gdt-marker').forEach(m=>m.remove());}
 function mark(lines:SketchPoint[][]){
  clearMarker();
  const svg=preview.querySelector('svg'),page=layout();
  if(!svg||!page)return;
  const marker=document.createElementNS(svg.namespaceURI,'path');
  marker.setAttribute('class','drawing-gdt-marker');
  marker.setAttribute('d',lines.map(line=>line.map(([x,y],i)=>(i?'L ':'M ')+x+' '+(page.height-y)).join(' ')).join(' '));
  svg.append(marker);
 }
 function reset(){
  picking=false;candidates=[];chosen=undefined;editing=undefined;
  add.setAttribute('aria-pressed','false');add.textContent=t('Add datum or tolerance');
  preview.classList.remove('picking');clearMarker();attach.replaceChildren();updateFields();
 }
 const prompt=()=>t('Tap a face or edge in a drawing view.');
 function start(id?:string){
  if(!layout()?.gdt)return;
  const keep=id;reset();editing=keep;picking=true;
  add.setAttribute('aria-pressed','true');add.textContent=t('Cancel placing');
  showDrawing();preview.classList.add('picking');preview.scrollIntoView({block:'nearest'});
  status.textContent=prompt();updateFields();
 }
 add.onclick=()=>{if(picking){reset();refresh();}else start();};
 kind.onchange=characteristic.onchange=()=>updateFields();
 for(const select of datumSelects)select.onchange=()=>updateFields();
 attach.onchange=()=>{
  chosen=candidates.find(c=>c.target===attach.value&&String(c.view)===attach.selectedOptions[0]?.dataset.view)??chosen;
  if(chosen)mark(chosen.lines);
 };
 const readFrame=():Omit<DrawingToleranceFrame,'id'|'target'|'view'|'at'>=>{
  const letters=datumSelects.map(s=>s.value).filter(Boolean);
  return {characteristic:characteristic.value as GdtCharacteristic,tolerance:Number(tolerance.value),
   ...(diameter.checked?{diameter:true as const}:{}),...(modifier.value?{modifier:modifier.value as 'M'|'L'}:{}),...(letters.length?{datums:letters}:{})};
 };
 preview.addEventListener('pointerup',event=>{
  const page=layout(),svg=preview.querySelector('svg');
  if(!picking||!page||!svg||event.button!==0)return;
  const inverse=svg.getScreenCTM()?.inverse();
  if(!inverse)return;
  const picked=new DOMPoint(event.clientX,event.clientY).matrixTransform(inverse);
  const point:SketchPoint=[picked.x,page.height-picked.y];
  if(!chosen){
   candidates=gdtCandidates(page,current(),point);
   if(!candidates.length){status.textContent=prompt();return;}
   chosen=candidates[0];
   attach.replaceChildren(...candidates.slice(0,12).map(c=>{const o=new Option(c.label+' · '+[t('Top view'),t('Front view'),t('Right view')][c.view],c.target);o.dataset.view=String(c.view);return o;}));
   attach.selectedIndex=0;
   mark(chosen.lines);updateFields();
   status.textContent=t`Attached to ${chosen.label}. Tap where the symbol goes, or choose another face or edge in Attached to.`;
   return;
  }
  const at=point.map(v=>Number(v.toFixed(2))) as [number,number];
  if(!validDrawingPosition(...at)){status.textContent=t('Pick a position inside the drawing area.');return;}
  const base={id:editing??newId(),target:chosen.target,view:chosen.view,at};
  if(kind.value==='datum'){
   if(!letter.value){status.textContent=t('Every datum letter is in use.');return;}
   store(datums,{...base,letter:letter.value});
  }else{
   const frame={...base,...readFrame()},problem=toleranceFrameProblem(frame);
   if(problem){status.textContent=problem;return;}
   store(tolerances,frame);
  }
  reset();render();
 });
 function store<T extends {id:string}>(items:T[],item:T){
  const i=items.findIndex(existing=>existing.id===item.id);
  if(i>=0)items[i]=item;else items.push(item);
 }
 function refresh(){
  const page=layout(),available=!!page?.gdt;
  panel.hidden=!available&&!datums.length&&!tolerances.length;
  add.disabled=!available||(kind.value==='datum'?datums.length>=gdtDatumLetters.length:tolerances.length>=drawingGdtLimit);
  updateFields();
  list.replaceChildren();
  const row=(text:string,id:string,edit:()=>void,remove:()=>void,target:string,view:number)=>{
   const item=el('li'),editButton=el('button',text),removeButton=el('button','×');
   editButton.disabled=!available;editButton.onclick=edit;
   editButton.title=describeGdtTarget(current(),target);
   removeButton.setAttribute('aria-label',t`Remove ${text}`);removeButton.onclick=remove;
   if(page?.annotationIssues.includes(id))item.append(el('small',t('Reference lost')));
   editButton.onpointerenter=()=>{if(page&&!picking)mark(gdtTargetLines(page,target,view));};
   editButton.onpointerleave=()=>{if(!picking)clearMarker();};
   item.append(editButton,removeButton);list.append(item);
  };
  for(const [i,datum] of datums.entries())row(t`Datum ${datum.letter}`,datum.id,()=>{kind.value='datum';start(datum.id);letter.value=datum.letter;},()=>{
   const user=tolerances.findIndex(frame=>frame.datums?.includes(datum.letter));
   if(user>=0){status.textContent=t`Datum ${datum.letter} is used by tolerance ${user+1}; change or remove that tolerance first.`;return;}
   datums.splice(i,1);render();
  },datum.target,datum.view);
  for(const [i,frame] of tolerances.entries())row(t`Tolerance ${i+1} · ${names[frame.characteristic]}`,frame.id,()=>{
   kind.value='tolerance';characteristic.value=frame.characteristic;tolerance.value=String(frame.tolerance);
   diameter.checked=!!frame.diameter;modifier.value=frame.modifier??'';
   start(frame.id);
   datumSelects.forEach((select,k)=>{updateFields();select.value=frame.datums?.[k]??'';});updateFields();
  },()=>{tolerances.splice(i,1);render();},frame.target,frame.view);
  if(page?.annotationIssues.some(id=>datums.some(d=>d.id===id)||tolerances.some(f=>f.id===id)))
   status.textContent=t('A datum or tolerance has lost its face or edge. Place it again or remove it before exporting.');
 }
 reset();
 return {reset,refresh};
}
