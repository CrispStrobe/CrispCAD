// SPDX-License-Identifier: BSD-3-Clause
import {fetchModelLibraryFile, parseModelLibraryCatalogue, validateModelLibraryCatalogue, t} from '@brickwright/cad-core';
import type {CadDocument, CadSession, ModelLibraryCatalogue, ModelLibraryAsset, ModelLibraryFile, ModelLibraryFileSelection, ModelLibraryFileCache} from '@brickwright/cad-core';
import {insertModelLibrarySource, insertModelLibrarySTL, MODEL_LIBRARY_MESH_MAX_BYTES} from '@brickwright/cad-geometry';
import type {GeometryResult} from '@brickwright/cad-geometry';

export interface ModelLibraryOptions {
  /** Reviewed remote/local catalogue. Convert collection manifests explicitly first. */
  catalogue?: ModelLibraryCatalogue;
  /** Explicit host-bundled bytes keyed by validated library-relative identity. */
  localFiles?: ReadonlyMap<string, Uint8Array>;
  cache: ModelLibraryFileCache;
  fetch?: typeof globalThis.fetch;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag:K, text?:string) => {
  const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;
};
const noCache:ModelLibraryFileCache={async read(){return undefined;},async write(){throw new Error('Storage unavailable');},async remove(){}};

