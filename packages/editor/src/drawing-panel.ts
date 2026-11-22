// SPDX-License-Identifier: BSD-3-Clause
import {drawingAssemblyAvailable,isAssemblyDrawingSource,drawingAnnotationLimit,drawingScales,drawingSourceFor,evaluateExtrusion,isDrawingVertex,newId,resolveDrawingSource,t,validDrawingPosition} from '@brickwright/cad-core';
import type {CadSession,DrawingAnnotation,DrawingDimensionKind,DrawingInputs,DrawingScale,SketchPoint} from '@brickwright/cad-core';
import type {AssemblyProjection} from './assembly-drawing.js';
import type {CadFile} from './index.js';
import {mountAssemblyEdgeControls} from './assembly-edge-controls.js';
import {layoutDrawingPages} from './drawing-layout.js';
import type {DrawingLayout} from './drawing-layout.js';
import {drawingArcPoints,placeDrawingAnnotation} from './drawing-annotation.js';
import {operationScalar} from './body-operation-panel.js';
import {exportDrawingPdf} from './drawing-pdf.js';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{
 const el=document.createElement(tag);
 if(text!==undefined)el.textContent=text;
 return el;
};

function previewDrawing(layout:DrawingLayout,assembly:boolean) {
 const ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);
 svg.setAttribute('aria-label',t('Drawing preview'));
 svg.setAttribute('role','img');
 const addPath=(stroke:string,d:string)=>{
  const path=document.createElementNS(ns,'path');
  path.setAttribute('d',d);
  path.setAttribute('class','drawing-'+stroke);
  svg.append(path);
 };
 const projected=new Map<string,string[]>();
 for(const {points,stroke,closed} of layout.paths){
  const d=points.map(([x,y],i)=>(i?'L ':'M ')+x+' '+(layout.height-y)).join(' ')+(closed?' Z':'');
  if(assembly&&(stroke==='visible'||stroke==='hidden')){
   const group=projected.get(stroke);
   if(group)group.push(d);
   else projected.set(stroke,[d]);
  }else addPath(stroke,d);
 }
 for(const [stroke,paths] of projected)addPath(stroke,paths.join(' '));
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

