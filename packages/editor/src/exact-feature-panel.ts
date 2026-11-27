// SPDX-License-Identifier: BSD-3-Clause
// Fillet, chamfer and shell on the exact B-rep kernel. The dialog builds the same command the
// terminal accepts (`fillet 2 <id> --face +z`, `fillet 2 <id> edges <reference> ...`), so
// validation, the kernel round trip and the single recorded commit are shared with the terminal,
// MCP and CLI. "Chosen edges" asks the exact kernel for the body's edges and shows them in a
// tap-to-pick drawing (edge-picker.ts).
import {commandNumber,editExactFeatureWithKernel,formatEdgeReference,isEdgeReferences,parseExactFeatureCommand,parseFaceNormal,runExactFeatureCommand,t} from '@brickwright/cad-core';
import type {CadSession,ExactCommandHost,ExactEdgeReference,ExactFaceSelector,ExactFeatureOperation,Vec3} from '@brickwright/cad-core';
import {operationField} from './body-operation-panel.js';
import {createEdgePicker} from './edge-picker.js';

const faces:readonly {key:string;label:string;normal:Vec3}[]=[
 {key:'+z',label:'Top (+Z)',normal:[0,0,1]},{key:'-z',label:'Bottom (−Z)',normal:[0,0,-1]},
 {key:'+x',label:'Right (+X)',normal:[1,0,0]},{key:'-x',label:'Left (−X)',normal:[-1,0,0]},
 {key:'+y',label:'Back (+Y)',normal:[0,1,0]},{key:'-y',label:'Front (−Y)',normal:[0,-1,0]},
];
const faceKey=(selector:ExactFaceSelector|undefined)=>selector&&!('faceNormal' in selector)?undefined:faces.find(face=>selector&&face.normal.every((v,i)=>Math.abs(v-selector.faceNormal[i])<1e-9))?.key;

