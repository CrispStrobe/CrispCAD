// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit motor & micro-servo derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';

export const ATLAS_FORKLIFT_ID='robot-atlas-forklift';
export const atlasForkliftCatalog=[
 {id:ATLAS_FORKLIFT_ID,name:'Atlas forklift rover',category:'Robots',description:'A PLA-printable mobile forklift with twin Adafruit TT drive motors (A/B), a motorized linear lift mast (slider A), an Adafruit 1143 micro-servo fork tilt (C), and a pallet crate.',keywords:'robot forklift rover slider lift servo pla printable adafruit 1143 3777 atlas',color:'#e09f3e'},
 {id:'robot-atlas-forklift-print',name:'Atlas forklift PLA print layout',category:'Robots',description:'All original PLA parts for the Atlas forklift (chassis, cradles, wheels, mast, carriage, forks, pallet crate), laid flat in support-free print orientation.',keywords:'robot forklift pla chassis mast carriage forks pallet print layout',color:'#e09f3e'},
 {id:'robot-atlas-forklift-fit',name:'Atlas mast & spline gauge',category:'Robots',description:'Mast rail slide clearance, Double-D TT shaft sockets, and micro-servo spline fit coupon.',keywords:'robot forklift tolerance coupon slider rail spline fit gauge',color:'#38a99a'},
];
export const isAtlasForklift=(id:string)=>atlasForkliftCatalog.some(p=>p.id===id);
export const atlasForkliftDimensions=Object.freeze({
 motorX:-54.3,
 rearAxleX:-35,
 motorY:44,
 wheelZ:31.5,
 mastX:58,
 liftTravelMm:48,
 tiltLimitDeg:25,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Atlas forklift rover part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});
const bore=(x:number,y:number,z=0,h=30,r=1.7)=>`move([${x},${y},${z}],cylinder(${r},${h},12))`;
const motorHoles=[-31,32].flatMap(x=>[-7,7].map(y=>[x+5.7,y]));

export const atlasForkliftPartPrograms={
 chassis:program(`param thickness:mm=4;
let plate=move([-27.5,0,thickness/2],box(155,106,thickness));
let rearSkid=move([-95,0,-6.75],cylinder(10,13.5,16));
let body=union(plate,rearSkid);
return subtract(body,
  ${[-44,44].flatMap(my=>motorHoles.map(([x,y])=>bore(-60+x,my+y,2,12))).join(',\n  ')});`),

 cradle:program(`param floor:mm=2.8;
let foot=move([0,-1,floor/2],box(74,28.2,floor));
let rails=union(move([-13.5,-14.1,floor+3 mm],box(43,2,6)),move([-13.5,12.1,floor+3 mm],box(43,2,6)));
let stop=move([-36.5,-1,floor+2 mm],box(1,28.2,4));
return union(foot,rails,stop);`),

 wheel:program(`let rim=subtract(cylinder(30,8,24),move([0,0,4],torus(30,1.4,6,20)),move([0,0,4],box(5.6,3.9,14)));
let hub=move([0,0,11],cylinder(8,6,20));
return subtract(union(move([0,0,4],rim),hub),move([0,0,10],box(5.6,3.9,16)));`),

 mast:program(`let flange=move([3,0,7],box(6,44,14));
let leftRail=move([37,18,4],box(74,8,8));
let rightRail=move([37,-18,4],box(74,8,8));
let topBar=move([71,0,4],box(6,44,8));
return union(flange,leftRail,rightRail,topBar);`),

 carriage:program(`return move([0,0,12],box(8,26,24));`),

 forks:program(`let spine=move([3,0,12],box(6,40,24));
let ear=move([-6.5,-18.75,19.5],box(13,4.5,9));
let leftTine=move([28,14,2.5],box(44,8,5));
let rightTine=move([28,-14,2.5],box(44,8,5));
return union(spine,ear,leftTine,rightTine);`),

 crate:program(`let deck=move([0,0,11],box(36,48,22));
let skidL=move([0,21.5,28.5],box(36,5,13));
let skidC=move([0,0,28.5],box(36,16,13));
let skidR=move([0,-21.5,28.5],box(36,5,13));
return union(deck,skidL,skidC,skidR);`),

 fit:program(`let bar=move([0,0,2],box(68,22,4));
let holes=union(
  move([-20,0,2],box(8.4,8.4,10)),
  move([0,0,2],box(5.6,3.9,10)),
  move([20,0,2],cylinder(2.55,10,16))
);
return subtract(bar,holes);`),
} as const;

export type AtlasForkliftPart=keyof typeof atlasForkliftPartPrograms;

