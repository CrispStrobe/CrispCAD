import { t } from '@brickwright/cad-core';
// SPDX-License-Identifier: BSD-3-Clause
// Independently authored constructions from geometric definitions, not Layerling source.
import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {bentExtrusion} from './bent-extrusion.js';
import {fontLettering,roundedPlate} from './lettering.js';
import {iconGeometry} from './svg-icon.js';
import qrcode from 'qrcode-generator';
import { createDocument, identityTransform, newId, defaultPartPhysics,defaultGenerator,checkGenerator,screwTipParameters } from '@brickwright/cad-core';
import type {GeneratorRecipe} from '@brickwright/cad-core';
import type { CadDocument, SolidNode, Vec3 } from '@brickwright/cad-core';
export const advancedCatalog = [
 ['loft','Loft','Hollow & tapered','A square base transitioning to a circular top.','transition rectangle circle loft','#c79c71'],
 ['bent-tube','Bent tube','Hollow & tapered','A hollow quarter-circle pipe.','elbow pipe hollow','#d39c66'],
 ['counterbore','Counterbore','Cutting tools','A stepped cutter for a recessed screw head.','hole bolt recess','#8baaba'],
 ['countersink','Countersink','Cutting tools','A cutter with a conical head recess.','hole screw recess','#87b6a7'],
 ['teardrop','Teardrop hole','Cutting tools','An upright pointed arch cutter.','hole printable arch','#a595c6'],
 ['port','Port opening','Cutting tools','An extruded slot with rounded ends.','slot capsule hole','#89b1c9'],
 ['thread','Thread','Fasteners & joints','A helical triangular thread on a cylindrical core.','helix external pitch','#9faebc'],
 ['screw','Screw','Fasteners & joints','A threaded shaft and cylindrical head.','bolt thread fastener','#b0b7c2'],
 ['nut','Nut','Fasteners & joints','A hexagonal nut with a matching helical bore.','hex thread fastener','#9eacb9'],
 ['finishing-washer','Finishing washer','Fasteners & joints','A washer with a conical screw seat.','cup countersink ring','#bac1c7'],
 ['hinge','Hinge','Fasteners & joints','Two separate leaves and a pin with assembly clearance.','joint pivot barrel articulation','#7bb7a3'],
 ['dovetail','Dovetail','Fasteners & joints','An extruded trapezoidal sliding key.','slide joint key','#c68a6b'],
 ['boss','Screw boss','Enclosure parts','A hollow screw support with four reinforcing ribs.','standoff rib enclosure','#b1a18a'],
 ['snap-fit','Snap-fit','Enclosure parts','A cantilever clip with a lead-in hook.','clip latch flexible','#78b7ae'],
 ['rib','Rib','Enclosure parts','A triangular reinforcing gusset.','brace support gusset','#90acbe'],
 ['spring','Spring','Mechanisms','A helical coil with a circular wire section.','coil elastic compression','#66c1af'],
 ['gear','Gear','Mechanisms','A 20-tooth involute spur gear, module 1.5 mm, pressure angle 20°.','spur involute teeth','#a0b8c5'],
 ['hirth','Hirth joint','Mechanisms','A radial face-serration coupling.','face teeth serration coupling','#9cb3c5'],
 ['gt2-pulley','GT2 pulley','Mechanisms','A 20-position, 2 mm pitch pulley blank with flanges. Verify belt fit before use.','timing belt teeth','#aab6c6'],
 ['grid-bin','Gridfinity bin','Project templates','A 1 × 1 nominal 42 mm grid storage bin. Verify mating fit before printing.','gridfinity 42 organizer box','#81b2c5'],
 ['sbc','SBC board','Project templates','A generic 85 × 56 mm board envelope with mounting holes.','board pcb computer template','#6ab895'],
 ['text','Text','Lettering & tags','Raised lettering using our original block alphabet.','letters words label','#e28e79'],
 ['name-tag','Name tag','Lettering & tags','Raised lettering on a tag with a hanging hole.','label letters keychain','#c5b8cd'],
 ['icon-tag','Icon tag','Lettering & tags','An original star icon raised on a round tag.','svg symbol badge star','#bcb7c8'],
 ['qr','QR code','Lettering & tags','A raised QR code with a four-module quiet zone. Use contrasting material for scanning.','qrcode url barcode','#92a5af'],
 ['star','Star','Decorative shapes','A five-point star extrusion.','outline badge','#dfba59'],
 ['heart','Heart','Decorative shapes','A heart-shaped extrusion.','outline love','#d98aab'],
 ['crescent','Crescent','Decorative shapes','A crescent moon extrusion.','moon outline','#d8c26b'],
 ['knurl','Knurl','Decorative shapes','A cylindrical grip with crossed helical ridges.','grip diamond texture','#a3b4c5'],
 ['ruler','Ruler','Reference helpers','A 100 mm reference ruler. Excluded from printable exports and physics.','measure scale helper','#dfce97'],
] as const;
const XY=(points:number[][])=>{const s=new T.Shape();s.moveTo(points[0][0],points[0][1]);for(const p of points.slice(1))s.lineTo(p[0],p[1]);s.closePath();return s;};
const extrude=(shape:T.Shape,height:number)=>new T.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,curveSegments:32});
const box=(x:number,y:number,z:number,at:Vec3=[0,0,0])=>new T.BoxGeometry(x,y,z).translate(...at);
const cylinder=(r:number,h:number,at:Vec3=[0,0,0],n=64,top=r)=>new T.CylinderGeometry(top,r,h,n).rotateX(Math.PI/2).translate(...at);
const lathe=(p:number[][],segments=64)=>{const g=new T.LatheGeometry(p.map(v=>new T.Vector2(v[0],v[1])),segments).rotateX(Math.PI/2);g.userData.collisionHint={kind:'radial-profile',segments,sides:p.length-1,layout:'rows',closed:true};return g;};
const ring=(outer:number,inner:number,h:number)=>lathe([[inner,0],[outer,0],[outer,h],[inner,h],[inner,0]]);
function annulus(outer:number,inner:number){const s=new T.Shape();s.absarc(0,0,outer,0,Math.PI*2,false);const hole=new T.Path();hole.absarc(0,0,inner,0,Math.PI*2,true);s.holes.push(hole);return s;}
function star(){return XY(Array.from({length:10},(_,i)=>{const a=i*Math.PI/5+Math.PI/2,r=i%2?7:16;return [r*Math.cos(a),r*Math.sin(a)];}));}
function gear(){
 const teeth=20,module=1.5,pressure=20*Math.PI/180, pitch=module*teeth/2,base=pitch*Math.cos(pressure),root=pitch-1.25*module,tip=pitch+module;
 const inv=(r:number)=>{const t=Math.sqrt(Math.max(0,(r/base)**2-1));return t-Math.atan(t);}; const half=Math.PI/(2*teeth)+inv(pitch),points:number[][]=[];
 for(let i=0;i<teeth;i++){const a=i*2*Math.PI/teeth;const add=(r:number,t:number)=>points.push([r*Math.cos(t),r*Math.sin(t)]);add(root,a-half);add(base,a-half);for(let j=1;j<=8;j++){const r=base+(tip-base)*j/8;add(r,a-half+inv(r));}for(let j=8;j>=0;j--){const r=base+(tip-base)*j/8;add(r,a+half-inv(r));}add(root,a+half);add(root,a+Math.PI/teeth);}
 const s=XY(points);const hole=new T.Path();hole.absarc(0,0,3,0,Math.PI*2,true);s.holes.push(hole);return extrude(s,6);
}
class Helix extends T.Curve<T.Vector3>{constructor(readonly radius:number,readonly height:number,readonly turns:number,readonly start=0){super();}getPoint(t:number,target=new T.Vector3()){const a=t*this.turns*Math.PI*2+this.start;return target.set(this.radius*Math.cos(a),this.radius*Math.sin(a),this.height*t);}}
function closedTube(curve:T.Curve<T.Vector3>,segments:number,radius:number,sides:number){
 const tube=new T.TubeGeometry(curve,segments,radius,sides,false);const positions=Array.from(tube.getAttribute('position').array),indices=Array.from(tube.index!.array);const start=positions.length/3;positions.push(...curve.getPoint(0).toArray(),...curve.getPoint(1).toArray());
 for(let j=0;j<sides;j++){indices.push(start,j,j+1);const end=segments*(sides+1);indices.push(start+1,end+j+1,end+j);}
 tube.dispose();let volume=0;for(let i=0;i<indices.length;i+=3){const a=new T.Vector3().fromArray(positions,indices[i]*3),b=new T.Vector3().fromArray(positions,indices[i+1]*3),c=new T.Vector3().fromArray(positions,indices[i+2]*3);volume+=a.dot(b.cross(c));}if(volume<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.userData.collisionHint={kind:'tube-grid',segments,sides,layout:'rows',closed:false,stride:1};return g;
}
function threadRidge(radius=5,pitch=2,turns=10,clearance=0,depth=1,hand=1,phase=0,spacing=pitch,flankAngle?:number,taper?:(z:number)=>number){
 const count=Math.ceil(turns*48),positions:number[]=[],indices:number[]=[];
 const halfWidth=flankAngle===undefined?spacing*.38:(depth+.3)*Math.tan(flankAngle*Math.PI/360);
 for(let i=0;i<=count;i++){const a=hand*i/count*turns*2*Math.PI+phase,z=i/count*turns*pitch;for(const [r,dz] of [[radius-.3,-halfWidth],[radius+depth+clearance,0],[radius-.3,halfWidth]])positions.push(r*(taper?.(z+dz)??1)*Math.cos(a),r*(taper?.(z+dz)??1)*Math.sin(a),z+dz);}
 for(let i=0;i<count;i++)for(let j=0;j<3;j++){const a=i*3+j,b=i*3+(j+1)%3,c=(i+1)*3+j,d=(i+1)*3+(j+1)%3;indices.push(a,b,c,b,d,c);}indices.push(0,2,1,count*3,count*3+1,count*3+2);
 let volume=0;for(let i=0;i<indices.length;i+=3){const a=new T.Vector3().fromArray(positions,indices[i]*3),b=new T.Vector3().fromArray(positions,indices[i+1]*3),c=new T.Vector3().fromArray(positions,indices[i+2]*3);volume+=a.dot(b.cross(c));}if(volume<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.userData.collisionHint={kind:'tube-grid',segments:count,sides:3,layout:'rows',closed:false,seam:false,stride:1};return g;
}
// Original 5×7 block alphabet, encoded directly here; no font assets or font software.
const alphabet:Record<string,string>={A:'01110/10001/10001/11111/10001/10001/10001',B:'11110/10001/10001/11110/10001/10001/11110',C:'01111/10000/10000/10000/10000/10000/01111',D:'11110/10001/10001/10001/10001/10001/11110',E:'11111/10000/10000/11110/10000/10000/11111',F:'11111/10000/10000/11110/10000/10000/10000',G:'01111/10000/10000/10111/10001/10001/01111',H:'10001/10001/10001/11111/10001/10001/10001',I:'11111/00100/00100/00100/00100/00100/11111',J:'00111/00010/00010/00010/10010/10010/01100',K:'10001/10010/10100/11000/10100/10010/10001',L:'10000/10000/10000/10000/10000/10000/11111',M:'10001/11011/10101/10101/10001/10001/10001',N:'10001/11001/10101/10011/10001/10001/10001',O:'01110/10001/10001/10001/10001/10001/01110',P:'11110/10001/10001/11110/10000/10000/10000',Q:'01110/10001/10001/10001/10101/10010/01101',R:'11110/10001/10001/11110/10100/10010/10001',S:'01111/10000/10000/01110/00001/00001/11110',T:'11111/00100/00100/00100/00100/00100/00100',U:'10001/10001/10001/10001/10001/10001/01110',V:'10001/10001/10001/10001/10001/01010/00100',W:'10001/10001/10001/10101/10101/11011/10001',X:'10001/10001/01010/00100/01010/10001/10001',Y:'10001/10001/01010/00100/00100/00100/00100',Z:'11111/00001/00010/00100/01000/10000/11111','0':'01110/10001/10011/10101/11001/10001/01110','1':'00100/01100/00100/00100/00100/00100/01110','2':'01110/10001/00001/00110/01000/10000/11111','3':'11110/00001/00001/01110/00001/00001/11110','4':'00010/00110/01010/10010/11111/00010/00010','5':'11111/10000/10000/11110/00001/00001/11110','6':'01110/10000/10000/11110/10001/10001/01110','7':'11111/00001/00010/00100/01000/01000/01000','8':'01110/10001/10001/01110/10001/10001/01110','9':'01110/10001/10001/01111/00001/00001/01110','-':'00000/00000/00000/11111/00000/00000/00000','.':'00000/00000/00000/00000/00000/00110/00110'};
function letters(text:string,z=0){const clean=text.trim().toUpperCase();if(!clean||clean.length>24||/[^A-Z0-9 .-]/.test(clean))throw new Error(t('Lettering supports 1–24 characters: A–Z, 0–9, spaces, dots and hyphens.'));const parts:T.BufferGeometry[]=[];for(let k=0;k<clean.length;k++){const pattern=alphabet[clean[k]];if(!pattern)continue;pattern.split('/').forEach((row,y)=>{let start=-1;for(let x=0;x<=5;x++){if(row[x]==='1'){if(start<0)start=x;}else if(start>=0){parts.push(box((x-start)*1.2,1.2,2,[k*7.2+(start+x-1)*.6, (6-y)*1.2,z+1]));start=-1;}}});}return parts;}
export interface Construction { add:T.BufferGeometry[]; cut?:T.BufferGeometry[]; after?:T.BufferGeometry[]; separate?:boolean; reference?:boolean }
export function advancedGeometry(id:string,text='ABC',preview=false,svg?:string,recipe?:GeneratorRecipe):Construction {
 const values=recipe?.values??defaultGenerator(id)?.values;
 if(['thread','screw','nut'].includes(id)&&values){const p=values,r=p.diameter/2,lead=p.pitch*p.starts;const ridges=()=>Array.from({length:p.starts},(_,i)=>threadRidge(r+(id==='nut'?p.clearance:0),lead,p.length/lead,id==='nut'?.15:0,p.threadDepth,p.hand,i*2*Math.PI/p.starts,p.pitch,recipe?.threadAngle));
  if(id==='thread')return {add:[cylinder(r,p.length,[0,0,p.length/2]),...ridges()]};
  if(id==='screw'&&recipe?.version===2){
   const style=recipe.headStyle!,drive=recipe.driveStyle!,headR=style==='headless'?r+p.threadDepth:style==='hex'?p.headDiameter/Math.sqrt(3):p.headDiameter/2,neck=r+p.threadDepth,h=style==='headless'?0:style==='countersunk'?(headR-neck)/Math.tan(recipe.headAngle!*Math.PI/360):p.headHeight;
   const head=style==='pan'?lathe([[0,0],[headR,0],...Array.from({length:17},(_,i)=>{const a=i*Math.PI/32;return [i===16?0:headR*Math.cos(a),h*(.3+.7*Math.sin(a))];}),[0,0]]):cylinder(style==='countersunk'?neck:headR,h,[0,0,h/2],style==='hex'?6:64,headR);
   const depth=recipe.driveDepth!,z=h-depth/2+.1,cuts:T.BufferGeometry[]=[];
   if(drive==='slot')cuts.push(box(p.slotWidth,p.headDiameter+2,depth+.2,[0,0,z]));
   if(drive==='cross')cuts.push(box(p.slotWidth,p.headDiameter*.65,depth+.2,[0,0,z]),box(p.headDiameter*.65,p.slotWidth,depth+.2,[0,0,z]));
   if(drive==='hex')cuts.push(cylinder(p.slotWidth/Math.sqrt(3),depth+.2,[0,0,z],6));
   const tip=screwTipParameters(recipe),R=r+p.threadDepth,enabled=recipe.tipStyle!==undefined||style==='headless',gimlet=enabled&&tip.style==='gimlet',plain=enabled&&!['flat','gimlet'].includes(tip.style),bodyLength=plain?p.length-tip.length:p.length;
   const half=(p.threadDepth+.3)*Math.tan(recipe.threadAngle!*Math.PI/360),startZ=Math.min(half+.05,bodyLength*.4),ridgeLength=Math.max(.01,bodyLength-2*startZ);
   const thread=enabled?Array.from({length:p.starts},(_,i)=>threadRidge(r,lead,ridgeLength/lead,0,p.threadDepth,p.hand,i*2*Math.PI/p.starts,p.pitch,recipe.threadAngle,gimlet?z=>Math.max(0,Math.min(1,(p.length-z-startZ)/tip.length)):undefined).translate(0,0,startZ)):ridges();
   const core=gimlet?lathe([[0,-p.length],[r,-p.length+tip.length],[r,0],[0,0]]):cylinder(r,bodyLength,[0,0,-bodyLength/2]);
   const add=[core,...thread.map(g=>g.rotateX(Math.PI)),...(style==='headless'?[]:[head])];if(style==='headless')head.dispose();const after:T.BufferGeometry[]=[];

   if(plain){const z=-p.length,L=tip.length,e=.01,top=z+L+e;
    if(tip.style==='dog')after.push(cylinder(tip.diameter/2,L+e,[0,0,z+(L+e)/2]));
    else if(tip.style==='cup')after.push(lathe([[0,z+tip.depth],[tip.diameter/2,z],[R,z],[R,top],[0,top]]));
    else if(tip.style==='oval')after.push(lathe([[0,z],...Array.from({length:24},(_,i)=>{const a=(i+1)*Math.PI/48;return [R*Math.sin(a),z+L*(1-Math.cos(a))];}),[R,top],[0,top]]));
    else after.push(lathe([[0,z],...(tip.style==='chamfer'?[[tip.diameter/2,z]]:[]),[R,z+L],[R,top],[0,top]]));
   }
   if(recipe.orientation==='legacy')[...add,...cuts,...after].forEach(g=>g.rotateX(Math.PI));return {add,...(cuts.length?{cut:cuts}:{}),...(after.length?{after}:{})};
  }
  if(id==='screw')return {add:[cylinder(r,p.length,[0,0,p.length/2]),...ridges(),cylinder(p.headDiameter/2,p.headHeight,[0,0,-p.headHeight/2])],cut:[box(p.slotWidth,p.headDiameter*.8,p.headHeight*.3+1,[0,0,-p.headHeight+(p.headHeight*.3-1)/2])]};
  return {add:[cylinder(r+p.threadDepth+4,p.length,[0,0,p.length/2],6)],cut:[cylinder(r+p.clearance,p.length+4,[0,0,p.length/2]),...ridges()]};
 }
 if(id==='heart'&&values){
  const p=values,s=new T.Shape();s.moveTo(0,-14);s.bezierCurveTo(-28*p.roundness,4,-13,22,0,p.cleft);s.bezierCurveTo(13,22,28*p.roundness,4,0,-14);
  const g=extrude(s,p.thickness);g.computeBoundingBox();const bounds=g.boundingBox!,sx=p.width/(bounds.max.x-bounds.min.x),sy=p.height/(bounds.max.y-bounds.min.y);
  if(Math.abs(p.bend)<.001){g.scale(sx,sy,1);return {add:[g]};}g.dispose();
  const contour=s.extractPoints(48).shape;if(contour[0].equals(contour.at(-1)!))contour.pop();contour.forEach(v=>v.set(v.x*sx,v.y*sy));return {add:[bentExtrusion(contour,p.thickness,p.width/(p.bend*Math.PI/180))]};
 }
 switch(id){
 case 'loft':{const points:number[]=[],triangles:number[]=[];for(let level=0;level<=8;level++)for(let j=0;j<64;j++){const a=j*Math.PI/32,t=level/8,r=(1-t)*15/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a)))+t*8;points.push(r*Math.cos(a),r*Math.sin(a),25*t);}for(let i=0;i<8;i++)for(let j=0;j<64;j++){const a=i*64+j,b=i*64+(j+1)%64,c=a+64,d=b+64;triangles.push(a,b,c,b,d,c);}const bottom=points.length/3;points.push(0,0,0,0,0,25);for(let j=0;j<64;j++)triangles.push(bottom,(j+1)%64,j,bottom+1,512+j,512+(j+1)%64);const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(points,3));g.setIndex(triangles);return {add:[g]};}
 case 'bent-tube': {const s=annulus(5,3);class Bend extends T.Curve<T.Vector3>{constructor(){super();}getPoint(t:number,v=new T.Vector3()){return v.set(20*Math.cos(t*Math.PI/2),20*Math.sin(t*Math.PI/2),0);}}return {add:[new T.ExtrudeGeometry(s,{extrudePath:new Bend(),steps:32,bevelEnabled:false,curveSegments:16})]};}
 case 'counterbore':{const p=values!,r=(p.boreDiameter+p.clearance)/2,R=(p.recessDiameter+p.clearance)/2,h=p.shaftLength,H=h+p.recessDepth;return {add:[lathe([[0,0],[r,0],[r,h],[R,h],[R,H],[0,H]],p.segments)]};}
 case 'countersink':{const p=values!,r=(p.boreDiameter+p.clearance)/2,R=(p.recessDiameter+p.clearance)/2,h=p.shaftLength,H=h+(R-r)/Math.tan(p.seatAngle*Math.PI/360),profile=[[0,0],[r,0],[r,h],[R,H],...(p.rimHeight>0?[[R,H+p.rimHeight]]:[]),[0,H+p.rimHeight]];return {add:[lathe(profile,p.segments)]};}
 case 'teardrop':{const p=values!,s=new T.Shape(),r=p.radius,h=p.apexHeight,a=Math.asin(r/h),x=r*Math.cos(a),y=r*Math.sin(a);s.moveTo(-x,y);s.absarc(0,0,r,Math.PI-a,2*Math.PI+a,false);s.lineTo(0,h);s.closePath();return {add:[new T.ExtrudeGeometry(s,{depth:p.length,bevelEnabled:false,curveSegments:preview?Math.min(20,p.segments):p.segments}).rotateX(Math.PI/2)]};}
 case 'port':{const p=values!,r=p.width/2,a=(p.length-p.width)/2,s=new T.Shape();s.moveTo(-a,-r);s.lineTo(a,-r);s.absarc(a,0,r,-Math.PI/2,Math.PI/2,false);s.lineTo(-a,r);s.absarc(-a,0,r,Math.PI/2,3*Math.PI/2,false);s.closePath();return {add:[new T.ExtrudeGeometry(s,{depth:p.height,bevelEnabled:false,curveSegments:preview?Math.min(20,p.segments):p.segments})]};}
 case 'thread':return {add:[cylinder(5,20,[0,0,10]),threadRidge()]};
 case 'screw':return {add:[cylinder(5,20,[0,0,10]),threadRidge(),cylinder(9,5,[0,0,-2.5])],cut:[box(2,14,2,[0,0,-4.5])]};
 case 'nut':return {add:[cylinder(10,8,[0,0,10],6)],cut:[cylinder(5.25,30,[0,0,10]),threadRidge(5.25,2,12,.15)]};
 case 'finishing-washer':{const p=values!,r=p.boreDiameter/2,R=p.outerDiameter/2,seat=p.seatDiameter/2,d=(seat-r)/Math.tan(p.seatAngle*Math.PI/360),c=p.edgeChamfer;return {add:[lathe([[r,0],[R,0],...(c>0?[[R,p.height-c],[R-c,p.height]]:[[R,p.height]]),[seat,p.height],[r,p.height-d],[r,0]],p.segments)]};}
 case 'hinge':return {separate:true,add:[box(19,3,30,[-12.5,0,0]),box(19,3,30,[12.5,0,0]),...[-12,-6,0,6,12].map(z=>ring(5,3,5.7).translate(0,0,z-2.85)),cylinder(2.5,32)]};
 case 'dovetail':return {add:[extrude(XY([[-8,0],[8,0],[12,8],[-12,8]]),30).rotateX(Math.PI/2)]};
 case 'boss':{const p=values!,R=p.outerDiameter/2,r=p.boreDiameter/2,span=p.outerDiameter+2*p.ribReach;const add:T.BufferGeometry[]=[lathe([[r,0],[R,0],[R,p.height],[r,p.height],[r,0]],p.segments)];if(p.ribReach>0)add.push(box(span,p.ribThickness,p.ribHeight,[0,0,p.ribHeight/2]),box(p.ribThickness,span,p.ribHeight,[0,0,p.ribHeight/2]));return {add,...(p.ribReach>0?{cut:[cylinder(r,p.height+2,[0,0,p.height/2],p.segments)]}:{})};}
 case 'snap-fit':return {add:[box(20,12,3,[0,0,1.5]),box(3,12,25,[8.5,0,15]),extrude(XY([[0,0],[5,0],[0,6]]),12).rotateX(Math.PI/2).translate(5.5,6,24)]};
 case 'rib':{const p=values!;return {add:[extrude(XY([[0,0],[p.length,0],[0,p.height]]),p.thickness).rotateX(Math.PI/2)]};}
 case 'spring':return {add:[closedTube(new Helix(10,40,6),preview?96:288,1.4,preview?6:12)]};
 case 'gear':return {add:[gear()]};
 case 'hirth':{const add:T.BufferGeometry[]=[ring(16,4,4)];for(let i=0;i<24;i++){const half=Math.PI/24*.9,points=[];for(const r of [5,16]){points.push(new T.Vector3(r*Math.cos(-half),r*Math.sin(-half),3.8),new T.Vector3(r*Math.cos(half),r*Math.sin(half),3.8),new T.Vector3(r,0,6));}const g=new ConvexGeometry(points);g.rotateZ(i*Math.PI/12);add.push(g);}return {add};}
 case 'gt2-pulley':{const add=[ring(20*2/(2*Math.PI),2.5,6).translate(0,0,1)],after=[ring(8,2.5,1),ring(8,2.5,1).translate(0,0,7)],cut=[];for(let i=0;i<20;i++){const a=i*Math.PI/10;cut.push(cylinder(.65,6.2,[6.4*Math.cos(a),6.4*Math.sin(a),4]));}return {add,cut,after};}
 case 'grid-bin':return {add:[box(41.5,41.5,28,[0,0,14])],cut:[box(37.5,37.5,30,[0,0,18])]};
 case 'sbc':return {add:[box(85,56,1.6),box(20,20,2,[0,0,1.7]),box(14,15,10,[28,18,5.7]),box(14,15,10,[28,-18,5.7])],cut:[...[-39,39].flatMap(x=>[-24.5,24.5].map(y=>cylinder(1.5,8,[x,y,0])))]};
 case 'text':case 'name-tag':{const p=recipe??defaultGenerator(id)!,v=p.values,content=recipe?.text??text,font=p.font??'sans',relief=v.textDepth+(id==='name-tag'?.05:0);
  let glyphs:T.BufferGeometry[];if(font==='block'){glyphs=letters(content);const scale=v.textHeight/8.4;glyphs.forEach(g=>{g.scale(scale,scale,relief/2);});}else glyphs=[fontLettering(content,font,v.textHeight,relief)];
  const bounds=new T.Box3();for(const g of glyphs){g.computeBoundingBox();bounds.union(g.boundingBox!);}const size=bounds.getSize(new T.Vector3());glyphs.forEach(g=>g.translate(-bounds.min.x,-bounds.min.y,-bounds.min.z));
  if(id==='text')return {add:glyphs};
  const hole=v.holeRadius,padding=v.padding,left=hole*2+padding*2,width=size.x+left+padding,height=Math.max(size.y+padding*2,hole*2+padding*2);
  glyphs.forEach(g=>g.translate(left,(height-size.y)/2,v.baseThickness-.05));
  return {add:[roundedPlate(width,height,v.cornerRadius,v.baseThickness),...glyphs],cut:[cylinder(hole,v.baseThickness*4,[hole+padding,height/2,v.baseThickness/2])]};}
 case 'icon-tag':return {add:[cylinder(20,3),...(svg?iconGeometry(svg):[extrude(star(),2).translate(0,0,1.4)])],cut:[cylinder(2,10,[0,17,0])]};
 case 'qr':{const qr=qrcode(0,'M'),previousEncoding=qrcode.stringToBytes;try{qrcode.stringToBytes=value=>Array.from(new TextEncoder().encode(value));qr.addData(text||'BRICKWRIGHT','Byte');qr.make();}finally{qrcode.stringToBytes=previousEncoding;}const n=qr.getModuleCount(),unit=1;const add=[box((n+8)*unit,(n+8)*unit,2,[(n-1)*unit/2,(n-1)*unit/2,0])];for(let y=0;y<n;y++){let start=-1;for(let x=0;x<=n;x++){if(x<n&&qr.isDark(y,x)){if(start<0)start=x;}else if(start>=0){add.push(box((x-start)*unit,unit,1,[(start+x-1)*unit/2,(n-1-y)*unit,1.4]));start=-1;}}}return {add};}
 case 'star':return {add:[extrude(star(),5)]};
 case 'heart':{const s=new T.Shape();s.moveTo(0,-14);s.bezierCurveTo(-28,4,-13,22,0,10);s.bezierCurveTo(13,22,28,4,0,-14);return {add:[extrude(s,5)]};}
 case 'crescent':{const s=new T.Shape();s.absarc(0,0,16,Math.PI/3,Math.PI*5/3,false);s.quadraticCurveTo(-5,0,8,16*Math.sin(Math.PI/3));s.closePath();return {add:[extrude(s,5)]};}
 case 'knurl':{const add:T.BufferGeometry[]=[cylinder(12,25,[0,0,12.5])];for(let k=0;k<12;k++)for(const turn of [-.5,.5]){const g=closedTube(new Helix(11.8,25,turn,k*Math.PI/6),preview?12:24,.65,4);g.userData.collisionHint.stride=2;add.push(g);};return {add};}
 case 'ruler':{const p=values!,unit=recipe?.rulerUnit??'mm',step=unit==='in'?25.4/16:1,major=unit==='in'?16:10,parts:T.BufferGeometry[]=[box(p.length,p.width,p.thickness,[0,0,p.thickness/2])];for(let i=0;i<=Math.floor((p.length+1e-8)/step);i++){const x=-p.length/2+i*step,tick=i%major===0?p.width*.5:i%(major/2)===0?p.width*.36:p.width*.2,at=Math.max(-p.length/2+.07,Math.min(p.length/2-.07,x));parts.push(box(.14,tick,.16,[at,p.width/2-tick/2,p.thickness+.06]));if(recipe?.rulerNumbers!==false&&i%major===0){const glyphs=letters(String(unit==='in'?i/major:i));const bounds=new T.Box3();for(const g of glyphs){g.scale(.16,.16,.08);g.computeBoundingBox();bounds.union(g.boundingBox!);}const px=Math.max(-p.length/2+.25,Math.min(p.length/2-bounds.max.x-.25,x+.25));for(const g of glyphs)parts.push(g.translate(px,-p.width/2+.4,p.thickness-.02));}}return {reference:true,add:parts};}
 default:throw new Error(t`Unknown construction: ${id}`);
 }
}
export function constructionPreview(id:string,recipe?:GeneratorRecipe):T.BufferGeometry {
 if(recipe){checkGenerator(recipe);if(recipe.preset!==id)throw new Error(t('Invalid shape generator'));}
 const c=advancedGeometry(id,['text','name-tag'].includes(id)?'ABC':'BW',true,undefined,recipe);const geometries=[...c.add,...(c.after??[])].map(g=>{const non=g.index?g.toNonIndexed():g;const clean=new T.BufferGeometry();clean.setAttribute('position',non.getAttribute('position').clone());if(non!==g)non.dispose();g.dispose();return clean;});c.cut?.forEach(g=>g.dispose());const merged=mergeGeometries(geometries)!;geometries.forEach(g=>g.dispose());return merged;
}
export function constructionDocument(id:string,name:string,color:string,text:string,svg?:string,recipe?:GeneratorRecipe):CadDocument {
 const provided=recipe;recipe??=defaultGenerator(id);if(recipe&&!provided&&['text','name-tag'].includes(id))recipe={...recipe,text};
 if(recipe&&['text','name-tag'].includes(id))recipe={...recipe,text:recipe.text??text};if(recipe){checkGenerator(recipe);if(recipe.preset!==id)throw new Error(t('Invalid shape generator'));}const c=advancedGeometry(id,text,false,svg,recipe);const doc=createDocument(name);let component=0;const addNode=(g:T.BufferGeometry)=>{const key=newId();doc.nodes[key]={id:key,name:t`${name} component ${++component}`,kind:'mesh',color,transform:identityTransform(),positions:Array.from(g.getAttribute('position').array),indices:g.index?Array.from(g.index.array):Array.from({length:g.getAttribute('position').count},(_,i)=>i),...(g.userData.collisionHint?{physics:{...defaultPartPhysics(),sourcePreset:id,collisionHint:g.userData.collisionHint}}:{})};g.dispose();return key;};
 const combine=(operation:'union'|'subtract',inputs:string[]):string=>{if(inputs.length===1)return inputs[0];if(inputs.length>100){const groups=[];for(let i=0;i<inputs.length;i+=100)groups.push(combine('union',inputs.slice(i,i+100)));return combine(operation,groups);}const key=newId();doc.nodes[key]={id:key,name,kind:'boolean',operation,inputs,color,transform:identityTransform()};return key;};
 if(id==='hinge') {
  c.add.forEach(g=>g.dispose());
  const leaf=(side:number,zs:number[])=>{const parts=[box(19,3,30,[side*12.5,0,0]),...zs.map(z=>cylinder(5,5.7,[0,0,z]))];const body=combine('union',parts.map(addNode));return combine('subtract',[body,addNode(cylinder(3,40))]);};
  const a=leaf(-1,[-12,0,12]),b=leaf(1,[-6,6]),pin=combine('union',[addNode(cylinder(2.5,32)),addNode(cylinder(4,1,[0,0,16.4]))]);
  doc.roots=[a,b,pin];doc.nodes[a].name=t('Hinge leaf A');doc.nodes[b].name=t('Hinge leaf B');doc.nodes[pin].name=t('Hinge pin');
  const frame={anchorA:[0,0,0] as Vec3,anchorB:[0,0,0] as Vec3,axisA:[0,0,1] as Vec3,axisB:[0,0,1] as Vec3};
  doc.joints=[{id:newId(),kind:'hinge',bodyA:a,bodyB:b,...frame,limits:[-2.3,2.3]},{id:newId(),kind:'fixed',bodyA:a,bodyB:pin,...structuredClone(frame)}];
 } else {const roots=c.add.map(addNode);doc.roots=c.separate?roots:[combine('union',roots)];}
 if(c.cut?.length){const cut=combine('union',c.cut.map(addNode));doc.roots=[combine('subtract',[doc.roots[0],cut])];}
 if(c.after?.length)doc.roots=[combine('union',[doc.roots[0],...c.after.map(addNode)])];
 for(const root of doc.roots){const node=doc.nodes[root];if(c.reference)node.reference=true;else node.physics={...defaultPartPhysics(),...(node.physics?.collisionHint?{collisionHint:node.physics.collisionHint}:{}),sourcePreset:id,intent:id==='hinge'?'hinge':id==='spring'?'spring':id==='snap-fit'?'snap-fit':['thread','screw','nut'].includes(id)?'thread':id==='gear'?'gear':id==='gt2-pulley'?'belt':id==='hirth'?'face-coupling':id==='dovetail'?'sliding-fit':'rigid',...(['thread','screw','nut'].includes(id)?{parameters:{pitchMm:2,starts:1}}:id==='gear'?{parameters:{teeth:20,moduleMm:1.5,pressureAngleDeg:20}}:id==='spring'?{parameters:{wireDiameterMm:2.8,meanDiameterMm:20,activeTurns:6}}:id==='gt2-pulley'?{parameters:{teeth:20,pitchMm:2}}:{})};}
 const root=doc.nodes[doc.roots[0]];if(root.physics&&id==='spring')root.physics.collisionHint={kind:'tube-grid',segments:288,sides:12,layout:'rows',closed:false};
 if(recipe){doc.version=2;root.generator=structuredClone(recipe);root.name=name;if(root.physics&&['screw','thread','nut'].includes(id))root.physics.parameters={pitchMm:recipe.values.pitch,starts:recipe.values.starts,coreDiameterMm:recipe.values.diameter,lengthMm:recipe.values.length,threadDepthMm:recipe.values.threadDepth,hand:recipe.values.hand};}
 return doc;
}
