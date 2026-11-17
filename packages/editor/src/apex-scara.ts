// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';
import {apexScaraCollisionAssembly} from './apex-scara-collisions.js';

export const APEX_SCARA_ID='robot-apex-scara';
export const apexScaraCatalog=[
 {id:APEX_SCARA_ID,name:'Apex SCARA 3-axis arm',category:'Robots',description:'A PLA-printable 2-link SCARA planar robot arm with two Adafruit 1143 micro-servo joints (shoulder A, elbow B) and a vertical Z-quill slider (C) over a target puck.',keywords:'robot scara arm planar quill slider servo puck pla printable adafruit 1143',color:'#0284c7'},
 {id:'robot-apex-scara-print',name:'Apex SCARA PLA print layout',category:'Robots',description:'All original PLA parts for the Apex SCARA arm (pedestal, upper arm, forearm, Z-quill, target puck), laid out in support-free print orientation.',keywords:'robot scara pla pedestal arm forearm quill puck print layout',color:'#0284c7'},
 {id:'robot-apex-scara-fit',name:'Apex SCARA spline & quill gauge',category:'Robots',description:'Five-step micro-servo 1143 spline socket (0.15–0.55 mm clearance) & 12.4 mm Z-quill clearance fit coupon.',keywords:'robot scara tolerance coupon servo spline quill fit gauge 1143',color:'#e8ab47'},
];
export const isApexScara=(id:string)=>apexScaraCatalog.some(p=>p.id===id);
export const apexScaraDimensions=Object.freeze({
 shoulderLimitDeg:90,
 elbowLimitDeg:110,
 quillLimitsMm:[-17,10] as const,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Apex SCARA arm part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});
const cuts=(items:string[])=>items.join(',\n  ');

export const apexScaraPartPrograms={
 pedestal:program(`param m3Bore:mm=3.4;
// SCARA pedestal with 4x M3 base bores, rear Feather M2.5 carrier bay, and shoulder servo column.
let base=move([0,0,2.5],box(56,56,5));
let featherBay=move([-40,0,2.5],box(48,60,5));
let featherBosses=union(
  ${[-58,-35.14].flatMap(x=>[-25.4,25.4].map(y=>`move([${x},${y},6.5],cylinder(2.6,3,16))`)).join(',\n  ')}
);
let column=move([-14,0,17.5],box(12,36,29));
let body=union(base,featherBay,featherBosses,column);
let baseBores=union(
  ${[[-22,-22],[22,-22],[-22,22],[22,22]].flatMap(([x,y])=>[
   `move([${x},${y},2.5],cylinder(m3Bore/2,8,16))`,
   `move([${x},${y},4.2],cylinder(3.1,2.5,16))`,
  ]).join(',\n  ')}
);
let featherBores=union(
  ${[-58,-35.14].flatMap(x=>[-25.4,25.4].map(y=>`move([${x},${y},4.5],cylinder(1.1,10,12))`)).join(',\n  ')}
);
let shoulderM2=union(
  move([0,-8.4,2.5],cylinder(1.1,8,12)),
  move([0,18.7,2.5],cylinder(1.1,8,12))
);
let wireSlot=move([-28,0,2.5],box(10,10,8));
let colLighten=move([-14,0,18],rotate([0,90,0],cylinder(5.0,16,16)));
return subtract(body,
  ${cuts(['baseBores','featherBores','shoulderM2','wireSlot','colLighten'])});`),

 upperArm:program(`param splineClearance:mm=0.2;
// Rounded planar SCARA upper link with bottom Ø5.0 mm spline socket, elbow M2 bores, and truss cutouts.
let link=hull(move([-28,0,4],cylinder(13,8,24)),move([32,0,4],cylinder(13,8,24)));
let splineSocket=move([-28,0,1.4],cylinder((5.0 mm + splineClearance)/2,3.2,24));
let screwBore=move([-28,0,4],cylinder(1.15,10,16));
let screwCs=move([-28,0,6.8],cylinder(2.3,2.6,16));
let elbowM2=union(
  move([32,-8.4,4],cylinder(1.1,10,12)),
  move([32,10,4],cylinder(1.1,10,12)),
  move([22,0,4],cylinder(1.7,10,12))
);
let truss=union(
  ${[-14,0,12].map(x=>`move([${x},0,4],cylinder(4.0,10,16))`).join(',\n  ')}
);
return subtract(link,
  ${cuts(['splineSocket','screwBore','screwCs','elbowM2','truss'])});`),

 forearm:program(`param splineClearance:mm=0.2;
// Rounded SCARA forearm with bottom Ø5.0 mm elbow socket, truss pockets, and 12.4 mm quill guide bore.
let link=hull(move([-28,0,4],cylinder(10,8,24)),move([44,0,4],cylinder(11,8,24)));
let splineSocket=move([-28,0,1.4],cylinder((5.0 mm + splineClearance)/2,3.2,24));
let screwBore=move([-28,0,4],cylinder(1.15,10,16));
let screwCs=move([-28,0,6.8],cylinder(2.3,2.6,16));
let quillGuide=move([44,0,4],box(12.4,12.4,10));
let truss=union(
  ${[-12,6,24].map(x=>`move([${x},0,4],cylinder(3.4,10,16))`).join(',\n  ')}
);
return subtract(link,
  ${cuts(['splineSocket','screwBore','screwCs','quillGuide','truss'])});`),

 quill:program(`// Vertical Z-quill plunger with top 15 mm stop collar and M2.5 drive bore.
let shaft=move([0,0,32],box(12,12,64));
let collar=move([0,0,62],box(15,15,4));
let m25Bore=move([0,0,62],cylinder(1.35,8,12));
return subtract(union(shaft,collar),m25Bore);`),

 targetDisk:program(`// Flat-bottomed cylindrical target puck with top bullseye alignment groove.
let disc=move([0,0,7],cylinder(12,14,24));
let ring=move([0,0,13.8],subtract(cylinder(8.5,0.6,24),cylinder(5.2,0.8,20)));
return subtract(disc,ring);`),

 fit:program(`// Five-step servo spline (0.15..0.55 mm), 12.4 mm quill square bore, and M2/M3 clearance coupon.
let bar=hull(move([-32,0,2],cylinder(11,4,24)),move([32,0,2],cylinder(11,4,24)));
let sockets=union(
  ${[0.15,0.25,0.35,0.45,0.55].map((c,i)=>`move([${-28+i*14},1,2.2],cylinder((5.0 mm + ${c} mm)/2,4.4,20))`).join(',\n  ')}
);
let dots=union(
  ${[0.15,0.25,0.35,0.45,0.55].flatMap((_,i)=>Array.from({length:i+1},(__,d)=>`move([${-30+i*14+d*1.3},-5.2,3.7],cylinder(0.45,0.9,10))`)).join(',\n  ')}
);
let quillTest=move([38,0,2],box(12.4,12.4,10));
return subtract(union(bar,move([38,0,2],box(20,22,4))),sockets,dots,quillTest);`),
} as const;

