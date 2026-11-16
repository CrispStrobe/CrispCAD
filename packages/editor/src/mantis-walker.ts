// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const MANTIS_WALKER_ID='robot-mantis-walker';
export const mantisWalkerCatalog=[
 {id:MANTIS_WALKER_ID,name:'Mantis 3-servo walker',category:'Robots',description:'A PLA-printable wheelless quadruped walker driven by three Adafruit 1143 micro-servos: coupled left/right leg rockers (ports A/B) and an active weight-shift roll pendulum (port C).',keywords:'robot walker quadruped legged servo pla printable adafruit 1143 mantis',color:'#8b5cf6'},
 {id:'robot-mantis-walker-print',name:'Mantis walker PLA print layout',category:'Robots',description:'All original PLA parts for the Mantis walker (torso spine, left & right leg rockers, weight-shift pendulum), laid flat in support-free print orientation.',keywords:'robot walker pla torso leg rocker pendulum print layout',color:'#8b5cf6'},
 {id:'robot-mantis-walker-fit',name:'Mantis servo spline gauge',category:'Robots',description:'Micro-servo 1143 spline socket & M2 mounting bore fit coupon with 0.15–0.45 mm clearance.',keywords:'robot walker tolerance coupon servo spline fit gauge 1143',color:'#e8ab47'},
];
export const isMantisWalker=(id:string)=>mantisWalkerCatalog.some(p=>p.id===id);
export const mantisWalkerDimensions=Object.freeze({
 torsoLength:96,
 torsoWidth:28,
 torsoZ:22,
 hipSpreadY:16,
 hipLimitDeg:35,
 rollLimitDeg:40,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Mantis 3-servo walker part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const mantisWalkerPartPrograms={
 torso:program(`let spine=move([0,0,4],box(96,28,8));
let boss=move([-13.5,0,12],box(28,18,8));
return union(spine,boss);`),

 leg:program(`let bridge=move([0,24,3],box(92,12,6));
let frontPillar=move([40,9,3],box(12,18,6));
let rearPillar=move([-40,9,3],box(12,18,6));
return union(bridge,frontPillar,rearPillar);`),

 pendulum:program(`let arm=move([0,18,4],box(12,36,8));
let weight=move([0,32,4],box(24,14,8));
return union(arm,weight);`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],cylinder(1.15,10,12))
);
return subtract(bar,holes);`),
} as const;

export type MantisWalkerPart=keyof typeof mantisWalkerPartPrograms;

const names:Record<MantisWalkerPart,string>={
 torso:'Walker spine frame',
 leg:'Coupled leg rocker',
 pendulum:'Weight-shift roll pendulum',
 fit:'Mantis servo spline gauge',
};

const colors:Record<MantisWalkerPart,string>={
 torso:'#4f46e5',
 leg:'#8b5cf6',
 pendulum:'#e8ab47',
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

const partCollisions:Partial<Record<MantisWalkerPart,CollisionPiece[]>>={
 torso:[boxPiece(0,0,4,96,28,8),boxPiece(-13.5,0,12,28,18,8)],
 leg:[boxPiece(0,24,3,92,12,6),boxPiece(40,9,3,12,18,6),boxPiece(-40,9,3,12,18,6)],
 pendulum:[boxPiece(0,18,4,12,36,8),boxPiece(0,32,4,24,14,8)],
};

function addPart(doc:CadDocument,part:MantisWalkerPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],friction=.8,densityKgM3=1240){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(mantisWalkerPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),densityKgM3,material:'plastic',friction,restitution:.02,sourcePreset:MANTIS_WALKER_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createMantisWalkerPart(part:MantisWalkerPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-mantis-walker-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-servo wheelless Mantis walker with coupled leg rockers (A, B) and roll counterweight (C). */
export function createMantisWalkerDocument(id=MANTIS_WALKER_ID):CadDocument{
 if(id==='robot-mantis-walker-fit')return createMantisWalkerPart('fit');
 const doc=createDocument(t(id==='robot-mantis-walker-print'?'Mantis walker PLA print layout':'Mantis 3-servo walker'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-mantis-walker-print'){
  addPart(doc,'torso','torso',[-45,-40,0]);
  addPart(doc,'leg','left-leg',[-45,25,0]);
  addPart(doc,'leg','right-leg',[55,25,0]);
  addPart(doc,'pendulum','pendulum',[45,-40,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:false,groundFriction:.9,groundRestitution:.02};
 doc.joints=[];

 addPart(doc,'torso','torso',[0,0,22],[0,0,0],.3);
 // Leg rockers rotated [90,0,0] so local Z=0..6 maps to Y=-6..0, and local Y=0..30 maps to Z=0..30.
 addPart(doc,'leg','left-leg',[0,23,0],[90,0,0],.95);
 addPart(doc,'leg','right-leg',[0,-17,0],[90,0,0],.95);
 // Roll pendulum rotated [90,0,90] so local Z=0..8 maps to X=0..8 (around X=4) and local Y=0..39 maps to Z=44..83.
 addPart(doc,'pendulum','pendulum',[0,0,44],[90,0,90],.2,2400);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 const addServo=(prefix:string,label:string,port:'A'|'B'|'C',position:Vec3,rotation:Vec3,anchor:Vec3,axis:Vec3,limits:[number,number],host:string,driven:string)=>{
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
 const hipLimit=mantisWalkerDimensions.hipLimitDeg*deg;
 const rollLimit=mantisWalkerDimensions.rollLimitDeg*deg;

 // Left hip servo (port A) at X=+16, spline pointing +Y at [16, 16, 26].
 addServo('left-hip','Left hip servo','A',[16,-11.18,26],[-90,0,0],[16,16,26],[0,1,0],[-hipLimit,hipLimit],'torso','left-leg');
 // Right hip servo (port B) at X=-16, spline pointing -Y at [-16, -16, 26].
 addServo('right-hip','Right hip servo','B',[-16,11.18,26],[90,0,0],[-16,-16,26],[0,1,0],[-hipLimit,hipLimit],'torso','right-leg');
 // Weight-shift roll servo (port C) on top of torso, spline along +X at [0, 0, 44].
 addServo('roll','Roll balance servo','C',[-27.18,0,44],[0,90,0],[0,0,44],[1,0,0],[-rollLimit,rollLimit],'torso','pendulum');

 doc.tracers=[{id:'walker-path',bodyId:'torso',point:[0,0,26],color:'#8b5cf6'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function mantisWalkerPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-mantis-walker-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-mantis-walker-print'){
  geometries.push(
   new THREE.BoxGeometry(96,28,8).translate(-45,-40,4),
   new THREE.BoxGeometry(92,30,6).translate(-45,40,3),
   new THREE.BoxGeometry(92,30,6).translate(55,40,3),
   new THREE.BoxGeometry(24,39,8).translate(45,-20,4),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(96,28,8).translate(0,0,26),
   new THREE.BoxGeometry(92,6,12).translate(0,20,24),
   new THREE.BoxGeometry(12,6,18).translate(40,20,9),
   new THREE.BoxGeometry(12,6,18).translate(-40,20,9),
   new THREE.BoxGeometry(92,6,12).translate(0,-20,24),
   new THREE.BoxGeometry(12,6,18).translate(40,-20,9),
   new THREE.BoxGeometry(12,6,18).translate(-40,-20,9),
   new THREE.BoxGeometry(8,24,39).translate(4,0,57.5),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
