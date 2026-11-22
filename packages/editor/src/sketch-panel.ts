import {formatSketchPoints as formatPoints, parseSketchOutline as parseOutline, parseSketchPoint as parsePoint} from './sketch-point-entry.js';
import {maxSketchDxfBytes,readSketchDxf} from './import-sketch-dxf.js';
import {toolIcon} from './icons.js';
import { t } from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession,evaluateExtrusion,featureValue,maxSketchRegionLoops,newId} from '@brickwright/cad-core';
import type {SketchLoop,SketchPoint,CadSession,FeatureScalar,SketchPlane,SketchProfile,CadDocument} from '@brickwright/cad-core';
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
   t('Choose a profile and its plane. XY is horizontal. XZ and YZ are upright.'),
   t('Type dimensions or drag the preview handles. For an outline, enter one X, Y point per line. The last point connects to the first.'),
   t('DXF import accepts closed outlines and circles. Loops inside an outer boundary become holes.'),
   t('Extrusion adds thickness perpendicular to the plane. Symmetric divides that thickness equally on both sides.'),
   t('Create builds a solid. To change the sketch later, select the solid and choose Edit sketch & extrusion in Properties.')
  ]) instructions.append(element('li',step));
  infoPanel.append(instructions);
  info.onclick=()=>{
   infoPanel.hidden=!infoPanel.hidden;
   info.setAttribute('aria-expanded',String(!infoPanel.hidden));
  };
  header.insertBefore(info,close);
  const kind=choice('Profile',['rectangle','circle','outline','region'],existing?.profile.kind??'rectangle');kind.disabled=!!existing;
  const plane=choice('Sketch plane',['XY','XZ','YZ'],existing?.plane??'XY');
  const profile=existing?.profile;
  const width=field('Sketch width (mm)',profile?.kind==='rectangle'?profile.width:40),depth=field('Sketch depth (mm)',profile?.kind==='rectangle'?profile.depth:30),radius=field('Sketch radius (mm)',profile?.kind==='circle'?profile.radius:10);
  const center=field('Circle center X, Y (mm)',profile?.kind==='circle'&&profile.center?profile.center.join(', '):'0, 0');
  const pointsLabel=element('label',t('Outline points X, Y (mm)'));
  const points=element('textarea');
  points.setAttribute('aria-label',t('Outline points X, Y (mm)'));
  points.rows=4;
  points.spellcheck=false;
  points.value=profile?.kind==='outline'?formatPoints(profile.points,profile.bulges).join('\n'):'0, 0\n40, 0\n30, 30\n0, 30';
  pointsLabel.append(points,element('small',t('For an arc, add its bulge as a third value. Use 1 for a semicircle, or -1 to curve in the opposite direction.')));
  form.append(pointsLabel);
  const relativeHint=element('small',t('Start with X, Y. Use @dX, dY to enter a point relative to the previous one.'));
  const regionLabel=element('label',t('Region loops (mm)'));
  const region=element('textarea');
  region.setAttribute('aria-label',t('Region loops (mm)'));
  region.rows=5;
  region.spellcheck=false;
  region.maxLength=65536;
  const formatLoops=(loops:SketchLoop[])=>loops.map(loop=>loop.kind==='circle'
   ? 'CIRCLE '+[...loop.center,loop.radius].join(', ')
   : formatPoints(loop.points,loop.bulges).join(' | ')).join('\n');
  let singleDxfLayer=profile?.kind==='outline'||profile?.kind==='circle'?profile.dxfLayer:undefined;
  let regionLoops=profile?.kind==='region'?profile.loops:[];
  region.value=regionLoops.length?formatLoops(regionLoops):'0, 0 | 40, 0 | 40, 30 | 0, 30\nCIRCLE 10, 15, 2';
  regionLabel.append(region,element('small',t('One loop per line. Separate outline points with | and add an optional bulge for arcs. For circles type CIRCLE X, Y, radius. Circle values can use named dimensions.')));
  form.append(regionLabel,relativeHint);
  const length=field('Extrusion distance (mm)',node?.kind==='extrusion'?node.distance:10);
  const symmetric=element('input');symmetric.type='checkbox';symmetric.checked=node?.kind==='extrusion'?node.symmetric:false;symmetric.setAttribute('aria-label',t('Symmetric extrusion'));const check=element('label',t('Symmetric extrusion'));check.className='sketch-toggle';check.prepend(symmetric);form.append(check);
  const preview=element('div');preview.className='sketch-preview';preview.setAttribute('aria-label',t('Sketch preview'));
  const status=element('p');status.className='parameter-status';status.setAttribute('role','status');status.setAttribute('aria-label',t('Sketch status'));
  const hint=element('p',t('Drag the white handles or type exact dimensions.'));
  const help=element('p',t('Enter dimensions or expressions such as width / 2. Define named dimensions in Parameters.'));
  function definition():SketchProfile{
   const id=existing?.profile.id??'profile-preview';
   if(kind.value==='region'){
    const rows=region.value.trim().split(/\r?\n/);
    if(rows.length>maxSketchRegionLoops)throw new Error(t('A region supports up to 16 loops.'));
    const loops=rows.map((row,i):SketchLoop=>{
     const original=regionLoops[i];
     const id=original?.id??'region-loop-'+(i+1);
     const layer=original?.dxfLayer?{dxfLayer:original.dxfLayer}:{};
     const circle=/^CIRCLE\s+(.+)$/i.exec(row.trim());
     if(circle){
      const values=circle[1].split(',');
      if(values.length!==3||!values.every(value=>value.trim()))throw new Error(t('For a circle enter CIRCLE X, Y, radius.'));
      return {kind:'circle',id,center:[scalar(values[0]),scalar(values[1])],radius:scalar(values[2]),segments:original?.kind==='circle'?original.segments:64,...layer};
     }
     return {kind:'outline',id,...parseOutline(row.split('|')),...layer};
    });
    return {kind:'region',id,loops};
   }
   const layer=singleDxfLayer?{dxfLayer:singleDxfLayer}:{};
   if(kind.value==='outline'){
    const rows=points.value.trim().split(/\r?\n/);
    return {kind:'outline',id,...parseOutline(rows),...layer};
   }
   if(kind.value==='rectangle')return {kind:'rectangle',id,width:scalar(width.value),depth:scalar(depth.value)};
   const location=parsePoint(center.value);
   return {kind:'circle',id,radius:scalar(radius.value),segments:profile?.kind==='circle'?profile.segments:64,...layer,
    ...(profile?.kind==='circle'&&profile.center||location.some(Boolean)?{center:location}:{})};
  }
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
  function previewShape({distance,symmetric,...sketch}:ReturnType<typeof readForm>){
   const id='sketch-preview';
   return evaluateExtrusion(
    {kind:'extrusion',featureVersion:1,id,sketchId:id,distance,symmetric},
    {...doc,sketches:{[id]:{version:1,id,...sketch}}}
   );
  }
  type VertexEdit = {field:HTMLTextAreaElement; original:string; loop:number; index:number; points:SketchPoint[]; bulges?:number[]};
  let drag:{id:number;x:number;y:number;w:number;h:number;r:number;d:number;inverse:DOMMatrix;kind:string;viewBox:string;vertex?:VertexEdit}|undefined;
  let dragOutline:ReturnType<typeof definition>|undefined;
  let valid=false;
  const bounded=(value:number)=>Math.min(100000,Math.max(.01,value));
  const compact=(input:HTMLInputElement,icon:string)=>{const label=input.parentElement!;label.firstChild!.textContent='';label.classList.add('sketch-dimension');const picture=toolIcon(icon);if(picture)label.prepend(picture);input.title=input.getAttribute('aria-label')!;label.append(element('small','mm'));const caption=element('span',input.getAttribute('aria-label')!);caption.className='sketch-dimension-name';label.prepend(caption);};
  compact(width,'Sketch width');compact(depth,'Sketch depth');compact(radius,'Sketch radius');compact(length,'Extrude');
  function draw(){
   width.parentElement!.hidden=depth.parentElement!.hidden=kind.value!=='rectangle';radius.parentElement!.hidden=center.parentElement!.hidden=kind.value!=='circle';pointsLabel.hidden=kind.value!=='outline';regionLabel.hidden=kind.value!=='region';relativeHint.hidden=pointsLabel.hidden&&regionLabel.hidden;preview.replaceChildren();dragOutline=undefined;valid=false;
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
   try{const snapshot=readForm();const shape=previewShape(snapshot),xs=shape.contour.map(p=>p[0]),ys=shape.contour.map(p=>p[1]),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys),d=shape.distance,ox=d*.45,oy=-d*.35;
    const projected=[shape.contour,...(shape.holes??[])].map(loop=>loop.map(([x,y])=>[x+shape.start*.45,-y-shape.start*.35]));
    const raised=projected.map(loop=>loop.map(([x,y])=>[x+ox,y+oy]));
    const [base]=projected,[top]=raised;
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),all=[...base,...top],span=Math.max(w,h,Math.abs(d),1),pad=span*.18,minX=Math.min(...all.map(p=>p[0]))-pad,minY=Math.min(...all.map(p=>p[1]))-pad,vw=Math.max(...all.map(p=>p[0]))-minX+pad,vh=Math.max(...all.map(p=>p[1]))-minY+pad;
    svg.setAttribute('viewBox',drag?.viewBox??`${minX} ${minY} ${vw} ${vh}`);svg.setAttribute('aria-hidden','true');
    const face=(loops:number[][][],cls:string)=>{
     const path=document.createElementNS(ns,'path');
     path.setAttribute('d',loops.map(loop=>'M '+loop.map(point=>point.join(' ')).join(' L ')+' Z').join(' '));
     path.setAttribute('fill-rule','evenodd');
     path.setAttribute('class',cls);
     svg.append(path);
    };
    face(projected,'sketch-base');
    for(let k=0;k<projected.length;k++){
     const lower=projected[k],upper=raised[k];
     for(let i=0;i<lower.length;i++){
      const j=(i+1)%lower.length;
      face([[lower[i],lower[j],upper[j],upper[i]]],'sketch-side');
     }
    }
    face(raised,'sketch-top');
    const handle=(x:number,y:number,mode:string,vertex?:{loop:number;index:number})=>{
     const hit=document.createElementNS(ns,'circle');
     hit.setAttribute('cx',String(x));hit.setAttribute('cy',String(y));
     hit.setAttribute('r',String(span*.065));hit.setAttribute('fill','transparent');
     hit.dataset.resize=mode;
     hit.style.cursor=mode==='vertex'?'move':mode==='depth'?'nesw-resize':'nwse-resize';
     if(vertex){hit.dataset.loop=String(vertex.loop);hit.dataset.vertex=String(vertex.index);}
     const title=document.createElementNS(ns,'title');
     title.textContent=t(vertex?'Drag outline point':'Drag to change dimensions');hit.append(title);
     const dot=document.createElementNS(ns,'circle');
     dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));dot.setAttribute('r',String(span*.023));
     dot.classList.add('sketch-handle');svg.append(dot,hit);
    };
    const numeric=(s:string)=>s.trim()!==''&&Number.isFinite(Number(s));
    const topOffset=shape.start+d;
    const p=snapshot.profile;
    const outlines=p.kind==='outline'||p.kind==='region';
    if(p.kind==='circle'?numeric(radius.value):p.kind==='rectangle'&&numeric(width.value)&&numeric(depth.value)){
     const y=p.kind==='circle'?-(Math.min(...ys)+Math.max(...ys))/2:-Math.min(...ys);
     handle(Math.max(...xs)+topOffset*.45,y-topOffset*.35,'size');
    }
    const anchor=p.kind==='circle'?shape.contour[Math.floor(shape.contour.length/2)]:outlines?shape.contour[0]:[Math.min(...xs),Math.max(...ys)];
    if(numeric(length.value)){
     const offset=outlines?shape.start+d/2:topOffset;
     handle(anchor[0]+offset*.45,-anchor[1]-offset*.35,'depth');
    }
    const drawVertices=(vertices:SketchPoint[],loop:number)=>vertices.forEach(([x,y],index)=>
     handle(x+topOffset*.45,-y-topOffset*.35,'vertex',{loop,index}));
    if(p.kind==='outline')drawVertices(p.points,0);
    if(p.kind==='region')p.loops.forEach((loop,i)=>{if(loop.kind==='outline')drawVertices(loop.points,i);});
    dragOutline=p;
    preview.append(svg,element('output',t`${w.toLocaleString()} × ${h.toLocaleString()} mm · ${shape.distance.toLocaleString()} mm extrusion`));status.textContent='';valid=true;
   }catch(error){status.textContent=error instanceof Error&&'diagnostic' in error?(error as import('@brickwright/cad-core').FeatureEvaluationError).diagnostic.message:error instanceof Error?error.message:String(error);}apply.disabled=busy||!valid||!!drag;
  }
  preview.onpointerdown=event=>{
   const handle=(event.target as Element).closest<SVGElement>('[data-resize]'),svg=preview.querySelector('svg');
   if(!handle||!svg||busy||drag||event.button!==0)return;
   const matrix=svg.getScreenCTM();
   if(!matrix)return;
   const inverse=matrix.inverse(),start=new DOMPoint(event.clientX,event.clientY).matrixTransform(inverse);
   const mode=handle.dataset.resize!;
   let vertex:VertexEdit|undefined;
   if(mode==='vertex'){
    const loop=Number(handle.dataset.loop),index=Number(handle.dataset.vertex);
    const outline=dragOutline?.kind==='region'?dragOutline.loops[loop]:dragOutline;
    if(outline?.kind!=='outline'||!outline.points[index])return;
    const field=dragOutline?.kind==='region'?region:points;
    vertex={field,original:field.value,loop,index,points:outline.points,bulges:outline.bulges};
   }
   event.preventDefault();
   drag={id:event.pointerId,x:start.x,y:start.y,w:Number(width.value),h:Number(depth.value),r:Number(radius.value),d:Number(length.value),inverse,kind:mode,viewBox:svg.getAttribute('viewBox')!,vertex};
   preview.setPointerCapture(event.pointerId);
   apply.disabled=true;
  };
  preview.onpointermove=event=>{
   if(!drag||event.pointerId!==drag.id)return;
   event.preventDefault();
   const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(drag.inverse),dx=point.x-drag.x,dy=point.y-drag.y;
   const step=snap()/(event.shiftKey?10:1),round=(v:number)=>Number((step>0?Math.round(v/step)*step:v).toFixed(5));
   if(drag.vertex){
    const edit=drag.vertex,[x,y]=edit.points[edit.index];
    const moved:SketchPoint=[round(x+dx),round(y-dy)];
    if(moved[0]===x&&moved[1]===y){edit.field.value=edit.original;}
    else{
     const points=edit.points.slice();points[edit.index]=moved;
     const rows=formatPoints(points,edit.bulges);
     if(edit.field===region){
      const loops=edit.original.trim().split(/\r?\n/);loops[edit.loop]=rows.join(' | ');
      edit.field.value=loops.join('\n');
     }else edit.field.value=rows.join('\n');
    }
   }else if(drag.kind==='depth'){
    const projectionScale=symmetric.checked ? .5 : 1;
    length.value=String(bounded(round(drag.d+(.45*dx-.35*dy)/(.45**2+.35**2)/projectionScale)));
   }else if(kind.value==='circle')radius.value=String(bounded(round(drag.r+dx)));
   else{width.value=String(bounded(round(drag.w+2*dx)));depth.value=String(bounded(round(drag.h+2*dy)));}
   draw();
  };
  const endDrag=(event:PointerEvent)=>{
   if(!drag||event.pointerId!==drag.id)return;
   const {id,vertex}=drag;
   const restore=vertex&&(event.type!=='pointerup'||!valid);
   const diagnostic=restore&&event.type==='pointerup'?status.textContent:null;
   if(restore)vertex.field.value=vertex.original;
   drag=undefined;
   if(preview.hasPointerCapture(id))preview.releasePointerCapture(id);
   draw();
   if(diagnostic)status.textContent=t('Outline point restored.')+' '+diagnostic;
  };
  preview.onpointerup=preview.onpointercancel=preview.onlostpointercapture=endDrag;
  form.addEventListener('input',draw);form.addEventListener('change',draw);
  const apply=element('button',t(existing?'Apply sketch changes':'Create extrusion'));apply.className='primary';
  apply.onclick=async()=>{const ticket=epoch;busy=true;apply.disabled=true;try{
   const snapshot=readForm();
   if(session.state.revision!==expected)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
   const candidate=draft(snapshot);const geometry=await evaluate(candidate.document);const created=geometry.bodies.find(body=>body.id===candidate.id);if(disposed||epoch!==ticket||!dialog.open)return;
   if(session.state.revision!==expected)throw new Error(t('The model changed while checking geometry. Close and reopen this dialog.'));
   if(!existing&&(!created||created.volume<=0))throw new Error(t('The profile must produce a solid with positive volume.'));
   // One transaction, including sketch and extrusion inputs.
   if(existing&&featureId)session.editExtrusion(featureId,{sketch:{name:snapshot.name,plane:snapshot.plane,profile:snapshot.profile},distance:snapshot.distance,symmetric:snapshot.symmetric});
   else session.addSketchExtrusion({...snapshot.profile,id:newId()},{name:snapshot.name,plane:snapshot.plane,distance:snapshot.distance,symmetric:snapshot.symmetric,position:[0,0,-(created?.bounds.min[2]??0)]});
   dialog.close();await afterApply();
  }catch(error){if(!disposed)status.textContent=error instanceof Error&&'diagnostic' in error?(error as import('@brickwright/cad-core').FeatureEvaluationError).diagnostic.message:error instanceof Error?error.message:String(error);}finally{busy=false;apply.disabled=!valid;}};
  if(!existing){
   const importPanel=element('details');
   importPanel.className='sketch-expressions';
   const importSummary=element('summary',t('Import DXF outline'));
   const units=element('label',t('Assume millimetres if the file has no units'));
   const assumeMm=element('input');
   assumeMm.type='checkbox';
   units.className='sketch-toggle';
   units.prepend(assumeMm);
   const file=element('input');
   file.type='file';
   file.accept='.dxf';
   file.setAttribute('aria-label',t('Choose DXF file'));
   const importedSource=element('p');
   file.onchange=async()=>{
    const chosen=file.files?.[0];
    const ticket=epoch;
    const assume=assumeMm.checked;
    if(!chosen||busy)return;
    busy=true;
    apply.disabled=true;
    file.disabled=true;
    let errorMessage='';
    try{
     if(chosen.size>maxSketchDxfBytes)throw new Error(t('Choose a DXF file up to 1 MB.'));
     const imported=readSketchDxf(await chosen.text(),assume);
     if(epoch!==ticket||disposed||!dialog.open)return;
     const id='dxf-preview';
     evaluateExtrusion({kind:'extrusion',featureVersion:1,id,sketchId:id,distance:1,symmetric:false},{
      ...doc,sketches:{[id]:{version:1,id,name:'DXF',plane:'XY',profile:imported}}
     });
     kind.value=imported.kind;
     singleDxfLayer=imported.kind==='outline'||imported.kind==='circle'?imported.dxfLayer:undefined;
     if(imported.kind==='region'){
      regionLoops=imported.loops;
      region.value=formatLoops(regionLoops);
     }
     if(imported.kind==='outline')points.value=formatPoints(imported.points,imported.bulges).join('\n');
     if(imported.kind==='circle'){
      radius.value=String(imported.radius);
      center.value=imported.center?.join(', ')??'0, 0';
     }
     name.value=chosen.name.replace(/\.dxf$/i,'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,160)||t('Sketch');
     importedSource.textContent=chosen.name;
    }catch(error){errorMessage=error instanceof Error?error.message:String(error);}
    finally{
     busy=false;
     file.disabled=false;
     file.value='';
     if(epoch===ticket&&!disposed&&dialog.open){
      draw();
      if(errorMessage){
       status.textContent=errorMessage;
       apply.disabled=true;
      }
     }
    }
   };
   importPanel.append(importSummary,units,file,importedSource);
   form.append(importPanel);
  }
  const footer=element('footer');footer.append(status,apply);const body=element('div');body.className='sketch-body';const expressions=element('details');expressions.className='sketch-expressions';const summary=element('summary',t('Dimension expressions'));summary.title=t('Dimension expressions');summary.setAttribute('aria-label',t('Dimension expressions'));expressions.append(summary,help);form.append(expressions);const drawing=element('div');drawing.append(preview,hint);body.append(drawing,form);dialog.append(header,infoPanel,body,footer);draw();dialog.showModal();
 }
 dialog.addEventListener('keydown',e=>e.stopPropagation());
 return {open,dispose(){disposed=true;dialog.close();dialog.remove();}};
}