export type ApexScaraPart=keyof typeof apexScaraPartPrograms;

const names:Record<ApexScaraPart,string>={
 pedestal:'SCARA pedestal base',
 upperArm:'SCARA upper arm',
 forearm:'SCARA forearm',
 quill:'Vertical Z-quill plunger',
 targetDisk:'Target puck',
 fit:'Apex SCARA spline & quill gauge',
};

const colors:Record<ApexScaraPart,string>={
 pedestal:'#0369a1',
 upperArm:'#0284c7',
 forearm:'#38bdf8',
 quill:'#e8ab47',
 targetDisk:'#f59e0b',
 fit:'#e8ab47',
};

function addPart(doc:CadDocument,part:ApexScaraPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.2){
 const collisionAssembly=apexScaraCollisionAssembly(part);
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(apexScaraPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:APEX_SCARA_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createApexScaraPart(part:ApexScaraPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-apex-scara-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 2-link planar SCARA arm (shoulder A, elbow B) with vertical Z-quill slider (C) and target puck. */
export function createApexScaraDocument(id=APEX_SCARA_ID):CadDocument{
 if(id==='robot-apex-scara-fit')return createApexScaraPart('fit');
 const doc=createDocument(t(id==='robot-apex-scara-print'?'Apex SCARA PLA print layout':'Apex SCARA 3-axis arm'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-apex-scara-print'){
  addPart(doc,'pedestal','pedestal',[15,-55,0]);
  addPart(doc,'upperArm','upper-arm',[-45,20,0]);
  addPart(doc,'forearm','forearm',[50,20,0]);
  addPart(doc,'quill','quill',[0,60,0]);
  addPart(doc,'targetDisk','target-disk',[60,-55,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05,selfCollisions:false};
 doc.joints=[];

 addPart(doc,'pedestal','pedestal',[0,0,0],[0,0,0],'static',.3);
 addPart(doc,'upperArm','upper-arm',[28,0,33.5]);
 addPart(doc,'forearm','forearm',[88,0,70]);
 addPart(doc,'quill','quill',[132,0,18]);
 addPart(doc,'targetDisk','target-disk',[132,18,0],[0,0,0],'dynamic',.08);

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
 const shoulderLimit=apexScaraDimensions.shoulderLimitDeg*deg;
 const elbowLimit=apexScaraDimensions.elbowLimitDeg*deg;

 addServo('shoulder','Shoulder servo','A',[0,0,5],[0,0,0],[0,0,32.18],[0,0,1],[-shoulderLimit,shoulderLimit],'pedestal','upper-arm');
 addServo('elbow','Elbow servo','B',[60,0,41.5],[0,0,0],[60,0,68.68],[0,0,1],[-elbowLimit,elbowLimit],'upper-arm','forearm');

 const quillSlider=jointAtWorldFrame(doc,'slider','forearm','quill',[132,0,74],[0,0,1]);
 quillSlider.id='quill-c';
 quillSlider.limits=[...apexScaraDimensions.quillLimitsMm];
 quillSlider.control={port:'C'};
 doc.joints!.push(quillSlider);

 doc.tracers=[{id:'quill-tip',bodyId:'quill',point:[0,0,0],color:'#e8ab47'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function apexScaraPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-apex-scara-fit')geometries.push(new THREE.BoxGeometry(92,22,4).translate(2,0,2));
 else if(id==='robot-apex-scara-print'){
  geometries.push(
   new THREE.BoxGeometry(100,60,5).translate(-2,-55,2.5),
   new THREE.BoxGeometry(86,26,8).translate(-43,20,4),
   new THREE.BoxGeometry(94,22,8).translate(58,20,4),
   new THREE.BoxGeometry(12,12,64).translate(0,60,32),
   new THREE.CylinderGeometry(12,12,14,20).rotateX(Math.PI/2).translate(60,-55,7),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(100,60,5).translate(-16,0,2.5),
   new THREE.BoxGeometry(12,36,29).translate(-14,0,17.5),
   new THREE.BoxGeometry(86,26,8).translate(30,0,37.5),
   new THREE.BoxGeometry(94,22,8).translate(96,0,74),
   new THREE.BoxGeometry(12,12,64).translate(132,0,50),
   new THREE.CylinderGeometry(12,12,14,20).rotateX(Math.PI/2).translate(132,18,7),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
