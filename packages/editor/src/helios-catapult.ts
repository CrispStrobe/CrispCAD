// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const HELIOS_CATAPULT_ID='robot-helios-catapult';
export const heliosCatapultCatalog=[
 {id:HELIOS_CATAPULT_ID,name:'Helios turret catapult',category:'Robots',description:'A PLA-printable 3-servo aiming catapult turret & swinging target gate driven by three Adafruit 1143 micro-servos (pan A, throw arm B, target gate C) with a launchable payload cube.',keywords:'robot catapult turret launcher servo pla printable adafruit 1143 helios',color:'#ef4444'},
 {id:'robot-helios-catapult-print',name:'Helios catapult PLA print layout',category:'Robots',description:'All original PLA parts for the Helios catapult (pedestal, turret, throwing arm, payload cube, target gate), laid flat in support-free print orientation.',keywords:'robot catapult pla pedestal turret arm cup payload gate print layout',color:'#ef4444'},
 {id:'robot-helios-catapult-fit',name:'Helios servo spline gauge',category:'Robots',description:'Micro-servo 1143 spline socket & M2 mounting bore fit coupon with 0.15–0.45 mm clearance.',keywords:'robot catapult tolerance coupon servo spline fit gauge 1143',color:'#e8ab47'},
];
export const isHeliosCatapult=(id:string)=>heliosCatapultCatalog.some(p=>p.id===id);
export const heliosCatapultDimensions=Object.freeze({
 panLimitDeg:90,
 throwMinDeg:-45,
 throwMaxDeg:85,
 gateLimitDeg:60,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Helios turret catapult part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const heliosCatapultPartPrograms={
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

 arm:program(`let beam=move([-26,4,4],box(64,8,8));
let cupFloor=move([-48,4,4],box(20,20,8));
let cupBack=move([-56,4,12],box(4,20,8));
let cupSideL=move([-48,12,12],box(20,4,8));
let cupSideR=move([-48,-4,12],box(20,4,8));
return union(beam,cupFloor,cupBack,cupSideL,cupSideR);`),

 payload:program(`return move([0,0,6],box(12,12,12));`),

 gateBase:program(`let plate=move([0,0,3],box(28,36,6));
let leftTower=move([-10.5,5,19],box(7,34,26));
let rightTower=move([10.5,5,19],box(7,34,26));
let backWall=move([0,24.25,19],box(28,5.5,26));
return union(plate,leftTower,rightTower,backWall);`),

 goalie:program(`let hub=move([0,0,3],cylinder(12,6,20));
let blade=move([0,16,14],box(6,36,28));
return union(hub,blade);`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],cylinder(1.15,10,12))
);
return subtract(bar,holes);`),
} as const;

export type HeliosCatapultPart=keyof typeof heliosCatapultPartPrograms;

const names:Record<HeliosCatapultPart,string>={
 pedestal:'Catapult base pedestal',
 turret:'Panning catapult turret',
 arm:'Catapult throwing arm & cup',
 payload:'Printable payload cube',
 gateBase:'Target gate pedestal',
 goalie:'Swinging target gate',
 fit:'Helios servo spline gauge',
};

const colors:Record<HeliosCatapultPart,string>={
 pedestal:'#991b1b',
 turret:'#ef4444',
 arm:'#f97316',
 payload:'#eab308',
 gateBase:'#1e40af',
 goalie:'#3b82f6',
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

const partCollisions:Partial<Record<HeliosCatapultPart,CollisionPiece[]>>={
 pedestal:[cylPiece(0,0,3,44,6,24),boxPiece(-10.5,5,19,7,34,26),boxPiece(10.5,5,19,7,34,26),boxPiece(0,24.25,19,28,5.5,26)],
 turret:[cylPiece(0,0,3,20,6,24),boxPiece(-10.5,6.5,22.25,7,27,32.5),boxPiece(10.5,6.5,22.25,7,27,32.5),boxPiece(0,22.25,22.25,28,5.5,32.5)],
 arm:[boxPiece(-26,4,4,64,8,8),boxPiece(-48,4,4,20,20,8),boxPiece(-56,4,12,4,20,8),boxPiece(-48,12,12,20,4,8),boxPiece(-48,-4,12,20,4,8)],
 payload:[boxPiece(0,0,6,12,12,12)],
 gateBase:[boxPiece(0,0,3,28,36,6),boxPiece(-10.5,5,19,7,34,26),boxPiece(10.5,5,19,7,34,26),boxPiece(0,24.25,19,28,5.5,26)],
 goalie:[cylPiece(0,0,3,12,6,20),boxPiece(0,16,14,6,36,28)],
};

function addPart(doc:CadDocument,part:HeliosCatapultPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.35){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(heliosCatapultPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:HELIOS_CATAPULT_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createHeliosCatapultPart(part:HeliosCatapultPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-helios-catapult-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-servo aiming turret catapult (pan A, throw arm B) and target gate (C) with projectile payload. */
export function createHeliosCatapultDocument(id=HELIOS_CATAPULT_ID):CadDocument{
 if(id==='robot-helios-catapult-fit')return createHeliosCatapultPart('fit');
 const doc=createDocument(t(id==='robot-helios-catapult-print'?'Helios catapult PLA print layout':'Helios turret catapult'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-helios-catapult-print'){
  addPart(doc,'pedestal','pedestal',[-55,-35,0]);
  addPart(doc,'turret','turret',[45,-35,0]);
  addPart(doc,'arm','arm',[30,35,0]);
  addPart(doc,'gateBase','gate-base',[-65,45,0]);
  addPart(doc,'goalie','goalie',[55,80,0]);
  addPart(doc,'payload','payload',[-15,85,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.1};
 doc.joints=[];

 addPart(doc,'pedestal','pedestal',[0,0,0],[0,0,0],'static');
 addPart(doc,'turret','turret',[0,0,33.5]);
 addPart(doc,'arm','arm',[0,-16,58]);
 addPart(doc,'payload','payload',[-46,-12,66.2],[0,0,0],'dynamic',.15);
 addPart(doc,'gateBase','gate-base',[95,0,0],[0,0,0],'static');
 addPart(doc,'goalie','goalie',[95,0,33.5]);

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
 addServo('pan','Turret pan servo','A',[0,0,4.8],[0,0,0],[0,0,31.98],[0,0,1],[-heliosCatapultDimensions.panLimitDeg*deg,heliosCatapultDimensions.panLimitDeg*deg],'pedestal','turret');
 addServo('throw','Catapult throw servo','B',[0,19,62],[90,0,0],[0,-8.18,62],[0,1,0],[heliosCatapultDimensions.throwMinDeg*deg,heliosCatapultDimensions.throwMaxDeg*deg],'turret','arm');
 addServo('gate','Target gate servo','C',[95,0,4.8],[0,0,0],[95,0,31.98],[0,0,1],[-heliosCatapultDimensions.gateLimitDeg*deg,heliosCatapultDimensions.gateLimitDeg*deg],'gate-base','goalie');

 doc.tracers=[{id:'payload-flight-path',bodyId:'payload',point:[0,0,6],color:'#eab308'}];
 doc.simulation={...defaultSimulationSettings(),...doc.simulation,selfCollisions:false};
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function heliosCatapultPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-helios-catapult-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-helios-catapult-print'){
  geometries.push(
   new THREE.CylinderGeometry(44,44,6,24).rotateX(Math.PI/2).translate(-55,-35,3),
   new THREE.CylinderGeometry(20,20,6,24).rotateX(Math.PI/2).translate(45,-35,3),
   new THREE.BoxGeometry(64,20,8).translate(4,39,4),
   new THREE.BoxGeometry(28,36,6).translate(-65,45,3),
   new THREE.BoxGeometry(12,12,12).translate(-15,85,6),
  );
 }else{
  geometries.push(
   new THREE.CylinderGeometry(44,44,6,24).rotateX(Math.PI/2).translate(0,0,3),
   new THREE.BoxGeometry(28,28,38).translate(0,6,52),
   new THREE.BoxGeometry(64,8,8).translate(-26,-12,62),
   new THREE.BoxGeometry(20,20,16).translate(-48,-12,66),
   new THREE.BoxGeometry(12,12,12).translate(-46,-12,72),
   new THREE.BoxGeometry(28,36,32).translate(95,0,16),
   new THREE.BoxGeometry(6,36,28).translate(95,16,47.5),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
