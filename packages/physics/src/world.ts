// SPDX-License-Identifier: BSD-3-Clause
import {t,simulationSettings} from '@brickwright/cad-core';
import type initJolt from 'jolt-physics/wasm-compat';
import { validateDocument, defaultPartPhysics, documentGeometryKey } from '@brickwright/cad-core';
import type { CadDocument, CadJoint, Vec3 } from '@brickwright/cad-core';
import type { GeometryResult } from '@brickwright/cad-geometry';
import { solidMassProperties, combineMassProperties } from './mass.js';
import type { MassProperties } from './mass.js';
import { geometryHash, isQualifiedCollision } from './collision.js';
import type { PreparedCollision } from './collision.js';
import {hingeMembersSeparated,hingeFrameSeparationMargin,hingeFrameDriftBound} from './hinge-clearance.js';
let modulePromise:ReturnType<typeof initJolt>|undefined;
let simdPromise:ReturnType<typeof initJolt>|undefined;
const loadScalarJolt=()=>(modulePromise??=import('jolt-physics/wasm-compat').then(module=>module.default()));
/** Resolve the shared engine independently of world and collision construction. */
export function loadPhysicsEngine(preferSimd:boolean){
 if(!preferSimd)return loadScalarJolt();
 if(simdPromise)return simdPromise;
 // Empty function containing i32.const, i8x16.splat and drop.
 const simdProbe=new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,9,1,7,0,65,0,253,15,26,11]);
 return simdPromise=(WebAssembly.validate(simdProbe)
  ?import('jolt-physics/wasm-simd-compat').then(module=>module.default()).catch(loadScalarJolt)
  :loadScalarJolt());
}
type NativeShape=InstanceType<Awaited<ReturnType<typeof initJolt>>['Shape']>;
type NativeBody=InstanceType<Awaited<ReturnType<typeof initJolt>>['Body']>;
type NativeHinge=InstanceType<Awaited<ReturnType<typeof initJolt>>['HingeConstraint']>;
type NativeSlider=InstanceType<Awaited<ReturnType<typeof initJolt>>['SliderConstraint']>;
type MotorBinding={joint:CadJoint}&({kind:'hinge';motor:NativeHinge}|{kind:'slider';motor:NativeSlider});
type RetainedCompound={engine:unknown;tokens:string;inputs:PreparedCollision[];shape:NativeShape};
type PhysicsShapeCache={clear():void};
const retainedCompounds=new WeakMap<PhysicsShapeCache,Map<string,RetainedCompound>>();
declare const physicsDocumentBrand:unique symbol;
type PhysicsDocument={readonly [physicsDocumentBrand]:true};
type SeparatedHingeFrame={bodyA:string;bodyB:string;anchorA:Vec3;anchorB:Vec3;axisA:Vec3;axisB:Vec3;radiusB:number};
type HingeClearance={inputs:[string,PreparedCollision][];frames:ReadonlyMap<string,SeparatedHingeFrame>};
type MassInput={id:string;sourceSHA256:string;positionsLength:number;indicesLength:number;bounds:number[]};
type PreparedMass={
 inputs:MassInput[];
 massById:ReadonlyMap<string,MassProperties>;
 assemblyMass:ReadonlyMap<string,MassProperties>;
};
const physicsDocuments=new WeakMap<object,{
 document:CadDocument;geometryKey:string;hingeClearance?:HingeClearance;mass?:PreparedMass;
}>();
/** Retain a validated, private copy of the authored physics document. */
export function preparePhysicsDocument(input:CadDocument):PhysicsDocument{
 const document=validateDocument(input);
 const prepared=Object.freeze({}) as PhysicsDocument;
 physicsDocuments.set(prepared,{document,geometryKey:documentGeometryKey(document)});
 return prepared;
}
/** Owns one native reference per retained compound for a parked simulation. */
export function createPhysicsShapeCache():PhysicsShapeCache{
 const entries=new Map<string,RetainedCompound>();
 const cache={
  clear(){
   for(const {shape} of entries.values())shape.Release();
   entries.clear();
  },
 };
 retainedCompounds.set(cache,entries);
 return cache;
}
const rotate=(point:number[],rotation:Vec3)=>{let [x,y,z]=point;for(let i=0;i<3;i++){const a=rotation[i]*Math.PI/180,c=Math.cos(a),s=Math.sin(a);if(i===0)[y,z]=[c*y-s*z,s*y+c*z];if(i===1)[x,z]=[c*x+s*z,-s*x+c*z];if(i===2)[x,y]=[c*x-s*y,s*x+c*y];}return [x,y,z];};
/** Evaluated geometry is baked in world-space mm; body poses are deltas to that
 * geometry. SI conversion happens once, at this boundary. Fixed 200 Hz steps. */