/** Metadata browsing performs no network IO. Only an explicit insertion retrieves one STL. */
export function mountModelLibraryPanel(parent:HTMLElement, session:CadSession,
  evaluate:(document:CadDocument)=>Promise<GeometryResult>, options:ModelLibraryOptions|undefined,
  inserted:()=>Promise<void>) {
  let catalogue:ModelLibraryCatalogue={format:'brickwright-model-library',version:1,assets:[]};
  let initialError='';
  if(options?.catalogue){const result=validateModelLibraryCatalogue(options.catalogue);if(!result.valid)initialError=result.errors.join(' ');else catalogue=result.catalogue;}
  const localFiles=new Map([...options?.localFiles??[]].map(([path,bytes])=>[path,bytes.slice()]));
  let disposed=false, working=false, selected:ModelLibraryAsset|undefined, controller:AbortController|undefined;
  const dialog=el('dialog');dialog.className='model-library-dialog';dialog.setAttribute('aria-label',t('Model library'));
  const heading=el('header'),title=el('h2',t('Model library')),close=el('button',t('Close model library'));
  close.type='button';close.onclick=()=>{controller?.abort();dialog.close();};heading.append(title,close);
  const help=el('p',t('Browse reviewed models. Bundled editable sources work offline; remote STL files download only when inserted.'));
  const tools=el('div');tools.className='model-library-tools';
  const search=el('input');search.type='search';search.setAttribute('aria-label',t('Search models'));search.placeholder=t('Search models');
  const load=el('label',t('Open catalogue JSON'));const file=el('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label',t('Open catalogue JSON'));load.append(file);
  tools.append(search,load);
  const layout=el('div');layout.className='model-library-layout';const list=el('div');list.className='model-library-list';list.setAttribute('aria-label',t('Catalogue models'));const details=el('section');details.className='model-library-details';layout.append(list,details);
  const status=el('p');status.setAttribute('role','status');status.setAttribute('aria-label',t('Model library status'));status.textContent=initialError;
  dialog.append(heading,help,tools,layout,status);parent.append(dialog);
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.addEventListener('cancel',()=>controller?.abort());
  const report=(error:unknown)=>{status.textContent=error instanceof Error?error.message:String(error);};
  const link=(label:string,url:string)=>{const anchor=el('a',label);anchor.href=url;anchor.target='_blank';anchor.rel='noopener noreferrer';return anchor;};
  function renderList(){
    list.replaceChildren();const query=search.value.trim().toLocaleLowerCase();
    const matches=catalogue.assets.filter(asset=>`${asset.title} ${asset.author} ${asset.licence.spdx}`.toLocaleLowerCase().includes(query));
    if(!matches.length)list.append(el('p',catalogue.assets.length?t('No matching models.'):t('No published catalogue is bundled. Open a reviewed remote catalogue JSON to browse models.')));
    for(const asset of matches){const button=el('button',`${asset.title} · ${asset.licence.spdx}`);button.type='button';button.disabled=working;button.setAttribute('aria-pressed',String(selected?.id===asset.id));button.onclick=()=>{selected=asset;renderList();renderDetails();};list.append(button);}
  }
  function renderDetails(){
    details.replaceChildren();const asset=selected;if(!asset)return;
    details.append(el('h3',asset.title),el('p',`${asset.author} · ${asset.licence.spdx} · ${asset.version}`),el('p',asset.licence.attribution),link(t('Original source'),asset.sourceUrl),document.createTextNode(' · '),link(t('Licence evidence'),asset.licence.evidenceUrl),el('p',asset.modificationNotes),el('p',asset.conversion.unitAssumption));
    const localSource=[asset.editableSource,asset.original].find(source=>source?.path&&['cad-script','openscad','jscad'].includes(source.format));
    if(localSource){renderSource(asset,localSource);return;}
    const quality=asset.quality;
    details.append(el('p',t('Mesh checks are curator evidence; insertion repeats the checks. They do not prove printability, mechanical accuracy or collision safety.')));
    if(quality)details.append(el('p',`${quality.toolVersion} · ${quality.checkedOn}`));
    const files=el('select');files.setAttribute('aria-label',t('Selected library STL'));
    const choices:{file:ModelLibraryFile;selection:ModelLibraryFileSelection}[]=[{file:asset.original,selection:{assetId:asset.id,file:'original' as const}},...asset.derivatives.map((file,i)=>({file,selection:{assetId:asset.id,file:{derivative:i}}}))].filter(({file})=>file.format==='stl');
    choices.forEach(({file},i)=>{const option=el('option',`${i+1}: STL · ${file.bytes.toLocaleString()} bytes · ${file.sha256.slice(0,12)}`);option.value=String(i);files.append(option);});
    const identity=el('p');identity.className='model-library-hash';
    const conversion=el('div');conversion.className='model-library-conversion';
    const noteLabel=el('label',t('Incorporation modification notes'));const notes=el('input');notes.type='text';notes.maxLength=4096;notes.setAttribute('aria-label',t('Incorporation modification notes'));notes.placeholder=t('Describe conversion and any changes');noteLabel.append(notes);
    const offlineLabel=el('label',t('Use cached files only'));const offline=el('input');offline.type='checkbox';offlineLabel.prepend(offline);
    const insert=el('button',t('Insert selected STL'));insert.type='button';insert.className='primary';
    const eligibility=el('p');
    function refresh(){const chosen=choices[Number(files.value)];const q=asset!.quality;const admitted=!!chosen&&!chosen.file.path&&chosen.file.bytes<=MODEL_LIBRARY_MESH_MAX_BYTES&&!!q?.screeningPolicy&&chosen.file.bytes<=q.screeningPolicy.maxAnalysisBytes&&q.fileSha256===chosen.file.sha256&&q.parseable&&q.closedPositiveVolume&&q.withinSizeLimits&&q.withinTriangleLimits;
      identity.textContent=chosen?`${chosen.file.sha256}\n${chosen.file.url??chosen.file.path}`:'';
      conversion.replaceChildren();
      if(chosen&&q?.fileSha256===chosen.file.sha256&&q.screeningPolicy){const policy=q.screeningPolicy;conversion.append(el('h4',t('Selected STL conversion to millimetres, Z up')),el('pre',Array.from({length:4},(_,row)=>Array.from({length:4},(_,column)=>String(policy.toMillimetresZUp[column*4+row])).join('  ')).join('\n')),el('p',t`Curated limits: ${policy.maxTriangles} triangles; ${policy.maxExtentMm} mm span per axis; ${policy.maxAnalysisBytes} analysis bytes. Translation is preserved; no centering or repair.`));}
      insert.disabled=working||!admitted||!notes.value.trim();eligibility.textContent=admitted?t('Selected STL has passing curated checks and a recorded conversion.'):t('Insertion unavailable: select an STL with passing quality, a recorded conversion and at most 16 MiB.');}
    files.onchange=refresh;notes.oninput=refresh;
    insert.onclick=async()=>{
      if(working||insert.disabled)return;
      const chosen=choices[Number(files.value)],initial=session.state,modificationNotes=notes.value.trim(),offlineOnly=offline.checked;
      working=true;controller=new AbortController();file.disabled=true;search.disabled=true;files.disabled=true;notes.disabled=true;offline.disabled=true;refresh();renderList();status.textContent=t('Verifying selected model…');
      try{
        const fetched=await fetchModelLibraryFile(catalogue,chosen.selection,{cache:options?.cache??noCache,fetch:options?.fetch,offline:offlineOnly,signal:controller.signal,maxBytes:MODEL_LIBRARY_MESH_MAX_BYTES});
        if(disposed)throw new Error(t('Editor was disposed'));
        if(session.state.document!==initial.document||session.state.revision!==initial.revision)throw new Error(t('The model changed while loading this library file. Retry insertion.'));
        await insertModelLibrarySTL(session,catalogue,chosen.selection,fetched.bytes,{evaluate:async doc=>{const result=await evaluate(doc);if(disposed)throw new Error(t('Editor was disposed'));return result;},toMillimetresZUp:asset.quality!.screeningPolicy!.toMillimetresZUp,checkedOn:new Date().toISOString().slice(0,10),modificationNotes,signal:controller.signal});
        status.textContent=fetched.cached?t('Inserted with provenance. Verified file is cached for offline reuse.'):t('Inserted with provenance. File could not be cached for offline reuse.');
        try{await inserted();}catch(error){if(!disposed)status.textContent=t('Model inserted with provenance; viewport refresh failed. Close this panel to inspect the editor status.');}
      }catch(error){if(!disposed)report(error);}finally{working=false;controller=undefined;file.disabled=false;search.disabled=false;files.disabled=false;notes.disabled=false;offline.disabled=false;refresh();renderList();}
    };
    details.append(files,identity,conversion,eligibility,noteLabel,offlineLabel,insert);refresh();
  }
  function renderSource(asset:ModelLibraryAsset,source:ModelLibraryFile){
    const bytes=source.path?localFiles.get(source.path):undefined;
    details.append(el('p',t('Bundled editable source. Insertion verifies its hash and evaluates the code; no mesh download or collision qualification.')),el('p',`${source.format} · ${source.bytes} bytes · ${source.path}`),el('pre',source.sha256));
    if(source.format==='openscad')details.append(el('p',t('OpenSCAD source is converted to editable CAD Script using the supported subset. The original artifact hash is retained.')));
    if(source.format==='jscad'){
      details.append(el('p',t('JSCAD is converted with default parameters to an editable CAD Script snapshot. Original JavaScript parameters and face colours are not retained; unsupported features are refused.')));
    }
    const label=el('label',t('Incorporation modification notes')),notes=el('input');notes.type='text';notes.maxLength=source.format==='jscad'?3500:3900;notes.setAttribute('aria-label',t('Incorporation modification notes'));notes.placeholder=t('Describe conversion and any changes');label.append(notes);
    const insert=el('button',t('Insert editable source'));insert.type='button';insert.className='primary';
    const refresh=()=>{insert.disabled=working||!bytes||!notes.value.trim();};notes.oninput=refresh;
    if(!bytes)details.append(el('p',t('Editable source is not bundled in this host.')));
    insert.onclick=async()=>{
      if(insert.disabled||!bytes)return;
      working=true;controller=new AbortController();file.disabled=search.disabled=notes.disabled=true;refresh();renderList();status.textContent=t('Verifying selected model…');
      try{
        await insertModelLibrarySource(session,catalogue,{assetId:asset.id,file:source===asset.original?'original':'editableSource'},bytes,{signal:controller.signal,modificationNotes:notes.value.trim(),evaluate:async doc=>{const result=await evaluate(doc);if(disposed)throw new Error(t('Editor was disposed'));return result;}});
        status.textContent=t('Editable source inserted with provenance. Available offline.');
        try{await inserted();}catch{if(!disposed)status.textContent=t('Model inserted with provenance; viewport refresh failed. Close this panel to inspect the editor status.');}
      }catch(error){if(!disposed)report(error);}finally{working=false;controller=undefined;file.disabled=search.disabled=notes.disabled=false;refresh();renderList();}
    };
    details.append(label,insert);refresh();
  }
  search.oninput=renderList;
  file.onchange=async()=>{const chosen=file.files?.[0];file.value='';if(!chosen||working)return;try{if(chosen.size>4*1024*1024)throw new Error(t('Catalogue exceeds 4 MiB'));const parsed=parseModelLibraryCatalogue(await chosen.text());if(disposed||working)return;if(!parsed.valid)throw new Error(parsed.errors.join(' '));catalogue=parsed.catalogue;selected=undefined;search.value='';status.textContent='';renderList();renderDetails();}catch(error){report(error);}};
  return {open(){if(!disposed&&!dialog.open){renderList();if(!working)renderDetails();dialog.showModal();}},dispose(){disposed=true;controller?.abort();dialog.remove();}};
}
