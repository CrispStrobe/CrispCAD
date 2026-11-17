// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const LABYRINTH_TILTER_ID='robot-labyrinth-tilter';
export const labyrinthTilterCatalog=[
 {id:LABYRINTH_TILTER_ID,name:'Labyrinth 2-axis tilt maze',category:'Robots',description:'A PLA-printable 2-axis gimbaled marble labyrinth driven by three Adafruit 1143 micro-servos (outer roll A, inner pitch B, maze diverter gate C) with a rolling marble.',keywords:'robot maze labyrinth gimbal tilt servo marble pla printable adafruit 1143',color:'#10b981'},
 {id:'robot-labyrinth-tilter-print',name:'Labyrinth maze PLA print layout',category:'Robots',description:'All original PLA parts for the Labyrinth tilt maze (stand, outer gimbal ring, walled maze tray, diverter gate, marble), laid flat in support-free print orientation.',keywords:'robot maze labyrinth pla stand gimbal tray gate marble print layout',color:'#10b981'},
 {id:'robot-labyrinth-tilter-fit',name:'Labyrinth servo spline gauge',category:'Robots',description:'Micro-servo 1143 spline socket & M2 mounting bore fit coupon with 0.15–0.45 mm clearance.',keywords:'robot maze tolerance coupon servo spline fit gauge 1143',color:'#e8ab47'},
];
export const isLabyrinthTilter=(id:string)=>labyrinthTilterCatalog.some(p=>p.id===id);
export const labyrinthTilterDimensions=Object.freeze({
 gimbalLimitDeg:25,
 gateLimitDeg:60,
 marbleRadiusMm:7,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Labyrinth 2-axis tilt maze part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const labyrinthTilterPartPrograms={
 stand:program(`let base=move([-16,0,3],box(132,28,6));
let pillar=move([-78,0,30],box(8,28,48));
return union(base,pillar);`),

 outerRing:program(`let leftBar=move([-42,0,4],box(6,88,8));
let rightBar=move([42,0,4],box(6,88,8));
let frontBar=move([0,-41,4],box(78,6,8));
let rearBar=move([0,41,4],box(78,6,8));
return union(leftBar,rightBar,frontBar,rearBar);`),

 mazeTray:program(`let floor=move([0,0,2],box(70,72,4));
let north=move([0,34,10],box(70,4,12));
let south=move([0,-34,10],box(70,4,12));
let west=move([-33,0,10],box(4,64,12));
let east=move([33,0,10],box(4,64,12));
let baffle=move([-8,-11,10],box(4,42,12));
return union(floor,north,south,west,east,baffle);`),

 diverter:program(`let arm=move([-10,0,2.5],box(30,8,5));
let fin=move([-22,0,15],box(6,6,20));
return union(arm,fin);`),

 marble:program(`return move([0,0,7],sphere(7,20));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],cylinder(1.15,10,12))
);
return subtract(bar,holes);`),
} as const;

export type LabyrinthTilterPart=keyof typeof labyrinthTilterPartPrograms;

const names:Record<LabyrinthTilterPart,string>={
 stand:'Gimbal base stand',
 outerRing:'Outer roll gimbal ring',
 mazeTray:'Walled labyrinth maze tray',
 diverter:'Maze diverter gate',
 marble:'Printable labyrinth marble',
 fit:'Labyrinth servo spline gauge',
};

const colors:Record<LabyrinthTilterPart,string>={
 stand:'#065f46',
 outerRing:'#10b981',
 mazeTray:'#34d399',
 diverter:'#e8ab47',
 marble:'#f59e0b',
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

const partCollisions:Partial<Record<LabyrinthTilterPart,CollisionPiece[]>>={
 stand:[boxPiece(-16,0,3,132,28,6),boxPiece(-78,0,30,8,28,48)],
 outerRing:[boxPiece(-42,0,4,6,88,8),boxPiece(42,0,4,6,88,8),boxPiece(0,-41,4,78,6,8),boxPiece(0,41,4,78,6,8)],
 mazeTray:[boxPiece(0,0,2,70,72,4),boxPiece(0,34,10,70,4,12),boxPiece(0,-34,10,70,4,12),boxPiece(-33,0,10,4,64,12),boxPiece(33,0,10,4,64,12),boxPiece(-8,-11,10,4,42,12)],
 diverter:[boxPiece(-10,0,2.5,30,8,5),boxPiece(-22,0,15,6,6,20)],
};

function addPart(doc:CadDocument,part:LabyrinthTilterPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.2){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(labyrinthTilterPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:LABYRINTH_TILTER_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createLabyrinthTilterPart(part:LabyrinthTilterPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-labyrinth-tilter-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 2-axis gimbaled marble labyrinth (outer roll A, inner pitch B) with diverter gate (C) and marble. */
export function createLabyrinthTilterDocument(id=LABYRINTH_TILTER_ID):CadDocument{
 if(id==='robot-labyrinth-tilter-fit')return createLabyrinthTilterPart('fit');
 const doc=createDocument(t(id==='robot-labyrinth-tilter-print'?'Labyrinth maze PLA print layout':'Labyrinth 2-axis tilt maze'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-labyrinth-tilter-print'){
  addPart(doc,'stand','stand',[5,-65,0]);
  addPart(doc,'outerRing','outer-ring',[-45,45,0]);
  addPart(doc,'mazeTray','maze-tray',[50,45,0]);
  addPart(doc,'diverter','diverter',[25,-20,0]);
  addPart(doc,'marble','marble',[65,-20,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05,selfCollisions:false};
 doc.joints=[];

 addPart(doc,'stand','stand',[0,0,0],[0,0,0],'static',.3);
 addPart(doc,'outerRing','outer-ring',[0,0,44]);
 addPart(doc,'mazeTray','maze-tray',[0,0,44]);
 addPart(doc,'diverter','diverter',[20,10,76.5],[180,0,0]);
 addPart(doc,'marble','marble',[-20,-18,48.2],[0,0,0],'dynamic',.05);

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
 const tiltLimit=labyrinthTilterDimensions.gimbalLimitDeg*deg;
 const gateLimit=labyrinthTilterDimensions.gateLimitDeg*deg;

 addServo('outer','Outer roll servo','A',[-73.18,0,48],[0,90,0],[-46,0,48],[1,0,0],[-tiltLimit,tiltLimit],'stand','outer-ring');
 addServo('inner','Inner pitch servo','B',[0,-64.18,48],[-90,0,0],[0,-37,48],[0,1,0],[-tiltLimit,tiltLimit],'outer-ring','maze-tray');
 addServo('gate','Maze diverter servo','C',[20,10,48],[0,0,0],[20,10,75.18],[0,0,1],[-gateLimit,gateLimit],'maze-tray','diverter');

 doc.tracers=[{id:'marble-path',bodyId:'marble',point:[0,0,7],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function labyrinthTilterPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-labyrinth-tilter-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-labyrinth-tilter-print'){
  geometries.push(
   new THREE.BoxGeometry(132,28,6).translate(-11,-65,3),
   new THREE.BoxGeometry(90,88,8).translate(-45,45,4),
   new THREE.BoxGeometry(70,72,4).translate(50,45,2),
   new THREE.SphereGeometry(7,16,12).translate(65,-20,7),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(132,28,6).translate(-16,0,3),
   new THREE.BoxGeometry(8,28,48).translate(-78,0,30),
   new THREE.BoxGeometry(90,88,8).translate(0,0,48),
   new THREE.BoxGeometry(70,72,4).translate(0,0,46),
   new THREE.SphereGeometry(7,16,12).translate(-20,-18,55.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
