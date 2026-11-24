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
export {createDocument,createCadSession,parseDocument,serializeDocument,setLocale} from '@brickwright/cad-core';
// Block/pseudocode modelling: hosts compile their block workspaces through the same core.
export {compileBlocksToCadScript,applyBlocksModel,exportBlocksOpenSCAD,exportBlocksJSCAD,validateBlocksProgram,CadBlocksError,BLOCK_SHAPES} from '@brickwright/cad-core';

export {readCostumeProfiles,costumeSketchProfile,costumeProfileBounds,matchCostumeProfile} from '@brickwright/cad-editor';
