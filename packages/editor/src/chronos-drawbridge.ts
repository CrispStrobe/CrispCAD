// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const CHRONOS_DRAWBRIDGE_ID='robot-chronos-drawbridge';
export const chronosDrawbridgeCatalog=[
 {id:CHRONOS_DRAWBRIDGE_ID,name:'Chronos 3-axis bascule drawbridge',category:'Robots',description:'A PLA-printable dual-leaf bascule drawbridge driven by two Adafruit 1143 micro-servos (west leaf A, east leaf B), a vertical-lift crossing barrier slider (C), and a crossing wagon.',keywords:'robot drawbridge bascule bridge gate barrier servo slider wagon pla printable adafruit 1143',color:'#2563eb'},
 {id:'robot-chronos-drawbridge-print',name:'Chronos drawbridge PLA print layout',category:'Robots',description:'All original PLA parts for the Chronos drawbridge (canal deck & piers, west & east bridge leaves, crossing barrier, wagon), laid out in support-free print orientation.',keywords:'robot drawbridge pla deck piers leaves barrier wagon print layout',color:'#2563eb'},
 {id:'robot-chronos-drawbridge-fit',name:'Chronos drawbridge spline & pier gauge',category:'Robots',description:'Micro-servo 1143 spline socket & barrier rail clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot drawbridge tolerance coupon servo spline pier fit gauge 1143',color:'#e8ab47'},
];
export const isChronosDrawbridge=(id:string)=>chronosDrawbridgeCatalog.some(p=>p.id===id);
export const chronosDrawbridgeDimensions=Object.freeze({
 leafLimitDeg:70,
 barrierLimitsMm:[0,24] as const,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Chronos 3-axis bascule drawbridge part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const chronosDrawbridgePartPrograms={
 deck:program(`let road=move([0,0,3],box(140,72,6));
let leftPier=move([-50,0,19],box(16,56,26));
let rightPier=move([50,0,19],box(16,56,26));
return union(road,leftPier,rightPier);`),

 westLeaf:program(`return move([0,0,3],box(36,26,6));`),

 eastLeaf:program(`return move([0,0,3],box(36,26,6));`),

 barrier:program(`return move([0,0,4],box(8,28,8));`),

 wagon:program(`return move([0,0,6],box(16,16,12));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(8.3,8.3,10))
);
return subtract(bar,holes);`),
} as const;

export type ChronosDrawbridgePart=keyof typeof chronosDrawbridgePartPrograms;

const names:Record<ChronosDrawbridgePart,string>={
 deck:'Canal bed & bridge piers',
 westLeaf:'West bascule leaf',
 eastLeaf:'East bascule leaf',
 barrier:'Vertical crossing barrier',
 wagon:'Crossing cargo wagon',
 fit:'Chronos drawbridge spline & pier gauge',
};

const colors:Record<ChronosDrawbridgePart,string>={
 deck:'#1e40af',
 westLeaf:'#2563eb',
 eastLeaf:'#3b82f6',
 barrier:'#e8ab47',
 wagon:'#f59e0b',
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

const partCollisions:Partial<Record<ChronosDrawbridgePart,CollisionPiece[]>>={
 deck:[boxPiece(0,0,3,140,72,6),boxPiece(-50,0,19,16,56,26),boxPiece(50,0,19,16,56,26)],
 westLeaf:[boxPiece(0,0,3,36,26,6)],
 eastLeaf:[boxPiece(0,0,3,36,26,6)],
 barrier:[boxPiece(0,0,4,8,28,8)],
 wagon:[boxPiece(0,0,6,16,16,12)],
};

function addPart(doc:CadDocument,part:ChronosDrawbridgePart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.12){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(chronosDrawbridgePartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:CHRONOS_DRAWBRIDGE_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createChronosDrawbridgePart(part:ChronosDrawbridgePart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-chronos-drawbridge-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis bascule drawbridge (west leaf A, east leaf B, barrier slider C) with wagon. */
export function createChronosDrawbridgeDocument(id=CHRONOS_DRAWBRIDGE_ID):CadDocument{
 if(id==='robot-chronos-drawbridge-fit')return createChronosDrawbridgePart('fit');
 const doc=createDocument(t(id==='robot-chronos-drawbridge-print'?'Chronos drawbridge PLA print layout':'Chronos 3-axis bascule drawbridge'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-chronos-drawbridge-print'){
  addPart(doc,'deck','deck',[0,-30,0]);
  addPart(doc,'westLeaf','west-leaf',[-50,35,0]);
  addPart(doc,'eastLeaf','east-leaf',[0,35,0]);
  addPart(doc,'barrier','barrier',[35,35,0]);
  addPart(doc,'wagon','wagon',[60,35,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05,selfCollisions:false};
 doc.joints=[];

 addPart(doc,'deck','deck',[0,0,0],[0,0,0],'static',.12);
 addPart(doc,'westLeaf','west-leaf',[-20,14,31]);
 addPart(doc,'eastLeaf','east-leaf',[20,14,31]);
 addPart(doc,'barrier','barrier',[-48,14,34]);
 addPart(doc,'wagon','wagon',[-18,14,37.2],[0,0,0],'dynamic',.08);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 const addServo=(prefix:string,label:string,port:'A'|'B',position:Vec3,rotation:Vec3,anchor:Vec3,axis:Vec3,limits:[number,number],host:string,driven:string)=>{
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
 const leafLimit=chronosDrawbridgeDimensions.leafLimitDeg*deg;

 addServo('west','West drawbridge servo','A',[-40,-28,34],[-90,0,0],[-40,-0.82,34],[0,1,0],[-leafLimit,leafLimit],'deck','west-leaf');
 addServo('east','East drawbridge servo','B',[40,-28,34],[-90,0,0],[40,-0.82,34],[0,1,0],[-leafLimit,leafLimit],'deck','east-leaf');

 const barrierSlider=jointAtWorldFrame(doc,'slider','deck','barrier',[-48,14,38],[0,0,1]);
 barrierSlider.id='barrier-c';
 barrierSlider.limits=[...chronosDrawbridgeDimensions.barrierLimitsMm];
 barrierSlider.control={port:'C'};
 doc.joints!.push(barrierSlider);

 doc.tracers=[{id:'wagon-path',bodyId:'wagon',point:[0,0,6],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function chronosDrawbridgePreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-chronos-drawbridge-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-chronos-drawbridge-print'){
  geometries.push(
   new THREE.BoxGeometry(140,72,6).translate(0,-30,3),
   new THREE.BoxGeometry(36,26,6).translate(-50,35,3),
   new THREE.BoxGeometry(36,26,6).translate(0,35,3),
   new THREE.BoxGeometry(8,28,8).translate(35,35,4),
   new THREE.BoxGeometry(16,16,12).translate(60,35,6),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(140,72,6).translate(0,0,3),
   new THREE.BoxGeometry(16,56,26).translate(-50,0,19),
   new THREE.BoxGeometry(16,56,26).translate(50,0,19),
   new THREE.BoxGeometry(36,26,6).translate(-20,14,34),
   new THREE.BoxGeometry(36,26,6).translate(20,14,34),
   new THREE.BoxGeometry(8,28,8).translate(-48,14,38),
   new THREE.BoxGeometry(16,16,12).translate(-18,14,43.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
