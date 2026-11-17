import {addRobotElectronics} from './robot-electronics.js';
import {addComponentAppearance} from './component-provenance.js';
// SPDX-License-Identifier: BSD-3-Clause
// Original printable mechanics. Adafruit motor derivatives retain their MIT provenance.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createDocument,defaultPartPhysics,defaultSimulationSettings,identityTransform,jointAtWorldFrame,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,SolidNode,Vec3} from '@brickwright/cad-core';
import {createMotorDocument} from './motor-models.js';
import {ttRoverCollisionAssembly} from './tt-rover-collisions.js';

export const TT_ROVER_ID='robot-tt-rover';
export const roverCatalog=[
 {id:TT_ROVER_ID,name:'Scout TT rover',category:'Robots',description:'A buildable two-wheel robot with Adafruit TT motors, original PLA parts and A/B simulation drives. Print parts separately; see the build guide.',keywords:'robot rover pla printable adafruit 3777 tt differential drive scout wheels',color:'#38a99a'},
 {id:'robot-tt-rover-print',name:'Scout PLA print layout',category:'Robots',description:'Twelve original PLA parts laid flat for inspection, including a bolted electronics carrier. Export each part separately for your printer.',keywords:'robot rover pla chassis wheel cradle skid standoff electronics carrier print parts',color:'#38a99a'},
 {id:'robot-tt-rover-fit',name:'Scout shaft fit gauge',category:'Robots',description:'Five double-D sockets with 0.15–0.55 mm total clearance. Print this first and check your actual TT shaft.',keywords:'robot rover tolerance coupon double d shaft fit gauge',color:'#e8ab47'},
 {id:'robot-tt-rover-carrier',name:'Scout electronics carrier',category:'Robots',description:'Original PLA carrier for a Feather RP2040 and DRV8833, with insulating bosses and through-bolt mounts matching the Scout deck slots. Verify board revisions and solder clearance.',keywords:'robot rover pla electronics carrier feather rp2040 drv8833 mounting board',color:'#80c7be'},
];
export const isTTRover=(id:string)=>roverCatalog.some(p=>p.id===id);
export const ttRoverDimensions=Object.freeze({chassis:[160,110,4],axleX:25,axleZ:32,motorY:44,wheelTrack:141,wheelRadius:31.5,shaftDiameter:5.4,shaftFlats:3.7,shaftEngagement:5.8,shaftClearance:.25,deckHeight:46,carrierBaseZ:49,boardUndersideZ:58,skidX:-85});
// Mechanical dimensions only, independently read from the pinned Adafruit PCB
// fabrication data. No PCB artwork or third-party mount implementation is copied.
// The exact revisions, source coordinates and rotation are recorded in the guide.
export const ttRoverElectronics={
 featherHoles:[[-8.89,-22.86],[8.89,-22.86],[-8.89,22.86],[8.89,22.86]],
 driverHoles:[[21.84,6.35],[42.16,6.35]],
 // Keep all four tool axes outside both PCBs. Shift both rows along the
 // existing slots to leave room for washers beside the deck posts below.
 deckHoles:[[25,-12.5],[25,12.5],[39,-12.5],[39,12.5]],
 plateThickness:3,bossHeight:6,bossDiameter:5,boardBore:2.8,
} as const;
const boardHoles=[...ttRoverElectronics.featherHoles,...ttRoverElectronics.driverHoles];
const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source:'// Original Scout TT rover part; BSD-3-Clause. Millimetres.\n'+source.trim()+'\n'});
const bore=(x:number,y:number,z=0,h=30,r=1.7)=>`move([${x},${y},${z}],cylinder(${r},${h},32))`;
const cuts=(items:string[])=>items.join(',\n  ');
const motorHoles=[-31,32].flatMap(x=>[-7,7].map(y=>[x+5.7,y]));
const postPositions:Vec3[]=[[-20,-22,18],[-20,22,18],[40,-22,18],[40,22,18]];