const names:Record<AtlasForkliftPart,string>={
 chassis:'Forklift chassis & rear skid',
 cradle:'TT motor cradle',
 wheel:'Rear drive wheel',
 mast:'Twin-rail lift mast',
 carriage:'Slider lift carriage',
 forks:'Articulated forklift tines',
 crate:'Printable pallet crate',
 fit:'Atlas mast & spline gauge',
};

const colors:Record<AtlasForkliftPart,string>={
 chassis:'#2c5d63',
 cradle:'#287f79',
 wheel:'#e8ab47',
 mast:'#38a99a',
 carriage:'#5ea3d0',
 forks:'#e09f3e',
 crate:'#d97736',
 fit:'#38a99a',
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

const partCollisions:Partial<Record<AtlasForkliftPart,CollisionPiece[]>>={
 chassis:[boxPiece(-27.5,0,2,155,106,4),cylPiece(-95,0,-6.75,10,13.5,16)],
 cradle:[boxPiece(0,-1,1.4,74,28.2,2.8),boxPiece(-13.5,-14.1,5.8,43,2,6),boxPiece(-13.5,12.1,5.8,43,2,6),boxPiece(-36.5,-1,4.8,1,28.2,4)],
 wheel:[cylPiece(0,0,4,30,8,20),cylPiece(0,0,11,8,6,16)],
 mast:[boxPiece(3,0,7,6,44,14),boxPiece(37,18,4,74,8,8),boxPiece(37,-18,4,74,8,8),boxPiece(71,0,4,6,44,8)],
 carriage:[boxPiece(0,0,12,8,26,24)],
 forks:[boxPiece(3,0,12,6,40,24),boxPiece(-6.5,-18.75,19.5,13,4.5,9),boxPiece(28,14,2.5,44,8,5),boxPiece(28,-14,2.5,44,8,5)],
 crate:[boxPiece(0,0,11,36,48,22),boxPiece(0,21.5,28.5,36,5,13),boxPiece(0,0,28.5,36,16,13),boxPiece(0,-21.5,28.5,36,5,13)],
};

function addPart(doc:CadDocument,part:AtlasForkliftPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],friction=.4){
 const collisionAssembly=partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(atlasForkliftPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),densityKgM3:1240,material:'plastic',friction,restitution:.02,sourcePreset:ATLAS_FORKLIFT_ID,...(collisionAssembly?{collisionAssembly}:{})},
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

export function createAtlasForkliftPart(part:AtlasForkliftPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id=`robot-atlas-forklift-${part}`;
 doc.version=8;
 const pos:Vec3=part==='chassis'?[0,0,13.5]:[0,0,0];
 addPart(doc,part,part,pos);
 return doc;
}

