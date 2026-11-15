// SPDX-License-Identifier: BSD-3-Clause
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {createPhysicsWorld,prepareDocumentCollisions} from '@brickwright/cad-physics';
import {defaultPartPhysics,setLocale,t} from '@brickwright/cad-core';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import type {CadDocument} from '@brickwright/cad-core';
import type {SimulationCommand,SimulationFrame} from './simulation-protocol.js';
let kernel:Promise<GeometryKernel>|undefined,world:Awaited<ReturnType<typeof createPhysicsWorld>>|undefined,document:CadDocument|undefined;
const frame=():SimulationFrame=>({time:world!.time,poses:document!.roots.filter(id=>!document!.nodes[id].reference&&document!.nodes[id].role!=='hole').map(id=>({id,...world!.pose(id)})),angles:Object.fromEntries((document!.joints??[]).filter(j=>j.kind==='hinge').map(j=>[j.id,world!.hingeAngle(j.id)*180/Math.PI]))});
self.onmessage=async(event:MessageEvent<SimulationCommand&{request:number}>)=>{
 const command=event.data;
 try{
  if(command.op==='start'){
   world?.dispose();world=undefined;setLocale(command.locale);
   document=structuredClone(command.document);
   const first=document.roots.find(id=>!document!.nodes[id].reference&&document!.nodes[id].role!=='hole');
   if(command.fixBase&&first)document.nodes[first].physics={...(document.nodes[first].physics??defaultPartPhysics()),motion:'static'};
   const ready=await(kernel??=createGeometryKernel({wasmURL:command.wasmURL}));
   const geometry=ready.evaluate(document),prepared=await prepareDocumentCollisions(document,geometry,ready);
   world=await createPhysicsWorld(document,geometry,prepared);
  }else{
   if(!world)throw new Error(t('Start simulation first'));
   if(command.op==='step')world.step(command.seconds);
   else if(command.op==='motor'){
    if(!Number.isFinite(command.speedDps)||Math.abs(command.speedDps)>720)throw new Error(t('Motor speed must be between -720 and 720 degrees per second'));
    world.setHingeMotor(command.id,command.speedDps*Math.PI/180,command.torqueNm);
   }else if(command.op==='stop-motors')for(const joint of document!.joints??[])if(joint.kind==='hinge')world.stopHingeMotor(joint.id);
  }
  self.postMessage({request:command.request,frame:frame()});
 }catch(error){self.postMessage({request:command.request,error:error instanceof Error?error.message:String(error)});}
};
