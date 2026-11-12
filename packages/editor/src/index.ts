// SPDX-License-Identifier: BSD-3-Clause
import { createCadSession, createDocument, identityTransform, newId, parseDocument, defaultPartPhysics } from '@brickwright/cad-core';
import type { CadDocument, CadSession, Primitive, SolidNode, Transform, Vec3 } from '@brickwright/cad-core';
import { export3MF, exportSTL, importSTL } from '@brickwright/cad-geometry';
import type { GeometryResult } from '@brickwright/cad-geometry';
import { createGeometryClient } from './geometry-client.js';
import { mountViewport } from './viewport.js';
import { editorStyle } from './style.js';
import { toolIcon } from './icons.js';
import { mountShapePicker } from './shape-picker.js';
import { createPresetDocument, evaluatedPreview } from './shapes.js';
export interface CadFile { name: string; bytes: Uint8Array; mime: string }
export interface CadEditorOptions {
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
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element;
}
/** Mounts one isolated editor. No storage, window keyboard handlers, React or Scratch globals. */
export function mountCadEditor(host: HTMLElement, options: CadEditorOptions) {
  const session = options.session ?? createCadSession(options.document); const ownsSession = !options.session;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (shadow.childElementCount) throw new Error('Mount target is already in use');
  const style = el('style'); style.textContent = editorStyle; const shell = el('section', 'editor'); shell.setAttribute('aria-label', 'CAD editor');
  const toolbar = el('div', 'toolbar'); toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Model tools');
  const main = el('div', 'main'); const tree = el('aside', 'panel tree'); const viewHost = el('div', 'viewport'); const inspector = el('aside', 'panel inspector');
  const status = el('div', 'status'); const message = el('span'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); const stats = el('span', 'stats'); status.append(message, stats);
  const designBar = el('div', 'design-bar'); designBar.append(el('span', 'workspace-label', '3D WORKSPACE'));
  const titleInput = el('input'); titleInput.setAttribute('aria-label', 'Design title'); titleInput.addEventListener('keydown',event=>{if(event.key==='Enter')titleInput.blur();else if(event.key==='Escape'){titleInput.value=session.state.document.title;titleInput.blur();}}); titleInput.addEventListener('change', () => run(() => session.rename(titleInput.value))); designBar.append(titleInput, el('span', 'units-label', 'mm · Z up'));
  main.append(tree, viewHost, inspector); shell.append(designBar, toolbar, main, status); shadow.append(style, shell);
  let disposed = false; let builtRevision = -1; let built: GeometryResult | null = null; let running = false; let lastRevision = -1; let lastSelection = ''; let geometryError = ''; let mode: 'translate' | 'rotate' | 'scale' = 'translate'; let grid = 1;
  const waiters = new Set<{ resolve: (r: GeometryResult) => void; reject: (e: Error) => void }>();
  let operationError = '';
  function report(e: unknown) { const error = e instanceof Error ? e : new Error(String(e)); operationError = error.message; message.textContent = error.message; if (!disposed) options.onError?.(error); }
  const run = (fn: () => unknown) => { try { const result = fn(); if (result instanceof Promise) result.catch(report); } catch (e) { report(e); } };
  const client = createGeometryClient(new URL(options.wasmURL, document.baseURI).href, options.createWorker);
  let viewport: ReturnType<typeof mountViewport>;
  try { viewport = mountViewport(viewHost, session, report); } catch (e) { client.dispose(); shadow.replaceChildren(); if (ownsSession) session.dispose(); throw e; }
  const empty = el('div', 'empty'); empty.append(el('strong', '', 'Your next idea starts here.'), document.createTextNode('Pick a shape above. Set its dimensions in Properties. Drag to orbit; pinch to zoom.')); viewHost.append(empty);
  const busy = el('div', 'busy', 'Building solid…'); busy.hidden = true; viewHost.append(busy);
  const errorPanel = el('div', 'error'); errorPanel.hidden = true; errorPanel.setAttribute('role', 'alert'); viewHost.append(errorPanel);
  let toolParent: HTMLElement = toolbar;
  function toolGroup(label: string, className = '') { const group = el('div', `tool-group ${className}`); group.setAttribute('role', 'group'); group.setAttribute('aria-label', label); const tools = el('div', 'group-tools'); group.append(tools, el('span', 'group-title', label)); toolbar.append(group); toolParent = tools; }
  function button(label: string, action: () => unknown, parent: HTMLElement = toolParent, className = '') {
    const b = el('button', className); const icon = toolIcon(label); if (icon) b.append(icon); b.append(el('span', '', label)); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.addEventListener('click', () => run(action)); parent.append(b); return b;
  }
  function togglePanel(panel: HTMLElement, toggle: HTMLButtonElement) { const visible = getComputedStyle(panel).display !== 'none'; panel.classList.toggle('closed', visible); panel.classList.toggle('open', !visible); toggle.setAttribute('aria-pressed', String(!visible)); }
  const partsToggle = button('Objects', () => togglePanel(tree, partsToggle), designBar, 'panel-toggle');
  partsToggle.title = 'Show objects';
  const propertiesToggle = button('Properties', () => togglePanel(inspector, propertiesToggle), designBar, 'panel-toggle');
  toolGroup('Shapes', 'shapes-tools');
  const shapesButton = button('Shapes', () => picker.toggle(), toolParent, 'shape-library-toggle');
  const previewCache = new Map<string, Promise<string>>();
  const picker = mountShapePicker(main, shapesButton, async (preset, text, svg) => {
    const projectId=session.state.document.id;const doc = createPresetDocument(preset.id, text, {svg}); const result = await client.evaluate(doc);
    if (disposed) return;
    if(session.state.document.id!==projectId)throw new Error('Shape insertion was canceled because a different model was opened');
    const minZ = Math.min(...result.bodies.map(body => body.bounds.min[2]));
    session.insert(doc, [session.state.document.roots.length * 12, 0, -minZ]);
    await whenIdle();
  }, report, preset => { let preview=previewCache.get(preset.id); if(!preview){preview=client.evaluate(createPresetDocument(preset.id,'ABC')).then(result=>evaluatedPreview(result.bodies));previewCache.set(preset.id,preview);}return preview; });
  const add = (shape: Primitive) => {
    const transform = identityTransform(); const height = shape.kind === 'box' ? shape.size[2] : shape.kind === 'cylinder' ? shape.height : shape.radius * 2;
    transform.position = [session.state.document.roots.length * 12, 0, height / 2]; session.add(shape, { transform });
  };
  button('Box', () => add({ kind: 'box', size: [30, 30, 20] }));
  button('Cylinder', () => add({ kind: 'cylinder', radius: 10, height: 30, segments: 64 }));
  button('Sphere', () => add({ kind: 'sphere', radius: 15, segments: 48 }));
  toolGroup('Combine');
  const opButtons = (['union', 'subtract', 'intersect'] as const).map(operation => {
    const b = button(operation[0].toUpperCase() + operation.slice(1), () => session.combine(operation));
    b.title = operation === 'subtract' ? 'First selected body is the base. Later selected bodies cut it.' : `${operation} the selected bodies`; return b;
  });
  toolGroup('Transform');
  const modeButtons = (['translate', 'rotate', 'scale'] as const).map((m, i) => {
    const b = button(['Move', 'Rotate', 'Scale'][i], () => setMode(m)); b.title = ['Move (W)', 'Rotate (E)', 'Scale (R)'][i]; return b;
  });
  const dropButton = button('Drop to workplane', () => viewport.dropSelection());
  const planeBar = el('div', 'plane-bar'); planeBar.append(el('span', 'plate-size', '400 × 400 mm workplane'));
  const gridLabel = el('label', '', 'Snap Grid'); const gridSelect = el('select'); gridSelect.setAttribute('aria-label', 'Grid spacing');
  for (const n of [0, 0.1, 1, 5, 10]) { const o = el('option', '', n === 0 ? 'Off' : `${n} mm`); o.value = String(n); gridSelect.append(o); } gridSelect.value = '1';
  gridSelect.addEventListener('change', () => { grid = Number(gridSelect.value); viewport.setGrid(grid); }); gridLabel.append(gridSelect); planeBar.append(gridLabel, el('span', 'unit-chip', 'mm')); viewHost.append(planeBar);
  toolGroup('Edit');
  const undoButton = button('Undo', () => session.undo()); const redoButton = button('Redo', () => session.redo());
  const duplicateButton = button('Duplicate', () => session.duplicate()); const deleteButton = button('Delete', () => session.remove());
  toolGroup('File', 'file-tools');
  button('New', async () => { if (!options.requestNew || await options.requestNew()) session.load(createDocument()); });
  const input = el('input'); input.type = 'file'; input.setAttribute('aria-label','Open CAD project or STL'); input.accept = '.bcad,.json,.stl'; input.hidden = true; shell.append(input);
  button('Open', async () => { if (options.requestOpen) { const file = await options.requestOpen(); if (file) await openFile(file.name, file.bytes); } else input.click(); });
  input.addEventListener('change', () => { const file = input.files?.[0]; input.value = ''; if (file) run(async () => { if (file.size > 16 * 1024 * 1024) throw new Error('File exceeds 16 MiB'); await openFile(file.name, new Uint8Array(await file.arrayBuffer())); }); });
  const save = button('Save project', () => deliver('bcad'), toolParent, 'primary'); save.disabled = !options.onExport;
  const stl = button('STL', () => deliver('stl')); const mf = button('3MF', () => deliver('3mf')); stl.disabled = mf.disabled = true;
  const viewActions = el('div', 'view-actions'); viewActions.setAttribute('role', 'toolbar'); viewActions.setAttribute('aria-label', 'View controls'); viewHost.append(viewActions);
  button('Home', () => viewport.frame('iso'), viewActions); button('Fit', () => viewport.frame(), viewActions);
  button('Zoom in', () => viewport.zoom(1.25), viewActions); button('Zoom out', () => viewport.zoom(0.8), viewActions);
  let ortho = false; const projectionButton = button('Orthographic view', () => { ortho = !ortho; viewport.setProjection(ortho); projectionButton.setAttribute('aria-pressed', String(ortho)); }, viewActions); projectionButton.setAttribute('aria-pressed', 'false');
  let planeVisible = true; const planeButton = button('Show workplane', () => { planeVisible = !planeVisible; viewport.setWorkplaneVisible(planeVisible); planeButton.setAttribute('aria-pressed', String(planeVisible)); }, viewActions); planeButton.setAttribute('aria-pressed', 'true');
  let multi = false; const multiButton = button('Multi-select', () => { multi = !multi; viewport.setMultiSelect(multi); multiButton.setAttribute('aria-pressed', String(multi)); }, viewActions); multiButton.setAttribute('aria-pressed', 'false');
  const viewSelect = el('select'); viewSelect.setAttribute('aria-label', 'View direction');
  for (const name of ['iso', 'top', 'front', 'right', 'back', 'left', 'bottom'] as const) { const option = el('option', '', name === 'iso' ? '3D view' : `${name[0].toUpperCase()}${name.slice(1)} view`); option.value = name; viewSelect.append(option); }
  viewSelect.addEventListener('change', () => viewport.setView(viewSelect.value as import('./viewport.js').ViewDirection)); planeBar.prepend(viewSelect);
  viewport.setViewListener(view => { viewSelect.value = view; });
  function setMode(next: typeof mode) { mode = next; viewport.setMode(mode); modeButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((['translate', 'rotate', 'scale'] as const)[i] === mode))); }
  setMode('translate');
  function buildTree() {
    tree.replaceChildren(); const header = el('div', 'panel-header'); header.append(el('h2', '', 'Objects')); button('Close objects', () => { tree.classList.remove('open'); tree.classList.add('closed'); partsToggle.setAttribute('aria-pressed', 'false'); }, header); tree.append(header);
    titleInput.value = session.state.document.title;
    const info = el('p', 'hint', 'Select in order: subtract cuts later selections out of the first.'); tree.append(info);
    const selected = session.state.selection; const doc = session.state.document;
    const append = (id: string, parent: HTMLElement, child = false) => {
      const n = doc.nodes[id]; const item = el('div', 'node'); const row = el('div', 'node-row'); item.dataset.objectId = id;
      if (!child) { const check = el('input'); check.type = 'checkbox'; check.checked = selected.includes(id); check.setAttribute('aria-label', `Select ${n.name}`); check.addEventListener('change', () => session.select(check.checked ? [...selected, id] : selected.filter(x => x !== id))); row.append(check); }
      const select = button(n.name, () => session.select([id]), row); select.classList.toggle('selected', selected.includes(id)); select.title = `${n.name} · ${n.kind}`; select.dataset.testid = 'object-name'; item.append(row);
      if (n.kind === 'boolean') { const children = el('div', 'children'); n.inputs.forEach(i => append(i, children, true)); item.append(children); }
      parent.append(item);
    };
    doc.roots.forEach(id => append(id, tree));
    if (!doc.roots.length) tree.append(el('p', 'hint', 'No objects yet. Start with a box.'));
  }
  function field(parent: HTMLElement, label: string, value: string | number, change: (value: string) => void, type = 'number', step = '1') {
    const wrap = el('label', 'field', label); const input = el('input'); input.type = type; input.value = String(value); input.setAttribute('aria-label', label); input.step = step;
    input.addEventListener('change', () => run(() => change(input.value))); wrap.append(input); parent.append(wrap); return input;
  }
  function buildInspector() {
    inspector.replaceChildren(); const header = el('div', 'panel-header'); header.append(el('h2', '', 'Properties')); button('Close properties', () => { inspector.classList.remove('open'); inspector.classList.add('closed'); propertiesToggle.setAttribute('aria-pressed', 'false'); }, header); inspector.append(header);
    const selection = session.state.selection;
    if (selection.length !== 1) { inspector.append(el('p', '', selection.length ? `${selection.length} bodies selected. Use the handles to transform them together.` : 'Select an object to edit its dimensions and position.')); return; }
    const id = selection[0], n = session.state.document.nodes[id];
    inspector.append(el('div', 'selection-count', n.reference ? 'Reference helper · not exported' : n.kind === 'boolean' ? 'Retained boolean operation' : n.kind === 'mesh' ? 'Mesh solid' : 'Parametric solid'));
    field(inspector, 'Object name', n.name, value => session.update(id, { name: value }), 'text');
    field(inspector, 'Color', n.color, value => session.update(id, { color: value }), 'color');
    if (n.kind === 'box') {
      (['Width', 'Depth', 'Height'] as const).forEach((label, i) => field(inspector, `${label} (mm)`, n.size[i], value => { const size = [...n.size] as Vec3; size[i] = Number(value); session.update(id, { size }); }, 'number', '0.1'));
    } else if (n.kind === 'cylinder' || n.kind === 'sphere') {
      field(inspector, 'Radius (mm)', n.radius, value => session.update(id, { radius: Number(value) }), 'number', '0.1');
      if (n.kind === 'cylinder') field(inspector, 'Height (mm)', n.height, value => session.update(id, { height: Number(value) }), 'number', '0.1');
      field(inspector, 'Segments', n.segments, value => session.update(id, { segments: Number(value) }), 'number', '4');
    } else if (n.kind === 'boolean') {
      inspector.append(el('p', 'hint', `${n.operation}: ${n.inputs.length} operands. Choose a child under Objects to edit the source shape.`));
      button('Separate operands', () => session.separate(id), inspector);
    }
    for (const [key, title, units, step] of [['position', 'Position', 'mm', '0.1'], ['rotation', 'Rotation', '°', '1'], ['scale', 'Scale', '×', '0.1']] as const) {
      inspector.append(el('div', 'inspect-title', `${title} (${units})`)); const group = el('div', 'triple'); inspector.append(group);
      ['X', 'Y', 'Z'].forEach((axis, i) => field(group, `${title} ${axis}`, n.transform[key][i], value => { const transform = structuredClone(n.transform); transform[key][i] = Number(value); session.update(id, { transform }); }, 'number', step));
    }
    button('Reset transform', () => session.update(id, { transform: identityTransform() }), inspector);
    if(!n.reference && session.state.document.roots.includes(id)) {
      inspector.append(el('div','inspect-title','Physics material'));
      const p=n.physics??defaultPartPhysics();
      for(const [key,label,step] of [['densityKgM3','Density (kg/m³)','10'],['friction','Friction','0.05'],['restitution','Restitution','0.05']] as const)field(inspector,label,p[key],value=>session.update(id,{physics:{...p,[key]:Number(value)}}),'number',step);
      const label=el('label','field','Body motion');const select=el('select');select.setAttribute('aria-label','Body motion');for(const motion of ['dynamic','static'] as const){const option=el('option','',motion==='dynamic'?'Dynamic':'Fixed in world');option.value=motion;select.append(option);}select.value=p.motion;select.addEventListener('change',()=>run(()=>session.update(id,{physics:{...p,motion:select.value as 'dynamic'|'static'}})));label.append(select);inspector.append(label);
      if(p.intent!=='rigid')inspector.append(el('p','hint',`Mechanical role: ${p.intent}. Rigid collision preview does not qualify elastic behavior, mating fit or a complete mechanism.`));
      if(session.state.document.joints?.some(j=>j.bodyA===id||j.bodyB===id))button('Detach joints',()=>session.detachJoints([id]),inspector);
    }
    inspector.append(el('p', 'hint', 'Dimensions are centred on the object. Move Z to keep its bottom on the workplane.'));
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
        stats.textContent = `${doc.roots.length} ${doc.roots.length === 1 ? 'body' : 'bodies'} · ${result.triangles.toLocaleString()} triangles · ${result.volume.toLocaleString(undefined, { maximumFractionDigits: 1 })} mm³`;
        message.textContent = operationError || (doc.roots.length ? 'Ready · mm · Z up' : 'Add a solid to begin');
        host.dataset.state = 'ready'; host.dataset.triangles = String(result.triangles);
        for (const w of waiters) w.resolve(result); waiters.clear();
      } catch (e) {
        if (disposed) break; if (revision !== session.state.revision) continue;
        builtRevision = revision; built = null; geometryError = e instanceof Error ? e.message : String(e); errorPanel.textContent = `${geometryError} Showing the previous geometry. Fix the edit or Undo.`; errorPanel.hidden = false; host.dataset.state = 'error'; report(e);
        for (const w of waiters) w.reject(new Error(geometryError)); waiters.clear();
      }
    }
    running = false; busy.hidden = true; refreshButtons();
  }
  function refreshButtons() {
    const state = session.state; const roots = state.selection.filter(id => state.document.roots.includes(id));
    undoButton.disabled = !state.canUndo; redoButton.disabled = !state.canRedo; duplicateButton.disabled = deleteButton.disabled = !roots.length;
    dropButton.disabled = !roots.length || running || builtRevision !== state.revision || !built;
    opButtons.forEach(b => { b.disabled = roots.length < 2; });
    stl.disabled = mf.disabled = !options.onExport || running || !built || !built.triangles || builtRevision !== state.revision;
  }
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
    if (editable) return;
    const command = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase(); let action: (() => unknown) | undefined;
    if (command && key === 'z') action = () => event.shiftKey ? session.redo() : session.undo();
    else if (command && key === 'y') action = () => session.redo();
    else if (command && key === 's') action = () => deliver('bcad');
    else if (command && key === 'a') action = () => session.select(session.state.document.roots);
    else if (command && key === 'd') action = () => session.duplicate();
    else if ((command && key === 'k') || (!command && event.shiftKey && key === 'a')) action = () => picker.open(true);
    else if (key === 'delete' || key === 'backspace') action = () => session.remove();
    else if (key === 'escape') action = () => { viewport.cancelTransform(); session.select([]); };
    else if (key === 'f') action = () => viewport.frame();
    else if (key === 'w') action = () => setMode('translate');
    else if (key === 'e') action = () => setMode('rotate');
    else if (key === 'r') action = () => setMode('scale');
    else if (key.startsWith('arrow') && session.state.selection.length) action = () => { const d = (grid || 0.1) * (event.shiftKey ? 10 : 1); viewport.nudge(key === 'arrowleft' ? -d : key === 'arrowright' ? d : 0, key === 'arrowup' && !event.altKey ? d : key === 'arrowdown' && !event.altKey ? -d : 0, event.altKey ? (key === 'arrowup' ? d : key === 'arrowdown' ? -d : 0) : 0); };
    if (action) { event.preventDefault(); event.stopPropagation(); run(action); }
  }; shell.addEventListener('keydown', keyboard);
  function whenIdle(): Promise<GeometryResult> {
    if (disposed) return Promise.reject(new Error('Editor was disposed'));
    if (!running && builtRevision === session.state.revision) return built ? Promise.resolve(built) : Promise.reject(new Error(geometryError));
    return new Promise((resolve, reject) => { waiters.add({ resolve, reject }); });
  }
  async function openFile(name: string, bytes: Uint8Array) {
    let doc: CadDocument;
    if (/\.stl$/i.test(name)) {
      const mesh = importSTL(bytes); doc = createDocument(name.replace(/\.stl$/i, '')); const id = newId();
      doc.nodes[id] = { id, name: doc.title, kind: 'mesh', ...mesh, color: '#eea52b', transform: identityTransform() }; doc.roots = [id];
    } else doc = parseDocument(new TextDecoder().decode(bytes));
    // Geometry errors in imported meshes must not destroy the current project.
    const expectedRevision=session.state.revision;await client.evaluate(doc); if (disposed) return;if(session.state.revision!==expectedRevision)throw new Error('The model changed while opening the file. Try opening it again.'); session.load(doc); await whenIdle(); viewport.frame();
  }
  async function deliver(format: 'bcad' | 'stl' | '3mf') {
    if (!options.onExport) throw new Error('This host has not provided file export');
    const title = session.state.document.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim() || 'design';
    const bytes = format === 'bcad' ? new TextEncoder().encode(session.serialize()) : format === 'stl' ? exportSTL((await whenIdle()).bodies) : export3MF((await whenIdle()).bodies);
    await options.onExport({ name: `${title}.${format}`, bytes, mime: format === 'bcad' ? 'application/vnd.brickwright.cad+json' : format === 'stl' ? 'model/stl' : 'model/3mf' });
  }
  buildTree(); buildInspector(); lastRevision = session.state.revision; lastSelection = JSON.stringify(session.state.selection); viewport.setSelection(session.state.selection); void buildLatest(); refreshButtons();
  return {
    session, whenIdle, openFile, export: deliver, frame: viewport.frame,
    focus() { viewport.canvas.focus(); },
    setStatus(text: string) { if (!disposed) message.textContent = text; },
    dispose() { if (disposed) return; disposed = true; unsubscribe(); shell.removeEventListener('keydown', keyboard); picker.dispose(); viewport.dispose(); client.dispose(); for (const w of waiters) w.reject(new Error('Editor was disposed')); waiters.clear(); if (ownsSession) session.dispose(); shadow.replaceChildren(); host.removeAttribute('data-state'); host.removeAttribute('data-triangles'); },
  };
}
export type CadEditor = ReturnType<typeof mountCadEditor>;
export { createCadSession } from '@brickwright/cad-core';
export { shapeCatalog, createPresetDocument } from './shapes.js';
