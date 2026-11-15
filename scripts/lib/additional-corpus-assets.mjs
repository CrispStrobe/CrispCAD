// SPDX-License-Identifier: BSD-3-Clause
// Explicit reviewed source selections use the existing importer and quality policy.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createCadSession,createLocalModelLibraryCatalogue,importOpenSCADBundle} from '../../packages/core/dist/index.js';
import {exportSTL,checkModelLibrarySTL} from '../../packages/geometry/dist/index.js';
const root=new URL('../../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const read=path=>readFile(new URL('library/'+path,root));
export async function readAdditionalCorpusSpec(){
 const bytes=await read('corpus-additional-spec.json'),spec=JSON.parse(bytes);
 if(spec.version!==1||!Array.isArray(spec.assets))throw Error('Invalid reviewed additional source selection');
 createLocalModelLibraryCatalogue({format:'brickwright-local-fixture-library',version:1,pathBase:'library/',assets:spec.assets.map(row=>row.asset)});
 return {bytes,spec};
}
export async function generateAdditionalCorpusAssets({spec,kernel,outputs,assetId,previous}){
 const corpus=JSON.parse(await read('corpus/manifest.json')),assets=[];
 for(const selected of spec.assets){
  const asset=selected.asset,choice=asset.corpusSelection,repo=corpus.repositories.find(r=>r.id===choice.repositoryId),record=repo?.files.find(f=>f.path===choice.upstreamPath),grant=repo?.files.find(f=>f.path===selected.sourceLicencePath);
  if(!repo||repo.url!==asset.sourceRevision.repositoryUrl||repo.commit!==asset.sourceRevision.commit||record?.sha256!==asset.original.sha256||record.spdx!==asset.licence.spdx||record.dependency_blockers?.length||grant?.sha256!==selected.sourceLicenceSha256)throw Error('Reviewed additional source or grant changed: '+asset.id);
  if(choice.archivedPath!=='corpus/repos/'+repo.id+'/'+record.path||asset.sourceRevision.sourceUrl!==record.source_url||asset.original.url!==record.source_url||asset.version!==repo.commit||asset.licence.evidenceUrl!==grant.source_url)throw Error('Additional source provenance changed: '+asset.id);
  const source=await read(choice.archivedPath),licence=await read('corpus/repos/'+repo.id+'/'+selected.sourceLicencePath);
  if(source.length!==asset.original.bytes||sha(source)!==asset.original.sha256||licence.length!==grant.size_bytes||sha(licence)!==selected.sourceLicenceSha256)throw Error('Additional source/notice byte identity changed: '+asset.id);
  const localGrant=asset.licence.localEvidence[0];if(localGrant.sha256!==sha(licence)||localGrant.bytes!==licence.length)throw Error('Additional local grant mismatch: '+asset.id);
  if(assetId&&assetId!==asset.id){
   const old=previous?.assets.find(a=>a.id===asset.id);if(!old||JSON.stringify(old)!==JSON.stringify(asset)||!(await read(old.original.path)).equals(source))throw Error('Historical additional asset changed: '+asset.id);
   for(const file of old.derivatives){const bytes=await read(file.path);if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('Historical additional derivative changed: '+asset.id);}assets.push(old);continue;
  }
  const imported=await importOpenSCADBundle({version:1,rootPath:choice.upstreamPath,files:[{path:choice.upstreamPath,source:source.toString('utf8'),sha256:asset.original.sha256}]});
  if(sha(imported.program.source)!==selected.expectedProgramSha256)throw Error('Additional imported programme changed; new qualification required: '+asset.id);
  const session=createCadSession();let mesh;
  try{session.addCode(imported.program,choice.upstreamPath);const geometry=kernel.evaluate(session.state.document);if(!(geometry.volume>0))throw Error('Additional source has no positive solid');mesh=Buffer.from(exportSTL(geometry.bodies));}finally{session.dispose();}
  const derivative=asset.derivatives[0];if(mesh.length!==derivative.bytes||sha(mesh)!==derivative.sha256)throw Error('Additional derivative changed; preserve original and qualify a new version: '+asset.id);
  const screened=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-15',toMillimetresZUp:asset.conversion.toMillimetresZUp,maxTriangles:10000,maxExtentMm:200});
  if(!screened.quality||Object.values(screened.checks).some(v=>v!=='pass')||JSON.stringify(screened.quality)!==JSON.stringify(asset.quality))throw Error('Additional source strict STL quality changed: '+asset.id);
  outputs.set(asset.original.path,source);outputs.set(derivative.path,mesh);outputs.set(localGrant.path,licence);assets.push(asset);
 }
 return assets;
}
