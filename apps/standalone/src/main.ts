import './app.css';
import { Capacitor } from '@capacitor/core';
import { mountCadEditor } from '@brickwright/cad-editor';
import { parseDocument, serializeDocument } from '@brickwright/cad-core';
import type { CadDocument } from '@brickwright/cad-core';
import { download } from './files.js';
const STORAGE_KEY = 'brickwright-cad:standalone:v1';
const root = document.querySelector<HTMLElement>('#cad-root')!; const badge = document.querySelector<HTMLElement>('#save-state')!;
let initial: CadDocument | undefined; let failedRaw: string | null = null;
try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) { failedRaw = raw; initial = parseDocument(raw); failedRaw = null; badge.textContent = 'Restored local project'; } } catch (error) {
  if (failedRaw !== null) recovery(error, failedRaw); else { badge.textContent = 'Local storage unavailable · save files to keep your work'; badge.className = 'error'; start(); }
}
if (!root.childElementCount) start(initial);
function start(doc?: CadDocument) {
  root.replaceChildren();
  try {
    mountCadEditor(root, {
      document: doc, wasmURL: new URL('../cad-assets/manifold.wasm', import.meta.url).href,
      onExport: download,
      requestNew: () => confirm('Start a new design? Save a project file first if you want to keep this design separately.'),
      onDocumentChange(document) {
        try { localStorage.setItem(STORAGE_KEY, serializeDocument(document)); badge.textContent = 'Saved on this device'; badge.className = ''; }
        catch { badge.textContent = 'Autosave failed · use Save project'; badge.className = 'error'; }
      },
      onError() { /* The editor displays operation failures without replacing the host's save status. */ },
    });
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
if (!Capacitor.isNativePlatform() && import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* Local file exports remain available. */ });
