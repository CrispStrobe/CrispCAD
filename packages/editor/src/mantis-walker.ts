import {addRobotElectronics} from './robot-electronics.js';
// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';
import {mantisWalkerCollisionAssembly} from './mantis-walker-collisions.js';

export const MANTIS_WALKER_ID='robot-mantis-walker';
export const mantisWalkerCatalog=[
 {id:MANTIS_WALKER_ID,name:'Mantis 3-servo walker',category:'Robots',description:'A PLA-printable wheelless quadruped walker driven by three Adafruit 1143 micro-servos: coupled left/right leg rockers (ports A/B), active weight-shift roll pendulum (port C), and removable electronics carrier.',keywords:'robot walker quadruped legged servo pla printable adafruit 1143 mantis',color:'#8b5cf6'},
 {id:'robot-mantis-walker-print',name:'Mantis walker PLA print layout',category:'Robots',description:'All original PLA parts for the Mantis walker (torso spine, two coupled leg rockers, weight-shift pendulum, electronics carrier), laid flat in support-free print orientation.',keywords:'robot walker pla torso leg rocker pendulum carrier print layout',color:'#8b5cf6'},
 {id:'robot-mantis-walker-fit',name:'Mantis servo spline gauge',category:'Robots',description:'Five micro-servo 1143 spline sockets (0.15–0.55 mm clearance) plus M2/M2.5 hardware bores. Print this first to tune your servo horn fit.',keywords:'robot walker tolerance coupon servo spline fit gauge 1143',color:'#e8ab47'},
 {id:'robot-mantis-walker-carrier',name:'Mantis electronics carrier',category:'Robots',description:'Original removable PLA carrier for a Feather controller and battery lead tie-downs, with M2.5 mounting bores matching the Mantis deck.',keywords:'robot walker pla electronics carrier feather mounting board',color:'#a78bfa'},
];
export const isMantisWalker=(id:string)=>mantisWalkerCatalog.some(p=>p.id===id);
export const mantisWalkerDimensions=Object.freeze({
 torsoLength:108,
 torsoWidth:32,
 torsoZ:20,
 hipSpreadX:26,
 hipY:16,
 hipZ:26,
 rollAnchorX:0,
 rollAnchorZ:44,
 hipLimitDeg:35,
 rollLimitDeg:40,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Mantis 3-servo walker part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});
const cuts=(items:string[])=>items.join(',\n  ');

