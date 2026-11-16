// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const ZEPHYR_CONVEYOR_ID='robot-zephyr-conveyor';
export const zephyrConveyorCatalog=[
 {id:ZEPHYR_CONVEYOR_ID,name:'Zephyr 3-axis sorting conveyor',category:'Robots',description:'A PLA-printable parcel sorting conveyor with a linear feed pusher slider (A), continuous overhead paddle wheel (B), Adafruit 1143 diverter gate servo (C), and cargo parcel.',keywords:'robot conveyor belt paddle wheel diverter gate slider servo parcel pla printable adafruit 1143',color:'#0ea5e9'},
 {id:'robot-zephyr-conveyor-print',name:'Zephyr conveyor PLA print layout',category:'Robots',description:'All original PLA parts for the Zephyr sorting conveyor (conveyor bed, feed pusher, paddle wheel, diverter arm, parcel), laid out in support-free print orientation.',keywords:'robot conveyor pla bed pusher paddle diverter parcel print layout',color:'#0ea5e9'},
 {id:'robot-zephyr-conveyor-fit',name:'Zephyr conveyor spline & lane gauge',category:'Robots',description:'Micro-servo 1143 spline socket & conveyor lane clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot conveyor tolerance coupon servo spline lane fit gauge 1143',color:'#e8ab47'},
];
export const isZephyrConveyor=(id:string)=>zephyrConveyorCatalog.some(p=>p.id===id);
export const zephyrConveyorDimensions=Object.freeze({
 feedLimitsMm:[0,44] as const,
 gateLimitDeg:60,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Zephyr 3-axis sorting conveyor part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const zephyrConveyorPartPrograms={
 frame:program(`let bed=move([0,0,3],box(140,68,6));
let northRail=move([0,26,12],box(136,4,12));
let southRail=move([-16,-26,12],box(104,4,12));
return union(bed,northRail,southRail);`),

 pusher:program(`return move([0,0,7],box(12,22,14));`),

 paddleWheel:program(`let horiz=move([0,0,14],box(28,12,14));
let vert=move([0,0,14],box(14,12,28));
return union(horiz,vert);`),

 diverter:program(`let arm=move([0,14,28],box(8,34,8));
let fin=move([0,27,12],box(8,8,24));
return union(arm,fin);`),

 parcel:program(`return move([0,0,7],box(14,14,14));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(14.3,14.3,10))
);
return subtract(bar,holes);`),
} as const;

export type ZephyrConveyorPart=keyof typeof zephyrConveyorPartPrograms;

const names:Record<ZephyrConveyorPart,string>={
 frame:'Conveyor lane & guide rails',
 pusher:'Linear feed pusher',
 paddleWheel:'Continuous paddle wheel',
 diverter:'Exit diverter gate',
 parcel:'Cargo parcel',
 fit:'Zephyr conveyor spline & lane gauge',
};

const colors:Record<ZephyrConveyorPart,string>={
 frame:'#0369a1',
 pusher:'#e8ab47',
 paddleWheel:'#38bdf8',
 diverter:'#0ea5e9',
 parcel:'#f59e0b',
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

const partCollisions:Partial<Record<ZephyrConveyorPart,CollisionPiece[]>>={
 frame:[boxPiece(0,0,3,140,68,6),boxPiece(0,26,12,136,4,12),boxPiece(-16,-26,12,104,4,12)],
 pusher:[boxPiece(0,0,7,12,22,14)],
 paddleWheel:[boxPiece(0,0,14,28,12,14),boxPiece(0,0,14,14,12,28)],
 diverter:[boxPiece(0,14,28,8,34,8),boxPiece(0,27,12,8,8,24)],
 parcel:[boxPiece(0,0,7,14,14,14)],
};

function addPart(doc:CadDocument,part:ZephyrConveyorPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.15){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(zephyrConveyorPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:ZEPHYR_CONVEYOR_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createZephyrConveyorPart(part:ZephyrConveyorPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-zephyr-conveyor-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis sorting conveyor (feed A, paddle wheel B, diverter gate C) with parcel. */
export function createZephyrConveyorDocument(id=ZEPHYR_CONVEYOR_ID):CadDocument{
 if(id==='robot-zephyr-conveyor-fit')return createZephyrConveyorPart('fit');
 const doc=createDocument(t(id==='robot-zephyr-conveyor-print'?'Zephyr conveyor PLA print layout':'Zephyr 3-axis sorting conveyor'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-zephyr-conveyor-print'){
  addPart(doc,'frame','frame',[0,-30,0]);
  addPart(doc,'pusher','pusher',[-45,35,0]);
  addPart(doc,'paddleWheel','paddle-wheel',[-10,35,0]);
  addPart(doc,'diverter','diverter',[30,35,0]);
  addPart(doc,'parcel','parcel',[65,35,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05};
 doc.joints=[];

 addPart(doc,'frame','frame',[0,0,0],[0,0,0],'static',.04);
 addPart(doc,'pusher','pusher',[-48,0,8]);
 addPart(doc,'paddleWheel','paddle-wheel',[22,0,14]);
 addPart(doc,'diverter','diverter',[50,-34,11]);
 addPart(doc,'parcel','parcel',[-26,0,6.2],[0,0,0],'dynamic',.04);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 const feedSlider=jointAtWorldFrame(doc,'slider','frame','pusher',[-48,0,15],[1,0,0]);
 feedSlider.id='feed-a';
 feedSlider.limits=[...zephyrConveyorDimensions.feedLimitsMm];
 feedSlider.control={port:'A'};
 doc.joints!.push(feedSlider);

 const rollerJoint=jointAtWorldFrame(doc,'hinge','frame','paddle-wheel',[22,0,28],[0,1,0]);
 rollerJoint.id='roller-b';
 rollerJoint.control={port:'B'};
 doc.joints!.push(rollerJoint);

 for(const [key,original]of Object.entries(servoMotor.nodes)){
  const node=structuredClone(original);
  node.id=`gate-${key}`;
  if(node.kind==='boolean')node.inputs=node.inputs.map(input=>`gate-${input}`);
  if(servoMotor.roots.includes(key)){
   node.transform.position=[50,-34,6];
   node.transform.rotation=[0,0,0];
  }
  node.name=t('Exit diverter servo')+(key==='shaft'?' · '+t('Output spline'):'');
  doc.nodes[node.id]=node;
 }
 doc.roots.push('gate-casing','gate-shaft');
 fixed(doc,'frame','gate-casing');

 const deg=Math.PI/180;
 const gateLimit=zephyrConveyorDimensions.gateLimitDeg*deg;
 const gateJoint=jointAtWorldFrame(doc,'hinge','gate-casing','gate-shaft',[50,-34,33.18],[0,0,1]);
 gateJoint.id='gate-c';
 gateJoint.limits=[-gateLimit,gateLimit];
 gateJoint.control={port:'C'};
 doc.joints!.push(gateJoint);
 fixed(doc,'gate-shaft','diverter');

 doc.tracers=[{id:'parcel-path',bodyId:'parcel',point:[0,0,7],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function zephyrConveyorPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-zephyr-conveyor-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-zephyr-conveyor-print'){
  geometries.push(
   new THREE.BoxGeometry(140,68,6).translate(0,-30,3),
   new THREE.BoxGeometry(12,22,14).translate(-45,35,7),
   new THREE.BoxGeometry(28,12,14).translate(-10,35,7),
   new THREE.BoxGeometry(8,34,8).translate(30,49,28),
   new THREE.BoxGeometry(14,14,14).translate(65,35,7),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(140,68,6).translate(0,0,3),
   new THREE.BoxGeometry(12,22,14).translate(-48,0,15),
   new THREE.BoxGeometry(28,12,14).translate(22,0,28),
   new THREE.BoxGeometry(8,34,8).translate(50,-20,39),
   new THREE.BoxGeometry(14,14,14).translate(-26,0,13.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
