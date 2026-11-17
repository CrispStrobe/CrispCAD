// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';
import {orionCarouselCollisionAssembly} from './orion-carousel-collisions.js';

export const ORION_CAROUSEL_ID='robot-orion-carousel';
export const orionCarouselCatalog=[
 {id:ORION_CAROUSEL_ID,name:'Orion 3-axis sorting carousel',category:'Robots',description:'A PLA-printable rotary sorting station with an Adafruit 1143 carousel turntable (A), linear ejection pusher slider (B), diverter gate servo (C), and cargo cube.',keywords:'robot carousel turntable pusher diverter sorter servo slider cube pla printable adafruit 1143',color:'#7c3aed'},
 {id:'robot-orion-carousel-print',name:'Orion carousel PLA print layout',category:'Robots',description:'All original PLA parts for the Orion sorting carousel (deck base, 4-blade turntable, pusher block, diverter arm, cargo cube), laid out in support-free print orientation.',keywords:'robot carousel pla base turntable pusher diverter cube print layout',color:'#7c3aed'},
 {id:'robot-orion-carousel-fit',name:'Orion carousel spline & chute gauge',category:'Robots',description:'Five-step micro-servo 1143 spline socket (0.15–0.55 mm clearance) & cargo chute clearance coupon.',keywords:'robot carousel tolerance coupon servo spline chute fit gauge 1143',color:'#e8ab47'},
];
export const isOrionCarousel=(id:string)=>orionCarouselCatalog.some(p=>p.id===id);
export const orionCarouselDimensions=Object.freeze({
 carouselLimitDeg:120,
 pusherLimitsMm:[0,48] as const,
 gateLimitDeg:60,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Orion 3-axis sorting carousel part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});
const cuts=(items:string[])=>items.join(',\n  ');

export const orionCarouselPartPrograms={
 base:program(`param m3Bore:mm=3.4;
// Sorting deck with 4x M3 mounting bores, Feather M2.5 carrier standoffs, chute guide wall, and backstop.
let deck=move([20,10,3],box(140,140,6));
let chuteWall=move([32,60,11],box(4,36,14));
let backstop=move([48,-46,14],box(20,12,20));
let featherBosses=union(
  ${[[-40.43,-46.4],[-40.43,4.4],[-17.57,-46.4],[-17.57,4.4]].map(([x,y])=>`move([${x},${y},7.5],cylinder(2.6,3,16))`).join(',\n  ')}
);
let body=union(deck,chuteWall,backstop,featherBosses);
let cornerBores=union(
  ${[[-42,-52],[82,-52],[-42,72],[82,72]].flatMap(([x,y])=>[
   `move([${x},${y},3],cylinder(m3Bore/2,8,16))`,
   `move([${x},${y},5],cylinder(3.1,3,16))`,
  ]).join(',\n  ')}
);
let featherBores=union(
  ${[[-40.43,-46.4],[-40.43,4.4],[-17.57,-46.4],[-17.57,4.4]].map(([x,y])=>`move([${x},${y},5],cylinder(1.1,12,12))`).join(',\n  ')}
);
let servoM2Bores=union(
  move([0,-8.4,3],cylinder(1.1,8,12)),
  move([0,18.7,3],cylinder(1.1,8,12)),
  move([68,43.6,3],cylinder(1.1,8,12)),
  move([68,70.7,3],cylinder(1.1,8,12))
);
return subtract(body,
  ${cuts(['cornerBores','featherBores','servoM2Bores'])});`),

 turntable:program(`param splineClearance:mm=0.2;
// 4-blade rotary turntable with center Ø5.0 mm spline socket, M2 countersunk bore, and corner lightening holes.
let hub=move([0,0,31],box(76,76,8));
let east=move([33,0,15],box(10,8,30));
let west=move([-33,0,15],box(10,8,30));
let north=move([0,33,15],box(8,10,30));
let south=move([0,-33,15],box(8,10,30));
let body=union(hub,east,west,north,south);
let splineSocket=move([0,0,28.6],cylinder((5.0 mm + splineClearance)/2,3.6,24));
let screwBore=move([0,0,31],cylinder(1.15,10,16));
let screwCs=move([0,0,33.8],cylinder(2.3,2.8,16));
let cornerRelief=union(
  ${[[-26,-26],[26,-26],[-26,26],[26,26]].map(([x,y])=>`move([${x},${y},31],cylinder(4.0,10,16))`).join(',\n  ')}
);
return subtract(body,
  ${cuts(['splineSocket','screwBore','screwCs','cornerRelief'])});`),

 pusher:program(`// Linear ejection ram block with top M2.5 actuator bore.
let block=move([0,0,7],box(16,12,14));
let bore=move([0,0,11],cylinder(1.35,8,12));
return subtract(block,bore);`),

 diverter:program(`param splineClearance:mm=0.2;
// Chute diverter gate with Ø5.0 mm MG90S spline socket, M2 bore, and lightened sweeper arm.
let hub=move([0,0,25],cylinder(6,10,20));
let arm=move([-14,0,26],box(34,8,8));
let fin=move([-27,0,13],box(8,8,26));
let body=union(hub,arm,fin);
let splineSocket=move([0,0,22],cylinder((5.0 mm + splineClearance)/2,4.2,24));
let screwBore=move([0,0,25],cylinder(1.15,12,16));
let screwCs=move([0,0,28.8],cylinder(2.3,2.8,16));
let armBores=union(
  move([-11,0,26],rotate([90,0,0],cylinder(1.8,10,12))),
  move([-19,0,26],rotate([90,0,0],cylinder(1.8,10,12)))
);
return subtract(body,
  ${cuts(['splineSocket','screwBore','screwCs','armBores'])});`),

 cargoCube:program(`// Printable 14 mm cargo cube with shallow top alignment fiducial.
let cube=move([0,0,7],box(14,14,14));
let fiducial=move([0,0,13.6],box(5,5,1.2));
return subtract(cube,fiducial);`),

 fit:program(`// Five-step servo spline (0.15..0.55 mm) & 14.4 mm cargo chute clearance coupon.
let bar=hull(move([-32,0,2],cylinder(11,4,24)),move([32,0,2],cylinder(11,4,24)));
let endBlock=move([40,0,2],box(24,24,4));
let sockets=union(
  ${[0.15,0.25,0.35,0.45,0.55].map((c,i)=>`move([${-28+i*14},1,2.2],cylinder((5.0 mm + ${c} mm)/2,4.4,20))`).join(',\n  ')}
);
let dots=union(
  ${[0.15,0.25,0.35,0.45,0.55].flatMap((_,i)=>Array.from({length:i+1},(__,d)=>`move([${-30+i*14+d*1.3},-5.2,3.7],cylinder(0.45,0.9,10))`)).join(',\n  ')}
);
let chuteTest=move([40,0,2],box(14.4,14.4,10));
return subtract(union(bar,endBlock),sockets,dots,chuteTest);`),
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

function addPart(doc:CadDocument,part:OrionCarouselPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.15){
 const collisionAssembly=orionCarouselCollisionAssembly(part);
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
 if(id==='robot-orion-carousel-fit')geometries.push(new THREE.BoxGeometry(96,24,4).translate(4,0,2));
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
