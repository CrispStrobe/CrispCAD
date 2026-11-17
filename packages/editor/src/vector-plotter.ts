// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit micro-servo 1143 derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const VECTOR_PLOTTER_ID='robot-vector-plotter';
export const vectorPlotterCatalog=[
 {id:VECTOR_PLOTTER_ID,name:'Vector 3-axis XY plotter',category:'Robots',description:'A PLA-printable XY-Z CNC plotter with Y-gantry slider (A), X-carriage slider (B), Adafruit 1143 rotary stylus arm servo (C), and movable token.',keywords:'robot plotter cnc xy gantry carriage stylus pen servo token pla printable adafruit 1143',color:'#6366f1'},
 {id:'robot-vector-plotter-print',name:'Vector plotter PLA print layout',category:'Robots',description:'All original PLA parts for the Vector XY plotter (bed frame, Y-gantry bridge, X-carriage, stylus arm, token), laid out in support-free print orientation.',keywords:'robot plotter pla frame gantry carriage stylus token print layout',color:'#6366f1'},
 {id:'robot-vector-plotter-fit',name:'Vector plotter spline & rail gauge',category:'Robots',description:'Micro-servo 1143 spline socket & XY gantry rail clearance coupon with 0.15–0.45 mm tolerance.',keywords:'robot plotter tolerance coupon servo spline rail fit gauge 1143',color:'#e8ab47'},
];
export const isVectorPlotter=(id:string)=>vectorPlotterCatalog.some(p=>p.id===id);
export const vectorPlotterDimensions=Object.freeze({
 yLimitsMm:[-35,35] as const,
 xLimitsMm:[-30,30] as const,
 penLimitDeg:55,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Vector 3-axis XY plotter part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});

export const vectorPlotterPartPrograms={
 frame:program(`let bed=move([0,0,3],box(120,120,6));
let leftPost=move([-52,0,22],box(12,112,32));
let rightPost=move([52,0,22],box(12,112,32));
return union(bed,leftPost,rightPost);`),

 bridge:program(`return move([0,0,4],box(88,16,8));`),

 carriage:program(`return move([0,0,4],box(24,24,8));`),

 penArm:program(`let arm=move([16,0,73],box(42,10,8));
let stylus=move([33,0,34],box(8,8,68));
return union(arm,stylus);`),

 token:program(`return move([0,0,6],box(12,12,12));`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-22,0,2],cylinder(2.4,10,16)),
  move([-8,0,2],cylinder(2.55,10,16)),
  move([6,0,2],cylinder(2.7,10,16)),
  move([22,0,2],box(16.3,8.3,10))
);
return subtract(bar,holes);`),
} as const;

export type VectorPlotterPart=keyof typeof vectorPlotterPartPrograms;

const names:Record<VectorPlotterPart,string>={
 frame:'Plotter bed & Y-rail frame',
 bridge:'Y-axis gantry bridge',
 carriage:'X-axis sliding carriage',
 penArm:'Rotary stylus arm',
 token:'Plotter target token',
 fit:'Vector plotter spline & rail gauge',
};

const colors:Record<VectorPlotterPart,string>={
 frame:'#312e81',
 bridge:'#4f46e5',
 carriage:'#6366f1',
 penArm:'#e8ab47',
 token:'#f59e0b',
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

const partCollisions:Partial<Record<VectorPlotterPart,CollisionPiece[]>>={
 frame:[boxPiece(0,0,3,120,120,6),boxPiece(-52,0,22,12,112,32),boxPiece(52,0,22,12,112,32)],
 bridge:[boxPiece(0,0,4,88,16,8)],
 carriage:[boxPiece(0,0,4,24,24,8)],
 penArm:[boxPiece(16,0,73,42,10,8),boxPiece(33,0,34,8,8,68)],
 token:[boxPiece(0,0,6,12,12,12)],
};

function addPart(doc:CadDocument,part:VectorPlotterPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],motion:'dynamic'|'static'='dynamic',friction=.08){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(vectorPlotterPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),motion,densityKgM3:1240,material:'plastic',friction,restitution:.1,sourcePreset:VECTOR_PLOTTER_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createVectorPlotterPart(part:VectorPlotterPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-vector-plotter-${part}`;
 doc.version=8;
 addPart(doc,part,part,[0,0,0]);
 return doc;
}