export function mountExactFeaturePanel(parent:HTMLElement,session:CadSession,exact:()=>ExactCommandHost|undefined,afterApply:()=>Promise<unknown>){
 const dialog=document.createElement('dialog');
 dialog.className='sketch-dialog body-operation-dialog exact-feature-dialog';
 parent.append(dialog);
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 let epoch=0,controller:AbortController|undefined;
 dialog.addEventListener('close',()=>{epoch++;controller?.abort();});

 /** `id`: a top-level body (new feature) or, with `edit`, an exact feature to change. */
 function open(id:string,edit=false){
  const doc=session.state.document,node=doc.nodes[id],revision=session.state.revision;
  if(edit?node?.kind!=='exact-feature':!node||node.reference||!doc.roots.includes(id))throw new Error(t('Select a top-level body for the exact feature'));
  const previous=edit&&node.kind==='exact-feature'?node:undefined,ticket=++epoch;
  const title=t(previous?'Edit exact feature':'Fillet, chamfer or shell');
  dialog.setAttribute('aria-label',title);
  dialog.replaceChildren();
  const header=document.createElement('header'),heading=document.createElement('h2'),close=document.createElement('button');
  heading.textContent=title;close.textContent='×';close.setAttribute('aria-label',t('Close exact feature'));close.onclick=()=>dialog.close();
  header.append(heading,close);

  const operation=document.createElement('select');
  for(const [value,label] of [['fillet',t('Fillet (round edges)')],['chamfer',t('Chamfer (bevel edges)')],['shell',t('Shell (hollow with open faces)')]]){
   const option=document.createElement('option');option.value=value;option.textContent=label;operation.append(option);
  }
  operation.value=previous?.operation??'fillet';
  const size=document.createElement('input');size.type='number';size.min='0.01';size.step='any';
  size.value=String(typeof previous?.size==='number'?previous.size:previous?.size??1);
  const edges=document.createElement('select');
  for(const [value,label] of [['all',t('All edges')],...faces.map(face=>[face.key,t`Edges of the ${t(face.label)} face`]),['chosen',t('Chosen edges (tap to pick)')]]){
   const option=document.createElement('option');option.value=value;option.textContent=label;edges.append(option);
  }
  const previousReferences=previous&&isEdgeReferences(previous.edges)?previous.edges.references:undefined;
  edges.value=previousReferences?'chosen':previous?.edges&&previous.edges!=='all'&&!isEdgeReferences(previous.edges)?faceKey(previous.edges as ExactFaceSelector)??'all':'all';
  // Chosen edges: listed by the exact kernel on the body the feature rounds (its source when editing).
  const picker=createEdgePicker(),pickerStatus=document.createElement('p');
  pickerStatus.className='parameter-status';pickerStatus.setAttribute('role','status');
  const pickerBox=document.createElement('div');pickerBox.className='edge-picker-box';pickerBox.append(pickerStatus,picker.element);
  const body=previous?previous.source:id;
  let loaded:Promise<void>|undefined;
  const loadEdges=()=>loaded??=(async()=>{
   const host=exact();
   if(!host)throw new Error(t('The exact kernel is not available in this host.'));
   pickerStatus.textContent=t('Listing the edges on the exact kernel…');
   const result=await host.run({operation:'edges',document:session.state.document,bodies:[body]});
   if(result.operation!=='edges')throw new Error(t('The exact kernel returned an unexpected result.'));
   if(epoch!==ticket)return;
   pickerStatus.textContent='';
   picker.show(result.bodies[0]?.edges??[],previousReferences);
  })().catch(error=>{loaded=undefined;if(epoch===ticket)pickerStatus.textContent=error instanceof Error?error.message:String(error);});
  const open=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=t('Open faces');open.append(legend);
  const checks=faces.map(face=>{
   const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=face.key;
   box.checked=previous?.openFaces?previous.openFaces.some(selector=>faceKey(selector)===face.key):face.key==='+z';
   label.append(box,document.createTextNode(' '+t(face.label)));open.append(label);return box;
  });
  const sizeField=operationField(t('Radius (mm)'),size),edgeField=operationField(t('Edges'),edges);
  const sync=()=>{
   const shell=operation.value==='shell';
   sizeField.label.querySelector('span')!.textContent=operation.value==='fillet'?t('Radius (mm)'):operation.value==='chamfer'?t('Distance (mm)'):t('Wall thickness (mm)');
   edgeField.label.hidden=shell;open.hidden=!shell;
   pickerBox.hidden=shell||edges.value!=='chosen';
   if(!pickerBox.hidden)void loadEdges();
  };
  edges.onchange=sync;
  operation.onchange=sync;
  const fields=document.createElement('div');fields.className='sketch-fields';
  fields.append(operationField(t('Operation'),operation).label,sizeField.label,edgeField.label,open);
  sync();

  const form=document.createElement('form'),hint=document.createElement('p'),footer=document.createElement('footer'),status=document.createElement('p'),apply=document.createElement('button'),cancel=document.createElement('button');
  hint.textContent=t('Built exactly by the B-rep kernel (loaded on first use). A face is chosen by its outward normal; the outermost matching face is used. The source stays editable under Inputs.');
  status.className='parameter-status';status.setAttribute('role','status');
  apply.type='submit';apply.className='primary';apply.textContent=t(previous?'Apply exact feature changes':'Apply exact feature');
  // Cancel stops the exact worker (see geometry-client): nothing is committed until the kernel answers.
  cancel.type='button';cancel.textContent=t('Cancel');cancel.hidden=true;cancel.title=t('Stop the exact kernel. The model is not changed.');
  cancel.onclick=()=>controller?.abort();
  footer.append(status,cancel,apply);form.append(hint,fields,pickerBox,footer);dialog.append(header,form);
  form.onsubmit=async event=>{
   event.preventDefault();
   if(apply.disabled)return;
   apply.disabled=true;status.textContent=t('Running on the exact kernel…');
   controller=new AbortController();cancel.hidden=false;
   const started=Date.now(),elapsed=setInterval(()=>{if(epoch===ticket)status.textContent=t`Running on the exact kernel… ${Math.floor((Date.now()-started)/1000)} s`;},1000);
   try{
    const host=exact();
    if(!host)throw new Error(t('The exact kernel is not available in this host.'));
    if(session.state.revision!==revision)throw new Error(t('The model changed. Close and reopen this dialog before applying.'));
    const op=operation.value as ExactFeatureOperation,opened=checks.filter(box=>box.checked).map(box=>box.value);
    const chosen:ExactEdgeReference[]=op!=='shell'&&edges.value==='chosen'?picker.selected():[];
    if(op!=='shell'&&edges.value==='chosen'&&!chosen.length)throw new Error(t('Tap at least one edge to round or bevel.'));
    const options=op==='shell'?opened.map(key=>` --open ${key}`).join(''):edges.value==='all'?'':edges.value==='chosen'?` edges ${chosen.map(formatEdgeReference).join(' ')}`:` --face ${edges.value}`;
    if(previous){
     const value=commandNumber(size.value),face=(key:string)=>({faceNormal:parseFaceNormal(key),outermost:true as const});
     await editExactFeatureWithKernel(session,host,id,op==='shell'?{operation:op,size:value,openFaces:opened.map(face)}:{operation:op,size:value,edges:edges.value==='all'?'all':edges.value==='chosen'?{references:chosen}:face(edges.value)},{signal:controller.signal});
    }else await runExactFeatureCommand(session,host,parseExactFeatureCommand(session,op,`${size.value} ${id}${options}`),{signal:controller.signal});
    if(!dialog.open||epoch!==ticket)return;
    dialog.close();
    await afterApply();
   }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(dialog.open&&epoch===ticket)status.textContent=controller?.signal.aborted?t('Cancelled. The model was not changed.'):message;
   }finally{clearInterval(elapsed);apply.disabled=false;cancel.hidden=true;}
  };
  dialog.showModal();
 }
 return {open,dispose(){epoch++;controller?.abort();dialog.close();dialog.remove();}};
}

