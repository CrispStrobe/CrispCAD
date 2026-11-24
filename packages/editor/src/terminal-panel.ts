// SPDX-License-Identifier: BSD-3-Clause
import {newId,t} from '@brickwright/cad-core';
import type {CadSession,Vec3} from '@brickwright/cad-core';
import {createTerminalController} from './terminal-controller.js';
import type {TerminalCompletion,TerminalOptions,TerminalState} from './terminal-controller.js';

type PanelOptions=TerminalOptions&{pickPoint:(done:(point:Vec3|null)=>void,plane?:'XY')=>()=>void;onVisibilityChange?:(visible:boolean)=>void;focusCanvas:()=>void};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};

export function mountTerminalPanel(parent:HTMLElement,session:CadSession,options:PanelOptions){
 const controller=createTerminalController(session,options);
 const panel=el('section');panel.className='cad-terminal';panel.hidden=true;panel.setAttribute('aria-label',t('CAD terminal'));
 const header=el('header'),title=el('h2',t('CAD terminal')),hint=el('span',t('Tab completes · ↑↓ history · Esc cancels'));
 const code=el('button',t('Code workspace')),clear=el('button',t('Clear transcript')),close=el('button','×');
 code.type=clear.type=close.type='button';code.onclick=options.openCodeWorkspace;clear.onclick=()=>controller.clear();close.setAttribute('aria-label',t('Close terminal'));close.onclick=()=>setVisible(false);
 header.append(title,hint,code,clear,close);
 const log=el('ol');log.className='terminal-log';log.setAttribute('aria-label',t('Command transcript'));
 const status=el('p');status.className='terminal-prompt';status.id=newId();status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const form=el('form'),marker=el('span','›'),input=el('input'),submit=el('button',t('Run'));
 input.type='text';input.spellcheck=false;input.autocomplete='off';input.setAttribute('aria-label',t('CAD command'));input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-describedby',status.id);
 submit.type='submit';const suggestions=el('ul');suggestions.className='terminal-completion';suggestions.id=newId();suggestions.setAttribute('role','listbox');suggestions.setAttribute('aria-label',t('Command completions'));suggestions.hidden=true;input.setAttribute('aria-controls',suggestions.id);
 form.append(marker,input,submit);panel.append(header,log,status,form,suggestions);parent.append(panel);
 let historyIndex=-1,historyDraft='',completionSeed:{text:string;caret:number}|undefined,completionIndex=-1,completionMatches:TerminalCompletion[]=[],visible=false,disposed=false,pickKey='',cancelPick:(()=>void)|undefined,lastEntry=0;
 function stopPick(){const cancel=cancelPick;cancelPick=undefined;pickKey='';cancel?.();}
 function syncPick(state:TerminalState){
  const prompt=visible&&state.prompt?.point?state.prompt:undefined;
  const key=prompt?JSON.stringify(prompt):'';
  if(key===pickKey)return;
  stopPick();if(!prompt)return;
  pickKey=key;
  let active=true;
  let cancel:()=>void;
  try{cancel=options.pickPoint(point=>{
   if(!active||disposed)return;active=false;cancelPick=undefined;pickKey='';
   if(point)void controller.submitPoint(point)?.then(()=>{if(visible)input.focus({preventScroll:true});});else controller.cancel();
  },prompt.plane);}catch(error){controller.reportError(error);return;}
  cancelPick=()=>{active=false;cancel();};
 }
 function resetCompletion(){completionSeed=undefined;completionIndex=-1;completionMatches=[];}
 function acceptCompletion(match:TerminalCompletion,keepCycle=false){
  input.value=match.text;input.setSelectionRange(match.caret,match.caret);if(!keepCycle)resetCompletion();input.focus({preventScroll:true});completion();
 }
 function completion(){
  const matches=completionSeed?completionMatches:controller.complete(input.value,input.selectionStart??input.value.length);
  const first=Math.max(0,completionIndex-9);
  suggestions.replaceChildren(...matches.slice(first,first+10).map((match,offset)=>{const index=first+offset,item=el('li',`${match.label} — ${match.description}`);item.id=suggestions.id+'-'+index;item.setAttribute('role','option');item.setAttribute('aria-selected',String(index===completionIndex));item.onmousedown=event=>event.preventDefault();item.onclick=()=>acceptCompletion(match);return item;}));
  suggestions.hidden=!matches.length||!input.value.trim()&&!controller.state.prompt;input.setAttribute('aria-expanded',String(!suggestions.hidden));
  if(!suggestions.hidden&&completionIndex>=0)input.setAttribute('aria-activedescendant',suggestions.id+'-'+completionIndex);else input.removeAttribute('aria-activedescendant');
 }
 function render(state:TerminalState){
  if(disposed)return;
  resetCompletion();
  status.textContent=state.prompt?`${state.prompt.command} › ${state.prompt.message}`:t('Type help for commands. Coordinates use millimetres; XY sketches use Z = 0.');
  submit.disabled=state.busy;
  const nextLast=state.entries.at(-1)?.id??0;
  if(nextLast!==lastEntry||log.childElementCount!==state.entries.length){
   const bottom=log.scrollHeight-log.scrollTop-log.clientHeight<48;
   const byId=new Map([...log.children].map(node=>[(node as HTMLElement).dataset.entryId,node]));
   log.replaceChildren(...state.entries.map(entry=>{
    const existing=byId.get(String(entry.id));if(existing)return existing;
    const row=el('li');row.dataset.entryId=String(entry.id);row.className='terminal-entry '+entry.kind;
    row.append(el('span',entry.kind==='input'?'› ':entry.kind==='action'?'↳ ':''),el('pre',entry.summary));
    if(entry.text){const reuse=el('button',t('Use command'));reuse.type='button';reuse.title=t('Insert the replay command without running it');reuse.onclick=()=>{controller.cancel();resetCompletion();input.value=entry.text!;input.focus();completion();};row.append(reuse);}
    return row;
   }));
   lastEntry=nextLast;if(bottom)log.scrollTop=log.scrollHeight;
  }
  syncPick(state);completion();
 }
 const unsubscribe=controller.subscribe(render);
 function focusAfterCommand(){
  if(!visible)return;
  const root=parent.getRootNode(),focused=root instanceof ShadowRoot?root.activeElement:document.activeElement;
  // Commands can open a modal or the code workspace. Preserve their chosen focus.
  if(focused?.closest('dialog[open],.model-source-pane:not([hidden])'))return;
  input.focus({preventScroll:true});
 }
 form.onsubmit=event=>{event.preventDefault();const text=input.value;input.value='';historyIndex=-1;resetCompletion();void controller.submit(text).then(focusAfterCommand);};
 input.oninput=()=>{historyIndex=-1;resetCompletion();completion();};
 input.addEventListener('click',()=>{resetCompletion();completion();});
 input.addEventListener('keyup',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){resetCompletion();completion();}});
 panel.addEventListener('keydown',event=>{
  // Editing commands must not trigger the canvas's Delete, arrows or Undo shortcuts.
  event.stopPropagation();if(event.isComposing)return;
  if((event.ctrlKey||event.metaKey)&&event.code==='Backquote'&&!event.altKey){event.preventDefault();setVisible(false);return;}
  if(event.key==='Escape'){event.preventDefault();resetCompletion();if(controller.state.prompt)controller.cancel();else{input.value='';completion();options.focusCanvas();}return;}
  if(event.target!==input)return;
  if(event.key==='ArrowUp'||event.key==='ArrowDown'){
   event.preventDefault();const items=controller.state.history;if(!items.length)return;
   if(historyIndex<0){historyDraft=input.value;historyIndex=items.length;}
   historyIndex=Math.max(0,Math.min(items.length,historyIndex+(event.key==='ArrowUp'?-1:1)));input.value=historyIndex===items.length?historyDraft:items[historyIndex];resetCompletion();completion();
  }else if(event.key==='Tab'){
   if(!input.value.trim()&&!completionSeed&&!controller.state.prompt)return;
   const seed=completionSeed??{text:input.value,caret:input.selectionStart??input.value.length};
   const matches=completionSeed?completionMatches:controller.complete(seed.text,seed.caret);if(!matches.length)return;
   event.preventDefault();completionSeed=seed;completionMatches=matches;
   completionIndex=completionIndex<0?(event.shiftKey?matches.length-1:0):(completionIndex+(event.shiftKey?-1:1)+matches.length)%matches.length;
   acceptCompletion(matches[completionIndex],true);
  }
 });
 function setVisible(next:boolean,focus=true){
  visible=next;panel.hidden=!next;parent.classList.toggle('terminal-open',next);
  try{options.storage?.setItem('brickwright-cad:terminal-visible:v1',String(next));}catch{}
  if(next){render(controller.state);if(focus)input.focus({preventScroll:true});}else{stopPick();controller.cancel();if(focus)options.focusCanvas();}
  options.onVisibilityChange?.(next);
 }
 let restored=false;try{restored=options.storage?.getItem('brickwright-cad:terminal-visible:v1')==='true';}catch{}
 setVisible(restored,false);render(controller.state);
 return {controller,get visible(){return visible;},setVisible,toggle(){setVisible(!visible);},focus(){setVisible(true);},dispose(){disposed=true;stopPick();unsubscribe();controller.dispose();panel.remove();}};
}

