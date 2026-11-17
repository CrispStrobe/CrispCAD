// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const TITAN_VISE_ID='robot-titan-vise';
export const titanViseCatalog=[
 {id:TITAN_VISE_ID,name:'Titan 3-axis rotary vise',category:'Robots',description:'A PLA-printable rotary indexing vise with an Adafruit 1143 turntable servo (A), opposing left (B) and right (C) clamping jaw sliders, and a removable workpiece block.',keywords:'robot vise clamp rotary indexer jaws slider servo workpiece pla printable adafruit 1143',color:'#ea580c'},
 {id:'robot-titan-vise-print',name:'Titan vise PLA print layout',category:'Robots',description:'All original PLA parts for the Titan rotary vise (deck base, rotary bed, left & right clamping jaws, workpiece), laid out in support-free print orientation.',keywords:'robot vise pla base bed jaws workpiece print layout',color:'#ea580c'},
 {id:'robot-titan-vise-fit',name:'Titan vise spline & jaw gauge',category:'Robots',description:'Micro-servo 1143 spline socket & jaw rail clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot vise tolerance coupon servo spline jaw fit gauge 1143',color:'#e8ab47'},
];
export const isTitanVise=(id:string)=>titanViseCatalog.some(p=>p.id===id);
export const titanViseDimensions=Object.freeze({
 indexerLimitDeg:120,
 jawLimitsMm:[0,16] as const,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Titan 3-axis rotary vise part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const titanVisePartPrograms={
 base:program(`let deck=move([0,0,3],box(120,84,6));
let leftPillar=move([-48,0,18],box(12,36,24));
let rightPillar=move([48,0,18],box(12,36,24));
return union(deck,leftPillar,rightPillar);`),

 rotaryBed:program(`return move([0,0,3],cylinder(22,6,24));`),

 jawLeft:program(`return move([0,0,6],box(16,22,12));`),

 jawRight:program(`return move([0,0,6],box(16,22,12));`),

 workpiece:program(`return move([0,0,7],box(16,16,14));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(16.3,16.3,10))
);
return subtract(bar,holes);`),
} as const;

export type TitanVisePart=keyof typeof titanVisePartPrograms;

const names:Record<TitanVisePart,string>={
 base:'Vise deck & guide base',
 rotaryBed:'Rotary indexing bed',
 jawLeft:'Left clamping jaw',
 jawRight:'Right clamping jaw',
 workpiece:'Workpiece block',
 fit:'Titan vise spline & jaw gauge',
};

const colors:Record<TitanVisePart,string>={
 base:'#9a3412',
 rotaryBed:'#ea580c',
 jawLeft:'#fb923c',
 jawRight:'#fdba74',
 workpiece:'#f59e0b',
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

const partCollisions:Partial<Record<TitanVisePart,CollisionPiece[]>>={
 base:[boxPiece(0,0,3,120,84,6),boxPiece(-48,0,18,12,36,24),boxPiece(48,0,18,12,36,24)],
 rotaryBed:[boxPiece(0,0,3,36,36,6)],
 jawLeft:[boxPiece(0,0,6,16,22,12)],
 jawRight:[boxPiece(0,0,6,16,22,12)],
 workpiece:[boxPiece(0,0,7,16,16,14)],
};

function addPart(doc:CadDocument,part:TitanVisePart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.35){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(titanVisePartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:TITAN_VISE_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createTitanVisePart(part:TitanVisePart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-titan-vise-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis rotary vise (indexer A, left jaw B, right jaw C) with workpiece. */
export function createTitanViseDocument(id=TITAN_VISE_ID):CadDocument{
 if(id==='robot-titan-vise-fit')return createTitanVisePart('fit');
 const doc=createDocument(t(id==='robot-titan-vise-print'?'Titan vise PLA print layout':'Titan 3-axis rotary vise'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-titan-vise-print'){
  addPart(doc,'base','base',[0,-40,0]);
  addPart(doc,'rotaryBed','rotary-bed',[-40,35,0]);
  addPart(doc,'jawLeft','jaw-left',[10,35,0]);
  addPart(doc,'jawRight','jaw-right',[40,35,0]);
  addPart(doc,'workpiece','workpiece',[70,35,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05};
 doc.joints=[];

 addPart(doc,'base','base',[0,0,0],[0,0,0],'static',.2);
 addPart(doc,'rotaryBed','rotary-bed',[0,0,35],[0,0,0],'dynamic',.4);
 addPart(doc,'jawLeft','jaw-left',[-30,0,42],[0,0,0],'dynamic',.45);
 addPart(doc,'jawRight','jaw-right',[30,0,42],[0,0,0],'dynamic',.45);
 addPart(doc,'workpiece','workpiece',[0,0,41.2],[0,0,0],'dynamic',.4);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 for(const [key,original]of Object.entries(servoMotor.nodes)){
  const node=structuredClone(original);
  node.id=`indexer-${key}`;
  if(node.kind==='boolean')node.inputs=node.inputs.map(input=>`indexer-${input}`);
  if(servoMotor.roots.includes(key)){
   node.transform.position=[0,0,6];
   node.transform.rotation=[0,0,0];
  }
  node.name=t('Rotary indexer servo')+(key==='shaft'?' · '+t('Output spline'):'');
  doc.nodes[node.id]=node;
 }
 doc.roots.push('indexer-casing','indexer-shaft');
 fixed(doc,'base','indexer-casing');

 const deg=Math.PI/180;
 const indexerLimit=titanViseDimensions.indexerLimitDeg*deg;
 const indexerJoint=jointAtWorldFrame(doc,'hinge','indexer-casing','indexer-shaft',[0,0,33.18],[0,0,1]);
 indexerJoint.id='indexer-a';
 indexerJoint.limits=[-indexerLimit,indexerLimit];
 indexerJoint.control={port:'A'};
 doc.joints!.push(indexerJoint);
 fixed(doc,'indexer-shaft','rotary-bed');

 const leftSlider=jointAtWorldFrame(doc,'slider','base','jaw-left',[-30,0,48],[1,0,0]);
 leftSlider.id='jaw-left-b';
 leftSlider.limits=[...titanViseDimensions.jawLimitsMm];
 leftSlider.control={port:'B'};
 doc.joints!.push(leftSlider);

 const rightSlider=jointAtWorldFrame(doc,'slider','base','jaw-right',[30,0,48],[-1,0,0]);
 rightSlider.id='jaw-right-c';
 rightSlider.limits=[...titanViseDimensions.jawLimitsMm];
 rightSlider.control={port:'C'};
 doc.joints!.push(rightSlider);

 doc.tracers=[{id:'workpiece-spin',bodyId:'workpiece',point:[8,0,7],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function titanVisePreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-titan-vise-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-titan-vise-print'){
  geometries.push(
   new THREE.BoxGeometry(120,84,6).translate(0,-40,3),
   new THREE.CylinderGeometry(22,22,6,20).rotateX(Math.PI/2).translate(-40,35,3),
   new THREE.BoxGeometry(16,22,12).translate(10,35,6),
   new THREE.BoxGeometry(16,22,12).translate(40,35,6),
   new THREE.BoxGeometry(16,16,14).translate(70,35,7),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(120,84,6).translate(0,0,3),
   new THREE.CylinderGeometry(22,22,6,20).rotateX(Math.PI/2).translate(0,0,38),
   new THREE.BoxGeometry(16,22,12).translate(-30,0,48),
   new THREE.BoxGeometry(16,22,12).translate(30,0,48),
   new THREE.BoxGeometry(16,16,14).translate(0,0,48.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
