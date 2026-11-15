// SPDX-License-Identifier: BSD-3-Clause
// Original CPU projection of actual evaluated sources. No network or model edits.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {chromium} from '@playwright/test';
import {createCadSession,createLocalModelLibraryCatalogue,importOpenSCAD,importOpenSCADBundle,importJSCAD} from '../packages/core/dist/index.js';
import {createGeometryKernel,insertModelLibrarySTL} from '../packages/geometry/dist/index.js';
export function parsePreviewArguments(args) {
 const assetIds=[];let corpusOnly=false;
 for(let i=0;i<args.length;i++) {
  if(args[i]==='--corpus-only')corpusOnly=true;
  else if(args[i]==='--asset-id') {
   const id=args[++i];
   if(typeof id!=='string'||!id.trim()||id.startsWith('--'))throw Error('--asset-id requires an asset ID.');
   assetIds.push(id);
  } else throw Error('Unknown preview argument: '+args[i]);
 }
 return {corpusOnly,assetIds};
}
export function selectPreviewAssets(assets,assetIds) {
 const ids=new Set(assetIds);
 for(const id of ids)if(!assets.some(asset=>asset.id===id))throw Error('Unknown preview asset ID: '+id);
 return ids.size?assets.filter(asset=>ids.has(asset.id)):assets;
}
async function main() {
const {corpusOnly,assetIds}=parsePreviewArguments(process.argv.slice(2));
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const corpusAssets=[...createLocalModelLibraryCatalogue(await json('library/editor-corpus-manifest.json')).assets,...createLocalModelLibraryCatalogue(await json('library/a2d-editor-manifest.json')).assets,...createLocalModelLibraryCatalogue(await json('library/scon-editor-manifest.json')).assets,...createLocalModelLibraryCatalogue(await json('library/jscad-editor-manifest.json')).assets,...createLocalModelLibraryCatalogue(await json('library/ldraw-editor-manifest.json')).assets,...createLocalModelLibraryCatalogue(await json('library/ldraw-reviewed-batch-manifest.json')).assets];
const candidates=corpusOnly?corpusAssets:[...createLocalModelLibraryCatalogue(await json('library/examples-manifest.json')).assets,...createLocalModelLibraryCatalogue(await json('library/fixtures-manifest.json')).assets,...createLocalModelLibraryCatalogue(await json('library/supported-models-manifest.json')).assets,(await json('library/seed-catalogue.json')).assets.find(a=>a.id==='jscad-involute-gear'),...corpusAssets];
const assets=selectPreviewAssets(candidates,assetIds);
const kernel=await createGeometryKernel({wasmBinary:await readFile('node_modules/manifold-3d/manifold.wasm')});
const eye=new THREE.Vector3(1,-1.5,1.15).normalize(),right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,0,1),eye).normalize(),up=new THREE.Vector3().crossVectors(eye,right).normalize(),light=new THREE.Vector3(-.4,-.6,1).normalize();
const previews=corpusOnly||assetIds.length?(await json('library/previews.json')).previews:{};
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
try{
for(const asset of assets){
 const file=asset.original,path=file.path??(asset.id==='jscad-involute-gear'?'sources/jscad/gear.js':undefined);if(!path)throw Error(asset.id);
 const bytes=await readFile('library/'+path);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Source hash mismatch: '+path);
 const source=bytes.toString('utf8');let program;
 if(asset.sourceBundle && file.format==='openscad'){
  if(bytes.length!==file.bytes)throw Error('Source byte size mismatch: '+path);
  const dependencies=await Promise.all(asset.sourceBundle.dependencies.map(async dependency=>{
   const original=dependency.file,content=await readFile('library/'+original.path);
   if(content.length!==original.bytes||createHash('sha256').update(content).digest('hex')!==original.sha256)throw Error('Dependency hash or byte size mismatch: '+original.path);
   return {path:dependency.path,source:content.toString('utf8'),sha256:original.sha256};
  }));
  program=(await importOpenSCADBundle({version:1,rootPath:asset.sourceBundle.rootPath,files:[{path:asset.sourceBundle.rootPath,source,sha256:file.sha256},...dependencies]})).program;
 }else if(file.format!=='ldraw')program=file.format==='jscad'?importJSCAD(source).program:file.format==='openscad'?importOpenSCAD(source):{version:1,language:'brickwright-cad-script',source,parameters:{}};
 const session=createCadSession();
 try{if(file.format==='ldraw'){
  const derivative=asset.derivatives[0],mesh=await readFile('library/'+derivative.path);
  await insertModelLibrarySTL(session,{format:'brickwright-model-library',version:1,assets:[asset]},{assetId:asset.id,file:{derivative:0}},mesh,{evaluate:kernel.evaluate,toMillimetresZUp:asset.quality.screeningPolicy.toMillimetresZUp,checkedOn:'2026-11-15',modificationNotes:'Preview of exact freshly screened LDraw derivative; no model edits.'});
 }else session.addCode(program);
 const {bodies}=kernel.evaluate(session.state.document);
 const box=new THREE.Box3();for(const body of bodies)box.union(new THREE.Box3(new THREE.Vector3(...body.bounds.min),new THREE.Vector3(...body.bounds.max)));
 const center=box.getCenter(new THREE.Vector3()),extent=box.getSize(new THREE.Vector3()),scale=160/Math.max(1,extent.length()),triangles=[];
 for(const body of bodies)for(let i=0;i<body.indices.length;i+=3){const p=[0,1,2].map(j=>new THREE.Vector3().fromArray(body.positions,body.indices[i+j]*3).sub(center)),normal=new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]),p[2].clone().sub(p[0])).normalize();if(normal.dot(eye)<=0)continue;const brightness=.52+.48*Math.max(0,normal.dot(light)),color=new THREE.Color('#86cbd4').multiplyScalar(brightness).getStyle();triangles.push({depth:p.reduce((sum,v)=>sum+v.dot(eye),0)/3,path:p.map((v,j)=>`${j?'L':'M'}${(110+v.dot(right)*scale).toFixed(2)},${(90-v.dot(up)*scale).toFixed(2)}`).join('')+'Z',color});}
 triangles.sort((a,b)=>a.depth-b.depth);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 180">${triangles.map(t=>`<path d="${t.path}" fill="${t.color}" stroke="${t.color}" stroke-width=".45"/>`).join('')}</svg>`;
 previews[file.sha256]=await page.evaluate(async svg=>{const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();const canvas=document.createElement('canvas');canvas.width=220;canvas.height=180;canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png');},svg);
 }finally{session.dispose();}
}
}finally{await browser.close();}
await writeFile('library/previews.json',JSON.stringify({version:1,previews})+'\n');console.log(`Rendered ${assets.length} source previews.`);

}
if(process.argv[1]===fileURLToPath(import.meta.url))await main();
