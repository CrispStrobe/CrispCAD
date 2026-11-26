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
import metro from './electronics-assets/metro-mini.json' with {type:'json'};
import buck from './electronics-assets/buck-5v.json' with {type:'json'};
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
 * A 26 x 18 mm PCB outline with illustrative pads and component placement. */
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
 'visual-dual-hbridge':[26,18,8],
 'visual-metro-mini':[45,18,6],
 'visual-buck-5v':[11,18,4],
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
  geometry=preset==='visual-feather-rp2040'?assemble(feather.parts):preset==='visual-aa-holder-830'?assemble(holder.parts,'#252c36'):preset==='visual-metro-mini'?assemble(metro.parts):preset==='visual-buck-5v'?assemble(buck.parts):driver();
 }else if(node.kind==='box'&&['visual-power-source','visual-servo-bus','visual-encoder','visual-dc-drive'].includes(preset)){
  geometry=equipmentHousing(node,preset);
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

/** Original functional equipment housings; no vendor likeness or calibrated rating. */
function equipmentHousing(node:Extract<SolidNode,{kind:'box'}>,preset:string){
 const pieces:T.BufferGeometry[]=[];const [w,d,h]=node.size;
 const box=(x:number,y:number,z:number,a:number,b:number,c:number,colour:string)=>pieces.push(coloured(new T.BoxGeometry(a,b,c).toNonIndexed().translate(x,y,z),new T.Color(colour)));
 if(preset==='visual-power-source'){
  box(0,0,0,w,d,h,'#303f50');box(0,0,h/2+.15,w-2,d-2,.3,'#536479');
  box(0,0,h/2+.4,w*.48,d*.45,.3,'#182b39');
  for(const x of [-w*.24,w*.24]){box(x,-d/2-1,h*.15,4,2,4,x<0?'#e65a53':'#1d2631');box(x,-d/2-2,h*.15,2,1,2,'#c7b67d');}
  box(w*.34,d*.3,h/2+1,4,3,2,'#222d38');box(-w*.34,d*.3,h/2+.7,2,2,1,'#65c99a');
  for(let i=0;i<5;i++)box(-w*.22+i*w*.11,d*.15,h/2+.6,1.2,d*.3,.4,'#192c3c');
 }else if(preset==='visual-dc-drive'){
  box(0,8,1.6,14,8,26,'#364a5c');
  pieces.push(coloured(new T.CylinderGeometry(5,5,18,20).toNonIndexed().translate(0,-3,-10.5),new T.Color('#b7c2c9')));
  pieces.push(coloured(new T.CylinderGeometry(1.1,1.1,8,16).toNonIndexed().translate(0,16,1.6),new T.Color('#d6dce0')));
  for(const x of [-2.5,2.5])box(x,-12,-10.5,1.2,1,2,'#d5b76d');
 }else if(preset==='visual-servo-bus'){
  box(0,0,-h/2+.7,w,d,1.4,'#285773');
  for(let i=0;i<Math.floor(w/2.54);i++)for(let j=0;j<3;j++)box(-w/2+1.27+i*2.54,(j-1)*2.54,.8,.65,.65,3.2,['#263341','#e9bd67','#f4ce4b'][j]);
 }else{
  // Pickup PCB and emitter/detector pair in the outer 6 mm; any deeper
  // envelope is its printed mounting block behind the PCB.
  const p=Math.min(h,6),o=(h-p)/2;
  if(h>p)box(0,0,-p/2,w,d,h-p,'#536b80');
  box(0,0,o-p/2+.7,w,d,1.4,'#255b80');
  for(const x of [-2.5,2.5])pieces.push(coloured(new T.CylinderGeometry(1.8,1.8,p-1.4,12).toNonIndexed().rotateX(Math.PI/2).translate(x,0,o+.7),new T.Color(x<0?'#eeeece':'#172333')));
  for(let i=0;i<4;i++)box(-3.81+i*2.54,d/2-1,o,.64,.64,3,'#dec17d');
 }
 try{return mergeGeometries(pieces)!;}finally{pieces.forEach(p=>p.dispose());}
}
