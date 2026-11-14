// SPDX-License-Identifier: BSD-3-Clause
// Exactly three reviewed local roots; originals remain independent, never flattened on disk.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCadSession,createLocalModelLibraryCatalogue,getOpenSCADImportWarnings,importOpenSCADBundle} from '../packages/core/dist/index.js';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '../packages/geometry/dist/index.js';
const root=new URL('../',import.meta.url);
const repositoryId='ridercz--A2D',repositoryUrl='https://github.com/ridercz/A2D',commit='4ad48205fefd841a468b7916521596f09383add9';
const dependencyHash='aeed0958f859a675236d186753f54d5ceb45d823dab2b7077f935e82f227b516';
const evidenceHash='cefd2cb74a87f6cd6a31d7afeb3337f4e32849eaa487101e6006edd6f89f5421';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(`${JSON.stringify(value,null,2)}\n`);
const read=path=>readFile(new URL(`library/${path}`,root));
const file=(path,bytes)=>({path,sha256:hash(bytes),bytes:bytes.length});
export const a2dEditorSelection=[
 {id:'corpus-a2d-grill-square',name:'GrillSquare',title:'A2D square grill',sourceSha256:'c91720016f60ba9d343e4625a3212fe3ab1e5668395aee56fdf0d7452510c99b',meshSha256:'9866b1c4ec3312bf5d21218837850531f5600de825638bbb6f7c431417079c94'},
 {id:'corpus-a2d-point-generators',name:'PointGenerators',title:'A2D corner hole plate',sourceSha256:'5f4103ddc2fbab12be80258ef10b75aed85f4b293677322b9191e54005e0c424',meshSha256:'0310fc106c49e0d52c1eff029988ad5eda6cde5578fd06c7ecd8192ecabdbf5e'},
 {id:'corpus-a2d-grill-circle',name:'GrillCircle',title:'A2D circular fan grill',sourceSha256:'f1c6e12d4269e5af6f8f2a54b3f366441ce6a54f8c86d6758b9eea8e1f4d3f37',meshSha256:'2e4fe957ca95bc2722febcc76da5a05313e9876d9e45d3c45ada44c782dd1652' },
];
export async function generateA2DEditorLibrary(){
 const corpus=JSON.parse((await read('corpus/manifest.json')).toString());
 const repository=corpus.repositories.find(r=>r.id===repositoryId);
 if(!repository||repository.url!==repositoryUrl||repository.commit!==commit||repository.license!=='MIT')throw Error('Review required: A2D repository identity changed.');
 const checked=async(path,expected)=>{
  const record=repository.files.find(f=>f.path===path),bytes=await read(`corpus/repos/${repositoryId}/${path}`);
  if(!record||record.sha256!==expected||hash(bytes)!==expected||record.size_bytes!==bytes.length||record.spdx!=='MIT'||record.commit!==commit||record.dependency_blockers?.length||!record.license_evidence.includes('LICENSE'))throw Error('Review required: A2D source/evidence changed: '+path);
  return {record,bytes};
 };
 const evidence=await checked('LICENSE',evidenceHash),dependency=await checked('A2D.scad',dependencyHash);
 const evidencePath='evidence/a2d-MIT-LICENSE.txt',dependencyPath='sources/a2d/A2D.scad';
 const outputs=new Map([[evidencePath,evidence.bytes],[dependencyPath,dependency.bytes]]);
 const canonicalGrant=(record,review='exact two-root include closure and default-model screening 2026-11-14')=>({spdx:'MIT',scope:'asset',attribution:`${record.author_attribution}. Source: ${record.source_url}. ${evidence.bytes.toString('utf8').replace(/\s+/g,' ').trim()}`,
  evidenceUrl:evidence.record.source_url,capturedOn:repository.captured_at,review:'accepted',reviewer:`${repository.reviewed_by}; ${review}`});
 const wasm=await readFile(new URL('node_modules/manifold-3d/manifold.wasm',root));
 const kernel=await createGeometryKernel({wasmBinary:wasm});
 const assets=[];
 for(const selection of a2dEditorSelection){
  const upstreamPath=`Samples/${selection.name}.scad`,original=await checked(upstreamPath,selection.sourceSha256);
  const sourcePath=`sources/a2d/Samples/${selection.name}.scad`,meshPath=`meshes/a2d/${selection.name}.stl`;
  const imported=await importOpenSCADBundle({version:1,rootPath:upstreamPath,files:[
   {path:upstreamPath,source:original.bytes.toString('utf8'),sha256:selection.sourceSha256},
   {path:'A2D.scad',source:dependency.bytes.toString('utf8'),sha256:dependencyHash},
  ]});
  const session=createCadSession();let mesh;
  try{session.addCode(imported.program,selection.title);const evaluated=kernel.evaluate(session.state.document);if(!evaluated.bodies.length||!(evaluated.volume>0))throw Error('A2D default model has no positive solid: '+selection.name);mesh=Buffer.from(exportSTL(evaluated.bodies));}finally{session.dispose();}
  if(hash(mesh)!==selection.meshSha256)throw Error('Final runtime changed the cold-qualified mesh; review required: '+selection.name);
  const screening=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-14',toMillimetresZUp:identity,maxTriangles:10000,maxExtentMm:200});
  if(!screening.quality||Object.values(screening.checks).some(c=>c!=='pass'))throw Error('A2D mesh qualification failed: '+selection.name);
  outputs.set(sourcePath,original.bytes);outputs.set(meshPath,mesh);
  assets.push({id:selection.id,title:selection.title,author:original.record.author_attribution,version:commit,
   sourceRevision:{repositoryUrl,commit,sourceUrl:original.record.source_url},
   corpusSelection:{repositoryId,upstreamPath,archivedPath:`corpus/repos/${repositoryId}/${upstreamPath}`,sha256:selection.sourceSha256},
   licence:{...canonicalGrant(original.record,selection.name==='GrillCircle'?'cycle21 exact GrillCircle include closure and default-model screening 2026-11-14':undefined),localEvidence:[{...file(evidencePath,evidence.bytes),url:evidence.record.source_url}]},
   original:{...file(sourcePath,original.bytes),url:original.record.source_url,format:'openscad'},
   sourceBundle:{format:'brickwright-openscad-bundle',version:1,rootPath:upstreamPath,dependencies:[{
    path:'A2D.scad',file:{...file(dependencyPath,dependency.bytes),format:'openscad'},author:dependency.record.author_attribution,
    sourceUrl:dependency.record.source_url,sourceRevision:{repositoryUrl,commit},licence:canonicalGrant(dependency.record),
   }]},
   derivatives:[{...file(meshPath,mesh),format:'stl'}],
   modificationNotes:'Exact root and dependency bytes retained independently. Includes are expanded only in memory by the bounded virtual-file importer; no flattened upstream source is invented. The authored default root and its existing extrusion are retained without parameter, frame, fragment or placement overrides, repair or simplification. Qualification covers this default root only, not every A2D helper or alternate configuration, manufacturing or physics. Archived assertion-message text does not indicate an assertion failure. Import warnings captured at qualification: '+(getOpenSCADImportWarnings(imported.program).join(' ')||'None.'),
   conversion:{sourceUnits:'mm',sourceUpAxis:'Z',unitAssumption:'The sample has no explicit unit declaration. Curator assumes millimetres and Z up; authored coordinates are preserved without placement changes.',toMillimetresZUp:identity},
   bundleProvenance:imported.provenance,
   quality:screening.quality,measurements:{triangles:screening.triangles,boundsMm:screening.boundsMm,signedVolumeMm3:screening.signedVolumeMm3},diagnostics:screening.diagnostics,
  });
 }
 const manifest={format:'brickwright-local-fixture-library',version:1,collection:'selected-a2d-source-bundles',capturedOn:'2026-11-14',pathBase:'library/',
  reproduction:{command:'node scripts/generate-a2d-editor-library.mjs --check',generator:{path:'../scripts/generate-a2d-editor-library.mjs',sha256:hash(await readFile(fileURLToPath(import.meta.url)))},packageLockSha256:hash(await readFile(new URL('package-lock.json',root))),manifoldWasmSha256:hash(wasm)},
  selection:{repositoryId,commit,count:assets.length,runtimeChecked:assets.length,complete:true},assets};
 createLocalModelLibraryCatalogue(manifest);
 outputs.set('a2d-editor-manifest.json',json(manifest));return outputs;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const write=process.argv.includes('--write');if(!write&&!process.argv.includes('--check'))throw Error('Use --write or --check.');
 const outputs=await generateA2DEditorLibrary();
 if(write)for(const[path,expected]of outputs){if(!path.startsWith('meshes/'))continue;let current;try{current=await read(path);}catch(error){if(error.code!=='ENOENT')throw error;}if(current&&!current.equals(expected))throw Error('Preserve existing mesh and select a new derivative path: '+path);}
 for(const[path,expected]of outputs){const target=new URL(`library/${path}`,root);if(write){await mkdir(dirname(fileURLToPath(target)),{recursive:true});await writeFile(target,expected);}else if(!(await read(path)).equals(expected))throw Error('A2D output differs: '+path);}
 console.log('3 authored A2D roots reproduced with independent dependency originals; 3 pass all STL screens.');
}
