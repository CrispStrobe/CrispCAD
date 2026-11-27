// SPDX-License-Identifier: BSD-3-Clause
// Writes apps/macos/EditorMenu.generated.swift from the built editor menu definition
// (run `npm run build:packages` first; `npm run mac:build` does both). `--check` fails instead of
// writing when the file is out of date.
import {readFileSync,writeFileSync} from 'node:fs';
import {setLocale,t} from '@brickwright/cad-core';
import {editorMenu,editorMenuSections} from '../packages/editor/dist/editor-menu.js';
import {macMenuSwift} from './lib/mac-menus.mjs';
const target=new URL('../apps/macos/EditorMenu.generated.swift',import.meta.url);
const german=key=>{setLocale('de');try{return t(key);}finally{setLocale('en');}};
const source=macMenuSwift({editorMenu,editorMenuSections,german});
let current='';try{current=readFileSync(target,'utf8');}catch{}
if(process.argv.includes('--check')){if(current!==source){console.error('apps/macos/EditorMenu.generated.swift is out of date: run node scripts/generate-mac-menus.mjs');process.exit(1);}}
else if(current!==source){writeFileSync(target,source);console.log('Wrote apps/macos/EditorMenu.generated.swift');}
