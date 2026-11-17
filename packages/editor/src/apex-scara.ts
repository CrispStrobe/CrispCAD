// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const APEX_SCARA_ID='robot-apex-scara';
export const apexScaraCatalog=[
 {id:APEX_SCARA_ID,name:'Apex SCARA 3-axis arm',category:'Robots',description:'A PLA-printable 2-link SCARA planar robot arm with two Adafruit 1143 micro-servo joints (shoulder A, elbow B) and a vertical Z-quill slider (C) over a target puck.',keywords:'robot scara arm planar quill slider servo puck pla printable adafruit 1143',color:'#0284c7'},
 {id:'robot-apex-scara-print',name:'Apex SCARA PLA print layout',category:'Robots',description:'All original PLA parts for the Apex SCARA arm (pedestal, upper arm, forearm, Z-quill, target puck), laid out in support-free print orientation.',keywords:'robot scara pla pedestal arm forearm quill puck print layout',color:'#0284c7'},
 {id:'robot-apex-scara-fit',name:'Apex SCARA spline & quill gauge',category:'Robots',description:'Micro-servo 1143 spline socket & Z-quill clearance fit coupon with 0.15–0.45 mm tolerance.',keywords:'robot scara tolerance coupon servo spline quill fit gauge 1143',color:'#e8ab47'},
];
export const isApexScara=(id:string)=>apexScaraCatalog.some(p=>p.id===id);
export const apexScaraDimensions=Object.freeze({
 shoulderLimitDeg:90,
 elbowLimitDeg:110,
 quillLimitsMm:[-17,10] as const,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Apex SCARA arm part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const apexScaraPartPrograms={
 pedestal:program(`let base=move([0,0,2.5],box(56,56,5));
let column=move([-14,0,18.5],box(12,36,27));
return union(base,column);`),

 upperArm:program(`return move([0,0,4],box(80,26,8));`),

 forearm:program(`return move([0,0,4],box(72,20,8));`),

 quill:program(`return move([0,0,32],box(12,12,64));`),

 targetDisk:program(`return move([0,0,7],cylinder(12,14,24));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(12.3,12.3,10))
);
return subtract(bar,holes);`),
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

type CollisionPiece={positions:number[];indices:number[]};
const boxPiece=(cx:number,cy:number,cz:number,sx:number,sy:number,sz:number):CollisionPiece=>{
 const x0=cx-sx/2,x1=cx+sx/2,y0=cy-sy/2,y1=cy+sy/2,z0=cz-sz/2,z1=cz+sz/2;
 return {
  positions:[x0,y0,z0,x1,y0,z0,x1,y1,z0,x0,y1,z0,x0,y0,z1,x1,y0,z1,x1,y1,z1,x0,y1,z1],
  indices:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7],
 };
};

const partCollisions:Partial<Record<ApexScaraPart,CollisionPiece[]>>={
 pedestal:[boxPiece(0,0,2.5,56,56,5),boxPiece(-14,0,18.5,12,36,27)],
 upperArm:[boxPiece(0,0,4,80,26,8)],
 forearm:[boxPiece(0,0,4,72,20,8)],
 quill:[boxPiece(0,0,32,12,12,64)],
 targetDisk:[boxPiece(0,0,7,20,20,14)],
};

function addPart(doc:CadDocument,part:ApexScaraPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.2){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
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
  addPart(doc,'pedestal','pedestal',[0,-55,0]);
  addPart(doc,'upperArm','upper-arm',[-40,20,0]);
  addPart(doc,'forearm','forearm',[50,20,0]);
  addPart(doc,'quill','quill',[0,60,0]);
  addPart(doc,'targetDisk','target-disk',[60,-55,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05};
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
 if(id==='robot-apex-scara-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-apex-scara-print'){
  geometries.push(
   new THREE.BoxGeometry(56,56,5).translate(0,-55,2.5),
   new THREE.BoxGeometry(80,26,8).translate(-40,20,4),
   new THREE.BoxGeometry(72,20,8).translate(50,20,4),
   new THREE.BoxGeometry(12,12,64).translate(0,60,32),
   new THREE.CylinderGeometry(12,12,14,20).rotateX(Math.PI/2).translate(60,-55,7),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(56,56,5).translate(0,0,2.5),
   new THREE.BoxGeometry(80,26,8).translate(28,0,37.5),
   new THREE.BoxGeometry(72,20,8).translate(88,0,74),
   new THREE.BoxGeometry(12,12,64).translate(132,0,50),
   new THREE.CylinderGeometry(12,12,14,20).rotateX(Math.PI/2).translate(132,18,7),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
