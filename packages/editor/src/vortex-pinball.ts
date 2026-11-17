// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';
import {vortexPinballCollisionAssembly} from './vortex-pinball-collisions.js';

export const VORTEX_PINBALL_ID='robot-vortex-pinball';
export const vortexPinballCatalog=[
 {id:VORTEX_PINBALL_ID,name:'Vortex 3-axis pinball arena',category:'Robots',description:'A PLA-printable tabletop pinball arena with two Adafruit 1143 micro-servo flippers (left A, right B), a linear shooter plunger slider (C), and a free playfield puck.',keywords:'robot pinball flipper plunger slider servo puck arena pla printable adafruit 1143',color:'#ec4899'},
 {id:'robot-vortex-pinball-print',name:'Vortex pinball PLA print layout',category:'Robots',description:'All original PLA parts for the Vortex pinball arena (walled playfield, left & right flippers, shooter plunger, puck), laid out in support-free print orientation.',keywords:'robot pinball pla arena flipper plunger puck print layout',color:'#ec4899'},
 {id:'robot-vortex-pinball-fit',name:'Vortex pinball spline & lane gauge',category:'Robots',description:'Five-step micro-servo 1143 spline socket (0.15–0.55 mm clearance) & shooter lane clearance coupon.',keywords:'robot pinball tolerance coupon servo spline lane fit gauge 1143',color:'#e8ab47'},
];
export const isVortexPinball=(id:string)=>vortexPinballCatalog.some(p=>p.id===id);
export const vortexPinballDimensions=Object.freeze({
 flipperLimitDeg:55,
 plungerLimitsMm:[0,36] as const,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Vortex 3-axis pinball arena part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});
const cuts=(items:string[])=>items.join(',\n  ');

const flipperProgram=(sign:1|-1)=>program(`param splineClearance:mm=0.2;
// Flipper paddle with bottom Ø5.0 mm MG90S spline socket, M2 countersunk bore, and lightened arm.
let hub=move([0,0,25],cylinder(6,10,20));
let arm=move([${sign*11},0,26],box(30,8,8));
let blade=move([${sign*22},0,13],box(8,8,26));
let body=union(hub,arm,blade);
let splineSocket=move([0,0,22],cylinder((5.0 mm + splineClearance)/2,4.2,24));
let screwBore=move([0,0,25],cylinder(1.15,12,16));
let screwCs=move([0,0,28.8],cylinder(2.3,2.8,16));
let armBores=union(
  move([${sign*10},0,26],rotate([90,0,0],cylinder(1.8,10,12))),
  move([${sign*17},0,26],rotate([90,0,0],cylinder(1.8,10,12)))
);
return subtract(body,
  ${cuts(['splineSocket','screwBore','screwCs','armBores'])});`);

export const vortexPinballPartPrograms={
 arena:program(`param m3Bore:mm=3.4;
// Pinball playfield deck with M3 mounting bores, upper-left Feather M2.5 carrier standoffs,
// flipper M2 pilot holes, and bumper post M3 bore.
let deck=move([0,0,3],box(120,160,6));
let leftWall=move([-57,0,12],box(6,160,16));
let rightWall=move([57,0,12],box(6,160,16));
let topWall=move([0,77,12],box(108,6,16));
let bottomWall=move([0,-77,12],box(108,6,16));
let bumper=move([0,34,12],box(16,16,16));
let featherBosses=union(
  ${[[-42.43,18.6],[-42.43,69.4],[-19.57,18.6],[-19.57,69.4]].map(([x,y])=>`move([${x},${y},7.5],cylinder(2.6,3,16))`).join(',\n  ')}
);
let body=union(deck,leftWall,rightWall,topWall,bottomWall,bumper,featherBosses);
let cornerBores=union(
  ${[[-49,-69],[49,-69],[-49,69],[49,69]].flatMap(([x,y])=>[
   `move([${x},${y},3],cylinder(m3Bore/2,8,16))`,
   `move([${x},${y},5],cylinder(3.1,3,16))`,
  ]).join(',\n  ')},
  move([0,34,10],cylinder(m3Bore/2,24,16))
);
let featherBores=union(
  ${[[-42.43,18.6],[-42.43,69.4],[-19.57,18.6],[-19.57,69.4]].map(([x,y])=>`move([${x},${y},5],cylinder(1.1,12,12))`).join(',\n  ')}
);
let flipperM2Bores=union(
  move([-28,-58.4,3],cylinder(1.1,8,12)),
  move([-28,-31.3,3],cylinder(1.1,8,12)),
  move([28,-58.4,3],cylinder(1.1,8,12)),
  move([28,-31.3,3],cylinder(1.1,8,12))
);
return subtract(body,
  ${cuts(['cornerBores','featherBores','flipperM2Bores'])});`),

 leftFlipper:flipperProgram(1),

 rightFlipper:flipperProgram(-1),

 plunger:program(`// Linear shooter plunger block with top M2.5 drive bore.
let block=move([0,0,7],box(12,16,14));
let bore=move([0,0,11],cylinder(1.35,8,12));
return subtract(block,bore);`),

 puck:program(`// Printable pinball puck with top alignment dimple.
let disc=move([0,0,7],cylinder(8,14,24));
let dimple=move([0,0,13.6],cylinder(3.0,1.2,16));
return subtract(disc,dimple);`),

 fit:program(`// Five-step servo spline (0.15..0.55 mm) & shooter lane clearance coupon.
let bar=hull(move([-32,0,2],cylinder(11,4,24)),move([32,0,2],cylinder(11,4,24)));
let endBlock=move([40,0,2],box(24,24,4));
let sockets=union(
  ${[0.15,0.25,0.35,0.45,0.55].map((c,i)=>`move([${-28+i*14},1,2.2],cylinder((5.0 mm + ${c} mm)/2,4.4,20))`).join(',\n  ')}
);
let dots=union(
  ${[0.15,0.25,0.35,0.45,0.55].flatMap((_,i)=>Array.from({length:i+1},(__,d)=>`move([${-30+i*14+d*1.3},-5.2,3.7],cylinder(0.45,0.9,10))`)).join(',\n  ')}
);
let laneTest=move([40,0,2],box(16.3,16.3,10));
return subtract(union(bar,endBlock),sockets,dots,laneTest);`),
} as const;

