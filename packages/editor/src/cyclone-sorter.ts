import {addRobotElectronics} from './robot-electronics.js';
// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';
import {cycloneSorterCollisionAssembly} from './cyclone-sorter-collisions.js';

export const CYCLONE_SORTER_ID='robot-cyclone-sorter';
export const cycloneSorterCatalog=[
 {id:CYCLONE_SORTER_ID,name:'Cyclone 2-axis gantry sorter',category:'Robots',description:'A PLA-printable 2-axis XY linear gantry sorter (sliders A & B) with an Adafruit 1143 micro-servo sweeper paddle (C) and two dynamic sorting pucks.',keywords:'robot gantry xy sorter slider servo pla printable adafruit 1143 cyclone',color:'#0ea5e9'},
 {id:'robot-cyclone-sorter-print',name:'Cyclone gantry PLA print layout',category:'Robots',description:'All original PLA parts for the Cyclone gantry sorter (frame, X bridge, Y shuttle, sweeper paddle, sorting pucks), laid flat in support-free print orientation.',keywords:'robot gantry pla frame bridge shuttle paddle puck print layout',color:'#0ea5e9'},
 {id:'robot-cyclone-sorter-fit',name:'Cyclone rail & spline gauge',category:'Robots',description:'Five-step linear gantry rail and micro-servo 1143 spline tolerance gauge (0.15–0.55 mm clearance) plus M2/M3 fastener bores.',keywords:'robot gantry tolerance coupon slider rail spline fit gauge 1143',color:'#e8ab47'},
];
export const isCycloneSorter=(id:string)=>cycloneSorterCatalog.some(p=>p.id===id);
export const cycloneSorterDimensions=Object.freeze({
 frameX:140,
 frameY:130,
 railZ:32,
 xTravelMm:40,
 yTravelMm:35,
 sweepLimitDeg:60,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Cyclone 2-axis gantry sorter part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});
const cuts=(items:string[])=>items.join(',\n  ');

