// SPDX-License-Identifier: BSD-3-Clause
// One exact already-staged authored LDraw part; no network, source edits or runtime dependency.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCadSession,createLocalModelLibraryCatalogue} from '../packages/core/dist/index.js';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '../packages/geometry/dist/index.js';
import {convertLDrawBundle} from './lib/ldraw-model.mjs';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const commit='43f534195db2dcfa072a68b17654fad4d14a7c08',repositoryUrl='https://github.com/CrispStrobe/brickwright-lite';
const prefix='overlay/scratch-gui/static/ldraw/',sourceUrl=p=>`https://raw.githubusercontent.com/CrispStrobe/brickwright-lite/${commit}/${prefix}${p}`;
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const pins=[{path:'parts/6934.dat',sha256:'a5b599ccc9e7979c4cc2bc72e2b4705eb1f5954c6a82d2761ce22063a3ea4e17',author:'Tore Eriksson [Tore_Eriksson]'},{path:'p/box5.dat',sha256:'ccb7b8a1d36692335b10ea6aa196849afcad4b15331683ed8112a10b50977318',author:'James Jessiman'}];
const file=(path,bytes,format)=>({path,bytes:bytes.length,sha256:sha(bytes),format});
export async function generateLDrawEditorLibrary(){
 const files=await Promise.all(pins.map(async p=>{const bytes=await readFile(new URL('library/sources/ldraw/'+p.path,root));if(sha(bytes)!==p.sha256||!bytes.toString('latin1').includes('0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt'))throw Error('LDraw source/grant identity changed: '+p.path);return{...p,bytes};}));
 const licence=await readFile(new URL('library/evidence/ldraw-CC-BY-4.0.txt',root)),readme=await readFile(new URL('library/evidence/ldraw-CAreadme.txt',root));
 if(sha(licence)!=='9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411'||sha(readme)!=='c67a824bdab18e646337b5b26f7f039c84b0be71273c0c878e2749e648820497')throw Error('LDraw grant evidence changed.');
 const grant=(author,path)=>({spdx:'CC-BY-4.0',scope:'asset',attribution:`${author}. LDraw.org Official Parts Library. Source: ${sourceUrl(path)}. Creative Commons Attribution 4.0 International: https://creativecommons.org/licenses/by/4.0/. Original file and its !HISTORY contributor credits retained. Source unchanged; geometry conversion and nominal unit/axis changes described with the asset.`,evidenceUrl:sourceUrl(path),capturedOn:'2026-11-15',review:'accepted',reviewer:'Codex exact staged source, author, per-file CC-BY-4.0 grant and complete two-file closure review'});
 const converted=convertLDrawBundle({rootPath:pins[0].path,files});
 const wasm=await readFile(new URL('node_modules/manifold-3d/manifold.wasm',root)),kernel=await createGeometryKernel({wasmBinary:wasm}),session=createCadSession();let geometry,mesh;
 try{session.addCode(converted.program,'LDraw3x6tile');geometry=kernel.evaluate(session.state.document);mesh=Buffer.from(exportSTL(geometry.bodies));}finally{session.dispose();}
 const expected=(120*8*60-112*4*52)*.4**3;if(Math.abs(geometry.volume-expected)>expected*1e-6)throw Error('Independent hollow-box volume mismatch.');
 const screening=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-15',maxTriangles:10000,maxExtentMm:200,toMillimetresZUp:identity});if(!screening.quality||Object.values(screening.checks).some(v=>v!=='pass'))throw Error('LDraw strict mesh refusal.');
 if(sha(mesh)!=='02e1f0467c9744db98226db1a5e45de1597c54f09cdfdcbaf33b95bd3865288b')throw Error('Previously qualified LDraw derivative changed.');
 const meshPath='meshes/ldraw/6934.stl',asset={id:'corpus-ldraw-6934',title:'LDraw 3 × 6 hollow tile',author:'Tore Eriksson [Tore_Eriksson]; box5 primitive by James Jessiman',version:commit,
  sourceRevision:{repositoryUrl,commit,sourceUrl:sourceUrl(pins[0].path)},
  archiveSelection:{officialSourceArchive:{url:'https://library.ldraw.org/library/updates/complete.zip',sha256:'f3e496d0ede69ca7942fa4aa198e661ee2d22723906101e2e339d8917a4dd5f2',date:'2026-09-30'},rootPath:pins[0].path,converterMetrics:converted.metrics,authorsAndHistory:'Root: Tore Eriksson. Primitive: James Jessiman. Retained history credits: PTadmin, guyvivan, cwdee, sbliss, Philo.',kind:'official authored LDraw part'},
  licence:{...grant('Tore Eriksson [Tore_Eriksson], with box5 primitive by James Jessiman; retained history credits PTadmin, guyvivan, cwdee, sbliss and Philo',pins[0].path),localEvidence:[file('evidence/ldraw-CC-BY-4.0.txt',licence,'text'),file('evidence/ldraw-CAreadme.txt',readme,'text')]},
  original:{...file('sources/ldraw/'+pins[0].path,files[0].bytes,'ldraw'),url:sourceUrl(pins[0].path)},
  sourceBundle:{format:'brickwright-ldraw-bundle',version:1,rootPath:pins[0].path,dependencies:[{path:pins[1].path,file:file('sources/ldraw/'+pins[1].path,files[1].bytes,'ldraw'),author:pins[1].author,sourceUrl:sourceUrl(pins[1].path),sourceRevision:{repositoryUrl,commit},licence:grant(pins[1].author,pins[1].path)}]},
  derivatives:[file(meshPath,mesh,'stl')],
  modificationNotes:'Exact authored root and entire dependency retained byte-for-byte. Original bounded converter interprets certified BFC winding, INVERTNEXT and mirrored references, preserving every authored solid face. Nominal 0.4 mm/LDU and -Y-up converted to millimetres/Z-up; original origin preserved. Display edge/conditional-edge lines and inherited colour appearance omitted. No primitive substitution, geometry repair, tolerance change, simplification, source/default edits or collision/physical certification. Original DAT closure is archival; insertion uses freshly checked derived STL.',
  conversion:{sourceUnits:'ldu',sourceUpAxis:'-Y',unitAssumption:'LDraw uses -Y up and nominal 0.4 millimetres per LDU, per https://ldraw.org/article/218.html. This is the documented nominal display conversion, not physical calibration or a manufacturing tolerance. Original source coordinates and placement retained.',toMillimetresZUp:[.4,0,0,0,0,0,-.4,0,0,.4,0,0,0,0,0,1]},
  quality:screening.quality,measurements:{triangles:screening.triangles,boundsMm:screening.boundsMm,signedVolumeMm3:screening.signedVolumeMm3,analyticVolumeMm3:expected},diagnostics:screening.diagnostics};
 const manifest={format:'brickwright-local-fixture-library',version:1,collection:'selected-ldraw-authored-parts',capturedOn:'2026-11-15',pathBase:'library/',selection:{count:1,authoredModels:1,fixtures:0},reproduction:{command:'node scripts/generate-ldraw-editor-library.mjs --check',generator:{path:'../scripts/generate-ldraw-editor-library.mjs',sha256:sha(await readFile(fileURLToPath(import.meta.url)))},converter:{path:'../scripts/lib/ldraw-model.mjs',sha256:sha(await readFile(new URL('scripts/lib/ldraw-model.mjs',root)))},packageLockSha256:sha(await readFile(new URL('package-lock.json',root))),manifoldWasmSha256:sha(wasm)},assets:[asset]};
 createLocalModelLibraryCatalogue(manifest);return new Map([[meshPath,mesh],['ldraw-editor-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n')]]);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const write=process.argv.includes('--write');if(!write&&!process.argv.includes('--check'))throw Error('Use --write or --check.');
 for(const[path,bytes]of await generateLDrawEditorLibrary()){const target=new URL('library/'+path,root);if(write){await mkdir(new URL('./',target),{recursive:true});let old;try{old=await readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}if(path.endsWith('.stl')&&old&&!old.equals(bytes))throw Error('Preserve historical derivative: '+path);await writeFile(target,bytes);}else if(!(await readFile(target)).equals(bytes))throw Error('LDraw reproduction differs: '+path);}
 console.log('1 exact authored LDraw part, complete CC-BY-4.0 closure and strict STL quality reproduced.');
}
