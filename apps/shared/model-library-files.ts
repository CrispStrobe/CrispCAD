// SPDX-License-Identifier: BSD-3-Clause
import type {ModelLibraryAsset} from '@brickwright/cad-core';
export function bundledSourceFiles(sources:Record<string,string>):Map<string,Uint8Array>{
 const files=new Map<string,Uint8Array>();
 for(const [path,text] of Object.entries(sources)){
  const index=path.indexOf('/sources/');if(index<0)throw new Error('Unexpected bundled source path');
  files.set(path.slice(index+1),new TextEncoder().encode(text));
 }
 return files;
}
export function bundledAssetLicenceTexts(assets:readonly ModelLibraryAsset[],documents:Record<string,string>):Map<string,string>{
 const notices=new Map<string,string>();
 for(const [path,text] of Object.entries(documents)){
  const index=path.indexOf('/evidence/');if(index<0)throw new Error('Unexpected bundled licence path');
  notices.set(path.slice(index+1),text);
 }
 const byAsset=new Map<string,string>();
 for(const asset of assets){
  const declared=(asset.licence as unknown as {localEvidence?:unknown}).localEvidence;
  const references=Array.isArray(declared)?declared:declared&&typeof declared==='object'?[declared]:[];
  if(!references.length)continue;
  const texts=references.map(reference=>{
   if(!reference||typeof reference!=='object'||typeof reference.path!=='string')throw new Error('Invalid bundled licence reference: '+asset.id);
   const text=notices.get(reference.path);
   if(text===undefined||typeof reference.bytes==='number'&&new TextEncoder().encode(text).length!==reference.bytes)throw new Error('Missing or changed bundled licence evidence: '+asset.id);
   return text;
  });
  byAsset.set(asset.id,texts.join('\n\n'));
 }
 return byAsset;
}