export const cycloneSorterPartPrograms={
 frame:program(`param m3Bore:mm=3.4;
param m25Pilot:mm=2.2;
// Gantry base frame with upper linear guide crowns, arch cutouts, M3 base ears,
// and an external rear Feather carrier shelf (Z=0..6, M2.5 standoffs clear of paddle sweep).
let leftRail=move([0,60,16],box(140,10,32));
let rightRail=move([0,-60,16],box(140,10,32));
let leftCrown=move([0,60,29.5],box(140,14,5));
let rightCrown=move([0,-60,29.5],box(140,14,5));
let rearTie=move([-66,0,6],box(8,130,12));
let frontTie=move([66,0,6],box(8,130,12));
let ears=union(
  ${[[-58,67],[58,67],[-58,-67],[58,-67]].map(([x,y])=>`move([${x},${y},3],box(16,14,6))`).join(',\n  ')}
);
let featherDeck=move([-82,0,3],box(32,64,6));
let featherBosses=union(
  ${[[-95.43,-25.4],[-95.43,25.4],[-72.57,-25.4],[-72.57,25.4]].map(([x,y])=>`move([${x},${y},7.5],cylinder(2.6,3,16))`).join(',\n  ')}
);
let body=union(leftRail,rightRail,leftCrown,rightCrown,rearTie,frontTie,ears,featherDeck,featherBosses);
let archCutouts=union(
  ${[-36,0,36].flatMap(x=>[-60,60].map(y=>`hull(move([${x-7},${y},13],rotate([90,0,0],cylinder(5,20,16))),move([${x+7},${y},13],rotate([90,0,0],cylinder(5,20,16))))`)).join(',\n  ')}
);
let baseBores=union(
  ${[[-58,68],[58,68],[-58,-68],[58,-68]].flatMap(([x,y])=>[
   `move([${x},${y},3],cylinder(m3Bore/2,8,16))`,
   `move([${x},${y},5],cylinder(3.2,3,16))`,
  ]).join(',\n  ')}
);
let featherBores=union(
  ${[[-95.43,-25.4],[-95.43,25.4],[-72.57,-25.4],[-72.57,25.4]].map(([x,y])=>`move([${x},${y},5],cylinder(m25Pilot/2,12,16))`).join(',\n  ')}
);
let wireSlots=union(
  move([-84,-10,3],box(12,8,10)),
  move([-84,10,3],box(12,8,10))
);
return subtract(body,
  ${cuts(['archCutouts','baseBores','featherBores','wireSlots'])});`),

 bridge:program(`param m3Bore:mm=3.4;
param m25Bore:mm=2.7;
// Twin-spar X-axis gantry bridge with end bearing shoes, truss pockets, and M3/M2.5 clamp bores.
let span=move([0,0,5],box(16,106,10));
let leftShoe=move([0,59,5],box(20,14,10));
let rightShoe=move([0,-59,5],box(20,14,10));
let body=union(span,leftShoe,rightShoe);
let pockets=union(
  ${[-36,-12,12,36].map(y=>`move([0,${y},5],box(7,16,12))`).join(',\n  ')}
);
let shoeBores=union(
  ${[[-5,59],[5,59],[-5,-59],[5,-59]].flatMap(([x,y])=>[
   `move([${x},${y},5],cylinder(m3Bore/2,12,16))`,
   `move([${x},${y},8.5],cylinder(3.1,4,16))`,
  ]).join(',\n  ')}
);
let beltBores=union(
  move([0,-49,5],cylinder(m25Bore/2,12,16)),
  move([0,49,5],cylinder(m25Bore/2,12,16))
);
return subtract(body,
  ${cuts(['pockets','shoeBores','beltBores'])});`),

 shuttle:program(`param railClearance:mm=0.4;
// Bridge-riding Y shuttle with 0.4 mm X-rail guide skirt, solid inverted MG90S mount surface at Z=0,
// and zip-tie / wire management slots flanking the servo casing.
let upperDeck=move([-8.2,-4.5,5.75],box(38.4,37,6.5));
let outerSkirt=move([-25.5 mm - railClearance,-4.5,1.5],box(3,37,3));
let servoBlock=move([1.5 mm + railClearance * 0.5,-4.5,4.5],box(19.0 mm - railClearance,37,9));
let body=union(upperDeck,outerSkirt,servoBlock);
let strapSlots=union(
  move([8,-14,4.5],box(3.5,8,12)),
  move([8,4,4.5],box(3.5,8,12)),
  move([-6.8,-14,5.75],box(2.5,8,12)),
  move([-6.8,4,5.75],box(2.5,8,12))
);
let weightCut=move([-16,-4.5,5.75],box(10,16,10));
let wireHole=move([0,11.5,4.5],cylinder(2.2,12,16));
return subtract(body,
  ${cuts(['strapSlots','weightCut','wireHole'])});`),

 paddle:program(`param splineClearance:mm=0.2;
// Inverted-servo sweeper paddle with top Ø5.0 mm MG90S spline socket, M2 countersunk screw bore,
// tapered hub web, and lightened sweeping blade.
let hub=move([0,0,7.25],cylinder(6.5,14.5,24));
let blade=hull(move([0,0,5.75],cylinder(4.5,11.5,20)),move([30,0,5.75],cylinder(3.5,11.5,16)));
let web=hull(move([0,0,12],cylinder(4.5,5,20)),move([14,0,8.75],box(4,8,5.5)));
let body=union(hub,blade,web);
let socket=move([0,0,12.25],cylinder((5.0 mm + splineClearance)/2,5.0,24));
let screwBore=move([0,0,7.25],cylinder(1.15,16,16));
let countersink=move([0,0,1.5],cylinder(2.3,3.2,16));
let bladeLighten=union(
  move([14,0,5.75],rotate([90,0,0],cylinder(2.6,10,16))),
  move([23,0,5.75],rotate([90,0,0],cylinder(2.2,10,16)))
);
return subtract(body,
  ${cuts(['socket','screwBore','countersink','bladeLighten'])});`),

 puck:program(`// Flat-bottomed PLA sorting puck with recessed top finger grip ring and center fiducial.
let body=move([0,0,6],cylinder(10,12,24));
let gripRing=move([0,0,11.4],subtract(cylinder(7.8,1.8,24),cylinder(4.6,2.4,20)));
let fiducial=move([0,0,11.6],cylinder(1.4,1.2,16));
return subtract(body,gripRing,fiducial);`),

 fit:program(`// Five-step servo spline & M2/M3 clearance coupon (0.15, 0.25, 0.35, 0.45, 0.55 mm).
let bar=hull(move([-32,0,2],cylinder(11,4,24)),move([32,0,2],cylinder(11,4,24)));
let railTest=move([0,-11,4],box(76,6,8));
let body=union(bar,railTest);
let sockets=union(
  ${[0.15,0.25,0.35,0.45,0.55].map((c,i)=>`move([${-28+i*14},1,2.2],cylinder((5.0 mm + ${c} mm)/2,4.4,20))`).join(',\n  ')}
);
let dots=union(
  ${[0.15,0.25,0.35,0.45,0.55].flatMap((_,i)=>Array.from({length:i+1},(__,d)=>`move([${-30+i*14+d*1.3},-5.2,3.7],cylinder(0.45,0.9,10))`)).join(',\n  ')}
);
let mBores=union(
  move([-33,6.5,2],cylinder(1.1,8,12)),
  move([33,6.5,2],cylinder(1.7,8,16)),
  move([0,-11,2.5],box(16.4,8,5.4))
);
return subtract(body,sockets,dots,mBores);`),
} as const;

