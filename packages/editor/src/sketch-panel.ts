import { t } from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession,evaluateExtrusion,newId} from '@brickwright/cad-core';
import type {CadSession,FeatureScalar,PlanarSketch,SketchPlane,SketchProfile,CadDocument} from '@brickwright/cad-core';
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const scalar=(source:string):FeatureScalar=>source.trim()!==''&&Number.isFinite(Number(source))?Number(source):source.trim();
/** Definition editor: complete draft + kernel preflight before the real session changes. */
export function mountSketchPanel(parent:HTMLElement,session:CadSession,evaluate:(doc:CadDocument)=>Promise<unknown>,afterApply:()=>Promise<unknown>) {
 const dialog=element('dialog');dialog.className='sketch-dialog';dialog.setAttribute('aria-label',t('Sketch and extrusion'));parent.append(dialog);
 let disposed=false;
 function open(featureId?:string){
  const expected=session.state.revision,doc=session.state.document,node=featureId?doc.nodes[featureId]:undefined;
  if(featureId&&node?.kind!=='extrusion')throw new Error(t('Select an extrusion feature to edit'));
  const existing=node?.kind==='extrusion'?doc.sketches![node.sketchId]:undefined;
  dialog.replaceChildren();
  const close=element('button',t('Close sketch'));close.onclick=()=>dialog.close();const header=element('header');header.append(element('h2',t(existing?'Edit sketch & extrusion':'Sketch & extrude')),close);
  const form=element('div');form.className='sketch-fields';
  const field=(label:string,value:string|number)=>{const wrap=element('label',t(label)),input=element('input');input.type='text';input.value=String(value);input.setAttribute('aria-label',t(label));wrap.append(input);form.append(wrap);return input;};
  const choice=(label:string,values:string[],value:string)=>{const wrap=element('label',t(label)),select=element('select');select.setAttribute('aria-label',t(label));for(const v of values){const o=element('option',label==='Sketch plane'?t`${v} (normal ${v==='XY'?'+Z':v==='XZ'?'−Y':'+X'})`:t(v));o.value=v;select.append(o);}select.value=value;wrap.append(select);form.append(wrap);return select;};
  const name=field('Sketch name',existing?.name??t('Sketch')),kind=choice('Profile',['rectangle','circle'],existing?.profile.kind??'rectangle');kind.disabled=!!existing;
  const plane=choice('Sketch plane',['XY','XZ','YZ'],existing?.plane??'XY');
  const profile=existing?.profile;
  const width=field('Sketch width (mm)',profile?.kind==='rectangle'?profile.width:40),depth=field('Sketch depth (mm)',profile?.kind==='rectangle'?profile.depth:30),radius=field('Sketch radius (mm)',profile?.kind==='circle'?profile.radius:10);
  const length=field('Extrusion distance (mm)',node?.kind==='extrusion'?node.distance:10);
  const symmetric=element('input');symmetric.type='checkbox';symmetric.checked=node?.kind==='extrusion'?node.symmetric:false;symmetric.setAttribute('aria-label',t('Symmetric extrusion'));const check=element('label',t('Symmetric about sketch plane'));check.className='sketch-toggle';check.prepend(symmetric);form.append(check);
  const preview=element('div');preview.className='sketch-preview';preview.setAttribute('aria-label',t('Sketch preview'));
  const status=element('p');status.className='parameter-status';status.setAttribute('role','status');status.setAttribute('aria-label',t('Sketch status'));
  const help=element('p',t('Enter dimensions or expressions such as width / 2. Define named dimensions in Parameters.'));
  function definition():SketchProfile{return kind.value==='rectangle'?{kind:'rectangle',id:existing?.profile.id??'profile-preview',width:scalar(width.value),depth:scalar(depth.value)}:{kind:'circle',id:existing?.profile.id??'profile-preview',radius:scalar(radius.value),segments:profile?.kind==='circle'?profile.segments:64};}
  function draft(){const trial=createCadSession(doc);let id=featureId;if(existing&&id){trial.updateSketch(existing.id,{name:name.value.trim(),plane:plane.value as SketchPlane,profile:definition()});trial.update(id,{distance:scalar(length.value),symmetric:symmetric.checked});}else{id=trial.addSketchExtrusion({...definition(),id:newId()},{name:name.value.trim(),plane:plane.value as SketchPlane,distance:scalar(length.value),symmetric:symmetric.checked});}return {trial,id:id!};}
  function draw(){
   width.parentElement!.hidden=depth.parentElement!.hidden=kind.value!=='rectangle';radius.parentElement!.hidden=kind.value!=='circle';
   preview.replaceChildren();try{const {trial,id}=draft(),n=trial.state.document.nodes[id];if(n.kind!=='extrusion')return;const shape=evaluateExtrusion(n,trial.state.document),xs=shape.contour.map(p=>p[0]),ys=shape.contour.map(p=>p[1]),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys),pad=Math.max(w,h)*.12;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`${Math.min(...xs)-pad} ${Math.min(...ys)-pad} ${w+pad*2} ${h+pad*2}`);svg.setAttribute('aria-hidden','true');const polygon=document.createElementNS(svg.namespaceURI,'polygon');polygon.setAttribute('points',shape.contour.map(([x,y])=>`${x},${-y}`).join(' '));svg.append(polygon);preview.append(svg,element('p',t`${w.toLocaleString()} × ${h.toLocaleString()} mm · ${shape.distance.toLocaleString()} mm extrusion`));status.textContent='';
   }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
  }
  form.addEventListener('input',draw);form.addEventListener('change',draw);
  const apply=element('button',t(existing?'Apply sketch changes':'Create extrusion'));apply.className='primary';
  apply.onclick=async()=>{apply.disabled=true;try{
   if(session.state.revision!==expected)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
   const {trial}=draft();await evaluate(trial.state.document);if(disposed)return;
   if(session.state.revision!==expected)throw new Error(t('The model changed while checking geometry. Close and reopen this dialog.'));
   // One transaction, including sketch and extrusion inputs.
   if(existing&&featureId)session.editExtrusion(featureId,{sketch:{name:name.value.trim(),plane:plane.value as SketchPlane,profile:definition()},distance:scalar(length.value),symmetric:symmetric.checked});
   else session.addSketchExtrusion({...definition(),id:newId()},{name:name.value.trim(),plane:plane.value as SketchPlane,distance:scalar(length.value),symmetric:symmetric.checked});
   dialog.close();await afterApply();
  }catch(error){if(!disposed)status.textContent=error instanceof Error?error.message:String(error);}finally{apply.disabled=false;}};
  const footer=element('footer');footer.append(status,apply);const body=element('div');body.className='sketch-body';body.append(help,form,preview);dialog.append(header,body,footer);draw();dialog.showModal();
 }
 dialog.addEventListener('keydown',e=>e.stopPropagation());
 return {open,dispose(){disposed=true;dialog.close();dialog.remove();}};
}