/** Assembled 3-axis XY-Z plotter (Y-axis A, X-axis B, stylus servo C) with token. */
export function createVectorPlotterDocument(id=VECTOR_PLOTTER_ID):CadDocument{
 if(id==='robot-vector-plotter-fit')return createVectorPlotterPart('fit');
 const doc=createDocument(t(id==='robot-vector-plotter-print'?'Vector plotter PLA print layout':'Vector 3-axis XY plotter'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-vector-plotter-print'){
  addPart(doc,'frame','frame',[-15,-20,0]);
  addPart(doc,'bridge','bridge',[65,30,0]);
  addPart(doc,'carriage','carriage',[65,0,0]);
  addPart(doc,'penArm','pen-arm',[55,-35,0]);
  addPart(doc,'token','token',[65,-65,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:true,groundFriction:.6,groundRestitution:.05,selfCollisions:false};
 doc.joints=[];

 addPart(doc,'frame','frame',[0,0,0],[0,0,0],'static',.06);
 addPart(doc,'bridge','bridge',[0,0,32]);
 addPart(doc,'carriage','carriage',[0,0,42]);
 addPart(doc,'penArm','pen-arm',[0,0,10]);
 addPart(doc,'token','token',[33,18,6.2],[0,0,0],'dynamic',.06);

 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(servoMotor.provenance?.records??[])],
 };

 const ySlider=jointAtWorldFrame(doc,'slider','frame','bridge',[0,0,36],[0,1,0]);
 ySlider.id='y-axis-a';
 ySlider.limits=[...vectorPlotterDimensions.yLimitsMm];
 ySlider.control={port:'A'};
 doc.joints!.push(ySlider);

 const xSlider=jointAtWorldFrame(doc,'slider','bridge','carriage',[0,0,46],[1,0,0]);
 xSlider.id='x-axis-b';
 xSlider.limits=[...vectorPlotterDimensions.xLimitsMm];
 xSlider.control={port:'B'};
 doc.joints!.push(xSlider);

 for(const [key,original]of Object.entries(servoMotor.nodes)){
  const node=structuredClone(original);
  node.id=`pen-${key}`;
  if(node.kind==='boolean')node.inputs=node.inputs.map(input=>`pen-${input}`);
  if(servoMotor.roots.includes(key)){
   node.transform.position=[0,0,50];
   node.transform.rotation=[0,0,0];
  }
  node.name=t('Stylus arm servo')+(key==='shaft'?' · '+t('Output spline'):'');
  doc.nodes[node.id]=node;
 }
 doc.roots.push('pen-casing','pen-shaft');
 fixed(doc,'carriage','pen-casing');

 const deg=Math.PI/180;
 const penLimit=vectorPlotterDimensions.penLimitDeg*deg;
 const penJoint=jointAtWorldFrame(doc,'hinge','pen-casing','pen-shaft',[0,0,77.18],[0,0,1]);
 penJoint.id='pen-c';
 penJoint.limits=[-penLimit,penLimit];
 penJoint.control={port:'C'};
 doc.joints!.push(penJoint);
 fixed(doc,'pen-shaft','pen-arm');

 doc.tracers=[{id:'stylus-path',bodyId:'pen-arm',point:[33,0,0],color:'#e8ab47'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function vectorPlotterPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-vector-plotter-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-vector-plotter-print'){
  geometries.push(
   new THREE.BoxGeometry(120,120,6).translate(-15,-20,3),
   new THREE.BoxGeometry(88,16,8).translate(65,30,4),
   new THREE.BoxGeometry(24,24,8).translate(65,0,4),
   new THREE.BoxGeometry(42,10,8).translate(71,-35,73),
   new THREE.BoxGeometry(12,12,12).translate(65,-65,6),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(120,120,6).translate(0,0,3),
   new THREE.BoxGeometry(12,112,32).translate(-52,0,22),
   new THREE.BoxGeometry(12,112,32).translate(52,0,22),
   new THREE.BoxGeometry(88,16,8).translate(0,0,36),
   new THREE.BoxGeometry(24,24,8).translate(0,0,46),
   new THREE.BoxGeometry(42,10,8).translate(16,0,83),
   new THREE.BoxGeometry(12,12,12).translate(33,18,12.2),
  );
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