/** Assembled mobile forklift with twin TT rear drive (A/B), linear mast slider (A), and servo fork tilt (C). */
export function createAtlasForkliftDocument(id=ATLAS_FORKLIFT_ID):CadDocument{
 if(id==='robot-atlas-forklift-fit')return createAtlasForkliftPart('fit');
 const doc=createDocument(t(id==='robot-atlas-forklift-print'?'Atlas forklift PLA print layout':'Atlas forklift rover'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-atlas-forklift-print'){
  addPart(doc,'chassis','chassis',[-20,0,13.5]);
  addPart(doc,'mast','mast',[-80,85,0]);
  addPart(doc,'forks','forks',[50,85,0]);
  addPart(doc,'carriage','carriage',[15,125,0]);
  addPart(doc,'crate','crate',[-65,-85,0]);
  for(const [i,y]of [-38,38].entries())addPart(doc,'cradle','cradle-'+i,[80,y,0]);
  for(const [i,y]of [-38,38].entries())addPart(doc,'wheel','wheel-'+i,[145,y,0]);
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:false,groundFriction:.8,groundRestitution:.02};
 doc.joints=[];

 addPart(doc,'chassis','chassis',[0,0,13.5],[0,0,0],.08);
 for(const [side,y]of [['left',44],['right',-44]] as const){
  addPart(doc,'cradle',side+'-cradle',[-54.3,y,17.5]);
  fixed(doc,'chassis',side+'-cradle');
  addPart(doc,'wheel',side+'-wheel',[-35,Math.sign(y)*74.5,31.5],[Math.sign(y)*90,0,0],.9);
 }

 const ttMotor=createMotorDocument('tt-gearmotor');
 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[...(ttMotor.provenance?.records??[]),...(servoMotor.provenance?.records??[])],
 };

 for(const [side,y,port]of [['left',44,'A'],['right',-44,'B']] as const){
  for(const [key,original]of Object.entries(ttMotor.nodes)){
   const node=structuredClone(original);
   node.id=side+'-'+key;
   if(node.kind==='boolean')node.inputs=node.inputs.map(input=>side+'-'+input);
   if(ttMotor.roots.includes(key))node.transform.position=[-54.3,y,20.3];
   node.name=t(side==='left'?'Left TT motor':'Right TT motor')+(key==='shaft'?' · '+t('Output shaft'):'');
   doc.nodes[node.id]=node;
  }
  doc.roots.push(side+'-casing',side+'-shaft');
  fixed(doc,'chassis',side+'-casing');
  const joint=jointAtWorldFrame(doc,'hinge',side+'-casing',side+'-shaft',[-35,y,31.5],[0,1,0]);
  joint.id='drive-'+port.toLowerCase();
  joint.control={port};
  doc.joints.push(joint);
  fixed(doc,side+'-shaft',side+'-wheel');
  for(const [i,offset]of [2,6].entries()){
   const key=side+'-tire-'+i;
   doc.nodes[key]={
    id:key,
    name:t('Purchased O-ring tire'),
    kind:'code',
    program:program('return torus(30,1.5,6,16);'),
    transform:{...identityTransform(),position:[-35,Math.sign(y)*(74.5-offset),31.5],rotation:[90,0,0]},
    color:'#303c40',
    physics:{...defaultPartPhysics(),densityKgM3:1100,material:'rubber',friction:1,restitution:.03},
   };
   doc.roots.push(key);
   fixed(doc,side+'-wheel',key);
  }
 }

 // Vertical twin-rail mast fixed to chassis front + sliding carriage (slider port A).
 addPart(doc,'mast','mast',[58,0,12],[0,-90,0]);
 fixed(doc,'chassis','mast');

 addPart(doc,'carriage','carriage',[63,0,14],[0,0,0]);
 const liftJoint=jointAtWorldFrame(doc,'slider','mast','carriage',[60,0,26],[0,0,1]);
 liftJoint.id='lift-d';
 liftJoint.limits=[0,atlasForkliftDimensions.liftTravelMm];
 liftJoint.control={port:'D'};
 doc.joints.push(liftJoint);

 // Micro-servo 1143 (port C) mounted on carriage to tilt the forklift tines.
 for(const [key,original]of Object.entries(servoMotor.nodes)){
  const node=structuredClone(original);
  node.id='tilt-'+key;
  if(node.kind==='boolean')node.inputs=node.inputs.map(input=>'tilt-'+input);
  if(servoMotor.roots.includes(key)){
   node.transform.position=[65,11.18,26];
   node.transform.rotation=[90,0,0];
  }
  node.name=t('Fork tilt servo')+(key==='shaft'?' · '+t('Output spline'):'');
  doc.nodes[node.id]=node;
 }
 doc.roots.push('tilt-casing','tilt-shaft');
 fixed(doc,'carriage','tilt-casing');
 const tiltLimit=(atlasForkliftDimensions.tiltLimitDeg*Math.PI)/180;
 const tiltJoint=jointAtWorldFrame(doc,'hinge','tilt-casing','tilt-shaft',[65,-16,26],[0,1,0]);
 tiltJoint.id='tilt-c';
 tiltJoint.limits=[-tiltLimit,tiltLimit];
 tiltJoint.control={port:'C'};
 doc.joints.push(tiltJoint);

 addPart(doc,'forks','forks',[75,0,6],[0,0,0],.85);
 fixed(doc,'tilt-shaft','forks');

 // Dynamic printable pallet crate resting ahead of the forks on Z=0.
 addPart(doc,'crate','pallet-crate',[105,0,35],[180,0,0],.85);

 doc.tracers=[{id:'fork-tip-path',bodyId:'forks',point:[120,0,8],color:'#e09f3e'}];
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function atlasForkliftPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-atlas-forklift-fit')geometries.push(new THREE.BoxGeometry(68,22,4).translate(0,0,2));
 else if(id==='robot-atlas-forklift-print'){
  geometries.push(
   new THREE.BoxGeometry(155,106,4).translate(-47.5,0,2),
   new THREE.BoxGeometry(74,44,8).translate(-43,85,4),
   new THREE.BoxGeometry(44,40,5).translate(78,85,2.5),
   new THREE.BoxGeometry(36,48,22).translate(-65,-85,11),
  );
 }else{
  geometries.push(
   new THREE.BoxGeometry(155,106,4).translate(-27.5,0,15.5),
   new THREE.BoxGeometry(8,44,74).translate(54,0,49),
   new THREE.BoxGeometry(8,26,24).translate(63,0,26),
   new THREE.BoxGeometry(44,36,5).translate(100,0,8.5),
   new THREE.BoxGeometry(36,48,35).translate(102,0,17.5),
  );
  for(const y of [-70.5,70.5])geometries.push(new THREE.CylinderGeometry(31.5,31.5,8,24).translate(-35,y,31.5));
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
