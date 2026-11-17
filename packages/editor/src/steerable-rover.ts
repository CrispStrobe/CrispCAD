// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit motor & micro-servo derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';
import {ttRoverCollisionAssembly} from './tt-rover-collisions.js';
import {steerableRoverCollisionAssembly} from './steerable-rover-collisions.js';

export const STEERABLE_ROVER_ID='robot-steerable-rover';
export const steerableRoverCatalog=[
 {id:STEERABLE_ROVER_ID,name:'Trident steerable rover',category:'Robots',description:'A PLA-printable 3-wheel steerable robot with two Adafruit TT rear drive motors (ports A/B) and an Adafruit 1143 micro-servo front steering fork (port C).',keywords:'robot rover steerable servo pla printable adafruit 1143 3777 tt trident steering',color:'#38a99a'},
 {id:'robot-steerable-rover-print',name:'Trident PLA print layout',category:'Robots',description:'Only the twelve original PLA parts, laid flat in support-free print orientation. Export each part separately for your printer.',keywords:'robot rover steerable pla chassis fork wheel cradle standoff print parts',color:'#38a99a'},
 {id:'robot-steerable-rover-fit',name:'Trident shaft & spline gauge',category:'Robots',description:'Double-D TT shaft sockets plus micro-servo spline & M3 axle bores with 0.15–0.55 mm clearance.',keywords:'robot rover tolerance coupon double d servo spline fit gauge',color:'#e8ab47'},
];
export const isSteerableRover=(id:string)=>steerableRoverCatalog.some(p=>p.id===id);
export const steerableRoverDimensions=Object.freeze({
 chassis:[155,106,4],
 rearAxleX:-35,
 frontAxleX:75,
 axleZ:31.5,
 motorX:-54.3,
 motorY:44,
 wheelTrack:141,
 wheelRadius:31.5,
 deckZ:74.5,
 servoX:75,
 steerLimitDeg:40,
});

const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Trident steerable rover part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});
const bore=(x:number,y:number,z=0,h=30,r=1.7)=>`move([${x},${y},${z}],cylinder(${r},${h},12))`;
const cuts=(items:string[])=>items.join(',\n  ');
const motorHoles=[-31,32].flatMap(x=>[-7,7].map(y=>[x+5.7,y]));
const postPositions:Vec3[]=[[-65,-22,17.5],[-65,22,17.5],[22,-22,17.5],[22,22,17.5]];

