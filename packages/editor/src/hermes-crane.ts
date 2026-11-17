// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const HERMES_CRANE_ID='robot-hermes-crane';
export const hermesCraneCatalog=[
 {id:HERMES_CRANE_ID,name:'Hermes 3-axis bridge crane',category:'Robots',description:'A PLA-printable overhead bridge crane with a lateral trolley slider (A), vertical hoist slider (B), Adafruit 1143 swivel spreader servo (C), and cargo crate.',keywords:'robot crane gantry bridge trolley hoist spreader servo crate pla printable adafruit 1143',color:'#0d9488'},
 {id:'robot-hermes-crane-print',name:'Hermes crane PLA print layout',category:'Robots',description:'All original PLA parts for the Hermes bridge crane (gantry frame, trolley, hoist bar, swivel spreader, cargo crate), laid out in support-free print orientation.',keywords:'robot crane pla gantry trolley hoist spreader crate print layout',color:'#0d9488'},
 {id:'robot-hermes-crane-fit',name:'Hermes crane spline & rail gauge',category:'Robots',description:'Micro-servo 1143 spline socket & trolley rail clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot crane tolerance coupon servo spline rail fit gauge 1143',color:'#e8ab47'},
];
export const isHermesCrane=(id:string)=>hermesCraneCatalog.some(p=>p.id===id);
export const hermesCraneDimensions=Object.freeze({
 bridgeLimitsMm:[-32,32] as const,
 hoistLimitsMm:[-16,0] as const,
 swivelLimitDeg:120,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Hermes 3-axis bridge crane part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const hermesCranePartPrograms={
 gantry:program(`let deck=move([0,0,3],box(124,80,6));
let leftPillar=move([-56,0,47],box(12,80,82));
let rightPillar=move([56,0,47],box(12,80,82));
let beam=move([0,0,84],box(100,24,8));
return union(deck,leftPillar,rightPillar,beam);`),

 trolley:program(`return move([0,0,4],box(28,28,8));`),

 hookBar:program(`return move([0,0,4],box(20,28,8));`),

 spreader:program(`let bar=move([0,0,4],box(36,10,8));
let tip=move([13,0,4.5],box(8,22,9));
return union(bar,tip);`),

 crate:program(`return move([0,0,8],box(16,16,16));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(20.3,8.3,10))
);
return subtract(bar,holes);`),
} as const;

export type HermesCranePart=keyof typeof hermesCranePartPrograms;

const names:Record<HermesCranePart,string>={
 gantry:'Overhead gantry frame',
 trolley:'Lateral bridge trolley',
 hookBar:'Vertical hoist carriage',
 spreader:'Swivel spreader paddle',
 crate:'Cargo crate',
 fit:'Hermes crane spline & rail gauge',
};

const colors:Record<HermesCranePart,string>={
 gantry:'#115e59',
 trolley:'#0d9488',
 hookBar:'#14b8a6',
 spreader:'#e8ab47',
 crate:'#f59e0b',
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

const partCollisions:Partial<Record<HermesCranePart,CollisionPiece[]>>={
 gantry:[boxPiece(0,0,3,124,80,6),boxPiece(-56,0,47,12,80,82),boxPiece(56,0,47,12,80,82),boxPiece(0,0,84,100,24,8)],
 trolley:[boxPiece(0,0,4,28,28,8)],
 hookBar:[boxPiece(0,0,4,20,28,8)],
 spreader:[boxPiece(0,0,4,36,10,8),boxPiece(13,0,4.5,8,22,9)],
 crate:[boxPiece(0,0,8,16,16,16)],
};

function addPart(doc:CadDocument,part:HermesCranePart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.15){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(hermesCranePartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:HERMES_CRANE_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createHermesCranePart(part:HermesCranePart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-hermes-crane-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis overhead bridge crane (bridge A, hoist B, swivel C) with cargo crate. */
export function createHermesCraneDocument(id=HERMES_CRANE_ID):CadDocument{
 if(id==='robot-hermes-crane-fit')return createHermesCranePart('fit');
 const doc=createDocument(t(id==='robot-hermes-crane-print'?'Hermes crane PLA print layout':'Hermes 3-axis bridge crane'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-hermes-crane-print'){
  addPart(doc,'gantry','gantry',[-10,-20,0]);
  addPart(doc,'trolley','trolley',[75,35,0]);
  addPart(doc,'hookBar','hook-bar',[75,0,0]);
  addPart(doc,'spreader','spreader',[75,-35,0]);
  addPart(doc,'crate','crate',[75,-70,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05};
 doc.joints=[];

 addPart(doc,'gantry','gantry',[0,0,0],[0,0,0],'static',.08);
 addPart(doc,'trolley','trolley',[0,0,70]);
 addPart(doc,'hookBar','hook-bar',[0,0,60]);
 addPart(doc,'spreader','spreader',[0,0,23]);
 addPart(doc,'crate','crate',[24,0,6.2],[0,0,0],'dynamic',.08);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 const bridgeSlider=jointAtWorldFrame(doc,'slider','gantry','trolley',[0,0,74],[1,0,0]);
 bridgeSlider.id='bridge-a';
 bridgeSlider.limits=[...hermesCraneDimensions.bridgeLimitsMm];
 bridgeSlider.control={port:'A'};
 doc.joints!.push(bridgeSlider);

 const hoistSlider=jointAtWorldFrame(doc,'slider','trolley','hook-bar',[0,0,64],[0,0,1]);
 hoistSlider.id='hoist-b';
 hoistSlider.limits=[...hermesCraneDimensions.hoistLimitsMm];
 hoistSlider.control={port:'B'};
 doc.joints!.push(hoistSlider);

 for(const [key,original]of Object.entries(servoMotor.nodes)){
  const node=structuredClone(original);
  node.id=`swivel-${key}`;
  if(node.kind==='boolean')node.inputs=node.inputs.map(input=>`swivel-${input}`);
  if(servoMotor.roots.includes(key)){
   node.transform.position=[0,0,60];
   node.transform.rotation=[180,0,0];
  }
  node.name=t('Swivel spreader servo')+(key==='shaft'?' · '+t('Output spline'):'');
  doc.nodes[node.id]=node;
 }
 doc.roots.push('swivel-casing','swivel-shaft');
 fixed(doc,'hook-bar','swivel-casing');

 const deg=Math.PI/180;
 const swivelLimit=hermesCraneDimensions.swivelLimitDeg*deg;
 const swivelJoint=jointAtWorldFrame(doc,'hinge','swivel-casing','swivel-shaft',[0,0,32.82],[0,0,-1]);
 swivelJoint.id='swivel-c';
 swivelJoint.limits=[-swivelLimit,swivelLimit];
 swivelJoint.control={port:'C'};
 doc.joints!.push(swivelJoint);
 fixed(doc,'swivel-shaft','spreader');

 doc.tracers=[{id:'crate-path',bodyId:'crate',point:[0,0,8],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function hermesCranePreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-hermes-crane-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-hermes-crane-print'){
  geometries.push(
   new THREE.BoxGeometry(124,80,6).translate(-10,-20,3),
   new THREE.BoxGeometry(28,28,8).translate(75,35,4),
   new THREE.BoxGeometry(20,28,8).translate(75,0,4),
   new THREE.BoxGeometry(36,10,8).translate(75,-35,4),
   new THREE.BoxGeometry(16,16,16).translate(75,-70,8),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(124,80,6).translate(0,0,3),
   new THREE.BoxGeometry(12,80,82).translate(-56,0,47),
   new THREE.BoxGeometry(12,80,82).translate(56,0,47),
   new THREE.BoxGeometry(100,24,8).translate(0,0,84),
   new THREE.BoxGeometry(28,28,8).translate(0,0,74),
   new THREE.BoxGeometry(36,10,8).translate(0,0,27),
   new THREE.BoxGeometry(16,16,16).translate(24,0,14.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
