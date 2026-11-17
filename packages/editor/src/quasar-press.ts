import {addRobotElectronics} from './robot-electronics.js';
// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const QUASAR_PRESS_ID='robot-quasar-press';
export const quasarPressCatalog=[
 {id:QUASAR_PRESS_ID,name:'Quasar 3-axis rotary press',category:'Robots',description:'A PLA-printable rotary indexing stamping press with an Adafruit 1143 dial servo (A), vertical stamping ram slider (B), horizontal ejector wiper slider (C), and blank block.',keywords:'robot press stamp dial indexer ram wiper slider servo blank pla printable adafruit 1143',color:'#dc2626'},
 {id:'robot-quasar-press-print',name:'Quasar press PLA print layout',category:'Robots',description:'All original PLA parts for the Quasar rotary press (C-frame stand, dial plate, stamping ram, ejector wiper, blank block), laid out in support-free print orientation.',keywords:'robot press pla stand dial ram wiper blank print layout',color:'#dc2626'},
 {id:'robot-quasar-press-fit',name:'Quasar press spline & ram gauge',category:'Robots',description:'Micro-servo 1143 spline socket & stamping ram clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot press tolerance coupon servo spline ram fit gauge 1143',color:'#e8ab47'},
];
export const isQuasarPress=(id:string)=>quasarPressCatalog.some(p=>p.id===id);
export const quasarPressDimensions=Object.freeze({
 dialLimitDeg:120,
 ramLimitsMm:[-14,4] as const,
 ejectLimitsMm:[0,80] as const,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Quasar 3-axis rotary press part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const quasarPressPartPrograms={
 stand:program(`let base=move([0,0,3],box(120,100,6));
let column=move([0,48,36],box(32,14,60));
let head=move([10,22,62],box(60,68,8));
return subtract(union(base,column,head),move([20,0,62],box(14.8,14.8,24)));`),

 dialPlate:program(`let plate=move([0,0,4.5],cylinder(36,9,48));
// Through channel guides the blank during indexing. A low outer stop
// retains it; the ejector wedge lifts it over the stop after pressing.
let channel=move([0,0,9],box(16,100,6));
let stop=move([0,-28,6.3],box(16,2,1));
return union(subtract(plate,channel),stop);`),

 ram:program(`return move([0,0,7],box(14,14,14));`),

 wiper:program(`let wedge=move([0,5,0],rotate([90,0,0],extrude(10,[[-8,0],[8,0],[8,0.2],[-8,5]])));
// A printable carriage supports the wedge instead of an unrealistically
// light unsupported blade. Its 12 mm width clears the 16 mm dial channel.
let carriage=move([-16,0,3],box(22,12,6));
return union(wedge,carriage);`),

 blank:program(`return move([0,0,5],box(12,12,10));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(14.3,14.3,10))
);
return subtract(bar,holes);`),
} as const;

export type QuasarPressPart=keyof typeof quasarPressPartPrograms;

const names:Record<QuasarPressPart,string>={
 stand:'C-frame press stand',
 dialPlate:'Rotary indexing dial plate',
 ram:'Vertical stamping ram',
 wiper:'Horizontal ejector wiper',
 blank:'Press blank block',
 fit:'Quasar press spline & ram gauge',
};

const colors:Record<QuasarPressPart,string>={
 stand:'#991b1b',
 dialPlate:'#dc2626',
 ram:'#e8ab47',
 wiper:'#f87171',
 blank:'#f59e0b',
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

const partCollisions:Partial<Record<QuasarPressPart,CollisionPiece[]>>={
 ram:[boxPiece(0,0,7,14,14,14)],
 blank:[boxPiece(0,0,5,12,12,10)],
};

function addPart(doc:CadDocument,part:QuasarPressPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.2){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(quasarPressPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:QUASAR_PRESS_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createQuasarPressPart(part:QuasarPressPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-quasar-press-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis rotary press (dial A, ram slider B, ejector slider C) with blank. */
export function createQuasarPressDocument(id=QUASAR_PRESS_ID):CadDocument{
 if(id==='robot-quasar-press-fit')return createQuasarPressPart('fit');
 const doc=createDocument(t(id==='robot-quasar-press-print'?'Quasar press PLA print layout':'Quasar 3-axis rotary press'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-quasar-press-print'){
  addPart(doc,'stand','stand',[0,-35,0]);
  addPart(doc,'dialPlate','dial-plate',[-45,45,0]);
  addPart(doc,'ram','ram',[10,45,0]);
  addPart(doc,'wiper','wiper',[40,45,0]);
  addPart(doc,'blank','blank',[65,45,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05,selfCollisions:true};
 doc.joints=[];

 addPart(doc,'stand','stand',[0,0,0],[0,0,0],'static',.1);
 addPart(doc,'dialPlate','dial-plate',[0,0,35],[0,0,0],'dynamic',.4);
 addPart(doc,'ram','ram',[20,0,56]);
 addPart(doc,'wiper','wiper',[-50,0,41.1]);
 addPart(doc,'blank','blank',[0,-20,41.2],[0,0,0],'dynamic',.35);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 for(const [key,original]of Object.entries(servoMotor.nodes)){
  const node=structuredClone(original);
  node.id=`dial-${key}`;
  if(node.kind==='boolean')node.inputs=node.inputs.map(input=>`dial-${input}`);
  if(servoMotor.roots.includes(key)){
   node.transform.position=[0,0,6];
   node.transform.rotation=[0,0,0];
  }
  node.name=t('Rotary dial servo')+(key==='shaft'?' · '+t('Output spline'):'');
  doc.nodes[node.id]=node;
 }
 doc.roots.push('dial-casing','dial-shaft');
 fixed(doc,'stand','dial-casing');

 const deg=Math.PI/180;
 const dialLimit=quasarPressDimensions.dialLimitDeg*deg;
 const dialJoint=jointAtWorldFrame(doc,'hinge','dial-casing','dial-shaft',[0,0,33.18],[0,0,1]);
 dialJoint.id='dial-a';
 dialJoint.collideConnected=false;
 dialJoint.limits=[-dialLimit,dialLimit];
 dialJoint.control={port:'A'};
 doc.joints!.push(dialJoint);
 fixed(doc,'dial-shaft','dial-plate');

 const ramSlider=jointAtWorldFrame(doc,'slider','stand','ram',[20,0,63],[0,0,1]);
 ramSlider.id='ram-b';
 ramSlider.limits=[...quasarPressDimensions.ramLimitsMm];
 ramSlider.control={port:'B'};
 doc.joints!.push(ramSlider);

 const ejectSlider=jointAtWorldFrame(doc,'slider','stand','wiper',[-50,0,43.6],[1,0,0]);
 ejectSlider.id='eject-c';
 ejectSlider.limits=[...quasarPressDimensions.ejectLimitsMm];
 ejectSlider.control={port:'C'};
 doc.joints!.push(ejectSlider);

 addRobotElectronics(doc);
 doc.tracers=[{id:'blank-path',bodyId:'blank',point:[0,0,5],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function quasarPressPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-quasar-press-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-quasar-press-print'){
  geometries.push(
   new THREE.BoxGeometry(120,100,6).translate(0,-35,3),
   new THREE.CylinderGeometry(36,36,6,20).rotateX(Math.PI/2).translate(-45,45,3),
   new THREE.BoxGeometry(14,14,14).translate(10,45,7),
   new THREE.BoxGeometry(12,14,10).translate(40,45,5),
   new THREE.BoxGeometry(12,12,10).translate(65,45,5),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(120,100,6).translate(0,0,3),
   new THREE.BoxGeometry(32,14,60).translate(0,48,36),
   new THREE.BoxGeometry(60,68,8).translate(10,22,62),
   new THREE.CylinderGeometry(36,36,6,20).rotateX(Math.PI/2).translate(0,0,38),
   new THREE.BoxGeometry(14,14,14).translate(20,0,63),
   new THREE.BoxGeometry(12,14,10).translate(-50,0,43.6),
   new THREE.BoxGeometry(12,12,10).translate(0,-20,46.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
