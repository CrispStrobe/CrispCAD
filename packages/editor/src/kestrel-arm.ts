// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const KESTREL_ARM_ID='robot-kestrel-arm';
export const kestrelArmCatalog=[
 {id:KESTREL_ARM_ID,name:'Kestrel 3-servo arm',category:'Robots',description:'A PLA-printable 3-DOF articulated desktop robotic arm and gripper driven by three Adafruit 1143 micro-servos (yaw A, lift B, gripper C) with a test cargo cube.',keywords:'robot arm gripper manipulator servo pla printable adafruit 1143 kestrel',color:'#d97736'},
 {id:'robot-kestrel-arm-print',name:'Kestrel arm PLA print layout',category:'Robots',description:'All original PLA parts for the Kestrel arm (pedestal, turret, boom, jaw, cargo cube), laid flat in support-free print orientation.',keywords:'robot arm gripper pla pedestal turret boom jaw cube print layout',color:'#d97736'},
 {id:'robot-kestrel-arm-fit',name:'Kestrel servo spline gauge',category:'Robots',description:'Micro-servo 1143 spline socket & M2/M3 mounting hole fit coupon with 0.15–0.45 mm clearance.',keywords:'robot arm tolerance coupon servo spline fit gauge 1143',color:'#e8ab47'},
];
export const isKestrelArm=(id:string)=>kestrelArmCatalog.some(p=>p.id===id);
export const kestrelArmDimensions=Object.freeze({
 pedestalRadius:44,
 pedestalHeight:32,
 turretZ:33.5,
 liftAxisZ:62,
 gripAxisX:110,
 gripAxisZ:74,
 yawLimitDeg:90,
 liftLimitDeg:45,
 gripLimitDeg:40,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Kestrel 3-servo arm part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const kestrelArmPartPrograms={
 pedestal:program(`let plate=move([0,0,3],cylinder(44,6,24));
let leftTower=move([-10.5,5,19],box(7,34,26));
let rightTower=move([10.5,5,19],box(7,34,26));
let backWall=move([0,24.25,19],box(28,5.5,26));
return union(plate,leftTower,rightTower,backWall);`),

 turret:program(`let hub=move([0,0,3],cylinder(20,6,24));
let leftCheek=move([-10.5,6.5,22.25],box(7,27,32.5));
let rightCheek=move([10.5,6.5,22.25],box(7,27,32.5));
let rearBridge=move([0,22.25,22.25],box(28,5.5,32.5));
return union(hub,leftCheek,rightCheek,rearBridge);`),

 boom:program(`let beam=move([69,-3,5],box(158,14,10));
let lowerJaw=move([133,-14,5],box(42,8,10));
let jawLip=move([151,-9,5],box(6,2,10));
return union(beam,lowerJaw,jawLip);`),

 jaw:program(`let finger=move([19,0,5],box(50,8,10));
let tip=move([40,-9,5],box(8,10,10));
return union(finger,tip);`),

 cargoCube:program(`return move([0,0,9],box(18,18,18));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],cylinder(1.15,10,12))
);
return subtract(bar,holes);`),
} as const;

export type KestrelArmPart=keyof typeof kestrelArmPartPrograms;

const names:Record<KestrelArmPart,string>={
 pedestal:'Kestrel base pedestal',
 turret:'Yaw turret cradle',
 boom:'Shoulder boom & lower jaw',
 jaw:'Articulated gripper jaw',
 cargoCube:'Printable cargo cube',
 fit:'Kestrel servo spline gauge',
};

const colors:Record<KestrelArmPart,string>={
 pedestal:'#2c5d63',
 turret:'#38a99a',
 boom:'#d97736',
 jaw:'#e8ab47',
 cargoCube:'#5ea3d0',
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
const cylPiece=(cx:number,cy:number,cz:number,r:number,h:number,segs=24):CollisionPiece=>{
 const z0=cz-h/2,z1=cz+h/2,positions:number[]=[],indices:number[]=[];
 for(let i=0;i<segs;i++){const a=i*2*Math.PI/segs;positions.push(cx+r*Math.cos(a),cy+r*Math.sin(a),z0);}
 for(let i=0;i<segs;i++){const a=i*2*Math.PI/segs;positions.push(cx+r*Math.cos(a),cy+r*Math.sin(a),z1);}
 for(let i=1;i<segs-1;i++)indices.push(0,i+1,i,segs,segs+i,segs+i+1);
 for(let i=0;i<segs;i++){const n=(i+1)%segs;indices.push(i,n,segs+n,i,segs+n,segs+i);}
 return {positions,indices};
};

const partCollisions:Partial<Record<KestrelArmPart,CollisionPiece[]>>={
 pedestal:[cylPiece(0,0,3,44,6,24),boxPiece(-10.5,5,19,7,34,26),boxPiece(10.5,5,19,7,34,26),boxPiece(0,24.25,19,28,5.5,26)],
 turret:[cylPiece(0,0,3,20,6,24),boxPiece(-10.5,6.5,22.25,7,27,32.5),boxPiece(10.5,6.5,22.25,7,27,32.5),boxPiece(0,22.25,22.25,28,5.5,32.5)],
 boom:[boxPiece(69,-3,5,158,14,10),boxPiece(133,-14,5,42,8,10),boxPiece(151,-9,5,6,2,10)],
 jaw:[boxPiece(19,0,5,50,8,10),boxPiece(40,-9,5,8,10,10)],
 cargoCube:[boxPiece(0,0,9,18,18,18)],
};

function addPart(doc:CadDocument,part:KestrelArmPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic'){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(kestrelArmPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction:.6,restitution:.02,sourcePreset:KESTREL_ARM_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createKestrelArmPart(part:KestrelArmPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-kestrel-arm-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-servo articulated Kestrel robotic arm with A (yaw), B (lift), and C (gripper). */
export function createKestrelArmDocument(id=KESTREL_ARM_ID):CadDocument{
 if(id==='robot-kestrel-arm-fit')return createKestrelArmPart('fit');
 const doc=createDocument(t(id==='robot-kestrel-arm-print'?'Kestrel arm PLA print layout':'Kestrel 3-servo arm'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-kestrel-arm-print'){
  addPart(doc,'pedestal','pedestal',[-55,-30,0]);
  addPart(doc,'turret','turret',[40,-30,0]);
  addPart(doc,'boom','boom',[-30,45,0]);
  addPart(doc,'jaw','jaw',[35,85,0]);
  addPart(doc,'cargoCube','cargo-cube',[-60,85,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.8,groundRestitution:.02,selfCollisions:false};
 doc.joints=[];

 // Static grounded pedestal holding yaw servo A.
 addPart(doc,'pedestal','pedestal',[0,0,0],[0,0,0],'static');
 addPart(doc,'turret','turret',[0,0,33.5],[0,0,0]);
 addPart(doc,'boom','boom',[0,-5,62],[90,0,0]);
 addPart(doc,'jaw','jaw',[110,-15.5,74],[90,0,0]);
 addPart(doc,'cargoCube','cargo-cube',[144,-15,0],[0,0,0]);

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
 addServo('yaw','Base yaw servo','A',[0,0,4.8],[0,0,0],[0,0,31.98],[0,0,1],[-90*deg,90*deg],'pedestal','turret');
 addServo('lift','Shoulder lift servo','B',[0,19,62],[90,0,0],[0,-8.18,62],[0,1,0],[-45*deg,45*deg],'turret','boom');
 addServo('grip','Gripper jaw servo','C',[110,12.18,74],[90,0,0],[110,-15,74],[0,1,0],[-15*deg,45*deg],'boom','jaw');

 doc.tracers=[{id:'gripper-tip-path',bodyId:'boom',point:[150,-10,50],color:'#d97736'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function kestrelArmPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-kestrel-arm-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-kestrel-arm-print'){
  geometries.push(
   new THREE.CylinderGeometry(44,44,6,24).rotateX(Math.PI/2).translate(-55,-30,3),
   new THREE.CylinderGeometry(20,20,6,24).rotateX(Math.PI/2).translate(40,-30,3),
   new THREE.BoxGeometry(158,14,10).translate(39,42,5),
   new THREE.BoxGeometry(50,8,10).translate(54,85,5),
   new THREE.BoxGeometry(18,18,18).translate(-60,85,9),
  );
 }else{
  geometries.push(
   new THREE.CylinderGeometry(44,44,6,24).rotateX(Math.PI/2).translate(0,0,3),
   new THREE.BoxGeometry(28,36,28).translate(0,5,20),
   new THREE.BoxGeometry(28,28,38).translate(0,6,52),
   new THREE.BoxGeometry(158,10,14).translate(69,-10,59),
   new THREE.BoxGeometry(50,10,8).translate(129,-20,74),
   new THREE.BoxGeometry(18,18,18).translate(144,-15,9),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
