// SPDX-License-Identifier: BSD-3-Clause
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {createPhysicsShapeCache,createPhysicsWorld,loadPhysicsEngine,prepareDocumentCollisions,preparePhysicsDocument} from '@brickwright/cad-physics';
import {documentGeometryKey,setLocale,t} from '@brickwright/cad-core';
import type {GeometryKernel,GeometryResult} from '@brickwright/cad-geometry';
import type {PreparedCollision} from '@brickwright/cad-physics';
import type {CadDocument} from '@brickwright/cad-core';
import type {SimulationCommand,SimulationFrame,SimulationRay,SimulationTelemetry} from './simulation-protocol.js';
import {createCollisionMeasurement} from './collision-measurement-client.js';
type SceneLayout={joints:NonNullable<CadDocument['joints']>;nodes:ReadonlySet<string>;visibleRoots:string[]};
let kernel:Promise<GeometryKernel>|undefined,world:Awaited<ReturnType<typeof createPhysicsWorld>>|undefined,scene:SceneLayout|undefined;
type PreparedConstruction={key:string;geometry:GeometryResult;collisions:ReadonlyMap<string,PreparedCollision>};
let lastStart:{layout:SceneLayout;construction:PreparedConstruction;shapes:ReturnType<typeof createPhysicsShapeCache>;physics:ReturnType<typeof preparePhysicsDocument>}|undefined;
// Candidate hints and assemblies are outside the visual geometry signature.
function preparationKey(doc:CadDocument,geometryKey:string|undefined){
 return JSON.stringify([geometryKey,Object.values(doc.nodes).map(node=>{
  const p=node.physics;
  return [p?.sourcePreset,p?.collisionHint,p?.collisionAssembly];
 })]);
}
const driven=new Map<string,'hinge'|'slider'>();
const previewBalls=new Map<string,{previewRadiusMm:number;previewShape:'sphere'|'box'}>();
const angles:Record<string,number>={},lastAngles:Record<string,number>={},speeds:Record<string,number>={},linearPositions:Record<string,number>={},linearSpeeds:Record<string,number>={};
const measure=()=>{for(const joint of scene!.joints)if(joint.kind==='hinge'){const current=world!.hingeAngle(joint.id)*180/Math.PI;let delta=current-(lastAngles[joint.id]??current);delta=((delta+180)%360+360)%360-180;angles[joint.id]=(angles[joint.id]??0)+delta;speeds[joint.id]=delta/.005;lastAngles[joint.id]=current;}};
const measureSliders=()=>{for(const joint of scene!.joints)if(joint.kind==='slider'){const current=world!.sliderPosition(joint.id);linearSpeeds[joint.id]=linearPositions[joint.id]===undefined?0:(current-linearPositions[joint.id])/.005;linearPositions[joint.id]=current;}};
let distances:Record<string,number|null>={};
const checkRayBatch=(rays:SimulationRay[])=>{
 const invalid=()=>new Error(t('Invalid body sensor ray'));
 if(!Array.isArray(rays)||rays.length>32)throw invalid();
 const ids=new Set<string>();
 for(const ray of rays){
  if(!ray||typeof ray.id!=='string'||ray.id.length>96||ids.has(ray.id)||!scene!.nodes.has(ray.bodyId)||
   !Array.isArray(ray.originMm)||ray.originMm.length!==3||!Array.isArray(ray.direction)||ray.direction.length!==3)throw invalid();
  ids.add(ray.id);
 }
};
const sense=(rays:SimulationRay[])=>{
 const next:Record<string,number|null>={};
 for(const ray of rays)next[ray.id]=world!.bodyRay(ray.bodyId,ray.originMm,ray.direction,ray.rangeMm);
 distances=next;
};
const telemetry=():SimulationTelemetry=>({time:world!.time,angles:{...angles},speeds:{...speeds},linearPositions:{...linearPositions},linearSpeeds:{...linearSpeeds},distances:{...distances}});
const frame=():SimulationFrame=>({...telemetry(),poses:scene!.visibleRoots.map(id=>({id,...world!.pose(id)})).concat([...previewBalls].map(([id,spec])=>({id,...world!.pose(id),...spec})))});
self.onmessage=async(event:MessageEvent<SimulationCommand&{request:number}>)=>{
 const command=event.data;
 try{
  if(command.op==='park'){
   world?.dispose();world=undefined;scene=undefined;
   self.postMessage({request:command.request,frame:{time:0,poses:[],angles:{},speeds:{},linearPositions:{},linearSpeeds:{}}});
   return;
  }
  if(command.op==='start'){
   world?.dispose();world=undefined;setLocale(command.locale);
   const authored=command.document,previousStart=lastStart;
   if(!authored&&!previousStart)throw new Error(t('Start simulation first'));
   // Start fetching and compiling Jolt while preparing the collision geometry.
   // World construction awaits the same promise and reports engine failures.
   if(authored?.roots.length)void loadPhysicsEngine(true).catch(()=>{});
   let construction=previousStart?.construction;
   // A payload-free start can only refer to the last successful document.
   // Fix base changes motion, which neither construction key includes.
   if(authored){
    const geometryKey=documentGeometryKey(authored),key=preparationKey(authored,geometryKey);
    if(construction?.key!==key){
     const ready=await(kernel??=createGeometryKernel({wasmURL:command.wasmURL}));
     const geometry=command.geometry?.sourceKey===geometryKey?command.geometry:ready.evaluate(authored);
     const background=createCollisionMeasurement(authored,geometry,command.wasmURL,command.locale,ready.collisionCSG.measure);
     try{
      const collisions=await prepareDocumentCollisions(authored,geometry,ready,background);
      construction={key,geometry,collisions};
     }finally{background?.close();}
    }
   }
   const {geometry,collisions}=construction!;
   const physics=authored?preparePhysicsDocument(authored):previousStart!.physics;
   const layout:SceneLayout=authored?{
    joints:authored.joints??[],nodes:new Set(Object.keys(authored.nodes)),
    visibleRoots:authored.roots.filter(id=>!authored.nodes[id].reference&&authored.nodes[id].role!=='hole'),
   }:previousStart!.layout;
   const shapes=authored?createPhysicsShapeCache():previousStart!.shapes;
   const previousShapes=previousStart?.shapes;
   try{
    driven.clear();previewBalls.clear();distances={};
    world=await createPhysicsWorld(physics,geometry,collisions,{mode:command.rigidPreview?'rigid-preview':'mechanism',preferSimd:true,shapeCache:shapes,fixBase:command.fixBase});
    scene=layout;
    for(const map of [angles,lastAngles,speeds,linearPositions,linearSpeeds])for(const key of Object.keys(map))delete map[key];measure();measureSliders();
   }catch(error){if(shapes!==previousShapes)shapes.clear();throw error;}
   if(shapes!==previousShapes)previousShapes?.clear();
   lastStart={layout,construction:construction!,shapes,physics};
  }else{
   if(!world)throw new Error(t('Start simulation first'));
   if(command.op==='step'){if(!Number.isFinite(command.seconds)||command.seconds<=0||command.seconds>.05||Math.abs(command.seconds*200-Math.round(command.seconds*200))>1e-8)throw new Error(t('Invalid simulation step'));for(let i=0;i<Math.round(command.seconds*200);i++){world.step(.005);measure();measureSliders();}}
   else if(command.op==='sense'){checkRayBatch(command.rays);sense(command.rays);}
   else if(command.op==='actuator-step'){
    if(command.rays){
     checkRayBatch(command.rays);
     // Reject malformed input before mutating physics. The only reading sent
     // to the circuit is sampled after the step.
     for(const ray of command.rays)world.validateBodyRay(ray.bodyId,ray.originMm,ray.direction,ray.rangeMm);
    }
    if(!Array.isArray(command.impulses)||command.impulses.length>64||new Set(command.impulses.map(v=>v.id)).size!==command.impulses.length||command.impulses.some(v=>!Number.isFinite(v.impulse)||Math.abs(v.impulse)>1||!scene!.joints.some(j=>j.id===v.id&&['hinge','slider'].includes(j.kind))))throw new Error(t('Invalid actuator impulse'));
    const servos=command.servos??[];
    if(!Array.isArray(servos)||servos.length>64||new Set(servos.map(v=>v.id)).size!==servos.length||servos.some(v=>command.impulses.some(d=>d.id===v.id)||!Number.isFinite(v.angleRad)||Math.abs(v.angleRad)>Math.PI*2||!Number.isFinite(v.torqueNm)||v.torqueNm<=0||v.torqueNm>100||!scene!.joints.some(j=>j.id===v.id&&j.kind==='hinge')))throw new Error(t('Invalid position servo target'));
    for(const servo of servos){if(servo.enabled){world.setHingeServo(servo.id,servo.angleRad,servo.torqueNm);driven.set(servo.id,'hinge');}else{world.coastHingeMotor(servo.id);driven.delete(servo.id);}}
    for(const drive of command.impulses)world.applyJointImpulse(drive.id,drive.impulse);world.step(.005);measure();measureSliders();if(command.rays)sense(command.rays);
   }
   else if(command.op==='motor'){
    if(!Number.isFinite(command.speedDps)||Math.abs(command.speedDps)>720)throw new Error(t('Motor speed must be between -720 and 720 degrees per second'));
    world.setHingeMotor(command.id,command.speedDps*Math.PI/180,command.torqueNm);driven.set(command.id,'hinge');
   }else if(command.op==='stop-motor'){if(command.action==='coast')world.coastHingeMotor(command.id);else world.stopHingeMotor(command.id);if(command.action==='coast')driven.delete(command.id);else driven.set(command.id,'hinge');}
   else if(command.op==='slider'){world.setSliderMotor(command.id,command.speedMmS,command.forceN);driven.set(command.id,'slider');}
   else if(command.op==='stop-slider'){world.stopSliderMotor(command.id,command.action);if(command.action==='coast')driven.delete(command.id);else driven.set(command.id,'slider');}
   else if(command.op==='velocity')world.setLinearVelocity(command.id,command.velocityMmS);
   else if(command.op==='grab')world.grabBody(command.id,command.pointMm,command.targetMm);
   else if(command.op==='release-grab')world.releaseGrab();
   else if(command.op==='ball'){if(command.shape==='box')world.spawnBox(command.id,command.positionMm,command.velocityMmS,command.radiusMm);else world.spawnSphere(command.id,command.positionMm,command.velocityMmS,command.radiusMm);previewBalls.set(command.id,{previewRadiusMm:command.radiusMm,previewShape:command.shape??'sphere'});}
   else if(command.op==='impulse')world.applyImpulse(command.id,command.impulseNs,command.pointMm);
   else if(command.op==='stop-motors')for(const [id,kind]of driven)if(kind==='hinge')world.stopHingeMotor(id);else world.stopSliderMotor(id);
  }
  // Coupled controllers need joint/sensor feedback at 200 Hz, but poses only
  // for the terminal step of a displayed frame. Avoid querying or cloning all
  // body poses for those intermediate samples; physics advances identically.
  self.postMessage({request:command.request,frame:command.op==='actuator-step'&&command.telemetryOnly===true?telemetry():frame()});
 }catch(error){self.postMessage({request:command.request,error:error instanceof Error?error.message:String(error)});}
};
