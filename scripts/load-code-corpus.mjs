// SPDX-License-Identifier: BSD-3-Clause
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
/** Read local manifests only. Original HTTPS URLs are resolved through the
 * adjacent archived seed-files map, never fetched by this test runner. */
export async function loadCodeCorpus(path){
 const absolute=resolve(path),base=dirname(absolute),manifest=JSON.parse(await readFile(absolute,'utf8'));
 if(Array.isArray(manifest.models))return manifest.models.map(item=>({...item,file:resolve(base,item.file)}));
 if(!Array.isArray(manifest.assets))throw Error('Expected a code corpus or local asset manifest');
 let files;try{files=JSON.parse(await readFile(resolve(base,'seed-files.json'),'utf8')).files;}catch(error){if(error.code!=='ENOENT')throw error;files=[];}
 const result=[];
 for(const asset of manifest.assets){const original=asset.original,format=original?.format==='cad-script'?'cadcode':original?.format;if(!['openscad','jscad','cadcode'].includes(format))continue;const mapped=original.path??files.find(file=>file.url===original.url)?.localPath;if(!mapped)throw Error(`No archived local source for ${asset.id}`);result.push({id:asset.id,file:resolve(base,mapped),format,sha256:original.sha256,license:asset.licence?.spdx,entryPoint:asset.entryPoint,arguments:asset.arguments});}
 return result;
}
