// SPDX-License-Identifier: BSD-3-Clause
import {recordCadEdit,t} from '@brickwright/cad-core';
import type {CadSession,Vec3} from '@brickwright/cad-core';
import type {CadCommand} from './index.js';
import type {PaletteContext} from './command-palette.js';
import {parseTerminalBox,parseTerminalPoint,resolveTerminalCommand,splitTerminalInput,terminalCommands,terminalCompletions} from './terminal-command.js';

const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const MAX_INPUT=32*1024*1024;
const sameSelection=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((id,i)=>id===b[i]);
type Pending={kind:'box'|'move';revision:number;ids:string[]};
/** A modeless command surface, mounted per editor (including embedded editors).
 * The transcript observes actual session events, not button clicks or pointer previews. */
export function mountCommandTerminal(parent:HTMLElement,before:HTMLElement,session:CadSession,context:()=>PaletteContext,execute:(command:CadCommand)=>Promise<void>,onVisibility:(visible:boolean)=>void){
  const panel=make('section');panel.className='cad-terminal';panel.hidden=true;panel.setAttribute('aria-label',t('CAD terminal'));
  const header=make('header'),heading=make('strong',t('CAD terminal')),close=make('button',t('Close CAD terminal'));
  close.type='button';header.append(heading,close);
  const log=make('div');log.className='terminal-log';log.setAttribute('role','log');log.setAttribute('aria-label',t('Terminal transcript'));log.setAttribute('aria-live','off');
  const prompt=make('div');prompt.className='terminal-prompt';prompt.setAttribute('role','status');prompt.setAttribute('aria-label',t('Terminal prompt'));
  const form=make('form'),input=make('input'),submit=make('button',t('Run command'));
  input.type='text';input.spellcheck=false;input.autocomplete='off';input.setAttribute('autocapitalize','off');input.setAttribute('aria-label',t('Terminal command'));input.placeholder='help';
  submit.type='submit';form.append(input,submit);panel.append(header,log,prompt,form);parent.insertBefore(panel,before);
  let pending:Pending|undefined,disposed=false,busy=false,cursor=-1,draft='',history:string[]=[],previous=session.state;
  const rows:HTMLElement[]=[];
  const resetPrompt=()=>{prompt.textContent=pending?.kind==='box'?'Box width,depth,height (mm):':pending?.kind==='move'?'Target X,Y[,Z] or @dX,dY[,dZ] or @distance<angle:':t('Enter a command; Tab completes, ↑/↓ recalls, Esc cancels.');};
  resetPrompt();
  function add(text:string,recall?:()=>string){
    if(disposed)return;
    const row=make('div');row.className='terminal-row';row.append(make('span',text));
    if(recall){const button=make('button',t('Recall terminal entry'));button.type='button';button.onclick=()=>{
      if(busy)return;
      try{const command=recall();if(command.length>MAX_INPUT)throw new Error('Recorded command exceeds the 32 MiB input limit.');pending=undefined;input.value=command;cursor=-1;resetPrompt();input.focus();}
      catch(error){prompt.textContent=error instanceof Error?error.message:String(error);}
    };row.append(button);}
    log.append(row);rows.push(row);if(rows.length>100)rows.shift()?.remove();
    if(!panel.hidden)log.scrollTop=log.scrollHeight;
  }
  function clear(){rows.length=0;log.replaceChildren();}
  const unsubscribe=session.subscribe((state,change)=>{
    const old=previous;previous=state;
    if(change==='load'){clear();pending=undefined;input.value='';history=[];cursor=-1;draft='';resetPrompt();add('— '+state.document.title+' —');return;}
    if(change==='commit'){
      // Lazily encode the lossless replay command. Large imported meshes never become DOM text.
      add('apply-edit · '+state.label,()=> 'apply-edit '+JSON.stringify(recordCadEdit(old.document,state.document,state.label,state.selection)));
    }else if(change==='undo'||change==='redo')add(change,()=>change);
    else if(change==='selection'&&!sameSelection(old.selection,state.selection)){
      const command='select '+JSON.stringify(state.selection);
      add('select · '+(state.selection.map(id=>state.document.nodes[id]?.name??id).join(', ')||'∅'),()=>command);
    }
  });
  function remember(line:string){
    if(history.at(-1)!==line)history.push(line);
    // Bound text history independently of model snapshots.
    while(history.length>100||(history.length>1&&history.reduce((sum,item)=>sum+item.length,0)>2*1024*1024))history.shift();
    cursor=-1;draft='';
  }
  function selectedRoots(){
    const {document,selection}=session.state;
    if(!selection.length||!selection.every(id=>document.roots.includes(id)))throw new Error('Select one or more top-level bodies first.');
    return [...selection];
  }
  function move(args:string,ids:readonly string[]){
    const {document}=session.state;
    const reference=document.nodes[ids[0]].transform.position;
    const target=parseTerminalPoint(args,reference),delta=target.map((value,i)=>value-reference[i]) as Vec3;
    session.transform(ids.map(id=>{const transform=structuredClone(document.nodes[id].transform);transform.position=transform.position.map((v,i)=>v+delta[i]) as Vec3;return {id,transform};}));
  }
  function answer(kind:'box'|'move',args:string,ids:readonly string[]){
    if(kind==='box')session.add({kind:'box',size:parseTerminalBox(args)});
    else move(args,ids);
  }
  async function run(line:string){
    if(pending){
      const current=pending;
      if(session.state.revision!==current.revision||(current.kind==='move'&&!sameSelection(current.ids,session.state.selection))){
        pending=undefined;throw new Error('The model or selection changed. Start the command again.');
      }
      answer(current.kind,line,current.ids);pending=undefined;return;
    }
    const {name,args}=splitTerminalInput(line),entry=resolveTerminalCommand(name);
    if(!entry)throw new Error('Unknown command: '+name+'. Type help.');
    if(entry.requires&&!context()[entry.requires])throw new Error('Command unavailable for the current selection or editor state.');
    switch(entry.name){
      case 'help':
        if(args)throw new Error('Usage: help');
        add(terminalCommands.map(e=>e.name+(e.aliases?.length?' ('+e.aliases.join(', ')+')':'')).join(' · '));
        add('box width,depth,height | move X,Y[,Z] / @dX,dY[,dZ] / @distance<angle | select ["id",…] | list | apply-edit {…}');
        return;
      case 'clear':if(args)throw new Error('Usage: clear');clear();return;
      case 'list':
        if(args)throw new Error('Usage: list');
        for(const id of session.state.document.roots)add(id+' · '+session.state.document.nodes[id].name,()=> 'select '+JSON.stringify([id]));
        return;
      case 'apply-edit':{
        if(!args)throw new Error('Recall a recorded edit or enter its JSON payload.');
        session.applyRecordedEdit(JSON.parse(args));return;
      }
      case 'box':case 'move':{
        const ids=entry.name==='move'?selectedRoots():[];
        if(!args){pending={kind:entry.name,revision:session.state.revision,ids};return;}
        answer(entry.name,args,ids);return;
      }
      case 'select':
        if(args){
          const ids:unknown=args.startsWith('[')?JSON.parse(args):[args];
          if(!Array.isArray(ids)||!ids.every(id=>typeof id==='string'&&Object.hasOwn(session.state.document.nodes,id)))throw new Error('Unknown object ID. Use list to find IDs.');
          session.select(ids);return;
        }
        break;
    }
    if(args)throw new Error('Unexpected command arguments: '+args.slice(0,120));
    if(entry.command)await execute(entry.command);
  }
  async function send(){
    if(busy||disposed)return;
    const line=input.value.trim();
    if(!line)return;
    if(line.length>MAX_INPUT){prompt.textContent='Command exceeds the 32 MiB input limit.';return;}
    busy=true;submit.disabled=true;input.value='';remember(line);
    add('> '+(line.length>240?line.slice(0,240)+'…':line));
    try{await run(line);if(!disposed)resetPrompt();}
    catch(error){if(!disposed){prompt.textContent=error instanceof Error?error.message:String(error);input.value=line;}}
    finally{busy=false;submit.disabled=false;}
  }
  form.onsubmit=event=>{event.preventDefault();void send();};
  input.oninput=()=>{cursor=-1;draft=input.value;if(!pending){const {name,args}=splitTerminalInput(input.value);const matches=name&&!args?terminalCompletions(name,context()):[];prompt.textContent=matches.length?matches.slice(0,8).join(' · '):t('Enter a command; Tab completes, ↑/↓ recalls, Esc cancels.');}};
  panel.addEventListener('keydown',event=>{
    // Keep text editing, Delete, Ctrl+A, Ctrl+Z and Escape out of viewport shortcuts.
    event.stopPropagation();
    if(event.isComposing||event.target!==input)return;
    if(event.key==='Escape'){
      event.preventDefault();pending=undefined;input.value='';cursor=-1;resetPrompt();return;
    }
    if(busy)return;
    if(event.key==='Tab'&&!event.shiftKey&&!pending){
      const {name,args}=splitTerminalInput(input.value);
      const exact=resolveTerminalCommand(name),matches=name&&!args?terminalCompletions(name,context()):[];
      const next=exact&&matches.includes(exact.name)?exact.name:matches[0];
      if(next&&next!==input.value){event.preventDefault();input.value=next;prompt.textContent=matches.slice(0,8).join(' · ');}
    }else if(event.key==='ArrowUp'||event.key==='ArrowDown'){
      event.preventDefault();
      if(!history.length)return;
      if(cursor<0){if(event.key==='ArrowDown')return;draft=input.value;cursor=history.length-1;}
      else cursor+=event.key==='ArrowUp'?-1:1;
      if(cursor>=history.length){cursor=-1;input.value=draft;}
      else{cursor=Math.max(0,cursor);input.value=history[cursor];}
    }
  });
  function hide(){panel.hidden=true;pending=undefined;resetPrompt();onVisibility(false);}
  close.onclick=hide;
  function open(){if(disposed)return;panel.hidden=false;onVisibility(true);log.scrollTop=log.scrollHeight;input.focus({preventScroll:true});}
  return {open,toggle(){if(panel.hidden)open();else hide();},cancel(){if(!pending)return false;pending=undefined;input.value='';resetPrompt();return true;},get visible(){return !panel.hidden;},dispose(){disposed=true;unsubscribe();clear();history=[];panel.remove();}};
}