export type VortexPinballPart=keyof typeof vortexPinballPartPrograms;

const names:Record<VortexPinballPart,string>={
 arena:'Walled pinball playfield',
 leftFlipper:'Left flipper paddle',
 rightFlipper:'Right flipper paddle',
 plunger:'Linear shooter plunger',
 puck:'Pinball puck',
 fit:'Vortex pinball spline & lane gauge',
};

const colors:Record<VortexPinballPart,string>={
 arena:'#9d174d',
 leftFlipper:'#ec4899',
 rightFlipper:'#f472b6',
 plunger:'#e8ab47',
 puck:'#f59e0b',
 fit:'#e8ab47',
};

function addPart(doc:CadDocument,part:VortexPinballPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.05,restitution=.4){
 const collisionAssembly=vortexPinballCollisionAssembly(part);
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(vortexPinballPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution,sourcePreset:VORTEX_PINBALL_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createVortexPinballPart(part:VortexPinballPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-vortex-pinball-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis pinball arena (left flipper A, right flipper B, shooter plunger slider C) with puck. */
export function createVortexPinballDocument(id=VORTEX_PINBALL_ID):CadDocument{
 if(id==='robot-vortex-pinball-fit')return createVortexPinballPart('fit');
 const doc=createDocument(t(id==='robot-vortex-pinball-print'?'Vortex pinball PLA print layout':'Vortex 3-axis pinball arena'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-vortex-pinball-print'){
  addPart(doc,'arena','arena',[-20,0,0]);
  addPart(doc,'leftFlipper','left-flipper',[60,40,0]);
  addPart(doc,'rightFlipper','right-flipper',[60,-10,0]);
  addPart(doc,'plunger','plunger',[60,-50,0]);
  addPart(doc,'puck','puck',[60,-75,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05,selfCollisions:false};
 doc.joints=[];

 addPart(doc,'arena','arena',[0,0,0],[0,0,0],'static',.03,.5);
 addPart(doc,'leftFlipper','left-flipper',[-28,-50,13]);
 addPart(doc,'rightFlipper','right-flipper',[28,-50,13]);
 addPart(doc,'plunger','plunger',[44,-56,8]);
 addPart(doc,'puck','puck',[44,-36,6.2],[0,0,0],'dynamic',.02,.55);

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
 const flipperLimit=vortexPinballDimensions.flipperLimitDeg*deg;

 addServo('flip-left','Left flipper servo','A',[-28,-50,6],[0,0,0],[-28,-50,33.18],[0,0,1],[-flipperLimit,flipperLimit],'arena','left-flipper');
 addServo('flip-right','Right flipper servo','B',[28,-50,6],[0,0,0],[28,-50,33.18],[0,0,1],[-flipperLimit,flipperLimit],'arena','right-flipper');

 const plungerSlider=jointAtWorldFrame(doc,'slider','arena','plunger',[44,-56,15],[0,1,0]);
 plungerSlider.id='plunger-c';
 plungerSlider.limits=[...vortexPinballDimensions.plungerLimitsMm];
 plungerSlider.control={port:'C'};
 doc.joints!.push(plungerSlider);

 doc.tracers=[{id:'puck-path',bodyId:'puck',point:[0,0,7],color:'#f59e0b'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function vortexPinballPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-vortex-pinball-fit')geometries.push(new THREE.BoxGeometry(96,24,4).translate(4,0,2));
 else if(id==='robot-vortex-pinball-print'){
  geometries.push(
   new THREE.BoxGeometry(120,160,6).translate(-20,0,3),
   new THREE.BoxGeometry(30,8,8).translate(71,40,4),
   new THREE.BoxGeometry(30,8,8).translate(49,-10,4),
   new THREE.BoxGeometry(12,16,14).translate(60,-50,7),
   new THREE.CylinderGeometry(8,8,14,20).rotateX(Math.PI/2).translate(60,-75,7),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(120,160,6).translate(0,0,3),
   new THREE.BoxGeometry(16,16,16).translate(0,34,12),
   new THREE.BoxGeometry(30,8,8).translate(-17,-50,39),
   new THREE.BoxGeometry(30,8,8).translate(17,-50,39),
   new THREE.BoxGeometry(12,16,14).translate(44,-56,15),
   new THREE.CylinderGeometry(8,8,14,20).rotateX(Math.PI/2).translate(44,-36,13.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
