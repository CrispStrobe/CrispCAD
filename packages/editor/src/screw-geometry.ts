// SPDX-License-Identifier: BSD-3-Clause
// Original generic fastener geometry. These are editable forms, not a named
// ISO/DIN fastener or a substitute for manufacturing/thread fit tolerances.
import * as T from 'three';
import {screwTipParameters,t} from '@brickwright/cad-core';
import type {GeneratorRecipe} from '@brickwright/cad-core';
import type {Construction} from './advanced-shapes.js';
type Ridge=(radius:number,lead:number,turns:number,clearance:number,depth:number,hand:number,phase:number,pitch:number,angle?:number,taper?:(z:number)=>number,overlap?:number)=>T.BufferGeometry;
const yToZ=new T.Matrix4().set(1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1);
const lathe=(p:number[][],segments=64)=>new T.LatheGeometry(p.map(([r,z])=>new T.Vector2(r,z)),segments).applyMatrix4(yToZ);
const box=(x:number,y:number,z:number,cz:number)=>new T.BoxGeometry(x,y,z).translate(0,0,cz);
const cylinder=(r:number,h:number,z:number,n=64)=>new T.CylinderGeometry(r,r,h,n).applyMatrix4(yToZ).translate(0,0,z);
export function screwGeometry(recipe:GeneratorRecipe,ridge:Ridge,preview=false):Construction{
 const p=recipe.values,r=p.diameter/2,R=r+p.threadDepth,style=recipe.headStyle!,drive=recipe.driveStyle!;
 // Validate a new generation here: older authored meshes/recipes remain loadable.
 if(style==='headless'&&drive!=='none'&&p.slotWidth>=p.diameter*.7)throw new Error(t('Drive depth or thread flank angle leaves insufficient material'));
 const headR=style==='headless'?R:style==='hex'?p.headDiameter/Math.sqrt(3):p.headDiameter/2;
 const h=style==='headless'?0:style==='countersunk'?(headR-R)/Math.tan(recipe.headAngle!*Math.PI/360):p.headHeight;
 const tip=screwTipParameters(recipe),L=p.length,z=-L;
 const plain=['cone','dog','oval'].includes(tip.style),bodyLength=plain?L-tip.length:L;
 const taper=(q:number)=>Math.max(.001,Math.min(1,(L-q)/tip.length));
 const add:T.BufferGeometry[]=[],cuts:T.BufferGeometry[]=[],clip:T.BufferGeometry[]=[];
 // The core and the helical ridge use the same tapered frame. Positive overlap
 // at every root keeps a pointed thread attached, including its lead-in.
 if(tip.style==='gimlet')add.push(lathe([[0,z],[r*.001,z],[r,z+tip.length],[r,0],[0,0],[0,z]]));
 else if(tip.style==='chamfer'){const end=Math.min(r,tip.diameter/2),shoulder=z+tip.length*(r-tip.diameter/2)/(R-tip.diameter/2);add.push(lathe([[0,z],[end,z],[r,Math.max(z,shoulder)],[r,0],[0,0],[0,z]]));}
 else add.push(cylinder(r,bodyLength,-bodyLength/2));
 for(let i=0;i<p.starts;i++){
  const g=ridge(r,p.pitch*p.starts,bodyLength/(p.pitch*p.starts),0,p.threadDepth,p.hand,i*2*Math.PI/p.starts,p.pitch,recipe.threadAngle,tip.style==='gimlet'?taper:undefined,recipe.rootOverlap??.3);
  if(preview){const a=g.getAttribute('position');for(let j=0;j<a.count;j++){const q=Math.max(0,Math.min(bodyLength,a.getZ(j))),radius=Math.hypot(a.getX(j),a.getY(j)),limit=tip.style==='gimlet'?R*taper(q):tip.style==='chamfer'?tip.diameter/2+(R-tip.diameter/2)*Math.min(1,(L-q)/tip.length):R,scale=radius>limit?limit/radius:1;a.setXYZ(j,a.getX(j)*scale,a.getY(j)*scale,q);}}
  add.push(g.scale(1,-1,-1));
 }
 if(style!=='headless'){
  const bevel=Math.min(h*.12,headR*.06);
  if(style==='countersunk')add.push(lathe([[0,0],[R,0],[headR,h],[0,h],[0,0]]));
  else if(style==='pan')add.push(lathe([[0,0],[headR,0],...Array.from({length:25},(_,i)=>{const a=i*Math.PI/48;return[i===24?0:headR*Math.cos(a),h*(.3+.7*Math.sin(a))];}),[0,0]]));
  else add.push(lathe([[0,0],[headR-bevel,0],[headR,bevel],[headR,h-bevel],[headR-bevel,h],[0,h],[0,0]],style==='hex'?6:64));
 }
 // Clip the complete ridge at the nominal end, rather than leaving the last
 // triangular half-profile beyond the core. The head remains above Z=0.
 const envelope:number[][]=[[0,z]];
 if(tip.style==='gimlet')envelope.push([R*.001,z],[R,z+tip.length]);
 else if(tip.style==='chamfer')envelope.push([tip.diameter/2,z],[R,z+tip.length]);
 else if(tip.style==='dog')envelope.push([tip.diameter/2,z],[tip.diameter/2,z+tip.length],[R,z+tip.length]);
 else if(tip.style==='cone')envelope.push([0,z],[R,z+tip.length]);
 else if(tip.style==='oval')envelope.push(...Array.from({length:25},(_,i)=>{const a=i*Math.PI/48;return[R*Math.sin(a),z+tip.length*(1-Math.cos(a))];}));
 else envelope.push([R,z]);
 envelope.push([R,0],[Math.max(headR,R)+1,0],[Math.max(headR,R)+1,h],[0,h],[0,z]);
 clip.push(lathe(envelope));
 // Plain points are positive material, not loose conical decorations. A small
 // overlap under the core makes the shoulder robust to a Boolean round-trip.
 if(plain){const top=z+tip.length+.01;
  if(tip.style==='dog')add.push(cylinder(tip.diameter/2,tip.length+.01,z+(tip.length+.01)/2));
  else if(tip.style==='cone')add.push(lathe([[0,z],[R,z+tip.length],[R,top],[0,top],[0,z]]));
  else add.push(lathe([[0,z],...Array.from({length:24},(_,i)=>{const a=(i+1)*Math.PI/48;return[R*Math.sin(a),z+tip.length*(1-Math.cos(a))];}),[R,top],[0,top],[0,z]]));
 }
 if(drive!=='none'){
  const depth=recipe.driveDepth!,center=h-depth/2+.1,driveD=style==='headless'?p.diameter:p.headDiameter;
  if(drive==='slot')cuts.push(box(p.slotWidth,driveD+2,depth+.2,center));
  if(drive==='cross')cuts.push(box(p.slotWidth,driveD*.65,depth+.2,center),box(driveD*.65,p.slotWidth,depth+.2,center));
  if(drive==='hex')cuts.push(cylinder(p.slotWidth/Math.sqrt(3),depth+.2,center,6));
 }
 // Cup is an end recess in a fully threaded shank, not an unthreaded cylinder
 // appended below a shortened thread. The aperture and depth stay independent.
 if(tip.style==='cup')cuts.push(lathe([[0,z-.1],[tip.diameter/2,z-.1],[tip.diameter/2,z],[0,z+tip.depth],[0,z-.1]]));
 if(recipe.orientation==='legacy')for(const g of [...add,...clip,...cuts])g.scale(1,-1,-1);
 return {add,clip,...(cuts.length?{cut:cuts}:{})};
}
