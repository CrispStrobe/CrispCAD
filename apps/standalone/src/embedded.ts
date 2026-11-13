import {t,setLocale} from '@brickwright/cad-core';
import {localizeHost} from './host-i18n.js';
try { setLocale(localStorage.getItem('brickwright-cad:locale') ?? navigator.language); } catch { setLocale(navigator.language); }
localizeHost();
import './app.css';
import { mountCadEditor } from '@brickwright/cad-editor';
import type { CadEditor } from '@brickwright/cad-editor';
import { createDocument, serializeDocument } from '@brickwright/cad-core';
import { attachCadProject, extractCadProject } from '@brickwright/cad-brickwright';
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import { download } from './files.js';
const wasmURL = new URL('../cad-assets/manifold.wasm', import.meta.url).href;
const status = document.querySelector<HTMLOutputElement>('#host-status')!;
const left = mountCadEditor(document.querySelector('#left')!, { wasmURL, document: createDocument('Host design A'), onExport: download, onDocumentChange: () => { status.textContent = t('Panel A changed'); } });
let right: CadEditor = mountCadEditor(document.querySelector('#right')!, { wasmURL, document: createDocument('Host design B'), onExport: download });
document.querySelector('#copy-left')!.addEventListener('click', () => { right.session.load(left.session.state.document); status.textContent = t('Copied A to B · undo histories remain independent'); });
document.querySelector('#remount')!.addEventListener('click', () => {
  const doc = right.session.state.document; right.dispose(); right = mountCadEditor(document.querySelector('#right')!, { wasmURL, document: doc, onExport: download }); status.textContent = t('Panel B remounted from its host-owned document');
});
document.querySelector('#bundle-test')!.addEventListener('click', () => {
  try {
    const original = zipSync({ 'project.json': strToU8(JSON.stringify({ targets: [], meta: { semver: '3.0.0' } })), 'brickwright/state.json': strToU8(JSON.stringify({ format: 'brickwright-state', version: 2, state: { simLab: { ldraw: '0 Existing LEGO model\n' } } })), 'untouched.txt': strToU8('unrelated project asset') });
    const saved = attachCadProject(original, left.session.state.document); const restored = extractCadProject(saved)!; const after = unzipSync(saved), before = unzipSync(original);
    if (strFromU8(after['brickwright/state.json']) !== strFromU8(before['brickwright/state.json']) || strFromU8(after['untouched.txt']) !== 'unrelated project asset' || serializeDocument(restored) !== left.session.serialize()) throw new Error(t('Round-trip changed existing state'));
    right.session.load(restored); status.textContent = t('SB3 round-trip passed · existing sections and assets preserved');
  } catch (error) { status.textContent = String(error); }
});
