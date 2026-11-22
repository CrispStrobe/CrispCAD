import {toolIcon} from './icons.js';
import { t } from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession,evaluateExtrusion,featureValue,newId} from '@brickwright/cad-core';
import type {CadSession,FeatureScalar,SketchPlane,SketchProfile,CadDocument} from '@brickwright/cad-core';
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
  const name=field('Sketch name',existing?.name??t('Sketch'));
  const info=element('button','ⓘ');
  info.type='button';
  info.className='sketch-info-button';
  info.setAttribute('aria-label',t('About sketching and extrusion'));
  info.setAttribute('aria-expanded','false');
  const instructions=element('ol');
  const infoPanel=element('div');
  infoPanel.className='sketch-help';
  infoPanel.id=newId();
  infoPanel.hidden=true;
  info.setAttribute('aria-controls',infoPanel.id);
  for(const step of [
   t('Choose a rectangle or circle and the plane it lies on. XY is horizontal; XZ and YZ are upright.'),
   t('Enter the profile dimensions or drag the profile handle in the preview. The sketch is centered on its origin.'),
   t('Extrusion adds thickness perpendicular to the plane. Symmetric divides that thickness equally on both sides.'),
   t('Create builds a solid. To change the sketch later, select the solid and choose Edit sketch & extrusion in Properties.')
  ]) instructions.append(element('li',step));
  infoPanel.append(instructions);
  info.onclick=()=>{
   infoPanel.hidden=!infoPanel.hidden;
   info.setAttribute('aria-expanded',String(!infoPanel.hidden));
  };
  header.insertBefore(info,close);
  const kind=choice('Profile',['rectangle','circle'],existing?.profile.kind??'rectangle');kind.disabled=!!existing;
  const plane=choice('Sketch plane',['XY','XZ','YZ'],existing?.plane??'XY');
  const profile=existing?.profile;
  const width=field('Sketch width (mm)',profile?.kind==='rectangle'?profile.width:40),depth=field('Sketch depth (mm)',profile?.kind==='rectangle'?profile.depth:30),radius=field('Sketch radius (mm)',profile?.kind==='circle'?profile.radius:10);
  const length=field('Extrusion distance (mm)',node?.kind==='extrusion'?node.distance:10);
  const symmetric=element('input');symmetric.type='checkbox';symmetric.checked=node?.kind==='extrusion'?node.symmetric:false;symmetric.setAttribute('aria-label',t('Symmetric extrusion'));const check=element('label',t('Symmetric extrusion'));check.className='sketch-toggle';check.prepend(symmetric);form.append(check);
  const preview=element('div');preview.className='sketch-preview';preview.setAttribute('aria-label',t('Sketch preview'));
  const status=element('p');status.className='parameter-status';status.setAttribute('role','status');status.setAttribute('aria-label',t('Sketch status'));
  const hint=element('p',t('Drag the white handles or type exact dimensions.'));
  const help=element('p',t('Enter dimensions or expressions such as width / 2. Define named dimensions in Parameters.'));
  function definition():SketchProfile{return kind.value==='rectangle'?{kind:'rectangle',id:existing?.profile.id??'profile-preview',width:scalar(width.value),depth:scalar(depth.value)}:{kind:'circle',id:existing?.profile.id??'profile-preview',radius:scalar(radius.value),segments:profile?.kind==='circle'?profile.segments:64};}
  const readForm=()=>({
   name:name.value.trim(),
   plane:plane.value as SketchPlane,
   profile:definition(),
   distance:scalar(length.value),
   symmetric:symmetric.checked
  });
  function draft(snapshot:ReturnType<typeof readForm>){
   const trial=createCadSession(doc);
   try{
    const {distance,symmetric,...sketch}=snapshot;
    if(existing&&featureId){
     trial.editExtrusion(featureId,{sketch,distance,symmetric});
     return {document:trial.state.document,id:featureId};
    }
    const id=trial.addSketchExtrusion({...sketch.profile,id:newId()},{name:sketch.name,plane:sketch.plane,distance,symmetric});
    return {document:trial.state.document,id};
   }finally{trial.dispose();}
  }
  function previewShape(){
   const {distance,symmetric,...sketch}=readForm();
   const id='sketch-preview';
   return evaluateExtrusion(
    {kind:'extrusion',featureVersion:1,id,sketchId:id,distance,symmetric},
    {...doc,sketches:{[id]:{version:1,id,...sketch}}}
   );
  }
  let drag:{id:number;x:number;y:number;w:number;h:number;r:number;d:number;inverse:DOMMatrix;kind:string;viewBox:string}|undefined;
  let valid=false;
  const bounded=(value:number)=>Math.min(100000,Math.max(.01,value));
  const compact=(input:HTMLInputElement,icon:string)=>{const label=input.parentElement!;label.firstChild!.textContent='';label.classList.add('sketch-dimension');const picture=toolIcon(icon);if(picture)label.prepend(picture);input.title=input.getAttribute('aria-label')!;label.append(element('small','mm'));const caption=element('span',input.getAttribute('aria-label')!);caption.className='sketch-dimension-name';label.prepend(caption);};
  compact(width,'Sketch width');compact(depth,'Sketch depth');compact(radius,'Sketch radius');compact(length,'Extrude');
  function draw(){
   width.parentElement!.hidden=depth.parentElement!.hidden=kind.value!=='rectangle';radius.parentElement!.hidden=kind.value!=='circle';preview.replaceChildren();valid=false;
   for(const input of [width,depth,radius,length]){
    input.removeAttribute('aria-invalid');
    if(input.parentElement!.hidden)continue;
    try{
     const value=featureValue(scalar(input.value),doc);
     if(value<.01||value>100000)throw new Error(t('Dimension must be between 0.01 and 100000 mm'));
    }catch(error){
     input.setAttribute('aria-invalid','true');
     status.textContent=input.getAttribute('aria-label')+' — '+(error instanceof Error?error.message:String(error));
     apply.disabled=true;
     return;
    }
   }
   try{const shape=previewShape(),xs=shape.contour.map(p=>p[0]),ys=shape.contour.map(p=>p[1]),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys),d=shape.distance,ox=d*.45,oy=-d*.35;
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),base=shape.contour.map(([x,y])=>[x+shape.start*.45,-y-shape.start*.35]),top=base.map(([x,y])=>[x+ox,y+oy]),all=[...base,...top],span=Math.max(w,h,Math.abs(d),1),pad=span*.18,minX=Math.min(...all.map(p=>p[0]))-pad,minY=Math.min(...all.map(p=>p[1]))-pad,vw=Math.max(...all.map(p=>p[0]))-minX+pad,vh=Math.max(...all.map(p=>p[1]))-minY+pad;
    svg.setAttribute('viewBox',drag?.viewBox??`${minX} ${minY} ${vw} ${vh}`);svg.setAttribute('aria-hidden','true');
    const polygon=(points:number[][],cls:string)=>{const p=document.createElementNS(ns,'polygon');p.setAttribute('points',points.map(p=>p.join(',')).join(' '));p.setAttribute('class',cls);svg.append(p);};polygon(base,'sketch-base');
    for(let i=0;i<base.length;i++){const j=(i+1)%base.length;polygon([base[i],base[j],top[j],top[i]],'sketch-side');}polygon(top,'sketch-top');
    const handle=(x:number,y:number,mode:string,enabled:boolean)=>{if(!enabled)return;const hit=document.createElementNS(ns,'circle');hit.setAttribute('cx',String(x));hit.setAttribute('cy',String(y));hit.setAttribute('r',String(span*.065));hit.setAttribute('fill','transparent');hit.dataset.resize=mode;hit.style.cursor=mode==='depth'?'nesw-resize':'nwse-resize';const title=document.createElementNS(ns,'title');title.textContent=t('Drag to change dimensions');hit.append(title);const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));dot.setAttribute('r',String(span*.023));dot.classList.add('sketch-handle');svg.append(dot,hit);};
    const numeric=(s:string)=>s.trim()!==''&&Number.isFinite(Number(s));
    const topOffset=shape.start+d;
    handle(Math.max(...xs)+topOffset*.45,(kind.value==='circle'?0:-Math.min(...ys))-topOffset*.35,'size',kind.value==='circle'?numeric(radius.value):numeric(width.value)&&numeric(depth.value));
    const anchor=kind.value==='circle'?shape.contour[shape.contour.length/2|0]:[Math.min(...xs),Math.max(...ys)];
    handle(anchor[0]+topOffset*.45,-anchor[1]-topOffset*.35,'depth',numeric(length.value));
    preview.append(svg,element('output',t`${w.toLocaleString()} × ${h.toLocaleString()} mm · ${shape.distance.toLocaleString()} mm extrusion`));status.textContent='';valid=true;
   }catch(error){status.textContent=error instanceof Error&&'diagnostic' in error?(error as import('@brickwright/cad-core').FeatureEvaluationError).diagnostic.message:error instanceof Error?error.message:String(error);}apply.disabled=busy||!valid;
  }
  preview.onpointerdown=event=>{const handle=(event.target as Element).closest<SVGElement>('[data-resize]'),svg=preview.querySelector('svg');if(!handle||!svg||busy||drag||event.button!==0)return;event.preventDefault();const matrix=svg.getScreenCTM();if(!matrix)return;const inverse=matrix.inverse();const start=new DOMPoint(event.clientX,event.clientY).matrixTransform(inverse);drag={id:event.pointerId,x:start.x,y:start.y,w:Number(width.value),h:Number(depth.value),r:Number(radius.value),d:Number(length.value),inverse,kind:handle.dataset.resize!,viewBox:svg.getAttribute('viewBox')!};preview.setPointerCapture(event.pointerId);};
  preview.onpointermove=event=>{if(!drag||event.pointerId!==drag.id)return;event.preventDefault();const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(drag.inverse),dx=point.x-drag.x,dy=point.y-drag.y,step=snap()/(event.shiftKey?10:1),round=(v:number)=>Number((step>0?Math.round(v/step)*step:v).toFixed(5));if(drag.kind==='depth'){const projectionScale=symmetric.checked ? .5 : 1;const v=round(drag.d+(.45*dx-.35*dy)/(.45**2+.35**2)/projectionScale);length.value=String(bounded(v));}else if(kind.value==='circle')radius.value=String(bounded(round(drag.r+dx)));else{width.value=String(bounded(round(drag.w+2*dx)));depth.value=String(bounded(round(drag.h+2*dy)));}draw();};
  const endDrag=()=>{if(drag&&preview.hasPointerCapture(drag.id))preview.releasePointerCapture(drag.id);drag=undefined;draw();};preview.onpointerup=endDrag;preview.onpointercancel=endDrag;
  form.addEventListener('input',draw);form.addEventListener('change',draw);
  const apply=element('button',t(existing?'Apply sketch changes':'Create extrusion'));apply.className='primary';
  apply.onclick=async()=>{const ticket=epoch,snapshot=readForm();busy=true;apply.disabled=true;try{
   if(session.state.revision!==expected)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
   const candidate=draft(snapshot);const geometry=await evaluate(candidate.document);const created=geometry.bodies.find(body=>body.id===candidate.id);if(disposed||epoch!==ticket||!dialog.open)return;
   if(session.state.revision!==expected)throw new Error(t('The model changed while checking geometry. Close and reopen this dialog.'));
   // One transaction, including sketch and extrusion inputs.
   if(existing&&featureId)session.editExtrusion(featureId,{sketch:{name:snapshot.name,plane:snapshot.plane,profile:snapshot.profile},distance:snapshot.distance,symmetric:snapshot.symmetric});
   else session.addSketchExtrusion({...snapshot.profile,id:newId()},{name:snapshot.name,plane:snapshot.plane,distance:snapshot.distance,symmetric:snapshot.symmetric,position:[0,0,-(created?.bounds.min[2]??0)]});
   dialog.close();await afterApply();
  }catch(error){if(!disposed)status.textContent=error instanceof Error&&'diagnostic' in error?(error as import('@brickwright/cad-core').FeatureEvaluationError).diagnostic.message:error instanceof Error?error.message:String(error);}finally{busy=false;apply.disabled=!valid;}};
  const footer=element('footer');footer.append(status,apply);const body=element('div');body.className='sketch-body';const expressions=element('details');expressions.className='sketch-expressions';const summary=element('summary',t('Dimension expressions'));summary.title=t('Dimension expressions');summary.setAttribute('aria-label',t('Dimension expressions'));expressions.append(summary,help);form.append(expressions);const drawing=element('div');drawing.append(preview,hint);body.append(drawing,form);dialog.append(header,infoPanel,body,footer);draw();dialog.showModal();
 }
 dialog.addEventListener('keydown',e=>e.stopPropagation());
 return {open,dispose(){disposed=true;dialog.close();dialog.remove();}};
}