export const terminalStyle=`
.editor.terminal-open{grid-template-rows:48px minmax(120px,1fr) minmax(150px,28%) 26px}
.editor.terminal-open>.design-bar{grid-row:1;grid-column:1/-1}.editor.terminal-open>.main{grid-row:2}.editor.terminal-open>.status{grid-row:4;grid-column:1/-1}
.cad-terminal{grid-column:1/-1;grid-row:3;display:grid;grid-template-rows:auto minmax(35px,1fr) auto auto;position:relative;min-height:0;min-width:0;background:var(--cad-panel);border-top:1px solid var(--line);color:var(--cad-text);padding:7px 12px;gap:5px}
.cad-terminal header{display:flex;align-items:center;gap:8px}.cad-terminal h2{font-size:12px;letter-spacing:.04em;margin:0;color:var(--accent)}.cad-terminal header>span{font-size:11px;color:var(--cad-muted);margin-right:auto}.cad-terminal button{min-height:28px;font-size:11px;padding:3px 8px}.cad-terminal header>button:last-child{font-size:18px}
.terminal-log{list-style:none;overflow:auto;margin:0;padding:0;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;overscroll-behavior:contain}.terminal-entry{display:flex;align-items:flex-start;gap:5px;margin-bottom:4px}.terminal-entry pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;min-width:0;font:inherit;flex:1}.terminal-entry.action{color:var(--cad-muted)}.terminal-entry.error{position:static;padding:0;background:transparent;color:var(--cad-danger)}.terminal-entry button{flex:none;padding:0 5px;min-height:23px;font-size:10px}
.terminal-prompt{color:var(--accent);font-size:12px;margin:0;min-height:17px}.cad-terminal form{display:flex;align-items:center;gap:8px}.cad-terminal input{font:13px ui-monospace,SFMono-Regular,Consolas,monospace}.terminal-completion{position:absolute;bottom:43px;left:30px;right:12px;max-height:170px;overflow:auto;z-index:20;background:var(--cad-panel);border:1px solid var(--line);box-shadow:0 -5px 20px #0003;list-style:none;padding:5px;margin:0;font-size:12px}.terminal-completion li{padding:4px 7px;cursor:pointer}.terminal-completion li:hover,.terminal-completion li[aria-selected="true"]{background:var(--cad-hover)}
.editor.terminal-open:has(.model-source-pane:not([hidden])){grid-template-rows:48px minmax(100px,1fr) minmax(120px,24%) minmax(140px,28%) 26px}.editor.terminal-open>.model-source-pane{grid-row:4;grid-column:1/-1}.editor.terminal-open:has(.model-source-pane:not([hidden]))>.status{grid-row:5}
@container(max-width:700px){.cad-terminal header>span{display:none}.cad-terminal h2{margin-right:auto}.cad-terminal{padding:6px}.editor.terminal-open{grid-template-rows:48px minmax(100px,1fr) minmax(175px,37%) 26px}.terminal-entry button{max-width:70px;white-space:normal}}
`;
