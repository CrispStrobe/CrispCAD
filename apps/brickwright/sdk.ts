// SPDX-License-Identifier: BSD-3-Clause
// Browser host entry: the same editor/core used by standalone CAD.
import {mountCadEditor as mountSharedCadEditor} from '@brickwright/cad-editor';
import type {CadEditorOptions} from '@brickwright/cad-editor';
let library:ReturnType<typeof import('../shared/model-library-local.js')['createBundledModelLibrary']>|undefined;
export async function loadBundledModelLibrary(){
 const [{createBundledModelLibrary},{createModelLibraryBrowserCache}]=await Promise.all([import('../shared/model-library-local.js'),import('../shared/model-library-cache.js')]);
 library??=createBundledModelLibrary();return {...library,cache:createModelLibraryBrowserCache()};
}
export function mountCadEditor(host:HTMLElement,options:CadEditorOptions){return mountSharedCadEditor(host,{...options,modelLibrary:options.modelLibrary??{load:loadBundledModelLibrary}});}
export {createDocument,createCadSession,parseDocument,serializeDocument,setLocale} from '@brickwright/cad-core';
// Block/pseudocode modelling: hosts compile their block workspaces through the same core.
export {compileBlocksToCadScript,applyBlocksModel,exportBlocksOpenSCAD,exportBlocksJSCAD,validateBlocksProgram,CadBlocksError,BLOCK_SHAPES} from '@brickwright/cad-core';

export {readCostumeProfiles,costumeSketchProfile} from '@brickwright/cad-editor';
