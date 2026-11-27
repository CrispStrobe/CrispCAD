// SPDX-License-Identifier: BSD-3-Clause
import {newId,paletteCommandSpecs,t} from '@brickwright/cad-core';
import type {CadCommand,CadCommandState} from './index.js';

interface PaletteContext extends CadCommandState {
 canWrapBody:boolean;
 canDrop:boolean;
 canEditMirror:boolean;
 canEditPattern:boolean;
 canEditSplit:boolean;
}
type CommandEntry={command:CadCommand;label:string;alias?:string;aliases?:readonly string[];requires?:keyof PaletteContext};
/** Labels, search keywords, terminal aliases and availability come from the shared command registry. */
export const paletteCommands:readonly CommandEntry[]=paletteCommandSpecs().map(({name,aliases,palette})=>({command:name as CadCommand,label:palette!.label,...(aliases.length?{aliases}:{}),...(palette!.keywords?{alias:palette!.keywords}:{}),...(palette!.requires?{requires:palette!.requires}:{})}));
const normalize=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase().trim();

/** Matches labels and keywords by substring and registry aliases (`del`, `erase`) by prefix.
 * A query that is exactly an alias ranks like a label prefix. */
export function findPaletteCommands<T extends {label:string;alias?:string;aliases?:readonly string[]}>(items:readonly T[],query:string):T[]{
 const input=normalize(query);
 if(!input)return [...items];
 const tokens=input.split(/\s+/);
 return items.flatMap(item=>{
  const label=normalize(item.label),keywords=normalize(item.alias??''),aliases=(item.aliases??[]).map(normalize);
  if(!tokens.every(token=>label.includes(token)||keywords.includes(token)||aliases.some(alias=>alias.startsWith(token))))return [];
  return [{item,score:label===input?0:label.startsWith(input)||aliases.includes(input)?1:label.includes(input)?2:3}];
 }).sort((a,b)=>a.score-b.score).map(result=>result.item);
}

export function mountCommandPalette(parent:HTMLElement,context:()=>PaletteContext,execute:(command:CadCommand)=>void){
 const dialog=document.createElement('dialog');
 dialog.className='sketch-dialog command-palette';
 dialog.setAttribute('aria-label',t('Command palette'));
 const header=document.createElement('header');
 const title=document.createElement('h2');
 title.textContent=t('Command palette');
 const close=document.createElement('button');
 close.type='button';
 close.textContent='×';
 close.setAttribute('aria-label',t('Close command palette'));
 close.onclick=()=>dialog.close();
 header.append(title,close);

 const search=document.createElement('input');
 search.type='search';
 search.placeholder=t('Search CAD commands');
 search.setAttribute('aria-label',t('Search CAD commands'));
 search.setAttribute('role','combobox');
 search.setAttribute('aria-expanded','false');
 search.setAttribute('aria-autocomplete','list');
 const results=document.createElement('ul');
 results.id=newId();
 results.setAttribute('role','listbox');
 results.setAttribute('aria-label',t('Commands'));
 search.setAttribute('aria-controls',results.id);
 const status=document.createElement('p');
 status.setAttribute('role','status');
 dialog.append(header,search,results,status);
 parent.append(dialog);
 const entries=paletteCommands.map(entry=>({
  ...entry,label:t(entry.label),alias:entry.alias?`${entry.alias} ${t(entry.alias)}`:undefined
 }));
 let matches:typeof entries=[];
 let selected=0;

 function choose(index:number){
  const entry=matches[index],state=context();
  if(!entry||entry.requires&&!state[entry.requires])return;
  dialog.close();
  execute(entry.command);
 }
 function select(index:number,scroll=false){
  selected=index;
  const options=[...results.children];
  options.forEach((option,i)=>option.setAttribute('aria-selected',String(i===index)));
  const option=options[index];
  if(!option){search.removeAttribute('aria-activedescendant');return;}
  search.setAttribute('aria-activedescendant',option.id);
  if(scroll)option.scrollIntoView({block:'nearest'});
 }
 function render(reset=false){
  if(!dialog.open)return;
  const current=reset?undefined:matches[selected]?.command;
  const state=context();
  matches=findPaletteCommands(entries.filter(entry=>!entry.requires||state[entry.requires]),search.value);
  results.replaceChildren(...matches.map((entry,index)=>{
   const option=document.createElement('li');
   option.id=results.id+'-'+entry.command;
   option.setAttribute('role','option');
   option.textContent=entry.label;
   option.onmousedown=event=>event.preventDefault();
   option.onclick=()=>choose(index);
   return option;
  }));
  search.setAttribute('aria-expanded',String(matches.length>0));
  status.textContent=matches.length?'':t('No available commands match');
  select(Math.max(0,matches.findIndex(entry=>entry.command===current)),true);
 }
 search.oninput=()=>render(true);
 dialog.addEventListener('keydown',event=>{
  event.stopPropagation();
  if(event.isComposing||event.target!==search)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   event.preventDefault();
   if(!matches.length)return;
   select((selected+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length,true);
  }else if(event.key==='Enter'){
   event.preventDefault();
   choose(selected);
  }
 });

 return {
  open(){if(dialog.open)return;search.value='';dialog.showModal();render(true);search.focus();},
  refresh:render,
  dispose(){dialog.close();dialog.remove();}
 };
}

