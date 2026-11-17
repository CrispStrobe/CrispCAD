import {addRobotElectronics} from './robot-electronics.js';
// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const AEGIS_SENTRY_ID='robot-aegis-sentry';
export const aegisSentryCatalog=[
 {id:AEGIS_SENTRY_ID,name:'Aegis 3-axis sentry gate',category:'Robots',description:'A PLA-printable courtyard sentry station with an Adafruit 1143 sweep boom servo (A), linear sliding gate bar (B), east latch gate servo (C), and target pod.',keywords:'robot sentry gate barrier boom latch slider servo pod pla printable adafruit 1143',color:'#be123c'},
 {id:'robot-aegis-sentry-print',name:'Aegis sentry PLA print layout',category:'Robots',description:'All original PLA parts for the Aegis sentry gate (courtyard & tower, sweep boom, sliding gate bar, latch arm, target pod), laid out in support-free print orientation.',keywords:'robot sentry pla outpost boom gate latch pod print layout',color:'#be123c'},
 {id:'robot-aegis-sentry-fit',name:'Aegis sentry spline & gate gauge',category:'Robots',description:'Micro-servo 1143 spline socket & gate rail clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot sentry tolerance coupon servo spline gate fit gauge 1143',color:'#e8ab47'},
];
export const isAegisSentry=(id:string)=>aegisSentryCatalog.some(p=>p.id===id);
export const aegisSentryDimensions=Object.freeze({
 sweepLimitDeg:120,
 gateLimitsMm:[-26,26] as const,
 latchLimitDeg:65,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Aegis 3-axis sentry gate part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const aegisSentryPartPrograms={
 outpost:program(`let deck=move([0,0,3],box(120,96,6));
let tower=move([-34,0,22],box(24,24,32));
return union(deck,tower);`),

 sweepBoom:program(`let arm=move([22,0,63],box(60,10,8));
let paddle=move([48,0,30],box(8,12,60));
return union(arm,paddle);`),

 gateBar:program(`return move([0,0,6],box(10,36,12));`),

 latch:program(`let arm=move([-12,0,28],box(30,8,8));
let fin=move([-23,0,12],box(8,8,24));
return union(arm,fin);`),

 pod:program(`return move([0,0,7],box(14,14,14));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(10.3,12.3,10))
);
return subtract(bar,holes);`),
} as const;

export type AegisSentryPart=keyof typeof aegisSentryPartPrograms;

const names:Record<AegisSentryPart,string>={
 outpost:'Sentry courtyard & tower',
 sweepBoom:'Rotating sweep boom',
 gateBar:'Sliding security gate',
 latch:'East latch arm',
 pod:'Courtyard target pod',
 fit:'Aegis sentry spline & gate gauge',
};

const colors:Record<AegisSentryPart,string>={
 outpost:'#881337',
 sweepBoom:'#be123c',
 gateBar:'#e8ab47',
 latch:'#fb7185',
 pod:'#f59e0b',
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

const partCollisions:Partial<Record<AegisSentryPart,CollisionPiece[]>>={
 outpost:[boxPiece(0,0,3,120,96,6),boxPiece(-34,0,22,24,24,32)],
 sweepBoom:[boxPiece(22,0,63,60,10,8),boxPiece(48,0,30,8,12,60)],
 gateBar:[boxPiece(0,0,6,10,36,12)],
 latch:[boxPiece(-12,0,28,30,8,8),boxPiece(-23,0,12,8,8,24)],
 pod:[boxPiece(0,0,7,14,14,14)],
};

function addPart(doc:CadDocument,part:AegisSentryPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.08){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(aegisSentryPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:AEGIS_SENTRY_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createAegisSentryPart(part:AegisSentryPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-aegis-sentry-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis sentry gate (sweep boom A, sliding gate B, latch C) with pod. */
export function createAegisSentryDocument(id=AEGIS_SENTRY_ID):CadDocument{
 if(id==='robot-aegis-sentry-fit')return createAegisSentryPart('fit');
 const doc=createDocument(t(id==='robot-aegis-sentry-print'?'Aegis sentry PLA print layout':'Aegis 3-axis sentry gate'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-aegis-sentry-print'){
  addPart(doc,'outpost','outpost',[-15,-20,0]);
  addPart(doc,'sweepBoom','sweep-boom',[55,35,0]);
  addPart(doc,'gateBar','gate-bar',[55,0,0]);
  addPart(doc,'latch','latch',[55,-35,0]);
  addPart(doc,'pod','pod',[55,-65,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05,selfCollisions:false};
 doc.joints=[];

 addPart(doc,'outpost','outpost',[0,0,0],[0,0,0],'static',.06);
 addPart(doc,'sweepBoom','sweep-boom',[-34,0,8]);
 addPart(doc,'gateBar','gate-bar',[36,-24,8]);
 addPart(doc,'latch','latch',[42,32,11]);
 addPart(doc,'pod','pod',[14,14,6.2],[0,0,0],'dynamic',.06);

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
 const sweepLimit=aegisSentryDimensions.sweepLimitDeg*deg;
 const latchLimit=aegisSentryDimensions.latchLimitDeg*deg;

 addServo('sweep','Sweep boom servo','A',[-34,0,38],[0,0,0],[-34,0,65.18],[0,0,1],[-sweepLimit,sweepLimit],'outpost','sweep-boom');

 const gateSlider=jointAtWorldFrame(doc,'slider','outpost','gate-bar',[36,-24,14],[0,1,0]);
 gateSlider.id='gate-b';
 gateSlider.limits=[...aegisSentryDimensions.gateLimitsMm];
 gateSlider.control={port:'B'};
 doc.joints!.push(gateSlider);

 addServo('latch','East latch servo','C',[42,32,6],[0,0,0],[42,32,33.18],[0,0,1],[-latchLimit,latchLimit],'outpost','latch');

 addRobotElectronics(doc);
 doc.tracers=[{id:'pod-path',bodyId:'pod',point:[0,0,7],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function aegisSentryPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-aegis-sentry-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-aegis-sentry-print'){
  geometries.push(
   new THREE.BoxGeometry(120,96,6).translate(-15,-20,3),
   new THREE.BoxGeometry(60,10,8).translate(77,35,63),
   new THREE.BoxGeometry(10,36,12).translate(55,0,6),
   new THREE.BoxGeometry(30,8,8).translate(43,-35,28),
   new THREE.BoxGeometry(14,14,14).translate(55,-65,7),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(120,96,6).translate(0,0,3),
   new THREE.BoxGeometry(24,24,32).translate(-34,0,22),
   new THREE.BoxGeometry(60,10,8).translate(-12,0,71),
   new THREE.BoxGeometry(10,36,12).translate(36,-24,14),
   new THREE.BoxGeometry(30,8,8).translate(30,32,39),
   new THREE.BoxGeometry(14,14,14).translate(14,14,13.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
