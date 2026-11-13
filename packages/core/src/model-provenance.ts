// SPDX-License-Identifier: BSD-3-Clause
import type {CadDocument} from './document.js';
import {validateModelLibraryCatalogue} from './model-library.js';
import type {ModelLibraryAsset, ModelLibraryFile} from './model-library.js';

/** A retained curation snapshot, not independent verification of rights or geometry. */
export interface ModelProvenanceRecord {
  id: string;
  asset: ModelLibraryAsset;
  selectedFile: ModelLibraryFile;
  /** Explicit changes made when incorporating the selected file, including unchanged. */
  modificationNotes: string;
}
export interface ModelProvenance {version: 1; records: ModelProvenanceRecord[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:string)=>Object.keys(v).every(k=>allowed.split(' ').includes(k));
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
const sameFile=(a:ModelLibraryFile,b:ModelLibraryFile)=>a.url===b.url&&a.format===b.format&&a.sha256===b.sha256&&a.bytes===b.bytes;
/** Validate references and their complete source snapshots; never mutate old documents. */
export function checkModelProvenance(document:CadDocument):void {
  function fail(reason:string):never {throw new Error(`Invalid CAD project provenance: ${reason}`);}
  // Versions 1–4 permitted arbitrary extension fields with this spelling.
  // Preserve those fields as opaque data; only v5 establishes this contract.
  if(document.version<5)return;
  const metadata:unknown=document.provenance;
  const nodes=Object.values(document.nodes);
  if(metadata===undefined){if(nodes.some(n=>n.provenance!==undefined))fail('missing source records');return;}
  if(!object(metadata)||!keys(metadata,'version records')||metadata.version!==1||!Array.isArray(metadata.records)||metadata.records.length>1000)fail('unsupported metadata version or records');
  const records=metadata.records as unknown[];const known=new Set<string>();
  for(const raw of records){
    if(!object(raw)||!keys(raw,'id asset selectedFile modificationNotes')||!id(raw.id)||known.has(raw.id))fail('invalid or duplicate record identity');
    known.add(raw.id);
    if(typeof raw.modificationNotes!=='string'||!raw.modificationNotes.trim()||raw.modificationNotes.length>4096||/[\u0000-\u001f]/.test(raw.modificationNotes))fail('explicit modification notes required');
    const checked=validateModelLibraryCatalogue({format:'brickwright-model-library',version:1,assets:[raw.asset]});
    if(!checked.valid)fail(checked.errors.join(' '));
    const asset=checked.catalogue.assets[0];
    if(!object(raw.selectedFile)||!keys(raw.selectedFile,'url format sha256 bytes')||![asset.original,asset.editableSource,...asset.derivatives].some(f=>f&&sameFile(f,raw.selectedFile as unknown as ModelLibraryFile)))fail('selected file must exactly identify a retained asset file');
  }
  const used=new Set<string>();
  for(const node of nodes){
    if(node.provenance===undefined)continue;
    if(!Array.isArray(node.provenance)||!node.provenance.length||node.provenance.length>1000||new Set(node.provenance).size!==node.provenance.length||!node.provenance.every(ref=>typeof ref==='string'&&known.has(ref)))fail('invalid node source references');
    node.provenance.forEach(ref=>used.add(ref));
  }
  if(used.size!==known.size)fail('unreferenced source record');
}
/** Called only on a mutable draft: dropping geometry drops its unused source snapshots. */
export function pruneModelProvenance(document:CadDocument):void {
  if(document.version!==5||!document.provenance)return;
  const used=new Set(Object.values(document.nodes).flatMap(n=>n.provenance??[]));
  document.provenance={version:1,records:document.provenance.records.filter(r=>used.has(r.id))};
}

/** Refuse ambiguous upgrades rather than overwrite formerly opaque extension data. */
export function assertProvenanceUpgrade(document:CadDocument):void {
  if(document.version<5&&(Object.hasOwn(document,'provenance')||Object.values(document.nodes).some(node=>Object.hasOwn(node,'provenance')))) {
    throw new Error('Cannot upgrade legacy opaque provenance fields to document version 5');
  }
}
