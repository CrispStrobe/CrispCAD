// SPDX-License-Identifier: BSD-3-Clause
// Original visual harness routing. Functional ports, not fabrication pin assignments.
import * as T from 'three';
import {localToWorldPoint,worldToLocalPoint} from '@brickwright/cad-core';
import type {CadDocument,Vec3} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
import {robotElectricalPlan} from './robot-electronics.js';
export interface WireAnchor{bodyId:string;point:Vec3}
export interface RobotWire{id:string;label:string;color:string;from:WireAnchor;to:WireAnchor;via:WireAnchor[]}
const anchor=(bodyId:string,point:Vec3):WireAnchor=>({bodyId,point});
/** Derived from saved controlled joints and component identities. Never edits a project
 * or invents an electrical simulator connection. No harness in print-only layouts. */
export function robotWires(doc:CadDocument,result:GeometryResult):RobotWire[]{
 if(doc.nodes['electronics-controller'])return completeElectronicsWires(doc,result);
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
const ring=Array.from({length:SIDES+1},(_,k)=>{
 const angle=k/SIDES*Math.PI*2;
 return {cos:Math.cos(angle),sin:Math.sin(angle)};
});
/** Reuse authored anchor coordinates and fixed tube buffers across pose updates. */
export function createRobotWiring(scene:T.Scene,document:()=>CadDocument,body:(id:string)=>T.Object3D|undefined){
 const group=new T.Group();group.name='Functional cable harnesses';scene.add(group);
 group.matrixAutoUpdate=false;
 const cables:{mesh:T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;anchors:WireAnchor[];authoredPoints:(Vec3|undefined)[];points:T.Vector3[];curve:T.CatmullRomCurve3;samples:T.Vector3[];dirty:boolean}[]=[];
 const p=new T.Vector3(),tangent=new T.Vector3(),normal=new T.Vector3(),binormal=new T.Vector3();
 let authoredDocument:CadDocument|undefined,immutableAnchors=false;
 const frameBodies=new Map<string,T.Object3D|null>();
 function clear(){for(const c of cables){c.mesh.geometry.dispose();c.mesh.material.dispose();}cables.length=0;frameBodies.clear();authoredDocument=undefined;group.clear();}
 function refreshAuthoredPoints(doc:CadDocument) {
  if(doc!==authoredDocument){
   authoredDocument=doc;
   // CadSession freezes complete snapshots. Also handle callers that keep
   // a mutable document or mutate a nested transform in place.
   immutableAnchors=Object.isFrozen(doc)&&Object.isFrozen(doc.nodes)&&cables.every(c=>c.anchors.every(a=>{
    const node=doc.nodes[a.bodyId];
    if(!node)return true;
    const {transform}=node;
    return Object.isFrozen(node)&&Object.isFrozen(transform)&&Object.isFrozen(transform.position)
     &&Object.isFrozen(transform.rotation)&&Object.isFrozen(transform.scale);
   }));
  }
  for(const c of cables)c.authoredPoints=c.anchors.map(a=>{
   const transform=doc.nodes[a.bodyId]?.transform;
   return transform?localToWorldPoint(a.point,transform):undefined;
  });
 }
 function frameBody(id:string){
  const previous=frameBodies.get(id);
  if(previous!==undefined)return previous;
  const mesh=body(id)??null;
  mesh?.updateWorldMatrix(true,false);
  frameBodies.set(id,mesh);
  return mesh;
 }
 function update(){
  if(!cables.length)return;
  frameBodies.clear();
  const doc=document();
  if(doc!==authoredDocument||!immutableAnchors)refreshAuthoredPoints(doc);
  for(const c of cables){
   let changed=c.dirty;c.mesh.visible=true;
   for(let i=0;i<c.anchors.length;i++){
    const authored=c.authoredPoints[i],mesh=authored&&frameBody(c.anchors[i].bodyId);
    if(!authored||!mesh){c.mesh.visible=false;c.dirty=true;break;}
    const v=c.points[i],x=v.x,y=v.y,z=v.z;
    v.fromArray(authored).applyMatrix4(mesh.matrixWorld);
    if(Math.abs(v.x-x)>1e-7||Math.abs(v.y-y)>1e-7||Math.abs(v.z-z)>1e-7)changed=true;
   }
   if(!c.mesh.visible||!changed)continue;c.dirty=false;
   for(let j=0;j<=STEPS;j++)c.curve.getPoint(j/STEPS,c.samples[j]);
   const positions=c.mesh.geometry.getAttribute('position') as T.BufferAttribute,normals=c.mesh.geometry.getAttribute('normal') as T.BufferAttribute;
   for(let j=0;j<=STEPS;j++){
    p.copy(c.samples[j]);tangent.subVectors(c.samples[Math.min(STEPS,j+1)],c.samples[Math.max(0,j-1)]).normalize();
    normal.set(0,0,1);if(Math.abs(tangent.z)>.95)normal.set(0,1,0);normal.cross(tangent).normalize();binormal.crossVectors(tangent,normal).normalize();
    for(let k=0;k<=SIDES;k++){
     const {cos:cs,sin:sn}=ring[k],idx=j*(SIDES+1)+k;
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
   const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color:wire.color,roughness:.55}));mesh.name=wire.label;mesh.userData.wireId=wire.id;mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;group.add(mesh);const anchors=[wire.from,...wire.via,wire.to].map(a=>({bodyId:a.bodyId,point:[...a.point] as Vec3})),points=anchors.map(()=>new T.Vector3());cables.push({mesh,anchors,authoredPoints:[],points,curve:new T.CatmullRomCurve3(points,false,'centripetal'),samples:Array.from({length:STEPS+1},()=>new T.Vector3()),dirty:true});
  }update();},update,dispose(){clear();scene.remove(group);}};
}