export type CycloneSorterPart=keyof typeof cycloneSorterPartPrograms;

const names:Record<CycloneSorterPart,string>={
 frame:'Gantry base frame',
 bridge:'X-axis gantry bridge',
 shuttle:'Y-axis servo shuttle',
 paddle:'Servo sweeper paddle',
 puck:'Printable sorting puck',
 fit:'Cyclone rail & spline gauge',
};

const colors:Record<CycloneSorterPart,string>={
 frame:'#0369a1',
 bridge:'#0ea5e9',
 shuttle:'#38bdf8',
 paddle:'#e8ab47',
 puck:'#f43f5e',
 fit:'#e8ab47',
};

function addPart(doc:CadDocument,part:CycloneSorterPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.35){
 const collisionAssembly=cycloneSorterCollisionAssembly(part);
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(cycloneSorterPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.05,sourcePreset:CYCLONE_SORTER_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createCycloneSorterPart(part:CycloneSorterPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-cyclone-sorter-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 2-axis XY gantry sorter (sliders A, B) with Adafruit 1143 sweeper servo (C) and sorting pucks. */
export function createCycloneSorterDocument(id=CYCLONE_SORTER_ID):CadDocument{
 if(id==='robot-cyclone-sorter-fit')return createCycloneSorterPart('fit');
 const doc=createDocument(t(id==='robot-cyclone-sorter-print'?'Cyclone gantry PLA print layout':'Cyclone 2-axis gantry sorter'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-cyclone-sorter-print'){
  addPart(doc,'frame','frame',[15,0,0]);
  addPart(doc,'bridge','bridge',[105,0,0]);
  addPart(doc,'shuttle','shuttle',[65,-95,0]);
  addPart(doc,'paddle','paddle',[5,92,0]);
  addPart(doc,'puck','puck-1',[-45,92,0]);
  addPart(doc,'puck','puck-2',[-75,92,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.25,groundRestitution:.05};
 doc.joints=[];

 addPart(doc,'frame','frame',[0,0,0],[0,0,0],'static',.2);
 addPart(doc,'bridge','bridge',[0,0,34]);
 addPart(doc,'shuttle','shuttle',[16,0,42]);
 addPart(doc,'paddle','paddle',[16,0,1.5],[0,0,0],'dynamic',.7);
 addPart(doc,'puck','puck-1',[34,24,0],[0,0,0],'dynamic',.2);
 addPart(doc,'puck','puck-2',[34,-24,0],[0,0,0],'dynamic',.2);

 const xJoint=jointAtWorldFrame(doc,'slider','frame','bridge',[0,0,39],[1,0,0]);
 xJoint.id='gantry-a';
 xJoint.limits=[-cycloneSorterDimensions.xTravelMm,cycloneSorterDimensions.xTravelMm];
 xJoint.control={port:'A'};
 doc.joints.push(xJoint);

 const yJoint=jointAtWorldFrame(doc,'slider','bridge','shuttle',[16,0,42],[0,1,0]);
 yJoint.id='gantry-b';
 yJoint.limits=[-cycloneSorterDimensions.yTravelMm,cycloneSorterDimensions.yTravelMm];
 yJoint.control={port:'B'};
 doc.joints.push(yJoint);

 // Inverted micro-servo 1143 (port C) mounted under shuttle, spline pointing down at [16, 0, 14.82].
 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };
 for(const [key,original]of Object.entries(servoMotor.nodes)){
  const node=structuredClone(original);
  node.id='sweeper-'+key;
  if(node.kind==='boolean')node.inputs=node.inputs.map(input=>'sweeper-'+input);
  if(servoMotor.roots.includes(key)){
   node.transform.position=[16,0,42];
   node.transform.rotation=[180,0,0];
  }
  node.name=t('Sweeper servo')+(key==='shaft'?' · '+t('Output spline'):'');
  doc.nodes[node.id]=node;
 }
 doc.roots.push('sweeper-casing','sweeper-shaft');
 fixed(doc,'shuttle','sweeper-casing');
 const sweepLimit=(cycloneSorterDimensions.sweepLimitDeg*Math.PI)/180;
 const sweepJoint=jointAtWorldFrame(doc,'hinge','sweeper-casing','sweeper-shaft',[16,0,14.82],[0,0,1]);
 sweepJoint.id='sweeper-c';
 sweepJoint.limits=[-sweepLimit,sweepLimit];
 sweepJoint.control={port:'C'};
 doc.joints.push(sweepJoint);
 fixed(doc,'sweeper-shaft','paddle');

 addRobotElectronics(doc);
 doc.tracers=[{id:'sweeper-tip-path',bodyId:'paddle',point:[46,0,6],color:'#0ea5e9'}];
 doc.simulation={...defaultSimulationSettings(),...doc.simulation,selfCollisions:false};
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function cycloneSorterPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-cyclone-sorter-fit')geometries.push(new THREE.BoxGeometry(86,28,4).translate(0,-2,2));
 else if(id==='robot-cyclone-sorter-print'){
  geometries.push(
   new THREE.BoxGeometry(140,10,32).translate(15,60,16),
   new THREE.BoxGeometry(140,10,32).translate(15,-60,16),
   new THREE.BoxGeometry(32,64,6).translate(-67,0,3),
   new THREE.BoxGeometry(16,106,10).translate(105,0,5),
   new THREE.CylinderGeometry(10,10,12,20).rotateX(Math.PI/2).translate(-45,92,6),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(140,10,32).translate(0,60,16),
   new THREE.BoxGeometry(140,10,32).translate(0,-60,16),
   new THREE.BoxGeometry(8,130,12).translate(-66,0,6),
   new THREE.BoxGeometry(8,130,12).translate(66,0,6),
   new THREE.BoxGeometry(32,64,6).translate(-82,0,3),
   new THREE.BoxGeometry(16,106,10).translate(0,0,39),
   new THREE.BoxGeometry(38,37,6.5).translate(7.8,-4.5,47.75),
   new THREE.BoxGeometry(32,8,11.5).translate(32,0,7.25),
   new THREE.CylinderGeometry(10,10,12,20).rotateX(Math.PI/2).translate(34,24,6),
   new THREE.CylinderGeometry(10,10,12,20).rotateX(Math.PI/2).translate(34,-24,6),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
