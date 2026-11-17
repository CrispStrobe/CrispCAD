// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const STRATOS_GIMBAL_ID='robot-stratos-gimbal';
export const stratosGimbalCatalog=[
 {id:STRATOS_GIMBAL_ID,name:'Stratos 3-axis gimbal stage',category:'Robots',description:'A PLA-printable 3-axis stabilized gimbal with an Adafruit 1143 yaw turret servo (A), pitch yoke servo (B), roll cradle servo (C), and sensor pod.',keywords:'robot gimbal stabilizer yaw pitch roll servo sensor pod pla printable adafruit 1143',color:'#0284c7'},
 {id:'robot-stratos-gimbal-print',name:'Stratos gimbal PLA print layout',category:'Robots',description:'All original PLA parts for the Stratos gimbal stage (pedestal base, yaw yoke, pitch cradle, sensor pod), laid out in support-free print orientation.',keywords:'robot gimbal pla base yoke cradle pod print layout',color:'#0284c7'},
 {id:'robot-stratos-gimbal-fit',name:'Stratos gimbal spline & bearing gauge',category:'Robots',description:'Micro-servo 1143 spline socket & gimbal clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot gimbal tolerance coupon servo spline fit gauge 1143',color:'#e8ab47'},
];
export const isStratosGimbal=(id:string)=>stratosGimbalCatalog.some(p=>p.id===id);
export const stratosGimbalDimensions=Object.freeze({
 yawLimitDeg:120,
 pitchLimitDeg:75,
 rollLimitDeg:90,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Stratos 3-axis gimbal stage part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const stratosGimbalPartPrograms={
 base:program(`let deck=move([0,0,3],box(84,84,6));
let turret=move([0,0,12],cylinder(16,12,24));
return union(deck,turret);`),

 yawYoke:program(`let beam=move([0,0,4],box(66,14,8));
let leftArm=move([-29,0,26],box(8,14,44));
let rightArm=move([29,0,26],box(8,14,44));
return union(beam,leftArm,rightArm);`),

 pitchFrame:program(`let bottom=move([0,0,4],box(44,12,8));
let leftSide=move([-18,0,18],box(8,12,28));
let rightSide=move([18,0,18],box(8,12,28));
return union(bottom,leftSide,rightSide);`),

 sensorPod:program(`let core=move([0,0,8],box(16,16,16));
let lens=move([0,10,8],box(8,6,8));
return union(core,lens);`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(10.3,12.3,10))
);
return subtract(bar,holes);`),
} as const;

export type StratosGimbalPart=keyof typeof stratosGimbalPartPrograms;

const names:Record<StratosGimbalPart,string>={
 base:'Gimbal pedestal & turret',
 yawYoke:'Yaw outer yoke',
 pitchFrame:'Pitch inner cradle',
 sensorPod:'Stabilized sensor pod',
 fit:'Stratos gimbal spline & bearing gauge',
};

const colors:Record<StratosGimbalPart,string>={
 base:'#0c4a6e',
 yawYoke:'#0284c7',
 pitchFrame:'#38bdf8',
 sensorPod:'#f59e0b',
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

const partCollisions:Partial<Record<StratosGimbalPart,CollisionPiece[]>>={
 base:[boxPiece(0,0,3,84,84,6),boxPiece(0,0,12,32,32,12)],
 yawYoke:[boxPiece(0,0,4,66,14,8),boxPiece(-29,0,26,8,14,44),boxPiece(29,0,26,8,14,44)],
 pitchFrame:[boxPiece(0,0,4,44,12,8),boxPiece(-18,0,18,8,12,28),boxPiece(18,0,18,8,12,28)],
 sensorPod:[boxPiece(0,0,8,16,16,16),boxPiece(0,10,8,8,6,8)],
};

function addPart(doc:CadDocument,part:StratosGimbalPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.08){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(stratosGimbalPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:STRATOS_GIMBAL_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createStratosGimbalPart(part:StratosGimbalPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-stratos-gimbal-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis gimbal stage (yaw A, pitch B, roll C) with stabilized sensor pod. */
export function createStratosGimbalDocument(id=STRATOS_GIMBAL_ID):CadDocument{
 if(id==='robot-stratos-gimbal-fit')return createStratosGimbalPart('fit');
 const doc=createDocument(t(id==='robot-stratos-gimbal-print'?'Stratos gimbal PLA print layout':'Stratos 3-axis gimbal stage'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-stratos-gimbal-print'){
  addPart(doc,'base','base',[-20,-20,0]);
  addPart(doc,'yawYoke','yaw-yoke',[55,35,0]);
  addPart(doc,'pitchFrame','pitch-frame',[55,-15,0]);
  addPart(doc,'sensorPod','sensor-pod',[55,-55,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05,selfCollisions:false};
 doc.joints=[];

 addPart(doc,'base','base',[0,0,0],[0,0,0],'static',.06);
 addPart(doc,'yawYoke','yaw-yoke',[0,0,46]);
 addPart(doc,'pitchFrame','pitch-frame',[0,0,64]);
 addPart(doc,'sensorPod','sensor-pod',[0,6,74],[0,0,0],'dynamic',.06);

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
 const yawLimit=stratosGimbalDimensions.yawLimitDeg*deg;
 const pitchLimit=stratosGimbalDimensions.pitchLimitDeg*deg;
 const rollLimit=stratosGimbalDimensions.rollLimitDeg*deg;

 addServo('yaw','Yaw turret servo','A',[0,0,18],[0,0,0],[0,0,45.18],[0,0,1],[-yawLimit,yawLimit],'base','yaw-yoke');
 addServo('pitch','Pitch cradle servo','B',[-52,0,82],[0,Math.PI/2,0],[-24.82,0,82],[1,0,0],[-pitchLimit,pitchLimit],'yaw-yoke','pitch-frame');
 addServo('roll','Roll sensor servo','C',[0,-34,82],[-Math.PI/2,0,0],[0,-6.82,82],[0,1,0],[-rollLimit,rollLimit],'pitch-frame','sensor-pod');

 doc.tracers=[{id:'pod-path',bodyId:'sensor-pod',point:[0,13,8],color:'#0284c7'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function stratosGimbalPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-stratos-gimbal-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-stratos-gimbal-print'){
  geometries.push(
   new THREE.BoxGeometry(84,84,6).translate(-20,-20,3),
   new THREE.BoxGeometry(66,14,8).translate(55,35,4),
   new THREE.BoxGeometry(44,12,8).translate(55,-15,4),
   new THREE.BoxGeometry(16,16,16).translate(55,-55,8),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(84,84,6).translate(0,0,3),
   new THREE.CylinderGeometry(16,16,12,24).rotateX(Math.PI/2).translate(0,0,12),
   new THREE.BoxGeometry(66,14,8).translate(0,0,50),
   new THREE.BoxGeometry(8,14,44).translate(-29,0,72),
   new THREE.BoxGeometry(8,14,44).translate(29,0,72),
   new THREE.BoxGeometry(44,12,8).translate(0,0,68),
   new THREE.BoxGeometry(8,12,28).translate(-18,0,82),
   new THREE.BoxGeometry(8,12,28).translate(18,0,82),
   new THREE.BoxGeometry(16,16,16).translate(0,6,82),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
