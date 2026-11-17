// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';
import {heliosCatapultCollisionAssembly} from './helios-catapult-collisions.js';

export const HELIOS_CATAPULT_ID='robot-helios-catapult';
export const heliosCatapultCatalog=[
 {id:HELIOS_CATAPULT_ID,name:'Helios turret catapult',category:'Robots',description:'A PLA-printable 3-servo aiming catapult turret & swinging target gate driven by three Adafruit 1143 micro-servos (pan A, throw arm B, target gate C) with a launchable payload cube.',keywords:'robot catapult turret launcher servo pla printable adafruit 1143 helios',color:'#ef4444'},
 {id:'robot-helios-catapult-print',name:'Helios catapult PLA print layout',category:'Robots',description:'All original PLA parts for the Helios catapult (pedestal, turret, throwing arm, payload cube, target gate), laid flat in support-free print orientation.',keywords:'robot catapult pla pedestal turret arm cup payload gate print layout',color:'#ef4444'},
 {id:'robot-helios-catapult-fit',name:'Helios servo spline gauge',category:'Robots',description:'Five-step micro-servo 1143 spline socket (0.15–0.55 mm clearance) & M2/M3 mounting bore fit coupon.',keywords:'robot catapult tolerance coupon servo spline fit gauge 1143',color:'#e8ab47'},
];
export const isHeliosCatapult=(id:string)=>heliosCatapultCatalog.some(p=>p.id===id);
export const heliosCatapultDimensions=Object.freeze({
 panLimitDeg:90,
 throwMinDeg:-45,
 throwMaxDeg:85,
 gateLimitDeg:60,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Helios turret catapult part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});
const cuts=(items:string[])=>items.join(',\n  ');

