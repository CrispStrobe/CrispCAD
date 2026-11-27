// SPDX-License-Identifier: BSD-3-Clause
// The editor's menu, as data: one definition for every host that shows the editor's commands in
// its own menus (BrickWright's File and Edit menus, the standalone app's native menus). Hosts read
// it through `editor.menuItems()`, which adds the translated label and whether the item can run
// now, and run an item with `editor.executeCommand(item.command)`. Adding a command here makes it
// appear in every such host; nothing else needs to change on their side: the standalone toolbar's
// File and Edit dropdowns are rendered from it (`editorToolbarMenu`), and the macOS app's native
// menus are generated from it at build time (scripts/generate-mac-menus.mjs).
import {t} from '@brickwright/cad-core';
import type {CadCommand} from './index.js';

/**
 * The menu an item belongs to. `file`, `edit`, `view` and `object` match the standalone app's
 * menus; `exact` (exact B-rep modeling), `fastening` (standard holes, ISO parts, fasteners), `assembly` (groups, exploded views, configurations, mechanism check), `drawing` (drawings and checks) and `tools` group the
 * rest so a host with only File and Edit menus can show them as submenus.
 */
export type EditorMenuSection='file'|'exact'|'fastening'|'assembly'|'drawing'|'edit'|'view'|'object'|'tools';
/** When an item is enabled (all items without one always are). */
export type EditorMenuRequirement='hasSelection'|'canDelete'|'canCombine'|'canExport'|'hasBodies'|'canUndo'|'canRedo'|'oneBody'|'canDraw';
export interface EditorMenuEntry {
 readonly command:CadCommand;
 /** English i18n key (translated by `menuItems()`). */
 readonly label:string;
 readonly section:EditorMenuSection;
 /** Items of one section with different groups are separated. */
 readonly group:number;
 readonly requires?:EditorMenuRequirement;
 /** The item loads the exact B-rep kernel on first use (about 9 MB). */
 readonly exact?:true;
 /** The editor toolbar's dropdown that lists the item: by default Edit for the exact, assembly and
  * edit sections, none for view, object and tools, File for the rest. */
 readonly toolbar?:EditorToolbarMenu|false;
 /** Shorter English i18n key for the toolbar dropdown (default: `label`). */
 readonly short?:string;
 /** English i18n key for the toolbar button's tooltip. */
 readonly hint?:string;
}
export type EditorToolbarMenu='file'|'edit';
export interface EditorMenuItem extends EditorMenuEntry {
 /** `label`, translated for the current locale. */
 readonly title:string;
 /** The section's name (editorMenuSections), translated. */
 readonly sectionTitle:string;
 readonly enabled:boolean;
}
/** English i18n keys naming each section, for hosts that show sections as submenus. */
export const editorMenuSections:Readonly<Record<EditorMenuSection,string>>=Object.freeze({
 file:'File',exact:'Exact modeling (B-rep)',fastening:'Holes and fasteners',assembly:'Assemblies',drawing:'Drawings and checks',edit:'Edit',view:'View',object:'Object',tools:'CAD tools',
});
type EntryOptions={requires?:EditorMenuRequirement;exact?:true;toolbar?:EditorToolbarMenu|false;short?:string;hint?:string};
const entry=(section:EditorMenuSection,group:number,command:CadCommand,label:string,extra:EntryOptions={}):EditorMenuEntry=>({command,label,section,group,...extra});
export const editorMenu:readonly EditorMenuEntry[]=Object.freeze([
 entry('file',0,'new','New project',{short:'New'}),
 entry('file',0,'open','Open…',{short:'Open'}),
 entry('file',0,'save','Save project'),
 entry('file',1,'model-library','Model library…',{short:'Model library'}),
 entry('file',1,'robot-projects','Robot projects…'),
 entry('file',2,'import','Import STL or STEP…'),
 entry('file',2,'import-step','Import STEP as exact bodies…',{exact:true}),
 entry('file',3,'export','Export…',{requires:'canExport'}),
 entry('file',3,'export-step','Export STEP (exact B-rep)…',{requires:'canExport',exact:true}),
 entry('file',3,'step-evidence','STEP evidence…',{exact:true}),
 entry('exact',0,'exact-feature','Fillet, chamfer or shell…',{requires:'oneBody',exact:true,short:'Fillet, chamfer, shell',hint:'Round, bevel or hollow a selected body exactly with the B-rep kernel'}),
 entry('exact',0,'exact-edges','Fillet or chamfer chosen edges…',{requires:'oneBody',exact:true}),
 entry('exact',1,'measure-exact','Measure exactly',{requires:'hasBodies',exact:true,hint:'Volume, area, bounds and centroid from the exact B-rep kernel (selected bodies, or all)'}),
 entry('exact',1,'recompute-exact','Recompute exact features',{requires:'hasBodies',exact:true}),
 entry('exact',2,'surface-blends','Inspect surface blends…',{requires:'canExport',exact:true}),
 entry('fastening',0,'hole','Standard hole',{requires:'hasBodies'}),
 entry('fastening',0,'fasten','Fasten holes',{requires:'hasBodies'}),
 entry('fastening',1,'standard-part','Standard parts'),
 entry('assembly',0,'assembly','Groups and suppression…',{requires:'hasBodies'}),
 entry('assembly',0,'explode-view','Exploded view',{requires:'hasBodies'}),
 entry('assembly',0,'configurations','Configurations…',{requires:'hasBodies'}),
 entry('assembly',1,'mechanism-check','Check mechanism…',{requires:'hasBodies'}),
 entry('assembly',1,'planetary-gear','Insert planetary gear set'),
 entry('drawing',0,'drawing','Assembly drawing…',{requires:'canDraw'}),
 entry('drawing',0,'drawing-exact','Assembly drawing from exact edges…',{requires:'canDraw',exact:true}),
 entry('drawing',0,'drawing-export','Export drawing (PDF, SVG or DXF)…',{requires:'canDraw'}),
 entry('drawing',1,'printability','Check printability…',{requires:'canExport'}),
 entry('drawing',1,'manufacturing','Check for manufacturing…',{requires:'canExport',exact:true}),
 entry('drawing',1,'materials','Materials and mass…',{requires:'canExport'}),
 entry('edit',0,'undo','Undo',{requires:'canUndo',toolbar:false}),
 entry('edit',0,'redo','Redo',{requires:'canRedo',toolbar:false}),
 entry('edit',1,'cut','Cut',{requires:'canDelete'}),
 entry('edit',1,'copy','Copy',{requires:'canDelete'}),
 entry('edit',1,'paste','Paste'),
 entry('edit',1,'duplicate','Duplicate',{requires:'canDelete'}),
 entry('edit',1,'delete','Delete',{requires:'canDelete'}),
 entry('edit',2,'select-all','Select all',{requires:'hasBodies'}),
 entry('edit',2,'deselect','Deselect',{requires:'hasSelection'}),
 entry('view',0,'fit','Fit'),
 entry('view',0,'home','Home'),
 entry('view',1,'top','Top view'),
 entry('view',1,'front','Front view'),
 entry('view',1,'right','Right view'),
 entry('view',1,'back','Back view'),
 entry('view',1,'left','Left view'),
 entry('view',1,'bottom','Bottom view'),
 entry('view',2,'projection','Toggle projection'),
 entry('view',2,'workplane','Show workplane'),
 entry('view',2,'readout','Show on-canvas parameters'),
 entry('view',2,'objects','Objects'),
 entry('view',2,'properties','Properties'),
 entry('view',2,'model-source','Model source'),
 entry('object',0,'shapes','Find a shape'),
 entry('object',0,'sketch','Sketch & extrude'),
 entry('object',0,'sketch-path','Sketch path'),
 entry('object',0,'revolve','Revolve'),
 entry('object',0,'code','Code an object'),
 entry('object',0,'parameters','Parameters'),
 entry('object',1,'select','Select'),
 entry('object',1,'move','Move'),
 entry('object',1,'rotate','Rotate'),
 entry('object',1,'scale','Scale'),
 entry('object',2,'mirror','Mirror body',{requires:'oneBody',toolbar:'edit',short:'Mirror',hint:'Mirror a selected body across a plane'}),
 entry('object',2,'pattern','Pattern body',{requires:'oneBody',toolbar:'edit',short:'Pattern',hint:'Repeat a selected body in a line or circle'}),
 entry('object',2,'split-body','Split body…',{requires:'oneBody',toolbar:'edit',short:'Split',hint:'Cut a selected body into two at a plane'}),
 entry('object',2,'drop','Drop to workplane',{requires:'canDelete'}),
 entry('object',4,'union','Union',{requires:'canCombine'}),
 entry('object',4,'subtract','Subtract',{requires:'canCombine'}),
 entry('object',4,'intersect','Intersect',{requires:'canCombine'}),
 entry('tools',0,'terminal','CAD terminal'),
 entry('tools',0,'command-palette','Command palette'),
 entry('tools',0,'code-workspace','Code workspace'),
 entry('tools',1,'upgrade-lofts','Upgrade lofts to ruled surfaces',{requires:'hasBodies'}),
].map(item=>Object.freeze(item)));

