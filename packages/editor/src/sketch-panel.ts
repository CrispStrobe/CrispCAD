import {toolIcon} from './icons.js';
import { t } from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession,evaluateExtrusion,newId} from '@brickwright/cad-core';
import type {CadSession,FeatureScalar,PlanarSketch,SketchPlane,SketchProfile,CadDocument} from '@brickwright/cad-core';
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const scalar=(source:string):FeatureScalar=>source.trim()!==''&&Number.isFinite(Number(source))?Number(source):source.trim();
/** Definition editor: complete draft + kernel preflight before the real session changes. */
export function mountSketchPanel(parent:HTMLElement,session:CadSession,evaluate:(doc:CadDocument)=>Promise<import('@brickwright/cad-geometry').GeometryResult>,afterApply:()=>Promise<unknown>,snap:()=>number=()=>1) {
 const dialog=element('dialog');dialog.className='sketch-dialog';dialog.setAttribute('aria-label',t('Sketch and extrusion'));parent.append(dialog);
 let disposed=false,epoch=0;dialog.addEventListener('close',()=>epoch++);
 function open(featureId?:string){
  epoch++;let busy=false;const expected=session.state.revision,doc=session.state.document,node=featureId?doc.nodes[featureId]:undefined;
  if(featureId&&node?.kind!=='extrusion')throw new Error(t('Select an extrusion feature to edit'));
  const existing=node?.kind==='extrusion'?doc.sketches![node.sketchId]:undefined;
  dialog.replaceChildren();
  const close=element('button','×');close.setAttribute('aria-label',t('Close sketch'));close.title=t('Close sketch');close.onclick=()=>dialog.close();const header=element('header');header.append(element('h2',t(existing?'Edit sketch & extrusion':'Sketch & extrude')),close);
  const form=element('div');form.className='sketch-fields';
  const field=(label:string,value:string|number)=>{const wrap=element('label',t(label)),input=element('input');input.type='text';input.value=String(value);input.setAttribute('aria-label',t(label));wrap.append(input);form.append(wrap);return input;};
  const choice=(label:string,values:string[],value:string)=>{const wrap=element('label',t(label)),select=element('select');select.setAttribute('aria-label',t(label));for(const v of values){const o=element('option',label==='Sketch plane'?v:t(v));o.value=v;select.append(o);}select.value=value;wrap.append(select);form.append(wrap);return select;};
  const name=field('Sketch name',existing?.name??t('Sketch'));name.parentElement!.remove();name.title=t('Sketch name');header.insertBefore(name,close);
  const kind=choice('Profile',['rectangle','circle'],existing?.profile.kind??'rectangle');kind.disabled=!!existing;
  const plane=choice('Sketch plane',['XY','XZ','YZ'],existing?.plane??'XY');
  const profile=existing?.profile;
  const width=field('Sketch width (mm)',profile?.kind==='rectangle'?profile.width:40),depth=field('Sketch depth (mm)',profile?.kind==='rectangle'?profile.depth:30),radius=field('Sketch radius (mm)',profile?.kind==='circle'?profile.radius:10);
  const length=field('Extrusion distance (mm)',node?.kind==='extrusion'?node.distance:10);
  const symmetric=element('input');symmetric.type='checkbox';symmetric.checked=node?.kind==='extrusion'?node.symmetric:false;symmetric.setAttribute('aria-label',t('Symmetric extrusion'));const check=element('label',t('Symmetric extrusion'));check.className='sketch-toggle';check.prepend(symmetric);form.append(check);
  const preview=element('div');preview.className='sketch-preview';preview.setAttribute('aria-label',t('Sketch preview'));
  const status=element('p');status.className='parameter-status';status.setAttribute('role','status');status.setAttribute('aria-label',t('Sketch status'));
  const help=element('p',t('Enter dimensions or expressions such as width / 2. Define named dimensions in Parameters.'));
  function definition():SketchProfile{return kind.value==='rectangle'?{kind:'rectangle',id:existing?.profile.id??'profile-preview',width:scalar(width.value),depth:scalar(depth.value)}:{kind:'circle',id:existing?.profile.id??'profile-preview',radius:scalar(radius.value),segments:profile?.kind==='circle'?profile.segments:64};}
  function draft(){const trial=createCadSession(doc);let id=featureId;if(existing&&id){trial.updateSketch(existing.id,{name:name.value.trim(),plane:plane.value as SketchPlane,profile:definition()});trial.update(id,{distance:scalar(length.value),symmetric:symmetric.checked});}else{id=trial.addSketchExtrusion({...definition(),id:newId()},{name:name.value.trim(),plane:plane.value as SketchPlane,distance:scalar(length.value),symmetric:symmetric.checked});}return {trial,id:id!};}
  let drag:{id:number;x:number;y:number;w:number;h:number;r:number;d:number;unit:number;kind:string;viewBox:string}|undefined;
  let valid=false;
  const compact=(input:HTMLInputElement,icon:string)=>{const label=input.parentElement!;label.firstChild!.textContent='';label.classList.add('sketch-dimension');const picture=toolIcon(icon);if(picture)label.prepend(picture);input.title=input.getAttribute('aria-label')!;label.append(element('small','mm'));};
  compact(width,'Sketch width');compact(depth,'Sketch depth');compact(radius,'Sketch radius');compact(length,'Extrude');
  function draw(){
   width.parentElement!.hidden=depth.parentElement!.hidden=kind.value!=='rectangle';radius.parentElement!.hidden=kind.value!=='circle';preview.replaceChildren();valid=false;
   try{const {trial,id}=draft(),n=trial.state.document.nodes[id];if(n.kind!=='extrusion')return;const shape=evaluateExtrusion(n,trial.state.document),xs=shape.contour.map(p=>p[0]),ys=shape.contour.map(p=>p[1]),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys),d=shape.distance,ox=d*.45,oy=-d*.35;
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),base=shape.contour.map(([x,y])=>[x,-y]),top=base.map(([x,y])=>[x+ox,y+oy]),all=[...base,...top],span=Math.max(w,h,Math.abs(d),1),pad=span*.18,minX=Math.min(...all.map(p=>p[0]))-pad,minY=Math.min(...all.map(p=>p[1]))-pad,vw=Math.max(...all.map(p=>p[0]))-minX+pad,vh=Math.max(...all.map(p=>p[1]))-minY+pad;
    svg.setAttribute('viewBox',drag?.viewBox??`${minX} ${minY} ${vw} ${vh}`);svg.dataset.mmPerPixel=String(vw);svg.setAttribute('aria-hidden','true');
    const polygon=(points:number[][],cls:string)=>{const p=document.createElementNS(ns,'polygon');p.setAttribute('points',points.map(p=>p.join(',')).join(' '));p.setAttribute('class',cls);svg.append(p);};polygon(base,'sketch-base');
    for(let i=0;i<base.length;i++){const j=(i+1)%base.length;polygon([base[i],base[j],top[j],top[i]],'sketch-side');}polygon(top,'sketch-top');
    const handle=(x:number,y:number,mode:string,enabled:boolean)=>{if(!enabled)return;const hit=document.createElementNS(ns,'circle');hit.setAttribute('cx',String(x));hit.setAttribute('cy',String(y));hit.setAttribute('r',String(span*.065));hit.setAttribute('fill','transparent');hit.dataset.resize=mode;hit.style.cursor=mode==='depth'?'nesw-resize':'nwse-resize';const title=document.createElementNS(ns,'title');title.textContent=t('Drag to change dimensions');hit.append(title);const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));dot.setAttribute('r',String(span*.023));dot.classList.add('sketch-handle');svg.append(dot,hit);};
    const numeric=(s:string)=>s.trim()!==''&&Number.isFinite(Number(s));handle(Math.max(...xs)+ox,-Math.min(...ys)+oy,'size',kind.value==='circle'?numeric(radius.value):numeric(width.value)&&numeric(depth.value));handle(Math.min(...xs)+ox,-Math.max(...ys)+oy,'depth',numeric(length.value));
    preview.append(svg,element('output',t`${w.toLocaleString()} × ${h.toLocaleString()} mm · ${shape.distance.toLocaleString()} mm extrusion`));status.textContent='';valid=true;trial.dispose();
   }catch(error){status.textContent=error instanceof Error?error.message:String(error);}apply.disabled=busy||!valid;
  }
  preview.onpointerdown=event=>{const handle=(event.target as Element).closest<SVGElement>('[data-resize]'),svg=preview.querySelector('svg');if(!handle||!svg||busy)return;event.preventDefault();const box=svg.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,w:Number(width.value),h:Number(depth.value),r:Number(radius.value),d:Number(length.value),unit:Number(svg.dataset.mmPerPixel)/box.width,kind:handle.dataset.resize!,viewBox:svg.getAttribute('viewBox')!};preview.setPointerCapture(event.pointerId);};
  preview.onpointermove=event=>{if(!drag||event.pointerId!==drag.id)return;event.preventDefault();const dx=(event.clientX-drag.x)*drag.unit,dy=(event.clientY-drag.y)*drag.unit,step=snap()/(event.shiftKey?10:1),round=(v:number)=>Number((step>0?Math.round(v/step)*step:v).toFixed(5));if(drag.kind==='depth'){const v=round(drag.d+dx-dy);if(Math.abs(v)>=.1)length.value=String(v);}else if(kind.value==='circle')radius.value=String(Math.max(.1,round(drag.r+dx)));else{width.value=String(Math.max(.1,round(drag.w+2*dx)));depth.value=String(Math.max(.1,round(drag.h+2*dy)));}draw();};
  const endDrag=()=>{if(drag&&preview.hasPointerCapture(drag.id))preview.releasePointerCapture(drag.id);drag=undefined;draw();};preview.onpointerup=endDrag;preview.onpointercancel=endDrag;
  form.addEventListener('input',draw);form.addEventListener('change',draw);
  const apply=element('button',t(existing?'Apply sketch changes':'Create extrusion'));apply.className='primary';
  apply.onclick=async()=>{const ticket=epoch,snapshot={name:name.value.trim(),plane:plane.value as SketchPlane,profile:definition(),distance:scalar(length.value),symmetric:symmetric.checked};busy=true;apply.disabled=true;try{
   if(session.state.revision!==expected)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
   const {trial}=draft();const geometry=await evaluate(trial.state.document);const created=geometry.bodies.find(body=>body.id===trial.state.document.roots.at(-1));if(disposed||epoch!==ticket||!dialog.open)return;
   if(session.state.revision!==expected)throw new Error(t('The model changed while checking geometry. Close and reopen this dialog.'));
   // One transaction, including sketch and extrusion inputs.
   if(existing&&featureId)session.editExtrusion(featureId,{sketch:{name:snapshot.name,plane:snapshot.plane,profile:snapshot.profile},distance:snapshot.distance,symmetric:snapshot.symmetric});
   else session.addSketchExtrusion({...snapshot.profile,id:newId()},{name:snapshot.name,plane:snapshot.plane,distance:snapshot.distance,symmetric:snapshot.symmetric,position:[0,0,-(created?.bounds.min[2]??0)]});
   dialog.close();await afterApply();
  }catch(error){if(!disposed)status.textContent=error instanceof Error?error.message:String(error);}finally{busy=false;apply.disabled=!valid;}};
  const footer=element('footer');footer.append(status,apply);const body=element('div');body.className='sketch-body';const expressions=element('details');expressions.className='sketch-expressions';const summary=element('summary','f(x)');summary.title=t('Dimension expressions');summary.setAttribute('aria-label',t('Dimension expressions'));expressions.append(summary,help);form.append(expressions);body.append(preview,form);dialog.append(header,body,footer);draw();dialog.showModal();
 }
 dialog.addEventListener('keydown',e=>e.stopPropagation());
 return {open,dispose(){disposed=true;dialog.close();dialog.remove();}};
}