export const heliosCatapultPartPrograms={
 pedestal:program(`param servoClearance:mm=0.2;
param m3Bore:mm=3.4;
// Circular turret base with rear Feather electronics bay (M2.5 bosses), 4x M3 countersunk bores,
// and central MG90S pan servo tower with ear seat, M2 pilot holes, and cable slot.
let baseDisc=move([0,0,3],cylinder(44,6,32));
let featherApron=hull(
  move([-26,-34,3],cylinder(8,6,16)),
  move([26,-34,3],cylinder(8,6,16)),
  move([0,-16,3],box(58,8,6))
);
let featherBosses=union(
  ${[[-25.4,-36],[25.4,-36],[-25.4,-13.14],[25.4,-13.14]].map(([x,y])=>`move([${x},${y},7.5],cylinder(2.6,3,16))`).join(',\n  ')}
);
let tower=move([0,5.5,16],box(28,39,32));
let body=union(baseDisc,featherApron,featherBosses,tower);
let servoPocket=move([0,5.3,18.9],box(12.2 mm + servoClearance,22.8 mm + servoClearance,28.4));
let earPocket=move([0,5.15,27.6],box(12.2 mm + servoClearance,31.6 mm + servoClearance,10));
let servoEarBores=union(
  move([0,-8.4,18],cylinder(1.1,14,12)),
  move([0,18.7,18],cylinder(1.1,14,12))
);
let wireSlot=move([0,21,9],box(6,12,8));
let baseBores=union(
  ${[[-34,16],[34,16],[-34,-4],[34,-4]].flatMap(([x,y])=>[
   `move([${x},${y},3],cylinder(m3Bore/2,8,16))`,
   `move([${x},${y},5],cylinder(3.2,3,16))`,
  ]).join(',\n  ')}
);
let featherBores=union(
  ${[[-25.4,-36],[25.4,-36],[-25.4,-13.14],[25.4,-13.14]].map(([x,y])=>`move([${x},${y},5],cylinder(1.1,12,12))`).join(',\n  ')}
);
let sideRelief=union(
  move([-26,28,3],cylinder(6,8,16)),
  move([26,28,3],cylinder(6,8,16)),
  move([-14,-25,3],box(8,5,8)),
  move([14,-25,3],box(8,5,8))
);
return subtract(body,
  ${cuts(['servoPocket','earPocket','servoEarBores','wireSlot','baseBores','featherBores','sideRelief'])});`),

 turret:program(`param splineClearance:mm=0.2;
// Panning fork with bottom Ø5.0 mm pan-spline socket, truss side cheeks,
// and upper horizontal MG90S throw-servo cradle with M2 ear mounting flanges.
let hub=move([0,0,3],cylinder(20,6,24));
let leftCheek=move([-10.5,8,27],box(7,30,48));
let rightCheek=move([10.5,8,27],box(7,30,48));
let rearBridge=move([0,20,27],box(28,6,48));
let lowEarBlock=move([0,3.7,20],box(16,5,6));
let highEarBlock=move([0,3.7,47.5],box(16,5,7));
let body=union(hub,leftCheek,rightCheek,rearBridge,lowEarBlock,highEarBlock);
let splineSocket=move([0,0,1.4],cylinder((5.0 mm + splineClearance)/2,3.2,24));
let screwBore=move([0,0,3],cylinder(1.15,8,16));
let screwCs=move([0,0,5.2],cylinder(2.3,2.2,16));
let throwEarBores=union(
  move([0,4,20.1],rotate([90,0,0],cylinder(1.1,12,12))),
  move([0,4,47.2],rotate([90,0,0],cylinder(1.1,12,12)))
);
let cheekCutouts=union(
  ${[18,36].map(z=>`move([0,10,${z}],rotate([0,90,0],cylinder(4.5,32,16)))`).join(',\n  ')},
  move([0,20,28],box(12,10,16))
);
return subtract(body,
  ${cuts(['splineSocket','screwBore','screwCs','throwEarBores','cheekCutouts'])});`),

 arm:program(`param splineClearance:mm=0.2;
// Lightened throwing lever with +Y Ø5.0 mm MG90S spline socket, M2 countersunk bore,
// and chamfers around the open-front payload launch cup.
let beam=move([-26,4,4],box(64,8,8));
let hubBoss=move([0,4,4],box(12,8,8));
let cupFloor=move([-48,4,4],box(20,20,8));
let cupBack=move([-56,4,12],box(4,20,8));
let cupSideL=move([-48,12,12],box(20,4,8));
let cupSideR=move([-48,-4,12],box(20,4,8));
let body=union(beam,hubBoss,cupFloor,cupBack,cupSideL,cupSideR);
let splineSocket=move([0,6.2,4],rotate([90,0,0],cylinder((5.0 mm + splineClearance)/2,4.2,24)));
let screwBore=move([0,4,4],rotate([90,0,0],cylinder(1.15,10,16)));
let screwCs=move([0,1.2,4],rotate([90,0,0],cylinder(2.3,2.8,16)));
let lighten=union(
  ${[-12,-23,-34].map(x=>`move([${x},4,4],rotate([90,0,0],cylinder(2.2,10,16)))`).join(',\n  ')}
);
return subtract(body,
  ${cuts(['splineSocket','screwBore','screwCs','lighten'])});`),

 payload:program(`// Printable 12 mm payload cube with recessed face dimples and top cross-hair alignment groove.
let cube=move([0,0,6],box(12,12,12));
let sideDimples=union(
  move([-6,0,6],rotate([0,90,0],cylinder(3.2,1.6,16))),
  move([6,0,6],rotate([0,90,0],cylinder(3.2,1.6,16))),
  move([0,-6,6],rotate([90,0,0],cylinder(3.2,1.6,16))),
  move([0,6,6],rotate([90,0,0],cylinder(3.2,1.6,16)))
);
let topCross=union(
  move([0,0,11.6],box(7,1.4,1.2)),
  move([0,0,11.6],box(1.4,7,1.2))
);
return subtract(cube,sideDimples,topCross);`),

 gateBase:program(`param servoClearance:mm=0.2;
param m3Bore:mm=3.4;
// Flanged target-gate servo pedestal with 4x M3 mounting bores and MG90S tower pocket.
let plate=move([0,2,3],box(38,48,6));
let tower=move([0,5.5,16],box(28,39,32));
let body=union(plate,tower);
let servoPocket=move([0,5.3,18.9],box(12.2 mm + servoClearance,22.8 mm + servoClearance,28.4));
let earPocket=move([0,5.15,27.6],box(12.2 mm + servoClearance,31.6 mm + servoClearance,10));
let earBores=union(
  move([0,-8.4,18],cylinder(1.1,14,12)),
  move([0,18.7,18],cylinder(1.1,14,12))
);
let wireSlot=move([0,21,9],box(6,12,8));
let baseBores=union(
  ${[[-14,-17],[14,-17],[-14,21],[14,21]].flatMap(([x,y])=>[
   `move([${x},${y},3],cylinder(m3Bore/2,8,16))`,
   `move([${x},${y},5],cylinder(3.1,3,16))`,
  ]).join(',\n  ')}
);
return subtract(body,
  ${cuts(['servoPocket','earPocket','earBores','wireSlot','baseBores'])});`),

 goalie:program(`param splineClearance:mm=0.2;
// Target gate swinging paddle with bottom Ø5.0 mm MG90S spline socket, M2 bore, and bullseye cutout.
let hub=move([0,0,3],cylinder(12,6,20));
let flag=hull(move([0,0,14],box(6,8,28)),move([0,26,14],rotate([0,90,0],cylinder(14,6,20))));
let body=union(hub,flag);
let splineSocket=move([0,0,1.4],cylinder((5.0 mm + splineClearance)/2,3.2,24));
let screwBore=move([0,0,3],cylinder(1.15,8,16));
let screwCs=move([0,0,5.2],cylinder(2.3,2.2,16));
let bullseye=subtract(move([0,22,14],rotate([0,90,0],cylinder(7.5,10,20))),move([0,22,14],rotate([0,90,0],cylinder(4.2,12,16))));
let slotCut=move([0,10,18],rotate([0,90,0],cylinder(3.0,10,16)));
return subtract(body,
  ${cuts(['splineSocket','screwBore','screwCs','bullseye','slotCut'])});`),

 fit:program(`// Five-step servo spline & M2/M3 clearance coupon (0.15, 0.25, 0.35, 0.45, 0.55 mm).
let bar=hull(move([-32,0,2],cylinder(11,4,24)),move([32,0,2],cylinder(11,4,24)));
let sockets=union(
  ${[0.15,0.25,0.35,0.45,0.55].map((c,i)=>`move([${-28+i*14},1,2.2],cylinder((5.0 mm + ${c} mm)/2,4.4,20))`).join(',\n  ')}
);
let dots=union(
  ${[0.15,0.25,0.35,0.45,0.55].flatMap((_,i)=>Array.from({length:i+1},(__,d)=>`move([${-30+i*14+d*1.3},-5.2,3.7],cylinder(0.45,0.9,10))`)).join(',\n  ')}
);
let mBores=union(
  move([-34,6.5,2],cylinder(1.1,8,12)),
  move([34,6.5,2],cylinder(1.7,8,16))
);
return subtract(bar,sockets,dots,mBores);`),
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

function addPart(doc:CadDocument,part:HeliosCatapultPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.35){
 const collisionAssembly=heliosCatapultCollisionAssembly(part);
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
  addPart(doc,'arm','arm',[30,45,0]);
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
 if(id==='robot-helios-catapult-fit')geometries.push(new THREE.BoxGeometry(86,22,4).translate(0,0,2));
 else if(id==='robot-helios-catapult-print'){
  geometries.push(
   new THREE.CylinderGeometry(44,44,6,24).rotateX(Math.PI/2).translate(-55,-35,3),
   new THREE.BoxGeometry(60,28,6).translate(-55,-61,3),
   new THREE.CylinderGeometry(20,20,6,24).rotateX(Math.PI/2).translate(45,-35,3),
   new THREE.BoxGeometry(64,20,8).translate(4,49,4),
   new THREE.BoxGeometry(38,48,6).translate(-65,47,3),
   new THREE.BoxGeometry(12,12,12).translate(-15,85,6),
  );
 }else{
  geometries.push(
   new THREE.CylinderGeometry(44,44,6,24).rotateX(Math.PI/2).translate(0,0,3),
   new THREE.BoxGeometry(60,28,6).translate(0,-26,3),
   new THREE.BoxGeometry(28,32,45).translate(0,9,62),
   new THREE.BoxGeometry(64,8,8).translate(-26,-12,62),
   new THREE.BoxGeometry(20,20,16).translate(-48,-12,66),
   new THREE.BoxGeometry(12,12,12).translate(-46,-12,72),
   new THREE.BoxGeometry(38,48,6).translate(95,2,3),
   new THREE.BoxGeometry(28,39,32).translate(95,5.5,16),
   new THREE.BoxGeometry(6,40,28).translate(95,18,47.5),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
