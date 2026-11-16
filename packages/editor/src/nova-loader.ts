// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const NOVA_LOADER_ID='robot-nova-loader';
export const novaLoaderCatalog=[
 {id:NOVA_LOADER_ID,name:'Nova 3-axis wheeled loader',category:'Robots',description:'A PLA-printable differential-drive front loader with continuous left/right drive wheels (A, B), an Adafruit 1143 tilting dump bucket servo (C), and a payload block.',keywords:'robot loader rover differential wheels bucket servo payload pla printable adafruit 1143',color:'#d97706'},
 {id:'robot-nova-loader-print',name:'Nova loader PLA print layout',category:'Robots',description:'All original PLA parts for the Nova wheeled loader (chassis, left & right drive wheels, front dump bucket, payload), laid out in support-free print orientation.',keywords:'robot loader pla chassis wheels bucket payload print layout',color:'#d97706'},
 {id:'robot-nova-loader-fit',name:'Nova loader spline & axle gauge',category:'Robots',description:'Micro-servo 1143 spline socket & wheel axle clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot loader tolerance coupon servo spline axle fit gauge 1143',color:'#e8ab47'},
];
export const isNovaLoader=(id:string)=>novaLoaderCatalog.some(p=>p.id===id);
export const novaLoaderDimensions=Object.freeze({
 bucketLimitDeg:55,
 wheelRadiusMm:18,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Nova 3-axis wheeled loader part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const novaLoaderPartPrograms={
 chassis:program(`let hull=move([-5,0,18],box(66,48,18));
let skid=move([-34,0,2],box(14,24,4));
return union(hull,skid);`),

 wheel:program(`return move([0,0,18],rotate([90,0,0],cylinder(18,12,24)));`),

 bucket:program(`let scoop=move([0,0,6],box(22,36,12));
let arm=move([-12,8,8],box(20,8,8));
return union(scoop,arm);`),

 payload:program(`return move([0,0,9],box(14,14,18));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],cylinder(2.15,10,16))
);
return subtract(bar,holes);`),
} as const;

export type NovaLoaderPart=keyof typeof novaLoaderPartPrograms;

const names:Record<NovaLoaderPart,string>={
 chassis:'Loader chassis & rear skid',
 wheel:'Differential drive wheel',
 bucket:'Front dump bucket',
 payload:'Payload block',
 fit:'Nova loader spline & axle gauge',
};

const colors:Record<NovaLoaderPart,string>={
 chassis:'#92400e',
 wheel:'#1e293b',
 bucket:'#d97706',
 payload:'#f59e0b',
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

const partCollisions:Partial<Record<NovaLoaderPart,CollisionPiece[]>>={
 chassis:[boxPiece(-5,0,18,66,48,18),boxPiece(-34,0,2,14,24,4)],
 bucket:[boxPiece(0,0,6,22,36,12),boxPiece(-12,8,8,20,8,8)],
 payload:[boxPiece(0,0,9,14,14,18)],
};

function addPart(doc:CadDocument,part:NovaLoaderPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.6){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(novaLoaderPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.08,sourcePreset:NOVA_LOADER_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createNovaLoaderPart(part:NovaLoaderPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-nova-loader-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis differential wheeled loader (left A, right B, bucket servo C) with payload. */
export function createNovaLoaderDocument(id=NOVA_LOADER_ID):CadDocument{
 if(id==='robot-nova-loader-fit')return createNovaLoaderPart('fit');
 const doc=createDocument(t(id==='robot-nova-loader-print'?'Nova loader PLA print layout':'Nova 3-axis wheeled loader'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-nova-loader-print'){
  addPart(doc,'chassis','chassis',[-20,-20,0]);
  addPart(doc,'wheel','left-wheel',[50,35,0]);
  addPart(doc,'wheel','right-wheel',[50,-10,0]);
  addPart(doc,'bucket','bucket',[-20,45,0]);
  addPart(doc,'payload','payload',[50,-45,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:false,groundFriction:.8,groundRestitution:.05};
 doc.joints=[];

 addPart(doc,'chassis','chassis',[0,0,2],[0,0,0],'dynamic',.15);
 addPart(doc,'wheel','left-wheel',[0,32,0],[0,0,0],'dynamic',.85);
 addPart(doc,'wheel','right-wheel',[0,-32,0],[0,0,0],'dynamic',.85);
 addPart(doc,'bucket','bucket',[50,0,12],[0,0,0],'dynamic',.25);
 addPart(doc,'payload','payload',[69,0,0],[0,0,0],'dynamic',.1);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 const leftDrive=jointAtWorldFrame(doc,'hinge','chassis','left-wheel',[0,32,18],[0,1,0]);
 leftDrive.id='drive-left-a';
 leftDrive.control={port:'A'};
 doc.joints!.push(leftDrive);

 const rightDrive=jointAtWorldFrame(doc,'hinge','chassis','right-wheel',[0,-32,18],[0,1,0]);
 rightDrive.id='drive-right-b';
 rightDrive.control={port:'B'};
 doc.joints!.push(rightDrive);

 for(const [key,original]of Object.entries(servoMotor.nodes)){
  const node=structuredClone(original);
  node.id=`bucket-${key}`;
  if(node.kind==='boolean')node.inputs=node.inputs.map(input=>`bucket-${input}`);
  if(servoMotor.roots.includes(key)){
   node.transform.position=[28,-18,22];
   node.transform.rotation=[-90,0,0];
  }
  node.name=t('Bucket tilt servo')+(key==='shaft'?' · '+t('Output spline'):'');
  doc.nodes[node.id]=node;
 }
 doc.roots.push('bucket-casing','bucket-shaft');
 fixed(doc,'chassis','bucket-casing');

 const deg=Math.PI/180;
 const bucketLimit=novaLoaderDimensions.bucketLimitDeg*deg;
 const bucketJoint=jointAtWorldFrame(doc,'hinge','bucket-casing','bucket-shaft',[28,9.18,22],[0,1,0]);
 bucketJoint.id='bucket-c';
 bucketJoint.limits=[-bucketLimit,bucketLimit];
 bucketJoint.control={port:'C'};
 doc.joints!.push(bucketJoint);
 fixed(doc,'bucket-shaft','bucket');

 doc.tracers=[{id:'loader-path',bodyId:'chassis',point:[0,0,10],color:'#d97706'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function novaLoaderPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-nova-loader-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-nova-loader-print'){
  geometries.push(
   new THREE.BoxGeometry(66,48,18).translate(-25,-20,9),
   new THREE.CylinderGeometry(18,18,12,20).translate(50,35,18),
   new THREE.CylinderGeometry(18,18,12,20).translate(50,-10,18),
   new THREE.BoxGeometry(22,36,12).translate(-20,45,6),
   new THREE.BoxGeometry(12,12,12).translate(50,-45,6),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(66,48,18).translate(-5,0,20),
   new THREE.CylinderGeometry(18,18,12,20).translate(0,32,18),
   new THREE.CylinderGeometry(18,18,12,20).translate(0,-32,18),
   new THREE.BoxGeometry(22,36,12).translate(50,0,18),
   new THREE.BoxGeometry(14,14,18).translate(69,0,9),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
