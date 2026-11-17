import {addRobotElectronics} from './robot-electronics.js';
// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const BOREAL_LAUNCHER_ID='robot-boreal-launcher';
export const borealLauncherCatalog=[
 {id:BOREAL_LAUNCHER_ID,name:'Boreal 3-axis ball launcher',category:'Robots',description:'A PLA-printable tabletop ball launcher with an Adafruit 1143 aiming yaw servo (A), continuous flywheel roller (B), linear ball feeder slider (C), and launch sphere.',keywords:'robot launcher flywheel ball roller feeder slider servo sphere pla printable adafruit 1143',color:'#16a34a'},
 {id:'robot-boreal-launcher-print',name:'Boreal launcher PLA print layout',category:'Robots',description:'All original PLA parts for the Boreal ball launcher (deck & chute, aiming turret, flywheel roller, feeder pusher, launch ball), laid out in support-free print orientation.',keywords:'robot launcher pla deck turret flywheel feeder ball print layout',color:'#16a34a'},
 {id:'robot-boreal-launcher-fit',name:'Boreal launcher spline & chute gauge',category:'Robots',description:'Micro-servo 1143 spline socket & ball chute clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot launcher tolerance coupon servo spline chute fit gauge 1143',color:'#e8ab47'},
];
export const isBorealLauncher=(id:string)=>borealLauncherCatalog.some(p=>p.id===id);
export const borealLauncherDimensions=Object.freeze({
 yawLimitDeg:60,
 feederLimitsMm:[0,32] as const,
 ballRadiusMm:8,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Boreal 3-axis ball launcher part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const borealLauncherPartPrograms={
 base:program(`let deck=move([20,0,3],box(140,96,6));
let leftWall=move([55,22,12],box(60,4,12));
let rightWall=move([55,-22,12],box(60,4,12));
return union(deck,leftWall,rightWall);`),

 turret:program(`return move([0,0,4],box(40,44,8));`),

 flywheel:program(`return move([0,0,7],cylinder(14,14,24));`),

 feeder:program(`return move([0,0,7],box(12,14,14));`),

 ball:program(`return move([0,0,8],sphere(8,20));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],cylinder(8.2,10,20))
);
return subtract(bar,holes);`),
} as const;

export type BorealLauncherPart=keyof typeof borealLauncherPartPrograms;

const names:Record<BorealLauncherPart,string>={
 base:'Launcher chute & deck',
 turret:'Aiming turret arm',
 flywheel:'Continuous launch flywheel',
 feeder:'Linear ball feeder',
 ball:'Printable launch ball',
 fit:'Boreal launcher spline & chute gauge',
};

const colors:Record<BorealLauncherPart,string>={
 base:'#166534',
 turret:'#16a34a',
 flywheel:'#4ade80',
 feeder:'#e8ab47',
 ball:'#f59e0b',
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

const partCollisions:Partial<Record<BorealLauncherPart,CollisionPiece[]>>={
 base:[boxPiece(20,0,3,140,96,6),boxPiece(55,22,12,60,4,12),boxPiece(55,-22,12,60,4,12)],
 turret:[boxPiece(0,0,4,40,44,8)],
 flywheel:[boxPiece(0,0,7,22,22,14)],
 feeder:[boxPiece(0,0,7,12,14,14)],
};

function addPart(doc:CadDocument,part:BorealLauncherPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.15,restitution=.3){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(borealLauncherPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution,sourcePreset:BOREAL_LAUNCHER_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createBorealLauncherPart(part:BorealLauncherPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-boreal-launcher-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis ball launcher (yaw A, flywheel roller B, feeder slider C) with ball. */
export function createBorealLauncherDocument(id=BOREAL_LAUNCHER_ID):CadDocument{
 if(id==='robot-boreal-launcher-fit')return createBorealLauncherPart('fit');
 const doc=createDocument(t(id==='robot-boreal-launcher-print'?'Boreal launcher PLA print layout':'Boreal 3-axis ball launcher'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-boreal-launcher-print'){
  addPart(doc,'base','base',[0,-35,0]);
  addPart(doc,'turret','turret',[-40,45,0]);
  addPart(doc,'flywheel','flywheel',[10,45,0]);
  addPart(doc,'feeder','feeder',[45,45,0]);
  addPart(doc,'ball','ball',[75,45,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05,selfCollisions:false};
 doc.joints=[];

 addPart(doc,'base','base',[0,0,0],[0,0,0],'static',.05,.2);
 addPart(doc,'turret','turret',[0,10,35]);
 addPart(doc,'flywheel','flywheel',[18,-14,8],[0,0,0],'dynamic',.5,.4);
 addPart(doc,'feeder','feeder',[-22,0,8]);
 addPart(doc,'ball','ball',[0,0,6.2],[0,0,0],'dynamic',.04,.4);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 for(const [key,original]of Object.entries(servoMotor.nodes)){
  const node=structuredClone(original);
  node.id=`yaw-${key}`;
  if(node.kind==='boolean')node.inputs=node.inputs.map(input=>`yaw-${input}`);
  if(servoMotor.roots.includes(key)){
   node.transform.position=[0,20,6];
   node.transform.rotation=[0,0,0];
  }
  node.name=t('Aiming yaw servo')+(key==='shaft'?' · '+t('Output spline'):'');
  doc.nodes[node.id]=node;
 }
 doc.roots.push('yaw-casing','yaw-shaft');
 fixed(doc,'base','yaw-casing');

 const deg=Math.PI/180;
 const yawLimit=borealLauncherDimensions.yawLimitDeg*deg;
 const yawJoint=jointAtWorldFrame(doc,'hinge','yaw-casing','yaw-shaft',[0,20,33.18],[0,0,1]);
 yawJoint.id='yaw-a';
 yawJoint.limits=[-yawLimit,yawLimit];
 yawJoint.control={port:'A'};
 doc.joints!.push(yawJoint);
 fixed(doc,'yaw-shaft','turret');

 const rollerJoint=jointAtWorldFrame(doc,'hinge','turret','flywheel',[18,-14,24],[0,0,1]);
 rollerJoint.id='roller-b';
 rollerJoint.control={port:'B'};
 doc.joints!.push(rollerJoint);

 const feederSlider=jointAtWorldFrame(doc,'slider','base','feeder',[-22,0,15],[1,0,0]);
 feederSlider.id='feeder-c';
 feederSlider.limits=[...borealLauncherDimensions.feederLimitsMm];
 feederSlider.control={port:'C'};
 doc.joints!.push(feederSlider);

 addRobotElectronics(doc);
 doc.tracers=[{id:'ball-path',bodyId:'ball',point:[0,0,8],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function borealLauncherPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-boreal-launcher-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-boreal-launcher-print'){
  geometries.push(
   new THREE.BoxGeometry(140,96,6).translate(20,-35,3),
   new THREE.BoxGeometry(40,44,8).translate(-40,45,4),
   new THREE.CylinderGeometry(14,14,14,20).rotateX(Math.PI/2).translate(10,45,7),
   new THREE.BoxGeometry(12,14,14).translate(45,45,7),
   new THREE.SphereGeometry(8,16,12).translate(75,45,8),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(140,96,6).translate(20,0,3),
   new THREE.BoxGeometry(40,44,8).translate(0,10,39),
   new THREE.CylinderGeometry(14,14,14,20).rotateX(Math.PI/2).translate(18,-14,15),
   new THREE.BoxGeometry(12,14,14).translate(-22,0,15),
   new THREE.SphereGeometry(8,16,12).translate(0,0,14.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
