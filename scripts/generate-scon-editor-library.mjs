// SPDX-License-Identifier: BSD-3-Clause
// Exactly five reviewed local roots; originals remain independent, never flattened on disk.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCadSession,createLocalModelLibraryCatalogue,getOpenSCADImportWarnings,importOpenSCADBundle} from '../packages/core/dist/index.js';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '../packages/geometry/dist/index.js';
const root=new URL('../',import.meta.url);
const repositoryId='wmacevoy--openscad-scon',repositoryUrl='https://github.com/wmacevoy/openscad-scon',commit='c954e07bf0faf571d8eccc259d47e61938666cef';
const dependencyHash='ee43fabc0729b37a0ab736ac6fa668eef7458b0f2f2b0287e4bf95eba40c4040';
const evidenceHash='306253c7d0f088f7d06a580450aedca0ecc91e88d2d97491eafdd68117497a58';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(`${JSON.stringify(value,null,2)}\n`);
const read=path=>readFile(new URL(`library/${path}`,root));
const file=(path,bytes)=>({path,sha256:hash(bytes),bytes:bytes.length});
export const sconEditorSelection=[
 {
  "id": "corpus-scon-ex1",
  "name": "ex1",
  "title": "SCON configured sphere",
  "sourceSha256": "789200891e04fcd20a9b216adde28c54c7fddf3ad8e5b3d4c10173a96bad5686",
  "meshSha256": "20b6b6cd8233a18062a7dc4cbfdf2c5742b791039ec04c06f1b18e04c9497d9a"
 },
 {
  "id": "corpus-scon-ex2",
  "name": "ex2",
  "title": "SCON nested shape configuration",
  "sourceSha256": "d5e1cc34d67fda3524fdd88c26bbdecf338d3dad8d012d1c127570f7571114b0",
  "meshSha256": "cb972f26a73bc6539cae5a9a302cf8fc1d98436ae05354c0832f97373e99730d"
 },
 {
  "id": "corpus-scon-ex3",
  "name": "ex3",
  "title": "SCON inherited shape configuration",
  "sourceSha256": "7e2ea0f5ec9907a476b2db5030580f3cba30402d02428140c1517f3b950868c5",
  "meshSha256": "aee0dbfb248f5ab4c7da98ae8284b6f7d0b197695937dd36ebbff6d01b4d551f"
 },
 {
  "id": "corpus-scon-ex4",
  "name": "ex4",
  "title": "SCON configuration factories",
  "sourceSha256": "09282461aab2db14ca3e6140155ca3b481b89d257584a8bd578a8c0f864ce271",
  "meshSha256": "7e40fe219349e54fdb8224a6300d1fba46d009b5138789ba34786f111e27fbc9"
 },
 {
  "id": "corpus-scon-tldr",
  "name": "tldr",
  "title": "SCON nested defaults",
  "sourceSha256": "9ee049e3b62af2232bfb2f9eefa9a7f19edb05ab42506271bdb64d58f5a44f9a",
  "meshSha256": "de15cc31c7c09ac618379ec7524c9262a87e2148c15e052091e8dcbab573e534"
 }
];
export async function generateSCONEditorLibrary(){
 const corpus=JSON.parse((await read('corpus/manifest.json')).toString());
 const repository=corpus.repositories.find(r=>r.id===repositoryId);
 if(!repository||repository.url!==repositoryUrl||repository.commit!==commit||repository.license!=='MIT')throw Error('Review required: SCON repository identity changed.');
 const checked=async(path,expected)=>{
  const record=repository.files.find(f=>f.path===path),bytes=await read(`corpus/repos/${repositoryId}/${path}`);
  if(!record||record.sha256!==expected||hash(bytes)!==expected||record.size_bytes!==bytes.length||record.spdx!=='MIT'||record.commit!==commit||record.dependency_blockers?.length||!record.license_evidence.includes('LICENSE'))throw Error('Review required: SCON source/evidence changed: '+path);
  return {record,bytes};
 };
 const evidence=await checked('LICENSE',evidenceHash),dependency=await checked('scon.scad',dependencyHash);
 const evidencePath='evidence/scon-MIT-LICENSE.txt',dependencyPath='sources/scon/scon.scad';
 const outputs=new Map([[evidencePath,evidence.bytes],[dependencyPath,dependency.bytes]]);
 const canonicalGrant=record=>({spdx:'MIT',scope:'asset',attribution:`${record.author_attribution}. Source: ${record.source_url}. ${evidence.bytes.toString('utf8').replace(/\s+/g,' ').trim()}`,
  evidenceUrl:evidence.record.source_url,capturedOn:repository.captured_at,review:'accepted',reviewer:`${repository.reviewed_by}; exact five-root include closure and default-model screening 2026-11-14`});
 const wasm=await readFile(new URL('node_modules/manifold-3d/manifold.wasm',root));
 const kernel=await createGeometryKernel({wasmBinary:wasm});
 const assets=[];
 for(const selection of sconEditorSelection){
  const upstreamPath=`examples/${selection.name}.scad`,original=await checked(upstreamPath,selection.sourceSha256);
  const sourcePath=`sources/scon/examples/${selection.name}.scad`,meshPath=`meshes/scon/${selection.name}.stl`;
  const imported=await importOpenSCADBundle({version:1,rootPath:upstreamPath,files:[
   {path:upstreamPath,source:original.bytes.toString('utf8'),sha256:selection.sourceSha256},
   {path:'scon.scad',source:dependency.bytes.toString('utf8'),sha256:dependencyHash},
  ]});
  const session=createCadSession();let mesh;
  try{session.addCode(imported.program,selection.title);const evaluated=kernel.evaluate(session.state.document);if(!evaluated.bodies.length||!(evaluated.volume>0))throw Error('SCON default model has no positive solid: '+selection.name);mesh=Buffer.from(exportSTL(evaluated.bodies));}finally{session.dispose();}
  if(hash(mesh)!==selection.meshSha256)throw Error('Final runtime changed the cold-qualified mesh; review required: '+selection.name);
  const screening=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-14',toMillimetresZUp:identity,maxTriangles:10000,maxExtentMm:200});
  if(!screening.quality||Object.values(screening.checks).some(c=>c!=='pass'))throw Error('SCON mesh qualification failed: '+selection.name);
  outputs.set(sourcePath,original.bytes);outputs.set(meshPath,mesh);
  assets.push({id:selection.id,title:selection.title,author:original.record.author_attribution,version:commit,
   sourceRevision:{repositoryUrl,commit,sourceUrl:original.record.source_url},
   corpusSelection:{repositoryId,upstreamPath,archivedPath:`corpus/repos/${repositoryId}/${upstreamPath}`,sha256:selection.sourceSha256},
   licence:{...canonicalGrant(original.record),localEvidence:[{...file(evidencePath,evidence.bytes),url:evidence.record.source_url}]},
   original:{...file(sourcePath,original.bytes),url:original.record.source_url,format:'openscad'},
   sourceBundle:{format:'brickwright-openscad-bundle',version:1,rootPath:upstreamPath,dependencies:[{
    path:'scon.scad',file:{...file(dependencyPath,dependency.bytes),format:'openscad'},author:dependency.record.author_attribution,
    sourceUrl:dependency.record.source_url,sourceRevision:{repositoryUrl,commit},licence:canonicalGrant(dependency.record),
   }]},
   derivatives:[{...file(meshPath,mesh),format:'stl'}],
   modificationNotes:'Exact root and dependency bytes retained independently. Includes are expanded only in memory by the bounded virtual-file importer; no flattened upstream source is invented. The authored default root and its shape configuration are retained without parameter, frame, fragment or placement overrides, repair or simplification. Qualification covers this default root only, not every SCON helper or alternate configuration, manufacturing or physics. Archived assertion-message text does not indicate an assertion failure. Import warnings captured at qualification: '+(getOpenSCADImportWarnings(imported.program).join(' ')||'None.'),
   conversion:{sourceUnits:'mm',sourceUpAxis:'Z',unitAssumption:'The sample has no explicit unit declaration. Curator assumes millimetres and Z up; authored coordinates are preserved without placement changes.',toMillimetresZUp:identity},
   bundleProvenance:imported.provenance,
   quality:screening.quality,measurements:{triangles:screening.triangles,boundsMm:screening.boundsMm,signedVolumeMm3:screening.signedVolumeMm3},diagnostics:screening.diagnostics,
  });
 }
 const manifest={format:'brickwright-local-fixture-library',version:1,collection:'selected-scon-source-bundles',capturedOn:'2026-11-14',pathBase:'library/',
  reproduction:{command:'node scripts/generate-scon-editor-library.mjs --check',generator:{path:'../scripts/generate-scon-editor-library.mjs',sha256:hash(await readFile(fileURLToPath(import.meta.url)))},packageLockSha256:hash(await readFile(new URL('package-lock.json',root))),manifoldWasmSha256:hash(wasm)},
  selection:{repositoryId,commit,count:assets.length,runtimeChecked:assets.length,complete:true},assets};
 createLocalModelLibraryCatalogue(manifest);
 outputs.set('scon-editor-manifest.json',json(manifest));return outputs;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const write=process.argv.includes('--write');if(!write&&!process.argv.includes('--check'))throw Error('Use --write or --check.');
 const outputs=await generateSCONEditorLibrary();
 if(write)for(const[path,expected]of outputs){if(!path.startsWith('meshes/'))continue;let current;try{current=await read(path);}catch(error){if(error.code!=='ENOENT')throw error;}if(current&&!current.equals(expected))throw Error('Preserve existing mesh and select a new derivative path: '+path);}
 for(const[path,expected]of outputs){const target=new URL(`library/${path}`,root);if(write){await mkdir(dirname(fileURLToPath(target)),{recursive:true});await writeFile(target,expected);}else if(!(await read(path)).equals(expected))throw Error('SCON output differs: '+path);}
 console.log('5 authored SCON roots reproduced with independent dependency originals; 5 pass all STL screens.');
}
