import {t,getLocale,translateHistoryLabel} from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
import type {CadEditor} from '@brickwright/cad-editor';
import type {ModelRevision} from '@brickwright/cad-history';
import {historyStore} from './project-store.js';
import {recoverLibrary,saveProject} from './library.js';
export {historyStore} from './project-store.js';
export function mountHistoryUI(getEditor:()=>CadEditor|undefined,restore:(revision:ModelRevision)=>Promise<void>){
 const select=document.querySelector<HTMLSelectElement>('#iterations')!;
 const dialog=document.createElement('dialog');dialog.className='library-dialog';dialog.setAttribute('aria-label',t('Project library'));
 const header=document.createElement('header'),heading=document.createElement('h1');heading.textContent=t('Projects');const close=document.createElement('button');close.textContent=t('Close');close.setAttribute('aria-label',t('Close project library'));close.onclick=()=>dialog.close();header.append(heading,close);
 const search=document.createElement('input');search.type='search';search.placeholder=t('Search projects');search.setAttribute('aria-label',t('Search projects'));
 const toolbar=document.createElement('div');toolbar.className='library-actions';
 const makeButton=(name:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=name;b.onclick=action;toolbar.append(b);return b;};
 const projects=document.createElement('section');projects.setAttribute('aria-label',t('Saved projects'));
 const status=document.createElement('p');status.className='library-status';status.setAttribute('role','status');
 const file=document.createElement('input');file.type='file';file.accept='.bcad,.bcadhistory,.json';file.hidden=true;
 dialog.append(header,search,toolbar,projects,status,file);document.body.append(dialog);
 let model='',before:number|undefined,revisionToken=0;
 const action=(fn:()=>Promise<void>)=>{void fn().catch(error=>{status.textContent=error instanceof Error?error.message:String(error);});};
 async function showProjects(){const store=await historyStore;await store.flush();projects.replaceChildren();for(const p of await store.listProjects()){if(search.value&&!p.title.toLowerCase().includes(search.value.toLowerCase()))continue;const row=document.createElement('article');row.className='project-card';const icon=document.createElement('span');icon.className='project-icon';icon.textContent='◇';const title=document.createElement('strong');title.textContent=p.title;const info=document.createElement('small');info.textContent=t`${p.serial} iterations · ${new Date(p.updatedAt).toLocaleString(getLocale())}`;const label=document.createElement('div');label.append(title,info);const open=document.createElement('button');open.textContent=t('Open');open.setAttribute('aria-label',t`Open project ${p.title}`);open.onclick=()=>action(async()=>{const revision=await store.getRevision(p.headId);if(!revision)throw new Error(t('Saved project is missing'));await restore(revision);dialog.close();});row.append(icon,label,open);projects.append(row);}if(!projects.childElementCount)projects.textContent=t('No projects match.');}
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
 makeButton(t('New project'),()=>{const editor=getEditor();if(!editor)return;void import('@brickwright/cad-core').then(({createDocument})=>{editor.session.load(createDocument());dialog.close();});});
 makeButton(t('Open file…'),()=>file.click());makeButton(t('Save copy with history…'),()=>action(async()=>{const editor=getEditor();if(editor)await saveProject(editor.session.state.document);}));
 file.onchange=()=>action(async()=>{const selected=file.files?.[0];file.value='';if(!selected)return;if(selected.size>64*1024*1024)throw new Error(t('Project exceeds 64 MiB'));await getEditor()?.openFile(selected.name,new Uint8Array(await selected.arrayBuffer()));dialog.close();});
 search.oninput=()=>action(showProjects);
 return {refresh,open(){dialog.showModal();action(async()=>{await recoverLibrary();await showProjects();});}};
}
