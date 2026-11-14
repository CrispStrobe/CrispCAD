// SPDX-License-Identifier: BSD-3-Clause
// Four already archived MIT upstream examples/fixtures. No download or source edits.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCadSession,createLocalModelLibraryCatalogue,importOpenSCAD,importJSCAD,getOpenSCADImportWarnings} from '../packages/core/dist/index.js';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '../packages/geometry/dist/index.js';
const root=new URL('../',import.meta.url),repositoryUrl='https://github.com/jscad/OpenJSCAD.org',commit='720f3688312ed3bad1702fe83906be153b8ab8fc';
const evidenceHash='bf0a7136796ab8f4573a7a77783d7dfebca4d35a595f0ad160d70a855d4c0cbb';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const file=(path,bytes)=>({path,sha256:hash(bytes),bytes:bytes.length});
export const jscadEditorSelection=[
 {name:'basicBooleans',format:'jscad',title:'JSCAD basic Boolean demonstration',author:'Simon Clark',sourceSha256:'e269dbe7fa16fb1c80bef0cdd6ba4f94796e8cd1d3b87932b396e215343c0ec6',meshSha256:'862081b025f843a8fa6766dbe09e0b35a6258414abbbc4af66d41db9e5d0e32d'},
 {name:'translateEx1',format:'openscad',title:'JSCAD translated cube fixture',author:'JSCAD Organization',sourceSha256:'a26aac3cc37c24dea98f8403f5b90547eb9903debf5dde77eedf914b6abd77c3',meshSha256:'a5098549ef128f3bcf8ddda352916267d189c52ef06608f289ac0ee2a40ceb6d'},
 {name:'scaleEx1',format:'openscad',title:'JSCAD scaled cube fixture',author:'JSCAD Organization',sourceSha256:'0e9d3c5265754a7f88c778d6e1e08aced81491de32d37933bf30beadd3ffb96b',meshSha256:'5343e9bbeab8099bd9b36ac79965611126dd04b144cd8f6005264a82517dec42'},
 {name:'rotateEx1',format:'openscad',title:'JSCAD rotated cube fixture',author:'JSCAD Organization',sourceSha256:'b724d6d863a23ec1dca57725416ee6bf7d29ab6c87ea99e61ea79114d96430da',meshSha256:'b4985de55af3308b0b8b5d3083b78001b54c8059cdd949905dc629244f76779f'},
];
export async function generateJSCADLibrary(){
 const archived=JSON.parse(await readFile(new URL('tests/fixtures/code-corpus/manifest.json',root),'utf8'));
 const evidence=await readFile(new URL('tests/fixtures/code-corpus/jscad/LICENSE',root)),existingEvidence=await readFile(new URL('library/evidence/jscad-LICENSE.txt',root));
 if(hash(evidence)!==evidenceHash||!evidence.equals(existingEvidence))throw Error('JSCAD grant evidence changed; review required.');
 const wasm=await readFile(new URL('node_modules/manifold-3d/manifold.wasm',root)),kernel=await createGeometryKernel({wasmBinary:wasm});
 const outputs=new Map(),assets=[];
 for(const selection of jscadEditorSelection){
  const record=archived.models.find(item=>item.id==='jscad-'+selection.name);
  if(!record||record.repository!=='jscad/OpenJSCAD.org'||record.revision!==commit||record.license!=='MIT'||record.licenseFile!=='jscad/LICENSE'||record.sha256!==selection.sourceSha256||record.entryPoint||record.arguments||record.parameters)throw Error('Authored default identity changed: '+selection.name);
  const bytes=await readFile(new URL('tests/fixtures/code-corpus/'+record.file,root));if(hash(bytes)!==selection.sourceSha256)throw Error('Original bytes changed: '+selection.name);
  const sourcePath=`sources/jscad-reviewed/${selection.name}.${selection.format==='jscad'?'js':'scad'}`,meshPath=`meshes/jscad-reviewed/${selection.name}.stl`;
  const imported=selection.format==='jscad'?importJSCAD(bytes.toString('utf8')):undefined,program=imported?.program??importOpenSCAD(bytes.toString('utf8'));
  const session=createCadSession();let mesh;try{session.addCode(program,selection.title);const geometry=kernel.evaluate(session.state.document);if(!(geometry.volume>0))throw Error('No positive solid: '+selection.name);mesh=Buffer.from(exportSTL(geometry.bodies));}finally{session.dispose();}
  const screening=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-14',maxTriangles:10000,maxExtentMm:200,toMillimetresZUp:identity});if(!screening.quality||Object.values(screening.checks).some(v=>v!=='pass'))throw Error('Strict STL refusal: '+selection.name);
  if(selection.meshSha256&&hash(mesh)!==selection.meshSha256)throw Error('Cold-qualified mesh changed: '+selection.name);
  outputs.set(sourcePath,bytes);outputs.set(meshPath,mesh);
  const sourceUrl=`https://raw.githubusercontent.com/jscad/OpenJSCAD.org/${commit}/${record.path}`;
  assets.push({id:'corpus-jscad-'+selection.name.toLowerCase(),title:selection.title,author:selection.author,version:commit,
   sourceRevision:{repositoryUrl,commit,sourceUrl},
   archiveSelection:{manifest:'../tests/fixtures/code-corpus/manifest.json',upstreamPath:record.path,archivedPath:'../tests/fixtures/code-corpus/'+record.file,sha256:selection.sourceSha256,kind:selection.format==='jscad'?'upstream example':'upstream transformation test fixture'},
   licence:{spdx:'MIT',scope:'asset',attribution:`${selection.author}. Source: ${sourceUrl}. ${evidence.toString('utf8').replace(/\s+/g,' ').trim()}`,evidenceUrl:`https://raw.githubusercontent.com/jscad/OpenJSCAD.org/${commit}/LICENSE`,localEvidence:[{...file('evidence/jscad-LICENSE.txt',evidence),url:`https://raw.githubusercontent.com/jscad/OpenJSCAD.org/${commit}/LICENSE`}],capturedOn:archived.captured,review:'accepted',reviewer:'Codex exact four-file authored example/fixture source and MIT grant review 2026-11-14'},
   original:{...file(sourcePath,bytes),url:sourceUrl,format:selection.format},derivatives:[{...file(meshPath,mesh),format:'stl'}],
   modificationNotes:'Byte-identical already archived upstream '+(selection.format==='jscad'?'example':'transformation test fixture')+'. Authored default main/root, original coordinates and transforms retained without source, argument, entrypoint, frame or fragment overrides. '+(selection.format==='jscad'?'Existing original bounded JSCAD interpreter combines the five authored outputs into one editable native body; imported snapshot and colour losses are disclosed. ':'Existing bounded OpenSCAD importer retains the authored cube and transformation. ')+'No compiler/runtime change, model repair, simplification or placement adjustment. Not certified for manufacturing or physics. Import warnings: '+((imported?.warnings??getOpenSCADImportWarnings(program)).join(' ')||'None.'),
   conversion:{sourceUnits:'mm',sourceUpAxis:'Z',unitAssumption:'The source has no explicit physical units. Curator interprets model units as millimetres and Z up; original coordinates are preserved.',toMillimetresZUp:identity},
   quality:screening.quality,measurements:{triangles:screening.triangles,boundsMm:screening.boundsMm,signedVolumeMm3:screening.signedVolumeMm3},diagnostics:screening.diagnostics,
  });
 }
 const manifest={format:'brickwright-local-fixture-library',version:1,collection:'selected-jscad-examples-and-transform-fixtures',capturedOn:'2026-11-14',pathBase:'library/',selection:{repositoryUrl,commit,count:assets.length,runtimeChecked:assets.length,complete:true},reproduction:{command:'node scripts/generate-jscad-editor-library.mjs --check',generator:{path:'../scripts/generate-jscad-editor-library.mjs',sha256:hash(await readFile(fileURLToPath(import.meta.url)))},packageLockSha256:hash(await readFile(new URL('package-lock.json',root))),manifoldWasmSha256:hash(wasm)},assets};
 createLocalModelLibraryCatalogue(manifest);outputs.set('jscad-editor-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));return outputs;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const write=process.argv.includes('--write');if(!write&&!process.argv.includes('--check'))throw Error('Use --write or --check.');const outputs=await generateJSCADLibrary();
 for(const[path,bytes]of outputs){const target=new URL('library/'+path,root);if(write){let old;try{old=await readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}if(path.startsWith('meshes/')&&old&&!old.equals(bytes))throw Error('Preserve existing derivative path: '+path);await mkdir(dirname(fileURLToPath(target)),{recursive:true});await writeFile(target,bytes);}else if(!(await readFile(target)).equals(bytes))throw Error('Reproduction differs: '+path);}
 console.log('4 exact authored JSCAD example/fixture roots pass strict STL screens.');
}