export const ttRoverPartPrograms={
 chassis:program(`param thickness:mm=4;
let plate=move([-20,0,thickness/2],box(160,110,thickness));
return subtract(plate,
  ${cuts([-44,44].flatMap(my=>motorHoles.map(([x,y])=>bore(x,my+y,2,12))).concat(postPositions.map(([x,y])=>bore(x,y,2,12)),[-96,-74].map(x=>bore(x,0,2,12)),[-85,-45].flatMap(x=>[-41,41].map(y=>`move([${x},${y},2],box(13,4,12))`)),[-10,10,30,50].map(x=>bore(x,0,2,12))))});`),
 cradle:program(`param floor:mm=2.8;
let foot=move([0,-1,floor/2],box(74,28.2,floor));
let rails=union(move([-13.5,-14.1,floor+3 mm],box(43,2,6)),move([-13.5,12.1,floor+3 mm],box(43,2,6)));
let stop=move([-36.5,-1,floor+2 mm],box(1,28.2,4));
return subtract(union(foot,rails,stop),
  ${cuts([-31,32].flatMap(x=>[-7,7].map(y=>bore(x,y,4,20))))},
  ${cuts([-31,32].flatMap(x=>[-7,7].map(y=>`move([${x},${y},2],frustum(1.7,3.3,1.6,32))`)))},
  move([20,-18,floor/2+3 mm],box(36,12,floor+8 mm)),move([20,18,floor/2+3 mm],box(36,12,floor+8 mm)),
  move([-20,-1,0.7],box(3.6,32,1.4)),move([0,-1,0.7],box(3.6,32,1.4)));`),
 wheel:program(`param clearance:mm=0.25;
param shaftDiameter:mm=5.4;
param shaftFlats:mm=3.7;
let disc=move([0,0,1.5],cylinder(30,3,64));
let rim=subtract(move([0,0,4],cylinder(30,8,64)),move([0,0,5],cylinder(25,12,64)));
let hub=move([0,0,9],cylinder(10,18,48));
let ears=union(move([7.5,0,13.5],box(10,19,9)),hull(move([7.5,0,4],box(10,9,2)),move([7.5,0,9],box(10,19,1))));
let socket=move([0,0,15.2],intersect(cylinder((shaftDiameter+clearance)/2,6.4,48),box(10,shaftFlats+clearance,6.4)));
let slit=move([9,0,15],box(18,1,7));
let clamp=move([6.5,0,13.5],rotate([90,0,0],cylinder(1.7,24,32)));
let nut=move([6.5,-7.8,13.5],rotate([90,0,0],cylinder(3.3,3.8,6)));
let grooves=union(move([0,0,2],torus(30,1.5,12,64)),move([0,0,6],torus(30,1.5,12,64)));
return subtract(union(disc,rim,hub,ears),socket,slit,clamp,nut,grooves);`),
 deck:program(`param thickness:mm=3;
let plate=move([10,0,thickness/2],box(80,56,thickness));
return subtract(plate,
 ${cuts(postPositions.map(([x,y])=>bore(x,y,2,12)))},
 ${cuts([-8,8,25,39].flatMap(x=>[-14,14].map(y=>`move([${x},${y},2],box(3.6,9,12))`)))});`),
 standoff:program(`param height:mm=28;param bore:mm=3.4;
return move([0,0,height/2],subtract(cylinder(4.5,height,32),cylinder(bore/2,height+2 mm,32)));`),
 carrier:program(`param boardClearance:mm=6;param boardBore:mm=2.8;
// Editing bounds: 6..20 mm boss height, 2.6..3.0 mm bore; invalid edits refuse.
// Flat underside on the bed; countersinks open downward with 45-degree walls.
// Six purchased M2.5 countersunk bolts enter from below before deck installation.
let plate=union(move([0,0,1.5],box(28,56,3)),move([32,0,1.5],box(30,36,3)),move([16,0,1.5],box(8,20,3)));
let bosses=union(${cuts(boardHoles.map(([x,y])=>`move([${x},${y},3 mm+boardClearance/2],cylinder(2.5,boardClearance,16))`))});
let boardBores=union(${cuts(boardHoles.map(([x,y])=>`move([${x},${y},3 mm+boardClearance/2],cylinder(boardBore/2,8 mm+boardClearance,16))`))});
let undersideHeads=union(${cuts(boardHoles.map(([x,y])=>`move([${x},${y},0.7],frustum(2.8,1.4,1.4,16))`))});
let deckBores=union(${cuts(ttRoverElectronics.deckHoles.map(([x,y])=>`move([${x},${y},2],cylinder(1.7,10,16))`))});
let deckHeads=union(${cuts(ttRoverElectronics.deckHoles.map(([x,y])=>`move([${x},${y},2.2],frustum(1.7,3.3,1.6,16))`))});
return choose(boardClearance >= 6 mm && boardClearance <= 20 mm && boardBore >= 2.6 mm && boardBore <= 3 mm,
 subtract(union(plate,bosses),boardBores,undersideHeads,deckBores,deckHeads),empty());`),
 skid:program(`let flange=move([0,0,12.5],box(32,20,3));
let toe=union(move([0,0,7],sphere(7,32)),move([0,0,10],cylinder(7,8,32)));
return subtract(union(flange,toe),${bore(-11,0,7,20)},${bore(11,0,7,20)});`),
 fit:program(`let plate=move([0,0,2],box(74,18,4));
return subtract(plate,
 ${cuts([.15,.25,.35,.45,.55].map((c,i)=>`move([${(i-2)*14},0,2],intersect(cylinder(${(5.4+c)/2},8,48),box(10,${3.7+c},8)))`))},
 ${cuts([0,1,2,3,4].flatMap(i=>Array.from({length:i+1},(_,j)=>`move([${(i-2)*14+(j-i/2)*2},7.5,2],cylinder(0.55,8,16))`)))});`),
} satisfies Record<string,CodeProgram>;
export type TTRoverPart=keyof typeof ttRoverPartPrograms;
export const ttRoverPrintQuantities:Record<Exclude<TTRoverPart,'fit'>,number>={chassis:1,cradle:2,wheel:2,deck:1,standoff:4,skid:1,carrier:1};
const names:Record<TTRoverPart,string>={chassis:'PLA chassis',cradle:'PLA motor cradle',wheel:'PLA clamping wheel',deck:'PLA electronics deck',standoff:'PLA deck standoff',skid:'PLA rear skid',fit:'Double-D shaft fit gauge',carrier:'PLA electronics carrier'};
const colors:Record<TTRoverPart,string>={chassis:'#38a99a',cradle:'#287f79',wheel:'#e8ab47',deck:'#80c7be',standoff:'#287f79',skid:'#287f79',fit:'#e8ab47',carrier:'#80c7be'};
function addPart(doc:CadDocument,part:TTRoverPart,id:string,position:Vec3,rotation:Vec3=[0,0,0]){
 const node:SolidNode={id,name:t(names[part]),kind:'code',program:structuredClone(ttRoverPartPrograms[part]),transform:{...identityTransform(),position,rotation},color:colors[part],physics:{...defaultPartPhysics(),densityKgM3:1240,material:'plastic',friction:part==='skid'?.12:.4,restitution:.02,sourcePreset:TT_ROVER_ID,collisionAssembly:ttRoverCollisionAssembly(part)}};
 doc.nodes[id]=node;doc.roots.push(id);return id;
}
/** One manufactured part in its support-free orientation. No purchased components. */
export function createTTRoverPart(part:TTRoverPart):CadDocument{
 const doc=createDocument(t(names[part]));doc.id='scout-tt-'+part;doc.version=8;
 addPart(doc,part,part,part==='skid'?[0,0,14]:[0,0,0],part==='skid'?[180,0,0]:[0,0,0]);return doc;
}
function fixed(doc:CadDocument,a:string,b:string){const joint=jointAtWorldFrame(doc,'fixed',a,b,doc.nodes[b].transform.position,[0,0,1]);joint.id='fixed-'+b;doc.joints!.push(joint);}

