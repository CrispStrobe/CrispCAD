// SPDX-License-Identifier: BSD-3-Clause
import {fetchModelLibraryFile,parseModelLibraryCatalogue,validateModelLibraryCatalogue,t} from '@brickwright/cad-core';
import type {CadDocument,CadSession,ModelLibraryCatalogue,ModelLibraryAsset,ModelLibraryFile,ModelLibraryFileSelection,ModelLibraryFileCache} from '@brickwright/cad-core';
import {insertModelLibrarySource,insertModelLibrarySTL,MODEL_LIBRARY_MESH_MAX_BYTES} from '@brickwright/cad-geometry';
import type {GeometryResult} from '@brickwright/cad-geometry';
import {fetchArchiveFile,createArchiveBrowserCache,screenArchiveSTL} from './model-library-archive.js';
import {adafruitArchive} from './adafruit-archive-data.js';
import type {ModelLibraryArchive} from './model-library-archive.js';
export interface ModelLibraryProject {
 id:string;
 title:string;
 preview?:string|(()=>string);
 note?:string;
}
export interface ModelLibraryOptions {
 catalogue?:ModelLibraryCatalogue;
 localFiles?:ReadonlyMap<string,Uint8Array>;
 /** Host-reviewed thumbnails keyed by the exact original source SHA-256. */
 previews?:ReadonlyMap<string,string>;
 /** Asset ID takes precedence over a generic SPDX notice (copyright holders differ). */
 licenceTexts?:ReadonlyMap<string,string>;
 cache?:ModelLibraryFileCache;
 /** Loaded once on first opening; shared SDK catalogue stays out of initial editor startup. */
 load?:()=>Promise<ModelLibraryOptions>;
 fetch?:typeof globalThis.fetch;
}
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const noCache:ModelLibraryFileCache={async read(){return undefined;},async write(){throw new Error('Storage unavailable');},async remove(){}};
const fold=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
const MODELS_PER_PAGE=36;
/** Browse thumbnails without fetching model bytes or changing the active design. */
export function mountModelLibraryPanel(parent:HTMLElement,session:CadSession,evaluate:(document:CadDocument)=>Promise<GeometryResult>,options:ModelLibraryOptions|undefined,inserted:()=>Promise<void>,deliver?:(file:{name:string;bytes:Uint8Array;mime:string})=>void|Promise<void>,projects?:{items:readonly ModelLibraryProject[];open:(id:string)=>Promise<boolean|void>}){
 let catalogue:ModelLibraryCatalogue={format:'brickwright-model-library',version:1,assets:[]},initialError='';
 if(options?.catalogue){const checked=validateModelLibraryCatalogue(options.catalogue);if(checked.valid)catalogue=checked.catalogue;else initialError=checked.errors.join(' ');}
 const archive=adafruitArchive,archiveCache=options?.cache??createArchiveBrowserCache();
 let archivePreviews:Record<string,string>|undefined,archivePreviewLoading:Promise<void>|undefined;
 const loadArchivePreviews=()=>archivePreviewLoading??=(import('brickwright:adafruit-previews').then(({default:data})=>{
   if(data.upstreamCommit!==archive.upstreamCommit||data.archiveCommit!==archive.commit)throw new Error('Adafruit preview source revision mismatch');
   archivePreviews=data.previews;
 }).finally(()=>{archivePreviewLoading=undefined;}));
 let loading:Promise<void>|undefined,loaded=!options?.load;
 const localFiles=new Map([...options?.localFiles??[]].map(([path,bytes])=>[path,bytes.slice()]));
 let disposed=false,working=false,selected:ModelLibraryAsset|undefined,archiveSelection:ModelLibraryArchive['folders'][number]|undefined,controller:AbortController|undefined,selectedProject:ModelLibraryProject|undefined;
 const dialog=el('dialog');dialog.className='model-library-dialog';dialog.setAttribute('aria-label',t('Model library'));
 const heading=el('header'),title=el('h2',t('Model library')),close=el('button','×');close.type='button';close.className='library-close';close.setAttribute('aria-label',t('Close model library'));close.title=t('Close model library');close.onclick=()=>{controller?.abort();dialog.close();};heading.append(title,close);
 const tools=el('div');tools.className='model-library-tools';
 const search=el('input');search.type='search';search.setAttribute('aria-label',t('Search models'));search.placeholder=t('Search models');
 const filter=el('select');filter.setAttribute('aria-label',t('Model type'));for(const [value,label] of [['','All models'],...(projects?.items.length?[['models','CAD models only'],['projects','Robot projects']]:[]),['source','Editable source'],['mesh','Mesh']]){const option=el('option',t(label));option.value=value;filter.append(option);}
 const load=el('button','…');load.type='button';load.setAttribute('aria-label',t('Open catalogue JSON'));load.title=t('Open catalogue JSON');
 const file=el('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.setAttribute('aria-label',t('Catalogue file'));load.onclick=()=>file.click();
 tools.append(search,filter,load,file);
 const layout=el('div');layout.className='model-library-layout';const list=el('div');list.className='model-library-list';list.setAttribute('aria-label',t('Catalogue models'));const details=el('section');details.className='model-library-details';layout.append(list,details);
 const pages=el('div'),previous=el('button','‹'),nextPage=el('button','›'),modelRange=el('span');
 let page=0,pageCount=1;
 pages.className='model-library-pages';pages.setAttribute('role','group');pages.setAttribute('aria-label',t('Model pages'));
 previous.type=nextPage.type='button';
 previous.setAttribute('aria-label',t('Previous page'));previous.title=t('Previous page');
 nextPage.setAttribute('aria-label',t('Next page'));nextPage.title=t('Next page');
 modelRange.setAttribute('aria-live','polite');
 previous.onclick=()=>goToPage(page-1);nextPage.onclick=()=>goToPage(page+1);
 pages.append(previous,modelRange,nextPage);
 const status=el('p');status.className='model-library-status';status.setAttribute('role','status');status.setAttribute('aria-label',t('Model library status'));status.textContent=initialError;dialog.append(heading,tools,layout,pages,status);parent.append(dialog);
 dialog.addEventListener('keydown',event=>event.stopPropagation());dialog.addEventListener('cancel',()=>controller?.abort());
 const report=(error:unknown)=>{status.textContent=error instanceof Error?error.message:String(error);};
 const link=(label:string,url:string)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const sourceFor=(asset:ModelLibraryAsset)=>[asset.editableSource,asset.original].find(source=>source?.path&&['cad-script','openscad','jscad'].includes(source.format));
 function badge(asset:ModelLibraryAsset){const tag=el('span',asset.licence.spdx);tag.className='licence-tag';tag.dataset.licence=asset.licence.spdx;return tag;}
 function image(asset:ModelLibraryAsset){
  const url=options?.previews?.get(asset.original.sha256);
  if(url)return previewImage(asset.title,()=>url);
  const placeholder=el('span','◇');placeholder.className='preview-unavailable';placeholder.title=t('Preview unavailable');return placeholder;
 }
 function archiveImage(folder:ModelLibraryArchive['folders'][number]){
  if(folder.name==='Adafruit archive files'){const label=el('span','≡');label.className='preview-unavailable';label.title=t('Original source files');return label;}
  const image=previewImage(folder.name,()=>{
   if(archivePreviews)return archivePreviews[folder.name];
   return loadArchivePreviews().then(()=>archivePreviews?.[folder.name]);
  });
  image.dataset.adafruitPreview=folder.name;
  return image;
 }
 type LibraryItem=ModelLibraryProject|ModelLibraryAsset|ModelLibraryArchive['folders'][number];
 let cards=new Map<LibraryItem,HTMLButtonElement>();
 let pressedCard:HTMLButtonElement|undefined;
 let cardsDisabled=false,cardPreviews=options?.previews;
 const emptyList=el('p');
 const searchText=new WeakMap<LibraryItem,string>();
 function matchesSearch<Item extends LibraryItem>(item:Item,terms:string[],describe:(item:Item)=>string){
  if(!terms.length)return true;
  let text=searchText.get(item);
  if(text===undefined){text=fold(describe(item));searchText.set(item,text);}
  return terms.every(term=>text.includes(term));
 }
 const describeAsset=(asset:ModelLibraryAsset)=>`${asset.title} ${asset.author} ${asset.licence.spdx}`;
 const describeFolder=(folder:ModelLibraryArchive['folders'][number])=>`${folder.name} Adafruit ${folder.files.map(file=>file.path).join(' ')}`;
 const describeProject=(project:ModelLibraryProject)=>`${project.title} ${project.note??''}`;
 function refreshCards(){
  const selection=selectedProject??selected??archiveSelection;
  const next=selection?cards.get(selection):undefined;
  if(pressedCard!==next){
   pressedCard?.setAttribute('aria-pressed','false');
   next?.setAttribute('aria-pressed','true');
   pressedCard=next;
  }
  if(cardsDisabled!==working){
   for(const card of cards.values())card.disabled=working;
   cardsDisabled=working;
  }
  previous.disabled=working||page===0;
  nextPage.disabled=working||page+1>=pageCount;
 }
 function goToPage(index:number){
  if(working||index<0||index>=pageCount)return;
  page=index;list.scrollTop=0;renderList();
 }
 function resetPage(){page=0;list.scrollTop=0;}
 function createCard(onSelect:()=>void){
  const card=el('button');card.type='button';card.className='model-library-card';card.disabled=working;
  card.setAttribute('aria-pressed','false');
  card.onclick=()=>{if(working)return;onSelect();refreshCards();renderDetails();};
  return card;
 }
 function renderList(){
  const scroll=list.scrollTop,mode=filter.value;
  const terms=fold(search.value).trim().split(/\s+/).filter(Boolean);
  const matches=mode==='projects'?[]:catalogue.assets.filter(asset=>
   (!mode||mode==='models'||(mode==='source')===!!sourceFor(asset))&&matchesSearch(asset,terms,describeAsset));
  const archiveMatches=['source','projects'].includes(mode)?[]:archive.folders.filter(folder=>
   (mode!=='mesh'||folder.files.some(file=>file.format==='stl'))&&matchesSearch(folder,terms,describeFolder));
  const projectMatches=!mode||mode==='projects'?(projects?.items??[]).filter(project=>matchesSearch(project,terms,describeProject)):[];
  const total=projectMatches.length+matches.length+archiveMatches.length;
  pageCount=Math.max(1,Math.ceil(total/MODELS_PER_PAGE));
  page=Math.min(page,pageCount-1);
  const start=page*MODELS_PER_PAGE,end=start+MODELS_PER_PAGE;
  const pageSlice=<Item,>(items:readonly Item[],offset:number)=>items.slice(Math.max(0,start-offset),Math.max(0,end-offset));
  list.dataset.modelCount=String(total);
  pages.hidden=total===0;
  previous.hidden=nextPage.hidden=pageCount===1;
  if(total)modelRange.textContent=t`${start+1}–${Math.min(total,end)} of ${total} models`;
  const next=new Map<LibraryItem,HTMLButtonElement>();
  for(const project of pageSlice(projectMatches,0)){
   let card=cards.get(project);
   if(!card){
    card=createCard(()=>{selectedProject=project;selected=undefined;archiveSelection=undefined;});
    card.append(projectImage(project),el('strong',project.title),el('small',t('Robot project · Includes code')));
   }
   next.set(project,card);
  }
  for(const asset of pageSlice(matches,projectMatches.length)){
   let card=cardPreviews===options?.previews?cards.get(asset):undefined;
   if(!card){
    card=createCard(()=>{selectedProject=undefined;selected=asset;archiveSelection=undefined;});
    card.setAttribute('aria-label',`${asset.title} · ${asset.licence.spdx}`);
    const meta=el('span');meta.className='model-card-meta';
    meta.append(badge(asset),el('small',sourceFor(asset)?t('Editable source'):t('Mesh')));
    card.append(image(asset),el('strong',asset.title),meta);
   }
   next.set(asset,card);
  }
  for(const folder of pageSlice(archiveMatches,projectMatches.length+matches.length)){
   let card=cards.get(folder);
   if(!card){
    card=createCard(()=>{selectedProject=undefined;selected=undefined;archiveSelection=folder;});
    card.dataset.archiveFolder=folder.name;
    card.append(archiveImage(folder),el('strong',folder.name),el('small',t('Adafruit · Original files')));
   }
   next.set(folder,card);
  }
  for(const [item,card] of cards){
   if(next.get(item)===card)continue;
   clearPreviews(card);card.remove();
  }
  cards=next;cardPreviews=options?.previews;
  if(cards.size){
   emptyList.remove();
   let cursor=list.firstChild;
   for(const card of cards.values()){
    if(card!==cursor)list.insertBefore(card,cursor);
    cursor=card.nextSibling;
   }
  }else{
   emptyList.textContent=(catalogue.assets.length||archive.folders.length||projects?.items.length)?t('No matching models.'):t('No published catalogue is bundled. Open a reviewed remote catalogue JSON to browse models.');
   if(emptyList.parentNode!==list)list.append(emptyList);
  }
  refreshCards();
  list.scrollTop=scroll;
 }
 function appendInfo(asset:ModelLibraryAsset,technical:HTMLElement){
  const licence=el('section');licence.className='model-library-licence';licence.append(el('h4',t('Licence & attribution')));
  const text=el('textarea');text.readOnly=true;text.setAttribute('aria-label',t('Licence & attribution'));text.value=`${asset.licence.attribution}\n\n${options?.licenceTexts?.get(asset.id)??options?.licenceTexts?.get(asset.licence.spdx)??''}`.trim();licence.append(text);
  const links=el('nav');links.append(link(t('Original source'),asset.sourceUrl),link(t('Licence evidence'),asset.licence.evidenceUrl));licence.append(links);details.append(licence);
  const advanced=el('details');advanced.className='model-library-technical';advanced.append(el('summary',t('Technical details')),technical);details.append(advanced);
 }
 function optionalNotes(){const label=el('label',t('Notes (optional)')),notes=el('input');notes.type='text';notes.maxLength=3500;notes.setAttribute('aria-label',t('Incorporation modification notes'));notes.placeholder=t('Notes (optional)');label.className='library-notes';label.append(notes);return {label,notes};}
 type PreviewSource=()=>string|undefined|Promise<string|undefined>;
 const pendingPreviews=new WeakMap<Element,PreviewSource>();
 const showPreview=async(image:HTMLImageElement)=>{
  const load=pendingPreviews.get(image);
  pendingPreviews.delete(image);
  if(!load||!image.isConnected||disposed)return;
  try{const url=await load();if(url&&image.isConnected&&!disposed)image.src=url;}
  catch{if(image.isConnected&&!disposed)image.alt=t('Preview unavailable');}
 };
 const previewObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
  for(const entry of entries){
   if(!entry.isIntersecting)continue;
   previewObserver?.unobserve(entry.target);
   void showPreview(entry.target as HTMLImageElement);
  }
 },{rootMargin:'96px'}):null;
 function clearPreviews(container:HTMLElement){
  for(const image of container.querySelectorAll('img[data-library-preview]')){
   previewObserver?.unobserve(image);
   pendingPreviews.delete(image);
  }
 }
 function previewImage(alt:string,load:PreviewSource){
  const image=el('img');image.alt=alt;image.decoding='async';image.draggable=false;
  image.dataset.libraryPreview='';pendingPreviews.set(image,load);
  if(previewObserver)previewObserver.observe(image);
  else queueMicrotask(()=>{void showPreview(image);});
  return image;
 }
 function projectImage(project:ModelLibraryProject){
  const source=project.preview;
  if(!source){const placeholder=el('span','◇');placeholder.className='preview-unavailable';return placeholder;}
  return previewImage('',typeof source==='string'?()=>source:source);
 }
 function renderProject(project:ModelLibraryProject){
  const preview=el('div');preview.className='model-library-preview';preview.append(projectImage(project));
  const launch=el('button',t`Open ${project.title} project`);launch.type='button';launch.className='primary';launch.disabled=working;
  launch.onclick=async()=>{
   working=true;refreshCards();launch.disabled=true;status.textContent=t('Opening robot project…');
   try{const opened=await projects!.open(project.id);if(!disposed&&dialog.open){if(opened===false)status.textContent='';else dialog.close();}}
   catch(error){if(!disposed)report(error);}
   finally{working=false;if(!disposed){refreshCards();launch.disabled=false;}}
  };
  details.append(preview,el('h3',project.title),el('p',t('Opens a complete project with its 3D model, program, circuit, and Widgets.')));
  if(project.note)details.append(el('p',project.note));
  details.append(launch);
 }
 function renderDetails(){
  clearPreviews(details);details.replaceChildren();if(selectedProject){renderProject(selectedProject);return;}if(archiveSelection){renderArchive(archive,archiveSelection);return;}const asset=selected;if(!asset){details.append(el('p',t('Select a model to insert.')));return;}
  const preview=el('div');preview.className='model-library-preview';preview.append(image(asset));const meta=el('div');meta.className='model-library-meta';meta.append(el('h3',asset.title),badge(asset));details.append(preview,meta,el('small',asset.author));
  const technical=el('div');technical.append(el('p',asset.modificationNotes),el('p',asset.conversion.unitAssumption));
  const source=sourceFor(asset);if(source){renderSource(asset,source,technical);appendInfo(asset,technical);return;}
  const choices:{file:ModelLibraryFile;selection:ModelLibraryFileSelection}[]=[{file:asset.original,selection:{assetId:asset.id,file:'original' as const}},...asset.derivatives.map((file,i)=>({file,selection:{assetId:asset.id,file:{derivative:i}}}))].filter(c=>c.file.format==='stl');
  const files=el('select');files.setAttribute('aria-label',t('Selected library STL'));choices.forEach(({file},i)=>{const option=el('option',`STL · ${file.bytes.toLocaleString()} B`);option.value=String(i);files.append(option);});if(choices.length>1)details.append(files);else technical.append(files);
  const {label,notes}=optionalNotes(),offlineLabel=el('label',t('Use cached files only')),offline=el('input');offline.type='checkbox';offlineLabel.prepend(offline);technical.append(offlineLabel);
  const identity=el('pre'),conversion=el('div'),collision=el('section');collision.setAttribute('aria-label',t('Recorded collision evidence'));technical.append(identity,conversion,collision);
  const insert=el('button',t('Insert selected STL'));insert.type='button';insert.className='primary library-insert';const eligibility=el('p');eligibility.className='library-eligibility';
  function refresh(){const chosen=choices[Number(files.value)],q=asset!.quality,admitted=!!chosen&&(!chosen.file.path||localFiles.has(chosen.file.path))&&chosen.file.bytes<=MODEL_LIBRARY_MESH_MAX_BYTES&&!!q?.screeningPolicy&&chosen.file.bytes<=q.screeningPolicy.maxAnalysisBytes&&q.fileSha256===chosen.file.sha256&&q.parseable&&q.closedPositiveVolume&&q.withinSizeLimits&&q.withinTriangleLimits;
   insert.disabled=working||!admitted;identity.textContent=chosen?`${chosen.file.sha256}\n${chosen.file.url??chosen.file.path}`:'';conversion.replaceChildren();
   if(chosen&&q?.fileSha256===chosen.file.sha256&&q.screeningPolicy){const policy=q.screeningPolicy;conversion.append(el('h4',t('Selected STL conversion to millimetres, Z up')),el('pre',Array.from({length:4},(_,row)=>Array.from({length:4},(_,column)=>String(policy.toMillimetresZUp[column*4+row])).join('  ')).join('\n')),el('p',t`Curated limits: ${policy.maxTriangles} triangles; ${policy.maxExtentMm} mm span per axis; ${policy.maxAnalysisBytes} analysis bytes. Translation is preserved; no centering or repair.`));}
   eligibility.textContent=admitted?'':t('Insertion unavailable: select an STL with passing quality, a recorded conversion and at most 16 MiB.');}
  files.onchange=()=>{renderCollisionReport(collision,asset,choices[Number(files.value)]?.file);refresh();};
  insert.onclick=async()=>{if(insert.disabled)return;const chosen=choices[Number(files.value)],initial=session.state,modificationNotes=notes.value.trim()||'Inserted without manual changes; recorded millimetres/Z-up conversion applied.',offlineOnly=offline.checked;
   working=true;controller=new AbortController();file.disabled=search.disabled=filter.disabled=files.disabled=notes.disabled=offline.disabled=true;refresh();refreshCards();status.textContent=t('Verifying selected model…');
   try{const local=chosen.file.path?localFiles.get(chosen.file.path):undefined;
    const fetched=local?{bytes:local.slice(),cached:true}:await fetchModelLibraryFile(catalogue,chosen.selection,{cache:options?.cache??noCache,fetch:options?.fetch,offline:offlineOnly,signal:controller.signal,maxBytes:MODEL_LIBRARY_MESH_MAX_BYTES});if(disposed)throw new Error(t('Editor was disposed'));if(session.state.document!==initial.document||session.state.revision!==initial.revision)throw new Error(t('The model changed while loading this library file. Retry insertion.'));
    await insertModelLibrarySTL(session,catalogue,chosen.selection,fetched.bytes,{evaluate:async doc=>{const result=await evaluate(doc);if(disposed)throw new Error(t('Editor was disposed'));return result;},toMillimetresZUp:asset.quality!.screeningPolicy!.toMillimetresZUp,checkedOn:new Date().toISOString().slice(0,10),modificationNotes,signal:controller.signal});
    status.textContent=fetched.cached?t('Inserted with provenance. Verified file is cached for offline reuse.'):t('Inserted with provenance. File could not be cached for offline reuse.');try{await inserted();}catch{if(!disposed)status.textContent=t('Model inserted with provenance; viewport refresh failed. Close this panel to inspect the editor status.');}
   }catch(error){if(!disposed)report(error);}finally{working=false;controller=undefined;file.disabled=search.disabled=filter.disabled=files.disabled=notes.disabled=offline.disabled=false;refresh();refreshCards();}
  };
  details.append(label,insert,eligibility);appendInfo(asset,technical);renderCollisionReport(collision,asset,choices[Number(files.value)]?.file);refresh();
 }
 function renderArchive(archive:ModelLibraryArchive,folder:ModelLibraryArchive['folders'][number]){
  if(folder.name!=='Adafruit archive files'){const preview=el('div');preview.className='model-library-preview';preview.append(archiveImage(folder));details.append(preview);}
  details.append(el('h3',folder.name),el('p','Adafruit Industries · MIT'),el('p',t('Original files; units and orientation have not been verified. STEP, Fusion and other formats are available as source files. These files have not been screened for insertion or collision.')),link(t('Licence evidence'),archive.licenceUrl));
  const notice=el('textarea');notice.readOnly=true;notice.setAttribute('aria-label',t('Licence & attribution'));notice.value=archive.licence;details.append(notice);
  const select=el('select');select.setAttribute('aria-label',t('Original file'));folder.files.forEach((f,i)=>{const option=el('option',`${f.path.split('/').pop()} · ${f.bytes.toLocaleString()} B`);option.value=String(i);select.append(option);});
  const firstSTL=folder.files.findIndex(f=>f.format==='stl');if(firstSTL>=0)select.value=String(firstSTL);
  const upstream=link(t('Upstream original'),`https://github.com/adafruit/Adafruit_CAD_Parts/blob/${archive.upstreamCommit}/`);const identity=el('pre'),offlineLabel=el('label',t('Use cached files only')),offline=el('input');offline.type='checkbox';offlineLabel.prepend(offline);const unitLabel=el('label',t('STL source units')),units=el('select');units.setAttribute('aria-label',t('STL source units'));for(const [value,label] of [['',t('Choose units')],['mm',t('Millimetres')],['in',t('Inches')]]){const option=el('option',label);option.value=value;units.append(option);}unitLabel.append(units);const axisLabel=el('label',t('STL source up axis')),axis=el('select');axis.setAttribute('aria-label',t('STL source up axis'));for(const [value,label] of [['',t('Choose up axis')],['Z',t('Z up')],['Y',t('Y up')]]){const option=el('option',label);option.value=value;axis.append(option);}axisLabel.append(axis);const insert=el('button',t('Screen and insert STL'));insert.type='button';insert.className='primary library-insert';const eligibility=el('p');eligibility.className='library-eligibility';const download=el('button',t('Download verified original'));download.type='button';download.className='library-download';
  const refresh=()=>{const f=folder.files[Number(select.value)];identity.textContent=`Format from filename: ${f.format}\nUnits: ${f.units}\nSHA-256: ${f.sha256}\nUpstream commit: ${archive.upstreamCommit}\nMirror commit: ${archive.commit}`;upstream.href=`https://github.com/adafruit/Adafruit_CAD_Parts/blob/${archive.upstreamCommit}/${f.path.split('/').map(encodeURIComponent).join('/')}`;download.disabled=working;const isSTL=f.path.toLowerCase().endsWith('.stl');unitLabel.hidden=axisLabel.hidden=insert.hidden=!isSTL;insert.disabled=working||!isSTL||!units.value||!axis.value||f.bytes>MODEL_LIBRARY_MESH_MAX_BYTES;eligibility.textContent=!isSTL?'':f.bytes>MODEL_LIBRARY_MESH_MAX_BYTES?t('STL exceeds the 16 MiB screening limit; original download remains available.'):!units.value||!axis.value?t('Choose source units and up axis to screen this STL.'):t('Insertion requires a passing geometry screen and does not qualify collisions.');};select.onchange=()=>{units.value=axis.value='';refresh();};units.onchange=axis.onchange=refresh;
  download.onclick=async()=>{const chosen=folder.files[Number(select.value)];working=true;controller=new AbortController();select.disabled=offline.disabled=true;refresh();refreshCards();status.textContent=t('Verifying original file…');try{const bytes=await fetchArchiveFile(archive,chosen,archiveCache,options?.fetch,offline.checked,controller.signal);if(disposed)return;const name=chosen.path.split('/').pop()??'original';if(deliver)await deliver({name,bytes,mime:'application/octet-stream'});else{const url=URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}if(!disposed)status.textContent=t('Verified original downloaded.');}catch(error){if(!disposed)report(error);}finally{working=false;controller=undefined;select.disabled=offline.disabled=false;refresh();refreshCards();}};
  insert.onclick=async()=>{const chosen=folder.files[Number(select.value)],initial=session.state,sourceUnits=units.value as 'mm'|'in',sourceAxis=axis.value as 'Y'|'Z';working=true;controller=new AbortController();select.disabled=offline.disabled=units.disabled=axis.disabled=true;refresh();refreshCards();status.textContent=t('Verifying and screening STL…');try{const bytes=await fetchArchiveFile(archive,chosen,archiveCache,options?.fetch,offline.checked,controller.signal);const checkedOn=new Date().toISOString().slice(0,10),screen=await screenArchiveSTL(archive,folder,chosen,bytes,sourceUnits,sourceAxis,checkedOn);if(disposed)throw new Error(t('Editor was disposed'));if(session.state.document!==initial.document||session.state.revision!==initial.revision)throw new Error(t('The model changed while loading. Retry insertion.'));await insertModelLibrarySTL(session,screen.catalogue,{assetId:screen.id,file:'original'},bytes,{evaluate,toMillimetresZUp:screen.matrix,checkedOn,modificationNotes:screen.assumption,signal:controller.signal});status.textContent=t('STL inserted with provenance and selected conversion.');try{await inserted();}catch{if(!disposed)status.textContent=t('STL inserted with provenance; viewport refresh failed.');}}catch(error){if(!disposed)report(error);}finally{working=false;controller=undefined;select.disabled=offline.disabled=units.disabled=axis.disabled=false;refresh();refreshCards();}};
  const originals=el('details'),summary=el('summary',t('Original source files'));originals.append(summary,upstream,download,identity);details.append(select,offlineLabel,unitLabel,axisLabel,insert,eligibility,originals);refresh();
 }
 function renderSource(asset:ModelLibraryAsset,source:ModelLibraryFile,technical:HTMLElement){
  const bytes=source.path?localFiles.get(source.path):undefined,collision=el('section');collision.setAttribute('aria-label',t('Recorded collision evidence'));renderCollisionReport(collision,asset,source);technical.append(collision,el('p',`${source.format} · ${source.bytes} B · ${source.path}`),el('pre',source.sha256));
  if(source.format==='openscad')technical.append(el('p',t('OpenSCAD source is converted to editable CAD Script using the supported subset. The original artifact hash is retained.')));
  if(source.format==='jscad')technical.append(el('p',t('JSCAD is converted with default parameters to an editable CAD Script snapshot. Original JavaScript parameters and face colours are not retained; unsupported features are refused.')));
  const dependenciesAvailable=asset.sourceBundle?.dependencies.every(dependency=>localFiles.has(dependency.file.path!))??true;
  const {label,notes}=optionalNotes(),insert=el('button',t('Insert editable source'));insert.type='button';insert.className='primary library-insert';const refresh=()=>{insert.disabled=working||!bytes||!dependenciesAvailable;};
  if(!bytes||!dependenciesAvailable)details.append(el('p',t('Editable source is not bundled in this host.')));
  insert.onclick=async()=>{if(insert.disabled||!bytes)return;working=true;controller=new AbortController();file.disabled=search.disabled=filter.disabled=notes.disabled=true;refresh();refreshCards();status.textContent=t('Verifying selected model…');
   try{await insertModelLibrarySource(session,catalogue,{assetId:asset.id,file:source===asset.original?'original':'editableSource'},bytes,{signal:controller.signal,sourceFiles:localFiles,modificationNotes:notes.value.trim()||'Inserted with default parameters; no manual changes.',evaluate:async doc=>{const result=await evaluate(doc);if(disposed)throw new Error(t('Editor was disposed'));return result;}});status.textContent=t('Editable source inserted with provenance. Available offline.');try{await inserted();}catch{if(!disposed)status.textContent=t('Model inserted with provenance; viewport refresh failed. Close this panel to inspect the editor status.');}
   }catch(error){if(!disposed)report(error);}finally{working=false;controller=undefined;file.disabled=search.disabled=filter.disabled=notes.disabled=false;refresh();refreshCards();}
  };details.append(label,insert);refresh();
 }
  function renderCollisionReport(container:HTMLElement,asset:ModelLibraryAsset,selectedFile:ModelLibraryFile|undefined){
    container.replaceChildren();
    container.append(el('h4',t('Recorded collision evidence')));
    const quality=asset.quality,report=quality?.collisionReport;
    container.append(el('p',t('Browsing and insertion do not run collision qualification.')));
    if(report||quality?.physics)container.append(el('p',t('Serialized curator evidence only. Recorded metadata is not a reusable runtime collision proof or a certification of collision safety, printability or mechanical accuracy.')));
    const sameFile=report&&selectedFile&&report.selectedFile.sha256===selectedFile.sha256&&report.selectedFile.bytes===selectedFile.bytes&&report.selectedFile.format===selectedFile.format&&report.selectedFile.url===selectedFile.url&&report.selectedFile.path===selectedFile.path;
    if(!sameFile){
      container.append(el('p',report?t('A complete report is recorded for a different STL selection; it does not apply to this file.'):quality?.physics?t('Only a legacy physics summary is recorded. No complete collision report is available for this selection.'):t('No complete collision report is recorded for this selection.')));
      if(!report&&quality?.physics){const summary=quality.physics;container.append(el('p',t`Legacy summary: ${summary.engine} ${summary.engineVersion}; ${summary.qualifierVersion}; reported qualified: ${String(summary.qualified)}.`));}
      return;
    }
    const evidence=report.evidence,certificate=evidence.certificate,screen=report.quality;
    container.append(el('p',t('Runtime collisions require fresh immutable proofs. Changed bytes, conversion, geometry or toolchain require requalification.')));
    const expanded=el('details');expanded.className='model-library-collision-report';expanded.append(el('summary',t('Inspect complete recorded collision report')));
    expanded.append(el('p',t`Report version ${report.version}; checked ${evidence.checkedOn}; scope: ${evidence.scope}.`),
      el('p',t`Engine: ${evidence.engine} ${evidence.engineVersion}; qualifier: ${evidence.qualifierVersion}; mesh checker: ${screen.toolVersion}.`),
      el('p',t`Native check: ${evidence.nativeCheck.build} build; ${evidence.nativeCheck.steps} rigid step of ${evidence.nativeCheck.stepSeconds} s; no ground.`),
      el('p',t('No ground settling, cavity clearance, contacts, mechanisms, elasticity, printability or manufacturing accuracy were tested. Native capacity/error telemetry is unavailable.')),
      el('p',t`STL SHA-256: ${evidence.fileSha256}`),el('p',t`Converted geometry SHA-256: ${evidence.geometrySha256}`),
      el('p',t`Evaluated source volume: ${evidence.sourceVolumeMm3} mm³; hulls: ${evidence.hulls} / ${certificate.maxHulls}; algorithm: ${certificate.algorithm}; strategy: ${certificate.strategy}.`),
      el('p',t`Missing volume: ${certificate.missingVolumeMm3} mm³; extra volume: ${certificate.extraVolumeMm3} mm³; relative error: ${certificate.relativeError}; allowed volume fraction: ${certificate.tolerance.volumeFraction}.`),
      el('p',t`Bounds error: ${certificate.boundsErrorMm} mm; allowed bounds error: ${certificate.tolerance.boundsMm} mm.`),
      el('p',t`Screened mesh: ${screen.triangles} triangles; signed volume: ${screen.signedVolumeMm3} mm³; bounds min: ${screen.boundsMm.min.join(', ')} mm; max: ${screen.boundsMm.max.join(', ')} mm.`),
      el('p',t('The complete record below retains the exact file identity, conversion matrix, screening limits, checks, diagnostics, bindings and tolerances. Metadata consistency does not verify that the reported run occurred.')),
      el('pre',JSON.stringify(report,null,2)));
    container.append(expanded);
  }
 search.oninput=()=>{resetPage();renderList();};
 filter.onchange=()=>{resetPage();selectedProject=undefined;selected=undefined;archiveSelection=undefined;renderList();renderDetails();};
 file.onchange=async()=>{const chosen=file.files?.[0];file.value='';if(!chosen||working)return;try{if(chosen.size>4*1024*1024)throw new Error(t('Catalogue exceeds 4 MiB'));const parsed=parseModelLibraryCatalogue(await chosen.text());if(disposed||working)return;if(!parsed.valid)throw new Error(parsed.errors.join(' '));catalogue=parsed.catalogue;resetPage();selectedProject=undefined;selected=undefined;archiveSelection=undefined;search.value=filter.value='';status.textContent='';renderList();renderDetails();}catch(error){report(error);}};
 return {open(filterMode?:'projects'){if(!disposed&&!dialog.open){if(filterMode){resetPage();filter.value=filterMode;search.value='';selectedProject=undefined;selected=undefined;archiveSelection=undefined;}renderList();if(!working)renderDetails();dialog.showModal();search.focus();if(!loaded){status.textContent=t('Loading models…');loading??=options!.load!().then(data=>{if(disposed)return;const checked=validateModelLibraryCatalogue(data.catalogue);if(!checked.valid)throw new Error(checked.errors.join(' '));catalogue=checked.catalogue;options={...options,...data};localFiles.clear();for(const [path,bytes]of data.localFiles??[])localFiles.set(path,bytes.slice());loaded=true;status.textContent='';renderList();renderDetails();}).catch(error=>{if(!disposed)report(error);}).finally(()=>{loading=undefined;});}}},dispose(){disposed=true;controller?.abort();previewObserver?.disconnect();dialog.remove();}};
}
