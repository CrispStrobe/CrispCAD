// SPDX-License-Identifier: BSD-3-Clause
import {t,codeExamples,codeExampleProgram,importOpenSCAD,getOpenSCADImportWarnings,importJSCAD,exportOpenSCAD,exportJSCAD,exportCodeSource,getLocale,compileCode,createCadSession,defaultCodeProgram,CadCodeError,pruneDocument,CAD_SCRIPT_REVISION,hasTriangulatedLofts} from '@brickwright/cad-core';
import type {CadSession,CodeProgram,CadDocument} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
import {evaluatedPreview} from './shapes.js';
import {createCodeWorkspaceStore,codeParameterCompletions} from './code-workspace-state.js';
import type {CodeWorkspaceStorage} from './code-workspace-state.js';
import {codeWorkspaceStyle} from './code-workspace-style.js';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const sameProgram=(a:CodeProgram|undefined,b:CodeProgram|undefined)=>JSON.stringify(a)===JSON.stringify(b);
let nextPanelId=0;
export function mountCodePanel(parent:HTMLElement,session:CadSession,evaluate:(doc:CadDocument)=>Promise<GeometryResult>,after:()=>Promise<unknown>,onExport?:(file:{name:string;bytes:Uint8Array;mime:string})=>void|Promise<void>,onModelSource?:()=>void,options:{workspaceStorage?:CodeWorkspaceStorage}={}){
 const panelId=++nextPanelId;
 const dialog=el('dialog'),style=el('style');style.textContent=codeWorkspaceStyle;
 dialog.className='code-dialog';dialog.setAttribute('aria-label',t('Code object'));parent.append(style,dialog);
 const drafts=createCodeWorkspaceStore(options.workspaceStorage);
 let disposed=false,view=0,workspaceMode=false,activeTarget:string|undefined,activeProject:string|undefined;
 let cleanup:(()=>void)|undefined,focusSource:(()=>void)|undefined,opener:HTMLElement|undefined;
 function hide(restoreFocus=true){
  cleanup?.();cleanup=undefined;focusSource=undefined;view++;
  if(dialog.open)dialog.close();
  if(restoreFocus&&opener?.isConnected)opener.focus();
 }
 function show(requestedId?:string,workspace=false,newDraft=false){
  if(disposed)return;
  const current=session.state;
  if(workspace&&!newDraft&&dialog.open&&workspaceMode&&activeProject===current.document.id&&(requestedId===undefined||requestedId===activeTarget)){focusSource?.();return;}
  hide(false);
  const root=parent.getRootNode();opener=(root instanceof ShadowRoot?root.activeElement:document.activeElement) as HTMLElement|undefined;
  workspaceMode=workspace;const version=++view,projectId=current.document.id;
  let id=requestedId;
  if(workspace&&!newDraft&&!id){const latest=drafts.latest(projectId);if(latest?.targetId&&current.document.nodes[latest.targetId]?.kind==='code')id=latest.targetId;}
  let model=current.document,expected=current.revision;
  const node=id?model.nodes[id]:undefined;if(id&&node?.kind!=='code')throw new Error(t('Select a code object'));
  const original=node?.kind==='code'?node.program:defaultCodeProgram(),restored=workspace?drafts.load(projectId,id):undefined;
  let baseline=restored?restored.baseline:(node?.kind==='code'?structuredClone(node.program):undefined);
  let stale=!!restored&&!!id&&!sameProgram(restored.baseline,node?.kind==='code'?node.program:undefined);
  // The CAD Script revision of the draft: an existing object keeps its own (the session decides
  // whether an edit keeps revision-1 lofts), new code is written in the current revision.
  let revision:CodeProgram['version']=restored?.program.version??(node?.kind==='code'?node.program.version:CAD_SCRIPT_REVISION);
  let overrides=structuredClone(restored?.program.parameters??original.parameters),busy=false,applying=false,inputVersion=0,importVersion=0,previewTimer:ReturnType<typeof setTimeout>|undefined;
  activeTarget=id;activeProject=projectId;
  dialog.classList.toggle('code-workspace',workspace);dialog.setAttribute('aria-label',t(workspace?'CAD code workspace':'Code object'));
  dialog.replaceChildren();
  const header=el('header'),heading=el('h2',t(workspace?'CAD code workspace':id?'Edit code object':'Code an object')),close=el('button',t('Close code'));
  close.onclick=()=>hide();header.append(heading);
  if(workspace){const create=el('button',t('New code draft'));create.onclick=()=>show(undefined,true,true);header.append(create);}
  let linked:HTMLButtonElement|undefined;
  if(onModelSource){linked=el('button',t(id?'Apply & show model source':'Create & show model source'));linked.onclick=async()=>{if(await build(true)){hide();onModelSource();}};header.append(linked);}
  header.append(close);
  const layout=el('div');layout.className='code-layout';const left=el('div'),right=el('div');left.className='code-source-pane';right.className='code-preview-pane';
  const name=el('input');name.value=restored?.name??node?.name??t('Coded plate');name.setAttribute('aria-label',t('Code object name'));name.disabled=!!id;
  const source=el('textarea');source.setAttribute('aria-label',t('CAD code source'));source.spellcheck=false;source.wrap='off';source.value=restored?.program.source??original.source;
  const completions=el('div');completions.className='code-completions';completions.id=`code-parameters-${panelId}-${version}`;completions.hidden=true;completions.setAttribute('role','listbox');completions.setAttribute('aria-label',t('Parameter suggestions'));
  source.setAttribute('aria-autocomplete','list');source.setAttribute('aria-controls',completions.id);
  let completion:ReturnType<typeof codeParameterCompletions>|undefined,completionIndex=0;
  const note=el('p');note.className='code-workspace-note';note.hidden=!workspace;
  const shortcuts=el('p',t('Ctrl+Space: parameter completion · Ctrl+Enter: preview · Shift+Tab: leave source'));shortcuts.className='code-workspace-note';shortcuts.hidden=!workspace;
  const reload=el('button',t('Use current model'));reload.hidden=!stale;reload.onclick=()=>{
   const current=session.state;
   if(current.document.id!==projectId){status.textContent=t('A different design is open. Reopen the code workspace.');return;}
   const target=id?current.document.nodes[id]:undefined;
   if(id&&target?.kind!=='code'){status.textContent=t('This code object was removed. Restore it with Undo before applying.');return;}
   model=current.document;expected=current.revision;baseline=target?.kind==='code'?structuredClone(target.program):undefined;stale=false;reload.hidden=true;
   // Refreshing the baseline invalidates geometry and Apply work already in flight.
   inputVersion++;
   status.textContent=t('Draft kept. Preview it against the current model before applying.');persist();schedulePreview();
  };
  const help=el('details');help.append(el('summary',t('Language reference')),el('pre',t('param width: mm = 40;\nlet base = box(width, 30, 5);\nreturn subtract(base, cylinder(3, 20));\n\nUnits: mm, deg, scalar. Arithmetic: + - * / ( ).\nShapes: box(w,d,h), cylinder(r,h[,segments]), sphere(r[,segments]).\nBooleans: union(a,b,...), subtract(base,cut,...), intersect(a,b,...).\nTransforms: move([x,y,z],shape), rotate([x,y,z],shape), scale([x,y,z],shape).\nPattern: repeat(count,[dx,dy,dz],shape). Nest transforms in operation order.\nNamed shapes use let; one final return produces one rigid body.\n// starts a comment. This is CAD Script, not JavaScript or .scad.')));
  help.append(el('p',t('Polygon extrusion: extrude(height, [[x,y], ...]). The outline closes automatically and must not intersect itself.')));
  help.append(el('p',t('Tapers: frustum(bottom, top, height[,segments]). Convex hull: hull(a,...). empty() contributes no solid.')),el('p',t('Control flow: choose(condition, thenShape, elseShape), forRange(index,start,end,step,shape), forValues(index,[values],shape). Scalar conditions use comparisons, &&, ||, ! and condition ? a : b.')));
  const importNotes=el('details'),notesTitle=el('summary'),notesList=el('ul');importNotes.className='code-import-notices';importNotes.setAttribute('aria-label',t('Conversion notes'));importNotes.append(notesTitle,notesList);
  const showNotes=(messages:string[])=>{importNotes.hidden=!messages.length;notesTitle.textContent=t`Conversion notes (${messages.length})`;notesList.replaceChildren(...messages.map(message=>el('li',message)));importNotes.open=false;};showNotes(getOpenSCADImportWarnings(restored?.program??original));
  const exampleLabel=el('label',t('Code examples')),examples=el('select'),loadExample=el('button',t('Load example'));examples.setAttribute('aria-label',t('Code examples'));const placeholder=el('option',t('Choose an example…'));placeholder.value='';examples.append(placeholder);
  for(const example of codeExamples){const option=el('option',example.title[getLocale()]);option.value=example.id;examples.append(option);}
  loadExample.onclick=()=>{if(!examples.value)return;const chosen=codeExampleProgram(examples.value);source.value=chosen.source;showNotes([]);overrides={};if(!id)name.value=codeExamples.find(e=>e.id===examples.value)!.title[getLocale()];parameterFields();changed();status.textContent=t('Example loaded. Preview or apply to check its geometry.');};exampleLabel.append(examples,loadExample);
  const interchange=el('div'),importButton=el('button',t('Import source…')),file=el('input'),format=el('select'),exportButton=el('button',t('Export source…'));interchange.className='code-interchange';file.type='file';file.accept='.cadcode,.scad,.jscad,.js';file.hidden=true;file.setAttribute('aria-label',t('Import CAD source'));format.setAttribute('aria-label',t('Source export format'));
  for(const [value,title] of [['cadcode','CAD Script (editable)'],['scad','OpenSCAD (evaluated snapshot)'],['jscad','JSCAD (evaluated snapshot)']]){const option=el('option',t(title));option.value=value;format.append(option);}importButton.onclick=()=>file.click();exportButton.disabled=!onExport;
  file.onchange=async()=>{
   const selected=file.files?.[0],startedAt=inputVersion,request=++importVersion;file.value='';if(!selected)return;
   try{
    if(selected.size>32768)throw Error(t('Source exceeds 32 KiB'));
    const text=await selected.text();
    // Only the most recently selected file may replace this draft or report an
    // error. A newer import can start before either file has finished reading.
    if(!active()||startedAt!==inputVersion||request!==importVersion)return;
    const jscad=/\.(?:jscad|js)$/i.test(selected.name)?importJSCAD(text):undefined,converted=jscad?.program??(/\.scad$/i.test(selected.name)?importOpenSCAD(text):{version:CAD_SCRIPT_REVISION,language:'brickwright-cad-script' as const,source:text,parameters:{}});compileCode(converted);
    // JSCAD slice lofts keep revision 1: JSCAD triangulates them along the same diagonal.
    revision=jscad?converted.version:CAD_SCRIPT_REVISION;source.value=converted.source;showNotes(jscad?.warnings??getOpenSCADImportWarnings(converted));overrides={};parameterFields();changed();status.textContent=jscad?jscad.warnings[0]??t('Source loaded. Preview or apply to check its geometry.'):/\.scad$/i.test(selected.name)?t('Source converted. Preview before creating.'):t('Source loaded. Preview or apply to check its geometry.');
   }catch(error){if(active()&&startedAt===inputVersion&&request===importVersion)reportError(error,false);}
  };
  exportButton.onclick=async()=>{try{const p=program(),extension=format.value,text=extension==='scad'?exportOpenSCAD(p):extension==='jscad'?exportJSCAD(p):exportCodeSource(p);await onExport?.({name:`${(name.value||'object').replace(/[^A-Za-z0-9_-]+/g,'_')}.${extension}`,bytes:new TextEncoder().encode(text),mime:'text/plain'});if(active())status.textContent=t('Source exported. The model and its history are unchanged.');}catch(error){if(active())reportError(error,false);}};interchange.append(importButton,file,format,exportButton);
  const fields=el('div');fields.className='code-parameters';const image=el('img');image.alt=t('Preview of the coded solid');image.hidden=true;const measures=el('p',t('Preview the code to check the solid.'));
  const status=el('p');status.setAttribute('role','status');status.setAttribute('aria-label',t('Code status'));
  const preview=el('button',t('Preview code')),apply=el('button',t(id?'Apply code changes':'Create code object'));apply.className='primary';
  const reset=el('button',t('Use source defaults'));reset.onclick=()=>{overrides={};try{parameterFields();}catch(error){reportError(error,false);}changed();status.textContent=t('Overrides cleared. Preview to reload parameter controls.');};
  const program=():CodeProgram=>({version:revision,language:'brickwright-cad-script',source:source.value,parameters:structuredClone(overrides)});
  function active(){return !disposed&&view===version&&dialog.open;}
  function persist(){
   if(!workspace)return;
   const saved=drafts.save({projectId,...(id?{targetId:id}:{}),name:name.value,program:program(),...(baseline?{baseline}:{})});
   note.textContent=!saved.accepted?t('Draft exceeds workspace storage limits. Export your source to keep it.'):saved.persistent?t('Draft saved on this device. Apply updates the model.'):t('Draft kept for this session. Device storage is unavailable.');
   note.dataset.warning=String(!saved.persistent);
  }
  function schedulePreview(){
   clearTimeout(previewTimer);
   if(workspace&&!stale&&active())previewTimer=setTimeout(()=>void build(false,true),450);
  }
  function clearCompletions(){completion=undefined;completionIndex=0;completions.replaceChildren();completions.hidden=true;source.removeAttribute('aria-activedescendant');}
  function selectCompletion(index:number){
   if(!completion?.matches.length)return;
   completionIndex=(index+completion.matches.length)%completion.matches.length;
   [...completions.children].forEach((button,index)=>{button.setAttribute('aria-selected',String(index===completionIndex));button.classList.toggle('primary',index===completionIndex);});
   const selected=completions.children[completionIndex];if(selected)source.setAttribute('aria-activedescendant',selected.id);
  }
  function chooseCompletion(index:number){
   if(!completion)return;
   const value=completion.matches[index];if(value===undefined)return;
   source.setRangeText(value,completion.start,completion.end,'end');source.focus();changed();
  }
  function changed(){
   inputVersion++;clearCompletions();source.removeAttribute('aria-invalid');image.hidden=true;
   measures.textContent=t('Preview is out of date.');status.textContent=t('Source changed. Preview or apply to rebuild.');persist();schedulePreview();
  }
  function reportError(error:unknown,focus:boolean){
   status.textContent=error instanceof Error?error.message:String(error);image.hidden=true;
   if(error instanceof CadCodeError){source.setAttribute('aria-invalid','true');if(focus){source.focus();source.setSelectionRange(error.offset,error.offset+1);}}
  }
  function markStale(){
   stale=true;reload.hidden=!workspace;image.hidden=true;clearTimeout(previewTimer);
   status.textContent=t(workspace?'The model changed. Use current model to keep your draft and review it again.':'The model changed. Close and reopen this editor before applying.');
  }
  function parameterFields(){
   const compiled=compileCode(program()),root=fields.getRootNode(),focused=(root instanceof ShadowRoot?root.activeElement:document.activeElement) as HTMLInputElement|null;
   const key=focused&&fields.contains(focused)?focused.dataset.parameter:undefined,start=key?focused?.selectionStart:undefined,end=key?focused?.selectionEnd:undefined;
   fields.replaceChildren(el('h3',t('Parameters')));
   for(const [key,p] of Object.entries(compiled.parameters)){
    const label=el('label',`${key} (${p.unit})`),input=el('input'),output=el('small',`= ${Number(compiled.values[key].value.toFixed(5))} ${p.unit==='scalar'?'':p.unit}`);input.type='text';input.value=overrides[key]??'';input.placeholder=t`Default: ${p.expression}`;input.dataset.parameter=key;input.setAttribute('aria-label',t`Code parameter ${key}`);
    input.oninput=()=>{if(input.value.trim())overrides[key]=input.value.trim();else delete overrides[key];changed();status.textContent=t('Parameter changed. Preview or apply to rebuild.');};label.append(input,output);fields.append(label);
   }
   if(key){const next=[...fields.querySelectorAll('input')].find(input=>input.dataset.parameter===key);next?.focus();if(next&&start!=null&&end!=null)next.setSelectionRange(start,end);}
  }
  function trial(p:CodeProgram){const draft=createCadSession(model);try{const target=id??draft.addCode(p,name.value.trim());if(id)draft.updateCode(id,p);return {document:draft.state.document,target};}finally{draft.dispose();}}
  async function build(commit:boolean,automatic=false):Promise<boolean>{
   if(busy||!active())return false;
   if(stale||session.state.revision!==expected){markStale();return false;}
   busy=true;clearTimeout(previewTimer);preview.disabled=apply.disabled=true;if(linked)linked.disabled=true;status.textContent=t('Building coded solid…');
   const submittedVersion=inputVersion,submitted=program(),submittedName=name.value;
   try{
    compileCode(submitted);
    const draft=trial(submitted),result=await evaluate(draft.document);
    if(!active())return false;
    if(session.state.revision!==expected){markStale();return false;}
    if(inputVersion!==submittedVersion){if(!automatic)status.textContent=t('Code changed during the build. Preview again.');return false;}
    let body=result.bodies.find(b=>b.id===draft.target);
    if(!body){
     const isolated=structuredClone(draft.document);isolated.roots=[draft.target];delete isolated.joints;pruneDocument(isolated);body=(await evaluate(isolated)).bodies[0];
     if(!active())return false;
     if(session.state.revision!==expected){markStale();return false;}
     if(inputVersion!==submittedVersion)return false;
    }
    if(!body)throw new Error(t('The coded output is unavailable'));
    if(body.indices.length<=90000){image.src=evaluatedPreview([body]);image.hidden=false;}else image.hidden=true;
    measures.textContent=t`${body.volume.toLocaleString(undefined,{maximumFractionDigits:2})} mm³ · ${body.indices.length/3} triangles`;parameterFields();source.removeAttribute('aria-invalid');
    status.textContent=t(commit?'Code accepted.':'Preview ready. The model and its history are unchanged.');
    if(commit){
     applying=true;
     try{
      const previousId=id;
      if(id)session.updateCode(id,submitted);else id=session.addCode(submitted,submittedName.trim(),{position:[0,0,-body.bounds.min[2]]});
      expected=session.state.revision;model=session.state.document;baseline=structuredClone(submitted);activeTarget=id;
      if(workspace){if(previousId!==id)drafts.remove(projectId,previousId);persist();name.disabled=true;apply.textContent=t('Apply code changes');if(linked)linked.textContent=t('Apply & show model source');}
     }finally{applying=false;}
     if(!workspace)hide();
     const completionView=view,completionRevision=session.state.revision;
     await after();
     // The modal may have closed itself above. Other closes, replacements,
     // draft edits and model changes must cancel this view's linked follow-up.
     if(disposed||view!==completionView||inputVersion!==submittedVersion||session.state.revision!==completionRevision)return false;
    }
    return true;
   }catch(error){if(active()&&inputVersion===submittedVersion)reportError(error,!automatic);return false;}
   finally{busy=false;preview.disabled=apply.disabled=false;if(linked)linked.disabled=false;if(active()&&inputVersion!==submittedVersion)schedulePreview();}
  }
  preview.onclick=()=>void build(false);apply.onclick=()=>void build(true);source.oninput=changed;name.oninput=changed;
  source.onkeydown=event=>{
   if(event.isComposing)return;
   if(event.code==='Space'&&(event.ctrlKey||event.metaKey)){
    event.preventDefault();clearCompletions();completion=codeParameterCompletions(source.value,source.selectionStart);
    if(completion.matches.length===1)chooseCompletion(0);
    else if(completion.matches.length){
     completions.replaceChildren(...completion.matches.map((value,index)=>{const button=el('button',value);button.type='button';button.id=`${completions.id}-${index}`;button.tabIndex=-1;button.setAttribute('role','option');button.onpointerdown=event=>event.preventDefault();button.onclick=()=>chooseCompletion(index);return button;}));
     completions.hidden=false;selectCompletion(0);status.textContent=t('Choose a parameter suggestion with ↑/↓ and Enter or Tab.');
    }else{clearCompletions();status.textContent=t('No parameter suggestions.');}
    return;
   }
   if(completion){
    if((event.key==='ArrowUp'||event.key==='ArrowDown')&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();selectCompletion(completionIndex+(event.key==='ArrowUp'?-1:1));return;}
    if(event.key==='Tab'&&!event.shiftKey||event.key==='Enter'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();chooseCompletion(completionIndex);return;}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();clearCompletions();return;}
    if(['Tab','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))clearCompletions();
   }
   if(event.key==='Tab'&&!event.shiftKey){event.preventDefault();source.setRangeText('  ',source.selectionStart,source.selectionEnd,'end');changed();}
   else if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();clearCompletions();void build(false);}
  };
  source.onpointerdown=clearCompletions;source.onblur=clearCompletions;
  // Saved revision-1 lofts are triangulated along a fixed diagonal; upgrading rebuilds them as
  // ruled surfaces in one Undo step (docs/CODE-MODE.md#language-revisions).
  const upgrade=el('button',t('Upgrade lofts to ruled surfaces'));upgrade.hidden=!(id&&node?.kind==='code'&&hasTriangulatedLofts(node.program));
  upgrade.title=t('This object’s lofts are triangulated along one diagonal, as saved. Upgrading rebuilds them as ruled surfaces; Undo restores them.');
  upgrade.onclick=()=>{
   if(!id||!active())return;
   if(stale||session.state.revision!==expected){markStale();return;}
   applying=true;
   try{session.upgradeLofts([id]);}catch(error){reportError(error,false);return;}finally{applying=false;}
   const target=session.state.document.nodes[id];
   model=session.state.document;expected=session.state.revision;if(target?.kind==='code')baseline=structuredClone(target.program);revision=2;upgrade.hidden=true;
   inputVersion++;persist();schedulePreview();
   status.textContent=t('Lofts upgraded to ruled surfaces. Undo restores the triangulated lofts.');
  };
  left.append(name,exampleLabel,interchange,source,completions,shortcuts,note,importNotes,upgrade,help);right.append(image,measures,fields,reset);layout.append(left,right);
  const footer=el('footer');footer.append(status,reload,preview,apply);dialog.append(header,layout,footer);
  try{parameterFields();}catch(error){reportError(error,false);}
  const unsubscribe=session.subscribe(state=>{if(!applying&&state.revision!==expected)markStale();});
  cleanup=()=>{clearTimeout(previewTimer);persist();unsubscribe();};focusSource=()=>source.focus();
  if(workspace)dialog.show();else dialog.showModal();source.focus();
  if(stale)markStale();else schedulePreview();persist();
 }
 dialog.addEventListener('cancel',event=>{event.preventDefault();hide();});
 dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing){event.preventDefault();hide();}});
 return {
  open:(id?:string)=>show(id),
  openWorkspace:(id?:string)=>show(id,true),
  close:()=>hide(),
  get isWorkspaceOpen(){return workspaceMode&&dialog.open;},
  dispose(){hide(false);disposed=true;dialog.remove();style.remove();}
 };
}
