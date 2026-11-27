// SPDX-License-Identifier: BSD-3-Clause
// Browser host entry: the same editor/core used by standalone CAD.
import {mountCadEditor as mountSharedCadEditor} from '@brickwright/cad-editor';
import type {CadEditorOptions} from '@brickwright/cad-editor';
let library:ReturnType<typeof import('../shared/model-library-local.js')['createBundledModelLibraryOptions']>|undefined;
let legacyFiles:Map<string,Uint8Array>|undefined;
async function loadBundledOptions(){
 const [{createBundledModelLibraryOptions},{createModelLibraryBrowserCache}]=await Promise.all([import('../shared/model-library-local.js'),import('../shared/model-library-cache.js')]);
 library??=createBundledModelLibraryOptions();return {...library,cache:createModelLibraryBrowserCache()};
}
export async function loadBundledModelLibrary(){
 const {bundledFiles,...options}=await loadBundledOptions();
 return {...options,localFiles:legacyFiles??=bundledFiles.materialize()};
}
export function mountCadEditor(host:HTMLElement,options:CadEditorOptions){return mountSharedCadEditor(host,{...options,modelLibrary:options.modelLibrary??{load:loadBundledOptions}});}
export {createDocument,parseDocument,serializeDocument,setLocale} from '@brickwright/cad-core';
// Kernels: this SDK ships the pinned exact kernel as lazy worker assets (assets/exact/), so every
// host that serves the SDK can run it. Sessions created here declare it unless the host passes
// `kernels` itself; createCadSession(document) is the same as createEditorSession(document).
// mountCadEditor never changes the kernels of a session the host passes.
export {createEditorSession,createEditorSession as createCadSession,editorKernels,exactKernelIdentity,providesKernel} from '@brickwright/cad-editor';
// Exact-job limits for hosts (tablet defaults apply when none are given; see docs/INTEGRATION.md).
// The editor's menu as data (labels and availability per editor: editor.menuItems()).
export {editorMenu,editorMenuSections,resolveEditorMenu} from '@brickwright/cad-editor';
export type {EditorMenuEntry,EditorMenuItem,EditorMenuSection} from '@brickwright/cad-editor';
export {EXACT_LIMITS_TABLET,EXACT_LIMITS_DESKTOP,resolveExactLimits} from '@brickwright/cad-editor';
export type {ExactLimits,ExactActivity} from '@brickwright/cad-editor';
// Block/pseudocode modelling: hosts compile their block workspaces through the same core.
export {compileBlocksToCadScript,applyBlocksModel,exportBlocksOpenSCAD,exportBlocksJSCAD,validateBlocksProgram,CadBlocksError,BLOCK_SHAPES} from '@brickwright/cad-core';

export {readCostumeProfiles,costumeSketchProfile,costumeProfileBounds,matchCostumeProfile} from '@brickwright/cad-editor';
