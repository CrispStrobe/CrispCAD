// SPDX-License-Identifier: BSD-3-Clause
// STEP mesh derivatives: Copyright (c) 2016 Adafruit Industries, MIT.
// Display geometry only: never passed to collision qualification or mass computation.
import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {SolidNode} from '@brickwright/cad-core';
import {surfaceGeometry} from './surface-geometry.js';
import {transformMatrix} from './transform-selection.js';
import feather from './electronics-assets/feather-rp2040.json' with {type:'json'};
import holder from './electronics-assets/aa-holder-830.json' with {type:'json'};
import yellow from './motor-assets/tt-gearmotor.json' with {type:'json'};
import dc from './motor-assets/dc-toy-motor.json' with {type:'json'};
import servo from './motor-assets/micro-servo-1143.json' with {type:'json'};

type Part={positions:number[];indices:number[];color?:number[]};
function coloured(geometry:T.BufferGeometry,colour:T.Color){
 const colors=new Float32Array(geometry.getAttribute('position').count*3);
 for(let i=0;i<colors.length;i+=3){colors[i]=colour.r;colors[i+1]=colour.g;colors[i+2]=colour.b;}
 geometry.setAttribute('color',new T.BufferAttribute(colors,3));return geometry;
}
function assemble(parts:Part[],fallback='#374151'){
 const pieces=parts.map(p=>coloured(surfaceGeometry(new Float32Array(p.positions),new Uint32Array(p.indices)),p.color?new T.Color(...p.color as [number,number,number]):new T.Color(fallback)));
 try{return mergeGeometries(pieces)!;}finally{pieces.forEach(p=>p.dispose());}
}
/** An original illustrative DRV8833-style breakout, not vendor PCB artwork.
 * Actual through holes and a 26 x 18 mm PCB outline; component placement is illustrative. */
function driver(){
 const pieces:T.BufferGeometry[]=[];
 const box=(x:number,y:number,z:number,w:number,d:number,h:number,c:string)=>pieces.push(coloured(new T.BoxGeometry(w,d,h).toNonIndexed().translate(x,y,z),new T.Color(c)));
 box(0,0,-3.2,26,18,1.6,'#143f63');
 box(0,0,-1.9,4.5,5,.9,'#202a34');
 for(const x of [-2.7,2.7])for(let i=0;i<8;i++)box(x,-2.1+i*.6,-2.1,.65,.25,.25,'#c1c8cd');
 for(const x of [-6,6])for(const y of [-2.5,1,4.5])box(x,y,-2,1.8,1,.75,'#bca683');
 for(const y of [-6.35,6.35])for(let i=0;i<8;i++){
  const x=-8.89+i*2.54;
  // Annular pads leave their drill visible instead of a solid gold dot.
  pieces.push(coloured(new T.RingGeometry(.5,.9,12).toNonIndexed().translate(x,y,-2.38),new T.Color('#cfab42')));
  // Header pin and insulating strip sit above the board, in its clearance volume.
  box(x,y,-.45,.64,.64,3.8,'#c6ae64');
 }
 for(const y of [-6.35,6.35])box(0,y,-1.3,20.5,2.2,1.8,'#252c36');
 try{return mergeGeometries(pieces)!;}finally{pieces.forEach(p=>p.dispose());}
}
const sizes:Record<string,number[]>={
 'visual-feather-rp2040':[22.86,50.8,8],
 'visual-aa-holder-830':[66.1,72.4,21.6],
 'visual-drv8833':[26,18,8],
};
/** Explicit preset opt-in, with a shape guard. Editing its collider dimensions
 * returns to the plain editable geometry, rather than showing an obsolete part.
 * Transforms, selection, dragging and simulation use the same owning body ID. */
export function componentAppearance(node:SolidNode,nodes:Record<string,SolidNode>={}):T.BufferGeometry|undefined{
 const preset=node.physics?.sourcePreset;
 if(!preset)return;
 let geometry:T.BufferGeometry|undefined;
 if(sizes[preset]){
  if(node.kind!=='box'||node.size.some((v,i)=>Math.abs(v-sizes[preset][i])>1e-8))return;
  geometry=preset==='visual-feather-rp2040'?assemble(feather.parts):preset==='visual-aa-holder-830'?assemble(holder.parts,'#252c36'):driver();
 }else if(node.kind==='boolean'&&node.operation==='union'){
  // Explicit motor case roots only; the independently articulated shaft remains
  // the existing source mesh. Individual STEP solids retain distinct materials.
  const model=preset==='tt-gearmotor'?yellow:preset==='dc-toy-motor'?dc:preset==='micro-servo-1143'?servo:undefined;
  if(!model||!node.id.endsWith('casing'))return;
  const prefix=node.id.slice(0,-'casing'.length);
  const indices=model.parts.map((_,i)=>i).filter(i=>i!==model.shaft);
  if(node.inputs.length!==indices.length||indices.some((i,j)=>{
   const id=prefix+'case-'+i,child=nodes[id],part=model.parts[i];
   return node.inputs[j]!==id||child?.kind!=='mesh'||child.transform.position.some(v=>v!==0)||child.transform.rotation.some(v=>v!==0)||child.transform.scale.some(v=>v!==1)||child.positions.length!==part.positions.length||child.indices.length!==part.indices.length||child.positions.some((v,k)=>v!==part.positions[k])||child.indices.some((v,k)=>v!==part.indices[k]);
  }))return;
  const palette=preset==='tt-gearmotor'?['#f4cc28','#dedfe1','#aab5bd','#232c32','#c1c8cd','#f4cc28','#bf9a52','#bf9a52']:preset==='dc-toy-motor'?['#b5c1c8','#303a44','#d2bd78']:['#253e69','#ddbb59','#b9bdc5','#d7b663'];
  const parts=model.parts.flatMap((p,i)=>i===model.shaft?[]:[{...p,color:new T.Color(palette[i]??node.color).toArray()}]);
  geometry=assemble(parts);
 }
 return geometry?.applyMatrix4(transformMatrix(node.transform));
}
