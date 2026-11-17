// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const ORION_CAROUSEL_ID='robot-orion-carousel';
export const orionCarouselCatalog=[
 {id:ORION_CAROUSEL_ID,name:'Orion 3-axis sorting carousel',category:'Robots',description:'A PLA-printable rotary sorting station with an Adafruit 1143 carousel turntable (A), linear ejection pusher slider (B), diverter gate servo (C), and cargo cube.',keywords:'robot carousel turntable pusher diverter sorter servo slider cube pla printable adafruit 1143',color:'#7c3aed'},
 {id:'robot-orion-carousel-print',name:'Orion carousel PLA print layout',category:'Robots',description:'All original PLA parts for the Orion sorting carousel (deck base, 4-blade turntable, pusher block, diverter arm, cargo cube), laid out in support-free print orientation.',keywords:'robot carousel pla base turntable pusher diverter cube print layout',color:'#7c3aed'},
 {id:'robot-orion-carousel-fit',name:'Orion carousel spline & chute gauge',category:'Robots',description:'Micro-servo 1143 spline socket & cargo chute clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot carousel tolerance coupon servo spline chute fit gauge 1143',color:'#e8ab47'},
];
export const isOrionCarousel=(id:string)=>orionCarouselCatalog.some(p=>p.id===id);
export const orionCarouselDimensions=Object.freeze({
 carouselLimitDeg:120,
 pusherLimitsMm:[0,48] as const,
 gateLimitDeg:60,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Orion 3-axis sorting carousel part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const orionCarouselPartPrograms={
 base:program(`let deck=move([20,10,3],box(140,140,6));
let chuteWall=move([32,60,12],box(4,36,12));
let backstop=move([48,-46,15],box(20,12,18));
return union(deck,chuteWall,backstop);`),

 turntable:program(`let hub=move([0,0,31],box(76,76,8));
let east=move([33,0,13.5],box(10,8,27));
let west=move([-33,0,13.5],box(10,8,27));
let north=move([0,33,13.5],box(8,10,27));
let south=move([0,-33,13.5],box(8,10,27));
return union(hub,east,west,north,south);`),

 pusher:program(`return move([0,0,7],box(16,12,14));`),

 diverter:program(`let arm=move([-14,0,26],box(34,8,8));
let fin=move([-27,0,12],box(8,8,24));
return union(arm,fin);`),

 cargoCube:program(`return move([0,0,7],box(14,14,14));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(14.3,14.3,10))
);
return subtract(bar,holes);`),
} as const;

export type OrionCarouselPart=keyof typeof orionCarouselPartPrograms;

const names:Record<OrionCarouselPart,string>={
 base:'Carousel deck & chute base',
 turntable:'4-blade rotary turntable',
 pusher:'Linear ejection pusher',
 diverter:'Chute diverter gate',
 cargoCube:'Cargo cube',
 fit:'Orion carousel spline & chute gauge',
};

const colors:Record<OrionCarouselPart,string>={
 base:'#5b21b6',
 turntable:'#7c3aed',
 pusher:'#e8ab47',
 diverter:'#a78bfa',
 cargoCube:'#f59e0b',
 fit:'#e8ab47',
};

type CollisionPiece={positions:number[];indices:number[]};
const boxPiece=(cx:number,cy:number,cz:number,sx:number,sy:number,sz:number):CollisionPiece=>{
 const x0=cx-sx/2,x1=cx+sx/2,y0=cy-sy/2,y1=cy+sy/2,z0=cz-sz/2,z1=cz+sz/2;
 return {
  positions:[x0,y0,z0,x1,y0,z0,x1,y1,z0,x0,y1,z0,x0,y0,z1,x1,y0,z1,x1,y1,z1,x0,y1,z1],
  indices:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7],
 };
};

const partCollisions:Partial<Record<OrionCarouselPart,CollisionPiece[]>>={
 base:[boxPiece(20,10,3,140,140,6),boxPiece(32,60,12,4,36,12),boxPiece(48,-46,15,20,12,18)],
 turntable:[boxPiece(0,0,31,76,76,8),boxPiece(33,0,13.5,10,8,27),boxPiece(-33,0,13.5,10,8,27),boxPiece(0,33,13.5,8,10,27),boxPiece(0,-33,13.5,8,10,27)],
 pusher:[boxPiece(0,0,7,16,12,14)],
 diverter:[boxPiece(-14,0,26,34,8,8),boxPiece(-27,0,12,8,8,24)],
 cargoCube:[boxPiece(0,0,7,14,14,14)],
};

function addPart(doc:CadDocument,part:OrionCarouselPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.15){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(orionCarouselPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:ORION_CAROUSEL_ID,...(collisionAssembly?{collisionAssembly}:{})},
 };
 doc.nodes[id]=node;
 doc.roots.push(id);
 return id;
}