export const steerableRoverPartPrograms={
 chassis:program(`param thickness:mm=4;
let plate=move([-47.5,0,thickness/2],box(155,106,thickness));
return subtract(plate,
  ${cuts([-44,44].flatMap(my=>motorHoles.map(([x,y])=>bore(-60+x,my+y,2,12))).concat(postPositions.map(([x,y])=>bore(x,y,2,12)),[-105,-65].flatMap(x=>[-38,38].map(y=>`move([${x},${y},2],box(13,4,12))`),),[-85,-65,-45].map(x=>bore(x,0,2,12))))});`),

 cradle:program(`param floor:mm=2.8;
let foot=move([0,-1,floor/2],box(74,28.2,floor));
let rails=union(move([-13.5,-14.1,floor+3 mm],box(43,2,6)),move([-13.5,12.1,floor+3 mm],box(43,2,6)));
let stop=move([-36.5,-1,floor+2 mm],box(1,28.2,4));
return subtract(union(foot,rails,stop),
  ${cuts([-31,32].flatMap(x=>[-7,7].map(y=>bore(x,y,4,20))))},
  move([-20,-1,0.7],box(3.6,32,1.4)),move([0,-1,0.7],box(3.6,32,1.4)));`),

 rearWheel:program(`param clearance:mm=0.25;
param shaftDiameter:mm=5.4;
param shaftFlats:mm=3.7;
let disc=move([0,0,4],cylinder(30,8,24));
let hub=move([0,0,9],cylinder(10,18,24));
let ears=union(move([7.5,0,13.5],box(10,19,9)),hull(move([7.5,0,4],box(10,9,2)),move([7.5,0,9],box(10,19,1))));
let socket=move([0,0,15.2],intersect(cylinder((shaftDiameter+clearance)/2,6.4,16),box(10,shaftFlats+clearance,6.4)));
let slit=move([9,0,15],box(18,1,7));
let clamp=move([6.5,0,13.5],rotate([90,0,0],cylinder(1.7,24,12)));
let nut=move([6.5,-7.8,13.5],rotate([90,0,0],cylinder(3.3,3.8,6)));
let groove=move([0,0,4],subtract(cylinder(31,1.6,24),cylinder(29.2,1.8,24)));
return subtract(union(disc,hub,ears),socket,slit,clamp,nut,groove);`),

 frontWheel:program(`param axleBore:mm=3.5;
let disc=move([0,0,4],cylinder(30,8,24));
let boreHole=move([0,0,4],cylinder(axleBore/2,16,12));
let groove=move([0,0,4],subtract(cylinder(31,1.6,24),cylinder(29.2,1.8,24)));
return subtract(disc,boreHole,groove);`),

 steeringFork:program(`param splineClearance:mm=0.2;
// Authored flat on Z=0 (support-free): Z_print=0..14 is fork depth (X_world),
// X_print is vertical height (Z_world - 31.5), Y_print is fork width (Y_world).
let crown=move([35.5,0,7],box(4,25,14));
let armL=move([15,11,7],box(45,3,14));
let armR=move([15,-11,7],box(45,3,14));
let endL=move([0,11,7],cylinder(7,14,16));
let endR=move([0,-11,7],cylinder(7,14,16));
let splineSocket=move([35.5,0,7],rotate([0,90,0],cylinder((5.0 mm + splineClearance)/2,6,16)));
let axleBore=move([0,0,7],rotate([90,0,0],cylinder(1.7,30,16)));
return subtract(union(crown,armL,armR,endL,endR),splineSocket,axleBore);`),

 deck:program(`param thickness:mm=3;
let mainPlate=move([-21.5,0,thickness/2],box(107,60,thickness));
let nose=move([59,0,thickness/2],box(58,36,thickness));
let servoCutout=move([69.6,0,thickness/2],box(23.2,12.6,thickness + 4 mm));
let earHoleA=${bore(56.4,0,2,12,1.35)};
let earHoleB=${bore(83.3,0,2,12,1.35)};
return subtract(union(mainPlate,nose),
  servoCutout,earHoleA,earHoleB,
  ${cuts(postPositions.map(([x,y])=>bore(x,y,2,12)))},
  ${cuts([-45,-25,-5,15].flatMap(x=>[-18,18].map(y=>`move([${x},${y},2],box(3.6,9,12))`)))});`),

 standoff:program(`param height:mm=57;param bore:mm=3.4;
return move([0,0,height/2],subtract(cylinder(4.5,height,16),cylinder(bore/2,height+2 mm,16)));`),

 fit:program(`let plate=move([0,0,2],box(78,22,4));
return subtract(plate,
  ${cuts([.15,.25,.35,.45,.55].map((c,i)=>`move([${(i-2)*13-5},4,2],intersect(cylinder(${(5.4+c)/2},8,48),box(10,${3.7+c},8)))`))},
  move([29,4,2],cylinder(2.6,8,32)),
  move([29,-6,2],cylinder(1.75,8,32)),
  ${cuts([0,1,2,3,4].flatMap(i=>Array.from({length:i+1},(_,j)=>`move([${(i-2)*13-5+(j-i/2)*2},9.5,2],cylinder(0.55,8,16))`)))});`),
} satisfies Record<string,CodeProgram>;

export type SteerableRoverPart=keyof typeof steerableRoverPartPrograms;
export const steerableRoverPrintQuantities:Record<Exclude<SteerableRoverPart,'fit'>,number>={
 chassis:1,
 cradle:2,
 rearWheel:2,
 frontWheel:1,
 steeringFork:1,
 deck:1,
 standoff:4,
};