/** Assembled model, with purchased hardware separate from the original print parts. */
export function createTTRoverDocument(id=TT_ROVER_ID):CadDocument{
 if(id==='robot-tt-rover-fit')return createTTRoverPart('fit');
 if(id==='robot-tt-rover-carrier')return createTTRoverPart('carrier');
 const doc=createDocument(t(id==='robot-tt-rover-print'?'Scout PLA print layout':'Scout TT rover'));doc.id=id;doc.version=8;
 if(id==='robot-tt-rover-print'){
  addPart(doc,'chassis','chassis',[0,0,0]);
  addPart(doc,'deck','deck',[0,100,0]);
  for(const [i,y]of [-38,38].entries())addPart(doc,'cradle','cradle-'+i,[130,y,0]);
  for(const [i,y]of [-38,38].entries())addPart(doc,'wheel','wheel-'+i,[210,y,0]);
  postPositions.forEach((_,i)=>addPart(doc,'standoff','standoff-'+i,[120+i*15,105,0]));
  addPart(doc,'skid','skid',[215,105,14],[180,0,0]);
  addPart(doc,'carrier','carrier',[0,170,0]);return doc;
 }
 doc.simulation={...defaultSimulationSettings(),fixBase:false,groundFriction:.8,groundRestitution:.02};doc.joints=[];
 addPart(doc,'chassis','chassis',[0,0,14]);
 for(const [side,y]of [['left',44],['right',-44]] as const){
  addPart(doc,'cradle',side+'-cradle',[5.7,y,18]);fixed(doc,'chassis',side+'-cradle');
  addPart(doc,'wheel',side+'-wheel',[25,Math.sign(y)*74.5,32],[Math.sign(y)*90,0,0]);
 }
 addPart(doc,'deck','deck',[0,0,46]);fixed(doc,'chassis','deck');
 addPart(doc,'carrier','carrier',[0,0,49]);fixed(doc,'deck','carrier');
 postPositions.forEach((position,i)=>{const p=addPart(doc,'standoff','standoff-'+i,position);fixed(doc,'chassis',p);});
 addPart(doc,'skid','skid',[-85,0,0]);fixed(doc,'chassis','skid');
 // The SAME motor orientation makes +Y rotation forward on both sides.
 // Roots are rigidly transformed; child meshes and candidate colliders stay local.
 for(const [side,y,port]of [['left',44,'A'],['right',-44,'B']] as const){
  const motor=createMotorDocument('tt-gearmotor');doc.provenance??=structuredClone(motor.provenance);
  for(const [key,original]of Object.entries(motor.nodes)){
   const node=structuredClone(original);node.id=side+'-'+key;
   if(node.kind==='boolean')node.inputs=node.inputs.map(input=>side+'-'+input);
   if(motor.roots.includes(key)){node.transform.position=[5.7,y,20.8];node.physics={...node.physics!,collisionAssembly:ttRoverCollisionAssembly(key)};}
   node.name=t(side==='left'?'Left TT motor':'Right TT motor')+(key==='shaft'?' · '+t('Output shaft'):'');doc.nodes[node.id]=node;
  }
  doc.roots.push(side+'-casing',side+'-shaft');fixed(doc,'chassis',side+'-casing');
  const joint=jointAtWorldFrame(doc,'hinge',side+'-casing',side+'-shaft',[25,y,32],[0,1,0]);joint.id='drive-'+port.toLowerCase();joint.control={port};doc.joints.push(joint);
  fixed(doc,side+'-shaft',side+'-wheel');
  for(const [i,offset]of [2,6].entries()){
   const key=side+'-tire-'+i;doc.nodes[key]={id:key,name:t('Purchased O-ring tire'),kind:'code',program:program('return torus(30,1.5,12,64);'),transform:{...identityTransform(),position:[25,Math.sign(y)*(74.5-offset),32],rotation:[90,0,0]},color:'#303c40',physics:{...defaultPartPhysics(),densityKgM3:1100,material:'rubber',friction:1,restitution:.03,collisionAssembly:ttRoverCollisionAssembly('tire')}};doc.roots.push(key);fixed(doc,side+'-wheel',key);
  }
 }
 // Original conservative envelopes, NOT claimed vendor PCB meshes. A battery
 // and PCB mass placeholders participate as fixed purchased bodies, so all
 // envelopes follow the mobile base. They are excluded from the print export.
 const battery='battery-envelope';doc.nodes[battery]={id:battery,name:t('Purchased AA pack envelope'),kind:'box',size:[66.1,72.4,21.6],transform:{...identityTransform(),position:[-65.5,0,34.8]},color:'#465461',physics:{...defaultPartPhysics(),densityKgM3:1400,restitution:.02}};doc.roots.push(battery);fixed(doc,'chassis',battery);
 for(const [key,name,size,position]of [['feather-envelope','Feather board clearance',[22.86,50.8,8],[0,0,62]],['driver-envelope','Motor driver clearance',[26,18,8],[32,0,62]]] as const){doc.nodes[key]={id:key,name:t(name),kind:'box',size:[...size],transform:{...identityTransform(),position:[...position]},color:'#3f7291',physics:{...defaultPartPhysics(),densityKgM3:550,restitution:.02}};doc.roots.push(key);fixed(doc,'carrier',key);}
 addComponentAppearance(doc,'feather-envelope','visual-feather-rp2040');
 addComponentAppearance(doc,'battery-envelope','visual-aa-holder-830');
 addComponentAppearance(doc,'driver-envelope','visual-drv8833');
 addRobotElectronics(doc);
 doc.tracers=[{id:'rover-path',bodyId:'chassis',point:[-20,0,4],color:'#38a99a'}];
 doc.simulation={...defaultSimulationSettings(),...doc.simulation,selfCollisions:false};
 return doc;
}

