// SPDX-License-Identifier: BSD-3-Clause
// The editor's menu, as data: one definition for every host that shows the editor's commands in
// its own menus (BrickWright's File and Edit menus, the standalone app's native menus). Hosts read
// it through `editor.menuItems()`, which adds the translated label and whether the item can run
// now, and run an item with `editor.executeCommand(item.command)`. Adding a command here makes it
// appear in every such host; nothing else needs to change on their side.
import {t} from '@brickwright/cad-core';
import type {CadCommand} from './index.js';

/**
 * The menu an item belongs to. `file`, `edit`, `view` and `object` match the standalone app's
 * menus; `exact` (exact B-rep modeling), `fastening` (standard holes, ISO parts, fasteners), `drawing` (drawings and checks) and `tools` group the
 * rest so a host with only File and Edit menus can show them as submenus.
 */
export type EditorMenuSection='file'|'exact'|'fastening'|'drawing'|'edit'|'view'|'object'|'tools';
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
}
export interface EditorMenuItem extends EditorMenuEntry {
 /** `label`, translated for the current locale. */
 readonly title:string;
 /** The section's name (editorMenuSections), translated. */
 readonly sectionTitle:string;
 readonly enabled:boolean;
}
/** English i18n keys naming each section, for hosts that show sections as submenus. */
export const editorMenuSections:Readonly<Record<EditorMenuSection,string>>=Object.freeze({
 file:'File',exact:'Exact modeling (B-rep)',fastening:'Holes and fasteners',drawing:'Drawings and checks',edit:'Edit',view:'View',object:'Object',tools:'CAD tools',
});
const entry=(section:EditorMenuSection,group:number,command:CadCommand,label:string,extra:{requires?:EditorMenuRequirement;exact?:true}={}):EditorMenuEntry=>({command,label,section,group,...extra});
export const editorMenu:readonly EditorMenuEntry[]=Object.freeze([
 entry('file',0,'new','New project'),
 entry('file',0,'open','Open…'),
 entry('file',0,'save','Save project'),
 entry('file',1,'model-library','Model library…'),
 entry('file',1,'robot-projects','Robot projects…'),
 entry('file',2,'import','Import STL or STEP…'),
 entry('file',2,'import-step','Import STEP as exact bodies…',{exact:true}),
 entry('file',3,'export','Export…',{requires:'canExport'}),
 entry('file',3,'export-step','Export STEP (exact B-rep)…',{requires:'canExport',exact:true}),
 entry('exact',0,'exact-feature','Fillet, chamfer or shell…',{requires:'oneBody',exact:true}),
 entry('exact',0,'exact-edges','Fillet or chamfer chosen edges…',{requires:'oneBody',exact:true}),
 entry('exact',1,'measure-exact','Measure exactly',{requires:'hasBodies',exact:true}),
 entry('exact',1,'recompute-exact','Recompute exact features',{requires:'hasBodies',exact:true}),
 entry('fastening',0,'hole','Standard hole',{requires:'hasBodies'}),
 entry('fastening',0,'fasten','Fasten holes',{requires:'hasBodies'}),
 entry('fastening',1,'standard-part','Standard parts'),
 entry('drawing',0,'drawing','Assembly drawing…',{requires:'canDraw'}),
 entry('drawing',0,'drawing-exact','Assembly drawing from exact edges…',{requires:'canDraw',exact:true}),
 entry('drawing',1,'printability','Check printability…',{requires:'canExport'}),
 entry('drawing',1,'manufacturing','Check for manufacturing…',{requires:'canExport',exact:true}),
 entry('edit',0,'undo','Undo',{requires:'canUndo'}),
 entry('edit',0,'redo','Redo',{requires:'canRedo'}),
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
 entry('object',2,'mirror','Mirror body',{requires:'oneBody'}),
 entry('object',2,'pattern','Pattern body',{requires:'oneBody'}),
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
