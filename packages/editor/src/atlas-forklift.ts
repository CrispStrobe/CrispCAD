import {addRobotElectronics} from './robot-electronics.js';
// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit motor & micro-servo derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';
import {atlasForkliftCollisionAssembly} from './atlas-forklift-collisions.js';
import {ttRoverCollisionAssembly} from './tt-rover-collisions.js';
import {steerableRoverCollisionAssembly} from './steerable-rover-collisions.js';

export const ATLAS_FORKLIFT_ID='robot-atlas-forklift';
export const atlasForkliftCatalog=[
 {id:ATLAS_FORKLIFT_ID,name:'Atlas forklift rover',category:'Robots',description:'A PLA-printable mobile forklift with twin Adafruit TT drive motors (A/B), a motorized linear lift mast (slider D), an Adafruit 1143 micro-servo fork tilt (C), and a pallet crate.',keywords:'robot forklift rover slider lift servo pla printable adafruit 1143 3777 atlas',color:'#e09f3e'},
 {id:'robot-atlas-forklift-print',name:'Atlas forklift PLA print layout',category:'Robots',description:'All original PLA parts for the Atlas forklift (chassis, cradles, wheels, mast, carriage, forks, pallet crate), laid flat in support-free print orientation.',keywords:'robot forklift pla chassis mast carriage forks pallet print layout',color:'#e09f3e'},
 {id:'robot-atlas-forklift-fit',name:'Atlas mast & spline gauge',category:'Robots',description:'Mast rail slide clearance, Double-D TT shaft sockets, and five-step micro-servo spline fit coupon.',keywords:'robot forklift tolerance coupon slider rail spline fit gauge',color:'#38a99a'},
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
const cuts=(items:string[])=>items.join(',\n  ');
const bore=(x:number,y:number,z=0,h=30,r=1.7)=>`move([${x},${y},${z}],cylinder(${r},${h},12))`;
const motorHoles=[-31,32].flatMap(x=>[-7,7].map(y=>[x+5.7,y]));

export const atlasForkliftPartPrograms={
 chassis:program(`param thickness:mm=4;
// Mobile chassis deck with TT cradle countersunk M3 bores, Feather controller standoffs,
// rear ground skid, and front M3 mast flange mounting holes.
let plate=move([-27.5,0,thickness/2],box(155,106,thickness));
let rearSkid=move([-95,0,-6.75],cylinder(10,13.5,16));
let featherBosses=union(
  ${[-55,-4.2].flatMap(x=>[-11.43,11.43].map(y=>`move([${x},${y},5.5],cylinder(2.6,3,16))`)).join(',\n  ')}
);
let body=union(plate,rearSkid,featherBosses);
let ttBores=union(
  ${[-44,44].flatMap(my=>motorHoles.flatMap(([x,y])=>[
   bore(-60+x,my+y,2,12,1.7),
   `move([${-60+x},${my+y},3.2],cylinder(3.0,2.5,12))`,
  ])).join(',\n  ')}
);
let featherBores=union(
  ${[-55,-4.2].flatMap(x=>[-11.43,11.43].map(y=>`move([${x},${y},4],cylinder(1.1,10,12))`)).join(',\n  ')}
);
let mastBores=union(
  move([47,-10,2],cylinder(1.7,10,12)),
  move([47,10,2],cylinder(1.7,10,12))
);
let deckCutouts=union(
  move([-74,0,2],box(16,18,10)),
  move([-29,0,2],box(18,14,10)),
  move([-74,-16,2],box(10,4,10)),
  move([-74,16,2],box(10,4,10))
);
return subtract(body,
  ${cuts(['ttBores','featherBores','mastBores','deckCutouts'])});`),

 cradle:program(`param floor:mm=2.8;
// Adafruit TT gearmotor U-cradle with aligned M3 chassis mounting bores and lightened cheeks.
let foot=move([0,-1,floor/2],box(74,28.2,floor));
let rails=union(move([-13.5,-14.1,floor+3 mm],box(43,2,6)),move([-13.5,12.1,floor+3 mm],box(43,2,6)));
let stop=move([-36.5,-1,floor+2 mm],box(1,28.2,4));
let body=union(foot,rails,stop);
let mountBores=union(
  ${[-31,32].flatMap(x=>[-7,7].map(y=>`move([${x},${y},1.4],cylinder(1.7,6,12))`)).join(',\n  ')}
);
let railSlots=union(
  move([-22,-1,5.8],rotate([90,0,0],cylinder(1.6,32,12))),
  move([-5,-1,5.8],rotate([90,0,0],cylinder(1.6,32,12)))
);
return subtract(body,
  ${cuts(['mountBores','railSlots'])});`),

 wheel:program(`// Spoked 60 mm drive wheel with O-ring tread groove and Double-D TT motor press-fit bore.
let rim=subtract(cylinder(30,8,24),move([0,0,4],torus(30,0.9,6,20)),move([0,0,4],box(5.6,3.9,14)));
let hub=move([0,0,11],cylinder(8,6,20));
let spokes=union(
  ${[0,60,120,180,240,300].map(deg=>{const rad=deg*Math.PI/180;return `move([${(18.5*Math.cos(rad)).toFixed(2)},${(18.5*Math.sin(rad)).toFixed(2)},4],cylinder(4.2,12,16))`;}).join(',\n  ')}
);
return subtract(union(move([0,0,4],rim),hub),move([0,0,10],box(5.6,3.9,16)),spokes);`),

 mast:program(`// Twin-rail vertical forklift mast with chassis M3 bolt holes, center tie brace, and lightened rails.
let flange=move([3,0,7],box(6,44,14));
let leftRail=move([37,18,4],box(74,8,8));
let rightRail=move([37,-18,4],box(74,8,8));
let midBrace=move([38,0,2],box(8,36,4));
let topBar=move([71,0,4],box(6,44,8));
let body=union(flange,leftRail,rightRail,midBrace,topBar);
let baseBores=union(
  move([3,-10,11],rotate([0,90,0],cylinder(1.7,10,12))),
  move([3,10,11],rotate([0,90,0],cylinder(1.7,10,12)))
);
let railSlots=union(
  ${[18,36,54].flatMap(x=>[-18,18].map(y=>`move([${x},${y},4],box(10,3,12))`)).join(',\n  ')}
);
let topBores=union(
  move([71,-14,4],cylinder(1.7,12,12)),
  move([71,14,4],cylinder(1.7,12,12))
);
return subtract(body,
  ${cuts(['baseBores','railSlots','topBores'])});`),

 carriage:program(`// Linear mast slider carriage with MG90S tilt servo ear bores and central relief pocket.
let block=move([0,0,17],box(8,26,34));
let earBores=union(
  move([2,0,3.6],rotate([90,0,0],cylinder(1.1,30,12))),
  move([2,0,30.7],rotate([90,0,0],cylinder(1.1,30,12)))
);
let guideGrooves=union(
  move([-3.5,-11.5,17],box(3,3,38)),
  move([-3.5,11.5,17],box(3,3,38))
);
let lighten=move([0,0,17],rotate([0,90,0],cylinder(4.2,12,16)));
return subtract(block,
  ${cuts(['earBores','guideGrooves','lighten'])});`),

 forks:program(`param splineClearance:mm=0.2;
// Articulated twin tines with MG90S tilt spline socket, M2 countersunk bore, and backrest windows.
let spine=move([3,0,12],box(6,40,24));
let ear=move([-7.5,-18.75,19.5],box(15,4.5,9));
let leftTine=move([28,14,2.5],box(44,8,5));
let rightTine=move([28,-14,2.5],box(44,8,5));
let body=union(spine,ear,leftTine,rightTine);
let splineSocket=move([-10,-16.8,20],rotate([90,0,0],cylinder((5.0 mm + splineClearance)/2,4.2,24)));
let screwBore=move([-10,-18.75,20],rotate([90,0,0],cylinder(1.15,8,16)));
let screwCs=move([-10,-20.2,20],rotate([90,0,0],cylinder(2.2,2.4,16)));
let backrestWindows=union(
  move([3,-10,14],box(10,10,10)),
  move([3,10,14],box(10,10,10))
);
let tipBevels=union(
  move([47,14,0],rotate([0,-25,0],box(8,10,4))),
  move([47,-14,0],rotate([0,-25,0],box(8,10,4)))
);
return subtract(body,
  ${cuts(['splineSocket','screwBore','screwCs','backrestWindows','tipBevels'])});`),

 crate:program(`// Printable pallet crate with solid fork-pocket skids and top cargo recess.
let deck=move([0,0,11],box(36,48,22));
let skidL=move([0,21.5,28.5],box(36,5,13));
let skidC=move([0,0,28.5],box(36,16,13));
let skidR=move([0,-21.5,28.5],box(36,5,13));
let body=union(deck,skidL,skidC,skidR);
let cargoPocket=move([0,0,3],box(26,38,7));
let sideSlots=union(
  move([0,24,11],box(20,3,6)),
  move([0,-24,11],box(20,3,6))
);
return subtract(body,
  ${cuts(['cargoPocket','sideSlots'])});`),

 fit:program(`// Five-step micro-servo spline (0.15..0.55 mm), Double-D TT bore, and mast slide clearance gauge.
let bar=hull(move([-32,0,2],cylinder(11,4,24)),move([32,0,2],cylinder(11,4,24)));
let railPad=move([0,-11,4],box(72,6,8));
let body=union(bar,railPad);
let sockets=union(
  ${[0.15,0.25,0.35,0.45,0.55].map((c,i)=>`move([${-28+i*14},1,2.2],cylinder((5.0 mm + ${c} mm)/2,4.4,20))`).join(',\n  ')}
);
let dots=union(
  ${[0.15,0.25,0.35,0.45,0.55].flatMap((_,i)=>Array.from({length:i+1},(__,d)=>`move([${-30+i*14+d*1.3},-5.2,3.7],cylinder(0.45,0.9,10))`)).join(',\n  ')}
);
let extraBores=union(
  move([-33,6.5,2],box(5.6,3.9,10)),
  move([33,6.5,2],cylinder(1.7,8,16)),
  move([0,-11,2.5],box(8.4,8,5.4))
);
return subtract(body,sockets,dots,extraBores);`),
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

function addPart(doc:CadDocument,part:AtlasForkliftPart,id:string,position:Vec3,rotation:Vec3=[0,0,0],friction=.4){
 const collisionAssembly=atlasForkliftCollisionAssembly(part);
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

/** Assembled mobile forklift with twin TT rear drive (A/B), linear mast slider (D), and servo fork tilt (C). */
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
   if(ttMotor.roots.includes(key)){node.transform.position=[-54.3,y,20.3];node.physics={...node.physics!,collisionAssembly:ttRoverCollisionAssembly(key)};}
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
    physics:{...defaultPartPhysics(),densityKgM3:1100,material:'rubber',friction:1,restitution:.03,collisionAssembly:steerableRoverCollisionAssembly('tire')},
   };
   doc.roots.push(key);
   fixed(doc,side+'-wheel',key);
  }
 }

 // Vertical twin-rail mast fixed to chassis front + sliding carriage (slider port D).
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

 addRobotElectronics(doc);
 doc.tracers=[{id:'fork-tip-path',bodyId:'forks',point:[120,0,8],color:'#e09f3e'}];
 doc.simulation={...defaultSimulationSettings(),...doc.simulation,selfCollisions:false};
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function atlasForkliftPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-atlas-forklift-fit')geometries.push(new THREE.BoxGeometry(86,28,4).translate(0,-2,2));
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
   new THREE.BoxGeometry(8,26,34).translate(63,0,31),
   new THREE.BoxGeometry(44,36,5).translate(100,0,8.5),
   new THREE.BoxGeometry(36,48,35).translate(102,0,17.5),
  );
  for(const y of [-70.5,70.5])geometries.push(new THREE.CylinderGeometry(31.5,31.5,8,24).translate(-35,y,31.5));
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