/** The menu with labels in the current locale and each item's availability. */
export function resolveEditorMenu(state:Readonly<Record<EditorMenuRequirement,boolean>>,omit:ReadonlySet<CadCommand>=new Set()):EditorMenuItem[]{
 return editorMenu.filter(item=>!omit.has(item.command)).map(item=>({...item,title:t(item.label),sectionTitle:t(editorMenuSections[item.section]),enabled:!item.requires||state[item.requires]}));
}

/** Edit lists modeling sections; File lists files and every other section (fastening, drawing and
 * any section added later), in definition order. View, object (unless marked) and tools: none. */
const editSections:readonly EditorMenuSection[]=['object','exact','assembly','edit'];
const toolbarSections:Readonly<Record<EditorToolbarMenu,readonly EditorMenuSection[]>>=Object.freeze({
 file:(Object.keys(editorMenuSections) as EditorMenuSection[]).filter(section=>!editSections.includes(section)&&!['view','object','tools'].includes(section)),
 edit:editSections,
});
/** The toolbar dropdown an entry appears in, or undefined. */
export function editorToolbarMenuOf(item:EditorMenuEntry):EditorToolbarMenu|undefined{
 if(item.toolbar===false)return undefined;
 if(item.toolbar)return item.toolbar;
 // Object items (mirror, pattern) are listed only when they say so.
 if(item.section==='object')return undefined;
 return (['file','edit'] as const).find(menu=>toolbarSections[menu].includes(item.section));
}
/** The entries of one toolbar dropdown, in its order: by section (File: file, then the other
 * file-side sections; Edit: object, exact, assembly, edit), then as defined. */
export function editorToolbarMenu(menu:EditorToolbarMenu,omit:ReadonlySet<CadCommand>=new Set()):EditorMenuEntry[]{
 const order=toolbarSections[menu];
 return editorMenu.filter(item=>!omit.has(item.command)&&editorToolbarMenuOf(item)===menu).map((item,index)=>({item,index})).sort((a,b)=>order.indexOf(a.item.section)-order.indexOf(b.item.section)||a.index-b.index).map(entry=>entry.item);
}
