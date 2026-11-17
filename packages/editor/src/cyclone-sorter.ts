// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const CYCLONE_SORTER_ID='robot-cyclone-sorter';
export const cycloneSorterCatalog=[
 {id:CYCLONE_SORTER_ID,name:'Cyclone 2-axis gantry sorter',category:'Robots',description:'A PLA-printable 2-axis XY linear gantry sorter (sliders A & B) with an Adafruit 1143 micro-servo sweeper paddle (C) and two dynamic sorting pucks.',keywords:'robot gantry xy sorter slider servo pla printable adafruit 1143 cyclone',color:'#0ea5e9'},
 {id:'robot-cyclone-sorter-print',name:'Cyclone gantry PLA print layout',category:'Robots',description:'All original PLA parts for the Cyclone gantry sorter (frame, X bridge, Y shuttle, sweeper paddle, sorting pucks), laid flat in support-free print orientation.',keywords:'robot gantry pla frame bridge shuttle paddle puck print layout',color:'#0ea5e9'},
 {id:'robot-cyclone-sorter-fit',name:'Cyclone rail & spline gauge',category:'Robots',description:'Linear gantry rail clearance and micro-servo 1143 spline fit coupon with 0.15–0.45 mm clearance.',keywords:'robot gantry tolerance coupon slider rail spline fit gauge 1143',color:'#e8ab47'},
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

export const cycloneSorterPartPrograms={
 frame:program(`let leftRail=move([0,60,16],box(140,10,32));
let rightRail=move([0,-60,16],box(140,10,32));
let rearTie=move([-66,0,6],box(8,130,12));
let frontTie=move([66,0,6],box(8,130,12));
return union(leftRail,rightRail,rearTie,frontTie);`),

 bridge:program(`return move([0,0,5],box(16,106,10));`),

 shuttle:program(`return move([0,0,3],box(12,28,6));`),

 paddle:program(`let hub=move([0,0,5.75],box(10,10,11.5));
let blade=move([16,0,5.75],box(28,8,11.5));
return union(hub,blade);`),

 puck:program(`return move([0,0,6],cylinder(10,12,20));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-20,0,2],box(10.4,10.4,10)),
  move([0,0,2],cylinder(2.55,10,16)),
  move([20,0,2],cylinder(1.15,10,12))
);
return subtract(bar,holes);`),
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

type CollisionPiece={positions:number[];indices:number[]};
const boxPiece=(cx:number,cy:number,cz:number,sx:number,sy:number,sz:number):CollisionPiece=>{
 const x0=cx-sx/2,x1=cx+sx/2,y0=cy-sy/2,y1=cy+sy/2,z0=cz-sz/2,z1=cz+sz/2;
 return {
  positions:[x0,y0,z0,x1,y0,z0,x1,y1,z0,x0,y1,z0,x0,y0,z1,x1,y0,z1,x1,y1,z1,x0,y1,z1],
  indices:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7],
 };
};
const cylPiece=(cx:number,cy:number,cz:number,r:number,h:number,segs=20):CollisionPiece=>{
 const z0=cz-h/2,z1=cz+h/2,positions:number[]=[],indices:number[]=[];
 for(let i=0;i<segs;i++){const a=i*2*Math.PI/segs;positions.push(cx+r*Math.cos(a),cy+r*Math.sin(a),z0);}
 for(let i=0;i<segs;i++){const a=i*2*Math.PI/segs;positions.push(cx+r*Math.cos(a),cy+r*Math.sin(a),z1);}
 for(let i=1;i<segs-1;i++)indices.push(0,i+1,i,segs,segs+i,segs+i+1);
 for(let i=0;i<segs;i++){const n=(i+1)%segs;indices.push(i,n,segs+n,i,segs+n,segs+i);}
 return {positions,indices};
};

const partCollisions:Partial<Record<CycloneSorterPart,CollisionPiece[]>>={
 frame:[boxPiece(0,60,16,140,10,32),boxPiece(0,-60,16,140,10,32),boxPiece(-66,0,6,8,130,12),boxPiece(66,0,6,8,130,12)],
 bridge:[boxPiece(0,0,5,16,106,10)],
 shuttle:[boxPiece(0,0,3,12,28,6)],
 paddle:[boxPiece(0,0,5.75,10,10,11.5),boxPiece(16,0,5.75,28,8,11.5)],
 puck:[cylPiece(0,0,6,10,12,20)],
};

function addPart(doc:CadDocument,part:CycloneSorterPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.35){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
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
  addPart(doc,'frame','frame',[-10,0,0]);
  addPart(doc,'bridge','bridge',[85,0,0]);
  addPart(doc,'shuttle','shuttle',[65,-85,0]);
  addPart(doc,'paddle','paddle',[10,85,0]);
  addPart(doc,'puck','puck-1',[-45,85,0]);
  addPart(doc,'puck','puck-2',[-75,85,0]);
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

 doc.tracers=[{id:'sweeper-tip-path',bodyId:'paddle',point:[44,0,6],color:'#0ea5e9'}];
 doc.simulation={...defaultSimulationSettings(),...doc.simulation,selfCollisions:false};
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function cycloneSorterPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-cyclone-sorter-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-cyclone-sorter-print'){
  geometries.push(
   new THREE.BoxGeometry(140,10,32).translate(-10,60,16),
   new THREE.BoxGeometry(140,10,32).translate(-10,-60,16),
   new THREE.BoxGeometry(16,106,10).translate(85,0,5),
   new THREE.CylinderGeometry(10,10,12,20).rotateX(Math.PI/2).translate(-45,85,6),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(140,10,32).translate(0,60,16),
   new THREE.BoxGeometry(140,10,32).translate(0,-60,16),
   new THREE.BoxGeometry(8,130,12).translate(-66,0,6),
   new THREE.BoxGeometry(8,130,12).translate(66,0,6),
   new THREE.BoxGeometry(16,106,10).translate(0,0,39),
   new THREE.BoxGeometry(12,28,6).translate(16,0,45),
   new THREE.BoxGeometry(28,8,11.5).translate(32,0,7.25),
   new THREE.CylinderGeometry(10,10,12,20).rotateX(Math.PI/2).translate(34,24,6),
   new THREE.CylinderGeometry(10,10,12,20).rotateX(Math.PI/2).translate(34,-24,6),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