function fixed(doc:CadDocument,bodyA:string,bodyB:string){
 const joint=jointAtWorldFrame(doc,'fixed',bodyA,bodyB,[0,0,0],[0,0,1]);
 joint.id=`fix-${bodyA}-${bodyB}`;
 doc.joints!.push(joint);
}

export function createOrionCarouselPart(part:OrionCarouselPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-orion-carousel-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis sorting carousel (turntable A, pusher slider B, diverter gate C) with cargo cube. */
export function createOrionCarouselDocument(id=ORION_CAROUSEL_ID):CadDocument{
 if(id==='robot-orion-carousel-fit')return createOrionCarouselPart('fit');
 const doc=createDocument(t(id==='robot-orion-carousel-print'?'Orion carousel PLA print layout':'Orion 3-axis sorting carousel'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-orion-carousel-print'){
  addPart(doc,'base','base',[0,-40,0]);
  addPart(doc,'turntable','turntable',[-45,65,0]);
  addPart(doc,'pusher','pusher',[30,65,0]);
  addPart(doc,'diverter','diverter',[65,65,0]);
  addPart(doc,'cargoCube','cargo-cube',[30,90,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05,selfCollisions:false};
 doc.joints=[];

 addPart(doc,'base','base',[0,0,0],[0,0,0],'static',.08);
 addPart(doc,'turntable','turntable',[0,0,8]);
 addPart(doc,'pusher','pusher',[48,-28,8]);
 addPart(doc,'diverter','diverter',[68,52,13]);
 addPart(doc,'cargoCube','cargo-cube',[26,-24,6.2],[0,0,0],'dynamic',.05);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 const addServo=(prefix:string,label:string,port:'A'|'C',position:Vec3,rotation:Vec3,anchor:Vec3,axis:Vec3,limits:[number,number],host:string,driven:string)=>{
  for(const [key,original]of Object.entries(servoMotor.nodes)){
   const node=structuredClone(original);
   node.id=`${prefix}-${key}`;
   if(node.kind==='boolean')node.inputs=node.inputs.map(input=>`${prefix}-${input}`);
   if(servoMotor.roots.includes(key)){
    node.transform.position=[...position];
    node.transform.rotation=[...rotation];
   }
   node.name=t(label)+(key==='shaft'?' · '+t('Output spline'):'');
   doc.nodes[node.id]=node;
  }
  doc.roots.push(`${prefix}-casing`,`${prefix}-shaft`);
  fixed(doc,host,`${prefix}-casing`);
  const joint=jointAtWorldFrame(doc,'hinge',`${prefix}-casing`,`${prefix}-shaft`,anchor,axis);
  joint.id=`${prefix}-${port.toLowerCase()}`;
  joint.limits=limits;
  joint.control={port};
  doc.joints!.push(joint);
  fixed(doc,`${prefix}-shaft`,driven);
 };

 const deg=Math.PI/180;
 const carouselLimit=orionCarouselDimensions.carouselLimitDeg*deg;
 const gateLimit=orionCarouselDimensions.gateLimitDeg*deg;

 addServo('carousel','Carousel turntable servo','A',[0,0,6],[0,0,0],[0,0,33.18],[0,0,1],[-carouselLimit,carouselLimit],'base','turntable');

 const pusherSlider=jointAtWorldFrame(doc,'slider','base','pusher',[48,-28,15],[0,1,0]);
 pusherSlider.id='pusher-b';
 pusherSlider.limits=[...orionCarouselDimensions.pusherLimitsMm];
 pusherSlider.control={port:'B'};
 doc.joints!.push(pusherSlider);

 addServo('gate','Chute diverter servo','C',[68,52,6],[0,0,0],[68,52,33.18],[0,0,1],[-gateLimit,gateLimit],'base','diverter');

 doc.tracers=[{id:'cargo-path',bodyId:'cargo-cube',point:[0,0,7],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function orionCarouselPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-orion-carousel-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-orion-carousel-print'){
  geometries.push(
   new THREE.BoxGeometry(140,140,6).translate(20,-30,3),
   new THREE.BoxGeometry(76,76,35).translate(-45,65,17.5),
   new THREE.BoxGeometry(16,12,14).translate(30,65,7),
   new THREE.BoxGeometry(14,14,14).translate(30,90,7),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(140,140,6).translate(20,10,3),
   new THREE.BoxGeometry(76,76,8).translate(0,0,39),
   new THREE.BoxGeometry(16,12,14).translate(48,-28,15),
   new THREE.BoxGeometry(34,8,8).translate(54,52,39),
   new THREE.BoxGeometry(14,14,14).translate(26,-24,13.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