export async function createPhysicsWorld(document:CadDocument|PhysicsDocument,result:GeometryResult,prepared:ReadonlyMap<string,PreparedCollision>,options:{J?:any;ground?:boolean;preferSimd?:boolean;mode?:'mechanism'|'rigid-preview';shapeCache?:PhysicsShapeCache;fixBase?:boolean}={}){
 const snapshot=physicsDocuments.get(document);
 const doc=snapshot?.document??validateDocument(document),sceneSettings=simulationSettings(doc);
 if(result.sourceKey!==(snapshot?.geometryKey??documentGeometryKey(doc)))throw new Error(t('Geometry is stale for this document'));
 const meshes=result.bodies.filter(b=>!b.reference&&!b.hole);if(!meshes.length)throw new Error(t('There are no physical solids to simulate'));if(meshes.length>256)throw new Error(t('Simulation budget is 256 bodies'));
 const fixedBase=options.fixBase?doc.roots.find(id=>!doc.nodes[id].reference&&doc.nodes[id].role!=='hole'):undefined;
 const qualifiedSources:string[]=[];
 for(const mesh of meshes){
  const p=prepared.get(mesh.id);
  if(!p||!await isQualifiedCollision(p)||p.certificate.sourceSHA256!==await geometryHash(mesh)
   ||p.certificate.relativeError>p.certificate.tolerance.volumeFraction
   ||p.certificate.boundsErrorMm>p.certificate.tolerance.boundsMm||!p.hulls.length||p.hulls.length>2048){
   throw new Error(t`${mesh.name}: qualified collision geometry is missing or stale`);
  }
  if(snapshot)qualifiedSources.push(p.certificate.sourceSHA256);
 }
 const gearBody=(j:CadJoint,partner:CadJoint)=>{const shared=[partner.bodyA,partner.bodyB];return shared.includes(j.bodyB)&&!shared.includes(j.bodyA)?j.bodyA:j.bodyB;};
 // Gears coupled by a gear mesh are a qualified mechanical model.
 const meshedGears=new Set<string>();for(const joint of doc.joints??[]){const other=joint.gearMesh&&doc.joints!.find(j=>j.id===joint.gearMesh!.joint);if(other){meshedGears.add(gearBody(joint,other));meshedGears.add(gearBody(other,joint));}}
 if(options.mode!=='rigid-preview')for(const mesh of meshes){const intent=doc.nodes[mesh.id]?.physics?.intent??'rigid';if(intent!=='rigid'&&!(intent==='hinge'&&doc.joints?.some(j=>j.bodyA===mesh.id||j.bodyB===mesh.id))&&!(intent==='gear'&&meshedGears.has(mesh.id)))throw new Error(t`${mesh.name}: ${intent} needs a qualified mechanical model and mates. Choose rigid-preview explicitly to simulate only its rigid geometry.`);}
 if([...prepared.values()].reduce((sum,p)=>sum+p.hulls.length,0)>4096)throw new Error(t('Simulation scene exceeds the 4096-convex-piece budget'));
 const J=options.J??await loadPhysicsEngine(options.preferSimd??false);
 const settings=new J.JoltSettings();settings.mMaxBodies=512;settings.mMaxBodyPairs=Math.max(1024,meshes.length*meshes.length);settings.mMaxContactConstraints=8192;
 const pairs=new J.ObjectLayerPairFilterTable(2);pairs.EnableCollision(0,1);pairs.EnableCollision(1,1);
 const broad=new J.BroadPhaseLayerInterfaceTable(2,2);const staticLayer=new J.BroadPhaseLayer(0),dynamicLayer=new J.BroadPhaseLayer(1);broad.MapObjectToBroadPhaseLayer(0,staticLayer);broad.MapObjectToBroadPhaseLayer(1,dynamicLayer);J.destroy(staticLayer);J.destroy(dynamicLayer);
 settings.mObjectLayerPairFilter=pairs;settings.mBroadPhaseLayerInterface=broad;settings.mObjectVsBroadPhaseLayerFilter=new J.ObjectVsBroadPhaseLayerFilterTable(broad,2,pairs,2);
 const world=new J.JoltInterface(settings);J.destroy(settings);const system=world.GetPhysicsSystem(),bodies=system.GetBodyInterface();const gravity=new J.Vec3(...sceneSettings.gravity);system.SetGravity(gravity);J.destroy(gravity);
 const tuning=new J.PhysicsSettings();tuning.mDeterministicSimulation=true;tuning.mUseBodyPairContactCache=false;tuning.mAllowSleeping=false;tuning.mManifoldTolerance=.00001;tuning.mContactPointPreserveLambdaMaxDistSq=.00000001;tuning.mPenetrationSlop=.00002;tuning.mSpeculativeContactDistance=.0001;tuning.mMinVelocityForRestitution=.1;tuning.mNumVelocitySteps=20;tuning.mNumPositionSteps=8;system.SetPhysicsSettings(tuning);J.destroy(tuning);
 const bodyMass=new Map<string,number>();let grab:{id:string;local:number[];target:Vec3}|undefined;
 const quaternionPoint=(p:number[],q:number[])=>{const [x,y,z,w]=q,[a,b,c]=p,u=2*(y*c-z*b),v=2*(z*a-x*c),t=2*(x*b-y*a);return [a+w*u+y*t-z*v,b+w*v+z*u-x*t,c+w*t+x*v-y*u];};
 const ownedBodies:any[]=[],byId=new Map<string,any>(),constraints=new Map<string,any>();let disposed=false,elapsed=0,contactListener:any,partFilter:any;
 const motorBindings=new Map<string,MotorBinding>();
 let rayQuery:ReturnType<typeof createRayQuery>|undefined;
 const sensorPoses=new Map<NativeBody,{revision:number;pose:ReturnType<typeof readPose>}>();
 type SensorRay={bodyId:string;body:NativeBody;originMm:Vec3;direction:Vec3;rangeMm:number;source:number[];axis:number[];projected?:{revision:number;origin:Vec3;to:Vec3}};
 const sensorRays=new Map<string,SensorRay>();
 let poseRevision=0;
 const actuatorFrames=new Map<string,{
  joint:CadJoint;a:any;b:any;axis:number[];anchorM?:number[];motor:any;impulseConfigured:boolean;
 }>();
 let impulseVector:any,impulsePoint:any;
 function actuatorFrame(id:string){
  const known=actuatorFrames.get(id);if(known)return known;
  const binding=motorBindings.get(id);if(!binding)throw new Error(t('Choose a hinge or slider actuator'));
  const {joint,motor}=binding;
  const a=byId.get(joint.bodyA),b=byId.get(joint.bodyB);if(a===b)throw new Error(t('Actuator bodies belong to the same rigid assembly'));
  const authored=doc.nodes[joint.bodyA].transform,axis=rotate(joint.axisA,authored.rotation);
  const anchorM=joint.kind==='slider'?rotate(joint.anchorA.map((v,i)=>v*authored.scale[i]),authored.rotation).map((v,i)=>(v+authored.position[i])*.001):undefined;
  const result={joint,a,b,axis,anchorM,motor,impulseConfigured:false};actuatorFrames.set(id,result);return result;
 }

 const enableVelocityMotor=(id:string,motor:any)=>{
  motor.SetMotorState(J.EMotorState_Velocity);
  const actuator=actuatorFrames.get(id);
  if(actuator)actuator.impulseConfigured=false;
 };

 // Fixed mates describe one rigid body, not a stiff chain of tiny solver
 // bodies. Keep every source ID as an alias of the common world-space pose.
 const fixedParent=new Map(meshes.map(m=>[m.id,m.id]));const fixedRoot=(id:string):string=>{const parent=fixedParent.get(id)!;if(parent===id)return id;const root=fixedRoot(parent);fixedParent.set(id,root);return root;};
 for(const joint of doc.joints??[])if(joint.kind==='fixed')fixedParent.set(fixedRoot(joint.bodyB),fixedRoot(joint.bodyA));
 const assemblies=new Map<string,typeof meshes>();for(const mesh of meshes){const root=fixedRoot(mesh.id);if(!assemblies.has(root))assemblies.set(root,[]);assemblies.get(root)!.push(mesh);}
 const group=new J.GroupFilterTable(Math.max(1,assemblies.size)),bodyIndex=new Map<string,number>(),meshIndex=new Map(meshes.map((m,i)=>[m.id,i]));[...assemblies.values()].forEach((members,index)=>members.forEach(m=>bodyIndex.set(m.id,index)));
 // The document owns the densities and fixed mates. The current source bytes
 // were checked above. Bounds also affect the numerical integration origin.
 const massInputs=snapshot?meshes.map((mesh,i)=>({
  id:mesh.id,sourceSHA256:qualifiedSources[i],
  positionsLength:mesh.positions.length,indicesLength:mesh.indices.length,
  bounds:[...mesh.bounds.min,...mesh.bounds.max],
 })):undefined;
 const priorMass=snapshot?.mass;
 const sameMassInputs=priorMass&&massInputs&&priorMass.inputs.length===massInputs.length
  &&massInputs.every(({id,sourceSHA256,positionsLength,indicesLength,bounds},i)=>{
   const prior=priorMass.inputs[i];
   return prior.id===id&&prior.sourceSHA256===sourceSHA256
    &&prior.positionsLength===positionsLength&&prior.indicesLength===indicesLength
    &&prior.bounds.length===bounds.length&&bounds.every((value,axis)=>Object.is(value,prior.bounds[axis]));
  });
 const massById=sameMassInputs?priorMass.massById:new Map(meshes.map(mesh=>[
  mesh.id,solidMassProperties(mesh,(doc.nodes[mesh.id].physics??defaultPartPhysics()).densityKgM3),
 ]));
 const assemblyMass=sameMassInputs?priorMass.assemblyMass:new Map([...assemblies].map(([id,members])=>[
  id,combineMassProperties(members.map(mesh=>massById.get(mesh.id)!)),
 ]));
 if(snapshot&&massInputs&&!sameMassInputs)snapshot.mass={inputs:massInputs,massById,assemblyMass};
 const pairKey=(a:string,b:string)=>a<b?a+'\0'+b:b+'\0'+a;
 // A gear mesh constraint replaces tooth contact between the two gears.
 for(const joint of doc.joints??[]){const other=joint.gearMesh&&doc.joints!.find(j=>j.id===joint.gearMesh!.joint);if(other)group.DisableCollision(bodyIndex.get(gearBody(joint,other))!,bodyIndex.get(gearBody(other,joint))!);}
 for(const joint of doc.joints??[])if(joint.collideConnected===false||assemblies.get(fixedRoot(joint.bodyA))!.length===1&&assemblies.get(fixedRoot(joint.bodyB))!.length===1)group.DisableCollision(bodyIndex.get(joint.bodyA)!,bodyIndex.get(joint.bodyB)!);
 // Authored robot mode: connector limits control internal travel. Loose objects
 // and ground remain independent collision participants.
 if(sceneSettings.selfCollisions===false){const parent=new Map(meshes.map(mesh=>[mesh.id,mesh.id]));const root=(id:string):string=>{const p=parent.get(id)!;if(p===id)return id;const r=root(p);parent.set(id,r);return r;};for(const joint of doc.joints??[])parent.set(root(joint.bodyB),root(joint.bodyA));const links=[...assemblies.keys()];for(let i=0;i<links.length;i++)for(let j=i+1;j<links.length;j++)if(root(links[i])===root(links[j]))group.DisableCollision(bodyIndex.get(links[i])!,bodyIndex.get(links[j])!);}
 // Serial position axes can have very different inertias. Give
 // their joint rows enough iterations to converge instead of injecting a
 // new velocity correction into an under-solved chain on every 5 ms tick.
 // Independent motors and contact iterations keep their existing settings.
 const servoParents=new Map([...assemblies.keys()].map(id=>[id,id]));
 const servoRoot=(id:string):string=>{const p=servoParents.get(id)!;if(p===id)return id;const r=servoRoot(p);servoParents.set(id,r);return r;};
 const servoComponent=(id:string)=>servoRoot(fixedRoot(id));
 for(const joint of doc.joints??[])servoParents.set(servoComponent(joint.bodyB),servoComponent(joint.bodyA));
 const positionAxes=(doc.joints??[]).filter(j=>j.kind==='hinge'&&j.limits);
 const serialComponents=new Set(positionAxes.filter(a=>positionAxes.some(b=>a.id!==b.id&&fixedRoot(a.bodyB)===fixedRoot(b.bodyA))).map(j=>servoComponent(j.bodyA)));
 const tunedComponents=new Set<string>();
 const tuneSerialServo=(bodyId:string)=>{const component=servoComponent(bodyId);if(!serialComponents.has(component)||tunedComponents.has(component))return;tunedComponents.add(component);
  const axes=positionAxes.filter(j=>servoComponent(j.bodyA)===component).length,iterations=Math.min(320,80*axes);
  for(const joint of doc.joints??[])if(servoComponent(joint.bodyA)===component){
   constraints.get(joint.id)?.SetNumVelocityStepsOverride(iterations);
   // Serial tuning can override a neighbor that was already driven by impulses.
   const actuator=actuatorFrames.get(joint.id);
   if(actuator)actuator.impulseConfigured=false;
  }
 };
 function computeHingeClearance(){
  const originalExcluded=new Set((doc.joints??[]).map(j=>pairKey(j.bodyA,j.bodyB)));
  const frames=new Map<string,SeparatedHingeFrame>();
  const members=(root:string)=>assemblies.get(root)!.map(mesh=>({id:mesh.id,hulls:prepared.get(mesh.id)!.hulls}));
  for(const joint of doc.joints??[]){
   if(joint.kind!=='hinge'||joint.collideConnected===false)continue;
   const a=fixedRoot(joint.bodyA),b=fixedRoot(joint.bodyB),key=pairKey(a,b);
   if(a===b||frames.has(key))continue;
   const left=members(a),right=members(b);
   if(left.length===1&&right.length===1)continue;
   const tr=doc.nodes[joint.bodyA].transform,tb=doc.nodes[joint.bodyB].transform;
   const anchor=rotate(joint.anchorA.map((v,i)=>v*tr.scale[i]),tr.rotation).map((v,i)=>v+tr.position[i]) as Vec3;
   const axis=rotate(joint.axisA,tr.rotation) as Vec3;
   const otherAnchor=rotate(joint.anchorB.map((v,i)=>v*tb.scale[i]),tb.rotation).map((v,i)=>v+tb.position[i]) as Vec3;
   const otherAxis=rotate(joint.axisB,tb.rotation) as Vec3;
   // Even a small axis skew can move distant features beyond their clearance.
   const margin=hingeFrameSeparationMargin([...left,...right].flatMap(m=>m.hulls),anchor,axis,otherAnchor,otherAxis);
   if(margin===undefined||!hingeMembersSeparated(left,right,anchor,axis,(x,y)=>originalExcluded.has(pairKey(x,y)),margin))continue;
   let radiusB=0;
   for(const member of right)for(const hull of member.hulls)for(let i=0;i<hull.positions.length;i+=3){
    radiusB=Math.max(radiusB,Math.hypot(otherAnchor[0]-hull.positions[i],otherAnchor[1]-hull.positions[i+1],otherAnchor[2]-hull.positions[i+2]));
   }
   frames.set(key,{bodyA:a,bodyB:b,anchorA:anchor,anchorB:otherAnchor,axisA:axis,axisB:otherAxis,radiusB});
  }
  return frames;
 }
 // The validated document is private. Reuse its authored clearance only
 // with the same qualified hulls, after the fresh hash checks above.
 const priorClearance=snapshot?.hingeClearance;
 const reuseClearance=priorClearance&&priorClearance.inputs.length===meshes.length
  &&meshes.every((mesh,i)=>priorClearance.inputs[i][0]===mesh.id&&priorClearance.inputs[i][1]===prepared.get(mesh.id));
 const separatedFrames=reuseClearance?priorClearance.frames:computeHingeClearance();
 if(snapshot&&!reuseClearance)snapshot.hingeClearance={inputs:meshes.map(mesh=>[mesh.id,prepared.get(mesh.id)!]),frames:separatedFrames};
 const separatedHingePairs=new Set(separatedFrames.keys());
 for(const frame of separatedFrames.values())group.DisableCollision(bodyIndex.get(frame.bodyA)!,bodyIndex.get(frame.bodyB)!);
 const restoreSeparatedPair=(key:string)=>{if(!separatedHingePairs.delete(key))return;const frame=separatedFrames.get(key)!;if(sceneSettings.selfCollisions!==false)group.EnableCollision(bodyIndex.get(frame.bodyA)!,bodyIndex.get(frame.bodyB)!);};
 const invalidateSeparatedPairs=(id:string)=>{const body=byId.get(id);for(const[key,frame]of separatedFrames)if(byId.get(frame.bodyA)===body||byId.get(frame.bodyB)===body)restoreSeparatedPair(key);};
 type HingePose={position:Vec3;rotation:number[];sample:number};
 const hingePoses=new Map<string,HingePose>();
 for(const {bodyA,bodyB} of separatedFrames.values()){
  for(const id of [bodyA,bodyB]){
   if(!hingePoses.has(id))hingePoses.set(id,{position:[0,0,0],rotation:[0,0,0,1],sample:0});
  }
 }
 let hingeSample=0;
 const currentHingeFrame=(id:string,anchor:Vec3,axis:Vec3)=>{
  const pose=hingePoses.get(id)!;
  if(pose.sample!==hingeSample){
   const body=byId.get(id),position=body.GetPosition(),rotation=body.GetRotation();
   pose.position[0]=position.GetX();
   pose.position[1]=position.GetY();
   pose.position[2]=position.GetZ();
   pose.rotation[0]=rotation.GetX();
   pose.rotation[1]=rotation.GetY();
   pose.rotation[2]=rotation.GetZ();
   pose.rotation[3]=rotation.GetW();
   pose.sample=hingeSample;
  }
  const point=quaternionPoint(anchor,pose.rotation);
  return {
   anchor:[
    point[0]+1000*pose.position[0],
    point[1]+1000*pose.position[1],
    point[2]+1000*pose.position[2],
   ] as Vec3,
   axis:quaternionPoint(axis,pose.rotation) as Vec3,
  };
 };
 const checkSeparatedFrames=()=>{
  if(!separatedHingePairs.size)return;
  // Several hinges can share a body. Sample each pose once per boundary.
  hingeSample++;
  for(const key of separatedHingePairs){
   const frame=separatedFrames.get(key)!;
   const a=currentHingeFrame(frame.bodyA,frame.anchorA,frame.axisA);
   const b=currentHingeFrame(frame.bodyB,frame.anchorB,frame.axisB);
   // This is sampled drift protection, not an arbitrary-force CCD guarantee.
   // External impulse/velocity/drag APIs invalidate before mutating the body.
   if(hingeFrameDriftBound(a.anchor,a.axis,b.anchor,b.axis,frame.radiusB)>=.249)restoreSeparatedPair(key);
  }
 };
 const usePartMaterials=assemblies.size<meshes.length;
 const materialByToken=usePartMaterials?meshes.map(mesh=>doc.nodes[mesh.id].physics??defaultPartPhysics()):[];
 // A body keeps its shape and material for the lifetime of this world.
 // Cache the native float defaults and keep the authored leaf values for mixing.
 const contactBodies=new Map<number,{compound?:any;friction:number;restitution:number}>();
 const add=(shape:any,id:string,motion:'dynamic'|'static',properties:any,mass?:ReturnType<typeof solidMassProperties>)=>{
  const pos=new J.RVec3(0,0,0),q=new J.Quat(0,0,0,1);const bc=new J.BodyCreationSettings(shape,pos,q,motion==='static'?J.EMotionType_Static:J.EMotionType_Dynamic,motion==='static'?0:1);J.destroy(pos);J.destroy(q);
  bc.mFriction=properties.friction;bc.mRestitution=properties.restitution;bc.mLinearDamping=0;bc.mAngularDamping=0;
  if(bodyIndex.has(id)){const cg=new J.CollisionGroup(group,0,bodyIndex.get(id));bc.mCollisionGroup=cg;J.destroy(cg);}
  if(mass&&motion==='dynamic'){
   bc.mMotionQuality=J.EMotionQuality_LinearCast;bc.mOverrideMassProperties=J.EOverrideMassProperties_MassAndInertiaProvided;
   const mp=new J.MassProperties();mp.mMass=mass.massKg;const matrix=new J.Mat44();for(let col=0;col<3;col++){const v=new J.Vec3(mass.inertiaKgM2[0][col],mass.inertiaKgM2[1][col],mass.inertiaKgM2[2][col]);matrix.SetColumn3(col,v);J.destroy(v);}const end=new J.Vec4(0,0,0,1);matrix.SetColumn4(3,end);J.destroy(end);mp.mInertia=matrix;bc.mMassPropertiesOverride=mp;J.destroy(matrix);J.destroy(mp);
  }
  try{const body=bodies.CreateBody(bc);if(!body)throw new Error(t('Jolt body allocation failed'));bodies.AddBody(body.GetID(),motion==='static'?J.EActivation_DontActivate:J.EActivation_Activate);ownedBodies.push(body);byId.set(id,body);if(mass)bodyMass.set(id,mass.massKg);
   if(usePartMaterials)contactBodies.set(J.getPointer(body),{
    compound:meshIndex.has(id)?body.GetShape():undefined,
    friction:body.GetFriction(),restitution:body.GetRestitution(),
   });
  }finally{J.destroy(bc);}
 };
 function dispose(){if(disposed)return;disposed=true;rayQuery?.dispose();rayQuery=undefined;sensorPoses.clear();sensorRays.clear();motorBindings.clear();for(const c of constraints.values()){system.RemoveConstraint(c);c.Release();}for(const body of ownedBodies){bodies.RemoveBody(body.GetID());bodies.DestroyBody(body.GetID());}J.destroy(world);if(impulseVector)J.destroy(impulseVector);if(impulsePoint)J.destroy(impulsePoint);if(contactListener)J.destroy(contactListener);if(partFilter)J.destroy(partFilter);}
 let scratchVertex:any,scratchPosition:any,scratchRotation:any;
 function createCompound(members:typeof meshes):NativeShape{
  const compound=new J.StaticCompoundShapeSettings();
  try{
   for(const mesh of members)for(const hull of prepared.get(mesh.id)!.hulls){
    const positions=hull.positions;
    if(positions.length<12||positions.length>192)throw new Error(t('Collision hull violates the solver budget'));
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let k=0;k<positions.length;k++){
     const value=positions[k],axis=k%3;
     if(!Number.isFinite(value))throw new Error(t('Collision hull violates the solver budget'));
     min[axis]=Math.min(min[axis],value);
     max[axis]=Math.max(max[axis],value);
    }
    const center=min.map((v,k)=>(v+max[k])/2),spans=max.map((v,k)=>v-min[k]),extent=Math.max(...spans);
    if(spans.some(v=>v<=0))throw new Error(t('Collision hull has no finite extent'));
    // Jolt copies these coordinates into its arrays and compound settings.
    // Reuse one set of native temporaries for all the hulls in this world.
    scratchVertex??=new J.Vec3(0,0,0);
    scratchPosition??=new J.Vec3(0,0,0);
    scratchRotation??=new J.Quat(0,0,0,1);
    // Condition each axis to [-.5,.5] to preserve shared axis-aligned bounds.
    const leaf=new J.ConvexHullShapeSettings();
    const token=meshIndex.get(mesh.id)!+1;
    leaf.mUserData=token;
    leaf.mMaxConvexRadius=Math.min(.02,.1*Math.min(...spans))/extent;
    leaf.mHullTolerance=Math.min(.005,prepared.get(mesh.id)!.certificate.tolerance.boundsMm/extent/4);
    const points=leaf.mPoints;
    for(let k=0;k<positions.length;k+=3){
     scratchVertex.Set((positions[k]-center[0])/spans[0],(positions[k+1]-center[1])/spans[1],(positions[k+2]-center[2])/spans[2]);
     points.push_back(scratchVertex);
    }
    scratchVertex.Set(spans[0]*.001,spans[1]*.001,spans[2]*.001);
    const scaled=new J.ScaledShapeSettings(leaf,scratchVertex);
    scratchPosition.Set(center[0]*.001,center[1]*.001,center[2]*.001);
    compound.AddShape(scratchPosition,scratchRotation,scaled,token);
   }
   const created=compound.Create();
   try{
    if(created.HasError())throw new Error(created.GetError().c_str());
    const shape=created.Get() as NativeShape;
    shape.AddRef();
    return shape;
   }finally{created.Clear();}
  }finally{J.destroy(compound);}
 }
 const cache=options.shapeCache&&retainedCompounds.get(options.shapeCache);
 try {
  if(options.ground??sceneSettings.ground){const ext=new J.Vec3(2,2,.005),shape=new J.BoxShape(ext,.0001);J.destroy(ext);add(shape,'ground','static',{friction:sceneSettings.groundFriction,restitution:sceneSettings.groundRestitution});const p=new J.RVec3(0,0,-.005);bodies.SetPosition(byId.get('ground').GetID(),p,J.EActivation_DontActivate);J.destroy(p);}
  for(const [id,members]of assemblies){
   const properties=doc.nodes[members[0].id].physics??defaultPartPhysics(),motion=members.some(m=>m.id===fixedBase||doc.nodes[m.id].physics?.motion==='static')?'static':'dynamic',mass=assemblyMass.get(id)!;
   const tokens=members.map(mesh=>meshIndex.get(mesh.id)!+1).join(',');
   const inputs=members.map(mesh=>prepared.get(mesh.id)!);
   const prior=cache?.get(id);
   const matches=prior&&prior.engine===J&&prior.tokens===tokens&&prior.inputs.length===inputs.length
    &&prior.inputs.every((input,i)=>input===inputs[i]);
   const shape=matches?prior.shape:createCompound(members);
   if(cache&&!matches){
    prior?.shape.Release();
    cache.set(id,{engine:J,tokens,inputs,shape});
   }
   try{
    const center=shape.GetCenterOfMass(),shift=new J.Vec3(mass.centerM[0]-center.GetX(),mass.centerM[1]-center.GetY(),mass.centerM[2]-center.GetZ());
    const corrected=new J.OffsetCenterOfMassShape(shape,shift);
    J.destroy(shift);
    add(corrected,id,motion,properties,mass);
   }finally{if(!cache)shape.Release();}
   const body=byId.get(id);
   if(new Set(members.map(m=>{const p=doc.nodes[m.id].physics??defaultPartPhysics();return p.friction+':'+p.restitution;})).size>1)body.SetUseManifoldReduction(false);
   for(const mesh of members){byId.set(mesh.id,body);bodyMass.set(mesh.id,mass.massKg);}
  }
  if(usePartMaterials){
   // Filter original mate pairs before narrow-phase and CCD work. A late
   // contact rejection still performs expensive shaft/bore collision queries.
   partFilter=new J.PartPairSimShapeFilter();for(const mesh of meshes){const token=meshIndex.get(mesh.id)!+1;partFilter.SetColliderPart(byId.get(mesh.id).GetID(),token,token);}const paired=new Set<string>();
   for(const joint of doc.joints??[]){const a=fixedRoot(joint.bodyA),b=fixedRoot(joint.bodyB);if(a===b)continue;const key=pairKey(a,b),bodyA=byId.get(a).GetID(),bodyB=byId.get(b).GetID();if(!paired.has(key)){partFilter.AddBodyPair(bodyA,bodyB,false);paired.add(key);}partFilter.AddPartPair(bodyA,bodyB,meshIndex.get(joint.bodyA)!+1,meshIndex.get(joint.bodyB)!+1);}system.SetSimShapeFilter(partFilter);
   contactListener=new J.ContactListenerJS();
   contactListener.OnContactValidate=()=>J.ValidateResult_AcceptAllContactsForThisBodyPair;
   const material=(pointer:number,subShape:any)=>{
    const body=contactBodies.get(pointer)!;
    if(!body.compound)return body;
    const token=body.compound.GetSubShapeUserData(subShape);
    return materialByToken[token-1]??body;
   };
   const contact=(a:number,b:number,manifold:number,settings:number)=>{
    const m=J.wrapPointer(manifold,J.ContactManifold);
    const p=material(a,m.mSubShapeID1),q=material(b,m.mSubShapeID2);
    const s=J.wrapPointer(settings,J.ContactSettings);
    s.mCombinedFriction=Math.sqrt(p.friction*q.friction);
    s.mCombinedRestitution=Math.max(p.restitution,q.restitution);
   };
   contactListener.OnContactAdded=contact;contactListener.OnContactPersisted=contact;contactListener.OnContactRemoved=()=>{};system.SetContactListener(contactListener);
  }
  for(const joint of doc.joints??[]){
   const a=byId.get(joint.bodyA),b=byId.get(joint.bodyB);if(!a||!b)throw new Error(t('Joint references a missing body'));
   const frame=(id:string,anchor:Vec3,axis:Vec3)=>{const t=doc.nodes[id].transform;const p=rotate(anchor.map((v,i)=>v*t.scale[i]),t.rotation).map((v,i)=>(v+t.position[i])*.001);const z=rotate(axis,t.rotation),seed=Math.abs(z[0])<.9?[1,0,0]:[0,1,0],dot=z.reduce((s,v,i)=>s+v*seed[i],0),n=seed.map((v,i)=>v-dot*z[i]),len=Math.hypot(...n);return {p,z,n:n.map(v=>v/len)};};
   const fa=frame(joint.bodyA,joint.anchorA,joint.axisA),fb=frame(joint.bodyB,joint.anchorB,joint.axisB);if(Math.hypot(...fa.p.map((v,i)=>v-fb.p[i]))>.0001||Math.abs(fa.z.reduce((s,v,i)=>s+v*fb.z[i],0)-1)>.0001)throw new Error(t('Joint frames are misaligned after editing. Repair the assembly before simulating.'));
   if(joint.kind==='fixed')continue;
   if(a===b)throw new Error(t('A moving joint cannot connect parts in the same rigid assembly'));
   const cs=joint.kind==='hinge'?new J.HingeConstraintSettings():joint.kind==='slider'?new J.SliderConstraintSettings():joint.kind==='pivot'?new J.SwingTwistConstraintSettings():new J.FixedConstraintSettings();cs.mSpace=J.EConstraintSpace_WorldSpace;const temporaries:any[]=[];const point=(p:number[])=>{const v=new J.RVec3(...p);temporaries.push(v);return v;};const vector=(p:number[])=>{const v=new J.Vec3(...p);temporaries.push(v);return v;};if(joint.kind==='pivot'){cs.mPosition1=point(fa.p);cs.mPosition2=point(fb.p);}else{cs.mPoint1=point(fa.p);cs.mPoint2=point(fb.p);}
   if(joint.kind==='hinge'){cs.mHingeAxis1=vector(fa.z);cs.mHingeAxis2=vector(fb.z);cs.mNormalAxis1=vector(fa.n);cs.mNormalAxis2=vector(fb.n);if(joint.limits){cs.mLimitsMin=joint.limits[0];cs.mLimitsMax=joint.limits[1];}}else if(joint.kind==='slider'){cs.mAutoDetectPoint=false;cs.mSliderAxis1=vector(fa.z);cs.mSliderAxis2=vector(fb.z);cs.mNormalAxis1=vector(fa.n);cs.mNormalAxis2=vector(fb.n);if(joint.limits){cs.mLimitsMin=joint.limits[0]*.001;cs.mLimitsMax=joint.limits[1]*.001;}}
   else if(joint.kind==='pivot'){cs.mTwistAxis1=vector(fa.z);cs.mTwistAxis2=vector(fb.z);cs.mPlaneAxis1=vector(fa.n);cs.mPlaneAxis2=vector(fb.n);cs.mSwingType=J.ESwingType_Cone;cs.mNormalHalfConeAngle=joint.coneAngle??Math.PI;cs.mPlaneHalfConeAngle=joint.coneAngle??Math.PI;cs.mTwistMinAngle=-Math.PI;cs.mTwistMaxAngle=Math.PI;}
   else{cs.mAutoDetectPoint=false;cs.mAxisX1=vector(fa.z);cs.mAxisX2=vector(fb.z);cs.mAxisY1=vector(fa.n);cs.mAxisY2=vector(fb.n);}
   // Proven separated pairs reserve 0.25 mm for positional constraint drift.
   // Extra iterations improve loaded-hinge accuracy within that reserve.
   if(joint.kind==='hinge'&&separatedHingePairs.has(pairKey(fixedRoot(joint.bodyA),fixedRoot(joint.bodyB))))cs.mNumPositionStepsOverride=40;
   const constraint=cs.Create(a,b);constraint.AddRef();system.AddConstraint(constraint);constraints.set(joint.id,constraint);temporaries.forEach(v=>J.destroy(v));J.destroy(cs);
   if(joint.kind==='hinge')motorBindings.set(joint.id,{kind:'hinge',joint,motor:J.castObject(constraint,J.HingeConstraint)});
   else if(joint.kind==='slider')motorBindings.set(joint.id,{kind:'slider',joint,motor:J.castObject(constraint,J.SliderConstraint)});
  }
  // Ideal tooth contact at the pitch point between two hinged gears (fork's
  // GearMeshConstraint): the reaction loads both axles, and the ratio holds
  // relative to each hinge frame. The gear is the hinge body not shared with
  // the partner hinge (bodyB when both or neither are shared).
  for(const joint of doc.joints??[]){
   if(joint.kind!=='hinge'||!joint.gearMesh)continue;const other=doc.joints!.find(j=>j.id===joint.gearMesh!.joint);if(other?.kind!=='hinge')throw new Error(t('Invalid gear mesh'));
   const side=(j:CadJoint,partner:CadJoint)=>{const id=gearBody(j,partner),gearIsA=id===j.bodyA&&id!==j.bodyB,tr=doc.nodes[id].transform,anchor=gearIsA?j.anchorA:j.anchorB,axis=gearIsA?j.axisA:j.axisB;
    return {body:byId.get(fixedRoot(id)),point:rotate(anchor.map((v,i)=>v*tr.scale[i]),tr.rotation).map((v,i)=>(v+tr.position[i])*.001),axis:rotate(axis,tr.rotation).map(v=>gearIsA?-v:v)};};
   const g1=side(joint,other),g2=side(other,joint);if(g1.body===g2.body)throw new Error(t('Meshing gears must be separate moving bodies'));
   const ms=new J.GearMeshConstraintSettings(),p1=new J.RVec3(...g1.point),a1=new J.Vec3(...g1.axis),p2=new J.RVec3(...g2.point),a2=new J.Vec3(...g2.axis);
   ms.mSpace=J.EConstraintSpace_WorldSpace;ms.mPoint1=p1;ms.mHingeAxis1=a1;ms.mPoint2=p2;ms.mHingeAxis2=a2;ms.mRatio=joint.gearMesh.ratio;ms.mNumVelocityStepsOverride=30;ms.mNumPositionStepsOverride=10;
   const mesh=J.castObject(ms.Create(g1.body,g2.body),J.GearMeshConstraint);[p1,a1,p2,a2].forEach(v=>J.destroy(v));J.destroy(ms);mesh.AddRef();system.AddConstraint(mesh);mesh.SetConstraints(constraints.get(joint.id),constraints.get(other.id));constraints.set(`gear-mesh:${joint.id}`,mesh);
  }
  // Project authored per-part velocities onto the rigid component, preserving
  // linear and angular momentum instead of letting the last alias win.
  for(const [id,members]of assemblies){const body=byId.get(id);if(body.IsStatic())continue;if(members.some(m=>[...(doc.nodes[m.id].physics?.initialVelocityMmS??[]),...(doc.nodes[m.id].physics?.initialAngularVelocityDps??[])].some(v=>v!==0)))invalidateSeparatedPairs(id);const mass=assemblyMass.get(id)!,momentum=[0,0,0],angular=[0,0,0];
   for(const mesh of members){const p=doc.nodes[mesh.id].physics,part=massById.get(mesh.id)!,v=(p?.initialVelocityMmS??[0,0,0]).map(x=>x*.001),w=(p?.initialAngularVelocityDps??[0,0,0]).map(x=>x*Math.PI/180),r=part.centerM.map((x,i)=>x-mass.centerM[i]),linear=v.map(x=>x*part.massKg);for(let i=0;i<3;i++){momentum[i]+=linear[i];angular[i]+=part.inertiaKgM2[i].reduce((sum,value,j)=>sum+value*w[j],0)+r[(i+1)%3]*linear[(i+2)%3]-r[(i+2)%3]*linear[(i+1)%3];}}
   const [[a,b,c],[d,e,f],[g,h,i]]=mass.inertiaKgM2,det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g),inverse=[[e*i-f*h,c*h-b*i,b*f-c*e],[f*g-d*i,a*i-c*g,c*d-a*f],[d*h-e*g,b*g-a*h,a*e-b*d]],linear=new J.Vec3(...momentum.map(v=>v/mass.massKg)),angularVelocity=new J.Vec3(...inverse.map(row=>row.reduce((sum,v,j)=>sum+v*angular[j],0)/det));bodies.SetLinearVelocity(body.GetID(),linear);bodies.SetAngularVelocity(body.GetID(),angularVelocity);J.destroy(linear);J.destroy(angularVelocity);
  }
  system.OptimizeBroadPhase();
 }catch(e){dispose();throw e;}
 finally{
  if(scratchVertex)J.destroy(scratchVertex);
  if(scratchPosition)J.destroy(scratchPosition);
  if(scratchRotation)J.destroy(scratchRotation);
 }
 const sourceCenterM=(id:string)=>{const body=byId.get(id),part=massById.get(id);if(!part){const p=body.GetCenterOfMassPosition();return [p.GetX(),p.GetY(),p.GetZ()];}const p=body.GetPosition(),q=body.GetRotation();return quaternionPoint(part.centerM,[q.GetX(),q.GetY(),q.GetZ(),q.GetW()]).map((v,i)=>v+[p.GetX(),p.GetY(),p.GetZ()][i]);};
 let previewCount=0;
 function spawnPreview(id:string,positionMm:Vec3,velocityMmS:Vec3,sizeMm:number,kind:'sphere'|'box'){
  if(disposed||byId.has(id)||!/^preview-[a-zA-Z0-9_-]+$/.test(id)||previewCount>=32||!Number.isFinite(sizeMm)||sizeMm<1||sizeMm>50||[...positionMm,...velocityMmS].length!==6||positionMm.some(v=>!Number.isFinite(v)||Math.abs(v)>10000)||velocityMmS.some(v=>!Number.isFinite(v)||Math.abs(v)>10000))throw new Error(t('Invalid preview ball or preview budget exceeded'));
  const radius=sizeMm*.001,volumeM3=kind==='sphere'?4*Math.PI*radius**3/3:(2*radius)**3,massKg=volumeM3*1050,inertia=kind==='sphere'?.4*massKg*radius**2:massKg*(2*radius)**2/6;
  const extent=kind==='box'?new J.Vec3(radius,radius,radius):undefined,shape=extent?new J.BoxShape(extent,Math.min(.0001,radius/10)):new J.SphereShape(radius);if(extent)J.destroy(extent);
  add(shape,id,'dynamic',{friction:.4,restitution:.45},{massKg,volumeM3,centerM:[0,0,0],inertiaKgM2:[[inertia,0,0],[0,inertia,0],[0,0,inertia]]});previewCount++;
  const body=byId.get(id),p=new J.RVec3(...positionMm.map(v=>v*.001)),v=new J.Vec3(...velocityMmS.map(v=>v*.001));bodies.SetPosition(body.GetID(),p,J.EActivation_Activate);bodies.SetLinearVelocity(body.GetID(),v);J.destroy(p);J.destroy(v);
 }
 function createRayQuery(){
   const owned:object[]=[];
   const keep=<T extends object>(value:T)=>{owned.push(value);return value;};
   const dispose=()=>{for(let i=owned.length-1;i>=0;i--)J.destroy(owned[i]);};
   try{
    const ray=keep(new J.RRayCast()),origin=ray.mOrigin,direction=ray.mDirection;
    const settings=keep(new J.RayCastSettings()),collector=keep(new J.CastRayClosestHitCollisionCollector());
    const permissive=keep(new J.ObjectVsBroadPhaseLayerFilterJS());permissive.ShouldCollide=()=>true;
    const broadFilter=keep(new J.DefaultBroadPhaseLayerFilter(permissive,0));
    const objectFilter=keep(new J.ObjectLayerFilterJS());objectFilter.ShouldCollide=()=>true;
    const bodyFilter=keep(new J.BodyFilter()),ignoredBodies=keep(new J.IgnoreMultipleBodiesFilter());
    const shapeFilter=keep(new J.ShapeFilter()),query=system.GetNarrowPhaseQuery();
    let lastIgnored:NativeBody|undefined;
    return {collector,dispose,cast(from:Vec3,to:Vec3,ignored?:NativeBody){
     origin.Set(from[0]*.001,from[1]*.001,from[2]*.001);
     direction.Set((to[0]-from[0])*.001,(to[1]-from[1])*.001,(to[2]-from[2])*.001);
     if(ignored&&ignored!==lastIgnored){
      ignoredBodies.Clear();ignoredBodies.IgnoreBody(ignored.GetID());lastIgnored=ignored;
     }
     collector.Reset();
     query.CastRay(ray,settings,collector,broadFilter,objectFilter,ignored?ignoredBodies:bodyFilter,shapeFilter);
    }};
   }catch(error){dispose();throw error;}
 }

 function castRay(fromMm:Vec3,toMm:Vec3,ignoreBodyId?:string,includeBody=true){
   if(disposed||![...fromMm,...toMm].every(Number.isFinite))throw new Error(t('Invalid physics state or ray'));
   // Queries are synchronous. Reset the collector and reuse its native storage.
   const query=rayQuery??=createRayQuery();
   query.cast(fromMm,toMm,ignoreBodyId===undefined?undefined:byId.get(ignoreBodyId));
   if(!query.collector.HadHit())return null;
   const hit=query.collector.mHit,fraction=hit.mFraction;
   if(!includeBody)return {bodyId:undefined,fraction};
   const index=hit.mBodyID.GetIndexAndSequenceNumber(),entry=[...byId].find(([,body])=>body.GetID().GetIndexAndSequenceNumber()===index),member=entry?meshes[entry[1].GetShape().GetSubShapeUserData(hit.mSubShapeID2)-1]:undefined;
   return {bodyId:member?.id??entry?.[0],fraction};
 }

 function sameRayVector(a:Vec3,b:Vec3){
   return a.length===b.length&&Object.is(a[0],b[0])&&Object.is(a[1],b[1])&&Object.is(a[2],b[2]);
 }

 function prepareSensorRay(id:string,originMm:Vec3,direction:Vec3,rangeMm:number,sensorId?:string):SensorRay{
   const node=doc.nodes[id],body=byId.get(id);
   if(disposed||!node||!body)throw new Error(t('Invalid body sensor ray'));
   const previous=sensorId===undefined?undefined:sensorRays.get(sensorId);
   if(previous&&previous.bodyId===id&&previous.body===body&&previous.rangeMm===rangeMm
    &&sameRayVector(previous.originMm,originMm)&&sameRayVector(previous.direction,direction))return previous;
   if(![...originMm,...direction,rangeMm].every(Number.isFinite)||rangeMm<=0||rangeMm>100000||Math.hypot(...direction)<1e-9){
    throw new Error(t('Invalid body sensor ray'));
   }
   const local=originMm.map((value,i)=>value*node.transform.scale[i]);
   const source=rotate(local,node.transform.rotation).map((value,i)=>value+node.transform.position[i]);
   const ray:SensorRay={bodyId:id,body,originMm,direction,rangeMm,source,axis:rotate(direction,node.transform.rotation)};
   if(sensorId!==undefined&&originMm.length===3&&direction.length===3){
    // The worker accepts at most 32 rays per command. Bound retention even
    // if a caller replaces its sensor IDs between commands.
    if(!previous&&sensorRays.size===32)sensorRays.delete(sensorRays.keys().next().value!);
    ray.originMm=[...originMm];ray.direction=[...direction];
    sensorRays.set(sensorId,ray);
   }
   return ray;
 }

 function bodyRayEndpoints(id:string,originMm:Vec3,direction:Vec3,rangeMm:number,sensorId?:string){
   const ray=prepareSensorRay(id,originMm,direction,rangeMm,sensorId);
   if(ray.projected?.revision===poseRevision)return ray.projected;
   const {body}=ray;
   // Pre-step validation and post-step casts can share each native pose
   // across all rays and welded parts at the same solver boundary.
   let cached=sensorPoses.get(body);
   if(cached?.revision!==poseRevision){
    cached={revision:poseRevision,pose:readPose(body)};
    sensorPoses.set(body,cached);
   }
   const {positionMm,quaternion}=cached.pose;
   const origin=quaternionPoint(ray.source,quaternion).map((value,i)=>value+positionMm[i]) as Vec3;
   const axis=quaternionPoint(ray.axis,quaternion),length=Math.hypot(...axis);
   const to=origin.map((value,i)=>value+axis[i]/length*rangeMm) as Vec3;
   return ray.projected={revision:poseRevision,origin,to};
 }

 function bodyForPose(id:string):NativeBody{
  const body=byId.get(id);
  if(!body)throw new Error(t('Unknown physics body'));
  return body;
 }
 function readPose(body:NativeBody){
  const p=body.GetPosition(),q=body.GetRotation();
  return {positionMm:[p.GetX()*1000,p.GetY()*1000,p.GetZ()*1000],quaternion:[q.GetX(),q.GetY(),q.GetZ(),q.GetW()]};
 }

 return {
  grabBody(id:string,pointMm:Vec3,targetMm:Vec3){const body=byId.get(id);if(disposed||!body||body.IsStatic())throw new Error(t('Choose a dynamic body to drag'));if([...pointMm,...targetMm].length!==6||[...pointMm,...targetMm].some(v=>!Number.isFinite(v)||Math.abs(v)>10000))throw new Error(t('Invalid drag point'));invalidateSeparatedPairs(id);if(grab?.id===id){grab.target=[...targetMm];return;}const p=body.GetPosition(),q=body.GetRotation();grab={id,local:quaternionPoint(pointMm.map((v,i)=>v*.001-[p.GetX(),p.GetY(),p.GetZ()][i]),[-q.GetX(),-q.GetY(),-q.GetZ(),q.GetW()]),target:[...targetMm]};},
  releaseGrab(){grab=undefined;},
  spawnSphere(id:string,positionMm:Vec3,velocityMmS:Vec3,radiusMm=6){spawnPreview(id,positionMm,velocityMmS,radiusMm,'sphere');},
  spawnBox(id:string,positionMm:Vec3,velocityMmS:Vec3,halfSizeMm=6){spawnPreview(id,positionMm,velocityMmS,halfSizeMm,'box');},
  step(seconds=1/200){
   if(disposed)throw new Error(t('Physics world was disposed'));
   const substeps=Math.round(seconds*200);
   if(!Number.isFinite(seconds)||seconds<=0||seconds>.1||Math.abs(seconds*200-substeps)>1e-8)throw new Error(t('Step must be a positive multiple of 1/200 s, at most 0.1 s'));
   // The last substep already checked the current poses. External edits
   // that may break clearance restore collision filtering for affected pairs.
   if(substeps>0&&elapsed===0)checkSeparatedFrames();
   // Existing sensor bodies move only inside the solver. Mark their cached
   // poses stale before stepping, including if the native step throws.
   if(substeps>0)poseRevision++;
   for(let i=0;i<substeps;i++){
    if(grab){const body=byId.get(grab.id),p=body.GetPosition(),q=body.GetRotation(),point=quaternionPoint(grab.local,[q.GetX(),q.GetY(),q.GetZ(),q.GetW()]).map((v,i)=>v+[p.GetX(),p.GetY(),p.GetZ()][i]),at=new J.RVec3(...point),velocity=bodies.GetPointVelocity(body.GetID(),at),speed=[velocity.GetX(),velocity.GetY(),velocity.GetZ()],acceleration=point.map((v,i)=>400*(grab!.target[i]*.001-v)-40*speed[i]),length=Math.hypot(...acceleration),force=new J.Vec3(...acceleration.map(v=>v*Math.min(1,100/Math.max(1e-9,length))*bodyMass.get(grab!.id)!));body.AddForce(force,at);bodies.ActivateBody(body.GetID());J.destroy(force);J.destroy(at);}
    world.Step(1/200,1);elapsed+=1/200;checkSeparatedFrames();
   }
  },
  get time(){return elapsed;},
  get rigidBodyCount(){return assemblies.size+previewCount;},
  get separatedHingePairCount(){return separatedHingePairs.size;},
  pose(id:string){if(disposed)throw new Error(t('Physics world was disposed'));return readPose(bodyForPose(id));},
  /** Sample each rigid body once while preserving part order and independent pose arrays. */
  poses(ids:readonly string[]){
   if(disposed)throw new Error(t('Physics world was disposed'));
   const sampled=new Map<NativeBody,ReturnType<typeof readPose>>();
   return ids.map(id=>{
    const body=bodyForPose(id),existing=sampled.get(body);
    if(existing)return {id,positionMm:existing.positionMm.slice(),quaternion:existing.quaternion.slice()};
    const pose=readPose(body);
    sampled.set(body,pose);
    return {id,...pose};
   });
  },
  angularVelocity(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));const v=body.GetAngularVelocity();return [v.GetX(),v.GetY(),v.GetZ()];},
  setAngularVelocity(id:string,velocityRadS:Vec3){if(disposed||!velocityRadS.every(Number.isFinite))throw new Error(t('Invalid physics state or velocity'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));if(body.IsStatic())throw new Error(t('A fixed body cannot be thrown'));invalidateSeparatedPairs(id);const point=new J.RVec3(...sourceCenterM(id)),previous=bodies.GetPointVelocity(body.GetID(),point),center=body.GetCenterOfMassPosition(),r=sourceCenterM(id).map((v,i)=>v-[center.GetX(),center.GetY(),center.GetZ()][i]),prior=[previous.GetX(),previous.GetY(),previous.GetZ()],linear=new J.Vec3(...prior.map((v,i)=>v-velocityRadS[(i+1)%3]*r[(i+2)%3]+velocityRadS[(i+2)%3]*r[(i+1)%3])),angular=new J.Vec3(...velocityRadS);bodies.SetLinearVelocity(body.GetID(),linear);bodies.SetAngularVelocity(body.GetID(),angular);bodies.ActivateBody(body.GetID());J.destroy(point);J.destroy(linear);J.destroy(angular);},
  geometryBoundsMm(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const body=byId.get(id),mesh=meshes.find(m=>m.id===id);if(!body||!mesh)throw new Error(t('Unknown physics body'));const p=body.GetPosition(),q=body.GetRotation(),x=q.GetX(),y=q.GetY(),z=q.GetZ(),w=q.GetW(),translation=[p.GetX()*1000,p.GetY()*1000,p.GetZ()*1000],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<mesh.positions.length;i+=3){const a=mesh.positions[i],b=mesh.positions[i+1],c=mesh.positions[i+2],u=2*(y*c-z*b),v=2*(z*a-x*c),t=2*(x*b-y*a),rotated=[a+w*u+y*t-z*v,b+w*v+z*u-x*t,c+w*t+x*v-y*u];for(let j=0;j<3;j++){const value=rotated[j]+translation[j];min[j]=Math.min(min[j],value);max[j]=Math.max(max[j],value);}}return {min,max};},
  boundsMm(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));const original=prepared.get(id);if(original&&assemblies.get(fixedRoot(id))!.length>1){const p=body.GetPosition(),q=body.GetRotation(),rotation=[q.GetX(),q.GetY(),q.GetZ(),q.GetW()],position=[p.GetX()*1000,p.GetY()*1000,p.GetZ()*1000],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const hull of original.hulls)for(let i=0;i<hull.positions.length;i+=3){const point=quaternionPoint(Array.from(hull.positions.subarray(i,i+3)),rotation);for(let axis=0;axis<3;axis++){const v=point[axis]+position[axis];min[axis]=Math.min(min[axis],v);max[axis]=Math.max(max[axis],v);}}return {min,max};}const box=body.GetWorldSpaceBounds();return {min:[box.mMin.GetX()*1000,box.mMin.GetY()*1000,box.mMin.GetZ()*1000],max:[box.mMax.GetX()*1000,box.mMax.GetY()*1000,box.mMax.GetZ()*1000]};},
  raycast(fromMm:Vec3,toMm:Vec3){return castRay(fromMm,toMm);},
  /** Reject invalid sensor input before a coupled command changes the world. */
  validateBodyRay(id:string,originMm:Vec3,direction:Vec3,rangeMm:number,sensorId?:string){
   const {origin,to}=bodyRayEndpoints(id,originMm,direction,rangeMm,sensorId);
   if(![...origin,...to].every(Number.isFinite))throw new Error(t('Invalid physics state or ray'));
  },
  /** Sample an ideal single ray carried by a body, ignoring its complete rigid assembly. */
  bodyRay(id:string,originMm:Vec3,direction:Vec3,rangeMm:number,sensorId?:string){
   const {origin,to}=bodyRayEndpoints(id,originMm,direction,rangeMm,sensorId);
   const hit=castRay(origin,to,id,false);return hit?hit.fraction*rangeMm:null;
  },
  linearVelocityMmS(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));const point=new J.RVec3(...sourceCenterM(id)),v=bodies.GetPointVelocity(body.GetID(),point);const velocity=[v.GetX()*1000,v.GetY()*1000,v.GetZ()*1000];J.destroy(point);return velocity;},
  setLinearVelocity(id:string,velocityMmS:Vec3){if(disposed||velocityMmS.length!==3||velocityMmS.some(v=>!Number.isFinite(v)||Math.abs(v)>10000))throw new Error(t('Invalid initial body velocity'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));if(body.IsStatic())throw new Error(t('A fixed body cannot be thrown'));invalidateSeparatedPairs(id);const center=body.GetCenterOfMassPosition(),r=sourceCenterM(id).map((v,i)=>v-[center.GetX(),center.GetY(),center.GetZ()][i]),angular=body.GetAngularVelocity(),w=[angular.GetX(),angular.GetY(),angular.GetZ()],v=new J.Vec3(...velocityMmS.map((v,i)=>v*.001-w[(i+1)%3]*r[(i+2)%3]+w[(i+2)%3]*r[(i+1)%3]));bodies.SetLinearVelocity(body.GetID(),v);bodies.ActivateBody(body.GetID());J.destroy(v);},
  applyImpulse(id:string,impulseNs:Vec3,pointMm?:Vec3){if(disposed||impulseNs.length!==3||impulseNs.some(v=>!Number.isFinite(v)||Math.abs(v)>100)||pointMm&&(pointMm.length!==3||pointMm.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6)))throw new Error(t('Invalid impulse'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));if(body.IsStatic())throw new Error(t('A fixed body cannot be thrown'));invalidateSeparatedPairs(id);const impulse=new J.Vec3(...impulseNs),point=new J.RVec3(...(pointMm?pointMm.map(v=>v*.001):sourceCenterM(id)));body.AddImpulse(impulse,point);J.destroy(point);bodies.ActivateBody(body.GetID());J.destroy(impulse);},
  sliderPosition(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const binding=motorBindings.get(id);if(binding?.kind!=='slider')throw new Error(t('Unknown slider connector'));return binding.motor.GetCurrentPosition()*1000;},
  setSliderMotor(id:string,speedMmS:number,maxForceN:number){if(disposed||!Number.isFinite(speedMmS)||Math.abs(speedMmS)>1000||!Number.isFinite(maxForceN)||maxForceN<=0||maxForceN>10000)throw new Error(t('Invalid slider motor command'));const binding=motorBindings.get(id);if(binding?.kind!=='slider')throw new Error(t('Unknown slider connector'));const {joint,motor}=binding,settings=motor.GetMotorSettings();settings.mMinForceLimit=-maxForceN;settings.mMaxForceLimit=maxForceN;motor.SetTargetVelocity(speedMmS*.001);enableVelocityMotor(id,motor);for(const id of [joint.bodyA,joint.bodyB])bodies.ActivateBody(byId.get(id).GetID());},
  stopSliderMotor(id:string,action:'brake'|'coast'='brake'){if(disposed)throw new Error(t('Physics world was disposed'));const binding=motorBindings.get(id);if(binding?.kind!=='slider'||!['brake','coast'].includes(action))throw new Error(t('Unknown slider connector'));const {motor}=binding;if(action==='coast')motor.SetMotorState(J.EMotorState_Off);else{const settings=motor.GetMotorSettings();if(settings.mMaxForceLimit>10000){settings.mMaxForceLimit=10;settings.mMinForceLimit=-10;}motor.SetTargetVelocity(0);enableVelocityMotor(id,motor);}},
  /** Internal actuator impulse: equal and opposite reactions, with the axis carried by body A. */
  applyJointImpulse(id:string,impulse:number){
   if(disposed||!Number.isFinite(impulse)||Math.abs(impulse)>1)throw new Error(t('Invalid actuator impulse'));
   const actuator=actuatorFrame(id);
   const {joint,a,b,axis:authoredAxis,anchorM,motor}=actuator;
   const rotation=a.GetRotation(),q=[rotation.GetX(),rotation.GetY(),rotation.GetZ(),rotation.GetW()];
   const [x,y,z]=quaternionPoint(authoredAxis,q).map(v=>v*impulse);
   impulseVector??=new J.Vec3(0,0,0);
   // These native settings persist across physics steps in this world.
   if(!actuator.impulseConfigured){
    motor.SetMotorState(J.EMotorState_Off);
    if(joint.kind==='hinge'){
     motor.SetNumVelocityStepsOverride(40);
     motor.SetNumPositionStepsOverride(80);
    }
    actuator.impulseConfigured=true;
   }
   if(joint.kind==='slider'){
    const origin=a.GetPosition(),offset=quaternionPoint(anchorM!,q);
    impulsePoint??=new J.RVec3(0,0,0);
    impulsePoint.Set(offset[0]+origin.GetX(),offset[1]+origin.GetY(),offset[2]+origin.GetZ());
   }
   for(const [body,sign]of [[a,-1],[b,1]] as const){
    if(body.IsStatic())continue;
    impulseVector.Set(x*sign,y*sign,z*sign);
    if(joint.kind==='hinge')body.AddAngularImpulse(impulseVector);else body.AddImpulse(impulseVector,impulsePoint);
    bodies.ActivateBody(body.GetID());
   }
  },
  /** Ideal torque-limited position servo, solved implicitly with both-body reaction. */
  setHingeServo(id:string,angleRad:number,maxTorqueNm:number){
   const binding=motorBindings.get(id);
   if(disposed||!Number.isFinite(angleRad)||Math.abs(angleRad)>Math.PI*2||!Number.isFinite(maxTorqueNm)||maxTorqueNm<=0||maxTorqueNm>100||binding?.kind!=='hinge')throw new Error(t('Invalid position servo target'));
   const {joint,motor:hinge}=binding,motor=hinge.GetMotorSettings();
   tuneSerialServo(joint.bodyA);
   motor.mMinTorqueLimit=-maxTorqueNm;motor.mMaxTorqueLimit=maxTorqueNm;
   // Ideal internal position loop. Native velocity constraints enforce the
   // torque bound implicitly; measuring again each coupled step closes the loop.
   const error=angleRad-hinge.GetCurrentAngle(),speed=Math.max(-Math.PI*5/3,Math.min(Math.PI*5/3,error*12));
   hinge.SetTargetAngularVelocity(speed);enableVelocityMotor(id,hinge);for(const body of [joint.bodyA,joint.bodyB])bodies.ActivateBody(byId.get(body).GetID());
  },
  setHingeMotor(id:string,speedRadS:number,maxTorqueNm:number){
   if(disposed||!Number.isFinite(speedRadS)||Math.abs(speedRadS)>20||!Number.isFinite(maxTorqueNm)||maxTorqueNm<=0||maxTorqueNm>100)throw new Error(t('Invalid hinge motor command'));
   const binding=motorBindings.get(id);if(binding?.kind!=='hinge')throw new Error(t('Unknown hinge joint'));
   const {joint,motor:hinge}=binding,motor=hinge.GetMotorSettings();
   motor.mMinTorqueLimit=-maxTorqueNm;motor.mMaxTorqueLimit=maxTorqueNm;
   hinge.SetTargetAngularVelocity(speedRadS);enableVelocityMotor(id,hinge);
   for(const body of [joint.bodyA,joint.bodyB])bodies.ActivateBody(byId.get(body).GetID());
  },
  coastHingeMotor(id:string){
   if(disposed)throw new Error(t('Physics world was disposed'));
   const binding=motorBindings.get(id);if(binding?.kind!=='hinge')throw new Error(t('Unknown hinge joint'));
   binding.motor.SetMotorState(J.EMotorState_Off);
  },
  stopHingeMotor(id:string){
   if(disposed)throw new Error(t('Physics world was disposed'));
   const binding=motorBindings.get(id);if(binding?.kind!=='hinge')throw new Error(t('Unknown hinge joint'));
   // Brake through the finite motor torque; never overwrite the body's pose/velocity.
   const {joint,motor:hinge}=binding,motor=hinge.GetMotorSettings();
   if(motor.mMaxTorqueLimit>100){motor.mMaxTorqueLimit=.02;motor.mMinTorqueLimit=-.02;}
   hinge.SetTargetAngularVelocity(0);enableVelocityMotor(id,hinge);
   for(const body of [joint.bodyA,joint.bodyB])bodies.ActivateBody(byId.get(body).GetID());
  },
  hingeAngle(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const binding=motorBindings.get(id);if(binding?.kind!=='hinge')throw new Error(t('Unknown hinge joint'));return binding.motor.GetCurrentAngle();},
  dispose,
 };
}
