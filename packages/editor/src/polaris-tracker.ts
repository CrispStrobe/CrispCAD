// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const POLARIS_TRACKER_ID='robot-polaris-tracker';
export const polarisTrackerCatalog=[
 {id:POLARIS_TRACKER_ID,name:'Polaris 3-axis pan-tilt tracker',category:'Robots',description:'A PLA-printable pan-tilt-slide camera tracker with a linear rail carriage slider (A), two Adafruit 1143 micro-servos (pan B, tilt C), sensor pod, and elevated beacon target.',keywords:'robot pan tilt tracker rail slider servo camera pod beacon pla printable adafruit 1143',color:'#0891b2'},
 {id:'robot-polaris-tracker-print',name:'Polaris tracker PLA print layout',category:'Robots',description:'All original PLA parts for the Polaris tracker (rail base, carriage, pan yoke, sensor head, beacon target), laid out in support-free print orientation.',keywords:'robot tracker pla rail carriage yoke sensor beacon print layout',color:'#0891b2'},
 {id:'robot-polaris-tracker-fit',name:'Polaris tracker spline & rail gauge',category:'Robots',description:'Micro-servo 1143 spline socket & carriage rail clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot tracker tolerance coupon servo spline rail fit gauge 1143',color:'#e8ab47'},
];
export const isPolarisTracker=(id:string)=>polarisTrackerCatalog.some(p=>p.id===id);
export const polarisTrackerDimensions=Object.freeze({
 railLimitsMm:[-35,35] as const,
 panLimitDeg:120,
 tiltLimitDeg:65,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Polaris 3-axis pan-tilt tracker part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const polarisTrackerPartPrograms={
 railBase:program(`let bed=move([0,0,3],box(124,52,6));
let leftStop=move([-58,0,12],box(8,36,12));
let rightStop=move([58,0,12],box(8,36,12));
let pedestal=move([38,18,35],box(16,16,58));
return union(bed,leftStop,rightStop,pedestal);`),

 carriage:program(`return move([0,0,4],box(32,36,8));`),

 yoke:program(`let floor=move([0,0,3],box(24,32,6));
let sideArm=move([0,-16,19],box(16,6,26));
return union(floor,sideArm);`),

 sensorHead:program(`return move([0,0,6],box(32,12,12));`),

 beaconTarget:program(`return move([0,0,6],box(12,12,12));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(12.3,12.3,10))
);
return subtract(bar,holes);`),
} as const;

export type PolarisTrackerPart=keyof typeof polarisTrackerPartPrograms;

const names:Record<PolarisTrackerPart,string>={
 railBase:'Linear rail & target pedestal',
 carriage:'Sliding pan carriage',
 yoke:'Pan-tilt U-yoke',
 sensorHead:'Tilt sensor pod',
 beaconTarget:'Elevated beacon block',
 fit:'Polaris tracker spline & rail gauge',
};

const colors:Record<PolarisTrackerPart,string>={
 railBase:'#155e75',
 carriage:'#0891b2',
 yoke:'#06b6d4',
 sensorHead:'#e8ab47',
 beaconTarget:'#f59e0b',
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

const partCollisions:Partial<Record<PolarisTrackerPart,CollisionPiece[]>>={
 railBase:[boxPiece(0,0,3,124,52,6),boxPiece(-58,0,12,8,36,12),boxPiece(58,0,12,8,36,12),boxPiece(38,18,35,16,16,58)],
 carriage:[boxPiece(0,0,4,32,36,8)],
 yoke:[boxPiece(0,0,3,24,32,6),boxPiece(0,-16,19,16,6,26)],
 sensorHead:[boxPiece(0,0,6,32,12,12)],
 beaconTarget:[boxPiece(0,0,6,12,12,12)],
};

function addPart(doc:CadDocument,part:PolarisTrackerPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.15){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(polarisTrackerPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:POLARIS_TRACKER_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createPolarisTrackerPart(part:PolarisTrackerPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-polaris-tracker-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis pan-tilt-slide tracker (rail A, pan B, tilt C) with beacon target. */
export function createPolarisTrackerDocument(id=POLARIS_TRACKER_ID):CadDocument{
 if(id==='robot-polaris-tracker-fit')return createPolarisTrackerPart('fit');
 const doc=createDocument(t(id==='robot-polaris-tracker-print'?'Polaris tracker PLA print layout':'Polaris 3-axis pan-tilt tracker'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-polaris-tracker-print'){
  addPart(doc,'railBase','rail-base',[0,-25,0]);
  addPart(doc,'carriage','carriage',[-45,35,0]);
  addPart(doc,'yoke','yoke',[0,35,0]);
  addPart(doc,'sensorHead','sensor-head',[40,35,0]);
  addPart(doc,'beaconTarget','beacon-target',[70,35,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05};
 doc.joints=[];

 addPart(doc,'railBase','rail-base',[0,0,0],[0,0,0],'static',.1);
 addPart(doc,'carriage','carriage',[0,0,8]);
 addPart(doc,'yoke','yoke',[0,0,45]);
 addPart(doc,'sensorHead','sensor-head',[10,18,66]);
 addPart(doc,'beaconTarget','beacon-target',[38,18,64.2],[0,0,0],'dynamic',.08);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 const railSlider=jointAtWorldFrame(doc,'slider','rail-base','carriage',[0,0,12],[1,0,0]);
 railSlider.id='rail-a';
 railSlider.limits=[...polarisTrackerDimensions.railLimitsMm];
 railSlider.control={port:'A'};
 doc.joints!.push(railSlider);

 const addServo=(prefix:string,label:string,port:'B'|'C',position:Vec3,rotation:Vec3,anchor:Vec3,axis:Vec3,limits:[number,number],host:string,driven:string)=>{
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
 const panLimit=polarisTrackerDimensions.panLimitDeg*deg;
 const tiltLimit=polarisTrackerDimensions.tiltLimitDeg*deg;

 addServo('pan','Pan yaw servo','B',[0,0,16],[0,0,0],[0,0,43.18],[0,0,1],[-panLimit,panLimit],'carriage','yoke');
 addServo('tilt','Tilt pitch servo','C',[0,-18,72],[-90,0,0],[0,9.18,72],[0,1,0],[-tiltLimit,tiltLimit],'yoke','sensor-head');

 doc.tracers=[{id:'beacon-path',bodyId:'beacon-target',point:[0,0,6],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function polarisTrackerPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-polaris-tracker-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-polaris-tracker-print'){
  geometries.push(
   new THREE.BoxGeometry(124,52,6).translate(0,-25,3),
   new THREE.BoxGeometry(32,36,8).translate(-45,35,4),
   new THREE.BoxGeometry(24,32,6).translate(0,35,3),
   new THREE.BoxGeometry(32,12,12).translate(40,35,6),
   new THREE.BoxGeometry(12,12,12).translate(70,35,6),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(124,52,6).translate(0,0,3),
   new THREE.BoxGeometry(16,16,58).translate(38,18,35),
   new THREE.BoxGeometry(32,36,8).translate(0,0,12),
   new THREE.BoxGeometry(24,32,6).translate(0,0,48),
   new THREE.BoxGeometry(32,12,12).translate(10,18,72),
   new THREE.BoxGeometry(12,12,12).translate(38,18,70.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
