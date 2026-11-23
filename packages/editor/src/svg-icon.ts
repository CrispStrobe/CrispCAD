// SPDX-License-Identifier: BSD-3-Clause
import * as T from 'three';
import {SVGLoader} from 'three/addons/loaders/SVGLoader.js';
const gradientTags=new Set(['linearGradient','radialGradient']);
const unsafeReference=(value:string)=>/url\s*\(/i.test(value);
const localPaint=/^url\(\s*(?:"(#.*)"|'(#.*)'|(#[^()'"\s]+))\s*\)$/i;

/** Parse a local, bounded SVG without inserting its nodes into the live document. */
export function localSvg(source:string,allowed:ReadonlySet<string>,flattenGradients=false):XMLDocument{
 if(new TextEncoder().encode(source).length>65536||/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error('SVG exceeds 64 KiB or contains unsupported XML declarations');
 const parsed=new DOMParser().parseFromString(source,'image/svg+xml');if(parsed.querySelector('parsererror')||parsed.documentElement.localName!=='svg')throw new Error('Invalid SVG document');
 const elements=Array.from(parsed.querySelectorAll('*'));
 const ids=new Map<string,Element|null>();
 for(const node of elements){
  const id=node.getAttribute('id');
  if(id)ids.set(id,ids.has(id)?null:node);
 }
 const gradients=new Set(flattenGradients?elements.filter(node=>gradientTags.has(node.localName)&&node.parentElement?.localName==='defs'):[]);
 const rejectReference=()=>{throw new Error('SVG external references and event attributes are not supported');};
 const neutralPaint=(value:string)=>{
  if(!unsafeReference(value))return value;
  const match=localPaint.exec(value.trim()),ref=match&&(match[1]??match[2]??match[3]);
  const definition=ref?ids.get(ref.slice(1)):undefined;
  if(!definition||!gradients.has(definition))return rejectReference();
  return '#000000';
 };
 for(const node of elements){
  const gradient=gradients.has(node),stop=node.localName==='stop'&&node.parentElement!==null&&gradients.has(node.parentElement);
  if(!allowed.has(node.localName)&&!gradient&&!stop)throw new Error(`SVG element ${node.localName} is not supported. Use filled paths.`);
  for(const attr of Array.from(node.attributes)){
   if(/^on/i.test(attr.name))rejectReference();
   if(/href$/i.test(attr.name)){
    const definition=attr.value.startsWith('#')?ids.get(attr.value.slice(1)):undefined;
    if(!gradient||!definition||!gradients.has(definition))rejectReference();
    continue;
   }
   if(!unsafeReference(attr.value))continue;
   if(flattenGradients&&(attr.name==='fill'||attr.name==='stroke')){
    attr.value=neutralPaint(attr.value);
   }else if(flattenGradients&&attr.name==='style'){
    attr.value=attr.value.split(';').map(declaration=>{
     if(!unsafeReference(declaration))return declaration;
     const colon=declaration.indexOf(':'),property=declaration.slice(0,colon).trim();
     if(colon<0||(property!=='fill'&&property!=='stroke'))return rejectReference();
     return `${property}: ${neutralPaint(declaration.slice(colon+1))}`;
    }).join(';');
   }else rejectReference();
  }
 }
 for(const node of gradients)node.remove();
 return parsed;
}
/** Filled, local SVG geometry only. */
export function iconGeometry(source:string):T.BufferGeometry[]{
 const parsed=localSvg(source,new Set(['svg','g','path','rect','circle','ellipse','polygon','polyline','defs']));
 const paths=new SVGLoader().parse(new XMLSerializer().serializeToString(parsed)).paths;
 const shapes=paths.filter(p=>p.userData?.style?.fill!=='none').flatMap(path=>SVGLoader.createShapes(path));if(!shapes.length||shapes.length>100)throw new Error('SVG must contain 1–100 filled shapes');
 const geometries=shapes.map(s=>new T.ExtrudeGeometry(s,{depth:2,bevelEnabled:false,curveSegments:16}));const bounds=new T.Box3();for(const g of geometries){g.computeBoundingBox();bounds.union(g.boundingBox!);}const center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()),scale=28/Math.max(size.x,size.y);if(!Number.isFinite(scale)||scale<=0){geometries.forEach(g=>g.dispose());throw new Error('SVG has no finite area');}
 for(const g of geometries){g.translate(-center.x,-center.y,0);g.scale(scale,-scale,1);const index=g.index;if(index){for(let i=0;i<index.count;i+=3){const a=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,a);}}else{const p=g.getAttribute('position');for(let i=0;i<p.count;i+=3){const a=new T.Vector3().fromBufferAttribute(p,i+1),b=new T.Vector3().fromBufferAttribute(p,i+2);p.setXYZ(i+1,b.x,b.y,b.z);p.setXYZ(i+2,a.x,a.y,a.z);}}g.translate(0,0,1.4);}
 return geometries;
}
