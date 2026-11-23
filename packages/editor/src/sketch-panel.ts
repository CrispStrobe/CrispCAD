import {collectSketchSnaps,collectTangentSnaps,nearestSketchSnap,sketchSnapReference} from './sketch-snaps.js';
import type {SketchSnap} from './sketch-snaps.js';
import {formatSketchPoints as formatPoints, parseSketchOutline as parseOutline, parseSketchPoint as parsePoint, sketchDraggedBulge} from './sketch-point-entry.js';
import {mountDxfImportControls} from './dxf-import-controls.js';
import {mountOutlineConstraintControls} from './outline-constraint-controls.js';
import {mountRegionConstraintControls} from './region-constraint-controls.js';
import {mountRegionPositionControls} from './region-position-controls.js';
import {toolIcon} from './icons.js';
import { t } from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession,evaluateExtrusion,evaluateRevolution,featureValue,maxSketchOutlinePoints,maxSketchRegionLoops,newId,positionRegionLoops,sketchBulgeMidpoint,sketchDxfLayerFields,trimSketchProfile} from '@brickwright/cad-core';
import type {DxfSegmentWidth,RegionLoopPlacement,SketchLoop,SketchPoint,CadSession,FeatureScalar,SketchPlane,SketchProfile,CadDocument,PlanarSketch} from '@brickwright/cad-core';
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const scalar=(source:string):FeatureScalar=>source.trim()!==''&&Number.isFinite(Number(source))?Number(source):source.trim();
/** Definition editor: complete draft + kernel preflight before the real session changes. */
export function mountSketchPanel(parent:HTMLElement,session:CadSession,evaluate:(doc:CadDocument)=>Promise<import('@brickwright/cad-geometry').GeometryResult>,
 offsetSketch:(sketch:PlanarSketch,context:Pick<CadDocument,'parametric'>,distance:number)=>Promise<SketchProfile>,afterApply:()=>Promise<unknown>,snap:()=>number=()=>1) {
 const dialog=element('dialog');dialog.className='sketch-dialog';dialog.setAttribute('aria-label',t('Sketch and extrusion'));parent.append(dialog);
 let disposed=false,epoch=0;dialog.addEventListener('close',()=>epoch++);
 function open(featureId?:string,request?:{sketchId?:string;revolve:boolean}){
  epoch++;let busy=false;const expected=session.state.revision,doc=session.state.document,node=featureId?doc.nodes[featureId]:undefined;
  if(featureId&&node?.kind!=='extrusion'&&node?.kind!=='revolution')throw new Error(t('Select an extrusion feature to edit'));
  const revolving=request?.revolve??(node?.kind==='revolution');
  const linked=request?.sketchId;
  const sketchId=node?.kind==='extrusion'||node?.kind==='revolution'?node.sketchId:linked;
  const existing=sketchId?doc.sketches?.[sketchId]:undefined;
  const title=revolving?(featureId?'Edit sketch & revolution':'Sketch & revolve'):(featureId?'Edit sketch & extrusion':linked?'Extrude sketch':'Sketch & extrude');
  dialog.setAttribute('aria-label',t(revolving?'Sketch and revolution':'Sketch and extrusion'));
  dialog.replaceChildren();
  const close=element('button','×');close.setAttribute('aria-label',t('Close sketch'));close.title=t('Close sketch');close.onclick=()=>dialog.close();const header=element('header');header.append(element('h2',t(title)),close);
  const form=element('div');form.className='sketch-fields';
  const field=(label:string,value:string|number)=>{const wrap=element('label',t(label)),input=element('input');input.type='text';input.value=String(value);input.setAttribute('aria-label',t(label));wrap.append(input);form.append(wrap);return input;};
  const choice=(label:string,values:string[],value:string)=>{const wrap=element('label',t(label)),select=element('select');select.setAttribute('aria-label',t(label));for(const v of values){const o=element('option',label==='Sketch plane'?v:t(v));o.value=v;select.append(o);}select.value=value;wrap.append(select);form.append(wrap);return select;};
  const name=field('Sketch name',existing?.name??t('Sketch'));
  const info=element('button','ⓘ');
  info.type='button';
  info.className='sketch-info-button';
  info.setAttribute('aria-label',t(revolving?'About sketching and revolution':'About sketching and extrusion'));
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
   t('DXF and DWG import accept closed outlines and circles. Loops inside an outer boundary become holes.'),
   ...(revolving?[
    t('Revolve sweeps the profile around an axis parallel to sketch Y. The dashed line marks the axis. Keep the entire profile on one side.'),
    t('Use 360° for a full turn. A negative angle reverses the sweep.')
   ]:[
    t('Extrusion adds thickness perpendicular to the plane. Symmetric divides that thickness equally on both sides.'),
    t('Create builds a solid. To change the sketch later, select the solid and choose Edit sketch & extrusion in Properties.')
   ])
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
  points.value=profile?.kind==='outline'?formatPoints(profile.points,profile.bulges,profile.dxfWidths).join('\n'):'0, 0\n40, 0\n30, 30\n0, 30';
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
   : formatPoints(loop.points,loop.bulges,loop.dxfWidths).join(' | ')).join('\n');
  let singleDxfLayer=sketchDxfLayerFields(profile?.kind==='outline'||profile?.kind==='circle'?profile:undefined);
  let regionLoops=profile?.kind==='region'?profile.loops:[];
  const regionVertexIds=new Map<string,string[]>();
  const vertexIdsFor=(id:string,count:number,original?:string[])=>{
   if(count>maxSketchOutlinePoints)return undefined;
   const key=`${id}:${count}`;
   let ids=regionVertexIds.get(key);
   if(!ids){
    ids=original?.length===count?original:Array.from({length:count},newId);
    regionVertexIds.set(key,ids);
   }
   return ids;
  };
  region.value=regionLoops.length?formatLoops(regionLoops):'0, 0 | 40, 0 | 40, 30 | 0, 30\nCIRCLE 10, 15, 2';
  regionLabel.append(region,element('small',t('One loop per line. Separate outline points with | and add an optional bulge for arcs. For circles type CIRCLE X, Y, radius. Circle values can use named dimensions.')));
  form.append(regionLabel,relativeHint);
  const widthHint=element('small',t('DXF widths use X, Y, bulge, start width, end width. The solid follows the centerline.'));
  widthHint.hidden=true;
  form.append(widthHint);
  const curveHandles=element('input');
  curveHandles.type='checkbox';
  const curveToggle=element('label',t('Edit edge curves'));
  curveToggle.className='sketch-toggle';
  curveToggle.prepend(curveHandles);
  const curveHint=element('small',t('Drag the blue handles to curve an edge.'));
  form.append(curveToggle,curveHint);
  const guides=element('details');
  guides.className='sketch-expressions';
  guides.append(element('summary',t('Sketch snap references')));
  const reference=(name:string)=>{
   const label=element('label',t(name)),input=element('select');
   input.setAttribute('aria-label',t(name));
   label.append(input);guides.append(label);return input;
  };
  const firstGuide=reference('Reference sketch'),secondGuide=reference('Second reference sketch');
  const tangents=element('input');
  tangents.type='checkbox';
  const tangentToggle=element('label',t('Snap straight edges tangent to arcs and circles'));
  tangentToggle.className='sketch-toggle';
  tangentToggle.prepend(tangents);
  guides.append(tangentToggle,element('small',t('Choose sketches on this plane to snap to their original coordinates.')));
  form.append(guides);
  let referenceGeometry:ReturnType<typeof sketchSnapReference>[]=[];
  let snapTargets:SketchSnap[]=[];
  function updateGuides(){
   const available=Object.values(doc.sketches??{}).filter(s=>s.id!==existing?.id&&s.plane===plane.value);
   for(const input of [firstGuide,secondGuide]){
    const current=input.value;
    const options=available.map(sketch=>new Option(sketch.name,sketch.id));
    input.replaceChildren(new Option(t('No reference'),''),...options);
    if(available.some(s=>s.id===current))input.value=current;
   }
   guides.hidden=!available.length||!['outline','region'].includes(kind.value);
   refreshGuideGeometry();
  }
  function refreshGuideGeometry(){
   const selected=new Set(guides.hidden?[]:[firstGuide.value,secondGuide.value].filter(Boolean));
   referenceGeometry=[...selected].map(id=>sketchSnapReference(doc.sketches![id],doc));
   snapTargets=collectSketchSnaps(referenceGeometry[0],referenceGeometry[1]);
   tangents.disabled=!referenceGeometry.some(guide=>guide.edges.some(edge=>edge.kind==='circle'));
  }
  for(const input of [firstGuide,secondGuide])input.addEventListener('change',refreshGuideGeometry);
  for(const input of [plane,kind])input.addEventListener('change',updateGuides);
  updateGuides();
  if(linked)for(const input of form.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input, select, textarea'))input.disabled=true;
  const length=field('Extrusion distance (mm)',node?.kind==='extrusion'?node.distance:10);
  const symmetric=element('input');symmetric.type='checkbox';symmetric.checked=node?.kind==='extrusion'?node.symmetric:false;symmetric.setAttribute('aria-label',t('Symmetric extrusion'));const check=element('label',t('Symmetric extrusion'));check.className='sketch-toggle';check.prepend(symmetric);form.append(check);
  length.parentElement!.hidden=check.hidden=revolving;
  const sweep=field('Sweep angle (deg)',node?.kind==='revolution'?node.angle:360);
  const automatic=element('input');automatic.type='checkbox';automatic.checked=node?.kind!=='revolution'||node.axisOffset===undefined;
  const axisToggle=element('label',t('Use left edge of profile'));axisToggle.className='sketch-toggle';axisToggle.prepend(automatic);form.append(axisToggle);
  const axis=field('Axis X in sketch (mm)',node?.kind==='revolution'?node.axisOffset??0:0);
  sweep.parentElement!.hidden=axisToggle.hidden=!revolving;
  const preview=element('div');preview.className='sketch-preview';preview.setAttribute('aria-label',t('Sketch preview'));
  const status=element('p');status.className='parameter-status';status.setAttribute('role','status');status.setAttribute('aria-label',t('Sketch status'));
  const hint=element('p',t('Drag the white handles or type exact dimensions.'));
  const help=element('p',t('Enter dimensions or expressions such as width / 2. Define named dimensions in Parameters.'));
  const trimPanel=element('details');
  trimPanel.className='sketch-expressions';
  const trimStart=element('input'),trimEnd=element('input');
  const trimSide=element('select');
  trimSide.add(new Option(t('Left of line'),'left'));
  trimSide.add(new Option(t('Right of line'),'right'));
  for(const [label,input] of [['First trim point X, Y (mm)',trimStart],['Second trim point X, Y (mm)',trimEnd],['Keep side',trimSide]] as const){
   const field=element('label',t(label));field.append(input);trimPanel.append(field);
  }
  const trimPick=element('button',t('Pick trim line'));
  const trimApply=element('button',t('Trim draft'));
  trimPick.type=trimApply.type='button';
  trimPanel.prepend(element('summary',t('Trim by line')),element('p',t('Choose two points and keep the left or right side looking from the first point to the second.')));
  trimPanel.append(trimPick,trimApply);
  form.append(trimPanel);
  let trimPicking=0,previewDepth=0;
  function setTrimPicking(point:number){
   trimPicking=point;
   trimPick.setAttribute('aria-pressed',String(point!==0));
   trimPick.textContent=t(point===1?'Pick first trim point':point===2?'Pick second trim point':'Pick trim line');
   preview.classList.toggle('trim-picking',point!==0);
  }
  setTrimPicking(0);
  trimPick.onclick=()=>{
   if(busy||drag)return;
   if(trimPicking){setTrimPicking(0);return;}
   setTrimPicking(1);
   preview.scrollIntoView({block:'nearest'});
  };
  trimPanel.ontoggle=()=>{if(!trimPanel.open)setTrimPicking(0);draw();};
  function replaceProfileDraft(profile:SketchProfile){
   switch(profile.kind){
    case 'rectangle':width.value=String(profile.width);depth.value=String(profile.depth);break;
    case 'circle':radius.value=String(profile.radius);break;
    case 'outline':points.value=formatPoints(profile.points,profile.bulges,profile.dxfWidths).join('\n');break;
    case 'region':regionLoops=profile.loops;region.value=formatLoops(regionLoops);break;
   }
  }
  function definition():SketchProfile{
   if(linked&&existing)return existing.profile;
   const id=existing?.profile.id??'profile-preview';
   if(kind.value==='region'){
    const rows=region.value.trim().split(/\r?\n/);
    if(rows.length>maxSketchRegionLoops)throw new Error(t('A region supports up to 16 loops.'));
    const loops=rows.map((row,i):SketchLoop=>{
     const original=regionLoops[i];
     const id=original?.id??'region-loop-'+(i+1);
     const layer=sketchDxfLayerFields(original);
     const circle=/^CIRCLE\s+(.+)$/i.exec(row.trim());
     if(circle){
      const values=circle[1].split(',');
      if(values.length!==3||!values.every(value=>value.trim()))throw new Error(t('For a circle enter CIRCLE X, Y, radius.'));
      return {kind:'circle',id,center:[scalar(values[0]),scalar(values[1])],radius:scalar(values[2]),segments:original?.kind==='circle'?original.segments:64,...layer};
     }
     const outline=parseOutline(row.split('|'));
     return {kind:'outline',id,...outline,...layer,vertexIds:vertexIdsFor(id,outline.points.length,original?.kind==='outline'?original.vertexIds:undefined)};
    });
    return {kind:'region',id,loops};
   }
   if(kind.value==='outline'){
    const rows=points.value.trim().split(/\r?\n/);
    return {kind:'outline',id,...parseOutline(rows),...singleDxfLayer};
   }
   if(kind.value==='rectangle')return {kind:'rectangle',id,width:scalar(width.value),depth:scalar(depth.value)};
   const location=parsePoint(center.value);
   return {kind:'circle',id,radius:scalar(radius.value),segments:profile?.kind==='circle'?profile.segments:64,...singleDxfLayer,
    ...(profile?.kind==='circle'&&profile.center||location.some(Boolean)?{center:location}:{})};
  }
  const readForm=(retain=false,positions?:RegionLoopPlacement[])=>{
   const profile=definition();
   let retained=profile;
   if(!linked){
    if(retain&&profile.kind==='outline')retained={...profile,...outlineConstraints.forSave(profile)};
    if(profile.kind==='region'){
     const placementFields=positions===undefined?regionPositions.forSave(profile.loops):{placements:positions.length?positions:undefined};
     const loops=retain?regionConstraints.forSave(profile.loops).map(loop=>{
      if(loop.kind!=='outline'||loop.relations||placementFields.placements?.some(placement=>
       (placement.target===loop.id&&placement.targetEdge)||(placement.reference===loop.id&&placement.referenceEdge)))return loop;
      const {vertexIds,...withoutIds}=loop;
      return withoutIds;
     }):profile.loops;
     retained=positionRegionLoops({...profile,...placementFields,
      loops
     },value=>featureValue(value,doc));
    }
   }
   return {
   sketch:{name:name.value.trim(),plane:plane.value as SketchPlane,profile:retained},
   extrusion:{distance:scalar(length.value),symmetric:symmetric.checked},
   revolution:{angle:scalar(sweep.value),axisOffset:automatic.checked?undefined:scalar(axis.value)}
   };
  };
  function applyDraft(target:CadSession,{sketch,extrusion,revolution}:ReturnType<typeof readForm>,position?:[number,number,number]){
   if(featureId){
    if(revolving)target.editRevolution(featureId,{sketch,...revolution});
    else target.editExtrusion(featureId,{sketch,...extrusion});
    return featureId;
   }
   if(linked)return revolving?target.revolveSketch(linked,revolution):target.extrudeSketch(linked,extrusion);
   const newProfile={...sketch.profile,id:newId()};
   const settings={name:sketch.name,plane:sketch.plane,position};
   return revolving?target.addSketchRevolution(newProfile,{...settings,...revolution}):target.addSketchExtrusion(newProfile,{...settings,...extrusion});
  }
  function draft(snapshot:ReturnType<typeof readForm>){
   const trial=createCadSession(doc);
   try{
    const id=applyDraft(trial,snapshot);
    return {document:trial.state.document,id};
   }finally{trial.dispose();}
  }
  function previewShape({sketch,extrusion,revolution}:ReturnType<typeof readForm>){
   const id='sketch-preview',common={featureVersion:1 as const,id,sketchId:id};
   const previewDoc:CadDocument={...doc,sketches:{[id]:{version:1,id,...sketch}}};
   if(revolving){
    const shape=evaluateRevolution({kind:'revolution',...common,...revolution},previewDoc);
    return {...shape,distance:0,start:0};
   }
   return {...evaluateExtrusion({kind:'extrusion',...common,...extrusion},previewDoc),angle:undefined,axisOffset:undefined};
  }
  type OutlineEdit = {field:HTMLTextAreaElement; original:string; loop:number; index:number; points:SketchPoint[]; bulges?:number[]; dxfWidths?:DxfSegmentWidth[]; targets:SketchSnap[]};
  let drag:{id:number;x:number;y:number;w:number;h:number;r:number;d:number;inverse:DOMMatrix;kind:string;viewBox:string;outlineEdit?:OutlineEdit;target?:SketchSnap}|undefined;
  let dragOutline:ReturnType<typeof definition>|undefined;
  let valid=false;
  const bounded=(value:number)=>Math.min(100000,Math.max(.01,value));
  const compact=(input:HTMLInputElement,icon:string)=>{const label=input.parentElement!;label.firstChild!.textContent='';label.classList.add('sketch-dimension');const picture=toolIcon(icon);if(picture)label.prepend(picture);input.title=input.getAttribute('aria-label')!;label.append(element('small','mm'));const caption=element('span',input.getAttribute('aria-label')!);caption.className='sketch-dimension-name';label.prepend(caption);};
  compact(width,'Sketch width');compact(depth,'Sketch depth');compact(radius,'Sketch radius');compact(length,'Extrude');
  function draw(){
   outlineConstraints.refresh();
   regionConstraints.refresh();
   regionPositions.refresh();
   widthHint.hidden=true;
   trimPanel.hidden=!!linked||!['outline','region'].includes(kind.value);
   if(trimPanel.hidden&&trimPicking)setTrimPicking(0);
   axis.parentElement!.hidden=!revolving||automatic.checked;
   width.parentElement!.hidden=depth.parentElement!.hidden=kind.value!=='rectangle';radius.parentElement!.hidden=center.parentElement!.hidden=kind.value!=='circle';pointsLabel.hidden=kind.value!=='outline';regionLabel.hidden=kind.value!=='region';relativeHint.hidden=curveToggle.hidden=pointsLabel.hidden&&regionLabel.hidden;curveHint.hidden=curveToggle.hidden||!curveHandles.checked;preview.replaceChildren();dragOutline=undefined;valid=false;
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
   try{const snapshot=readForm(),draftProfile=snapshot.sketch.profile;
    widthHint.hidden=!(draftProfile.kind==='outline'?draftProfile.dxfWidths:
     draftProfile.kind==='region'&&draftProfile.loops.some(loop=>loop.kind==='outline'&&loop.dxfWidths));
    const shape=previewShape(snapshot),xs=shape.contour.map(p=>p[0]),ys=shape.contour.map(p=>p[1]),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys),d=shape.distance,ox=d*.45,oy=-d*.35;
    const projected=[shape.contour,...(shape.holes??[])].map(loop=>loop.map(([x,y])=>[x+shape.start*.45,-y-shape.start*.35]));
    const raised=projected.map(loop=>loop.map(([x,y])=>[x+ox,y+oy]));
    const [base]=projected,[top]=raised;
    const topOffset=previewDepth=shape.start+d;
    const place=([x,y]:SketchPoint)=>[x+topOffset*.45,-y-topOffset*.35];
    const references=referenceGeometry.flatMap(guide=>guide.contours.map(loop=>loop.map(place)));
    const openReferences=referenceGeometry.flatMap(guide=>guide.openPath?[guide.openPath.map(place)]:[]);
    const axisLine=shape.axisOffset!==undefined?[[shape.axisOffset,-Math.max(...ys)-h*.1],[shape.axisOffset,-Math.min(...ys)+h*.1]]:[];
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),all=[...base,...top,...references.flat(),...openReferences.flat(),...axisLine],span=Math.max(w,h,Math.abs(d),1),pad=span*.18,minX=Math.min(...all.map(p=>p[0]))-pad,minY=Math.min(...all.map(p=>p[1]))-pad,vw=Math.max(...all.map(p=>p[0]))-minX+pad,vh=Math.max(...all.map(p=>p[1]))-minY+pad;
    svg.setAttribute('viewBox',drag?.viewBox??`${minX} ${minY} ${vw} ${vh}`);svg.setAttribute('aria-hidden','true');
    const face=(loops:number[][][],cls:string)=>{
     const path=document.createElementNS(ns,'path');
     path.setAttribute('d',loops.map(loop=>'M '+loop.map(point=>point.join(' ')).join(' L ')+' Z').join(' '));
     path.setAttribute('fill-rule','evenodd');
     path.setAttribute('class',cls);
     svg.append(path);
    };
    if(!revolving)face(projected,'sketch-base');
    for(let k=0;!revolving&&k<projected.length;k++){
     const lower=projected[k],upper=raised[k];
     for(let i=0;i<lower.length;i++){
      const j=(i+1)%lower.length;
      face([[lower[i],lower[j],upper[j],upper[i]]],'sketch-side');
     }
    }
    face(raised,'sketch-top');
    if(references.length)face(references,'sketch-reference');
    for(const points of openReferences){
     const path=document.createElementNS(ns,'polyline');
     path.setAttribute('points',points.map(point=>point.join(',')).join(' '));
     path.setAttribute('class','sketch-reference sketch-open-reference');
     svg.append(path);
    }
    if(trimPanel.open&&!trimPanel.hidden&&trimStart.value&&trimEnd.value){
     try{
      const [ax,ay]=place(parsePoint(trimStart.value)),[bx,by]=place(parsePoint(trimEnd.value));
      const dx=bx-ax,dy=by-ay,length=Math.hypot(dx,dy);
      if(length>0){
       const range=Math.hypot(vw,vh)+Math.hypot(ax-minX,ay-minY)+length;
       const trim=document.createElementNS(ns,'line');
       trim.setAttribute('x1',String(ax-dx/length*range));trim.setAttribute('y1',String(ay-dy/length*range));
       trim.setAttribute('x2',String(ax+dx/length*range));trim.setAttribute('y2',String(ay+dy/length*range));
       trim.setAttribute('class','sketch-reference sketch-trim-line');svg.append(trim);
       const side=trimSide.value==='left'?1:-1,unitX=dx/length,unitY=dy/length;
       const middle=[(ax+bx)/2,(ay+by)/2],tip=[middle[0]+side*unitY*span*.11,middle[1]-side*unitX*span*.11];
       const back=[middle[0]+side*unitY*span*.065,middle[1]-side*unitX*span*.065];
       const arrow=document.createElementNS(ns,'path');
       arrow.setAttribute('d',`M ${middle.join(' ')} L ${tip.join(' ')} M ${back[0]-unitX*span*.025} ${back[1]-unitY*span*.025} L ${tip.join(' ')} L ${back[0]+unitX*span*.025} ${back[1]+unitY*span*.025}`);
       arrow.setAttribute('class','sketch-reference sketch-trim-side');svg.append(arrow);
      }
     }catch{/* Incomplete coordinate fields are validated by Trim draft. */}
    }

    if(axisLine.length){
     const line=document.createElementNS(ns,'line');
     line.setAttribute('x1',String(axisLine[0][0]));line.setAttribute('x2',String(axisLine[1][0]));
     line.setAttribute('y1',String(axisLine[0][1]));line.setAttribute('y2',String(axisLine[1][1]));
     line.setAttribute('class','sketch-reference sketch-revolution-axis');
     svg.append(line);
    }
    const handle=(x:number,y:number,mode:string,outlineHandle?:{loop:number;index:number})=>{
     if(linked)return;
     const hit=document.createElementNS(ns,'circle');
     hit.setAttribute('cx',String(x));hit.setAttribute('cy',String(y));
     hit.setAttribute('r',String(span*.065));hit.setAttribute('fill','transparent');
     hit.dataset.resize=mode;
     hit.style.cursor=mode==='vertex'||mode==='curve'?'move':mode==='depth'?'nesw-resize':'nwse-resize';
     if(outlineHandle){
      hit.dataset.loop=String(outlineHandle.loop);
      hit.dataset[mode==='curve'?'edge':'vertex']=String(outlineHandle.index);
     }
     const title=document.createElementNS(ns,'title');
     title.textContent=t(mode==='curve'?'Drag edge curve':mode==='vertex'?'Drag outline point':'Drag to change dimensions');hit.append(title);
     const dot=document.createElementNS(ns,'circle');
     dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));dot.setAttribute('r',String(span*.023));
     dot.classList.add('sketch-handle');if(mode==='curve')dot.classList.add('sketch-curve-handle');svg.append(dot,hit);
    };
    const numeric=(s:string)=>s.trim()!==''&&Number.isFinite(Number(s));
    const p=snapshot.sketch.profile;
    const outlines=p.kind==='outline'||p.kind==='region';
    if(p.kind==='circle'?numeric(radius.value):p.kind==='rectangle'&&numeric(width.value)&&numeric(depth.value)){
     const y=p.kind==='circle'?-(Math.min(...ys)+Math.max(...ys))/2:-Math.min(...ys);
     handle(Math.max(...xs)+topOffset*.45,y-topOffset*.35,'size');
    }
    const anchor=p.kind==='circle'?shape.contour[Math.floor(shape.contour.length/2)]:outlines?shape.contour[0]:[Math.min(...xs),Math.max(...ys)];
    if(!revolving&&numeric(length.value)){
     const offset=outlines?shape.start+d/2:topOffset;
     handle(anchor[0]+offset*.45,-anchor[1]-offset*.35,'depth');
    }
    const drawOutline=(outline:Extract<SketchProfile|SketchLoop,{kind:'outline'}>,loop:number)=>{
     const {points,bulges}=outline;
     const positioned=p.kind==='region'&&p.placements?.some(placement=>placement.target===outline.id&&!placement.targetEdge);
     points.forEach((point,index)=>{
      if(index===0&&positioned)return;
      const [x,y]=place(point);
      handle(x,y,'vertex',{loop,index});
     });
     if(!curveHandles.checked)return;
     points.forEach((a,index)=>{
      const b=points[(index+1)%points.length];
      const [x,y]=place(sketchBulgeMidpoint(a,b,bulges?.[index]??0));
      handle(x,y,'curve',{loop,index});
     });
    };
    if(p.kind==='outline')drawOutline(p,0);
    if(p.kind==='region')p.loops.forEach((loop,i)=>{if(loop.kind==='outline')drawOutline(loop,i);});
    dragOutline=p;
    if(drag?.target){
     const [x,y]=place(drag.target.point);
     if(drag.target.kind==='Tangent'){
      const [ax,ay]=place(drag.target.anchor);
      const line=document.createElementNS(ns,'line');
      line.setAttribute('x1',String(ax));line.setAttribute('y1',String(ay));
      line.setAttribute('x2',String(x));line.setAttribute('y2',String(y));
      line.setAttribute('class','sketch-reference sketch-tangent-guide');svg.append(line);
     }
     const marker=document.createElementNS(ns,'circle');
     marker.setAttribute('cx',String(x));marker.setAttribute('cy',String(y));marker.setAttribute('r',String(span*.04));
     marker.setAttribute('class','sketch-snap-marker');svg.append(marker);
     const snapLabel=element('output',t(drag.target.kind));
     snapLabel.className='sketch-snap-label';preview.append(snapLabel);
    }
    preview.prepend(svg);
    preview.append(element('output',shape.angle!==undefined?t`${w.toLocaleString()} × ${h.toLocaleString()} mm · ${shape.angle.toLocaleString()}° sweep`:t`${w.toLocaleString()} × ${h.toLocaleString()} mm · ${shape.distance.toLocaleString()} mm extrusion`));status.textContent='';valid=true;
   }catch(error){status.textContent=error instanceof Error&&'diagnostic' in error?(error as import('@brickwright/cad-core').FeatureEvaluationError).diagnostic.message:error instanceof Error?error.message:String(error);}apply.disabled=busy||!valid||!!drag||constraintPending();
  }
  preview.onpointerdown=event=>{
   const handle=(event.target as Element).closest<SVGElement>('[data-resize]'),svg=preview.querySelector('svg');
   if(!svg||busy||drag||event.button!==0||!svg.contains(event.target as Node))return;
   const matrix=svg.getScreenCTM();
   if(!matrix)return;
   const inverse=matrix.inverse(),start=new DOMPoint(event.clientX,event.clientY).matrixTransform(inverse);
   if(trimPicking){
    event.preventDefault();
    const step=snap()/(event.shiftKey?10:1);
    const round=(v:number)=>Number((step>0?Math.round(v/step)*step:v).toFixed(5));
    const coordinate=[round(start.x-previewDepth*.45),round(-start.y-previewDepth*.35)].join(', ');
    if(trimPicking===1){trimStart.value=coordinate;trimEnd.value='';setTrimPicking(2);}
    else{trimEnd.value=coordinate;setTrimPicking(0);}
    refreshDraft();
    return;
   }
   if(!handle)return;
   const mode=handle.dataset.resize!;
   let outlineEdit:OutlineEdit|undefined;
   if(mode==='vertex'||mode==='curve'){
    const loop=Number(handle.dataset.loop),index=Number(mode==='curve'?handle.dataset.edge:handle.dataset.vertex);
    const outline=dragOutline?.kind==='region'?dragOutline.loops[loop]:dragOutline;
    if(outline?.kind!=='outline'||!outline.points[index])return;
    const field=dragOutline?.kind==='region'?region:points;
    const targets=mode==='vertex'&&tangents.checked&&!tangents.disabled
     ?[...snapTargets,...collectTangentSnaps(outline,index,referenceGeometry)].sort((a,b)=>a.point[0]-b.point[0])
     :snapTargets;
    outlineEdit={field,original:field.value,loop,index,points:outline.points,bulges:outline.bulges,dxfWidths:outline.dxfWidths,targets};
   }
   event.preventDefault();
   drag={id:event.pointerId,x:start.x,y:start.y,w:Number(width.value),h:Number(depth.value),r:Number(radius.value),d:Number(length.value),inverse,kind:mode,viewBox:svg.getAttribute('viewBox')!,outlineEdit};
   preview.setPointerCapture(event.pointerId);
   apply.disabled=true;
  };
  preview.onpointermove=event=>{
   if(!drag||event.pointerId!==drag.id)return;
   event.preventDefault();
   const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(drag.inverse),dx=point.x-drag.x,dy=point.y-drag.y;
   const step=snap()/(event.shiftKey?10:1),round=(v:number)=>Number((step>0?Math.round(v/step)*step:v).toFixed(5));
   if(drag.outlineEdit){
    const edit=drag.outlineEdit,source=edit.points[edit.index];
    let rows:string[]|undefined;
    if(drag.kind==='curve'){
     const bulges=edit.bulges?.slice()??edit.points.map(()=>0);
     const current=bulges[edit.index];
     const next=sketchDraggedBulge(source,edit.points[(edit.index+1)%edit.points.length],current,[dx,-dy],step);
     if(next!==current){
      bulges[edit.index]=next;
      rows=formatPoints(edit.points,bulges,edit.dxfWidths);
     }
    }else{
     const candidate:SketchPoint=[source[0]+dx,source[1]-dy];
     const radius=event.pointerType==='touch'?16:10;
     const tolerance=radius*Math.hypot(drag.inverse.a,drag.inverse.b);
     drag.target=nearestSketchSnap(candidate,edit.targets,tolerance);
     const moved:SketchPoint=drag.target?.point??[round(candidate[0]),round(candidate[1])];
     if(moved[0]!==source[0]||moved[1]!==source[1]){
      const points=edit.points.slice();points[edit.index]=moved;
      rows=formatPoints(points,edit.bulges,edit.dxfWidths);
     }
    }
    if(!rows)edit.field.value=edit.original;
    else if(edit.field===region){
     const loops=edit.original.trim().split(/\r?\n/);loops[edit.loop]=rows.join(' | ');
     edit.field.value=loops.join('\n');
    }else edit.field.value=rows.join('\n');
   }else if(drag.kind==='depth'){
    const projectionScale=symmetric.checked ? .5 : 1;
    length.value=String(bounded(round(drag.d+(.45*dx-.35*dy)/(.45**2+.35**2)/projectionScale)));
   }else if(kind.value==='circle')radius.value=String(bounded(round(drag.r+dx)));
   else{width.value=String(bounded(round(drag.w+2*dx)));depth.value=String(bounded(round(drag.h+2*dy)));}
   draw();
  };
  const endDrag=(event:PointerEvent)=>{
   if(!drag||event.pointerId!==drag.id)return;
   draftRevision++;
   const {id,outlineEdit,kind}=drag;
   const restore=outlineEdit&&(event.type!=='pointerup'||!valid);
   const diagnostic=restore&&event.type==='pointerup'?status.textContent:null;
   if(restore)outlineEdit.field.value=outlineEdit.original;
   drag=undefined;
   if(preview.hasPointerCapture(id))preview.releasePointerCapture(id);
   draw();
   if(diagnostic)status.textContent=t(kind==='curve'?'Edge curve restored.':'Outline point restored.')+' '+diagnostic;
  };
  preview.onpointerup=preview.onpointercancel=preview.onlostpointercapture=endDrag;
  let draftRevision=0;
  const refreshDraft=()=>{draftRevision++;draw();};
  const constraintPending=()=>outlineConstraints.pending||regionConstraints.pending;
  const active=()=>!disposed&&dialog.open&&dialog.firstChild===header;
  const available=()=>!busy&&!drag&&session.state.revision===expected;
  const readLength=(value:FeatureScalar)=>{
   const length=featureValue(typeof value==='string'?scalar(value):value,doc);
   if(length<.01||length>100000)throw new Error(t('Dimension must be between 0.01 and 100000 mm'));
   return length;
  };
  const pending=(solving:boolean)=>{apply.disabled=solving||busy||!valid||!!drag;};
  const outlineConstraints=mountOutlineConstraintControls(form,dialog,{
   initial:profile?.kind==='outline'?profile:undefined,
   visible:()=>!linked&&kind.value==='outline',
   active,
   available,
   revision:()=>draftRevision,
   pending,
   read:()=>{
    const profile=definition();
    if(profile.kind!=='outline')throw new Error(t('Select an outline first.'));
    return profile;
   },
   readLength,
   apply:geometry=>{
    const snapshot=readForm(),{profile}=snapshot.sketch;
    if(profile.kind!=='outline')throw new Error(t('Select an outline first.'));
    const solved={...profile,...geometry};
    previewShape({...snapshot,sketch:{...snapshot.sketch,profile:solved}});
    replaceProfileDraft(solved);
    refreshDraft();
   }
  });
  const regionConstraints=mountRegionConstraintControls(form,dialog,{
   initial:regionLoops,
   visible:()=>!linked&&kind.value==='region',
   active,available,pending,readLength,
   revision:()=>draftRevision,
   read:()=>{
    const profile=definition();
    return profile.kind==='region'?profile.loops:[];
   },
   apply:(id,geometry)=>{
    const snapshot=readForm(),{profile}=snapshot.sketch;
    if(profile.kind!=='region')return;
    const solved={...profile,loops:profile.loops.map(loop=>loop.id===id?{...loop,...geometry}:loop)};
    previewShape({...snapshot,sketch:{...snapshot.sketch,profile:solved}});
    replaceProfileDraft(solved);
    refreshDraft();
   }
  });
  const regionPositions=mountRegionPositionControls(form,{
   initial:profile?.kind==='region'?profile.placements??[]:[],
   initialLoops:regionLoops,
   visible:()=>!linked&&kind.value==='region',
   available:()=>available()&&!constraintPending(),
   scalar,changed:refreshDraft,
   read:()=>{
    const profile=definition();
    return profile.kind==='region'?profile.loops:[];
   },
   apply:positions=>{
    const snapshot=readForm(false,positions);
    previewShape(snapshot);
    replaceProfileDraft(snapshot.sketch.profile);
   }
  });
  const hasDraftConstraints=(profile:SketchProfile)=>profile.kind==='outline'?outlineConstraints.hasConstraints
   :profile.kind==='region'&&(regionConstraints.hasConstraints||regionPositions.hasConstraints);
  form.addEventListener('input',refreshDraft);form.addEventListener('change',refreshDraft);
  trimApply.onclick=()=>{
   if(busy||drag||constraintPending())return;
   setTrimPicking(0);
   try{
    const snapshot=readForm();
    if(hasDraftConstraints(snapshot.sketch.profile))throw new Error(t('Clear outline constraints before trimming or offsetting.'));
    const profile=trimSketchProfile({version:1,id:'trim-preview',...snapshot.sketch},doc,
     parsePoint(trimStart.value),parsePoint(trimEnd.value),trimSide.value==='left'?'left':'right');
    previewShape({...snapshot,sketch:{...snapshot.sketch,profile}});
    replaceProfileDraft(profile);
    refreshDraft();
   }catch(error){
    status.textContent=error instanceof Error&&'diagnostic' in error?(error as import('@brickwright/cad-core').FeatureEvaluationError).diagnostic.message:error instanceof Error?error.message:String(error);
   }
  };

  if(!linked){
   const offsetPanel=element('details');
   offsetPanel.className='sketch-expressions';
   const offsetSummary=element('summary',t('Offset profile'));
   const offsetLabel=element('label',t('Offset distance (mm)'));
   const offsetInput=element('input');
   offsetInput.type='text';
   offsetInput.value='1';
   offsetLabel.append(offsetInput);
   const offsetButton=element('button',t('Apply offset to draft'));
   offsetButton.type='button';
   offsetPanel.append(offsetSummary,offsetLabel,offsetButton,
    element('p',t('Positive grows the outside and shrinks holes. Negative does the reverse. Outlines with arcs use rounded corners where edges move apart.')));
   form.append(offsetPanel);
   offsetButton.onclick=async()=>{
    if(busy||drag||constraintPending())return;
    const ticket=epoch,revision=draftRevision;
    const active=()=>!disposed&&ticket===epoch&&dialog.open;
    busy=true;
    apply.disabled=offsetButton.disabled=true;
    status.textContent='';
    let message='';
    try{
     const snapshot=readForm();
     if(hasDraftConstraints(snapshot.sketch.profile))throw new Error(t('Clear outline constraints before trimming or offsetting.'));
     const shifted=await offsetSketch({version:1,id:'offset-preview',...snapshot.sketch},
      {parametric:doc.parametric},featureValue(scalar(offsetInput.value),doc));
     if(!active())return;
     if(revision!==draftRevision||expected!==session.state.revision)throw new Error(t('The sketch changed during the offset. Apply the offset again.'));
     previewShape({...snapshot,sketch:{...snapshot.sketch,profile:shifted}});
     replaceProfileDraft(shifted);
     draftRevision++;
    }catch(error){
     message=error instanceof Error&&'diagnostic' in error?(error as import('@brickwright/cad-core').FeatureEvaluationError).diagnostic.message:error instanceof Error?error.message:String(error);
    }finally{
     busy=false;
     if(active()){
      offsetButton.disabled=false;
      draw();
      if(message)status.textContent=message;
     }
    }
   };
  }
  const apply=element('button',t(featureId?'Apply sketch changes':revolving?'Create revolution':'Create extrusion'));apply.className='primary';
  apply.onclick=async()=>{if(busy||constraintPending())return;const ticket=epoch;busy=true;apply.disabled=true;try{
   const snapshot=readForm(true);
   if(session.state.revision!==expected)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
   const candidate=draft(snapshot);const geometry=await evaluate(candidate.document);const created=geometry.bodies.find(body=>body.id===candidate.id);if(disposed||epoch!==ticket||!dialog.open)return;
   if(session.state.revision!==expected)throw new Error(t('The model changed while checking geometry. Close and reopen this dialog.'));
   if(!featureId&&(!created||created.volume<=0))throw new Error(t('The profile must produce a solid with positive volume.'));
   applyDraft(session,snapshot,[0,0,-(created?.bounds.min[2]??0)]);
   dialog.close();await afterApply();
  }catch(error){if(!disposed)status.textContent=error instanceof Error&&'diagnostic' in error?(error as import('@brickwright/cad-core').FeatureEvaluationError).diagnostic.message:error instanceof Error?error.message:String(error);}finally{busy=false;apply.disabled=!valid;}};
  if(!existing){
   const importPanel=element('details');
   importPanel.className='sketch-expressions';
   importPanel.append(element('summary',t('Import DXF or DWG outline')));
   const active=()=>!disposed&&dialog.open&&dialog.firstChild===header;
   let blockedBeforeRead=false;
   mountDxfImportControls(importPanel,{
    active,available:()=>!busy&&!drag&&!constraintPending(),revision:()=>draftRevision,
    checkCurrent:()=>{
     if(session.state.revision!==expected)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
    },
    readState:reading=>{
     if(reading)blockedBeforeRead=apply.disabled;
     busy=reading;
     if(active())apply.disabled=reading||blockedBeforeRead||!valid;
    },
    read:(drawing,assumeMm,layers)=>drawing.outline(assumeMm,layers),
    imported:(imported,fileName)=>{
     if(outlineConstraints.hasConstraints||regionConstraints.hasConstraints||regionPositions.hasConstraints)throw new Error(t('Clear outline constraints before importing another profile.'));
     const id='dxf-preview';
     evaluateExtrusion({kind:'extrusion',featureVersion:1,id,sketchId:id,distance:1,symmetric:false},{
      ...doc,sketches:{[id]:{version:1,id,name:'DXF',plane:'XY',profile:imported}}
     });
     kind.value=imported.kind;
     singleDxfLayer=sketchDxfLayerFields(imported.kind==='outline'||imported.kind==='circle'?imported:undefined);
     if(imported.kind==='region'){
      regionVertexIds.clear();
      regionLoops=imported.loops;
      region.value=formatLoops(regionLoops);
     }
     if(imported.kind==='outline')points.value=formatPoints(imported.points,imported.bulges,imported.dxfWidths).join('\n');
     if(imported.kind==='circle'){
      radius.value=String(imported.radius);
      center.value=imported.center?.join(', ')??'0, 0';
     }
     name.value=fileName||t('Sketch');
     draftRevision++;
     updateGuides();draw();
    },
    error:error=>{
     blockedBeforeRead=true;
     status.textContent=error instanceof Error?error.message:String(error);
     apply.disabled=true;
    }
   });
   form.append(importPanel);
  }
  const footer=element('footer');footer.append(status,apply);const body=element('div');body.className='sketch-body';const expressions=element('details');expressions.className='sketch-expressions';const summary=element('summary',t('Dimension expressions'));summary.title=t('Dimension expressions');summary.setAttribute('aria-label',t('Dimension expressions'));expressions.append(summary,help);form.append(expressions);const drawing=element('div');drawing.append(preview);if(!linked)drawing.append(hint);body.append(drawing,form);dialog.append(header,infoPanel,body,footer);draw();dialog.showModal();
 }
 dialog.addEventListener('keydown',e=>e.stopPropagation());
 return {open,openRevolution(sketchId?:string){open(undefined,{sketchId,revolve:true});},openExtrusion(sketchId:string){open(undefined,{sketchId,revolve:false});},dispose(){disposed=true;dialog.close();dialog.remove();}};
}
