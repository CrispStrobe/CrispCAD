// SPDX-License-Identifier: BSD-3-Clause
import {closePathProfile,evaluateSketch,newId,resolveSketchPath,t,trimSketchProfile,FeatureEvaluationError} from '@brickwright/cad-core';
import type {CadSession,PlanarSketch,SketchPathProfile,SketchPlane} from '@brickwright/cad-core';
import {formatSketchPoints,parseSketchOutline,parseSketchPoint} from './sketch-point-entry.js';
import {operationField} from './body-operation-panel.js';
import {mountDxfImportControls} from './dxf-import-controls.js';
import {exportSketchPathDxf} from './sketch-dxf.js';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,value?:string)=>{
 const node=document.createElement(tag);
 if(value!==undefined)node.textContent=value;
 return node;
};
const svgNS='http://www.w3.org/2000/svg';

export function mountPathPanel(parent:HTMLElement,session:CadSession,showObjects:()=>void,onExport?:(file:ReturnType<typeof exportSketchPathDxf>)=>void|Promise<void>){
 const dialog=element('dialog');
 dialog.className='sketch-dialog';
 dialog.setAttribute('aria-label',t('Sketch path'));
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 parent.append(dialog);

 function open(id?:string){
  const {document:doc,revision}=session.state,existing=id?doc.sketches?.[id]:undefined;
  if(id&&existing?.profile.kind!=='path')throw new Error(t('Select an open sketch path'));
  const profile=existing?.profile.kind==='path'?existing.profile:undefined;
  const profileId=profile?.id??newId();
  let dxfLayer=profile?.dxfLayer,draftRevision=0;
  let vertexIds=profile?.vertexIds,anchors=profile?.anchors;
  dialog.replaceChildren();

  const header=element('header'),close=element('button','×');
  close.setAttribute('aria-label',t('Close path editor'));
  close.onclick=()=>dialog.close();
  header.append(element('h2',t('Sketch path')),close);

  const preview=element('div');
  preview.className='sketch-preview path-preview';
  preview.setAttribute('aria-label',t('Open path preview'));
  const fields=element('div');
  fields.className='sketch-fields';
  const name=element('input'),plane=element('select'),points=element('textarea');
  name.value=existing?.name??t('Sketch path');
  for(const axis of ['XY','XZ','YZ'])plane.add(new Option(axis,axis));
  plane.value=existing?.plane??'XY';
  points.rows=6;
  points.maxLength=65536;
  points.spellcheck=false;
  points.value=profile?formatSketchPoints(profile.points,profile.bulges).join('\n'):'0, 0\n30, 0\n30, 20';
  fields.append(operationField(t('Sketch name'),name).label,operationField(t('Sketch plane'),plane).label,
   operationField(t('Path points X, Y (mm)'),points).label,
   element('small',t('Enter one point per line. Use @dX, dY for a relative point. Add a third value for an arc bulge on the outgoing edge.')));

  const locks=element('details');
  locks.className='sketch-expressions';
  const vertex=element('select'),lockX=element('input'),lockY=element('input');
  const applyLock=element('button',t('Lock point')),removeLock=element('button',t('Unlock point'));
  locks.append(element('summary',t('Point locks')),
   element('p',t('Fix a point with millimetres or a project parameter, such as width / 2. Unlock points before inserting, removing, or reordering rows.')),
   operationField(t('Path point'),vertex).label,operationField(t('Locked X (mm)'),lockX).label,
   operationField(t('Locked Y (mm)'),lockY).label,applyLock,removeLock);
  const closureHint=element('small',t('Closing uses the current positions of locked points. The outline has no point locks.'));
  locks.append(closureHint);
  fields.append(locks);

  const trim=element('details');
  trim.className='sketch-expressions';
  const first=element('input'),second=element('input'),side=element('select');
  side.add(new Option(t('Left of line'),'left'));side.add(new Option(t('Right of line'),'right'));
  const trimButton=element('button',t('Trim path draft'));
  trim.append(element('summary',t('Trim by line')),element('p',t('Choose two points and keep the left or right side looking from the first point to the second.')),
   operationField(t('First trim point X, Y (mm)'),first).label,operationField(t('Second trim point X, Y (mm)'),second).label,
   operationField(t('Keep side'),side).label,trimButton);
  fields.append(trim);

  const dxf=element('details');
  dxf.className='sketch-expressions';
  const layer=element('small'),exportPath=element('button',t('Export path as DXF'));
  exportPath.type='button';
  dxf.append(element('summary',t('DXF path')));
  fields.append(dxf);

  const body=element('div');
  body.className='sketch-body';
  body.append(preview,fields);
  const status=element('p');
  status.className='parameter-status';
  status.setAttribute('role','status');
  status.setAttribute('aria-label',t('Sketch status'));
  const save=element('button',t('Save path')),closePath=element('button',t('Close into outline'));
  save.className='primary';
  const footer=element('footer');
  footer.append(status,closePath,save);
  if(id){
   const remove=element('button',t('Delete path'));
   remove.onclick=()=>change(()=>session.removeSketchPath(id));
   footer.insertBefore(remove,closePath);
  }
  dialog.append(header,body,footer);

  function read():PlanarSketch&{profile:SketchPathProfile}{
   return {version:1,id:id??'preview-path',name:name.value.trim(),plane:plane.value as SketchPlane,
    profile:{kind:'path',id:profileId,...parseSketchOutline(points.value.trim().split(/\r?\n/)),...(dxfLayer?{dxfLayer}:{}),...(anchors?{anchors,vertexIds}:{})}};
  }
  function report(error:unknown){
   status.textContent=error instanceof FeatureEvaluationError?error.diagnostic.message:error instanceof Error?error.message:String(error);
  }
  function writePath(next:SketchPathProfile){
   points.value=formatSketchPoints(next.points,next.bulges).join('\n');
   vertexIds=next.vertexIds;
   anchors=next.anchors;
  }
  function updateLockFields(){
   const index=vertex.selectedIndex,anchor=anchors?.find(item=>item.vertexId===vertexIds?.[index]);
   removeLock.disabled=!anchor;
   applyLock.textContent=t(anchor?'Update point lock':'Lock point');
   applyLock.disabled=true;
   lockX.value=anchor===undefined?'':String(anchor.x);
   lockY.value=anchor===undefined?'':String(anchor.y);
   try{
    const draft=read();
    if(index<0||vertexIds&&vertexIds.length!==draft.profile.points.length)return;
    const point=resolveSketchPath(draft.profile,doc)[index];
    if(!point)return;
    applyLock.disabled=false;
    if(anchor)return;
    lockX.value=String(point[0]);
    lockY.value=String(point[1]);
   }catch{/* The preview reports invalid geometry. */}
  }
  function draw(){
   closureHint.hidden=!anchors?.length;
   preview.replaceChildren();
   status.textContent='';
   save.disabled=closePath.disabled=trimButton.disabled=exportPath.disabled=true;
   layer.textContent=dxfLayer?t`DXF layer: ${dxfLayer}`:'';
   const selected=vertex.selectedIndex;
   let count=vertexIds?.length??0;
   try{count=vertexIds?.length??read().profile.points.length;}catch{/* Locks can still be removed. */}
   vertex.replaceChildren(...Array.from({length:count},(_,index)=>{
    const number=index+1;
    return new Option(anchors?.some(anchor=>anchor.vertexId===vertexIds?.[index])?t`Point ${number} (locked)`:t`Point ${number}`,String(index));
   }));
   vertex.selectedIndex=Math.max(0,Math.min(selected,count-1));
   updateLockFields();
   try{
    const draft=read();
    if(vertexIds&&vertexIds.length!==draft.profile.points.length)throw new Error(t('Restore the original point count or unlock the points.'));
    const {contour}=evaluateSketch(draft,doc),x=contour.map(point=>point[0]),y=contour.map(point=>-point[1]);
    const left=Math.min(...x),top=Math.min(...y),width=Math.max(...x)-left,height=Math.max(...y)-top,margin=Math.max(width,height,1)*.15;
    const svg=document.createElementNS(svgNS,'svg');
    svg.setAttribute('viewBox',`${left-margin} ${top-margin} ${width+2*margin} ${height+2*margin}`);
    svg.setAttribute('aria-hidden','true');
    const line=document.createElementNS(svgNS,'polyline');
    line.setAttribute('points',contour.map(([x,y])=>`${x},${-y}`).join(' '));
    line.setAttribute('class','sketch-path-line');
    svg.append(line);
    const vertices=resolveSketchPath(draft.profile,doc);
    for(const [index,point] of vertices.entries()){
     const locked=anchors?.some(anchor=>anchor.vertexId===vertexIds?.[index]);
     if(!locked&&index!==0&&index!==vertices.length-1)continue;
     const endpoint=document.createElementNS(svgNS,'circle');
     endpoint.setAttribute('cx',String(point[0]));
     endpoint.setAttribute('cy',String(-point[1]));
     endpoint.setAttribute('r',String(margin*.15));
     endpoint.setAttribute('class',locked?'sketch-handle sketch-path-locked':'sketch-handle');
     svg.append(endpoint);
    }
    preview.append(svg);
    save.disabled=closePath.disabled=trimButton.disabled=exportPath.disabled=false;
   }catch(error){report(error);}
  }
  function changed(event:Event){
   if(event.target===file)return;
   draftRevision++;
   if(event.target instanceof Node&&locks.contains(event.target)){
    if(event.target===vertex)updateLockFields();
    return;
   }
   draw();
  }
  fields.addEventListener('input',changed);
  fields.addEventListener('change',changed);

  applyLock.onclick=()=>{
   try{
    const draft=read(),index=vertex.selectedIndex;
    const ids=vertexIds??draft.profile.points.map(()=>newId());
    const vertexId=ids[index],x=lockX.value.trim(),y=lockY.value.trim();
    const scalar=(value:string)=>Number.isFinite(Number(value))?Number(value):value;
    if(!x||!y||!vertexId)throw new Error(t('Enter both locked coordinates.'));
    const next=[...(anchors??[]).filter(anchor=>anchor.vertexId!==vertexId),{vertexId,x:scalar(x),y:scalar(y)}];
    evaluateSketch({...draft,profile:{...draft.profile,vertexIds:ids,anchors:next}},doc);
    vertexIds=ids;
    anchors=next;
    draftRevision++;
    draw();
   }catch(error){report(error);}
  };
  removeLock.onclick=()=>{
   const index=vertex.selectedIndex,vertexId=vertexIds?.[index];
   const remaining=anchors?.filter(anchor=>anchor.vertexId!==vertexId);
   try{
    const {profile:draft}=read();
    if(draft.points.length===vertexIds?.length){
     draft.points[index]=resolveSketchPath(draft,doc)[index];
     points.value=formatSketchPoints(draft.points,draft.bulges).join('\n');
    }
   }catch{/* Keep unfinished point entries editable when the lock is removed. */}
   anchors=remaining?.length?remaining:undefined;
   if(!anchors)vertexIds=undefined;
   draftRevision++;
   draw();
  };

  const active=()=>dialog.open&&dialog.firstChild===header;
  mountDxfImportControls(dxf,{
   active,revision:()=>draftRevision,
   checkCurrent:()=>{
    if(session.state.revision!==revision)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
   },
   read:(drawing,assumeMm,layers)=>drawing.path(assumeMm,layers),
   imported:(imported,fileName)=>{
    writePath(imported);
    dxfLayer=imported.dxfLayer;
    if(!existing)name.value=fileName||t('Sketch path');
    draftRevision++;draw();
   },
   error:report
  });
  dxf.append(layer);
  if(onExport)dxf.append(exportPath);
  exportPath.onclick=async()=>{
   try{await onExport?.(exportSketchPathDxf(doc,read()));}
   catch(error){if(active())report(error);}
  };


  function change(commit:()=>void){
   try{
    if(session.state.revision!==revision)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
    commit();
    dialog.close();
    showObjects();
   }catch(error){report(error);}
  }
  save.onclick=()=>change(()=>{
   const {name,plane,profile}=read();
   if(id)session.updateSketch(id,{name,plane,profile});
   else session.addSketch(profile,{name,plane});
  });
  closePath.onclick=()=>change(()=>{
   const {name,plane,profile}=read();
   if(id)session.closeSketchPath(id,profile,{name,plane});
   else session.addSketch(closePathProfile(profile,doc),{name,plane});
  });
  trimButton.onclick=()=>{
   try{
    const path=trimSketchProfile(read(),doc,parseSketchPoint(first.value),parseSketchPoint(second.value),side.value==='left'?'left':'right');
    if(path.kind!=='path')return;
    writePath(path);
    draftRevision++;
    draw();
   }catch(error){report(error);}
  };
  draw();
  dialog.showModal();
 }
 return {open,dispose(){dialog.close();dialog.remove();}};
}
