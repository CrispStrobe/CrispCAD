// SPDX-License-Identifier: BSD-3-Clause
// Original shared electronics carrier. Purchased surfaces retain their MIT provenance.
import {defaultPartPhysics,identityTransform,jointAtWorldFrame,pruneModelProvenance} from '@brickwright/cad-core';
import type {CadDocument,Vec3,CodeProgram} from '@brickwright/cad-core';
import {addComponentAppearance} from './component-provenance.js';
import * as T from 'three';
import {transformMatrix} from './transform-selection.js';
import frames from './robot-assets/electronics-mount-frames.json' with {type:'json'};
export const robotElectronicsMounts:Record<string,{body:string;origin:Vec3;rise:number;xs?:number[];ys?:number[]}>= {
 'robot-tt-rover':{body:'carrier',origin:[16,0,52],rise:7.5,xs:[-18,18],ys:[-14,14]},
 'robot-steerable-rover':{body:'deck',origin:[-28,0,77.5],rise:1},
 'robot-atlas-forklift':{body:'chassis',origin:[-58,0,17.5],rise:28.3},
 'robot-mantis-walker':{body:'carrier',origin:[35,0,39.5],rise:1,xs:[-9,9],ys:[-8,8]},
 'robot-nova-loader':{body:'chassis',origin:[-20,0,29],rise:11,xs:[-15,20],ys:[-18,18]},
 'robot-cyclone-sorter':{body:'frame',origin:[-14,-112,0],rise:0},
 'robot-helios-catapult':{body:'pedestal',origin:[0,-82,0],rise:0},
 'robot-labyrinth-tilter':{body:'stand',origin:[-16,-82,0],rise:0},
 'robot-apex-scara':{body:'pedestal',origin:[-18,-68,0],rise:0},
 'robot-orion-carousel':{body:'base',origin:[20,-98,0],rise:0},
 'robot-vortex-pinball':{body:'arena',origin:[0,-118,0],rise:0},
 'robot-titan-vise':{body:'base',origin:[0,-80,0],rise:0},
 'robot-hermes-crane':{body:'gantry',origin:[0,-78,0],rise:0},
 'robot-chronos-drawbridge':{body:'deck',origin:[0,-74,0],rise:0},
 'robot-polaris-tracker':{body:'rail-base',origin:[0,-64,0],rise:0},
 'robot-boreal-launcher':{body:'base',origin:[20,-86,0],rise:0},
 'robot-zephyr-conveyor':{body:'frame',origin:[0,-75,0],rise:0},
 'robot-quasar-press':{body:'stand',origin:[0,-88,0],rise:0},
 'robot-vector-plotter':{body:'frame',origin:[0,-98,0],rise:0},
 'robot-aegis-sentry':{body:'outpost',origin:[0,-86,0],rise:0},
 'robot-stratos-gimbal':{body:'base',origin:[0,-80,0],rise:0},
 'robot-kestrel-arm':{body:'pedestal',origin:[0,-82,0],rise:0},
};
/** Pin roles match the functional Uno project packager. Physical pads are illustrative. */
export function robotElectricalPlan(doc:CadDocument){
 const joints=(doc.joints??[]).filter(j=>j.control);
 const motors=joints.filter(j=>j.kind==='slider'||j.kind==='hinge'&&!j.limits);
 const servos=joints.filter(j=>j.kind==='hinge'&&j.limits);
 const pinsets=[[5,2,3],[6,4,7],[9,8,10]];
 return {controller:'electronics-controller',regulator:'electronics-regulator',bus:'electronics-servo-bus',
  drivers:Math.ceil(motors.length/2),
  motors:motors.map((joint,i)=>({joint,driver:'electronics-driver-'+Math.floor(i/2),channel:i%2,pins:pinsets[i]})),
  servos:servos.map((joint,i)=>({joint,pin:11+i})),
 };
}
export function canAddRobotElectronics(doc:CadDocument){
 const mount=robotElectronicsMounts[doc.id];
 return !!mount&&doc.roots.includes(mount.body)&&!!doc.joints?.some(j=>j.control)&&!Object.keys(doc.nodes).some(id=>id.startsWith('electronics-'))&&doc.nodes[mount.body].transform.scale.every(v=>v===1);
}
export function addRobotElectronics(doc:CadDocument){
 const mount=robotElectronicsMounts[doc.id];if(!mount||!doc.joints?.some(j=>j.control))return;
 if(Object.hasOwn(doc.nodes,'electronics-controller'))return;
 if(!canAddRobotElectronics(doc))throw new Error('This assembly already contains electronics or its mounting frame has been resized');
 for(const id of ['feather-envelope','driver-envelope'])if(doc.nodes[id]){delete doc.nodes[id];doc.roots=doc.roots.filter(r=>r!==id);doc.joints=doc.joints!.filter(j=>j.bodyA!==id&&j.bodyB!==id);}
 // Mantis's moving ballast remains a distinct mechanical load, not its supply.
 if(doc.id==='robot-mantis-walker'&&doc.nodes['battery-envelope'])doc.nodes['battery-envelope'].name='Pendulum ballast · unpowered';
 const [x,y,z]=mount.origin,top=z+mount.rise+2.4,compact=doc.id==='robot-mantis-walker';
 function mate(id:string){const j=jointAtWorldFrame(doc,'fixed',mount.body,id,doc.nodes[id].transform.position,[0,0,1]);j.id='electronics-fixed-'+id;doc.joints!.push(j);}
 function box(id:string,name:string,size:Vec3,position:Vec3,density=800,preset?:string){
  doc.nodes[id]={id,name,kind:'box',size,transform:{...identityTransform(),position},color:'#3c596d',physics:{...defaultPartPhysics(),densityKgM3:density,restitution:.02,...(preset?{sourcePreset:preset}:{})}};doc.roots.push(id);mate(id);
 }
 const xs=mount.xs??[-36,36],ys=mount.ys??[-24,24];
 const posts=mount.rise>0?xs.flatMap(a=>ys.map(b=>`move([${a},${b},0],cylinder(2.6,${mount.rise},12))`)):[];
 const plate=`move([0,0,${mount.rise+1.2}],box(${compact?52:88},${compact?30:62},2.4))`;
 const holes=xs.flatMap(a=>ys.map(b=>`move([${a},${b},-1],cylinder(1.3,${mount.rise+5},12))`));
 const program:CodeProgram={version:1,language:'brickwright-cad-script',parameters:{},source:'// Original shared electronics tray; BSD-3-Clause. Millimetres.\nreturn subtract('+ (posts.length?'union('+[plate,...posts].join(',')+')':plate)+',union('+holes.join(',')+'));\n'};
 doc.nodes['electronics-mount']={id:'electronics-mount',name:'Electronics tray · prototype mounting',kind:'code',program,transform:{...identityTransform(),position:[x,y,z]},color:'#536b80',physics:{...defaultPartPhysics(),densityKgM3:1240,material:'plastic',restitution:.02}};doc.roots.push('electronics-mount');mate('electronics-mount');
 box('electronics-controller','METRO Mini · ATmega328P / 16 MHz',[45,18,6],compact?[35,0,top+5]:[x-16,y+12,top+5]);
 addComponentAppearance(doc,'electronics-controller','visual-metro-mini');
 doc.nodes['electronics-controller'].physics!.parameters={clockHz:16000000,logicV:5,motorSupplyV:6};
 box('electronics-regulator','MPM3610 · regulated 5 V',[11,18,4],compact?[-35,0,63]:[x-31,y-18,top+4]);
 addComponentAppearance(doc,'electronics-regulator','visual-buck-5v');
 const plan=robotElectricalPlan(doc);
 for(let i=0;i<plan.drivers;i++){
  const id='electronics-driver-'+i;box(id,'Dual H-bridge · functional module',[26,18,8],[x-9+i*29,y-18,top+6],550);
  addComponentAppearance(doc,id,'visual-dual-hbridge');doc.nodes[id].name='Dual H-bridge · '+plan.motors.filter(p=>p.driver===id).map(p=>p.joint.control!.port).join('/');
 }
 if(plan.servos.length)box('electronics-servo-bus','5 V servo distribution · '+plan.servos.map(p=>p.joint.control!.port).join('/'),[24,8,5],compact?[66,0,47.4]:[x+20,y+26,top+2.5],650,'visual-servo-bus');
 if(doc.id==='robot-tt-rover'){
  // Keep the already licensed, full-size AA case and its mass/placement.
 }else if(doc.id==='robot-steerable-rover'&&doc.nodes['battery-envelope']){
  doc.nodes['battery-envelope'].physics={...doc.nodes['battery-envelope'].physics!,sourcePreset:'visual-power-source'};doc.nodes['battery-envelope'].name='6 V portable supply · functional housing';
 }else{
  box('electronics-power',doc.simulation?.fixBase===false?'6 V portable supply · functional housing':'6 V bench supply · functional housing',[36,26,16],compact?[-30,0,51]:[x+25,y+8,top+8],1200,'visual-power-source');
 }
 if(compact){
  doc.nodes['electronics-servo-bus'].transform.rotation=[0,0,90];
  box('electronics-bus-mount','Servo header clip perch',[10,28,2],[65,0,43.9],1240);
  const id='electronics-power-mount';
  doc.nodes[id]={id,name:'Power pod clip carrier',kind:'code',program:{version:1,language:'brickwright-cad-script',parameters:{},source:'return union(move([0,0,9.7],box(36,26,2.4)),move([-16,-11,0],cylinder(2.6,8.5,12)),move([-16,11,0],cylinder(2.6,8.5,12)),move([-10,-11,0],cylinder(2.6,8.5,12)),move([-10,11,0],cylinder(2.6,8.5,12)));'},transform:{...identityTransform(),position:[-30,0,32]},color:'#536b80',physics:{...defaultPartPhysics(),densityKgM3:1240,material:'plastic'}};doc.roots.push(id);mate(id);
 }
 if(doc.id==='robot-nova-loader'){
  for(const [port,sign]of [['A',1],['B',-1]] as const){
   box('electronics-actuator-'+port,port+' · compact DC gear drive (functional housing)',[14,24,31],[0,sign*14,16.4],900,'visual-dc-drive');
   doc.nodes['electronics-actuator-'+port].transform.rotation=[0,0,sign<0?180:0];
  }
 }
 if(doc.id==='robot-tt-rover'){
  box('electronics-encoder','A · ideal two-channel encoder pickup',[12,8,6],[25,51,38],650,'visual-encoder');
  doc.nodes['electronics-encoder'].transform.rotation=[-90,0,0];
 }
 // Also support adding hardware to an older example moved/rotated as an assembly.
 const raw=frames[doc.id as keyof typeof frames];
 const stock={position:raw.position as Vec3,rotation:raw.rotation as Vec3,scale:raw.scale as Vec3};
 const delta=transformMatrix(doc.nodes[mount.body].transform).multiply(transformMatrix(stock).invert());
 if(!delta.equals(new T.Matrix4()))for(const [id,node]of Object.entries(doc.nodes))if(id.startsWith('electronics-')){
  const p=new T.Vector3(),q=new T.Quaternion(),scale=new T.Vector3();delta.clone().multiply(transformMatrix(node.transform)).decompose(p,q,scale);const e=new T.Euler().setFromQuaternion(q,'ZYX');
  node.transform={position:p.toArray() as Vec3,rotation:[e.x*180/Math.PI,e.y*180/Math.PI,e.z*180/Math.PI],scale:scale.toArray() as Vec3};
 }
 for(const joint of doc.joints!.filter(j=>j.id.startsWith('electronics-fixed-'))){
  const frame=jointAtWorldFrame(doc,'fixed',joint.bodyA,joint.bodyB,doc.nodes[joint.bodyB].transform.position,[0,0,1]);
  joint.anchorA=frame.anchorA;joint.anchorB=frame.anchorB;joint.axisA=frame.axisA;joint.axisB=frame.axisB;
 }
 pruneModelProvenance(doc);
}
