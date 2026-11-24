// SPDX-License-Identifier: BSD-3-Clause
import type {ModelLibraryAsset} from '@brickwright/cad-core';
export function bundledLibraryFiles(sources:Record<string,string>,meshes:Record<string,string>){
 const readers=new Map<string,()=>Uint8Array>();
 const encoder=new TextEncoder();
 for(const [path,text] of Object.entries(sources)){
  const index=path.indexOf('/sources/');if(index<0)throw new Error('Unexpected bundled source path');
  readers.set(path.slice(index+1),()=>encoder.encode(text));
 }
 for(const [path,dataUrl] of Object.entries(meshes)){
  const index=path.indexOf('/meshes/');if(index<0)throw new Error('Unexpected bundled mesh path');
  readers.set(path.slice(index+1),()=>{
   const encoded=/^data:[^,]*;base64,(.*)$/.exec(dataUrl)?.[1];
   if(!encoded)throw new Error('Expected an inline bundled library mesh.');
   const binary=atob(encoded),bytes=new Uint8Array(binary.length);
   for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
   return bytes;
  });
 }
 return {
  has:(path:string)=>readers.has(path),
  get:(path:string)=>readers.get(path)?.(),
  materialize:()=>new Map([...readers].map(([path,read])=>[path,read()] as const)),
 };
}
export function bundledSourceFiles(sources:Record<string,string>):Map<string,Uint8Array>{
 return bundledLibraryFiles(sources,{}).materialize();
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