export const mantisWalkerPartPrograms={
 torso:program(`param splineClearance:mm=0.2;
// Flat underside at Z=0 (world Z=20..32 main spine, Z=32..39.5 roll saddle).
// Open-top hip servo pockets hold horizontal MG90S casings at Y=+16 (X=+26) and Y=-16 (X=-26).
let spine=hull(move([-38,0,6],cylinder(16,12,32)),move([38,0,6],cylinder(16,12,32)));
let hipFlanges=union(move([21,0,6],box(34,32,12)),move([-21,0,6],box(34,32,12)));
let saddle=move([-15,0,15.75],box(24,18,7.5));
let body=union(spine,hipFlanges,saddle);
let leftPocket=move([20.85,2.41,7],box(31.7,27.6,12));
let rightPocket=move([-20.85,-2.41,7],box(31.7,27.6,12));
let leftSplineExit=move([26,15,6],rotate([90,0,0],cylinder(4.2,6,24)));
let rightSplineExit=move([-26,-15,6],rotate([90,0,0],cylinder(4.2,6,24)));
let rollPocket=move([-13.6,0,24],box(27.6,22,12));
let hipEars=union(
  move([2.5,2.4,6],box(4,12,16)),
  move([39.2,2.4,6],box(4,12,16)),
  move([-2.5,-2.4,6],box(4,12,16)),
  move([-39.2,-2.4,6],box(4,12,16))
);
let rollBores=union(
  move([-14,-8,16],cylinder(1.15,12,16)),
  move([-14,8,16],cylinder(1.15,12,16))
);
let carrierBores=union(
  move([24,-12,6],cylinder(1.4,16,16)),
  move([24,12,6],cylinder(1.4,16,16)),
  move([46,-12,6],cylinder(1.4,16,16)),
  move([46,12,6],cylinder(1.4,16,16))
);
let wireSlot=move([-4,0,6],box(6,10,16));
return subtract(body,leftPocket,rightPocket,leftSplineExit,rightSplineExit,rollPocket,hipEars,rollBores,carrierBores,wireSlot);`),

 leg:program(`param splineClearance:mm=0.2;
// Authored flat on Z=0..6 (support-free). minY=0 forms flat ground feet at Y=+-40 when rotated [90,0,0].
let topBeam=hull(move([-40,24,3],cylinder(6,6,24)),move([40,24,3],cylinder(6,6,24)));
let hipHubL=move([26,26,3],cylinder(7.5,6,24));
let hipHubR=move([-26,26,3],cylinder(7.5,6,24));
let frontStrut=hull(move([40,24,3],cylinder(6,6,24)),move([40,5,3],cylinder(5,6,24)));
let rearStrut=hull(move([-40,24,3],cylinder(6,6,24)),move([-40,5,3],cylinder(5,6,24)));
let frontFoot=hull(move([36,3,3],cylinder(3,6,20)),move([44,3,3],cylinder(3,6,20)));
let rearFoot=hull(move([-44,3,3],cylinder(3,6,20)),move([-36,3,3],cylinder(3,6,20)));
let body=union(topBeam,hipHubL,hipHubR,frontStrut,rearStrut,frontFoot,rearFoot);
let sockets=union(
  move([26,26,4.2],cylinder((5.0 mm + splineClearance)/2,4.4,24)),
  move([-26,26,4.2],cylinder((5.0 mm + splineClearance)/2,4.4,24))
);
let screwBores=union(
  move([26,26,3],cylinder(1.15,10,16)),
  move([-26,26,3],cylinder(1.15,10,16))
);
let lighten=union(
  move([0,24,3],cylinder(2.6,10,16)),
  move([-13,24,3],cylinder(2.2,10,16)),
  move([13,24,3],cylinder(2.2,10,16))
);
return subtract(body,sockets,screwBores,lighten);`),

 pendulum:program(`param splineClearance:mm=0.2;
// Authored flat on Z=0..8. Rotated [90,0,90] in assembly so local Y=0 aligns with roll shaft at Z=44.
let hub=move([0,0,4],cylinder(7.5,8,24));
let arm=hull(move([0,0,4],cylinder(6.5,8,24)),move([0,26,4],box(12,6,8)));
let tray=move([0,32,4],box(28,14,8));
let railL=move([-12,32,9],box(4,14,2));
let railR=move([12,32,9],box(4,14,2));
let body=union(hub,arm,tray,railL,railR);
let socket=move([0,0,2],cylinder((5.0 mm + splineClearance)/2,4.8,24));
let screwBore=move([0,0,4],cylinder(1.15,12,16));
let massBores=union(
  move([-6.5,32,4],cylinder(1.4,12,16)),
  move([6.5,32,4],cylinder(1.4,12,16))
);
return subtract(body,socket,screwBore,massBores);`),

 carrier:program(`// Removable PLA electronics carrier with standoff pads and Feather M2.5 mounting bores.
let plate=hull(move([24,0,3.5],cylinder(15,3,24)),move([46,0,3.5],cylinder(15,3,24)));
let legs=union(
  move([24,-12,1],cylinder(3,2,16)),
  move([24,12,1],cylinder(3,2,16)),
  move([46,-12,1],cylinder(3,2,16)),
  move([46,12,1],cylinder(3,2,16))
);
let bosses=union(
  move([26,-8,6],cylinder(2.6,3,16)),
  move([26,8,6],cylinder(2.6,3,16)),
  move([44,-8,6],cylinder(2.6,3,16)),
  move([44,8,6],cylinder(2.6,3,16))
);
let mountBores=union(
  move([24,-12,3],cylinder(1.4,10,16)),
  move([24,12,3],cylinder(1.4,10,16)),
  move([46,-12,3],cylinder(1.4,10,16)),
  move([46,12,3],cylinder(1.4,10,16))
);
let boardBores=union(
  move([26,-8,5],cylinder(1.25,12,16)),
  move([26,8,5],cylinder(1.25,12,16)),
  move([44,-8,5],cylinder(1.25,12,16)),
  move([44,8,5],cylinder(1.25,12,16))
);
let wireSlot=move([35,0,3.5],box(6,8,6));
return subtract(union(plate,legs,bosses),mountBores,boardBores,wireSlot);`),

 fit:program(`// Five micro-servo spline sockets (0.15..0.55 mm clearance) identified by 1..5 dots + M2/M2.5 bores.
let plate=move([0,0,2.5],box(84,22,5));
return subtract(plate,
  ${cuts([.15,.25,.35,.45,.55].map((c,i)=>`move([${(i-2)*13-7},3,2.5],cylinder(${(5.0+c)/2},8,24))`))},
  move([28,4,2.5],cylinder(1.15,8,16)),
  move([36,4,2.5],cylinder(1.4,8,16)),
  ${cuts([0,1,2,3,4].flatMap(i=>Array.from({length:i+1},(_,j)=>`move([${(i-2)*13-7+(j-i/2)*2},-7,2.5],cylinder(0.55,8,12))`)))});`),
} as const;

