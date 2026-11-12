import './app.css';
import { Capacitor } from '@capacitor/core';
import { mountCadEditor } from '@brickwright/cad-editor';
import { parseDocument, serializeDocument } from '@brickwright/cad-core';
import type { CadDocument } from '@brickwright/cad-core';
import { download } from './files.js';
import {historyStore,mountHistoryUI} from './history-ui.js';
import type {CadEditor} from '@brickwright/cad-editor';
import type {ModelRevision} from '@brickwright/cad-history';
const STORAGE_KEY = 'brickwright-cad:standalone:v1';
const root = document.querySelector<HTMLElement>('#cad-root')!; const badge = document.querySelector<HTMLElement>('#save-state')!;
let editor:CadEditor|undefined;let saveToken=0;let lastSave:Promise<void>=Promise.resolve();let restoring:ModelRevision|undefined;
const historyUI=mountHistoryUI(()=>editor,async revision=>{
 const current=editor;if(!current)return;const expectedRevision=current.session.state.revision;const store=await historyStore;
 await store.append(current.session.state.document,'Before restoring an iteration');
 const doc=await store.readDocument(revision.id);if(editor!==current||current.session.state.revision!==expectedRevision)throw new Error('The model changed while loading this iteration. Try restoring again.');restoring=revision;current.session.load(doc);await lastSave;await current.whenIdle();current.frame();
});
document.querySelector('#history')!.addEventListener('click',()=>historyUI.open());
async function record(document:CadDocument,label:string,parentId?:string){
 const token=++saveToken;let cacheFailed=false;badge.textContent='Saving iteration…';badge.className='';
 try{localStorage.setItem(STORAGE_KEY,serializeDocument(document));}catch{cacheFailed=true;}
 try{const store=await historyStore;const revision=await store.append(document,label,parentId);if(token===saveToken){badge.textContent=cacheFailed?`Iteration ${revision.serial} saved · workspace cache unavailable`:`Saved · iteration ${revision.serial}`;badge.className='';}}
 catch(error){if(token===saveToken){badge.textContent='History save failed · save a project file';badge.className='error';}throw error;}
}
let initial: CadDocument | undefined; let failedRaw: string | null = null;
try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { failedRaw = raw; initial = parseDocument(raw); failedRaw = null; badge.textContent = 'Restored local project'; } } catch (error) {
  if (failedRaw !== null) recovery(error, failedRaw); else { badge.textContent = 'Local storage unavailable · save files to keep your work'; badge.className = 'error'; start(); }
}
if (!root.childElementCount) start(initial);
function start(doc?: CadDocument) {
  root.replaceChildren();
  try {
    editor = mountCadEditor(root, {
      document: doc, wasmURL: new URL('../cad-assets/manifold.wasm', import.meta.url).href,
      onExport: download,
      requestNew: () => confirm('Start a new design? Save a project file first if you want to keep this design separately.'),
      onDocumentChange(document) {
        const prior=restoring;restoring=undefined;
        lastSave=record(document,prior?`Restored iteration ${prior.serial}`:editor?.session.state.label??'Edit',prior?.id);
        return lastSave;
      },
      onError() { /* The editor displays operation failures without replacing the host's save status. */ },
    });
    lastSave=record(editor.session.state.document,'Opened model');void lastSave.catch(()=>{});
  } catch (error) { recovery(error, null); }
}
function recovery(error: unknown, raw: string | null) {
  root.replaceChildren(); const panel = document.createElement('section'); panel.className = 'recovery';
  const title = document.createElement('h1'); title.textContent = raw ? 'Your saved project needs recovery' : 'The 3D editor could not start';
  const info = document.createElement('p'); info.textContent = `${error instanceof Error ? error.message : error}${raw ? '. Your saved data has not been overwritten.' : '. WebGL 2 and WebAssembly are required.'}`; panel.append(title, info);
  if (raw) { const save = document.createElement('button'); save.textContent = 'Download saved data'; save.onclick = () => { void download({ name: 'brickwright-cad-recovery.json', bytes: new TextEncoder().encode(raw), mime: 'application/json' }); }; panel.append(save); }
  const fresh = document.createElement('button'); fresh.textContent = 'Start fresh'; fresh.onclick = () => { if (!confirm('Replace the local autosave? Download any recoverable data first.')) return; try { localStorage.removeItem(STORAGE_KEY); } catch {} start(); }; panel.append(fresh); root.append(panel);
}
const help = document.querySelector<HTMLDialogElement>('#help-dialog')!;
document.querySelector('#help')!.addEventListener('click', () => help.showModal()); document.querySelector('#close-help')!.addEventListener('click', () => help.close());
if (!window.brickwrightDesktop && !Capacitor.isNativePlatform() && import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* Local file exports remain available. */ });

const licenseDetails=document.querySelector('#licenses')!.parentElement as HTMLDetailsElement;
licenseDetails.addEventListener('toggle',()=>{if(licenseDetails.open)void fetch(new URL('../cad-assets/notices.txt',import.meta.url)).then(r=>{if(!r.ok)throw Error('License notices could not be read');return r.text();}).then(text=>{document.querySelector('#licenses')!.textContent=text;}).catch(error=>{document.querySelector('#licenses')!.textContent=String(error);});});
