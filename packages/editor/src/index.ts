import {physicsMaterials} from '@brickwright/cad-core';
import {canAddRobotElectronics,addRobotElectronics} from './robot-electronics.js';
import {mountSimulationPanel} from './simulation-panel.js';
import {mountScrewRedesign} from './screw-redesign.js';
// SPDX-License-Identifier: BSD-3-Clause
import {prepareMeshExport} from './export-policy.js';
import {mountModelLibraryPanel, type ModelLibraryOptions} from './model-library-panel.js';
export type {ModelLibraryOptions} from './model-library-panel.js';
import {fineNumberKeys} from './precision.js';
import { t } from '@brickwright/cad-core';
import { createCadSession, createDocument, identityTransform, newId, parseDocument, defaultPartPhysics,defaultGenerator,generatorFields,validateDocument,serializeDocument,designGraph,evaluateParameters,compileCode,hasModelAttribution,isCube,screwTipStyles,screwTipParameters,redesignScrew } from '@brickwright/cad-core';
import type { CadDocument, CadSession, Primitive, SolidNode, Transform, Vec3, GeneratorRecipe } from '@brickwright/cad-core';
import { importSTL } from '@brickwright/cad-geometry';
import type { GeometryResult } from '@brickwright/cad-geometry';
import { createGeometryClient } from './geometry-client.js';
import {mountTransformReadout} from './transform-readout.js';
import type {GridDisplay} from './workplane-grid.js';
export type {GridDisplay} from './workplane-grid.js';
import type {NavigationPreset} from './camera-input.js';
export type {NavigationPreset} from './camera-input.js';
import { mountViewport } from './viewport.js';
import { editorStyle } from './style.js';
import {themedEditorStyle} from './color-mode.js';
import type {CadColorMode} from './color-mode.js';
export type {CadColorMode} from './color-mode.js';
import { toolIcon } from './icons.js';
import {placeFragment} from './surface-placement.js';
import type {PlacementPointer} from './surface-placement.js';
import type {ShapeBrowserLayout} from './shape-picker.js';
import type {ShapePreset} from './shapes.js';
import { mountShapePicker } from './shape-picker.js';
import { createPresetDocument, evaluatedPreview, shapeCatalog } from './shapes.js';
import {mountModelSourcePanel} from './model-source-panel.js';
import {mountCodePanel} from './code-panel.js';
import {exportSketchDxf} from './sketch-dxf.js';
import {exportDrawingSetPdf} from './drawing-pdf.js';
import {mountDrawingPanel} from './drawing-panel.js';
import {exportSketchPdf} from './sketch-pdf.js';
import {mountSketchPanel} from './sketch-panel.js';
import { mountParametersPanel, propertyLabels } from './parameters-panel.js';
export interface CadFile { name: string; bytes: Uint8Array; mime: string }
export interface CadEditorOptions {
  headerContent?: HTMLElement;
  /** Host-owned controls stay in light DOM, slotted into the single tool row. */
  toolbarContent?:HTMLElement;
  /** Embedded hosts already own project files; avoid a second File menu. */
  embedded?:boolean;
  /** A host may own the sole project title. */
  showDocumentTitle?:boolean;
  /** Optional whole-project choices supplied by an embedding application. */
  presetProjects?:{ids:readonly string[];open:(presetId:string)=>Promise<void>};
  /** Desktop hosts provide the sole File menu through their native menu bar. */
  nativeMenus?:boolean;
  modelLibrary?: ModelLibraryOptions;
  colorMode?:CadColorMode;
  navigationPreset?:NavigationPreset;
  resizeControls?:'dimensions'|'gizmo';
  gridDisplay?:GridDisplay;
  surfaceSnap?:boolean;
  onSurfaceSnapChange?:(enabled:boolean)=>void;
  rightPane?:{shapesFirst:boolean;split:number};
  shapeBrowserLayout?:ShapeBrowserLayout;
  onShapeBrowserLayoutChange?:(layout:ShapeBrowserLayout)=>void;
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
  onSimulationInterrupt?:()=>void;
  onSelectionChange?: (selection: readonly string[]) => void;
  onExport?: (file: CadFile) => void | Promise<void>;
  requestOpen?: () => Promise<{ name: string; bytes: Uint8Array } | null>;
  requestNew?: () => boolean | Promise<boolean>;
  onError?: (error: Error) => void;
}
export interface CadCommandState {canUndo:boolean;canRedo:boolean;hasSelection:boolean;canDelete:boolean;canCombine:boolean;canExport:boolean;hasBodies:boolean;ready:boolean}
export type CadCommand='new'|'open'|'save'|'import'|'export'|'undo'|'redo'|'cut'|'copy'|'paste'|'duplicate'|'delete'|'select-all'|'deselect'|'select'|'move'|'rotate'|'scale'|'home'|'fit'|'top'|'front'|'right'|'back'|'left'|'bottom'|'projection'|'workplane'|'objects'|'properties'|'drop'|'parameters'|'shapes'|'sketch'|'revolve'|'readout'|'code'|'model-source'|'model-library'|'union'|'subtract'|'intersect';
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element;
}
/** Mounts one isolated editor. No storage, window keyboard handlers, React or Scratch globals. */
export function mountCadEditor(host: HTMLElement, options: CadEditorOptions) {
  const session = options.session ?? createCadSession(options.document); const ownsSession = !options.session;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (shadow.childElementCount) throw new Error(t('Mount target is already in use'));
  const style = el('style'); style.textContent = themedEditorStyle(editorStyle);host.dataset.cadColorMode=options.colorMode??'dark'; const shell = el('section', 'editor'); shell.setAttribute('aria-label', 'CAD editor');
  const toolbar = el('div', 'toolbar'); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Model tools');
  if(options.embedded){shell.classList.add('embedded');style.textContent+='\n.editor.embedded .design-bar{grid-template-columns:minmax(76px,130px) minmax(0,1fr) auto}.editor.embedded .project-actions,.editor.embedded .units-label{display:none}.editor.embedded .toolbar{overflow-x:auto;scrollbar-width:none;flex-wrap:nowrap}.editor.embedded .toolbar>slot{order:-2}';}
  if(options.toolbarContent){const slot=document.createElement('slot');slot.name='host-toolbar-controls';slot.style.display='inline-flex';slot.style.flexShrink='0';options.toolbarContent.slot=slot.name;host.append(options.toolbarContent);toolbar.append(slot);}
  const iterationControl=options.headerContent?.querySelector<HTMLSelectElement>('#iterations');const projectsControl=options.headerContent?.querySelector<HTMLButtonElement>('#library');
  const main = el('div', 'main'); const tree = el('aside', 'panel tree'); const viewHost = el('div', 'viewport'); const inspector = el('aside', 'panel inspector');
  let rightPane={shapesFirst:true,split:50};const setRightPane=(value:typeof rightPane)=>{if(typeof value.shapesFirst!=='boolean'||!Number.isFinite(value.split)||value.split<20||value.split>80)throw new Error(t('Choose a pane split between 20 and 80 percent'));rightPane={...value};main.dataset.shapesFirst=String(value.shapesFirst);main.style.setProperty('--right-pane-split',`${value.split}%`);};setRightPane(options.rightPane??rightPane);
  const status = el('div', 'status'); const message = el('span'); message.setAttribute('role', 'status');message.setAttribute('aria-label',t('Editor status')); message.setAttribute('aria-live', 'polite'); const stats = el('span', 'stats'); status.append(message, stats);
  const designBar = el('div', 'design-bar');
  const titleInput = el('input'); titleInput.setAttribute('aria-label', 'Design title'); titleInput.addEventListener('keydown',event=>{if(event.key==='Enter')titleInput.blur();else if(event.key==='Escape'){titleInput.value=session.state.document.title;titleInput.blur();}}); titleInput.addEventListener('change', () => run(() => session.rename(titleInput.value))); designBar.append(titleInput, el('span', 'units-label', t('mm · Z up')));
  if(options.showDocumentTitle===false){titleInput.hidden=true;designBar.style.gridTemplateColumns='minmax(0,1fr) auto';}
  main.append(tree, viewHost, inspector); designBar.append(toolbar);shell.append(designBar, main, status); shadow.append(style, shell);
  let disposed = false; let builtRevision = -1; let built: GeometryResult | null = null; let running = false; let lastRevision = -1; let lastSelection = ''; let geometryError = ''; let mode: 'select' | 'translate' | 'rotate' | 'scale' = 'select'; let grid = 1;
  const waiters = new Set<{ resolve: (r: GeometryResult) => void; reject: (e: Error) => void }>();
  let operationError = '';
  function report(e: unknown) { const error = e instanceof Error ? e : new Error(String(e)); operationError = error.message; message.textContent = error.message; if (!disposed) options.onError?.(error); }
  const run = (fn: () => unknown) => { try { const result = fn(); if (result instanceof Promise) result.catch(report); } catch (e) { report(e); } };
  const client = createGeometryClient(new URL(options.wasmURL, document.baseURI).href, options.createWorker);
  let viewport: ReturnType<typeof mountViewport>;let customAppearance=!!options.appearance;
  try { viewport = mountViewport(viewHost, session, report,options.appearance);if(!options.appearance&&options.colorMode==='light')viewport.setAppearance({background:'#e7eef7',baseplate:'#cdd9e8'});viewport.setNavigation(options.navigationPreset??'tinkercad');viewport.setResizeControls(options.resizeControls??'dimensions');viewport.setGridDisplay(options.gridDisplay??'snap');viewport.setSurfaceSnap(options.surfaceSnap??true); } catch (e) { client.dispose(); shadow.replaceChildren(); if (ownsSession) session.dispose(); throw e; }
  const empty = el('div', 'empty'); empty.append(el('strong', '', t('Your next idea starts here.')), document.createTextNode(t('Pick a shape above. Set its dimensions in Properties. Drag to orbit; pinch to zoom.'))); viewHost.append(empty);
  const busy = el('div', 'busy', t('Building solid…')); busy.hidden = true; viewHost.append(busy);
  const errorPanel = el('div', 'error'); errorPanel.hidden = true; errorPanel.setAttribute('role', 'alert'); viewHost.append(errorPanel);
  let toolParent: HTMLElement = toolbar;
  const menus:HTMLDetailsElement[]=[];
  function toolGroup(label: string, className = '') {
    if(['File','Edit','Combine'].includes(label)){
      const group=el('details',`command-menu ${className}`);const trigger=el('summary','',`${t(label)} ▾`);trigger.setAttribute('aria-label',t`${t(label)} menu`);if(label!=='File'){trigger.textContent='';const icon=toolIcon(label==='Combine'?'Union':'Edit');if(icon)trigger.append(icon);trigger.title=t(label);}
      const tools=el('div','command-popup');group.append(trigger,tools);toolbar.append(group);group.hidden=label==='File'&&(options.nativeMenus===true||options.embedded===true);toolParent=tools;menus.push(group);
      group.addEventListener('toggle',()=>{if(group.open)menus.forEach(menu=>{if(menu!==group)menu.open=false;});});
      tools.addEventListener('click',event=>{if((event.target as Element).closest('button:not(:disabled)'))group.open=false;});return;
    }
    const group = el('div', `tool-group ${className}`); group.setAttribute('role', 'group'); group.setAttribute('aria-label', t(label)); const tools = el('div', 'group-tools'); group.append(tools); toolbar.append(group); toolParent = tools;
  }
  function button(label: string, action: () => unknown, parent: HTMLElement = toolParent, className = '', translate = true) {
    const b = el('button', className); const icon = toolIcon(label); if (icon) b.append(icon); const display = translate ? t(label) : label; b.append(el('span', '', display)); b.type = 'button'; b.title = display; b.setAttribute('aria-label', display); b.addEventListener('click', () => run(action)); parent.append(b); return b;
  }
  function togglePanel(panel: HTMLElement, toggle: HTMLButtonElement) { const visible = getComputedStyle(panel).display !== 'none'; panel.classList.toggle('closed', visible); panel.classList.toggle('open', !visible); toggle.setAttribute('aria-pressed', String(!visible)); }
  const simulation=mountSimulationPanel(viewHost,session,options.wasmURL,whenIdle,value=>viewport.setSimulationPoses(value),{connectorHandles:visible=>viewport.setConnectorHandlesVisible(visible),dragEnabled:enabled=>viewport.setSimulationDragEnabled(enabled),pickPoint:done=>viewport.pickPoint(done),traces:paths=>viewport.setSimulationTraces(paths),canvas:viewport.canvas,onExport:options.onExport,onInterrupt:options.onSimulationInterrupt});
  viewport.setSimulationDrag(value=>{void(value?simulation.dragBody(value.bodyId,value.point,value.target):simulation.releaseDrag()).catch(error=>{viewport.cancelSimulationDrag();options.onError?.(error);});});
  if(!options.embedded)button('Simulate',()=>simulation.open(),toolbar,'compact-icon');
  const partsToggle = button('Objects', () => togglePanel(tree, partsToggle), status, 'panel-toggle objects-toggle');
  partsToggle.title = t('Show objects');
  const propertiesToggle = button('Properties', () => togglePanel(inspector, propertiesToggle), status, 'panel-toggle properties-toggle');
  const modelLibraryPanel=mountModelLibraryPanel(shell,session,doc=>client.evaluate(doc),options.modelLibrary,async()=>{await whenIdle();viewport.frame();},options.onExport);
  const parametersPanel=mountParametersPanel(shell,session);
  const sketchPanel=mountSketchPanel(shell,session,doc=>client.evaluate(doc),async()=>{await whenIdle();viewport.frame();},()=>grid);
  button('Sketch',()=>sketchPanel.open(),toolbar,'compact-icon').title=t('Create a dimensioned sketch and extrusion');
  button('Revolve',()=>sketchPanel.openRevolution(),toolbar,'compact-icon').title=t('Revolve a sketch around an axis');
  const drawingPanel=mountDrawingPanel(shell,session,options.onExport);
  const modelSourcePanel=mountModelSourcePanel(shell,status,session,doc=>client.evaluate(doc),(recipe,name)=>createPresetDocument(recipe.preset,name,{recipe}));
  const codePanel=mountCodePanel(shell,session,doc=>client.evaluate(doc),async()=>{await whenIdle();viewport.frame();},options.onExport,()=>run(()=>modelSourcePanel.open()));
  button('Code',()=>codePanel.open(session.state.selection.length===1&&session.state.document.nodes[session.state.selection[0]]?.kind==='code'?session.state.selection[0]:undefined),toolbar,'compact-icon').title=t('Code an object');
  const parametersButton=button('Parameters',()=>parametersPanel.open(),toolbar,'compact-icon');parametersButton.title=t('Model parameters and formulas');
  if(options.headerContent){options.headerContent.classList.add('host-actions');designBar.append(options.headerContent);}
  toolGroup('Shapes', 'shapes-tools');
  const shapesButton = button('Shapes', () => picker.toggle(), toolParent, 'shape-library-toggle');
  const previewCache = new Map<string, Promise<string>>(),presetBuilds=new Map<string,Promise<{document:CadDocument;geometry:GeometryResult}>>();
  function buildPreset(preset:ShapePreset,text:string,svg?:string,font?:import('@brickwright/cad-core').GeneratorRecipe['font']){const lettering=['text','name-tag','icon-tag','qr'].includes(preset.id),key=JSON.stringify([preset.id,lettering?text:'',lettering?svg:'',lettering?font:'']);let pending=presetBuilds.get(key);if(!pending){const doc=createPresetDocument(preset.id,text,{svg,font});pending=client.evaluate(doc).then(geometry=>({document:doc,geometry}));presetBuilds.set(key,pending);if(presetBuilds.size>80)presetBuilds.delete(presetBuilds.keys().next().value!);void pending.catch(()=>{if(presetBuilds.get(key)===pending)presetBuilds.delete(key);});}return pending;}
  let placing:{name:string;projectId:string;revision:number;selection:string[];ready:Promise<{document:CadDocument;geometry:GeometryResult}>;point?:PlacementPointer;dropping:boolean;role:'solid'|'hole'}|undefined;
  function cancelShapePlacement(){const prior=placing;if(!prior)return;placing=undefined;viewport.cancelPlacement();if(session.state.document.id===prior.projectId&&session.state.revision===prior.revision&&!session.state.selection.length)session.select(prior.selection);}
  function beginShapePlacement(preset:ShapePreset,text:string,svg:string|undefined,font:import('@brickwright/cad-core').GeneratorRecipe['font'],point?:PlacementPointer){cancelShapePlacement();try{const pending=buildPreset(preset,text,svg,font),active={name:t(preset.name),projectId:session.state.document.id,revision:session.state.revision,selection:[...session.state.selection],ready:Promise.all([pending,whenIdle()]).then(([built])=>built),point,dropping:false,role:'solid' as const};placing=active;viewport.beginPlacement();session.select([]);if(point)viewport.movePlacement(point);void active.ready.then(({geometry})=>{if(placing!==active||disposed)return;viewport.setPlacementGeometry(geometry);if(active.point)viewport.movePlacement(active.point);}).catch(error=>{if(placing===active){cancelShapePlacement();report(error);}});}catch(error){report(error);}}
  function moveShapePlacement(point:PlacementPointer){if(!placing)return;placing.point=point;viewport.movePlacement(point);}
  async function dropShapePlacement(point:PlacementPointer):Promise<boolean>{const active=placing;if(!active||active.dropping)return false;active.dropping=true;active.point=point;try{const built=await active.ready;if(disposed||placing!==active)return false;if(session.state.document.id!==active.projectId||session.state.revision!==active.revision){cancelShapePlacement();return false;}const pose=viewport.movePlacement(point);if(!pose){cancelShapePlacement();return false;}const fragment=placeFragment(built.document,pose);if(active.role==='hole'){fragment.version=7;for(const id of fragment.roots)fragment.nodes[id].role='hole';}await client.evaluate(fragment);if(disposed||placing!==active)return false;if(session.state.document.id!==active.projectId||session.state.revision!==active.revision){cancelShapePlacement();return false;}placing=undefined;viewport.cancelPlacement();session.insert(fragment,[0,0,0],{mergeParameters:true,label:'Place shape'});await whenIdle();picker.placed(active.name);viewport.canvas.focus({preventScroll:true});return true;}catch(error){if(placing===active)cancelShapePlacement();throw error;}}
  viewport.setPlacementHandlers(point=>{void dropShapePlacement(point).catch(report);},cancelShapePlacement);
  const picker = mountShapePicker(main, shapesButton, async (preset, text, svg,font) => {
    if(options.presetProjects?.ids.includes(preset.id)){await options.presetProjects.open(preset.id);return;}
    const projectId=session.state.document.id,wasEmpty=!session.state.document.roots.length;const {document:doc,geometry:result}=await buildPreset(preset,text,svg,font);
    if(disposed)return;if(session.state.document.id!==projectId)throw new Error(t('Shape insertion was canceled because a different model was opened'));
    const minZ=Math.min(...result.bodies.map(body=>body.bounds.min[2]));session.insert(doc,[session.state.document.roots.length*12,0,-minZ],{mergeParameters:true});await whenIdle();if(wasEmpty)viewport.frame();
  },report,preset=>{let preview=previewCache.get(preset.id);if(!preview){preview=buildPreset(preset,'ABC').then(built=>evaluatedPreview(built.geometry.bodies));previewCache.set(preset.id,preview);}return preview;},{projectPresetIds:options.presetProjects?.ids,layout:options.shapeBrowserLayout,onLayoutChange:options.onShapeBrowserLayoutChange,placement:{begin:beginShapePlacement,move:moveShapePlacement,drop:dropShapePlacement,cancel:cancelShapePlacement}});

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
  const surfaceSnapButton=button('Snap to surfaces',()=>setSurfaceSnap(!viewport.surfaceSnap),toolbar,'compact-icon');surfaceSnapButton.title=t('Snap to surfaces (C) · Alt-drag temporarily bypasses');surfaceSnapButton.setAttribute('aria-pressed',String(viewport.surfaceSnap));surfaceSnapButton.classList.toggle('active',viewport.surfaceSnap);
  function setSurfaceSnap(value:boolean){viewport.setSurfaceSnap(value);surfaceSnapButton.setAttribute('aria-pressed',String(value));surfaceSnapButton.classList.toggle('active',value);options.onSurfaceSnapChange?.(value);}
  const readout=mountTransformReadout(viewHost,session,report,visible=>{numbersToggle.checked=visible;viewport.setReadoutVisible(visible);options.onTransformReadoutChange?.(visible);});
  const numbersLabel=el('label','numbers-toggle','XYZ');numbersLabel.title=t('Show axis values in Move/Rotate and while dragging');const numbersToggle=el('input');numbersToggle.type='checkbox';numbersToggle.setAttribute('aria-label',t('Show on-canvas parameters'));numbersToggle.onchange=()=>readout.setVisible(numbersToggle.checked);numbersLabel.prepend(numbersToggle);
  readout.setVisible(options.showTransformReadout??false);
  viewport.setTransformPreviewListener(preview=>{readout.update(preview);if(preview.bounds)for(const [i,axis] of ['X','Y','Z'].entries()){const input=inspector.querySelector<HTMLInputElement>(`[data-size-axis=${axis}]`);if(input)input.value=String(Number((preview.bounds.max[i]-preview.bounds.min[i]).toFixed(3)));}const pose=preview.poses[0]?.transform;if(!pose)return;for(const [key,name] of [['position','Position'],['rotation','Rotation'],['scale','Scale']] as const)for(const [i,axis] of ['X','Y','Z'].entries()){const input=Array.from(inspector.querySelectorAll('input')).find(el=>el.getAttribute('aria-label')===`${t(name)} ${axis}`);if(input){input.readOnly=preview.dragging;if(shadow.activeElement!==input||preview.dragging)input.value=String(Number(pose[key][i].toFixed(5)));}}});
  const planeBar = el('div', 'plane-bar'); planeBar.append(el('span', 'plate-size', t('400 × 400 mm workplane')));
  const gridLabel = el('label','grid-control');gridLabel.title=t('Snap Grid'); const gridSelect = el('select'); gridSelect.setAttribute('aria-label',t('Grid spacing'));gridSelect.title=t('Snap Grid');
  for (const n of [0, 0.1, 1, 5, 10]) { const o = el('option', '', n === 0 ? t('Off') : `${n} mm`); o.value = String(n); gridSelect.append(o); } gridSelect.value = '1';
  gridSelect.addEventListener('change', () => { grid = Number(gridSelect.value); viewport.setGrid(grid); }); gridLabel.append(gridSelect); const fineLabel=el('label','numbers-toggle',t('Fine')),fineToggle=el('input');fineToggle.type='checkbox';fineToggle.setAttribute('aria-label',t('Fine adjustments'));fineLabel.title=t('Fine adjustments: Shift for move/rotate; Ctrl/⌘ for resize. Shift resizes proportionally; Alt resizes about the center.');fineToggle.onchange=()=>viewport.setFine(fineToggle.checked);fineLabel.prepend(fineToggle);planeBar.append(numbersLabel,fineLabel,gridLabel); viewHost.append(planeBar);
  const undoButton = button('Undo', () => session.undo(),toolbar,'compact-icon'); const redoButton = button('Redo', () => session.redo(),toolbar,'compact-icon');
  toolGroup('Edit');
  const cutButton=button('Cut',()=>copySelection(true));const copyButton=button('Copy',()=>copySelection());const pasteButton=button('Paste',()=>pasteSelection());
  const duplicateButton = button('Duplicate', () => executeCommand('duplicate')); const deleteButton = button('Delete', () => executeCommand('delete'));
  const contextActions=el('div','context-actions');contextActions.setAttribute('role','group');contextActions.setAttribute('aria-label',t('Selection actions'));toolbar.append(contextActions);for(const [label,command] of [['Copy','copy'],['Duplicate','duplicate'],['Delete','delete']] as const)button(label,()=>executeCommand(command),contextActions,'compact-icon');
  const fitSelectionActions=()=>{const other=[...toolbar.children].filter(child=>child!==contextActions).reduce((sum,child)=>sum+(child as HTMLElement).getBoundingClientRect().width,0);const gap=parseFloat(getComputedStyle(toolbar).gap)||0;contextActions.dataset.room=String(toolbar.clientWidth>=other+112+gap*toolbar.children.length);};
  const toolbarResize=new ResizeObserver(fitSelectionActions);toolbarResize.observe(toolbar);
  toolGroup('File', 'file-tools');
  button('Model library',()=>modelLibraryPanel.open());
  if(options.embedded)button('Model library',()=>modelLibraryPanel.open(),toolbar,'compact-icon').style.order='-1';
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
  projectActions.hidden=options.embedded===true;
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
      const icon=toolIcon(n.kind==='code'?'Code':n.kind==='extrusion'?'Sketch':n.kind==='revolution'?'Revolve':n.kind==='boolean'?'Union':n.kind==='cylinder'?'Cylinder':n.kind==='sphere'?'Sphere':'Box');if(icon&&!select.querySelector('svg'))select.prepend(icon); select.classList.toggle('selected', selected.includes(id)); select.setAttribute('aria-pressed',String(selected.includes(id)));row.classList.toggle('selected',selected.includes(id));select.title = `${displayName} · ${n.role==='hole'?t('Hole'):t(n.kind)}`;if(n.role==='hole'){const tag=el('small','hole-tag',t('Hole'));row.append(tag);} select.dataset.testid = child?'construction-name':'object-name'; item.append(row);
      parent.append(item);
      // A generated preset is one editable part. Its implementation operands are
      // deliberately hidden; user-authored booleans retain browsable inputs.
      if(n.kind==='boolean'&&!n.generator&&!n.physics?.sourcePreset){
        const inputs=section(`inputs:${id}`,'Inputs',item);const children=el('div','children');inputs.append(children);n.inputs.forEach(input=>append(input,children,true));
      }else if(n.kind==='code'){
        const definition=section(`code:${id}`,'Code & parameters',item);button('Edit code definition',()=>codePanel.open(id),definition);
        const compiled=compileCode(n.program);for(const [name,value] of Object.entries(compiled.values)){const entry=el('div','browser-value');entry.append(el('span','',name),el('span','',`${Number(value.value.toFixed(4))} ${compiled.parameters[name].unit==='scalar'?'':compiled.parameters[name].unit}`));definition.append(entry);}
      }else if(n.kind==='extrusion'||n.kind==='revolution'){
        const definition=section(`${n.kind}:${id}`,n.kind==='extrusion'?'Sketch & extrusion':'Sketch & revolution',item);const sketch=doc.sketches?.[n.sketchId];if(sketch)button(t`Edit sketch: ${sketch.name}`,()=>sketchPanel.open(id),definition);
      }
    };
    doc.roots.forEach(id => append(id, bodies));
    const sketches=Object.values(doc.sketches??{});if(sketches.length){const group=section('sketches',t`Sketches · ${sketches.length}`,content);for(const sketch of sketches){const feature=Object.values(doc.nodes).find(n=>(n.kind==='extrusion'||n.kind==='revolution')&&n.sketchId===sketch.id);if(feature)button(t`Sketch: ${sketch.name}`,()=>sketchPanel.open(feature.id),group);else button(t`Revolve sketch: ${sketch.name}`,()=>sketchPanel.openRevolution(sketch.id),group);}}
    if(doc.drawings?.length){
      const group=section('drawings',t`Drawings · ${doc.drawings.length}`,content,true);
      if(options.onExport&&doc.drawings.length>1){
        button('Export drawing set (PDF)',()=>options.onExport!(exportDrawingSetPdf(session.state.document)),group);
      }
      for(const sheet of doc.drawings)button(t`Drawing: ${sheet.title}`,()=>drawingPanel.open({sheetId:sheet.id}),group);
    }
    const parameters=Object.entries(doc.parametric?.parameters??{});if(parameters.length){const group=section('parameters',t`Parameters · ${parameters.length}`,content);button('Edit model parameters',()=>parametersPanel.open(),group);for(const [name,p] of parameters){const entry=el('div','browser-value');entry.append(el('span','',name),el('span','',p.expression));group.append(entry);}}

    if (!doc.roots.length) content.append(el('p', 'hint', t('No objects yet. Start with a box.')));
  }
  function field(parent: HTMLElement, label: string, value: string | number, change: (value: string) => void, type = 'number', step = '1') {
    const wrap = el('label', 'field');wrap.append(el('span','field-name',t(label))); const input = el('input'); input.type = type; input.value = String(value); input.setAttribute('aria-label', t(label)); input.step = step;
    input.addEventListener('change', () => run(() => change(input.value)));input.addEventListener('keydown',event=>{if(fineNumberKeys(input,event))return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();const apply=input.closest('.shape-parameters')?.querySelector<HTMLButtonElement>(`[aria-label="${t('Apply shape parameters')}"]`);input.blur();apply?.click();viewport.canvas.focus({preventScroll:true});}}); wrap.append(input); parent.append(wrap); return input;
  }
  function buildInspector() {
    inspector.replaceChildren(); const header = el('div', 'panel-header'); header.append(el('h2', '', t('Properties'))); button('Close properties', () => { inspector.classList.remove('open'); inspector.classList.add('closed'); propertiesToggle.setAttribute('aria-pressed', 'false'); }, header); inspector.append(header);
    if(canAddRobotElectronics(session.state.document)){
      const complete=button('Add controller and power',()=>{
        if(simulation.state.state!=='idle')throw new Error(t('Stop simulation before adding electronics.'));
        session.editAssembly(t('Add controller and power'),addRobotElectronics,{expectedRevision:session.state.revision});
      },inspector);
      complete.dataset.testid='add-robot-electronics';
    }
    const selection = session.state.selection;const styleRow=el('div','object-style');inspector.append(styleRow);
    if(selection.some(id=>session.state.document.roots.includes(id))){const dimensions=el('div','property-matrix actual-size');dimensions.setAttribute('role','group');dimensions.setAttribute('aria-label',t('Dimensions after transform (mm)'));const marker=el('div','property-kind');marker.title=t('Dimensions after transform (mm)');marker.append(toolIcon('Dimensions')!,el('small','','mm'));dimensions.append(marker);inspector.append(dimensions);for(const axis of ['X','Y','Z']){const bodies=built?.bodies.filter(body=>selection.includes(body.id))??[];const i=['X','Y','Z'].indexOf(axis),size=bodies.length?Math.max(...bodies.map(body=>body.bounds.max[i]))-Math.min(...bodies.map(body=>body.bounds.min[i])):'';const input=field(dimensions,t`Size ${axis} (mm)`,typeof size==='number'?Number(size.toFixed(3)):'',()=>{},'number','.1');input.readOnly=true;input.dataset.sizeAxis=axis;input.title=t`Size ${axis} (mm)`;input.parentElement!.querySelector('.field-name')!.textContent=axis;}}
    if(selection.length&&selection.every(id=>session.state.document.roots.includes(id)&&!session.state.document.nodes[id].reference)){const roles=el('div','shape-role');roles.setAttribute('role','group');roles.setAttribute('aria-label',t('Solid or hole'));for(const role of ['solid','hole'] as const){const label=role==='solid'?'Solid':'Hole',b=button(label,()=>session.setRole(role),roles,'role-icon');b.setAttribute('aria-pressed',String(selection.every(id=>(session.state.document.nodes[id].role??'solid')===role)));b.dataset.testid=`role-${role}`;b.style.setProperty('--part-colour',session.state.document.nodes[selection[0]].color);b.title=role==='hole'?t('Union subtracts hole shapes from solid shapes'):t('Printable solid');}styleRow.append(roles);}
    const activeKey=mode==='rotate'?'rotation':mode==='scale'?'scale':'position';
    function transformFields(ids:readonly string[],key:'position'|'rotation'|'scale'){
      const title=key==='rotation'?'Rotation':key==='scale'?'Scale':'Position',units=key==='rotation'?'°':key==='scale'?'×':'mm',group=el('div','property-matrix');group.setAttribute('role','group');group.setAttribute('aria-label',`${t(title)} (${units})`);const marker=el('div','property-kind');marker.title=`${t(title)} (${units})`;marker.append(toolIcon(key==='rotation'?'Rotate':key==='scale'?'Scale':'Move')!,el('small','',units));group.append(marker);inspector.append(group);
      ['X','Y','Z'].forEach((axis,i)=>{const input=field(group,`${t(title)} ${axis}`,session.state.document.nodes[ids[0]].transform[key][i],value=>{session.transform(ids.map(id=>{const transform=structuredClone(session.state.document.nodes[id].transform);transform[key][i]=Number(value);return {id,transform};}));},'number',key==='rotation'?'1':'0.1');input.title=`${t(title)} ${axis} (${units})`;input.parentElement!.querySelector('.field-name')!.textContent=axis;});
    }
    if (selection.length !== 1) { inspector.append(el('p', 'selection-count', selection.length ? t`${selection.length} selected · per-object values` : t('Nothing selected')));if(selection.length)transformFields(selection,activeKey);return; }
    const id = selection[0], n = session.state.document.nodes[id];
    if(!session.state.document.roots.includes(id)){const parent=Object.values(session.state.document.nodes).find(node=>node.kind==='boolean'&&node.inputs.includes(id));if(parent)button(t`Back to ${parent.name}`,()=>{session.select([parent.id]);viewport.canvas.focus({preventScroll:true});},inspector);}
    const nameInput=field(styleRow, 'Object name', n.name, value => session.update(id, { name: value }), 'text');nameInput.parentElement!.classList.add('object-name');nameInput.title=t('Object name');styleRow.prepend(nameInput.parentElement!);const colour=field(styleRow,'Color',n.color,value=>session.update(id,{color:value}),'color');colour.parentElement!.classList.add('color-swatch');colour.title=t('Color');
    transformFields([id],activeKey);for(const key of ['position','rotation','scale'] as const)if(key!==activeKey)transformFields([id],key);
    const recipe=n.generator??(n.reference?defaultGenerator('ruler'):session.state.document.roots.includes(id)?defaultGenerator(n.physics?.sourcePreset??''):undefined);
    if(n.generator?.preset==='screw')mountScrewRedesign(inspector,n.generator,n.transform.scale,async request=>{const expected=session.state.revision,redesigned=redesignScrew(n.generator!,n.transform.scale,request),fragment=createPresetDocument('screw','BRICKWRIGHT',{recipe:redesigned}),trial=createCadSession(session.state.document);try{trial.replaceGenerated(id,fragment,{resetScale:true,label:'Redesign thread'});await client.evaluate(trial.state.document);if(disposed)return;if(session.state.revision!==expected)throw new Error(t('The model changed while generating this shape. Apply again.'));session.replaceGenerated(id,fragment,{resetScale:true,label:'Redesign thread'});await whenIdle();}finally{trial.dispose();}},report);
    if(recipe&&!isCube(n)){
      const draft=structuredClone(recipe);const legacyLettering=!n.generator&&['text','name-tag'].includes(recipe.preset);if(legacyLettering)draft.text='';const form=el('div','shape-parameters');form.append(el('div','inspect-title',t`${t(shapeCatalog.find(p=>p.id===recipe.preset)?.name??recipe.preset)} parameters`));
      let refreshScrewFields=()=>{};const screwExtraFields=new Map<string,HTMLInputElement>();
      if(legacyLettering)form.append(el('p','hint',t('This older object did not retain its text. Enter the lettering to make it editable; the existing solid stays unchanged until Apply.')));
      if(draft.preset==='ruler'){const wrap=el('label','field',t('Ruler units')),unit=el('select');unit.setAttribute('aria-label',t('Ruler units'));for(const [value,label]of [['mm','mm'],['in','in']]){const o=el('option','',label);o.value=value;unit.append(o);}unit.value=draft.rulerUnit??'mm';unit.onchange=()=>draft.rulerUnit=unit.value as 'mm'|'in';wrap.append(unit);form.append(wrap);const numbers=el('label','field',t('Ruler numbers')),toggle=el('input');toggle.type='checkbox';toggle.checked=draft.rulerNumbers!==false;toggle.setAttribute('aria-label',t('Ruler numbers'));toggle.onchange=()=>draft.rulerNumbers=toggle.checked;numbers.append(toggle);form.append(numbers);}
      if(draft.preset==='text'||draft.preset==='name-tag'){
        field(form,'Text',draft.text??'',value=>draft.text=value,'text');const label=el('label','field',t('Font')),select=el('select');select.setAttribute('aria-label',t('Font'));
        for(const [value,name] of [['sans','Droid Sans'],['serif','Droid Serif'],['mono','Droid Sans Mono'],['block',t('Original block letters')]]){const option=el('option','',name);option.value=value;select.append(option);}select.value=draft.font??'sans';select.onchange=()=>draft.font=select.value as typeof draft.font;label.append(select);form.append(label);
      }
      if(draft.preset==='screw'){
       for(const [key,label,choices]of [['headStyle','Head type',[['cylindrical','Cylindrical head'],['hex','External hex head'],['countersunk','Countersunk head'],['pan','Pan head'],['headless','Headless']]],['driveStyle','Drive type',[['slot','Slotted'],['cross','Cross recess'],['hex','Hex socket'],['none','No recess']]]] as const){const wrap=el('label','field',t(label)),select=el('select');select.setAttribute('aria-label',t(label));for(const [value,name]of choices){const option=el('option','',t(name));option.value=value;select.append(option);}select.value=String(draft[key]??(key==='headStyle'?'cylindrical':'slot'));select.onchange=()=>{if(draft.version===1)draft.orientation='legacy';draft.version=2;draft.headStyle??='cylindrical';draft.driveStyle??='slot';draft.driveDepth??=draft.values.headHeight*.3;draft.headAngle??=90;draft.threadAngle??=60;(draft as any)[key]=select.value;refreshScrewFields();};wrap.append(select);form.append(wrap);}
       const tipLabel=el('label','field',t('Point type')),tipSelect=el('select');tipSelect.setAttribute('aria-label',t('Point type'));for(const [value,label] of screwTipStyles){const option=el('option','',t(label));option.value=value;tipSelect.append(option);}tipSelect.value=draft.tipStyle??'flat';tipLabel.append(tipSelect);form.append(tipLabel);
       const tip=screwTipParameters(draft),tipLength=field(form,'Point length (mm)',tip.length,value=>draft.tipLength=Number(value),'number','.1'),tipDiameter=field(form,'End / cup diameter (mm)',tip.diameter,value=>draft.tipDiameter=Number(value),'number','.1'),cupDepth=field(form,'Cup depth (mm)',tip.depth,value=>{draft.cupDepth=Number(value);draft.tipLength=Math.max(screwTipParameters(draft).length,draft.cupDepth/.8);},'number','.1');
       const showTip=()=>{tipLength.parentElement!.hidden=['flat','cup'].includes(tipSelect.value);tipDiameter.parentElement!.hidden=!['chamfer','dog','cup'].includes(tipSelect.value);cupDepth.parentElement!.hidden=tipSelect.value!=='cup';};tipSelect.onchange=()=>{if(draft.version===1)draft.orientation='legacy';draft.version=2;draft.headStyle??='cylindrical';draft.driveStyle??='slot';draft.driveDepth??=draft.values.headHeight*.3;draft.headAngle??=90;draft.threadAngle??=60;draft.tipStyle=tipSelect.value as NonNullable<GeneratorRecipe['tipStyle']>;showTip();refreshScrewFields();};showTip();
       screwExtraFields.set('driveDepth',field(form,'Drive recess depth (mm)',draft.driveDepth??draft.values.headHeight*.3,value=>draft.driveDepth=Number(value),'number','.1'));screwExtraFields.set('threadAngle',field(form,'Thread angle (°)',draft.threadAngle??60,value=>draft.threadAngle=Number(value),'number','1'));screwExtraFields.set('headAngle',field(form,'Countersink angle (°)',draft.headAngle??90,value=>draft.headAngle=Number(value),'number','1'));
      }
      if(!n.generator&&!legacyLettering&&recipe.preset!=='ruler')form.append(el('p','hint',t('These dimensions were not retained. Apply regenerates this older shape.')));
      const parameterInputs=new Map<string,HTMLInputElement>(),surfaceDetail=el('details','surface-detail');surfaceDetail.append(el('summary','',t('Surface detail')));
      for(const parameter of generatorFields(recipe.preset)){
        if(draft.version===2&&draft.preset==='screw'&&parameter.key==='diameter'){field(form,'Thread diameter (mm)',draft.values.diameter+2*draft.values.threadDepth,value=>draft.values.diameter=Number(value)-2*draft.values.threadDepth,'number','.1');continue;}
        if(draft.version===2&&draft.preset==='screw'&&parameter.key==='threadDepth'){field(form,parameter.label,draft.values.threadDepth,value=>{const diameter=draft.values.diameter+2*draft.values.threadDepth;draft.values.threadDepth=Number(value);draft.values.diameter=diameter-2*draft.values.threadDepth;},'number',String(parameter.step));continue;}
        if(parameter.key==='hand'){const label=el('label','field',t('Thread handedness'));const select=el('select');select.setAttribute('aria-label',t('Thread handedness'));for(const [value,name] of [[1,'Right hand'],[-1,'Left hand']] as const){const option=el('option','',t(name));option.value=String(value);select.append(option);}select.value=String(draft.values.hand);select.onchange=()=>draft.values.hand=Number(select.value);label.append(select);form.append(label);}
        else{const input=field(['segments','tubeSegments','detail','profileSegments','arcSegments'].includes(parameter.key)?surfaceDetail:form,draft.preset==='screw'&&parameter.key==='slotWidth'&&draft.driveStyle==='hex'?'Socket width across flats (mm)':draft.preset==='screw'&&parameter.key==='slotWidth'&&draft.driveStyle==='cross'?'Drive width (mm)':draft.preset==='screw'&&parameter.key==='headDiameter'&&draft.headStyle==='hex'?'Head width across flats (mm)':parameter.label,draft.values[parameter.key],value=>draft.values[parameter.key]=Number(value),'number',String(parameter.step));input.min=String(parameter.min);input.max=String(parameter.max);parameterInputs.set(parameter.key,input);if(draft.preset==='loft'&&parameter.key==='wallThickness')input.title=t('0 makes a solid transition');if(draft.preset==='dovetail'&&parameter.key==='clearance')input.title=t('Clearance offsets profile faces; slide length stays unchanged');}
      }
      if(draft.preset==='screw'){
       refreshScrewFields=()=>{
        const hide=(key:string,hidden:boolean)=>{const input=parameterInputs.get(key)??screwExtraFields.get(key);if(input)input.parentElement!.hidden=hidden;};
        const rename=(key:string,label:string)=>{const input=parameterInputs.get(key);if(input){input.setAttribute('aria-label',t(label));input.parentElement!.querySelector('.field-name')!.textContent=t(label);}};
        hide('headHeight',['countersunk','headless'].includes(draft.headStyle??''));hide('headDiameter',draft.headStyle==='headless');hide('slotWidth',draft.driveStyle==='none');
        hide('driveDepth',draft.version!==2||draft.driveStyle==='none');hide('threadAngle',draft.version!==2);hide('headAngle',draft.version!==2||draft.headStyle!=='countersunk');
        rename('headDiameter',draft.headStyle==='hex'?'Head width across flats (mm)':'Head diameter (mm)');rename('slotWidth',draft.driveStyle==='hex'?'Socket width across flats (mm)':draft.driveStyle==='cross'?'Drive width (mm)':'Drive slot width (mm)');
       };refreshScrewFields();
      }
      if(draft.preset==='tube'||draft.preset==='washer'||draft.preset==='bent-tube'){
       const bore=field(form,'Bore diameter (mm)',draft.values.outerDiameter-2*draft.values.wallThickness,value=>{draft.values.wallThickness=(draft.values.outerDiameter-Number(value))/2;parameterInputs.get('wallThickness')!.value=String(draft.values.wallThickness);},'number','.1');bore.min='.01';
       for(const key of ['outerDiameter','wallThickness'])parameterInputs.get(key)!.addEventListener('change',()=>{bore.value=String(Number((draft.values.outerDiameter-2*draft.values.wallThickness).toFixed(6)));});
      }
      if(draft.preset==='countersink'||draft.preset==='finishing-washer'){
       const diameterKey=draft.preset==='countersink'?'recessDiameter':'seatDiameter';
       const seatDepth=()=>Number(((draft.values[diameterKey]-draft.values.boreDiameter)/2/Math.tan(draft.values.seatAngle*Math.PI/360)).toFixed(4));
       const derived=field(form,'Seat depth (mm)',seatDepth(),()=>{},'number','.1');derived.readOnly=true;derived.title=t('Calculated from diameters and seat angle');
       for(const key of ['boreDiameter',diameterKey,'seatAngle'])parameterInputs.get(key)!.addEventListener('input',()=>{const v=Object.fromEntries([...parameterInputs].map(([key,input])=>[key,Number(input.value)]));const value=(v[diameterKey]-v.boreDiameter)/2/Math.tan(v.seatAngle*Math.PI/360);derived.value=Number.isFinite(value)&&value>0?String(Number(value.toFixed(4))):'';});
      }
      if(surfaceDetail.children.length>1)form.append(surfaceDetail);
      const apply=button('Apply shape parameters',async()=>{const expected=session.state.revision;apply.disabled=true;try{const fragment=createPresetDocument(draft.preset,'BRICKWRIGHT',{recipe:draft});await client.evaluate(fragment);if(disposed)return;if(session.state.revision!==expected)throw new Error(t('The model changed while generating this shape. Apply again.'));session.replaceGenerated(id,fragment);await whenIdle();}finally{apply.disabled=false;}},form,'primary');if(n.generator){const advanced=el('details');advanced.append(el('summary','',t('Advanced')));button('Detach generator',()=>session.detachGenerator(id),advanced);form.append(advanced);}inspector.append(form);
    }
    if(n.kind==='code')button('Edit code',()=>codePanel.open(id),inspector);
    if(n.kind==='extrusion'||n.kind==='revolution'){
      const sketch=session.state.document.sketches![n.sketchId];inspector.append(el('p','hint',t`${sketch.name} · ${t(sketch.profile.kind)} · ${sketch.plane} plane`));
      button(n.kind==='extrusion'?'Edit sketch & extrusion':'Edit sketch & revolution',()=>sketchPanel.open(id),inspector);
    }
    if(n.kind==='extrusion'){
      button('Revolve this sketch',()=>sketchPanel.openRevolution(n.sketchId),inspector);
      button('Create drawing sheet',()=>drawingPanel.open({featureId:id}),inspector);
      if(options.onExport&&!n.provenance?.length){
        const exportProfile=button('Export sketch as DXF',()=>options.onExport!(exportSketchDxf(session.state.document,id)),inspector);
        exportProfile.title=t('Export the 2D profile at sketch dimensions in millimetres.');
        const exportTemplate=button('Export drilling template (PDF)',()=>options.onExport!(exportSketchPdf(session.state.document,id)),inspector);
        exportTemplate.title=t('Download an A4 sketch-plane template with hole centers at 1:1 scale.');
      }
    }
    const graph=designGraph(session.state.document),entries=new Map(graph.map(e=>[e.key,e])),upstream=new Set<string>();
    const visitInput=(key:string)=>{if(upstream.has(key))return;upstream.add(key);entries.get(key)?.dependencies.forEach(visitInput);};visitInput(`feature:${id}`);
    const dimensions=graph.filter(e=>e.kind==='parameter'&&upstream.has(e.key));
    if(dimensions.length&&session.state.document.parametric){
      const design=el('details','design-inputs');design.open=true;design.append(el('summary','',t('Design inputs')));const values=evaluateParameters(session.state.document.parametric);
      for(const parameter of dimensions){const p=session.state.document.parametric.parameters[parameter.id];const input=field(design,t`Parameter ${parameter.label} (${p.unit})`,p.expression,expression=>{const next=structuredClone(session.state.document.parametric!);next.parameters[parameter.id].expression=expression;session.setParametric(next);},'text');input.parentElement?.append(el('small','',`${Number(values[parameter.id].value.toFixed(5))} ${p.unit==='scalar'?'':p.unit}`));}inspector.append(design);
    }
    const primitiveFields=el('div','primitive-parameters');inspector.append(primitiveFields);
    if(isCube(n)&&n.kind==='box'){field(primitiveFields,'Edge length (mm)',n.size[0]*n.transform.scale[0],value=>{const edge=Number(value)/n.transform.scale[0];session.update(id,{size:[edge,edge,edge]});},'number','0.1');}
    else if (n.kind === 'box') {
      (['Width', 'Depth', 'Height'] as const).forEach((label, i) => field(primitiveFields, `${label} (mm)`, n.size[i], value => { const size = [...n.size] as Vec3; size[i] = Number(value); session.update(id, { size }); }, 'number', '0.1'));
    } else if (n.kind === 'cylinder' || n.kind === 'sphere') {
      field(primitiveFields, 'Radius (mm)', n.radius, value => session.update(id, { radius: Number(value) }), 'number', '0.1');
      if (n.kind === 'cylinder') field(primitiveFields, 'Height (mm)', n.height, value => session.update(id, { height: Number(value) }), 'number', '0.1');
      field(primitiveFields, 'Segments', n.segments, value => session.update(id, { segments: Number(value) }), 'number', '4');
    } else if (n.kind === 'boolean'&&!recipe&&!n.physics?.sourcePreset&&!n.reference) {
      const sources=el('details','construction-sources');sources.append(el('summary','',t('Edit source shapes')));for(const sourceId of n.inputs){const source=session.state.document.nodes[sourceId];button(t`Edit ${source.name}`,()=>{session.select([sourceId]);viewport.canvas.focus({preventScroll:true});},sources);}inspector.append(sources);
      button('Separate operands', () => session.separate(id), inspector);
    }
    button('Reset transform', () => session.update(id, { transform: identityTransform() }), inspector);
    if(!n.reference&&n.role!=='hole' && session.state.document.roots.includes(id)) {
      const physics=el('details','physics-settings');physics.append(el('summary','',t('Physics material')));inspector.append(physics);
      const p=n.physics??defaultPartPhysics();
      const materialLabel=el('label','field',t('Material preset')),material=el('select');material.setAttribute('aria-label',t('Material preset'));for(const preset of [{id:'custom',name:'Custom'},...physicsMaterials]){const option=el('option','',t(preset.name));option.value=preset.id;material.append(option);}material.value=p.material??'custom';material.onchange=()=>{if(material.value!=='custom')run(()=>session.applyPhysicsMaterial(material.value,[id]));};materialLabel.append(material);physics.append(materialLabel,el('small','hint',t('Illustrative material presets; edit properties for your parts.')));
      for(const [key,label,step] of [['densityKgM3','Density (kg/m³)','10'],['friction','Friction','0.05'],['restitution','Restitution','0.05']] as const)field(physics,label,p[key],value=>session.update(id,{physics:{...p,material:'custom',[key]:Number(value)}}),'number',step);
      const label=el('label','field',t('Body motion'));const select=el('select');select.setAttribute('aria-label',t('Body motion'));for(const motion of ['dynamic','static'] as const){const option=el('option','',t(motion==='dynamic'?'Dynamic':'Fixed in world'));option.value=motion;select.append(option);}select.value=p.motion;select.addEventListener('change',()=>run(()=>session.update(id,{physics:{...p,motion:select.value as 'dynamic'|'static'}})));label.append(select);physics.append(label);
      if(p.intent!=='rigid')physics.append(el('p','hint',t`Mechanical role: ${t(p.intent)}. Rigid collision preview does not qualify elastic behavior, mating fit or a complete mechanism.`));
      if(session.state.document.joints?.some(j=>j.bodyA===id||j.bodyB===id))button('Detach joints',()=>session.detachJoints([id]),inspector);
    }
    const bindings=session.state.document.parametric?.bindings.filter(binding=>binding.nodeId===id)??[];
    for(const binding of bindings){const label=isCube(n)&&binding.property==='width'?'Edge length (mm)':propertyLabels[binding.property];const input=Array.from(inspector.querySelectorAll('input')).find(input=>input.getAttribute('aria-label')===t(label));if(input){input.disabled=true;input.title=t`Driven by ${binding.expression}`;input.parentElement?.append(el('small','driven-expression',`= ${binding.expression}`));}}
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
  const unsubscribe = session.subscribe(state => {if(placing&&(state.document.id!==placing.projectId||state.revision!==placing.revision))cancelShapePlacement();
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
    if(placing&&!command&&['h','s'].includes(key)){placing.role=key==='h'?'hole':'solid';viewport.setPlacementRole(placing.role);event.preventDefault();event.stopPropagation();return;}
    if(placing&&(key==='delete'||key==='backspace')){cancelShapePlacement();event.preventDefault();event.stopPropagation();return;}
    if (command && key === 'z') action = () => event.shiftKey ? session.redo() : session.undo();
    else if (command && key === 'y') action = () => session.redo();
    else if (command && key === 's') action = () => deliver('bcad');
    else if (command && key === 'a') action = () => session.select(session.state.document.roots);
    else if(command&&key==='g')action=()=>event.shiftKey?session.separate(session.state.selection[0]):session.combine('union');
    else if(!command&&key==='h'&&session.state.selection.length)action=()=>session.setRole('hole');
    else if(!command&&key==='s'&&session.state.selection.length)action=()=>session.setRole('solid');
    else if (!command && key === 'c') action=()=>setSurfaceSnap(!viewport.surfaceSnap);
    else if (!command && key === 'd') action = () => viewport.dropSelection();
    else if (command && key === 'd') action = () => session.duplicate();
    else if (command && key === 'c') action=()=>copySelection();
    else if (command && key === 'x') action=()=>copySelection(true);
    else if (command && key === 'v') action=()=>pasteSelection();
    else if ((command && key === 'k') || (!command && event.shiftKey && key === 'a')) action = () => picker.open(true);
    else if (key === 'delete' || key === 'backspace') action = () => session.remove();
    else if (key === 'escape') action = () => {const cancelled=viewport.interacting;cancelShapePlacement(); viewport.cancelTransform();menus.forEach(menu=>menu.open=false);if(cancelled)return;if(mode!=='select')setMode('select');else session.select([]); };
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
      case 'projection':projectionButton.click();break;case 'workplane':planeButton.click();break;case 'objects':partsToggle.click();break;case 'properties':propertiesToggle.click();break;case 'drop':viewport.dropSelection();break;case 'parameters':parametersPanel.open();break;case 'sketch':sketchPanel.open();break;case 'revolve':sketchPanel.openRevolution();break;case 'model-source':modelSourcePanel.toggle();break;case 'model-library':modelLibraryPanel.open();break;case 'code':codePanel.open(session.state.selection.length===1&&session.state.document.nodes[session.state.selection[0]]?.kind==='code'?session.state.selection[0]:undefined);break;case 'readout':readout.setVisible(!readout.visible);break;
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
    setColorMode(mode:CadColorMode){if(!['light','dark'].includes(mode))throw new Error(t('Choose light or dark mode'));host.dataset.cadColorMode=mode;if(!customAppearance)viewport.setAppearance(mode==='light'?{background:'#e7eef7',baseplate:'#cdd9e8'}:{background:'#111e29',baseplate:'#233644'});},get colorMode(){return host.dataset.cadColorMode as CadColorMode;},simulation,session, whenIdle, openFile,setRightPane,get rightPane(){return {...rightPane};},importFile,executeCommand,setSurfaceSnap,get surfaceSnap(){return viewport.surfaceSnap;},setNavigation:viewport.setNavigation,setResizeControls:viewport.setResizeControls,setGridDisplay:viewport.setGridDisplay,get gridDisplay(){return viewport.gridDisplay;},get resizeControls(){return viewport.resizeControls;},setShapeBrowserLayout:(layout:ShapeBrowserLayout)=>picker.setLayout(layout),get shapeBrowserLayout(){return picker.layout;},setAppearance(value:{background:string;baseplate:string}){viewport.setAppearance(value);customAppearance=true;},get appearance(){return viewport.appearance;},get commandState(){return commandState();}, export: deliver, frame: viewport.frame,
    setTransformReadoutVisible(visible:boolean){readout.setVisible(visible);},get transformReadoutVisible(){return readout.visible;},
    focus() { simulation.refresh(); viewport.canvas.focus(); },
    setStatus(text: string) { if (!disposed) message.textContent = text; },
    dispose() { if (disposed) return;cancelShapePlacement(); simulation.dispose(); disposed = true; toolbarResize.disconnect();unsubscribe();document.removeEventListener('pointerdown',dismissMenus,true);document.removeEventListener('focusin',dismissMenus,true); shell.removeEventListener('keydown', keyboard); picker.dispose(); modelLibraryPanel.dispose(); parametersPanel.dispose(); sketchPanel.dispose(); drawingPanel.dispose(); codePanel.dispose(); modelSourcePanel.dispose(); readout.dispose(); viewport.dispose(); client.dispose(); for (const w of waiters) w.reject(new Error(t('Editor was disposed'))); waiters.clear(); if (ownsSession) session.dispose(); shadow.replaceChildren(); options.toolbarContent?.remove(); host.removeAttribute('data-state'); host.removeAttribute('data-triangles'); },
  };
}
export type CadEditor = ReturnType<typeof mountCadEditor>;
export { createCadSession } from '@brickwright/cad-core';
export { shapeCatalog, createPresetDocument } from './shapes.js';
