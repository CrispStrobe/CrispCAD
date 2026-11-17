// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';
import {labyrinthTilterCollisionAssembly} from './labyrinth-tilter-collisions.js';

export const LABYRINTH_TILTER_ID='robot-labyrinth-tilter';
export const labyrinthTilterCatalog=[
 {id:LABYRINTH_TILTER_ID,name:'Labyrinth 2-axis tilt maze',category:'Robots',description:'A PLA-printable 2-axis gimbaled marble labyrinth driven by three Adafruit 1143 micro-servos (outer roll A, inner pitch B, maze diverter gate C) with a rolling marble.',keywords:'robot maze labyrinth gimbal tilt servo marble pla printable adafruit 1143',color:'#10b981'},
 {id:'robot-labyrinth-tilter-print',name:'Labyrinth maze PLA print layout',category:'Robots',description:'All original PLA parts for the Labyrinth tilt maze (stand, outer gimbal ring, walled maze tray, diverter gate, marble), laid flat in support-free print orientation.',keywords:'robot maze labyrinth pla stand gimbal tray gate marble print layout',color:'#10b981'},
 {id:'robot-labyrinth-tilter-fit',name:'Labyrinth servo spline gauge',category:'Robots',description:'Five-step micro-servo 1143 spline socket (0.15–0.55 mm clearance) & M2/M3 mounting bore fit coupon.',keywords:'robot maze tolerance coupon servo spline fit gauge 1143',color:'#e8ab47'},
];
export const isLabyrinthTilter=(id:string)=>labyrinthTilterCatalog.some(p=>p.id===id);
export const labyrinthTilterDimensions=Object.freeze({
 gimbalLimitDeg:25,
 gateLimitDeg:60,
 marbleRadiusMm:7,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Labyrinth 2-axis tilt maze part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});
const cuts=(items:string[])=>items.join(',\n  ');