/** Complete factory-installed electronics. Roles/pins agree with the default
 * generated circuit. Pad locations and cable routes remain illustrative. */
function completeElectronicsWires(doc:CadDocument,result:GeometryResult):RobotWire[]{
 const plan=robotElectricalPlan(doc),roots=new Set(result.bodies.map(b=>b.id)),wires:RobotWire[]=[];
 const bounds=new Map(result.bodies.map(b=>[b.id,b.bounds]));const control=plan.controller,reg=plan.regulator,bus=plan.bus;
 const power=roots.has('electronics-power')?'electronics-power':'battery-envelope';
 const powerNode=doc.nodes[power];if(!powerNode||powerNode.kind!=='box')return [];
 const holder=powerNode.physics?.sourcePreset==='visual-aa-holder-830';
 const positive=anchor(power,holder?[32.3,-25,-2]:[-powerNode.size[0]*.24,-powerNode.size[1]/2-2,powerNode.size[2]*.15]);
 const negative=anchor(power,holder?[32.3,-23,-2]:[powerNode.size[0]*.24,-powerNode.size[1]/2-2,powerNode.size[2]*.15]);
 const regPin=(role:'in+'|'in-'|'out+'|'out-')=>anchor(reg,({'in+':[-3.81,-6.5,.3],'in-':[3.81,-6.5,.3],'out+':[-3.81,6.5,.3],'out-':[3.81,6.5,.3]} as Record<string,Vec3>)[role]);
 const pin=(id:string,row:number,column:number)=>anchor(id,[-8.89+column*2.54,row?6.35:-6.35,1.5]);
 const cpu=(n:number)=>anchor(control,[-15.24+(n%12)*2.54,n<12?7.62:-7.62,-1.35]);
 function link(id:string,label:string,color:string,from:WireAnchor,to:WireAnchor){
  if(![from,to].every(a=>roots.has(a.bodyId)))return;
  const a=localToWorldPoint(from.point,doc.nodes[from.bodyId].transform),b=localToWorldPoint(to.point,doc.nodes[to.bodyId].transform);
  const via=anchor('electronics-mount',worldToLocalPoint([(a[0]+b[0])/2,(a[1]+b[1])/2,Math.max(a[2],b[2])+5+(wires.length%3)*.7],doc.nodes['electronics-mount'].transform));
  const route=doc.id==='robot-mantis-walker'&&a[0]*b[0]<0?[anchor('electronics-mount',worldToLocalPoint([a[0],-42,Math.max(a[2],b[2])+5],doc.nodes['electronics-mount'].transform)),anchor('electronics-mount',worldToLocalPoint([b[0],-42,Math.max(a[2],b[2])+5],doc.nodes['electronics-mount'].transform))]:[via];
  wires.push({id,label,color,from,to,via:route});
 }
 link('power-reg-plus','6 V source → 5 V regulator input','#e94f4f',positive,regPin('in+'));
 link('power-reg-return','Common return → regulator input','#293b4d',negative,regPin('in-'));
 link('logic-5v','Regulated 5 V → METRO Mini 5 V','#e94f4f',regPin('out+'),cpu(19));
 link('logic-ground','Common ground → METRO Mini GND','#293b4d',regPin('out-'),cpu(18));
 for(let i=0;i<plan.drivers;i++){
  const driver='electronics-driver-'+i;
  link('bridge-'+i+'-supply','6 V motor supply → bridge '+(i+1),'#e94f4f',positive,pin(driver,0,0));
  link('bridge-'+i+'-ground','Common ground → bridge '+(i+1),'#293b4d',negative,pin(driver,0,1));
  link('bridge-'+i+'-logic','5 V logic → bridge '+(i+1),'#c96955',regPin('out+'),pin(driver,0,2));
 }
 for(const item of plan.motors){
  const {joint,driver,channel,pins}=item,port=joint.control!.port;
  const controls=channel?[[0,6],[0,7],[1,0]]:[[0,3],[0,4],[0,5]];
  for(let i=0;i<3;i++)link('control-'+port+'-'+i,`D${pins[i]} → ${port} ${['PWM enable','direction 1','direction 2'][i]}`,['#dba840','#55b4d5','#9e79cb'][i],cpu(pins[i]),pin(driver,controls[i][0],controls[i][1]));
  const motor=doc.nodes[joint.bodyA],preset=motor.physics?.sourcePreset;
  for(let i=0;i<2;i++){
   let end:WireAnchor;
   if(doc.nodes['electronics-actuator-'+port])end=anchor('electronics-actuator-'+port,[i?2.5:-2.5,-12,-10.5]);
   else if(preset==='tt-gearmotor')end=anchor(motor.id,[-28.7,8.5,i?6.2:16.2]);
   else if(preset==='dc-toy-motor')end=anchor(motor.id,[-19,i?4:-4,8.5]);
   else {const body=doc.nodes[joint.bodyB],b=bounds.get(body.id)!;end=anchor(body.id,worldToLocalPoint([(b.min[0]+b.max[0])/2+i*1.4,b.min[1]-.6,(b.min[2]+b.max[2])/2],body.transform));}
   link('motor-'+port+'-'+i,`${port} ${joint.kind==='slider'?'ideal linear actuator':'motor'} lead ${i?'−':'+'}`,i?'#293b4d':'#e94f4f',pin(driver,1,(channel?3:1)+i),end);
  }
  if(channel===0&&!plan.motors.some(p=>p.driver===driver&&p.channel===1))for(let i=0;i<3;i++)link('unused-'+driver+'-'+i,'Unused bridge inputs tied to ground','#425568',pin(driver,0,1),pin(driver,...([[0,6],[0,7],[1,0]][i] as [number,number])));
 }
 if(plan.servos.length){
  link('servo-bus-power','Regulated 5 V → servo power bus','#e94f4f',regPin('out+'),anchor(bus,[-10,0,2.4]));
  link('servo-bus-return','Common ground → servo bus','#293b4d',regPin('out-'),anchor(bus,[-10,-2.54,2.4]));
  for(const [i,{joint,pin:signal}]of plan.servos.entries()){
   const port=joint.control!.port,body=joint.bodyA;
   for(let j=0;j<3;j++)link('servo-'+port+'-'+j,`${port} servo ${['ground','regulated 5 V','signal D'+signal][j]}`,['#293b4d','#e94f4f','#e8b84c'][j],j===2?cpu(signal):anchor(bus,[-6.35+i*2.54,j?0:-2.54,2.4]),anchor(body,[(j-1)*.9,-10.5,3]));
  }
 }
 if(roots.has('electronics-encoder'))for(let i=0;i<4;i++)link('encoder-'+i,['Encoder ground','Encoder 5 V','Encoder A → D0','Encoder B → D1'][i],['#293b4d','#e94f4f','#55b4d5','#9e79cb'][i],anchor('electronics-encoder',[-3.81+i*2.54,-3,-8.5]),i===0?regPin('out-'):i===1?regPin('out+'):cpu(i-2));
 return wires;
}
