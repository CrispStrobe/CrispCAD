import {t,getLocale,translateHistoryLabel,createDocument} from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
import type {CadEditor} from '@brickwright/cad-editor';
import type {ModelRevision} from '@brickwright/cad-history';
import {historyStore} from './project-store.js';
import {recoverLibrary,importLibraryProject,exportLibraryProject,duplicateLibraryProject,renameLibraryProject,setLibraryProjectTrashed} from './library.js';
export {historyStore} from './project-store.js';
export function mountHistoryUI(getEditor:()=>CadEditor|undefined,restore:(revision:ModelRevision)=>Promise<void>,beforeAction:()=>Promise<void>=async()=>{}){
 const select=document.querySelector<HTMLSelectElement>('#iterations')!;
 const dialog=document.createElement('dialog');dialog.className='library-dialog';dialog.setAttribute('aria-label',t('Project library'));
 const header=document.createElement('header'),heading=document.createElement('h1');heading.textContent=t('Projects');const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label',t('Close project library'));close.onclick=()=>dialog.close();header.append(heading,close);
 const search=document.createElement('input');search.type='search';search.placeholder=t('Search projects');search.setAttribute('aria-label',t('Search projects'));
 const toolbar=document.createElement('div');toolbar.className='library-actions';
 const makeButton=(name:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=name;b.onclick=action;toolbar.append(b);return b;};
 const projects=document.createElement('section');projects.setAttribute('aria-label',t('Saved projects'));
 const status=document.createElement('p');status.className='library-status';status.setAttribute('role','status');
 const file=document.createElement('input');file.type='file';file.accept='.bcad,.bcadhistory,.json';file.multiple=true;file.hidden=true;file.setAttribute('aria-label',t('Import project files'));
 dialog.append(header,search,toolbar,projects,status,file);document.body.append(dialog);
 let model='',before:number|undefined,revisionToken=0,renderToken=0,busy=false,trash=false;
 const report=(error:unknown)=>{status.textContent=error instanceof Error?error.message:String(error);};
 const action=(fn:()=>Promise<void>)=>{if(busy)return;busy=true;dialog.setAttribute('aria-busy','true');dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);void(async()=>{try{await beforeAction();await fn();}catch(error){report(error);}finally{busy=false;close.disabled=false;dialog.removeAttribute('aria-busy');toolbar.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);await showProjects().catch(report);}})();};
 async function showProjects(){
  const token=++renderToken,store=await historyStore;await store.flush();const records=await store.listProjects({trashedOnly:trash});if(token!==renderToken)return;projects.replaceChildren();
  for(const p of records){if(search.value&&!p.title.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))continue;
   const row=document.createElement('article');row.className='project-card';row.dataset.projectId=p.id;
   const icon=document.createElement('span');icon.className='project-icon';icon.textContent=trash?'♲':'◇';icon.setAttribute('aria-hidden','true');
   const title=document.createElement('strong');title.textContent=p.title;const info=document.createElement('small');info.textContent=p.serial===1?t`1 iteration · ${new Date(p.updatedAt).toLocaleString(getLocale())}`:t`${p.serial} iterations · ${new Date(p.updatedAt).toLocaleString(getLocale())}`;const label=document.createElement('div');label.className='project-label';label.append(title,info);
   if(getEditor()?.session.state.document.id===p.id){const current=document.createElement('small');current.className='project-current';current.textContent=t('Current project');label.append(current);}
   const controls=document.createElement('div');controls.className='project-controls';const open=document.createElement('button');open.textContent=trash?t('Restore'):t('Open');open.disabled=busy;open.setAttribute('aria-label',trash?t`Restore project ${p.title}`:t`Open project ${p.title}`);
   open.onclick=()=>action(async()=>{if(trash){await setLibraryProjectTrashed(p.id,false);status.textContent=t('Project restored.');return;}const latest=await store.getProject(p.id);if(!latest||latest.trashedAt)throw new Error(t('Saved project is missing'));const editor=getEditor();if(!editor)return;const expected=editor.session.state.revision,document=await store.readDocument(latest.headId);if(editor!==getEditor()||editor.session.state.revision!==expected)throw new Error(t('The project changed while opening. Try again.'));editor.session.load(document);await beforeAction();await editor.whenIdle();editor.frame();dialog.close();});
   const menu=document.createElement('details');menu.className='project-menu';const trigger=document.createElement('summary');trigger.textContent='⋯';trigger.setAttribute('aria-label',t`Actions for project ${p.title}`);const actions=document.createElement('div');actions.className='project-popup';menu.append(trigger,actions);menu.addEventListener('toggle',()=>{if(!menu.open)return;for(const other of dialog.querySelectorAll<HTMLDetailsElement>('.project-menu[open]'))if(other!==menu)other.open=false;const anchor=trigger.getBoundingClientRect(),size=actions.getBoundingClientRect();actions.style.right='auto';actions.style.left=Math.max(8,Math.min(innerWidth-size.width-8,anchor.right-size.width))+'px';actions.style.top=Math.max(8,Math.min(innerHeight-size.height-8,anchor.bottom+4))+'px';});
   const add=(name:string,fn:()=>Promise<void>)=>{const b=document.createElement('button');b.type='button';b.textContent=t(name);b.disabled=busy;b.onclick=()=>{menu.open=false;action(fn);};actions.append(b);};
   add('Export project…',async()=>{await exportLibraryProject(p.id);status.textContent=t('Project exported with complete history.');});
   if(!trash){
    add('Duplicate project',async()=>{await duplicateLibraryProject(p.id);status.textContent=t('Project duplicated with complete history.');});
    const rename=document.createElement('button');rename.textContent=t('Rename project');rename.disabled=busy;rename.onclick=()=>{menu.open=false;const form=document.createElement('form'),input=document.createElement('input'),save=document.createElement('button'),cancel=document.createElement('button');form.className='project-rename';input.value=p.title;input.required=true;input.maxLength=160;input.setAttribute('aria-label',t('Project name'));save.type='submit';save.textContent=t('Save');cancel.type='button';cancel.textContent=t('Cancel');cancel.onclick=()=>{void showProjects().catch(report);};form.append(input,save,cancel);label.replaceChildren(form);input.focus();input.select();form.onsubmit=event=>{event.preventDefault();const name=input.value.trim();if(!name)return;action(async()=>{const editor=getEditor();if(editor?.session.state.document.id===p.id){editor.session.rename(name);await beforeAction();}else await renameLibraryProject(p.id,name);status.textContent=t('Project renamed.');});};};actions.append(rename);
    add('Move to Trash',async()=>{const editor=getEditor();if(editor?.session.state.document.id===p.id){editor.session.load(createDocument());await beforeAction();}await setLibraryProjectTrashed(p.id,true);status.textContent=t('Moved to Trash. All iterations are kept.');});
   }
   controls.append(open,menu);row.append(icon,label,controls);projects.append(row);
  }
  if(!projects.childElementCount)projects.textContent=trash?t('Trash is empty.'):t('No projects match.');
 }
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('pointerdown',event=>{for(const menu of dialog.querySelectorAll<HTMLDetailsElement>('.project-menu[open]'))if(!event.composedPath().includes(menu))menu.open=false;});
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){const menus=[...dialog.querySelectorAll<HTMLDetailsElement>('.project-menu[open]')];if(menus.length){menus.forEach(menu=>menu.open=false);event.preventDefault();event.stopPropagation();}}});
 async function refresh(projectId=getEditor()?.session.state.document.id,headId?:string,older=false){
  if(!projectId)return;const token=++revisionToken,store=await historyStore;
  if(!older||model!==projectId){model=projectId;before=undefined;select.replaceChildren();}
  const page=await store.listRevisions(projectId,{beforeSerial:before});if(token!==revisionToken)return;
  select.querySelectorAll('[data-action]').forEach(option=>option.remove());
  for(const revision of page){const option=document.createElement('option');option.value=revision.id;option.textContent=`#${revision.serial} · ${translateHistoryLabel(revision.label)}`;option.title=new Date(revision.createdAt).toLocaleString(getLocale());select.append(option);}
  if(page.length===50){before=page.at(-1)!.serial;const option=document.createElement('option');option.dataset.action='true';option.value='earlier';option.textContent=t('Load earlier iterations…');select.append(option);}
  const name=document.createElement('option');name.dataset.action='true';name.value='name';name.textContent=t('Name this iteration…');select.append(name);
  if(headId&&Array.from(select.options).some(option=>option.value===headId))select.value=headId;else if(!older)select.selectedIndex=0;
 }
 select.onchange=()=>action(async()=>{const value=select.value,store=await historyStore;if(value==='earlier'){await refresh(model,undefined,true);return;}if(value==='name'){const editor=getEditor();if(!editor)return;const label=prompt(t('Name this iteration'),t('Milestone'));if(label?.trim()){const r=await store.append(editor.session.state.document,label,(await store.getProject(model))?.headId??null);await refresh(model,r.id);}else await refresh();return;}const revision=await store.getRevision(value);if(revision)await restore(revision);});
 makeButton(t('New project'),()=>action(async()=>{getEditor()?.session.load(createDocument());dialog.close();}));
 makeButton(t('Import projects…'),()=>file.click());
 const trashButton=makeButton(t('Trash'),()=>{trash=!trash;trashButton.textContent=trash?t('Back to projects'):t('Trash');trashButton.setAttribute('aria-pressed',String(trash));status.textContent='';void showProjects().catch(report);});trashButton.setAttribute('aria-pressed','false');
 file.onchange=()=>{const files=[...file.files??[]];file.value='';if(!files.length)return;action(async()=>{let imported=0;const failures:string[]=[];for(const selected of files){try{if(selected.size>64*1024*1024)throw new Error(t('Project exceeds 64 MiB'));await importLibraryProject(new Uint8Array(await selected.arrayBuffer()));imported++;}catch(error){failures.push(`${selected.name}: ${error instanceof Error?error.message:String(error)}`);}}trash=false;trashButton.textContent=t('Trash');trashButton.setAttribute('aria-pressed','false');status.textContent=(imported===1?t('Imported 1 project.'):t`Imported ${imported} projects.`)+(failures.length?' '+failures.join(' '):'');});};
 search.oninput=()=>{void showProjects().catch(report);};
 return {refresh,open(){status.textContent='';dialog.showModal();action(async()=>{await recoverLibrary();});}};
}
