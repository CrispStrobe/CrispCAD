// SPDX-License-Identifier: BSD-3-Clause
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createCadSession,defaultPartPhysics,defaultSimulationSettings,identityTransform,t} from '@brickwright/cad-core';
import type {CadDocument,Vec3} from '@brickwright/cad-core';
import linkage from './simulation-assets/four-bar.json' with {type:'json'};
export const simulationExampleCatalog=[
 {id:'simlab-four-bar',name:'Four-bar linkage',category:'Simulation examples',description:'A closed four-bar assembly with independently checked dart_csp geometry. Drive port A; leave the other joints passive.',keywords:'mechanism crank coupler four bar linkage csp closed loop simulation',color:'#e8ab47'},
 {id:'simlab-slider',name:'Slider experiment',category:'Simulation examples',description:'A guided carriage with 50 mm travel. Drive its linear motor or launch it with an initial velocity.',keywords:'slider linear carriage prismatic piston simulation',color:'#78b4ce'},
 {id:'simlab-pendulum',name:'Pivot pendulum',category:'Simulation examples',description:'A pendulum with a limited ball pivot. Gravity, cone angle and motion tracing stay editable.',keywords:'pivot ball joint pendulum gravity cone simulation',color:'#b29ad9'},
 {id:'simlab-material-drop',name:'Material drop',category:'Simulation examples',description:'Three equal-size bodies with different illustrative material properties. Raise them and compare their bounce.',keywords:'material rubber wood steel bounce gravity drop simulation',color:'#e29c7c'},
];
export const isSimulationExample=(id:string)=>simulationExampleCatalog.some(p=>p.id===id);
const point=(name:keyof typeof linkage.points)=>linkage.points[name] as Vec3;
const barSpecs=()=>[{name:'Ground link',a:point('origin'),b:point('ground'),z:5,color:'#8c9ba2',fixed:true},{name:'Crank',a:point('origin'),b:point('crank'),z:14,color:'#da8b55'},{name:'Coupler',a:point('crank'),b:point('follower'),z:20,color:'#67aabb'},{name:'Follower',a:point('follower'),b:point('ground'),z:26,color:'#a28ac4'}];
export function createSimulationExample(id:string):CadDocument {
 const session=createCadSession();session.setSimulation(defaultSimulationSettings());session.rename(t(simulationExampleCatalog.find(p=>p.id===id)!.name));
 const add=(name:string,size:Vec3,position:Vec3,color:string,rotation:Vec3=[0,0,0])=>session.add({kind:'box',size},{name:t(name),color,transform:{...identityTransform(),position,rotation}});
 if(id==='simlab-four-bar'){
  const bars=barSpecs().map(spec=>{const dx=spec.b[0]-spec.a[0],dy=spec.b[1]-spec.a[1],length=Math.hypot(dx,dy),base=add(spec.name,[length+8,8,3],[(spec.a[0]+spec.b[0])/2,(spec.a[1]+spec.b[1])/2,spec.z],spec.color,[0,0,Math.atan2(dy,dx)*180/Math.PI]);const holes=[spec.a,spec.b].map(p=>session.add({kind:'cylinder',radius:2.5,height:5,segments:24},{transform:{...identityTransform(),position:[p[0],p[1],spec.z]}}));session.combine('subtract',[base,...holes]);const root=session.state.selection[0];session.update(root,{name:t(spec.name),physics:{...defaultPartPhysics(),motion:spec.fixed?'static':'dynamic'}});return root;});
  for(const [a,b,p]of [[0,1,point('origin')],[1,2,point('crank')],[2,3,point('follower')],[3,0,point('ground')]] as const)session.addJoint('hinge',bars[a],bars[b],[p[0],p[1],10],[0,0,1]);
  session.addTracer(bars[2],[point('follower')[0],point('follower')[1],20]);
 }else if(id==='simlab-slider'){
  const guide=add('Guide',[70,10,5],[0,0,5],'#8c9ba2'),carriage=add('Carriage',[12,14,8],[0,0,14],'#78b4ce');session.update(guide,{physics:{...defaultPartPhysics(),motion:'static'}});session.addJoint('slider',guide,carriage,[0,0,14],[1,0,0],{limits:[-25,25]});session.setInitialVelocity(carriage,[50,0,0],[0,0,0]);session.addTracer(carriage,[0,0,0]);
 }else if(id==='simlab-pendulum'){
  const anchor=add('Pivot support',[10,10,10],[0,0,80],'#8c9ba2'),arm=add('Pendulum arm',[6,6,40],[Math.SQRT1_2*20,0,80-Math.SQRT1_2*20],'#b29ad9',[0,-45,0]);session.update(anchor,{physics:{...defaultPartPhysics(),motion:'static'}});session.addJoint('pivot',anchor,arm,[0,0,80],[0,0,1],{coneAngle:Math.PI/3});session.addTracer(arm,[0,0,-20]);
 }else{
  for(const [i,material]of ['rubber','wood','steel'].entries()){const body=session.add({kind:'sphere',radius:6,segments:16},{name:t(material[0].toUpperCase()+material.slice(1)),color:['#dc875b','#b6976a','#a9b6be'][i],transform:{...identityTransform(),position:[(i-1)*20,0,100]}});session.applyPhysicsMaterial(material,[body]);session.addTracer(body,[0,0,0],['#e68e5a','#b39362','#99b6c8'][i]);}
 }
 const doc=structuredClone(session.state.document);session.dispose();return doc;
}
export function simulationExampleGeometry(id:string):THREE.BufferGeometry {
 const geometries:THREE.BufferGeometry[]=[];
 if(id==='simlab-four-bar')for(const spec of barSpecs()){const length=Math.hypot(spec.b[0]-spec.a[0],spec.b[1]-spec.a[1]),shape=new THREE.Shape();shape.moveTo(-length/2-4,-4);shape.lineTo(length/2+4,-4);shape.lineTo(length/2+4,4);shape.lineTo(-length/2-4,4);shape.closePath();for(const x of [-length/2,length/2]){const hole=new THREE.Path();hole.absarc(x,0,2.5,0,Math.PI*2,true);shape.holes.push(hole);}geometries.push(new THREE.ExtrudeGeometry(shape,{depth:3,bevelEnabled:false,curveSegments:12}).translate(0,0,-1.5).rotateZ(Math.atan2(spec.b[1]-spec.a[1],spec.b[0]-spec.a[0])).translate((spec.a[0]+spec.b[0])/2,(spec.a[1]+spec.b[1])/2,spec.z));}
 else if(id==='simlab-material-drop')for(let i=0;i<3;i++)geometries.push(new THREE.SphereGeometry(6,16,8).translate((i-1)*20,0,100));
 else if(id==='simlab-slider')geometries.push(new THREE.BoxGeometry(70,10,5).translate(0,0,5),new THREE.BoxGeometry(12,14,8).translate(0,0,14));
 else geometries.push(new THREE.BoxGeometry(10,10,10).translate(0,0,80),new THREE.BoxGeometry(6,6,40).rotateY(-Math.PI/4).translate(Math.SQRT1_2*20,0,80-Math.SQRT1_2*20));
 const plain=geometries.map(g=>g.index?g.toNonIndexed():g);try{return mergeGeometries(plain)!;}finally{for(const g of new Set([...plain,...geometries]))g.dispose();}
}
