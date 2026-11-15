// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import {newId} from './document.js';
import type {CadDocument,Transform,Vec3} from './document.js';
import type {CadJoint,PartPhysics} from './physics.js';
export interface SimulationSettings {gravity:Vec3;ground:boolean;groundFriction:number;groundRestitution:number}
export interface MotionTracer {id:string;bodyId:string;point:Vec3;color:string}
export const defaultSimulationSettings=():SimulationSettings=>({gravity:[0,0,-9.81],ground:true,groundFriction:.4,groundRestitution:.05});
/** Illustrative rigid-body presets; editable parameters, not material certification. */
export const physicsMaterials=Object.freeze([
 {id:'plastic',name:'Plastic',densityKgM3:1050,friction:.4,restitution:.1},
 {id:'wood',name:'Wood',densityKgM3:700,friction:.5,restitution:.25},
 {id:'steel',name:'Steel',densityKgM3:7800,friction:.35,restitution:.15},
 {id:'rubber',name:'Rubber',densityKgM3:1100,friction:.9,restitution:.8},
 {id:'ice',name:'Ice',densityKgM3:920,friction:.03,restitution:.05},
 {id:'foam',name:'Foam',densityKgM3:80,friction:.8,restitution:.15},
]);
export function simulationSettings(doc:CadDocument):SimulationSettings{return doc.version>=8&&doc.simulation?doc.simulation:defaultSimulationSettings();}
export function simulationTracers(doc:CadDocument):readonly MotionTracer[]{return doc.version>=8?doc.tracers??[]:[];}
export function upgradeSimulation(doc:CadDocument){if(doc.version<8&&(Object.hasOwn(doc,'simulation')||Object.hasOwn(doc,'tracers')))throw new Error(t('Cannot replace legacy opaque simulation fields'));doc.version=8;}
const bounded=(v:unknown,lo:number,hi:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const vec=(v:unknown,max=1e6):v is Vec3=>Array.isArray(v)&&v.length===3&&v.every(n=>bounded(n,-max,max));
export function checkSimulation(doc:CadDocument){
 if(doc.version<8)return;
 const fail=():never=>{throw new Error(t('Invalid simulation settings or tracers'));};
 if(doc.simulation!==undefined){const s=doc.simulation;if(!s||!vec(s.gravity,1000)||typeof s.ground!=='boolean'||!bounded(s.groundFriction,0,2)||!bounded(s.groundRestitution,0,1))fail();}
 if(doc.tracers!==undefined){if(!Array.isArray(doc.tracers)||doc.tracers.length>32)fail();const ids=new Set<string>();for(const trace of doc.tracers){if(!trace||typeof trace.id!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(trace.id)||ids.has(trace.id)||!doc.roots.includes(trace.bodyId)||doc.nodes[trace.bodyId].reference||doc.nodes[trace.bodyId].role==='hole'||!vec(trace.point)||!/^#[a-f0-9]{6}$/i.test(trace.color))fail();ids.add(trace.id);}}
}
export function rotatePoint(point:Vec3,rotation:Vec3,inverse=false):Vec3{
 let [x,y,z]=point;for(const i of inverse?[2,1,0]:[0,1,2]){const a=rotation[i]*Math.PI/180*(inverse?-1:1),c=Math.cos(a),s=Math.sin(a);if(i===0)[y,z]=[c*y-s*z,s*y+c*z];if(i===1)[x,z]=[c*x+s*z,-s*x+c*z];if(i===2)[x,y]=[c*x-s*y,s*x+c*y];}return [x,y,z];
}
export const localToWorldPoint=(point:Vec3,transform:Transform):Vec3=>rotatePoint(point.map((v,i)=>v*transform.scale[i]) as Vec3,transform.rotation).map((v,i)=>v+transform.position[i]) as Vec3;
export const worldToLocalPoint=(point:Vec3,transform:Transform):Vec3=>rotatePoint(point.map((v,i)=>v-transform.position[i]) as Vec3,transform.rotation,true).map((v,i)=>v/transform.scale[i]) as Vec3;
/** Construct both local frames from one explicit world frame. No hidden body movement. */
export function jointAtWorldFrame(doc:CadDocument,kind:CadJoint['kind'],bodyA:string,bodyB:string,anchor:Vec3,axis:Vec3,options:{limits?:[number,number];coneAngle?:number}={}):CadJoint{
 if(bodyA===bodyB||![bodyA,bodyB].every(id=>doc.roots.includes(id)&&!doc.nodes[id].reference&&doc.nodes[id].role!=='hole')||!vec(anchor)||!vec(axis,1e3)||Math.hypot(...axis)<1e-8)throw new Error(t('Choose two physical bodies and a valid connector frame'));
 const length=Math.hypot(...axis),unit=axis.map(v=>v/length) as Vec3;
 return {id:newId(),kind,bodyA,bodyB,anchorA:worldToLocalPoint(anchor,doc.nodes[bodyA].transform),anchorB:worldToLocalPoint(anchor,doc.nodes[bodyB].transform),axisA:rotatePoint(unit,doc.nodes[bodyA].transform.rotation,true),axisB:rotatePoint(unit,doc.nodes[bodyB].transform.rotation,true),...structuredClone(options)};
}
export function materialPhysics(previous:PartPhysics,materialId:string):PartPhysics{
 const preset=physicsMaterials.find(p=>p.id===materialId);if(!preset)throw new Error(t('Unknown material preset'));
 return {...previous,material:preset.id,densityKgM3:preset.densityKgM3,friction:preset.friction,restitution:preset.restitution};
}