const names:Record<SteerableRoverPart,string>={
 chassis:'PLA chassis',
 cradle:'PLA motor cradle',
 rearWheel:'PLA rear clamping wheel',
 frontWheel:'PLA front steered wheel',
 steeringFork:'PLA front steering fork',
 deck:'PLA electronics & servo deck',
 standoff:'PLA deck standoff',
 fit:'TT shaft & servo spline gauge',
};

const colors:Record<SteerableRoverPart,string>={
 chassis:'#38a99a',
 cradle:'#287f79',
 rearWheel:'#e8ab47',
 frontWheel:'#e8ab47',
 steeringFork:'#2f7ab8',
 deck:'#80c7be',
 standoff:'#287f79',
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
const cylPiece=(cx:number,cy:number,cz:number,r:number,h:number,segs=24):CollisionPiece=>{
 const z0=cz-h/2,z1=cz+h/2,positions:number[]=[],indices:number[]=[];
 for(let i=0;i<segs;i++){const a=i*2*Math.PI/segs;positions.push(cx+r*Math.cos(a),cy+r*Math.sin(a),z0);}
 for(let i=0;i<segs;i++){const a=i*2*Math.PI/segs;positions.push(cx+r*Math.cos(a),cy+r*Math.sin(a),z1);}
 for(let i=1;i<segs-1;i++)indices.push(0,i+1,i,segs,segs+i,segs+i+1);
 for(let i=0;i<segs;i++){const n=(i+1)%segs;indices.push(i,n,segs+n,i,segs+n,segs+i);}
 return {positions,indices};
};
const partCollisions:Partial<Record<SteerableRoverPart,CollisionPiece[]>>={
 chassis:[
  boxPiece(-118.25,0,2,13.5,106,4),
  boxPiece(-105,-46.5,2,13,13,4),boxPiece(-105,0,2,13,72,4),boxPiece(-105,46.5,2,13,13,4),
  boxPiece(-85,0,2,27,106,4),
  boxPiece(-65,-46.5,2,13,13,4),boxPiece(-65,0,2,13,72,4),boxPiece(-65,46.5,2,13,13,4),
  boxPiece(-14.25,0,2,88.5,106,4),
 ],
 rearWheel:[cylPiece(0,0,1.6,30,3.2),cylPiece(0,0,4,29.2,1.6),cylPiece(0,0,6.4,30,3.2),cylPiece(0,0,13,10,10),boxPiece(7.5,0,13.5,10,19,9)],
 frontWheel:[cylPiece(0,0,1.6,30,3.2),cylPiece(0,0,4,29.2,1.6),cylPiece(0,0,6.4,30,3.2)],
};

function addPart(doc:CadDocument,part:SteerableRoverPart,id:string,position:Vec3,rotation:Vec3=[0,0,0]){
 const collisionAssembly=steerableRoverCollisionAssembly(part)??partCollisions[part]?.map(piece=>({positions:[...piece.positions],indices:[...piece.indices]}));
 const node:SolidNode={
  id,
  name:t(names[part]),
  kind:'code',
  program:structuredClone(steerableRoverPartPrograms[part]),
  transform:{...identityTransform(),position,rotation},
  color:colors[part],
  physics:{...defaultPartPhysics(),densityKgM3:1240,material:'plastic',friction:.4,restitution:.02,sourcePreset:STEERABLE_ROVER_ID,...(collisionAssembly?{collisionAssembly}:{})},
 };
 doc.nodes[id]=node;
 doc.roots.push(id);
 return id;
}

/** One manufactured part in its support-free orientation. No purchased components. */
export function createSteerableRoverPart(part:SteerableRoverPart):CadDocument{
 const doc=createDocument(t(names[part]));
 doc.id='trident-steerable-'+part;
 doc.version=8;
 addPart(doc,part,part,[0,0,0],[0,0,0]);
 return doc;
}

function fixed(doc:CadDocument,a:string,b:string){
 const joint=jointAtWorldFrame(doc,'fixed',a,b,doc.nodes[b].transform.position,[0,0,1]);
 joint.id='fixed-'+b;
 doc.joints!.push(joint);
}

/** Assembled steerable 3-wheel rover with 2 rear TT motors (A, B) and 1 front steering servo (C). */
export function createSteerableRoverDocument(id=STEERABLE_ROVER_ID):CadDocument{
 if(id==='robot-steerable-rover-fit')return createSteerableRoverPart('fit');
 const doc=createDocument(t(id==='robot-steerable-rover-print'?'Trident PLA print layout':'Trident steerable rover'));
 doc.id=id;
 doc.version=8;
 if(id==='robot-steerable-rover-print'){
  addPart(doc,'chassis','chassis',[-40,0,0]);
  addPart(doc,'deck','deck',[-40,90,0]);
  for(const [i,y]of [-38,38].entries())addPart(doc,'cradle','cradle-'+i,[80,y,0]);
  for(const [i,y]of [-38,38].entries())addPart(doc,'rearWheel','rear-wheel-'+i,[145,y,0]);
  addPart(doc,'frontWheel','front-wheel',[145,105,0]);
  addPart(doc,'steeringFork','steering-fork',[75,105,0]);
  postPositions.forEach((_,i)=>addPart(doc,'standoff','standoff-'+i,[65+i*12,145,0]));
  return doc;
 }

 doc.simulation={...defaultSimulationSettings(),fixBase:false,groundFriction:.8,groundRestitution:.02};
 doc.joints=[];

 addPart(doc,'chassis','chassis',[0,0,13.5]);
 for(const [side,y]of [['left',44],['right',-44]] as const){
  addPart(doc,'cradle',side+'-cradle',[-54.3,y,17.5]);
  fixed(doc,'chassis',side+'-cradle');
  addPart(doc,'rearWheel',side+'-wheel',[-35,Math.sign(y)*74.5,31.5],[Math.sign(y)*90,0,0]);
 }
 addPart(doc,'deck','deck',[0,0,74.5]);
 fixed(doc,'chassis','deck');
 postPositions.forEach((position,i)=>{
  const p=addPart(doc,'standoff','standoff-'+i,position);
  fixed(doc,'chassis',p);
 });

 // Rear TT motors (ports A and B), +Y rotation drives forward (+X).
 const ttMotor=createMotorDocument('tt-gearmotor');
 const servoMotor=createMotorDocument('micro-servo-1143');
 doc.provenance={
  version:1,
  records:[
   ...(ttMotor.provenance?.records??[]),
   ...(servoMotor.provenance?.records??[]),
  ],
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

 // Front steering micro-servo (port C) mounted upside-down on the deck nose at X=75, Y=0.
 for(const [key,original]of Object.entries(servoMotor.nodes)){
  const node=structuredClone(original);
  node.id='steer-'+key;
  if(node.kind==='boolean')node.inputs=node.inputs.map(input=>'steer-'+input);
  if(servoMotor.roots.includes(key)){
   node.transform.position=[75,0,96.3];
   node.transform.rotation=[180,0,90];
  }
  node.name=t('Front steering servo')+(key==='shaft'?' · '+t('Output spline'):'');
  doc.nodes[node.id]=node;
 }
 doc.roots.push('steer-casing','steer-shaft');
 fixed(doc,'deck','steer-casing');
 const steerLimit=(steerableRoverDimensions.steerLimitDeg*Math.PI)/180;
 const steerJoint=jointAtWorldFrame(doc,'hinge','steer-casing','steer-shaft',[75,0,69.12],[0,0,1]);
 steerJoint.id='steer-c';
 steerJoint.limits=[-steerLimit,steerLimit];
 steerJoint.control={port:'C'};
 doc.joints.push(steerJoint);

 // Front steering fork rotated from flat print pose (Z_print=0..14) to upright world pose around [75,0,31.5].
 // With rotation [0,-90,0], local (x,y,z) maps to (-z,y,x), so [82,0,31.5] puts local Z=7 at X=75 and local X=35.5 at Z=67.
 addPart(doc,'steeringFork','steering-fork',[82,0,31.5],[0,-90,0]);
 fixed(doc,'steer-shaft','steering-fork');

 // Front passive wheel centered at [75, 0, 31.5] inside the fork arms.
 addPart(doc,'frontWheel','front-wheel',[75,4,31.5],[90,0,0]);
 const frontAxle=jointAtWorldFrame(doc,'hinge','steering-fork','front-wheel',[75,0,31.5],[0,1,0]);
 frontAxle.id='front-wheel-axle';
 doc.joints.push(frontAxle);
 for(const [i,yOffset]of [-2,2].entries()){
  const key='front-tire-'+i;
  doc.nodes[key]={
   id:key,
   name:t('Purchased O-ring tire'),
   kind:'code',
   program:program('return torus(30,1.5,6,16);'),
   transform:{...identityTransform(),position:[75,yOffset,31.5],rotation:[90,0,0]},
   color:'#303c40',
   physics:{...defaultPartPhysics(),densityKgM3:1100,material:'rubber',friction:1,restitution:.03,collisionAssembly:steerableRoverCollisionAssembly('tire')},
  };
  doc.roots.push(key);
  fixed(doc,'front-wheel',key);
 }

 // Purchased battery & electronics clearance envelopes fixed to chassis/deck.
 const battery='battery-envelope';
 doc.nodes[battery]={
  id:battery,
  name:t('Purchased AA pack envelope'),
  kind:'box',
  size:[62,30,30],
  transform:{...identityTransform(),position:[-5,0,32.5]},
  color:'#465461',
  physics:{...defaultPartPhysics(),densityKgM3:1400,restitution:.02},
 };
 doc.roots.push(battery);
 fixed(doc,'chassis',battery);

 for(const [key,name,size,position]of [
  ['feather-envelope','Feather board clearance',[22.86,50.8,8],[-40,0,81.5]],
  ['driver-envelope','Motor & servo FeatherWing clearance',[26,22,8],[0,0,81.5]],
 ] as const){
  doc.nodes[key]={
   id:key,
   name:t(name),
   kind:'box',
   size:[...size],
   transform:{...identityTransform(),position:[...position]},
   color:'#3f7291',
   physics:{...defaultPartPhysics(),densityKgM3:550,restitution:.02},
  };
  doc.roots.push(key);
  fixed(doc,'deck',key);
 }

 doc.tracers=[{id:'rover-path',bodyId:'chassis',point:[0,0,4],color:'#38a99a'}];
 doc.simulation={...defaultSimulationSettings(),...doc.simulation,selfCollisions:false};
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function steerableRoverPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-steerable-rover-fit')geometries.push(new THREE.BoxGeometry(78,22,4).translate(0,0,2));
 else if(id==='robot-steerable-rover-print'){
  geometries.push(new THREE.BoxGeometry(155,106,4),new THREE.CylinderGeometry(30,30,8,32).rotateX(Math.PI/2).translate(210,0,4),new THREE.BoxGeometry(107,60,3).translate(0,95,2));
 }else{
  geometries.push(
   new THREE.BoxGeometry(155,106,4).translate(-47.5,0,15.5),
   new THREE.BoxGeometry(107,60,3).translate(-21.5,0,76),
   new THREE.BoxGeometry(58,36,3).translate(59,0,76),
   new THREE.BoxGeometry(62,30,30).translate(-5,0,32.5),
   new THREE.BoxGeometry(14,25,40).translate(75,0,48),
  );
  for(const y of [-70.5,70.5])geometries.push(new THREE.CylinderGeometry(31.5,31.5,8,32).translate(-35,y,31.5));
  geometries.push(new THREE.CylinderGeometry(31.5,31.5,8,32).translate(75,0,31.5));
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);
 try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
