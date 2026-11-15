// SPDX-License-Identifier: BSD-3-Clause
// Reproduce the exact reviewed authored batch offline; no source repair or substitutions.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCadSession,createLocalModelLibraryCatalogue} from '../packages/core/dist/index.js';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '../packages/geometry/dist/index.js';
import {convertLDrawBundle} from './lib/ldraw-model.mjs';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
export async function generateReviewedLDrawBatch(){
 const specBytes=await readFile(new URL('library/ldraw-reviewed-batch-spec.json',root)),spec=JSON.parse(specBytes),assets=[],outputs=new Map(),wasm=await readFile(new URL('node_modules/manifold-3d/manifold.wasm',root)),kernel=await createGeometryKernel({wasmBinary:wasm});
 for(const entry of spec.roots){
  const files=await Promise.all(entry.files.map(async f=>{const bytes=await readFile(new URL('library/sources/ldraw/'+f.path,root));if(bytes.length!==f.bytes||sha(bytes)!==f.sha256||!bytes.toString('utf8').includes('0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt'))throw Error('Source/grant identity mismatch: '+f.path);return{path:f.path,bytes};}));
  for(const f of entry.asset.licence.localEvidence){const b=await readFile(new URL('library/'+f.path,root));if(b.length!==f.bytes||sha(b)!==f.sha256)throw Error('Licence evidence identity mismatch.');}
  const c=convertLDrawBundle({rootPath:entry.rootPath,files}),s=createCadSession();let mesh;
  try{s.addCode(c.program,entry.asset.title);mesh=Buffer.from(exportSTL(kernel.evaluate(s.state.document).bodies));}finally{s.dispose();}
  if(sha(mesh)!==entry.expectedMeshSha256)throw Error('Qualified derivative changed: '+entry.rootPath);
  const policy=entry.asset.quality.screeningPolicy,screen=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-15',maxTriangles:policy.maxTriangles,maxExtentMm:policy.maxExtentMm,toMillimetresZUp:policy.toMillimetresZUp});if(!screen.quality||Object.values(screen.checks).some(v=>v!=='pass'))throw Error('Fresh topology refusal: '+entry.rootPath);
  const asset={...entry.asset,measurements:{triangles:screen.triangles,boundsMm:screen.boundsMm,signedVolumeMm3:screen.signedVolumeMm3},converterMetrics:c.metrics};assets.push(asset);outputs.set(asset.derivatives[0].path,mesh);
 }
 const manifest={format:'brickwright-local-fixture-library',version:1,collection:'reviewed-ldraw-authored-batch',capturedOn:'2026-11-15',pathBase:'library/',selection:{count:assets.length,authoredModels:assets.length,fixtures:0},reproduction:{command:'node scripts/generate-ldraw-reviewed-batch.mjs --check',specSha256:sha(specBytes),generator:{path:'../scripts/generate-ldraw-reviewed-batch.mjs',sha256:sha(await readFile(fileURLToPath(import.meta.url)))},converter:{path:'../scripts/lib/ldraw-model.mjs',sha256:sha(await readFile(new URL('scripts/lib/ldraw-model.mjs',root)))},packageLockSha256:sha(await readFile(new URL('package-lock.json',root))),manifoldWasmSha256:sha(wasm)},assets};createLocalModelLibraryCatalogue(manifest);outputs.set('ldraw-reviewed-batch-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));return outputs;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const write=process.argv.includes('--write');if(!write&&!process.argv.includes('--check'))throw Error('Use --write or --check.');
 for(const[path,bytes]of await generateReviewedLDrawBatch()){const target=new URL('library/'+path,root);if(write){await mkdir(new URL('./',target),{recursive:true});let old;try{old=await readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}if(path.endsWith('.stl')&&old&&!old.equals(bytes))throw Error('Preserve historical derivative: '+path);await writeFile(target,bytes);}else if(!(await readFile(target)).equals(bytes))throw Error('Batch reproduction differs: '+path);}
 console.log('Exact authored batch source/mesh/quality reproduced.');
}
