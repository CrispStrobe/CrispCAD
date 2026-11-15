import {t,setLocale,getLocale} from '@brickwright/cad-core';
import {localizeHost} from './host-i18n.js';
import './app.css';
import { Capacitor } from '@capacitor/core';
import { mountCadEditor } from '@brickwright/cad-editor';
import { parseDocument, serializeDocument } from '@brickwright/cad-core';
import type { CadDocument } from '@brickwright/cad-core';
import { download } from './files.js';
import {historyStore,mountHistoryUI} from './history-ui.js';
import type {CadEditor} from '@brickwright/cad-editor';
import type {ModelRevision} from '@brickwright/cad-history';
import {saveProject,decodeProject,scheduleLibrarySave,flushLibrary,initializeLibrary} from './library.js';
import {mountAppDialogs} from './app-dialogs.js';
import {createModelLibraryBrowserCache} from './model-library-cache.js';
import {createBundledModelLibrary} from './model-library-local.js';
import {mountDesktopHost} from './desktop.js';
try { setLocale(localStorage.getItem('brickwright-cad:locale') ?? navigator.language); } catch { setLocale(navigator.language); }
localizeHost();
if(window.brickwrightDesktop)void window.webkit?.messageHandlers.cadHost?.postMessage({action:'locale',data:getLocale()}).catch(()=>{});
const STORAGE_KEY = 'brickwright-cad:standalone:v1';
const root = document.querySelector<HTMLElement>('#cad-root')!; const badge = document.querySelector<HTMLElement>('#save-state')!;
const hostActions=document.querySelector<HTMLElement>('#host-actions')!;
let editor:CadEditor|undefined;let saveToken=0;let lastSave:Promise<void>=Promise.resolve();let restoring:ModelRevision|undefined;
const historyUI=mountHistoryUI(()=>editor,async revision=>{
 const current=editor;if(!current)return;const expectedRevision=current.session.state.revision;const store=await historyStore;
 await store.append(current.session.state.document,'Before restoring an iteration');
 const doc=await store.readDocument(revision.id);if(editor!==current||current.session.state.revision!==expectedRevision)throw new Error(t('The model changed while loading this iteration. Try restoring again.'));restoring=revision;current.session.load(doc);await lastSave;await current.whenIdle();current.frame();
},prepareToClose);
document.querySelector('#library')!.addEventListener('click',()=>historyUI.open());
let showReadout=false;try{showReadout=localStorage.getItem('brickwright-cad:view:readout')==='true';}catch{}
function saveReadout(visible:boolean){showReadout=visible;try{localStorage.setItem('brickwright-cad:view:readout',String(visible));}catch{}}
let navigationPreset:'tinkercad'|'fusion'='tinkercad';try{if(localStorage.getItem('brickwright-cad:view:navigation')==='fusion')navigationPreset='fusion';}catch{}
function saveNavigation(value:'tinkercad'|'fusion'){localStorage.setItem('brickwright-cad:view:navigation',value);navigationPreset=value;editor?.setNavigation(value);}
let resizeControls:'dimensions'|'gizmo'='dimensions';try{if(localStorage.getItem('brickwright-cad:view:resize-controls')==='gizmo')resizeControls='gizmo';}catch{}
function saveResizeControls(value:'dimensions'|'gizmo'){resizeControls=value;try{localStorage.setItem('brickwright-cad:view:resize-controls',value);}catch{}editor?.setResizeControls(value);}
let shapeBrowserLayout:'popover'|'docked'='popover';try{if(localStorage.getItem('brickwright-cad:view:shape-browser')==='docked')shapeBrowserLayout='docked';}catch{}
function saveShapeBrowser(value:'popover'|'docked'){shapeBrowserLayout=value;try{localStorage.setItem('brickwright-cad:view:shape-browser',value);}catch{}}
const defaultAppearance={background:'#111e29',baseplate:'#233644'};let appearance={...defaultAppearance};try{const saved=JSON.parse(localStorage.getItem('brickwright-cad:view:appearance')??'null');if(saved&&/^#[0-9a-f]{6}$/i.test(saved.background)&&/^#[0-9a-f]{6}$/i.test(saved.baseplate))appearance=saved;}catch{}
function saveAppearance(value:typeof appearance){localStorage.setItem('brickwright-cad:view:appearance',JSON.stringify(value));appearance={...value};editor?.setAppearance(value);}
mountAppDialogs({getResizeControls:()=>editor?.resizeControls??resizeControls,setResizeControls:saveResizeControls,getShapeBrowser:()=>editor?.shapeBrowserLayout??shapeBrowserLayout,setShapeBrowser:value=>{saveShapeBrowser(value);editor?.setShapeBrowserLayout(value);},getNavigation:()=>navigationPreset,setNavigation:saveNavigation,getAppearance:()=>({...appearance}),setAppearance:saveAppearance,getReadout:()=>editor?.transformReadoutVisible??showReadout,setReadout:visible=>{saveReadout(visible);editor?.setTransformReadoutVisible(visible);},setLanguage:async language=>{await prepareToClose();try{localStorage.setItem('brickwright-cad:locale',language);}catch{throw new Error(t('Language preference could not be saved'));}await window.webkit?.messageHandlers.cadHost?.postMessage({action:'locale',data:language});location.reload();}});
const desktop=mountDesktopHost(()=>editor,{projects:()=>historyUI.open(),about:()=>hostActions.querySelector<HTMLButtonElement>('#about')!.click(),settings:()=>hostActions.querySelector<HTMLButtonElement>('#settings')!.click(),help:()=>hostActions.querySelector<HTMLButtonElement>('#help')!.click()});
async function record(document:CadDocument,label:string,parentId?:string){
 const token=++saveToken;let cacheFailed=false;badge.textContent=t('Saving iteration…');badge.className='';
 try{localStorage.setItem(STORAGE_KEY,serializeDocument(document));}catch{cacheFailed=true;}
 try{const store=await historyStore;const revision=await store.append(document,label,parentId);if(token===saveToken){badge.textContent=cacheFailed?t`Iteration ${revision.serial} saved · workspace cache unavailable`:t`Saved · iteration ${revision.serial}`;badge.title=badge.textContent;badge.className='';await historyUI.refresh(document.id,revision.id);}scheduleLibrarySave(document.id,error=>{badge.textContent=t`Library file save failed: ${String(error)}`;badge.title=badge.textContent;badge.className='error';});}
 catch(error){if(token===saveToken){badge.textContent=t('History save failed · keep this window open');badge.title=badge.textContent;badge.className='error';}throw error;}
}
let initial: CadDocument | undefined; let failedRaw: string | null = null;
try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { failedRaw = raw; initial = parseDocument(raw); failedRaw = null; badge.textContent = t('Restored local project'); } } catch (error) {
  if (failedRaw !== null) recovery(error, failedRaw); else { badge.textContent = t('Local storage unavailable · save files to keep your work'); badge.className = 'error'; start(); }
}
if (!root.childElementCount) start(initial);
void initializeLibrary().catch(error=>{badge.textContent=t`Library file recovery/save failed: ${String(error)}`;badge.title=badge.textContent;badge.className='error';});
async function prepareToClose(){
  let active:Element|null=document.activeElement;
  while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;
  if(active instanceof HTMLElement)active.blur();
  await lastSave;
  await (await historyStore).flush();
  await flushLibrary();
}
if(window.brickwrightDesktop)window.brickwrightPrepareToClose=prepareToClose;
function start(doc?: CadDocument) {
  root.replaceChildren();
  try {
    editor = mountCadEditor(root, {
      modelLibrary:{cache:createModelLibraryBrowserCache(),...createBundledModelLibrary()},
      document: doc, wasmURL: new URL('../cad-assets/manifold.wasm', import.meta.url).href,
      headerContent:hostActions,navigationPreset,resizeControls,shapeBrowserLayout,onShapeBrowserLayoutChange:saveShapeBrowser,nativeMenus:desktop.available,
      showTransformReadout:showReadout,onTransformReadoutChange:saveReadout,appearance,
      saveProject:async()=>{if(editor)await saveProject(editor.session.state.document);},
      decodeProject,
      requestOpen:desktop.available?()=>desktop.open('project'):undefined,
      requestImport:desktop.available?()=>desktop.open('geometry'):undefined,
      readClipboard:desktop.available?desktop.readClipboard:undefined,
      writeClipboard:desktop.available?desktop.writeClipboard:undefined,
      onCommandStateChange:desktop.publish,
      onExport: download,
      requestNew:async()=>{await lastSave;await (await historyStore).flush();return true;},
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
  const title = document.createElement('h1'); title.textContent = raw ? t('Your saved project needs recovery') : t('The 3D editor could not start');
  const info = document.createElement('p'); info.textContent = `${error instanceof Error ? error.message : error}${raw ? t('. Your saved data has not been overwritten.') : t('. WebGL 2 and WebAssembly are required.')}`; panel.append(title, info);
  if (raw) { const save = document.createElement('button'); save.textContent = t('Download saved data'); save.onclick = () => { void download({ name: 'brickwright-cad-recovery.json', bytes: new TextEncoder().encode(raw), mime: 'application/json' }); }; panel.append(save); }
  const fresh = document.createElement('button'); fresh.textContent = t('Start fresh'); fresh.onclick = () => { if (!confirm(t('Replace the local autosave? Download any recoverable data first.'))) return; try { localStorage.removeItem(STORAGE_KEY); } catch {} start(); }; panel.append(fresh); root.append(panel);
}
const help = document.querySelector<HTMLDialogElement>('#help-dialog')!;
hostActions.querySelector('#help')!.addEventListener('click', () => help.showModal()); document.querySelector('#close-help')!.addEventListener('click', () => help.close());
if (!window.brickwrightDesktop && !Capacitor.isNativePlatform() && import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* Local file exports remain available. */ });

const licenseDetails=document.querySelector('#licenses')!.parentElement as HTMLDetailsElement;
licenseDetails.addEventListener('toggle',()=>{if(licenseDetails.open)void fetch(new URL('../cad-assets/notices.txt',import.meta.url)).then(r=>{if(!r.ok)throw Error(t('License notices could not be read'));return r.text();}).then(text=>{document.querySelector('#licenses')!.textContent=text;}).catch(error=>{document.querySelector('#licenses')!.textContent=String(error);});});

// Browser page gestures must not zoom/scroll the CAD chrome. OrbitControls still
// receives ordinary one/two-pointer gestures within the modeling canvas.
for(const event of ['gesturestart','gesturechange','gestureend'])document.addEventListener(event,e=>e.preventDefault(),{passive:false});
document.addEventListener('touchstart',e=>{if(e.touches.length>=3)e.preventDefault();},{passive:false});