export const labyrinthTilterPartPrograms={
 stand:program(`param m3Bore:mm=3.4;
// Gimbal stand with 4x M3 mounting ears, right-side Feather M2.5 carrier bay,
// and lightened outer roll-servo riser pillar with M2 clamp bores.
let base=move([-16,0,3],box(132,28,6));
let ears=union(
  move([-72,0,3],box(16,48,6)),
  move([40,0,3],box(16,48,6))
);
let featherBay=move([14,0,3],box(64,34,6));
let featherBosses=union(
  ${[-11.4,39.4].flatMap(x=>[-11.43,11.43].map(y=>`move([${x},${y},7.5],cylinder(2.6,3,16))`)).join(',\n  ')}
);
let pillar=move([-78,0,29],box(8,28,50));
let body=union(base,ears,featherBay,featherBosses,pillar);
let baseBores=union(
  ${[[-72,-19],[-72,19],[40,-19],[40,19]].flatMap(([x,y])=>[
   `move([${x},${y},3],cylinder(m3Bore/2,8,16))`,
   `move([${x},${y},5],cylinder(3.1,3,16))`,
  ]).join(',\n  ')}
);
let featherBores=union(
  ${[-11.4,39.4].flatMap(x=>[-11.43,11.43].map(y=>`move([${x},${y},5],cylinder(1.1,12,12))`)).join(',\n  ')}
);
let wireSlot=move([-28,0,3],box(14,10,8));
let pillarCuts=union(
  move([-78,-8.4,48],rotate([0,90,0],cylinder(1.1,12,12))),
  move([-78,8.4,48],rotate([0,90,0],cylinder(1.1,12,12))),
  move([-78,0,26],rotate([0,90,0],cylinder(5.5,12,16)))
);
return subtract(body,
  ${cuts(['baseBores','featherBores','wireSlot','pillarCuts'])});`),

 outerRing:program(`param splineClearance:mm=0.2;
// Outer roll gimbal ring with -X MG90S spline socket, front inner-pitch M2 bores, and relief bores.
let leftBar=move([-42,0,4],box(6,88,8));
let rightBar=move([42,0,4],box(6,88,8));
let frontBar=move([0,-41,4],box(78,6,8));
let rearBar=move([0,41,4],box(78,6,8));
let body=union(leftBar,rightBar,frontBar,rearBar);
let splineSocket=move([-43.5,0,4],rotate([0,90,0],cylinder((5.0 mm + splineClearance)/2,3.6,20)));
let screwBore=move([-42,0,4],rotate([0,90,0],cylinder(1.15,10,16)));
let screwCs=move([-39.8,0,4],rotate([0,90,0],cylinder(2.2,2.4,16)));
let innerM2Bores=union(
  move([-6,-41,4],cylinder(1.1,10,12)),
  move([6,-41,4],cylinder(1.1,10,12))
);
let reliefBores=union(
  ${[-24,24].flatMap(y=>[-42,42].map(x=>`move([${x},${y},4],cylinder(1.7,10,12))`)).join(',\n  ')},
  move([-24,41,4],cylinder(1.7,10,12)),
  move([24,41,4],cylinder(1.7,10,12))
);
return subtract(body,
  ${cuts(['splineSocket','screwBore','screwCs','innerM2Bores','reliefBores'])});`),

 mazeTray:program(`// Walled marble labyrinth tray with M2 gate-servo pilot bores and floor inspection bores.
let floor=move([0,0,2],box(70,72,4));
let north=move([0,34,9],box(70,4,14));
let south=move([0,-34,9],box(70,4,14));
let west=move([-33,0,9],box(4,64,14));
let east=move([33,0,9],box(4,64,14));
let baffle=move([-8,-11,9],box(4,42,14));
let cornerGuide=move([22,24,9],box(4,16,14));
let body=union(floor,north,south,west,east,baffle,cornerGuide);
let gateBores=union(
  move([20,1.6,2],cylinder(1.1,8,12)),
  move([20,28.7,2],cylinder(1.1,8,12)),
  move([22,-22,2],cylinder(1.5,8,12)),
  move([22,-6,2],cylinder(1.5,8,12)),
  move([6,22,2],cylinder(1.5,8,12)),
  move([-22,22,2],cylinder(1.5,8,12))
);
return subtract(body,gateBores);`),

 diverter:program(`param splineClearance:mm=0.2;
// Inverted-servo diverter gate with bottom Ø5.0 mm spline socket, M2 through-bore, and paddle fin.
let hub=move([0,0,2.5],cylinder(5.5,5,20));
let arm=move([-10,0,2.5],box(30,8,5));
let fin=move([-22,0,13.5],box(6,6,23));
let body=union(hub,arm,fin);
let splineSocket=move([0,0,1.4],cylinder((5.0 mm + splineClearance)/2,3.2,20));
let screwBore=move([0,0,2.5],cylinder(1.15,8,16));
let armBores=union(
  move([-10,0,2.5],cylinder(1.7,8,12)),
  move([-16,0,2.5],cylinder(1.5,8,12))
);
return subtract(body,
  ${cuts(['splineSocket','screwBore','armBores'])});`),

 marble:program(`return move([0,0,7],sphere(7,20));`),

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

function addPart(doc:CadDocument,part:LabyrinthTilterPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.2){
 const collisionAssembly=labyrinthTilterCollisionAssembly(part);
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
 if(id==='robot-labyrinth-tilter-fit')geometries.push(new THREE.BoxGeometry(86,22,4).translate(0,0,2));
 else if(id==='robot-labyrinth-tilter-print'){
  geometries.push(
   new THREE.BoxGeometry(132,48,6).translate(-11,-65,3),
   new THREE.BoxGeometry(90,88,8).translate(-45,45,4),
   new THREE.BoxGeometry(70,72,4).translate(50,45,2),
   new THREE.SphereGeometry(7,16,12).translate(65,-20,7),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(132,48,6).translate(-16,0,3),
   new THREE.BoxGeometry(8,28,50).translate(-78,0,29),
   new THREE.BoxGeometry(90,88,8).translate(0,0,48),
   new THREE.BoxGeometry(70,72,4).translate(0,0,46),
   new THREE.SphereGeometry(7,16,12).translate(-20,-18,55.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
