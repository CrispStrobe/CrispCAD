// SPDX-License-Identifier: BSD-3-Clause
// Original visual harness routing. Functional ports, not fabrication pin assignments.
import * as T from 'three';
import {localToWorldPoint,worldToLocalPoint} from '@brickwright/cad-core';
import type {CadDocument,Vec3} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
export interface WireAnchor{bodyId:string;point:Vec3}
export interface RobotWire{id:string;label:string;color:string;from:WireAnchor;to:WireAnchor;via:WireAnchor[]}
const anchor=(bodyId:string,point:Vec3):WireAnchor=>({bodyId,point});
/** Derived from saved controlled joints and component identities. Never edits a project
 * or invents an electrical simulator connection. No harness in print-only layouts. */
export function robotWires(doc:CadDocument,result:GeometryResult):RobotWire[]{
 if(!doc.id.startsWith('robot-')||!doc.joints?.length)return [];
 const roots=new Set(doc.roots),bounds=new Map(result.bodies.map(b=>[b.id,b.bounds])),wires:RobotWire[]=[];
 const has=(id:string)=>roots.has(id)&&bounds.has(id);
 const driver=has('driver-envelope')?'driver-envelope':undefined,feather=has('feather-envelope')?'feather-envelope':undefined;
 const add=(id:string,label:string,color:string,from:WireAnchor,to:WireAnchor,via:WireAnchor[]=[])=>{if([from,to,...via].every(a=>has(a.bodyId)))wires.push({id,label,color,from,to,via});};
 let channel=0;
 for(const joint of doc.joints){
  if(!joint.control||!has(joint.bodyA))continue;
  const motor=doc.nodes[joint.bodyA],preset=motor.physics?.sourcePreset;
  if(!['tt-gearmotor','dc-toy-motor','micro-servo-1143'].includes(preset??''))continue;
  const port=joint.control.port,servo=preset==='micro-servo-1143',count=servo?3:2;
  const mount=doc.joints.find(j=>j.kind==='fixed'&&j.bodyB===motor.id&&has(j.bodyA))?.bodyA;
  const target=driver??feather??mount;if(!target)continue;
  const b=bounds.get(target)!,center:Vec3=b.min.map((v,i)=>(v+b.max[i])/2) as Vec3;
  const targetWorld:Vec3=[center[0],center[1],b.max[2]+.6];
  for(let i=0;i<count;i++){
   const terminal:Vec3=preset==='tt-gearmotor'?[-28.7,8.5,i===0?16.2:6.2]:preset==='dc-toy-motor'?[-19,i===0?-4:4,8.5]:[(i-1)*.9,-10.5,3];
   const targetNode=doc.nodes[target],top=targetNode.kind==='box'?targetNode.size[2]/2+.3:0;
   const pin:Vec3=target===driver?[-3.81+(channel*2+i)*2.54,6.35,targetNode.physics?.sourcePreset==='visual-drv8833'?1.5:top]:target===feather?[-10.16,-7.62+(channel*3+i)*2.54,targetNode.physics?.sourcePreset==='visual-feather-rp2040'?-2.3:top]:worldToLocalPoint([targetWorld[0]+i*1.4,targetWorld[1],targetWorld[2]],doc.nodes[target].transform);
   const start=localToWorldPoint(terminal,motor.transform),end=localToWorldPoint(pin,doc.nodes[target].transform);
   // Raise the loom above its mount, with a service loop for moving links.
   const z=Math.max(start[2],end[2])+6+i*.8;
   const via=anchor(target,worldToLocalPoint([(start[0]+end[0])/2,(start[1]+end[1])/2,z],doc.nodes[target].transform));
   add('motor-'+port+'-'+i,`${port} · ${servo?['ground','power','signal'][i]:['motor lead +','motor lead −'][i]} · functional routing`,servo?['#27313c','#e74646','#eea930'][i]:['#e74646','#303b4b'][i],anchor(motor.id,terminal),anchor(target,pin),[via]);
  }
  channel++;
 }
 if(driver&&feather){
  for(let i=0;i<5;i++)add('logic-'+i,i===0?'Controller/driver common ground':'Controller → driver control '+i,'#27313c #42b5dd #9a6ddd #59ba75 #eca53b'.split(' ')[i],anchor(feather,[10.16,-10.16+i*2.54,-2.3]),anchor(driver,[-3.81+i*2.54,-6.35,1.5]),[anchor(driver,[-14, -12+i*1.5,6+i*.7])]);
  if(has('battery-envelope')&&doc.nodes['battery-envelope'].physics?.sourcePreset==='visual-aa-holder-830'){
   const routeBody=has('chassis')?'chassis':driver;
   for(let i=0;i<2;i++){
    const from=anchor('battery-envelope',[32.3,-25+i*2,-2]);const to=anchor(driver,[-8.89+i*2.54,-6.35,1.5]);
    const fromWorld=localToWorldPoint(from.point,doc.nodes[from.bodyId].transform),toWorld=localToWorldPoint(to.point,doc.nodes[to.bodyId].transform);
    add('battery-'+i,i===0?'Battery → driver motor supply':'Battery → driver return',i===0?'#eb4242':'#25303c',from,to,[anchor(routeBody,worldToLocalPoint([fromWorld[0]+8,-34-i*2,toWorld[2]+2],doc.nodes[routeBody].transform)),anchor(driver,[-12,-15-i*2,4])]);
   }
  }
 }
 return wires;
}
const STEPS=24,SIDES=6;
/** Reuse fixed vertex/index buffers. Only poses move; no tube allocations per tick. */
export function createRobotWiring(scene:T.Scene,document:()=>CadDocument,body:(id:string)=>T.Object3D|undefined){
 const group=new T.Group();group.name='Functional cable harnesses';scene.add(group);
 const cables:{wire:RobotWire;mesh:T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;last:number[]}[]=[];
 const p=new T.Vector3(),tangent=new T.Vector3(),normal=new T.Vector3(),binormal=new T.Vector3();
 function clear(){for(const c of cables){c.mesh.geometry.dispose();c.mesh.material.dispose();}cables.length=0;group.clear();}
 function point(a:WireAnchor){const node=document().nodes[a.bodyId],mesh=body(a.bodyId);if(!node||!mesh)return undefined;mesh.updateWorldMatrix(true,false);return new T.Vector3(...localToWorldPoint(a.point,node.transform)).applyMatrix4(mesh.matrixWorld);}
 function update(){
  for(const c of cables){
   const points=[c.wire.from,...c.wire.via,c.wire.to].map(point);c.mesh.visible=points.every(Boolean);if(!c.mesh.visible)continue;
   const values=points.flatMap(v=>v!.toArray());if(values.every((v,i)=>Math.abs(v-(c.last[i]??Infinity))<1e-7))continue;c.last=values;
   const curve=new T.CatmullRomCurve3(points as T.Vector3[],false,'centripetal');
   const positions=c.mesh.geometry.getAttribute('position') as T.BufferAttribute,normals=c.mesh.geometry.getAttribute('normal') as T.BufferAttribute;
   for(let j=0;j<=STEPS;j++){
    curve.getPoint(j/STEPS,p);curve.getTangent(j/STEPS,tangent);
    normal.set(0,0,1);if(Math.abs(tangent.z)>.95)normal.set(0,1,0);normal.cross(tangent).normalize();binormal.crossVectors(tangent,normal).normalize();
    for(let k=0;k<=SIDES;k++){
     const angle=k/SIDES*Math.PI*2,cs=Math.cos(angle),sn=Math.sin(angle),idx=j*(SIDES+1)+k;
     const x=normal.x*cs+binormal.x*sn,y=normal.y*cs+binormal.y*sn,z=normal.z*cs+binormal.z*sn;
     positions.setXYZ(idx,p.x+x*.55,p.y+y*.55,p.z+z*.55);normals.setXYZ(idx,x,y,z);
    }
   }
   positions.needsUpdate=true;normals.needsUpdate=true;
  }
 }
 return {get count(){return cables.length;},reset(wires:RobotWire[]){clear();for(const wire of wires){
   const geometry=new T.BufferGeometry(),vertices=(STEPS+1)*(SIDES+1);geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(vertices*3),3).setUsage(T.DynamicDrawUsage));geometry.setAttribute('normal',new T.BufferAttribute(new Float32Array(vertices*3),3).setUsage(T.DynamicDrawUsage));
   const indices=[];for(let j=0;j<STEPS;j++)for(let k=0;k<SIDES;k++){const a=j*(SIDES+1)+k,b=a+SIDES+1;indices.push(a,a+1,b,b,a+1,b+1);}geometry.setIndex(indices);
   const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color:wire.color,roughness:.55}));mesh.name=wire.label;mesh.userData.wireId=wire.id;mesh.frustumCulled=false;group.add(mesh);cables.push({wire,mesh,last:[]});
  }update();},update,dispose(){clear();scene.remove(group);}};
}
