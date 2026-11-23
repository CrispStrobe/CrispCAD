// SPDX-License-Identifier: BSD-3-Clause
import {constructionInputs,t,mergeModelSource,modelSourceEntityAt,modelSourceEntityRange} from '@brickwright/cad-core';
import type {CadSession,CadDocument,GeneratorRecipe} from '@brickwright/cad-core';
import {solveOutlinePoints} from './outline-constraint-solve.js';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
/** Nonmodal companion to the canvas. Drafts never overwrite newer GUI work. */
export function mountModelSourcePanel(parent:HTMLElement,before:HTMLElement,session:CadSession,evaluate:(doc:CadDocument)=>Promise<unknown>,regenerate:(recipe:GeneratorRecipe,name:string)=>CadDocument){
 const panel=el('section');panel.className='model-source-pane';panel.hidden=true;panel.setAttribute('aria-label',t('Model source'));
 const header=el('header'),heading=el('strong',t('Model source')),follow=el('input'),followLabel=el('label',t('Follow selection')),close=el('button',t('Close model source'));
 follow.type='checkbox';follow.checked=true;follow.setAttribute('aria-label',t('Follow selection'));followLabel.prepend(follow);header.append(heading,followLabel,close);
 const help=el('p',t('GUI edits update this source. Apply creates one model-history step. Drafts do not change the model.'));
 const input=el('textarea');input.spellcheck=false;input.wrap='off';input.setAttribute('aria-label',t('Design source'));
 const footer=el('footer'),status=el('span'),merge=el('button',t('Merge GUI changes')),reload=el('button',t('Reload model source')),preview=el('button',t('Preview model source')),apply=el('button',t('Apply model source'));status.setAttribute('role','status');status.setAttribute('aria-label',t('Model source status'));apply.className='primary';footer.append(status,reload,merge,preview,apply);panel.append(header,help,input,footer);parent.insertBefore(panel,before);
 let baseSource='',baseRevision=-1,dirty=false,disposed=false,lastSelection='',pending:AbortController|undefined;
 function cancelPreparation(){
  pending?.abort();
  pending=undefined;
  merge.disabled=apply.disabled=preview.disabled=false;
 }
 function hide(){cancelPreparation();panel.hidden=true;}
 function selection(){if(!follow.checked||dirty||panel.hidden||(input.getRootNode() as ShadowRoot).activeElement===input)return;const ids=session.state.selection;if(ids.length!==1)return;try{let range=modelSourceEntityRange(input.value,ids[0]);if(!range){for(const root of Object.values(session.state.document.nodes)){if(!root.generator)continue;const seen=new Set<string>();const includes=(id:string):boolean=>{if(id===ids[0])return true;if(seen.has(id))return false;seen.add(id);const n=session.state.document.nodes[id];return constructionInputs(n).some(includes);};if(includes(root.id)){range=modelSourceEntityRange(input.value,root.id);break;}}}if(range){input.setSelectionRange(...range);const line=input.value.slice(0,range[0]).split('\n').length-1;input.scrollTop=Math.max(0,line*parseFloat(getComputedStyle(input).lineHeight)-input.clientHeight/3);}}catch{}}
 function refresh(force=false){if(disposed||panel.hidden)return;if(dirty&&!force){if(session.state.revision!==baseRevision)status.textContent=t('The design changed while editing source. Reload or merge your draft.');return;}const start=input.selectionStart,end=input.selectionEnd;input.value=session.modelSource;baseSource=input.value;input.setSelectionRange(Math.min(start,input.value.length),Math.min(end,input.value.length));baseRevision=session.state.revision;dirty=false;status.textContent=t('Source and GUI are synchronized.');selection();}
 const unsubscribe=session.subscribe(state=>{if(!panel.hidden){if(state.revision!==baseRevision){try{refresh();}catch(error){status.textContent=error instanceof Error?error.message:String(error);}}const selected=state.selection.join(',');if(selected!==lastSelection){lastSelection=selected;selection();}}});
 input.oninput=()=>{cancelPreparation();dirty=true;status.textContent=session.state.revision===baseRevision?t('Source draft changed. Preview or apply when ready.'):t('The design changed while editing source. Reload or merge your draft.');};
 input.onmouseup=()=>{try{const id=modelSourceEntityAt(input.value,input.selectionStart);if(id&&session.state.document.nodes[id]&&session.state.selection.join(',')!==id)session.select([id]);}catch{/* An incomplete draft has no reliable source map. */}};
 input.onkeydown=event=>{event.stopPropagation();if(event.key==='Tab'){event.preventDefault();input.setRangeText('  ',input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input'));}if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();void build(true);}};
 follow.onchange=selection;reload.onclick=()=>{cancelPreparation();refresh(true);};close.onclick=hide;
 async function build(commit:boolean,mergeDraft=false){
  if(pending)return;
  const controller=new AbortController(),submitted=input.value,expectedRevision=mergeDraft?session.state.revision:baseRevision;
  pending=controller;
  merge.disabled=apply.disabled=preview.disabled=true;
  status.textContent=t('Checking model source…');
  try{
   const source=mergeDraft?mergeModelSource(baseSource,submitted,session.modelSource):submitted;
   const prepared=await session.prepareModelSourceWithOutlineSolve(source,{expectedRevision,regenerate},solveOutlinePoints,controller.signal);
   if(controller.signal.aborted)return;
   if(!mergeDraft)await evaluate(prepared.document);
   if(controller.signal.aborted)return;
   if(session.state.revision!==expectedRevision)throw new Error(t('The design changed while editing source. Reload or merge your draft.'));
   if(input.value!==submitted)throw new Error(t('Source changed during preview. Apply again.'));
   if(mergeDraft){
    input.value=prepared.document.modelSource!.source;
    baseSource=session.modelSource;
    baseRevision=expectedRevision;
    dirty=true;
    status.textContent=t('GUI changes merged into the draft. Preview or apply.');
   }else if(commit){
    const changed=session.applyPreparedModelSource(prepared);
    dirty=false;
    refresh(true);
    status.textContent=changed?t('Model source applied as one history step.'):t('Model source is unchanged. No history entry was created.');
   }else status.textContent=t('Model preview ready. No history entry was created.');
  }catch(error){
   if(!controller.signal.aborted)status.textContent=error instanceof Error?error.message:String(error);
  }finally{
   if(pending===controller)cancelPreparation();
  }
 }
 merge.onclick=()=>void build(false,true);preview.onclick=()=>void build(false);apply.onclick=()=>void build(true);
 return {open(){session.enableModelSource();panel.hidden=false;refresh();},toggle(){if(panel.hidden)this.open();else hide();},get visible(){return !panel.hidden;},dispose(){disposed=true;hide();unsubscribe();panel.remove();}};
}