export type MantisWalkerPart=keyof typeof mantisWalkerPartPrograms;

const names:Record<MantisWalkerPart,string>={
 torso:'Walker spine frame',
 leg:'Coupled leg rocker',
 pendulum:'Weight-shift roll pendulum',
 carrier:'PLA electronics carrier',
 fit:'Mantis servo spline gauge',
};

const colors:Record<MantisWalkerPart,string>={
 torso:'#4f46e5',
 leg:'#8b5cf6',
 pendulum:'#e8ab47',
 carrier:'#a78bfa',
 fit:'#e8ab47',
};

function addPart(doc:CadDocument,part:MantisWalkerPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],friction=.8,densityKgM3=1240){
 const collisionAssembly=mantisWalkerCollisionAssembly(part);
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(mantisWalkerPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),densityKgM3,material:'plastic',friction,restitution:.02,sourcePreset:MANTIS_WALKER_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createMantisWalkerPart(part:MantisWalkerPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-mantis-walker-${part}`;
 doc.version=8;
 addPart(doc,part,part,part==='carrier'?[-35,0,0]:[0,0,0]);
 return doc;
}

/** Assembled 3-servo wheelless Mantis walker with coupled leg rockers (A, B), roll counterweight (C), and electronics carrier. */
export function createMantisWalkerDocument(id=MANTIS_WALKER_ID):CadDocument{
 if(id==='robot-mantis-walker-fit')return createMantisWalkerPart('fit');
 if(id==='robot-mantis-walker-carrier')return createMantisWalkerPart('carrier');
 const doc=createDocument(t(id==='robot-mantis-walker-print'?'Mantis walker PLA print layout':'Mantis 3-servo walker'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-mantis-walker-print'){
  addPart(doc,'torso','torso',[-45,-40,0]);
  addPart(doc,'leg','left-leg',[-45,25,0]);
  addPart(doc,'leg','right-leg',[55,25,0]);
  addPart(doc,'pendulum','pendulum',[45,-40,0]);
  addPart(doc,'carrier','carrier',[45,-80,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:false,groundFriction:.9,groundRestitution:.02,selfCollisions:false};
 doc.joints=[];

 addPart(doc,'torso','torso',[0,0,20],[0,0,0],.3);
 // Leg rockers rotated [90,0,0] so local Z=0..6 maps to Y=-6..0, and local Y=0..30 maps to world Z=0..30.
 addPart(doc,'leg','left-leg',[0,23,0],[90,0,0],.95);
 addPart(doc,'leg','right-leg',[0,-17,0],[90,0,0],.95);
 // Roll pendulum rotated [90,0,90] so local Z=0..8 maps to X=0..8 and local Y=0..39 maps to Z=44..83.
 addPart(doc,'pendulum','pendulum',[0,0,44],[90,0,90],.2,2200);
 // Removable electronics carrier bolted onto the front deck of torso.
 addPart(doc,'carrier','carrier',[0,0,32],[0,0,0],.3);
 fixed(doc,'torso','carrier');

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 const addServo=(prefix:string,label:string,port:'A'|'B'|'C',position:Vec3,rotation:Vec3,anchor:Vec3,axis:Vec3,limits:[number,number],host:string,driven:string)=>{
  const casingAssembly=mantisWalkerCollisionAssembly('casing');
  const shaftAssembly=mantisWalkerCollisionAssembly('shaft');
  for(const [key,original]of Object.entries(servoMotor.nodes)){
   const node=structuredClone(original);
   node.id=`${prefix}-${key}`;
   if(node.kind==='boolean')node.inputs=node.inputs.map(input=>`${prefix}-${input}`);
   if(servoMotor.roots.includes(key)){
    node.transform.position=[...position];
    node.transform.rotation=[...rotation];
    if(key==='casing'&&casingAssembly)node.physics={...node.physics!,collisionAssembly:casingAssembly};
    if(key==='shaft'&&shaftAssembly)node.physics={...node.physics!,collisionAssembly:shaftAssembly};
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
 const hipLimit=mantisWalkerDimensions.hipLimitDeg*deg;
 const rollLimit=mantisWalkerDimensions.rollLimitDeg*deg;

 // Left hip servo (port A) nested horizontally in torso at X=+26, spline pointing +Y at [26, 16, 26].
 addServo('left-hip','Left hip servo','A',[26,-11.18,26],[-90,90,0],[26,16,26],[0,1,0],[-hipLimit,hipLimit],'torso','left-leg');
 // Right hip servo (port B) nested horizontally in torso at X=-26, spline pointing -Y at [-26, -16, 26].
 addServo('right-hip','Right hip servo','B',[-26,11.18,26],[90,90,0],[-26,-16,26],[0,1,0],[-hipLimit,hipLimit],'torso','right-leg');
 // Weight-shift roll servo (port C) in torso saddle at X=0, spline pointing +X at [0, 0, 44].
 addServo('roll','Roll balance servo','C',[-27.18,0,44],[0,90,0],[0,0,44],[1,0,0],[-rollLimit,rollLimit],'torso','pendulum');

 // Purchased Feather controller & pendulum LiPo pack envelopes fixed to their respective mounts.
 const feather='feather-envelope';
 doc.nodes[feather]={id:feather,name:t('Purchased Feather controller clearance'),kind:'box',size:[22.86,28,7],transform:{...identityTransform(),position:[35,0,43.5]},color:'#3f7291',physics:{...defaultPartPhysics(),densityKgM3:550,restitution:.02}};
 doc.roots.push(feather);
 fixed(doc,'carrier',feather);

 const battery='battery-envelope';
 doc.nodes[battery]={id:battery,name:t('Purchased LiPo counterweight clearance'),kind:'box',size:[10,24,14],transform:{...identityTransform(),position:[13,0,76]},color:'#465461',physics:{...defaultPartPhysics(),densityKgM3:1600,restitution:.02}};
 doc.roots.push(battery);
 fixed(doc,'pendulum',battery);

 addRobotElectronics(doc);
 doc.tracers=[{id:'walker-path',bodyId:'torso',point:[0,0,26],color:'#8b5cf6'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function mantisWalkerPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-mantis-walker-fit')geometries.push(new THREE.BoxGeometry(84,22,5).translate(0,0,2.5));
 else if(id==='robot-mantis-walker-carrier')geometries.push(new THREE.BoxGeometry(52,30,3).translate(0,0,1.5));
 else if(id==='robot-mantis-walker-print'){
  geometries.push(
   new THREE.BoxGeometry(108,32,12).translate(-45,-40,6),
   new THREE.BoxGeometry(92,30,6).translate(-45,40,3),
   new THREE.BoxGeometry(92,30,6).translate(55,40,3),
   new THREE.BoxGeometry(28,46,8).translate(45,-20,4),
   new THREE.BoxGeometry(52,30,3).translate(45,-80,1.5),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(108,32,12).translate(0,0,26),
   new THREE.BoxGeometry(92,6,12).translate(0,20,24),
   new THREE.BoxGeometry(16,6,20).translate(40,20,10),
   new THREE.BoxGeometry(16,6,20).translate(-40,20,10),
   new THREE.BoxGeometry(92,6,12).translate(0,-20,24),
   new THREE.BoxGeometry(16,6,20).translate(40,-20,10),
   new THREE.BoxGeometry(16,6,20).translate(-40,-20,10),
   new THREE.BoxGeometry(8,28,39).translate(4,0,63.5),
   new THREE.BoxGeometry(52,30,5).translate(35,0,34.5),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