export function mountDrawingPanel(parent:HTMLElement,session:CadSession,projectAssembly:(sheets:readonly DrawingInputs[])=>Promise<AssemblyProjection|undefined>,onExport?: (file:CadFile)=>void|Promise<void>){
 const dialog=element('dialog');dialog.className='sketch-dialog drawing-dialog';
 dialog.setAttribute('aria-label',t('Drawing sheet'));parent.append(dialog);
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 let refresh:(()=>void)|undefined;
 const unsubscribe=session.subscribe(()=>{if(dialog.open)refresh?.();});
 return {
  open(options:{featureId:string}|{sheetId:string}|{assembly:true}){
   const doc=session.state.document;
   const saved='sheetId' in options?doc.drawings?.find(sheet=>sheet.id===options.sheetId):undefined;
   const initial='featureId' in options?drawingSourceFor(doc,options.featureId):saved?.source;
   const assembly='assembly' in options||isAssemblyDrawingSource(initial);
   const part=isAssemblyDrawingSource(initial)?undefined:initial;
   if(!assembly&&!part)throw new Error(t('Choose an available drawing source.'));
   dialog.replaceChildren();
   const name=assembly?doc.title:doc.sketches?.[part!.sketchId]?.name??t('Drawing sheet');
   const title=element('input');title.maxLength=80;title.value=saved?.title??name.trim().slice(0,80);
   const source=element('select');
   const scale=element('select');
   for(const ratio of drawingScales)scale.add(new Option(ratio,ratio));
   scale.value=saved?.scale??(assembly?'1:2':'1:1');
   const hidden=element('input');hidden.type='checkbox';hidden.checked=saved?.hiddenLines??true;
   const form=element('div');form.className='drawing-form';
   const label=(text:string,control:HTMLInputElement|HTMLSelectElement,parent:HTMLElement=form)=>{
    control.setAttribute('aria-label',t(text));
    const field=element('label',t(text));field.append(control);parent.append(field);
   };
   label('Sheet title',title);if(!assembly)label('Drawing source',source);label('Drawing scale',scale);label('Show hidden lines',hidden);
   const partsList=element('input'),previewPage=element('select');
   partsList.type='checkbox';partsList.checked=saved?.partsList??false;
   if(assembly){
    label('Include parts list',partsList);
    label('Preview page',previewPage);
    previewPage.parentElement!.hidden=true;
   }
   const section=element('input');section.type='checkbox';section.checked=!!saved?.section;section.disabled=assembly&&!saved?.section;
   const axis=element('select');
   axis.add(new Option(assembly?t('World X'):t('Sketch X'),'u'));
   axis.add(new Option(assembly?t('World Y'):t('Sketch Y'),'v'));
   axis.value=saved?.section?.axis??'v';
   const position=element('input');position.type='text';position.maxLength=160;
   position.value=String(saved?.section?.position??'0');
   label('Show section A-A',section);
   label('Section axis',axis);label('Section position (mm)',position);
   const offset=element('input');offset.type='checkbox';offset.checked=!!saved?.section?.jog;
   const secondPosition=element('input'),jogAt=element('input');
   secondPosition.maxLength=jogAt.maxLength=160;
   secondPosition.value=String(saved?.section?.jog?.position??'');
   jogAt.value=String(saved?.section?.jog?.at??'');
   label('Offset section',offset);
   label('Second section position (mm)',secondPosition);
   label('Jog at (mm)',jogAt);
   const jogHint=element('small');
   form.append(jogHint);
   const annotations=structuredClone(saved?.annotations??[]),edgeDimensions=structuredClone(saved?.edgeDimensions??[]);
   const edgePanel=element('details');edgePanel.className='drawing-dimensions';
   const dimensions=element('details');dimensions.className='drawing-dimensions';
   dimensions.append(element('summary',t('Drawing dimensions')));
   const labels:Record<DrawingDimensionKind,string>={
    'linear-x':t('Horizontal dimension'),'linear-y':t('Vertical dimension'),
    aligned:t('Aligned dimension'),diameter:t('Diameter dimension'),
    radius:t('Radius dimension'),'arc-length':t('Arc length dimension')
   };
   const kind=element('select');
   for(const [value,name] of Object.entries(labels))kind.add(new Option(name,value));
   const from=element('select'),to=element('select');
   const paperX=element('input'),paperY=element('input');
   for(const input of [paperX,paperY]){input.type='number';input.step='.1';}
   paperX.value='70';paperY.value='120';
   label('Dimension type',kind,dimensions);
   label('First dimension anchor',from,dimensions);label('Second dimension anchor',to,dimensions);
   label('Paper X (mm)',paperX,dimensions);label('Paper Y (mm)',paperY,dimensions);
   const pick=element('button',t('Pick dimension position'));
   const add=element('button',t('Add dimension'));
   const list=element('ul');list.className='drawing-dimension-list';
   dimensions.append(pick,add,list);form.append(assembly?edgePanel:dimensions);
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
   let choice=part?.featureId??'',lastRevision=-1,renderTicket=0;
   const listSources=()=>{
    if(!part)return;
    const current=session.state.document;
    const valid=Object.values(current.nodes).flatMap(node=>{
     const ref=drawingSourceFor(current,node.id);
     return ref?[{ref,name:current.sketches![ref.sketchId].name+' · '+node.name}]:[];
    });
    source.replaceChildren(...valid.map(({ref,name})=>new Option(name,ref.featureId)));
    const initialMissing=choice===part.featureId&&!resolveDrawingSource(current,part);
    if(initialMissing||!valid.some(item=>item.ref.featureId===choice)){
     source.add(new Option(t('Unavailable drawing source'),''),0);source.value='';
    }else source.value=choice;
   };
   let centerAutomatically=!saved?.section;
   let assemblyBounds:AssemblyProjection|undefined;
   const centerCut=()=>{
    if(assembly){
     if(!assemblyBounds)return;
     const coordinate=axis.value==='u'?0:1;
     const top=assemblyBounds.views[0];
     const span=coordinate===0?top.width:top.height;
     position.value=String(Number((assemblyBounds.origin[coordinate]+span/2).toFixed(6)));
     return;
    }
    const current=session.state.document,ref=drawingSourceFor(current,source.value);
    if(!ref)return;
    const resolved=resolveDrawingSource(current,ref)!;
    const coordinate=axis.value==='u'?0:1;
    const values=evaluateExtrusion(resolved.node,current).contour.map(point=>point[coordinate]);
    position.value=String(Number(((Math.min(...values)+Math.max(...values))/2).toFixed(6)));
   };
   const read=():DrawingInputs=>{
    const current=session.state.document;
    if(!title.value.trim())throw new Error(t('Enter a drawing sheet title.'));
    const settings={title:title.value.trim(),scale:scale.value as DrawingScale,hiddenLines:hidden.checked};
    const cut=operationScalar(position),second=operationScalar(secondPosition),at=operationScalar(jogAt);
    if(section.checked&&cut==='')throw new Error(t('Enter a section position in millimetres.'));
    const useJog=section.checked&&offset.checked;
    if(useJog&&(second===''||at===''))throw new Error(t('Enter the second section position and the jog coordinate.'));
    const cuttingPlane=section.checked?{section:{axis:axis.value==='u'?'u' as const:'v' as const,position:cut,...(useJog?{jog:{at,position:second}}:{})}}:{};
    if(assembly){
     if(!drawingAssemblyAvailable(current))throw new Error(t('Add a solid body to draw the assembly.'));
     return {...settings,source:{kind:'assembly'},...cuttingPlane,...(partsList.checked?{partsList:true}:{}),
      ...(edgeDimensions.length?{edgeDimensions}:{})};
    }
    const ref=drawingSourceFor(current,source.value);
    if(!ref)throw new Error(t('Drawing source unavailable. Choose another sketch extrusion.'));
    return {...settings,source:ref,...cuttingPlane,
     ...(annotations.length?{annotations}:{})};
   };
   let layout:DrawingLayout|undefined,pages:DrawingLayout[]=[];
   const showPreview=()=>{
    const index=Number(previewPage.value),page=pages[index];
    preview.replaceChildren();
    if(page)preview.append(previewDrawing(page,assembly&&index===0));
   };
   previewPage.onchange=()=>{edgeControls?.reset();showPreview();};
   let picking=false,editing:string|undefined;
   const setPicking=(active:boolean)=>{
    picking=active;
    preview.classList.toggle('picking',active);
    pick.setAttribute('aria-pressed',String(active));
   };
   const singleAnchor=()=>['diameter','radius','arc-length'].includes(kind.value);
   const highlightAnchors=()=>{
    const svg=preview.querySelector('svg');
    svg?.querySelectorAll('.drawing-vertex-marker,.drawing-arc-marker').forEach(marker=>marker.remove());
    if(!dimensions.open||!svg||!layout)return;
    const selected=new Set([from.value,singleAnchor()?'':to.value]);
    for(const anchor of layout.anchors){
     if(!selected.has(anchor.id))continue;
     if(anchor.arc&&anchor.radius!==undefined){
      const arc=drawingArcPoints(anchor.point,anchor.radius*layout.factor,anchor.arc.start,anchor.arc.sweep);
      const marker=document.createElementNS(svg.namespaceURI,'path');
      marker.setAttribute('class','drawing-arc-marker');
      marker.setAttribute('d',arc.map(([x,y],i)=>(i?'L ':'M ')+x+' '+(layout!.height-y)).join(' '));
      svg.append(marker);
      continue;
     }
     if(!isDrawingVertex(anchor.id))continue;
     const [x,y]=anchor.point,row=layout.height-y;
     const marker=document.createElementNS(svg.namespaceURI,'path');
     marker.setAttribute('class','drawing-vertex-marker');
     marker.setAttribute('d',`M ${x-1.7} ${row} L ${x} ${row-1.7} L ${x+1.7} ${row} L ${x} ${row+1.7} Z`);
     svg.append(marker);
    }
   };
   const refreshDimensions=()=>{
    const curved=singleAnchor();
    const anchors=layout?.anchors??[];
    const previousFrom=from.value,previousTo=to.value;
    const points=anchors.filter(anchor=>!anchor.arc);
    const eligible=kind.value==='arc-length'?anchors.filter(anchor=>anchor.arc)
     :kind.value==='radius'?anchors.filter(anchor=>anchor.radius!==undefined)
     :kind.value==='diameter'?points.filter(anchor=>anchor.radius!==undefined):points;
    from.replaceChildren(...eligible.map(anchor=>new Option(anchor.label,anchor.id)));
    to.replaceChildren(...points.map(anchor=>new Option(anchor.label,anchor.id)));
    if([...from.options].some(option=>option.value===previousFrom))from.value=previousFrom;
    if([...to.options].some(option=>option.value===previousTo))to.value=previousTo;
    else if(to.options.length>1)to.selectedIndex=1;
    to.parentElement!.hidden=curved;
    add.disabled=!layout||!from.options.length||(!editing&&annotations.length>=drawingAnnotationLimit);
    add.textContent=t(editing?'Apply dimension':'Add dimension');
    pick.disabled=!layout;
    list.replaceChildren();
    for(const [i,item] of annotations.entries()){
     const row=element('li');
     const invalid=layout?.annotationIssues.includes(item.id);
     const edit=element('button',t`Edit dimension ${i+1}`);
     edit.title=labels[item.kind];
     const remove=element('button','×');
     remove.setAttribute('aria-label',t`Remove dimension ${i+1}`);
     if(invalid)row.append(element('small',t('Anchor unavailable')));
     edit.onclick=()=>{
      editing=item.id;kind.value=item.kind;refreshDimensions();
      from.value=item.from;to.value=item.to??'';
      paperX.value=String(item.at[0]);paperY.value=String(item.at[1]);
      highlightAnchors();
     };
     remove.onclick=()=>{
      annotations.splice(i,1);
      if(editing===item.id)editing=undefined;
      render();
     };
     row.append(edit,remove);list.append(row);
    }
    highlightAnchors();
   };
   const render=()=>{
    edgeControls?.reset();
    axis.parentElement!.hidden=position.parentElement!.hidden=!section.checked;
    offset.parentElement!.hidden=!section.checked;
    secondPosition.parentElement!.hidden=jogAt.parentElement!.hidden=jogHint.hidden=!section.checked||!offset.checked;
    const across=assembly?(axis.value==='u'?t('World Y'):t('World X')):(axis.value==='u'?t('Sketch Y'):t('Sketch X'));
    jogHint.textContent=t`The jog switches to the second cut at this coordinate along ${across}.`;
    preview.replaceChildren();layout=undefined;pages=[];status.textContent='';
    edgeControls?.refresh();
    previewPage.disabled=true;
    save.disabled=pdf.disabled=true;
    const ticket=++renderTicket,current=session.state.document;
    const show=(draft:DrawingInputs,projection?:AssemblyProjection)=>{
     if(projection){
      assemblyBounds=projection;
      section.disabled=false;
      if(centerAutomatically&&!draft.section)centerCut();
     }
     pages=layoutDrawingPages(current,draft,projection);
     layout=pages[0];
     if(assembly){
      const selection=Number(previewPage.value);
      previewPage.replaceChildren(new Option(t('Drawing views'),'0'),
       ...pages.slice(1).map((_,index)=>new Option(t`Parts list ${index+1} of ${pages.length-1}`,String(index+1))));
      previewPage.value=String(selection<pages.length?selection:0);
      previewPage.parentElement!.hidden=pages.length<2;
      previewPage.disabled=false;
     }
     showPreview();
     edgeControls?.refresh();
     save.disabled=false;
     pdf.disabled=!!layout.annotationIssues.length;
     status.textContent=layout.annotationIssues.length?t('Repair or remove unavailable drawing dimensions before exporting.'):'';
    };
    const report=(error:unknown)=>{status.textContent=error instanceof Error?error.message:String(error);};
    try{
     const draft=read();
     if(assembly){
      status.textContent=t('Projecting assembly…');
      const active=()=>dialog.open&&dialog.firstChild===heading&&ticket===renderTicket&&session.state.document===current;
      void projectAssembly([draft]).then(projection=>{if(active()&&projection)show(draft,projection);}).catch(error=>{if(active())report(error);});
     }else show(draft);
    }catch(error){report(error);}
    if(!assembly)refreshDimensions();
    if(!layout&&picking)setPicking(false);
   };
   kind.onchange=refreshDimensions;
   from.onchange=to.onchange=dimensions.ontoggle=highlightAnchors;
   add.onclick=()=>{
    if(!layout)return;
    const at:SketchPoint=[Number(paperX.value),Number(paperY.value)];
    if(!validDrawingPosition(...at)){
     status.textContent=t('Pick a position inside the drawing area.');
     return;
    }
    const source=read().source;
    if(isAssemblyDrawingSource(source))return;
    const next:DrawingAnnotation={id:editing??newId(),sketchId:source.sketchId,
     kind:kind.value as DrawingDimensionKind,from:from.value,at,
     ...(singleAnchor()?{}:{to:to.value})};
    if(!placeDrawingAnnotation(next,source.sketchId,layout.anchors,layout.factor)){
     status.textContent=singleAnchor()?t('Choose an available curve.')
      :next.kind==='aligned'?t('Choose two anchors at different positions.')
      :t('Choose anchors that have a measurable distance along the selected axis.');
     return;
    }
    if(editing)annotations[annotations.findIndex(item=>item.id===editing)]=next;
    else annotations.push(next);
    editing=undefined;
    setPicking(false);render();
   };
   pick.onclick=()=>{
    setPicking(!picking);
    if(picking)status.textContent=t('Click or tap the sheet to choose the dimension position.');
    else render();
   };
   preview.onpointerup=event=>{
    if(!picking||!layout||event.button!==0)return;
    const matrix=preview.querySelector('svg')?.getScreenCTM();
    if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    const x=Number(point.x.toFixed(2)),y=Number((layout.height-point.y).toFixed(2));
    if(!validDrawingPosition(x,y)){
     status.textContent=t('Pick a position inside the drawing area.');
     return;
    }
    paperX.value=String(x);paperY.value=String(y);setPicking(false);render();
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
   section.onchange=offset.onchange=render;
   secondPosition.oninput=jogAt.oninput=render;
   title.oninput=scale.onchange=hidden.onchange=partsList.onchange=render;
   save.onclick=()=>{
    try{session.saveDrawingSheet(read(),saved?.id);dialog.close();}
    catch(error){status.textContent=error instanceof Error?error.message:String(error);}
   };
   remove.onclick=()=>{if(saved){session.removeDrawingSheet(saved.id);if(dialog.open)dialog.close();}};
   pdf.onclick=async()=>{
    if(!layout||layout.annotationIssues.length||!onExport)return;
    pdf.disabled=true;
    try{await onExport(exportDrawingPdf(layout,read().title,pages.slice(1)));}
    catch(error){if(dialog.open)status.textContent=error instanceof Error?error.message:String(error);}
    finally{pdf.disabled=!layout||!!layout.annotationIssues.length;}
   };
   const edgeControls=assembly?mountAssemblyEdgeControls(edgePanel,preview,status,edgeDimensions,
    ()=>session.state.document,()=>layout,()=>{previewPage.value='0';showPreview();},render):undefined;
   setPicking(false);refresh();dialog.showModal();
  },
  dispose(){unsubscribe();dialog.close();dialog.remove();}
 };
}