/** Lightweight catalogue silhouette. The inserted assembly uses the real source model. */
export function ttRoverPreview(id:string):THREE.BufferGeometry{
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='robot-tt-rover-fit')geometries.push(new THREE.BoxGeometry(74,18,4).translate(0,0,2));
 else if(id==='robot-tt-rover-carrier'){
  geometries.push(new THREE.BoxGeometry(28,56,3).translate(0,0,1.5),new THREE.BoxGeometry(30,36,3).translate(32,0,1.5),new THREE.BoxGeometry(8,20,3).translate(16,0,1.5));
  for(const [x,y]of boardHoles)geometries.push(new THREE.CylinderGeometry(2.5,2.5,6,16).rotateX(Math.PI/2).translate(x,y,6));
 }
 else if(id==='robot-tt-rover-print')geometries.push(new THREE.BoxGeometry(160,110,4),new THREE.CylinderGeometry(30,30,8,32).rotateX(Math.PI/2).translate(130,0,4),new THREE.BoxGeometry(80,56,3).translate(0,95,2));
 else {
  geometries.push(new THREE.BoxGeometry(160,110,4).translate(-20,0,16),new THREE.BoxGeometry(80,56,3).translate(10,0,47.5),new THREE.BoxGeometry(66,72,22).translate(-65.5,0,33));
  for(const y of [-70.5,70.5])geometries.push(new THREE.CylinderGeometry(31.5,31.5,8,32).translate(25,y,32));
  for(const y of [-44,44])geometries.push(new THREE.BoxGeometry(70.6,22.6,22.4).translate(5.7,y-1,32));
 }
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
