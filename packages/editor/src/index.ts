// SPDX-License-Identifier: BSD-3-Clause
import {prepareMeshExport} from './export-policy.js';
import {mountModelLibraryPanel, type ModelLibraryOptions} from './model-library-panel.js';
export type {ModelLibraryOptions} from './model-library-panel.js';
import {fineNumberKeys} from './precision.js';
import { t } from '@brickwright/cad-core';
import { createCadSession, createDocument, identityTransform, newId, parseDocument, defaultPartPhysics,defaultGenerator,generatorFields,validateDocument,serializeDocument,designGraph,evaluateParameters,compileCode,hasModelAttribution } from '@brickwright/cad-core';
import type { CadDocument, CadSession, Primitive, SolidNode, Transform, Vec3 } from '@brickwright/cad-core';
import { importSTL } from '@brickwright/cad-geometry';
import type { GeometryResult } from '@brickwright/cad-geometry';
import { createGeometryClient } from './geometry-client.js';
import {mountTransformReadout} from './transform-readout.js';
import type {NavigationPreset} from './camera-input.js';
export type {NavigationPreset} from './camera-input.js';
import { mountViewport } from './viewport.js';
import { editorStyle } from './style.js';
import { toolIcon } from './icons.js';
import { mountShapePicker } from './shape-picker.js';
import { createPresetDocument, evaluatedPreview } from './shapes.js';
import {mountModelSourcePanel} from './model-source-panel.js';
import {mountCodePanel} from './code-panel.js';
import {mountSketchPanel} from './sketch-panel.js';
import { mountParametersPanel, propertyLabels } from './parameters-panel.js';
export interface CadFile { name: string; bytes: Uint8Array; mime: string }
export interface CadEditorOptions {
  headerContent?: HTMLElement;
  /** Desktop hosts provide the sole File menu through their native menu bar. */
  nativeMenus?:boolean;
  modelLibrary?: ModelLibraryOptions;
  navigationPreset?:NavigationPreset;
  showTransformReadout?:boolean;
  appearance?:{background:string;baseplate:string};
  onTransformReadoutChange?:(visible:boolean)=>void;
  saveProject?: () => Promise<void>;
  decodeProject?: (bytes:Uint8Array) => Promise<CadDocument>;
  readClipboard?:()=>Promise<string|null>;
  writeClipboard?:(text:string)=>Promise<void>;
  requestImport?:()=>Promise<{name:string;bytes:Uint8Array}|null>;
  onCommandStateChange?:(state:CadCommandState)=>void;
  wasmURL: string;
  session?: CadSession;
  document?: CadDocument;
  createWorker?: () => Worker;
  onDocumentChange?: (document: CadDocument, revision: number) => void;
  onSelectionChange?: (selection: readonly string[]) => void;
  onExport?: (file: CadFile) => void | Promise<void>;
  requestOpen?: () => Promise<{ name: string; bytes: Uint8Array } | null>;
  requestNew?: () => boolean | Promise<boolean>;
  onError?: (error: Error) => void;
}
export interface CadCommandState {canUndo:boolean;canRedo:boolean;hasSelection:boolean;canDelete:boolean;canCombine:boolean;canExport:boolean;hasBodies:boolean;ready:boolean}
export type CadCommand='new'|'open'|'save'|'import'|'export'|'undo'|'redo'|'cut'|'copy'|'paste'|'duplicate'|'delete'|'select-all'|'deselect'|'select'|'move'|'rotate'|'scale'|'home'|'fit'|'top'|'front'|'right'|'back'|'left'|'bottom'|'projection'|'workplane'|'objects'|'properties'|'drop'|'parameters'|'shapes'|'sketch'|'readout'|'code'|'model-source'|'model-library'|'union'|'subtract'|'intersect';
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element;
}
/** Mounts one isolated editor. No storage, window keyboard handlers, React or Scratch globals. */
export function mountCadEditor(host: HTMLElement, options: CadEditorOptions) {
  const session = options.session ?? createCadSession(options.document); const ownsSession = !options.session;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (shadow.childElementCount) throw new Error(t('Mount target is already in use'));
  const style = el('style'); style.textContent = editorStyle; const shell = el('section', 'editor'); shell.setAttribute('aria-label', 'CAD editor');
  const toolbar = el('div', 'toolbar'); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Model tools');
  const iterationControl=options.headerContent?.querySelector<HTMLSelectElement>('#iterations');const projectsControl=options.headerContent?.querySelector<HTMLButtonElement>('#library');
  const main = el('div', 'main'); const tree = el('aside', 'panel tree'); const viewHost = el('div', 'viewport'); const inspector = el('aside', 'panel inspector');
  const status = el('div', 'status'); const message = el('span'); message.setAttribute('role', 'status');message.setAttribute('aria-label',t('Editor status')); message.setAttribute('aria-live', 'polite'); const stats = el('span', 'stats'); status.append(message, stats);
  const designBar = el('div', 'design-bar');
  const titleInput = el('input'); titleInput.setAttribute('aria-label', 'Design title'); titleInput.addEventListener('keydown',event=>{if(event.key==='Enter')titleInput.blur();else if(event.key==='Escape'){titleInput.value=session.state.document.title;titleInput.blur();}}); titleInput.addEventListener('change', () => run(() => session.rename(titleInput.value))); designBar.append(titleInput, el('span', 'units-label', t('mm · Z up')));
  main.append(tree, viewHost, inspector); designBar.append(toolbar);shell.append(designBar, main, status); shadow.append(style, shell);
  let disposed = false; let builtRevision = -1; let built: GeometryResult | null = null; let running = false; let lastRevision = -1; let lastSelection = ''; let geometryError = ''; let mode: 'select' | 'translate' | 'rotate' | 'scale' = 'select'; let grid = 1;
  const waiters = new Set<{ resolve: (r: GeometryResult) => void; reject: (e: Error) => void }>();
  let operationError = '';
  function report(e: unknown) { const error = e instanceof Error ? e : new Error(String(e)); operationError = error.message; message.textContent = error.message; if (!disposed) options.onError?.(error); }
  const run = (fn: () => unknown) => { try { const result = fn(); if (result instanceof Promise) result.catch(report); } catch (e) { report(e); } };
  const client = createGeometryClient(new URL(options.wasmURL, document.baseURI).href, options.createWorker);
  let viewport: ReturnType<typeof mountViewport>;
  try { viewport = mountViewport(viewHost, session, report,options.appearance);viewport.setNavigation(options.navigationPreset??'tinkercad'); } catch (e) { client.dispose(); shadow.replaceChildren(); if (ownsSession) session.dispose(); throw e; }
  const empty = el('div', 'empty'); empty.append(el('strong', '', t('Your next idea starts here.')), document.createTextNode(t('Pick a shape above. Set its dimensions in Properties. Drag to orbit; pinch to zoom.'))); viewHost.append(empty);
  const busy = el('div', 'busy', t('Building solid…')); busy.hidden = true; viewHost.append(busy);
  const errorPanel = el('div', 'error'); errorPanel.hidden = true; errorPanel.setAttribute('role', 'alert'); viewHost.append(errorPanel);
  let toolParent: HTMLElement = toolbar;
  const menus:HTMLDetailsElement[]=[];
  function toolGroup(label: string, className = '') {
    if(['File','Edit','Combine'].includes(label)){
      const group=el('details',`command-menu ${className}`);const trigger=el('summary','',`${t(label)} ▾`);trigger.setAttribute('aria-label',t`${t(label)} menu`);if(label!=='File'){trigger.textContent='';const icon=toolIcon(label==='Combine'?'Union':'Edit');if(icon)trigger.append(icon);trigger.title=t(label);}
      const tools=el('div','command-popup');group.append(trigger,tools);toolbar.append(group);group.hidden=label==='File'&&options.nativeMenus===true;toolParent=tools;menus.push(group);
      group.addEventListener('toggle',()=>{if(group.open)menus.forEach(menu=>{if(menu!==group)menu.open=false;});});
      tools.addEventListener('click',event=>{if((event.target as Element).closest('button:not(:disabled)'))group.open=false;});return;
    }
    const group = el('div', `tool-group ${className}`); group.setAttribute('role', 'group'); group.setAttribute('aria-label', t(label)); const tools = el('div', 'group-tools'); group.append(tools); toolbar.append(group); toolParent = tools;
  }
  function button(label: string, action: () => unknown, parent: HTMLElement = toolParent, className = '', translate = true) {
    const b = el('button', className); const icon = toolIcon(label); if (icon) b.append(icon); const display = translate ? t(label) : label; b.append(el('span', '', display)); b.type = 'button'; b.title = display; b.setAttribute('aria-label', display); b.addEventListener('click', () => run(action)); parent.append(b); return b;
  }
  function togglePanel(panel: HTMLElement, toggle: HTMLButtonElement) { const visible = getComputedStyle(panel).display !== 'none'; panel.classList.toggle('closed', visible); panel.classList.toggle('open', !visible); toggle.setAttribute('aria-pressed', String(!visible)); }
  const partsToggle = button('Objects', () => togglePanel(tree, partsToggle), status, 'panel-toggle objects-toggle');
  partsToggle.title = t('Show objects');
  const propertiesToggle = button('Properties', () => togglePanel(inspector, propertiesToggle), status, 'panel-toggle properties-toggle');
  const modelLibraryPanel=mountModelLibraryPanel(shell,session,doc=>client.evaluate(doc),options.modelLibrary,async()=>{await whenIdle();viewport.frame();});
  const parametersPanel=mountParametersPanel(shell,session);
  const sketchPanel=mountSketchPanel(shell,session,doc=>client.evaluate(doc),async()=>{await whenIdle();viewport.frame();});
  button('Sketch',()=>sketchPanel.open(),toolbar,'compact-icon').title=t('Create a dimensioned sketch and extrusion');
  const modelSourcePanel=mountModelSourcePanel(shell,status,session,doc=>client.evaluate(doc),(recipe,name)=>createPresetDocument(recipe.preset,name,{recipe}));
  const codePanel=mountCodePanel(shell,session,doc=>client.evaluate(doc),async()=>{await whenIdle();viewport.frame();},options.onExport,()=>run(()=>modelSourcePanel.open()));
  button('Code',()=>codePanel.open(session.state.selection.length===1&&session.state.document.nodes[session.state.selection[0]]?.kind==='code'?session.state.selection[0]:undefined),toolbar,'compact-icon').title=t('Code an object');
  const parametersButton=button('Parameters',()=>parametersPanel.open(),toolbar,'compact-icon');parametersButton.title=t('Model parameters and formulas');
  if(options.headerContent){options.headerContent.classList.add('host-actions');designBar.append(options.headerContent);}
  toolGroup('Shapes', 'shapes-tools');
  const shapesButton = button('Shapes', () => picker.toggle(), toolParent, 'shape-library-toggle');
  const previewCache = new Map<string, Promise<string>>();
  const picker = mountShapePicker(main, shapesButton, async (preset, text, svg,font) => {
    const projectId=session.state.document.id,wasEmpty=!session.state.document.roots.length;const doc = createPresetDocument(preset.id, text, {svg,font}); const result = await client.evaluate(doc);
    if (disposed) return;
    if(session.state.document.id!==projectId)throw new Error(t('Shape insertion was canceled because a different model was opened'));
    const minZ = Math.min(...result.bodies.map(body => body.bounds.min[2]));
    session.insert(doc, [session.state.document.roots.length * 12, 0, -minZ],{mergeParameters:true});
    await whenIdle();
    if(wasEmpty)viewport.frame();
  }, report, preset => { let preview=previewCache.get(preset.id); if(!preview){preview=client.evaluate(createPresetDocument(preset.id,'ABC')).then(result=>evaluatedPreview(result.bodies));previewCache.set(preset.id,preview);}return preview; });
  const add = (shape: Primitive) => {
    const transform = identityTransform(); const height = shape.kind === 'box' ? shape.size[2] : shape.kind === 'cylinder' ? shape.height : shape.radius * 2;
    transform.position = [session.state.document.roots.length * 12, 0, height / 2]; session.add(shape, { transform });
  };
  toolGroup('Combine');
  const opButtons = (['union', 'subtract', 'intersect'] as const).map(operation => {
    const b = button(operation[0].toUpperCase() + operation.slice(1), () => session.combine(operation));
    b.title = operation === 'subtract' ? t('First selected body is the base. Later selected bodies cut it.') : t(operation === 'union' ? 'Union solids and subtract holes' : 'Intersect'); return b;
  });
  toolGroup('Transform');
  const modeButtons = (['select', 'translate', 'rotate', 'scale'] as const).map((m, i) => {
    const b = button(['Select', 'Move', 'Rotate', 'Scale'][i], () => setMode(m)); b.title = t(['Select and drag (V / Esc)', 'Move (W)', 'Rotate (E)', 'Scale (R)'][i]); return b;
  });
  const dropButton = button('Drop to workplane', () => viewport.dropSelection());
  const readout=mountTransformReadout(viewHost,session,report,visible=>{numbersToggle.checked=visible;viewport.setReadoutVisible(visible);options.onTransformReadoutChange?.(visible);});
  const numbersLabel=el('label','numbers-toggle','XYZ');numbersLabel.title=t('Show on-canvas parameters');const numbersToggle=el('input');numbersToggle.type='checkbox';numbersToggle.setAttribute('aria-label',t('Show on-canvas parameters'));numbersToggle.onchange=()=>readout.setVisible(numbersToggle.checked);numbersLabel.prepend(numbersToggle);
  readout.setVisible(options.showTransformReadout??false);
  viewport.setTransformPreviewListener(preview=>{readout.update(preview);if(preview.bounds)for(const [i,axis] of ['X','Y','Z'].entries()){const input=inspector.querySelector<HTMLInputElement>(`[data-size-axis=${axis}]`);if(input)input.value=String(Number((preview.bounds.max[i]-preview.bounds.min[i]).toFixed(3)));}const pose=preview.poses[0]?.transform;if(!pose)return;for(const [key,name] of [['position','Position'],['rotation','Rotation'],['scale','Scale']] as const)for(const [i,axis] of ['X','Y','Z'].entries()){const input=Array.from(inspector.querySelectorAll('input')).find(el=>el.getAttribute('aria-label')===`${t(name)} ${axis}`);if(input){input.readOnly=preview.dragging;if(shadow.activeElement!==input||preview.dragging)input.value=String(Number(pose[key][i].toFixed(5)));}}});
  const planeBar = el('div', 'plane-bar'); planeBar.append(el('span', 'plate-size', t('400 × 400 mm workplane')));
  const gridLabel = el('label', '', t('Snap Grid')); const gridSelect = el('select'); gridSelect.setAttribute('aria-label', 'Grid spacing');
  for (const n of [0, 0.1, 1, 5, 10]) { const o = el('option', '', n === 0 ? t('Off') : `${n} mm`); o.value = String(n); gridSelect.append(o); } gridSelect.value = '1';
  gridSelect.addEventListener('change', () => { grid = Number(gridSelect.value); viewport.setGrid(grid); }); gridLabel.append(gridSelect); const fineLabel=el('label','numbers-toggle',t('Fine')),fineToggle=el('input');fineToggle.type='checkbox';fineToggle.setAttribute('aria-label',t('Fine adjustments'));fineLabel.title=t('One-tenth-speed movement and finer transform increments. Hold Shift for temporary precision.');fineToggle.onchange=()=>viewport.setFine(fineToggle.checked);fineLabel.prepend(fineToggle);planeBar.append(numbersLabel,fineLabel,gridLabel, el('span', 'unit-chip', 'mm')); viewHost.append(planeBar);
  const undoButton = button('Undo', () => session.undo(),toolbar,'compact-icon'); const redoButton = button('Redo', () => session.redo(),toolbar,'compact-icon');
  toolGroup('Edit');
  const cutButton=button('Cut',()=>copySelection(true));const copyButton=button('Copy',()=>copySelection());const pasteButton=button('Paste',()=>pasteSelection());
  const duplicateButton = button('Duplicate', () => executeCommand('duplicate')); const deleteButton = button('Delete', () => executeCommand('delete'));
  const contextActions=el('div','context-actions');contextActions.setAttribute('role','group');contextActions.setAttribute('aria-label',t('Selection actions'));toolbar.append(contextActions);for(const [label,command] of [['Copy','copy'],['Duplicate','duplicate'],['Delete','delete']] as const)button(label,()=>executeCommand(command),contextActions,'compact-icon');
  const fitSelectionActions=()=>{const other=[...toolbar.children].filter(child=>child!==contextActions).reduce((sum,child)=>sum+(child as HTMLElement).getBoundingClientRect().width,0);const gap=parseFloat(getComputedStyle(toolbar).gap)||0;contextActions.dataset.room=String(toolbar.clientWidth>=other+112+gap*toolbar.children.length);};
  const toolbarResize=new ResizeObserver(fitSelectionActions);toolbarResize.observe(toolbar);
  toolGroup('File', 'file-tools');
  button('Model library',()=>modelLibraryPanel.open());
  button('Model source',()=>modelSourcePanel.toggle());
  if(projectsControl){projectsControl.textContent=t('Projects');toolParent.append(projectsControl);}
  if(iterationControl)button('History…',()=>{tree.classList.remove('closed');tree.classList.add('open');partsToggle.setAttribute('aria-pressed','true');iterationControl.focus();});
  async function newProject(){if(!options.requestNew||await options.requestNew())session.load(createDocument());}
  button('New',newProject);
  const input = el('input'); input.type = 'file'; input.setAttribute('aria-label',t('Open CAD project or STL')); input.accept = '.bcad,.json,.stl'; input.hidden = true; shell.append(input);
  async function chooseOpen(){if(options.requestOpen){const file=await options.requestOpen();if(file)await openFile(file.name,file.bytes);}else input.click();}
  button('Open',chooseOpen);
  input.accept='.bcad,.bcadhistory,.json,.stl';input.addEventListener('change', () => { const file = input.files?.[0]; input.value = ''; if (file) run(async () => { if (file.size > 64 * 1024 * 1024) throw new Error(t('Project exceeds 64 MiB')); await openFile(file.name, new Uint8Array(await file.arrayBuffer())); }); });
  const save = button('Save project', () => deliver('bcad'), toolParent, 'primary'); save.disabled = !options.onExport&&!options.saveProject;
  const projectActions=el('div','project-actions');projectActions.setAttribute('role','group');projectActions.setAttribute('aria-label',t('Project actions'));
  const quickAction=(icon:string,label:string,action:()=>unknown)=>{const control=button(icon,action,projectActions,'project-action');control.setAttribute('aria-label',t(label));control.title=t(label);return control;};
  quickAction('New','New project',newProject);quickAction('Open','Open project',chooseOpen);
  const quickSave=quickAction('Save project','Save project file',()=>deliver('bcad'));quickSave.disabled=save.disabled;quickSave.title=t('Save a portable project file, including history. Your working project autosaves.');
  designBar.insertBefore(projectActions,toolbar);
  const importInput=el('input');importInput.type='file';importInput.accept='.stl';importInput.hidden=true;importInput.setAttribute('aria-label',t('Import STL geometry'));shell.append(importInput);
  importInput.onchange=()=>{const file=importInput.files?.[0];importInput.value='';if(file)run(async()=>{if(file.size>16*1024*1024)throw new Error(t('STL exceeds 16 MiB'));await importFile(file.name,new Uint8Array(await file.arrayBuffer()));});};
  async function chooseImport(){if(options.requestImport){const file=await options.requestImport();if(file)await importFile(file.name,file.bytes);}else importInput.click();}
  button('Import STL…',chooseImport);
  const exportDialog=el('dialog','export-dialog');exportDialog.setAttribute('aria-label',t('Export model'));exportDialog.append(el('h2','',t('Export model')));
  const exportFormat=el('select');exportFormat.setAttribute('aria-label',t('Export format'));for(const [value,label] of [['stl','STL · triangle mesh'],['3mf','3MF · packaged mesh']]){const option=el('option','',t(label));option.value=value;exportFormat.append(option);}exportDialog.append(exportFormat);
  const attributionHelp=el('p','',t('Recorded sources export as one ZIP containing STL and attribution JSON. Distribute both files together and retain any separately required licence texts and notices.'));
  const notesLabel=el('label','',t('Changes since insertion'));
  const exportNotes=el('textarea');exportNotes.maxLength=4096;exportNotes.rows=3;exportNotes.setAttribute('aria-label',t('Changes since insertion'));notesLabel.append(exportNotes);
  const notesHelp=el('p','',t('Describe changes since insertion accurately, including when unchanged.'));
  exportDialog.append(attributionHelp,notesLabel,notesHelp);
  let exporting=false,exportCanceled=false,exportDialogRevision=-1;
  function showExport(){exportNotes.value='';exportCanceled=false;exportDialogRevision=session.state.revision;refreshExportAttribution();exportDialog.showModal();}
  function refreshExportAttribution(){const attributed=hasModelAttribution(session.state.document);attributionHelp.hidden=notesLabel.hidden=notesHelp.hidden=!attributed;exportNotes.required=attributed;}
  const exportActions=el('footer');button('Cancel export',()=>{exportCanceled=true;exportDialog.close();},exportActions);
  exportDialog.addEventListener('cancel',()=>{exportCanceled=true;});
  const exportRun=button('Export',async()=>{
    if(exporting)return;
    exporting=true;refreshButtons();
    try{await deliver(exportFormat.value as 'stl'|'3mf',exportNotes.value,()=>{
      if(exportCanceled||!exportDialog.open)throw new Error(t('Export canceled'));
      if(session.state.revision!==exportDialogRevision)throw new Error(t('The model changed while exporting. Export again from the current model.'));
    });exportDialog.close();}finally{exporting=false;refreshButtons();}
  },exportActions,'primary');exportDialog.append(exportActions);exportDialog.addEventListener('keydown',event=>event.stopPropagation());shell.append(exportDialog);
  const exportButton=button('Export…',showExport);exportButton.disabled=true;
  const viewActions = el('div', 'view-actions'); viewActions.setAttribute('role', 'toolbar'); viewActions.setAttribute('aria-label', 'View controls'); viewHost.append(viewActions);
  button('Home', () => viewport.frame('iso'), viewActions); button('Fit', () => viewport.frame(undefined,true), viewActions);
  button('Zoom in', () => viewport.zoom(1.25), viewActions); button('Zoom out', () => viewport.zoom(0.8), viewActions);
  let ortho = false; const projectionButton = button('Orthographic view', () => { ortho = !ortho; viewport.setProjection(ortho); projectionButton.setAttribute('aria-pressed', String(ortho)); }, viewActions); projectionButton.setAttribute('aria-pressed', 'false');
  let planeVisible = true; const planeButton = button('Show workplane', () => { planeVisible = !planeVisible; viewport.setWorkplaneVisible(planeVisible); planeButton.setAttribute('aria-pressed', String(planeVisible)); }, viewActions); planeButton.setAttribute('aria-pressed', 'true');
  let multi = false; const multiButton = button('Multi-select', () => { multi = !multi; viewport.setMultiSelect(multi); multiButton.setAttribute('aria-pressed', String(multi)); }, viewActions); multiButton.setAttribute('aria-pressed', 'false');
  const viewSelect = el('select'); viewSelect.setAttribute('aria-label', 'View direction');
  for (const name of ['iso', 'top', 'front', 'right', 'back', 'left', 'bottom'] as const) { const option = el('option', '', t(name === 'iso' ? '3D view' : `${name[0].toUpperCase()}${name.slice(1)} view`)); option.value = name; viewSelect.append(option); }
  viewSelect.addEventListener('change', () => viewport.setView(viewSelect.value as import('./viewport.js').ViewDirection)); planeBar.prepend(viewSelect);
  viewport.setViewListener(view => { viewSelect.value = view; });
  function setMode(next: typeof mode) { mode = next; viewport.setMode(mode); modeButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((['select', 'translate', 'rotate', 'scale'] as const)[i] === mode)));shell.dataset.mode=mode;if(mode==='rotate'||mode==='scale'){inspector.classList.remove('closed');inspector.classList.add('open');}buildInspector(); }
  setMode('select');
  const browserExpanded=new Set<string>();let browserProject="";
  function buildTree() {
    tree.replaceChildren();const content=el('div','browser-content'); const header = el('div', 'panel-header'); header.append(el('h2', '', t('Objects'))); button('Close objects', () => { tree.classList.remove('open'); tree.classList.add('closed'); partsToggle.setAttribute('aria-pressed', 'false'); }, header); tree.append(header,content);if(iterationControl){const footer=el('div','browser-history');footer.append(el('span','',t('History')),iterationControl);tree.append(footer);}
    titleInput.value = session.state.document.title;
    const selected = session.state.selection; const doc = session.state.document;
    if(browserProject!==doc.id){browserExpanded.clear();browserProject=doc.id;}
    const section=(key:string,label:string,parent:HTMLElement,defaultOpen=false)=>{
      const details=el('details','browser-section');details.open=browserExpanded.has(key)||defaultOpen&&!browserExpanded.has(`closed:${key}`);
      const summary=el('summary','',t(label));details.append(summary);parent.append(details);
      details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open){browserExpanded.add(key);browserExpanded.delete(`closed:${key}`);}else{browserExpanded.delete(key);browserExpanded.add(`closed:${key}`);}});return details;
    };
    const bodies=section('bodies',t`Bodies · ${doc.roots.length}`,content,true);

    const seenNames=new Map<string,number>();const counts=new Map<string,number>();doc.roots.forEach(id=>counts.set(doc.nodes[id].name,(counts.get(doc.nodes[id].name)??0)+1));
    const append = (id: string, parent: HTMLElement, child = false) => {
      const n = doc.nodes[id]; const item = el('div', 'node'); const row = el('div', 'node-row'); item.dataset.objectId = id;
      const number=(seenNames.get(n.name)??0)+1;seenNames.set(n.name,number);const displayName=(counts.get(n.name)??0)>1?`${n.name} (${number})`:n.name;
      if (!child) { const check = el('input'); check.type = 'checkbox'; check.checked = selected.includes(id); check.setAttribute('aria-label', t`Select ${displayName}`); check.addEventListener('change', () => {session.select(check.checked ? [...selected, id] : selected.filter(x => x !== id));viewport.canvas.focus({preventScroll:true});}); row.append(check); }
      const select = button(displayName, () => {session.select([id]);viewport.canvas.focus({preventScroll:true});}, row, '', false);
      const icon=toolIcon(n.kind==='code'?'Code':n.kind==='extrusion'?'Sketch':n.kind==='boolean'?'Union':n.kind==='cylinder'?'Cylinder':n.kind==='sphere'?'Sphere':'Box');if(icon&&!select.querySelector('svg'))select.prepend(icon); select.classList.toggle('selected', selected.includes(id)); select.setAttribute('aria-pressed',String(selected.includes(id)));row.classList.toggle('selected',selected.includes(id));select.title = `${displayName} · ${n.role==='hole'?t('Hole'):t(n.kind)}`;if(n.role==='hole'){const tag=el('small','hole-tag',t('Hole'));row.append(tag);} select.dataset.testid = child?'construction-name':'object-name'; item.append(row);
      parent.append(item);
      // A generated preset is one editable part. Its implementation operands are
      // deliberately hidden; user-authored booleans retain browsable inputs.
      if(n.kind==='boolean'&&!n.generator&&!n.physics?.sourcePreset){
        const inputs=section(`inputs:${id}`,'Inputs',item);const children=el('div','children');inputs.append(children);n.inputs.forEach(input=>append(input,children,true));
      }else if(n.kind==='code'){
        const definition=section(`code:${id}`,'Code & parameters',item);button('Edit code definition',()=>codePanel.open(id),definition);
        const compiled=compileCode(n.program);for(const [name,value] of Object.entries(compiled.values)){const entry=el('div','browser-value');entry.append(el('span','',name),el('span','',`${Number(value.value.toFixed(4))} ${compiled.parameters[name].unit==='scalar'?'':compiled.parameters[name].unit}`));definition.append(entry);}
      }else if(n.kind==='extrusion'){
        const definition=section(`extrusion:${id}`,'Sketch & extrusion',item);const sketch=doc.sketches?.[n.sketchId];if(sketch)button(t`Edit sketch: ${sketch.name}`,()=>sketchPanel.open(id),definition);
      }
    };
    doc.roots.forEach(id => append(id, bodies));
    const sketches=Object.values(doc.sketches??{});if(sketches.length){const group=section('sketches',t`Sketches · ${sketches.length}`,content);for(const sketch of sketches){const feature=Object.values(doc.nodes).find(n=>n.kind==='extrusion'&&n.sketchId===sketch.id);if(feature)button(t`Sketch: ${sketch.name}`,()=>sketchPanel.open(feature.id),group);else group.append(el('div','browser-value',sketch.name));}}
    const parameters=Object.entries(doc.parametric?.parameters??{});if(parameters.length){const group=section('parameters',t`Parameters · ${parameters.length}`,content);button('Edit model parameters',()=>parametersPanel.open(),group);for(const [name,p] of parameters){const entry=el('div','browser-value');entry.append(el('span','',name),el('span','',p.expression));group.append(entry);}}

    if (!doc.roots.length) content.append(el('p', 'hint', t('No objects yet. Start with a box.')));
  }
  function field(parent: HTMLElement, label: string, value: string | number, change: (value: string) => void, type = 'number', step = '1') {
    const wrap = el('label', 'field', t(label)); const input = el('input'); input.type = type; input.value = String(value); input.setAttribute('aria-label', t(label)); input.step = step;
    input.addEventListener('change', () => run(() => change(input.value)));input.addEventListener('keydown',event=>{if(fineNumberKeys(input,event))return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();const apply=input.closest('.shape-parameters')?.querySelector<HTMLButtonElement>(`[aria-label="${t('Apply shape parameters')}"]`);input.blur();apply?.click();viewport.canvas.focus({preventScroll:true});}}); wrap.append(input); parent.append(wrap); return input;
  }
  function buildInspector() {
    inspector.replaceChildren(); const header = el('div', 'panel-header'); header.append(el('h2', '', t('Properties'))); button('Close properties', () => { inspector.classList.remove('open'); inspector.classList.add('closed'); propertiesToggle.setAttribute('aria-pressed', 'false'); }, header); inspector.append(header);
    const selection = session.state.selection;
    if(selection.some(id=>session.state.document.roots.includes(id))){inspector.append(el('div','inspect-title',t('Dimensions after transform (mm)')));const dimensions=el('div','triple');inspector.append(dimensions);for(const axis of ['X','Y','Z']){const bodies=built?.bodies.filter(body=>selection.includes(body.id))??[];const i=['X','Y','Z'].indexOf(axis),size=bodies.length?Math.max(...bodies.map(body=>body.bounds.max[i]))-Math.min(...bodies.map(body=>body.bounds.min[i])):'';const input=field(dimensions,t`Size ${axis} (mm)`,typeof size==='number'?Number(size.toFixed(3)):'',()=>{},'number','.1');input.readOnly=true;input.dataset.sizeAxis=axis;}}
    if(selection.length&&selection.every(id=>session.state.document.roots.includes(id)&&!session.state.document.nodes[id].reference)){const roles=el('div','shape-role');roles.setAttribute('role','group');roles.setAttribute('aria-label',t('Solid or hole'));for(const role of ['solid','hole'] as const){const label=role==='solid'?'Solid':'Hole',b=button(label,()=>session.setRole(role),roles);b.setAttribute('aria-pressed',String(selection.every(id=>(session.state.document.nodes[id].role??'solid')===role)));b.dataset.testid=`role-${role}`;b.title=role==='hole'?t('Union subtracts hole shapes from solid shapes'):t('Printable solid');}inspector.append(roles);}
    const activeKey=mode==='rotate'?'rotation':mode==='scale'?'scale':'position';
    function transformFields(ids:readonly string[],key:'position'|'rotation'|'scale'){
      const title=key==='rotation'?'Rotation':key==='scale'?'Scale':'Position';inspector.append(el('div','inspect-title',`${t(title)} (${key==='rotation'?'°':key==='scale'?'×':'mm'})`));const group=el('div','triple');inspector.append(group);
      ['X','Y','Z'].forEach((axis,i)=>field(group,`${t(title)} ${axis}`,session.state.document.nodes[ids[0]].transform[key][i],value=>{session.transform(ids.map(id=>{const transform=structuredClone(session.state.document.nodes[id].transform);transform[key][i]=Number(value);return {id,transform};}));},'number',key==='rotation'?'1':'0.1'));
    }
    if (selection.length !== 1) { inspector.append(el('p', 'selection-count', selection.length ? t`${selection.length} selected · per-object values` : t('Nothing selected')));if(selection.length)transformFields(selection,activeKey);return; }
    const id = selection[0], n = session.state.document.nodes[id];
    if(!session.state.document.roots.includes(id)){const parent=Object.values(session.state.document.nodes).find(node=>node.kind==='boolean'&&node.inputs.includes(id));if(parent)button(t`Back to ${parent.name}`,()=>{session.select([parent.id]);viewport.canvas.focus({preventScroll:true});},inspector);}
    inspector.append(el('div', 'selection-count', t`${n.name} · selected`));
    field(inspector, 'Object name', n.name, value => session.update(id, { name: value }), 'text');
    transformFields([id],activeKey);
    const recipe=n.generator??(session.state.document.roots.includes(id)?defaultGenerator(n.physics?.sourcePreset??''):undefined);
    if(recipe){
      const draft=structuredClone(recipe);const legacyLettering=!n.generator&&['text','name-tag'].includes(recipe.preset);if(legacyLettering)draft.text='';const form=el('div','shape-parameters');form.append(el('div','inspect-title',t`${t(recipe.preset[0].toUpperCase()+recipe.preset.slice(1))} parameters`));
      if(legacyLettering)form.append(el('p','hint',t('This older object did not retain its text. Enter the lettering to make it editable; the existing solid stays unchanged until Apply.')));
      if(draft.preset==='text'||draft.preset==='name-tag'){
        field(form,'Text',draft.text??'',value=>draft.text=value,'text');const label=el('label','field',t('Font')),select=el('select');select.setAttribute('aria-label',t('Font'));
        for(const [value,name] of [['sans','Droid Sans'],['serif','Droid Serif'],['mono','Droid Sans Mono'],['block',t('Original block letters')]]){const option=el('option','',name);option.value=value;select.append(option);}select.value=draft.font??'sans';select.onchange=()=>draft.font=select.value as typeof draft.font;label.append(select);form.append(label);
      }
      for(const parameter of generatorFields(recipe.preset)){
        if(parameter.key==='hand'){const label=el('label','field',t('Thread handedness'));const select=el('select');select.setAttribute('aria-label',t('Thread handedness'));for(const [value,name] of [[1,'Right hand'],[-1,'Left hand']] as const){const option=el('option','',t(name));option.value=String(value);select.append(option);}select.value=String(draft.values.hand);select.onchange=()=>draft.values.hand=Number(select.value);label.append(select);form.append(label);}
        else{const input=field(form,parameter.label,draft.values[parameter.key],value=>draft.values[parameter.key]=Number(value),'number',String(parameter.step));input.min=String(parameter.min);input.max=String(parameter.max);}
      }
      const apply=button('Apply shape parameters',async()=>{const expected=session.state.revision;apply.disabled=true;try{const fragment=createPresetDocument(draft.preset,'BRICKWRIGHT',{recipe:draft});await client.evaluate(fragment);if(disposed)return;if(session.state.revision!==expected)throw new Error(t('The model changed while generating this shape. Apply again.'));session.replaceGenerated(id,fragment);await whenIdle();}finally{apply.disabled=false;}},form,'primary');if(n.generator){const advanced=el('details');advanced.append(el('summary','',t('Advanced')));button('Detach generator',()=>session.detachGenerator(id),advanced);form.append(advanced);}inspector.append(form);
    }
    if(n.kind==='code')button('Edit code',()=>codePanel.open(id),inspector);
    if(n.kind==='extrusion'){
      const sketch=session.state.document.sketches![n.sketchId];inspector.append(el('p','hint',t`${sketch.name} · ${t(sketch.profile.kind)} · ${sketch.plane} plane`));
      button('Edit sketch & extrusion',()=>sketchPanel.open(id),inspector);
    }
    const graph=designGraph(session.state.document),entries=new Map(graph.map(e=>[e.key,e])),upstream=new Set<string>();
    const visitInput=(key:string)=>{if(upstream.has(key))return;upstream.add(key);entries.get(key)?.dependencies.forEach(visitInput);};visitInput(`feature:${id}`);
    const dimensions=graph.filter(e=>e.kind==='parameter'&&upstream.has(e.key));
    if(dimensions.length&&session.state.document.parametric){
      const design=el('details','design-inputs');design.open=true;design.append(el('summary','',t('Design inputs')));const values=evaluateParameters(session.state.document.parametric);
      for(const parameter of dimensions){const p=session.state.document.parametric.parameters[parameter.id];const input=field(design,t`Parameter ${parameter.label} (${p.unit})`,p.expression,expression=>{const next=structuredClone(session.state.document.parametric!);next.parameters[parameter.id].expression=expression;session.setParametric(next);},'text');input.parentElement?.append(el('small','',`${Number(values[parameter.id].value.toFixed(5))} ${p.unit==='scalar'?'':p.unit}`));}inspector.append(design);
    }
    field(inspector, 'Color', n.color, value => session.update(id, { color: value }), 'color');
    if (n.kind === 'box') {
      (['Width', 'Depth', 'Height'] as const).forEach((label, i) => field(inspector, `${label} (mm)`, n.size[i], value => { const size = [...n.size] as Vec3; size[i] = Number(value); session.update(id, { size }); }, 'number', '0.1'));
    } else if (n.kind === 'cylinder' || n.kind === 'sphere') {
      field(inspector, 'Radius (mm)', n.radius, value => session.update(id, { radius: Number(value) }), 'number', '0.1');
      if (n.kind === 'cylinder') field(inspector, 'Height (mm)', n.height, value => session.update(id, { height: Number(value) }), 'number', '0.1');
      field(inspector, 'Segments', n.segments, value => session.update(id, { segments: Number(value) }), 'number', '4');
    } else if (n.kind === 'boolean'&&!recipe&&!n.physics?.sourcePreset&&!n.reference) {
      const sources=el('details','construction-sources');sources.append(el('summary','',t('Edit source shapes')));for(const sourceId of n.inputs){const source=session.state.document.nodes[sourceId];button(t`Edit ${source.name}`,()=>{session.select([sourceId]);viewport.canvas.focus({preventScroll:true});},sources);}inspector.append(sources);
      button('Separate operands', () => session.separate(id), inspector);
    }
    for (const [key, title, units, step] of [['position', 'Position', 'mm', '0.1'], ['rotation', 'Rotation', '°', '1'], ['scale', 'Scale', '×', '0.1']] as const) {
      if(key===activeKey)continue;
      inspector.append(el('div', 'inspect-title', `${t(title)} (${units})`)); const group = el('div', 'triple'); inspector.append(group);
      ['X', 'Y', 'Z'].forEach((axis, i) => field(group, `${t(title)} ${axis}`, n.transform[key][i], value => { const transform = structuredClone(n.transform); transform[key][i] = Number(value); session.update(id, { transform }); }, 'number', step));
    }
    button('Reset transform', () => session.update(id, { transform: identityTransform() }), inspector);
    if(!n.reference&&n.role!=='hole' && session.state.document.roots.includes(id)) {
      const physics=el('details','physics-settings');physics.append(el('summary','',t('Physics material')));inspector.append(physics);
      const p=n.physics??defaultPartPhysics();
      for(const [key,label,step] of [['densityKgM3','Density (kg/m³)','10'],['friction','Friction','0.05'],['restitution','Restitution','0.05']] as const)field(physics,label,p[key],value=>session.update(id,{physics:{...p,[key]:Number(value)}}),'number',step);
      const label=el('label','field',t('Body motion'));const select=el('select');select.setAttribute('aria-label',t('Body motion'));for(const motion of ['dynamic','static'] as const){const option=el('option','',t(motion==='dynamic'?'Dynamic':'Fixed in world'));option.value=motion;select.append(option);}select.value=p.motion;select.addEventListener('change',()=>run(()=>session.update(id,{physics:{...p,motion:select.value as 'dynamic'|'static'}})));label.append(select);physics.append(label);
      if(p.intent!=='rigid')physics.append(el('p','hint',t`Mechanical role: ${t(p.intent)}. Rigid collision preview does not qualify elastic behavior, mating fit or a complete mechanism.`));
      if(session.state.document.joints?.some(j=>j.bodyA===id||j.bodyB===id))button('Detach joints',()=>session.detachJoints([id]),inspector);
    }
    const bindings=session.state.document.parametric?.bindings.filter(binding=>binding.nodeId===id)??[];
    for(const binding of bindings){const label=propertyLabels[binding.property];const input=Array.from(inspector.querySelectorAll('input')).find(input=>input.getAttribute('aria-label')===t(label));if(input){input.disabled=true;input.title=t`Driven by ${binding.expression}`;input.parentElement?.append(el('small','driven-expression',`= ${binding.expression}`));}}
    if(bindings.length)button('Edit driving expressions',()=>parametersPanel.open(),inspector);
  }
  async function buildLatest() {
    if (running || disposed || builtRevision === session.state.revision) return;
    running = true; busy.hidden = false; host.dataset.state = 'building';
    while (!disposed && builtRevision !== session.state.revision) {
      const { document: doc, revision } = session.state;
      try {
        const result = await client.evaluate(doc);
        if (disposed) break;
        if (revision !== session.state.revision) continue;
        built = result; builtRevision = revision; geometryError = ''; errorPanel.hidden = true; viewport.update(result); empty.hidden = !!doc.roots.length;
        stats.textContent = doc.roots.length === 1 ? t`${doc.roots.length} body · ${result.triangles.toLocaleString()} triangles · ${result.volume.toLocaleString(undefined, { maximumFractionDigits: 1 })} mm³` : t`${doc.roots.length} bodies · ${result.triangles.toLocaleString()} triangles · ${result.volume.toLocaleString(undefined, { maximumFractionDigits: 1 })} mm³`;
        message.textContent = operationError || (doc.roots.length ? 'Ready · mm · Z up' : 'Add a solid to begin');
        host.dataset.state = 'ready'; host.dataset.triangles = String(result.triangles);
        for (const w of waiters) w.resolve(result); waiters.clear();
      } catch (e) {
        if (disposed) break; if (revision !== session.state.revision) continue;
        builtRevision = revision; built = null; geometryError = e instanceof Error ? e.message : String(e); errorPanel.textContent = t`${geometryError} Showing the previous geometry. Fix the edit or Undo.`; errorPanel.hidden = false; host.dataset.state = 'error'; report(e);
        for (const w of waiters) w.reject(new Error(geometryError)); waiters.clear();
      }
    }
    running = false; busy.hidden = true; refreshButtons();
  }
  function refreshButtons() {
    const state = session.state; const roots = state.selection.filter(id => state.document.roots.includes(id));
    undoButton.disabled = !state.canUndo; redoButton.disabled = !state.canRedo; duplicateButton.disabled = deleteButton.disabled = !roots.length;
    cutButton.disabled=copyButton.disabled=!roots.length;
    dropButton.disabled = !roots.length || running || builtRevision !== state.revision || !built;
    opButtons.forEach(b => { b.disabled = roots.length < 2; });
    fitSelectionActions();contextActions.hidden=!state.selection.some(id=>state.document.roots.includes(id));for(const control of contextActions.querySelectorAll<HTMLButtonElement>('button'))control.disabled=running;
    refreshExportAttribution();
    exportButton.disabled = exportRun.disabled = exporting || !options.onExport || running || !built || !built.triangles || builtRevision !== state.revision;
    run(()=>options.onCommandStateChange?.(commandState()));
  }
  function commandState():CadCommandState {const state=session.state,roots=state.selection.filter(id=>state.document.roots.includes(id));return {canUndo:state.canUndo,canRedo:state.canRedo,hasSelection:!!state.selection.length,canDelete:!!roots.length,canCombine:roots.length>=2,canExport:!!options.onExport&&!exporting&&!running&&!!built?.triangles&&builtRevision===state.revision,hasBodies:!!state.document.roots.length,ready:!running&&builtRevision===state.revision&&!!built};}
  const unsubscribe = session.subscribe(state => {
    if (disposed) return;
    if (state.revision !== lastRevision) {
      lastRevision = state.revision; operationError = ''; buildTree(); buildInspector(); refreshButtons();
      run(() => options.onDocumentChange?.(state.document, state.revision)); void buildLatest();
    } else { buildTree(); buildInspector(); }
    const selection = JSON.stringify(state.selection);
    if (selection !== lastSelection) { lastSelection = selection; viewport.setSelection(state.selection); run(() => options.onSelectionChange?.(state.selection)); }
    refreshButtons();
  });
  const keyboard = (event: KeyboardEvent) => {
    const editable = event.composedPath().some(x => x instanceof HTMLInputElement || x instanceof HTMLTextAreaElement || x instanceof HTMLSelectElement);
    const command = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase(); let action: (() => unknown) | undefined;
    if(editable&&key!=='escape'&&!(command&&key==='s'))return;
    if(editable&&(key==='escape'||command&&key==='s'))(event.composedPath()[0] as HTMLElement).blur();
    if (command && key === 'z') action = () => event.shiftKey ? session.redo() : session.undo();
    else if (command && key === 'y') action = () => session.redo();
    else if (command && key === 's') action = () => deliver('bcad');
    else if (command && key === 'a') action = () => session.select(session.state.document.roots);
    else if(command&&key==='g')action=()=>event.shiftKey?session.separate(session.state.selection[0]):session.combine('union');
    else if(!command&&key==='h'&&session.state.selection.length)action=()=>session.setRole('hole');
    else if(!command&&key==='s'&&session.state.selection.length)action=()=>session.setRole('solid');
    else if (command && key === 'd') action = () => session.duplicate();
    else if (command && key === 'c') action=()=>copySelection();
    else if (command && key === 'x') action=()=>copySelection(true);
    else if (command && key === 'v') action=()=>pasteSelection();
    else if ((command && key === 'k') || (!command && event.shiftKey && key === 'a')) action = () => picker.open(true);
    else if (key === 'delete' || key === 'backspace') action = () => session.remove();
    else if (key === 'escape') action = () => {const cancelled=viewport.interacting; viewport.cancelTransform();menus.forEach(menu=>menu.open=false);if(cancelled)return;if(mode!=='select')setMode('select');else session.select([]); };
    else if (key === 'v') action = () => setMode('select');
    else if (!command&&key === 'f') action = () => viewport.frame(undefined,!event.shiftKey);
    else if (!command&&key==='o')action=()=>projectionButton.click();
    else if (!command&&event.code==='NumpadDecimal')action=()=>viewport.frame(undefined,true);
    else if (!command&&['Numpad1','Numpad3','Numpad7'].includes(event.code))action=()=>viewport.setView(event.code==='Numpad1'?'front':event.code==='Numpad3'?'right':'top');
    else if (!command&&event.code==='Numpad5')action=()=>projectionButton.click();
    else if (!command&&key==='home')action=()=>viewport.frame();
    else if (!command&&['+','=','-','_'].includes(key))action=()=>viewport.zoom(key==='-'||key==='_'?1/1.2:1.2);
    else if (!command&&/^[1-6]$/.test(key))action=()=>{viewport.setView((['front','right','top','back','left','bottom'] as const)[Number(key)-1]);if(event.shiftKey)viewport.frame(undefined,true);};
    else if (key.startsWith('arrow')&&!session.state.selection.length)action=()=>command?viewport.pan(key==='arrowleft'?-30:key==='arrowright'?30:0,key==='arrowup'?-30:key==='arrowdown'?30:0):viewport.orbit(key==='arrowleft'?-Math.PI/6/.005:key==='arrowright'?Math.PI/6/.005:0,key==='arrowup'?-Math.PI/6/.005:key==='arrowdown'?Math.PI/6/.005:0);
    else if (key === 'w') action = () => setMode('translate');
    else if (key === 'e') action = () => setMode('rotate');
    else if (key === 'r') action = () => setMode('scale');
    else if (key.startsWith('arrow') && session.state.selection.length) action = () => { const fine=event.shiftKey||viewport.fine,d = (grid || .1)/(fine?10:1); viewport.nudge(key === 'arrowleft' ? -d : key === 'arrowright' ? d : 0, key === 'arrowup' && !event.altKey ? d : key === 'arrowdown' && !event.altKey ? -d : 0, event.altKey ? (key === 'arrowup' ? d : key === 'arrowdown' ? -d : 0) : 0,fine); };
    if (action) { event.preventDefault(); event.stopPropagation(); run(action); }
  }; shell.addEventListener('keydown', keyboard);
  const dismissMenus=(event:Event)=>{const path=event.composedPath();for(const menu of menus)if(menu.open&&!path.includes(menu))menu.open=false;};document.addEventListener('pointerdown',dismissMenus,true);document.addEventListener('focusin',dismissMenus,true);
  function whenIdle(): Promise<GeometryResult> {
    if (disposed) return Promise.reject(new Error(t('Editor was disposed')));
    if (!running && builtRevision === session.state.revision) return built ? Promise.resolve(built) : Promise.reject(new Error(geometryError));
    return new Promise((resolve, reject) => { waiters.add({ resolve, reject }); });
  }
  async function openFile(name: string, bytes: Uint8Array) {
    const expectedRevision=session.state.revision;
    let doc: CadDocument;
    if (/\.stl$/i.test(name)) {
      const mesh = importSTL(bytes); doc = createDocument(name.replace(/\.stl$/i, '')); const id = newId();
      doc.nodes[id] = { id, name: doc.title, kind: 'mesh', ...mesh, color: '#eea52b', transform: identityTransform() }; doc.roots = [id];
    } else doc = options.decodeProject?await options.decodeProject(bytes):parseDocument(new TextDecoder().decode(bytes));
    // Geometry errors in imported meshes must not destroy the current project.
    await client.evaluate(doc); if (disposed) return;if(session.state.revision!==expectedRevision)throw new Error(t('The model changed while opening the file. Try opening it again.')); session.load(doc); await whenIdle(); viewport.frame();viewport.canvas.focus({preventScroll:true});
  }
  async function importFile(name:string,bytes:Uint8Array){
    if(!/\.stl$/i.test(name))throw new Error(t('Geometry import currently accepts closed STL meshes'));if(bytes.length>16*1024*1024)throw new Error(t('STL exceeds 16 MiB'));
    const expected=session.state.revision,fragment=createDocument(name.replace(/\.stl$/i,'')),id=newId();fragment.nodes[id]={...importSTL(bytes),id,kind:'mesh',name:fragment.title,color:'#eea52b',transform:identityTransform()};fragment.roots=[id];
    const geometry=await client.evaluate(fragment);if(disposed)return;if(session.state.revision!==expected)throw new Error(t('The model changed while importing. Try importing again.'));
    session.insert(fragment,[session.state.document.roots.length*12,0,-geometry.bodies[0].bounds.min[2]],{label:'Import geometry'});await whenIdle();viewport.frame();
  }
  let clipboardText='',pasteCount=0;
  async function copySelection(cut=false){
    const expected=session.state.revision,ids=[...session.state.selection],fragment=session.fragment(ids);serializeDocument(fragment);
    const text=JSON.stringify({format:'brickwright-cad-clipboard',version:1,document:fragment});
    if(options.writeClipboard)await options.writeClipboard(text);else if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else throw new Error(t('Clipboard access is unavailable in this host'));
    if(cut){if(session.state.revision!==expected)throw new Error(t('The model changed: objects were copied, but cutting was canceled'));session.remove(ids,'Cut objects');}
    viewport.canvas.focus({preventScroll:true});message.textContent=cut?'Cut objects':'Copied objects';
  }
  async function pasteSelection(){
    const expected=session.state.revision,text=options.readClipboard?await options.readClipboard():navigator.clipboard?.readText?await navigator.clipboard.readText():null;
    if(!text||new TextEncoder().encode(text).length>16*1024*1024)throw new Error(t('Clipboard does not contain a supported CAD selection'));
    let value:unknown;try{value=JSON.parse(text);}catch{throw new Error(t('Clipboard does not contain CAD objects'));}
    const payload=value as {format?:string;version?:number;document?:unknown};if(payload?.format!=='brickwright-cad-clipboard'||payload.version!==1)throw new Error(t('Clipboard does not contain CAD objects'));
    const fragment=validateDocument(payload.document);await client.evaluate(fragment);if(disposed)return;if(session.state.revision!==expected)throw new Error(t('The model changed while pasting. Try pasting again.'));
    pasteCount=text===clipboardText?pasteCount+1:1;clipboardText=text;session.insert(fragment,[10*pasteCount,0,0],{mergeParameters:true,label:'Paste objects'});await whenIdle();viewport.canvas.focus({preventScroll:true});viewport.frame();
  }
  async function executeCommand(command:CadCommand){
    switch(command){
      case 'new':await newProject();break;case 'open':await chooseOpen();break;case 'save':await deliver('bcad');break;case 'import':await chooseImport();break;case 'export':if(exportButton.disabled)throw new Error(t('Build a solid before exporting'));showExport();break;
      case 'undo':session.undo();break;case 'redo':session.redo();break;case 'cut':await copySelection(true);break;case 'copy':await copySelection();break;case 'paste':await pasteSelection();break;case 'duplicate':session.duplicate();break;case 'delete':session.remove();break;
      case 'select-all':session.select(session.state.document.roots);break;case 'deselect':session.select([]);break;
      case 'select':setMode('select');break;case 'move':setMode('translate');break;case 'rotate':setMode('rotate');break;case 'scale':setMode('scale');break;
      case 'home':viewport.frame('iso');break;case 'fit':viewport.frame(undefined,true);break;case 'top':case 'front':case 'right':case 'back':case 'left':case 'bottom':viewport.setView(command);break;
      case 'projection':projectionButton.click();break;case 'workplane':planeButton.click();break;case 'objects':partsToggle.click();break;case 'properties':propertiesToggle.click();break;case 'drop':viewport.dropSelection();break;case 'parameters':parametersPanel.open();break;case 'sketch':sketchPanel.open();break;case 'model-source':modelSourcePanel.toggle();break;case 'model-library':modelLibraryPanel.open();break;case 'code':codePanel.open(session.state.selection.length===1&&session.state.document.nodes[session.state.selection[0]]?.kind==='code'?session.state.selection[0]:undefined);break;case 'readout':readout.setVisible(!readout.visible);break;
      case 'shapes':picker.open(true);break;
      case 'union':case 'subtract':case 'intersect':session.combine(command);break;
      default:throw new Error(t('Unknown editor command'));
    }
    if(!['open','import','save','export','parameters','shapes','code','sketch'].includes(command))viewport.canvas.focus({preventScroll:true});
  }
  async function deliver(format: 'bcad' | 'stl' | '3mf', modificationNotes?: string, checkCanceled: () => void = () => {}) {
    if(format==='bcad'&&options.saveProject){await options.saveProject();return;}
    if (!options.onExport) throw new Error(t('This host has not provided file export'));
    if(format==='bcad'){
      const title=session.state.document.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').trim()||'design';
      await options.onExport({name:`${title}.bcad`,bytes:new TextEncoder().encode(session.serialize()),mime:'application/vnd.brickwright.cad+json'});return;
    }
    const exportRevision=session.state.revision;
    const checkCurrent=()=>{
      if(disposed)throw new Error(t('Editor was disposed'));
      checkCanceled();
      if(session.state.revision!==exportRevision)throw new Error(t('The model changed while exporting. Export again from the current model.'));
    };
    const file=await prepareMeshExport(session.state.document,format,()=>whenIdle(),checkCurrent,modificationNotes);
    checkCurrent();
    await options.onExport(file);
  }
  buildTree(); buildInspector(); lastRevision = session.state.revision; lastSelection = JSON.stringify(session.state.selection); viewport.setSelection(session.state.selection); void buildLatest(); refreshButtons();
  return {
    session, whenIdle, openFile,importFile,executeCommand,setNavigation:viewport.setNavigation,setAppearance:viewport.setAppearance,get appearance(){return viewport.appearance;},get commandState(){return commandState();}, export: deliver, frame: viewport.frame,
    setTransformReadoutVisible(visible:boolean){readout.setVisible(visible);},get transformReadoutVisible(){return readout.visible;},
    focus() { viewport.canvas.focus(); },
    setStatus(text: string) { if (!disposed) message.textContent = text; },
    dispose() { if (disposed) return; disposed = true; toolbarResize.disconnect();unsubscribe();document.removeEventListener('pointerdown',dismissMenus,true);document.removeEventListener('focusin',dismissMenus,true); shell.removeEventListener('keydown', keyboard); picker.dispose(); modelLibraryPanel.dispose(); parametersPanel.dispose(); sketchPanel.dispose(); codePanel.dispose(); modelSourcePanel.dispose(); readout.dispose(); viewport.dispose(); client.dispose(); for (const w of waiters) w.reject(new Error(t('Editor was disposed'))); waiters.clear(); if (ownsSession) session.dispose(); shadow.replaceChildren(); host.removeAttribute('data-state'); host.removeAttribute('data-triangles'); },
  };
}
export type CadEditor = ReturnType<typeof mountCadEditor>;
export { createCadSession } from '@brickwright/cad-core';
export { shapeCatalog, createPresetDocument } from './shapes.js';
