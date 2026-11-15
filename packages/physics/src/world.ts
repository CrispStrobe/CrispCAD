// SPDX-License-Identifier: BSD-3-Clause
import {t,simulationSettings} from '@brickwright/cad-core';
import type initJolt from 'jolt-physics/wasm-compat';
import { validateDocument, defaultPartPhysics, documentGeometryKey } from '@brickwright/cad-core';
import type { CadDocument, Vec3 } from '@brickwright/cad-core';
import type { GeometryResult } from '@brickwright/cad-geometry';
import { solidMassProperties } from './mass.js';
import { geometryHash, isQualifiedCollision } from './collision.js';
import type { PreparedCollision } from './collision.js';
let modulePromise:ReturnType<typeof initJolt>|undefined;
const rotate=(point:number[],rotation:Vec3)=>{let [x,y,z]=point;for(let i=0;i<3;i++){const a=rotation[i]*Math.PI/180,c=Math.cos(a),s=Math.sin(a);if(i===0)[y,z]=[c*y-s*z,s*y+c*z];if(i===1)[x,z]=[c*x+s*z,-s*x+c*z];if(i===2)[x,y]=[c*x-s*y,s*x+c*y];}return [x,y,z];};
/** Evaluated geometry is baked in world-space mm; body poses are deltas to that
 * geometry. SI conversion happens once, at this boundary. Fixed 200 Hz steps. */
export async function createPhysicsWorld(document:CadDocument,result:GeometryResult,prepared:ReadonlyMap<string,PreparedCollision>,options:{J?:any;ground?:boolean;mode?:'mechanism'|'rigid-preview'}={}){
 const doc=validateDocument(document),sceneSettings=simulationSettings(doc);if(result.sourceKey!==documentGeometryKey(doc))throw new Error(t('Geometry is stale for this document'));const meshes=result.bodies.filter(b=>!b.reference&&!b.hole);if(!meshes.length)throw new Error(t('There are no physical solids to simulate'));if(meshes.length>256)throw new Error(t('Simulation budget is 256 bodies'));
 for(const mesh of meshes){const p=prepared.get(mesh.id);if(!p||!await isQualifiedCollision(p)||p.certificate.sourceSHA256!==await geometryHash(mesh)||p.certificate.relativeError>p.certificate.tolerance.volumeFraction||p.certificate.boundsErrorMm>p.certificate.tolerance.boundsMm||!p.hulls.length||p.hulls.length>2048)throw new Error(t`${mesh.name}: qualified collision geometry is missing or stale`);}
 if(options.mode!=='rigid-preview')for(const mesh of meshes){const intent=doc.nodes[mesh.id]?.physics?.intent??'rigid';if(intent!=='rigid'&&!(intent==='hinge'&&doc.joints?.some(j=>j.bodyA===mesh.id||j.bodyB===mesh.id)))throw new Error(t`${mesh.name}: ${intent} needs a qualified mechanical model and mates. Choose rigid-preview explicitly to simulate only its rigid geometry.`);}
 if([...prepared.values()].reduce((sum,p)=>sum+p.hulls.length,0)>4096)throw new Error(t('Simulation scene exceeds the 4096-convex-piece budget'));
 const J=options.J??await(modulePromise??=import('jolt-physics/wasm-compat').then(module=>module.default()));
 const settings=new J.JoltSettings();settings.mMaxBodies=512;settings.mMaxBodyPairs=Math.max(1024,meshes.length*meshes.length);settings.mMaxContactConstraints=8192;
 const pairs=new J.ObjectLayerPairFilterTable(2);pairs.EnableCollision(0,1);pairs.EnableCollision(1,1);
 const broad=new J.BroadPhaseLayerInterfaceTable(2,2);const staticLayer=new J.BroadPhaseLayer(0),dynamicLayer=new J.BroadPhaseLayer(1);broad.MapObjectToBroadPhaseLayer(0,staticLayer);broad.MapObjectToBroadPhaseLayer(1,dynamicLayer);J.destroy(staticLayer);J.destroy(dynamicLayer);
 settings.mObjectLayerPairFilter=pairs;settings.mBroadPhaseLayerInterface=broad;settings.mObjectVsBroadPhaseLayerFilter=new J.ObjectVsBroadPhaseLayerFilterTable(broad,2,pairs,2);
 const world=new J.JoltInterface(settings);J.destroy(settings);const system=world.GetPhysicsSystem(),bodies=system.GetBodyInterface();const gravity=new J.Vec3(...sceneSettings.gravity);system.SetGravity(gravity);J.destroy(gravity);
 const tuning=new J.PhysicsSettings();tuning.mDeterministicSimulation=true;tuning.mUseBodyPairContactCache=false;tuning.mAllowSleeping=false;tuning.mManifoldTolerance=.00001;tuning.mContactPointPreserveLambdaMaxDistSq=.00000001;tuning.mPenetrationSlop=.00002;tuning.mSpeculativeContactDistance=.0001;tuning.mMinVelocityForRestitution=.1;tuning.mNumVelocitySteps=20;tuning.mNumPositionSteps=8;system.SetPhysicsSettings(tuning);J.destroy(tuning);
 const bodyMass=new Map<string,number>();let grab:{id:string;local:number[];target:Vec3}|undefined;
 const quaternionPoint=(p:number[],q:number[])=>{const [x,y,z,w]=q,[a,b,c]=p,u=2*(y*c-z*b),v=2*(z*a-x*c),t=2*(x*b-y*a);return [a+w*u+y*t-z*v,b+w*v+z*u-x*t,c+w*t+x*v-y*u];};
 const ownedBodies:any[]=[],byId=new Map<string,any>(),constraints=new Map<string,any>();let disposed=false,elapsed=0;
 const group=new J.GroupFilterTable(Math.max(1,meshes.length));const bodyIndex=new Map(meshes.map((m,i)=>[m.id,i]));for(const joint of doc.joints??[])group.DisableCollision(bodyIndex.get(joint.bodyA)!,bodyIndex.get(joint.bodyB)!);
 const add=(shape:any,id:string,motion:'dynamic'|'static',properties:any,mass?:ReturnType<typeof solidMassProperties>)=>{
  const pos=new J.RVec3(0,0,0),q=new J.Quat(0,0,0,1);const bc=new J.BodyCreationSettings(shape,pos,q,motion==='static'?J.EMotionType_Static:J.EMotionType_Dynamic,motion==='static'?0:1);J.destroy(pos);J.destroy(q);
  bc.mFriction=properties.friction;bc.mRestitution=properties.restitution;bc.mLinearDamping=0;bc.mAngularDamping=0;
  if(bodyIndex.has(id)){const cg=new J.CollisionGroup(group,0,bodyIndex.get(id));bc.mCollisionGroup=cg;J.destroy(cg);}
  if(mass&&motion==='dynamic'){
   bc.mMotionQuality=J.EMotionQuality_LinearCast;bc.mOverrideMassProperties=J.EOverrideMassProperties_MassAndInertiaProvided;
   const mp=new J.MassProperties();mp.mMass=mass.massKg;const matrix=new J.Mat44();for(let col=0;col<3;col++){const v=new J.Vec3(mass.inertiaKgM2[0][col],mass.inertiaKgM2[1][col],mass.inertiaKgM2[2][col]);matrix.SetColumn3(col,v);J.destroy(v);}const end=new J.Vec4(0,0,0,1);matrix.SetColumn4(3,end);J.destroy(end);mp.mInertia=matrix;bc.mMassPropertiesOverride=mp;J.destroy(matrix);J.destroy(mp);
  }
  try{const body=bodies.CreateBody(bc);if(!body)throw new Error(t('Jolt body allocation failed'));bodies.AddBody(body.GetID(),motion==='static'?J.EActivation_DontActivate:J.EActivation_Activate);ownedBodies.push(body);byId.set(id,body);if(mass)bodyMass.set(id,mass.massKg);}finally{J.destroy(bc);}
 };
 function dispose(){if(disposed)return;disposed=true;for(const c of constraints.values()){system.RemoveConstraint(c);c.Release();}for(const body of ownedBodies){bodies.RemoveBody(body.GetID());bodies.DestroyBody(body.GetID());}J.destroy(world);}
 try {
  if(options.ground??sceneSettings.ground){const ext=new J.Vec3(2,2,.005),shape=new J.BoxShape(ext,.0001);J.destroy(ext);add(shape,'ground','static',{friction:sceneSettings.groundFriction,restitution:sceneSettings.groundRestitution});const p=new J.RVec3(0,0,-.005);bodies.SetPosition(byId.get('ground').GetID(),p,J.EActivation_DontActivate);J.destroy(p);}
  for(const mesh of meshes){const node=doc.nodes[mesh.id];if(!node)throw new Error(t('Evaluated body does not belong to this project'));const properties=node.physics??defaultPartPhysics(),mass=solidMassProperties(mesh,properties.densityKgM3),compound=new J.StaticCompoundShapeSettings();
   for(const [i,hull] of prepared.get(mesh.id)!.hulls.entries()) {if(hull.positions.length<12||hull.positions.length>192||Array.from(hull.positions).some(v=>!Number.isFinite(v)))throw new Error(t('Collision hull violates the solver budget'));const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let k=0;k<hull.positions.length;k++) {min[k%3]=Math.min(min[k%3],hull.positions[k]);max[k%3]=Math.max(max[k%3],hull.positions[k]);}const center=min.map((v,k)=>(v+max[k])/2),spans=max.map((v,k)=>v-min[k]),extent=Math.max(...spans);if(spans.some(v=>v<=0))throw new Error(t('Collision hull has no finite extent'));
    // Condition each axis to [-.5,.5] to preserve shared axis-aligned bounds
    // more accurately and avoid float-rounding cracks between hulls.
    // ScaledShape then converts back to metres without moving the contact surface.
    const leaf=new J.ConvexHullShapeSettings();leaf.mMaxConvexRadius=Math.min(.02,.1*Math.min(...max.map((v,k)=>v-min[k])))/extent;leaf.mHullTolerance=Math.min(.005,prepared.get(mesh.id)!.certificate.tolerance.boundsMm/extent/4);for(let k=0;k<hull.positions.length;k+=3){const p=new J.Vec3((hull.positions[k]-center[0])/spans[0],(hull.positions[k+1]-center[1])/spans[1],(hull.positions[k+2]-center[2])/spans[2]);leaf.mPoints.push_back(p);J.destroy(p);}const scaling=new J.Vec3(spans[0]*.001,spans[1]*.001,spans[2]*.001),scaled=new J.ScaledShapeSettings(leaf,scaling);J.destroy(scaling);const position=new J.Vec3(center[0]*.001,center[1]*.001,center[2]*.001),q=new J.Quat(0,0,0,1);compound.AddShape(position,q,scaled,i);J.destroy(position);J.destroy(q);}
   const created=compound.Create();try{if(created.HasError())throw new Error(created.GetError().c_str());const shape=created.Get();const center=shape.GetCenterOfMass();const shift=new J.Vec3(mass.centerM[0]-center.GetX(),mass.centerM[1]-center.GetY(),mass.centerM[2]-center.GetZ());const corrected=new J.OffsetCenterOfMassShape(shape,shift);J.destroy(shift);add(corrected,mesh.id,properties.motion,properties,mass);}finally{created.Clear();J.destroy(compound);}
  }
  for(const joint of doc.joints??[]){
   const a=byId.get(joint.bodyA),b=byId.get(joint.bodyB);if(!a||!b)throw new Error(t('Joint references a missing body'));
   const frame=(id:string,anchor:Vec3,axis:Vec3)=>{const t=doc.nodes[id].transform;const p=rotate(anchor.map((v,i)=>v*t.scale[i]),t.rotation).map((v,i)=>(v+t.position[i])*.001);const z=rotate(axis,t.rotation),seed=Math.abs(z[0])<.9?[1,0,0]:[0,1,0],dot=z.reduce((s,v,i)=>s+v*seed[i],0),n=seed.map((v,i)=>v-dot*z[i]),len=Math.hypot(...n);return {p,z,n:n.map(v=>v/len)};};
   const fa=frame(joint.bodyA,joint.anchorA,joint.axisA),fb=frame(joint.bodyB,joint.anchorB,joint.axisB);if(Math.hypot(...fa.p.map((v,i)=>v-fb.p[i]))>.0001||Math.abs(fa.z.reduce((s,v,i)=>s+v*fb.z[i],0)-1)>.0001)throw new Error(t('Joint frames are misaligned after editing. Repair the assembly before simulating.'));
   const cs=joint.kind==='hinge'?new J.HingeConstraintSettings():joint.kind==='slider'?new J.SliderConstraintSettings():joint.kind==='pivot'?new J.SwingTwistConstraintSettings():new J.FixedConstraintSettings();cs.mSpace=J.EConstraintSpace_WorldSpace;const temporaries:any[]=[];const point=(p:number[])=>{const v=new J.RVec3(...p);temporaries.push(v);return v;};const vector=(p:number[])=>{const v=new J.Vec3(...p);temporaries.push(v);return v;};if(joint.kind==='pivot'){cs.mPosition1=point(fa.p);cs.mPosition2=point(fb.p);}else{cs.mPoint1=point(fa.p);cs.mPoint2=point(fb.p);}
   if(joint.kind==='hinge'){cs.mHingeAxis1=vector(fa.z);cs.mHingeAxis2=vector(fb.z);cs.mNormalAxis1=vector(fa.n);cs.mNormalAxis2=vector(fb.n);if(joint.limits){cs.mLimitsMin=joint.limits[0];cs.mLimitsMax=joint.limits[1];}}else if(joint.kind==='slider'){cs.mAutoDetectPoint=false;cs.mSliderAxis1=vector(fa.z);cs.mSliderAxis2=vector(fb.z);cs.mNormalAxis1=vector(fa.n);cs.mNormalAxis2=vector(fb.n);if(joint.limits){cs.mLimitsMin=joint.limits[0]*.001;cs.mLimitsMax=joint.limits[1]*.001;}}
   else if(joint.kind==='pivot'){cs.mTwistAxis1=vector(fa.z);cs.mTwistAxis2=vector(fb.z);cs.mPlaneAxis1=vector(fa.n);cs.mPlaneAxis2=vector(fb.n);cs.mSwingType=J.ESwingType_Cone;cs.mNormalHalfConeAngle=joint.coneAngle??Math.PI;cs.mPlaneHalfConeAngle=joint.coneAngle??Math.PI;cs.mTwistMinAngle=-Math.PI;cs.mTwistMaxAngle=Math.PI;}
   else{cs.mAutoDetectPoint=false;cs.mAxisX1=vector(fa.z);cs.mAxisX2=vector(fb.z);cs.mAxisY1=vector(fa.n);cs.mAxisY2=vector(fb.n);}
   const constraint=cs.Create(a,b);constraint.AddRef();system.AddConstraint(constraint);constraints.set(joint.id,constraint);temporaries.forEach(v=>J.destroy(v));J.destroy(cs);
  }
  for(const mesh of meshes){const p=doc.nodes[mesh.id].physics;if(p?.motion==='static')continue;const body=byId.get(mesh.id);if(p?.initialVelocityMmS){const velocity=new J.Vec3(...p.initialVelocityMmS.map(v=>v*.001));bodies.SetLinearVelocity(body.GetID(),velocity);J.destroy(velocity);}if(p?.initialAngularVelocityDps){const velocity=new J.Vec3(...p.initialAngularVelocityDps.map(v=>v*Math.PI/180));bodies.SetAngularVelocity(body.GetID(),velocity);J.destroy(velocity);}}
  system.OptimizeBroadPhase();
 }catch(e){dispose();throw e;}
 let previewCount=0;
 function spawnPreview(id:string,positionMm:Vec3,velocityMmS:Vec3,sizeMm:number,kind:'sphere'|'box'){
  if(disposed||byId.has(id)||!/^preview-[a-zA-Z0-9_-]+$/.test(id)||previewCount>=32||!Number.isFinite(sizeMm)||sizeMm<1||sizeMm>50||[...positionMm,...velocityMmS].length!==6||positionMm.some(v=>!Number.isFinite(v)||Math.abs(v)>10000)||velocityMmS.some(v=>!Number.isFinite(v)||Math.abs(v)>10000))throw new Error(t('Invalid preview ball or preview budget exceeded'));
  const radius=sizeMm*.001,volumeM3=kind==='sphere'?4*Math.PI*radius**3/3:(2*radius)**3,massKg=volumeM3*1050,inertia=kind==='sphere'?.4*massKg*radius**2:massKg*(2*radius)**2/6;
  const extent=kind==='box'?new J.Vec3(radius,radius,radius):undefined,shape=extent?new J.BoxShape(extent,Math.min(.0001,radius/10)):new J.SphereShape(radius);if(extent)J.destroy(extent);
  add(shape,id,'dynamic',{friction:.4,restitution:.45},{massKg,volumeM3,centerM:[0,0,0],inertiaKgM2:[[inertia,0,0],[0,inertia,0],[0,0,inertia]]});previewCount++;
  const body=byId.get(id),p=new J.RVec3(...positionMm.map(v=>v*.001)),v=new J.Vec3(...velocityMmS.map(v=>v*.001));bodies.SetPosition(body.GetID(),p,J.EActivation_Activate);bodies.SetLinearVelocity(body.GetID(),v);J.destroy(p);J.destroy(v);
 }
 return {
  grabBody(id:string,pointMm:Vec3,targetMm:Vec3){const body=byId.get(id);if(disposed||!body||body.IsStatic())throw new Error(t('Choose a dynamic body to drag'));if([...pointMm,...targetMm].length!==6||[...pointMm,...targetMm].some(v=>!Number.isFinite(v)||Math.abs(v)>10000))throw new Error(t('Invalid drag point'));if(grab?.id===id){grab.target=[...targetMm];return;}const p=body.GetPosition(),q=body.GetRotation();grab={id,local:quaternionPoint(pointMm.map((v,i)=>v*.001-[p.GetX(),p.GetY(),p.GetZ()][i]),[-q.GetX(),-q.GetY(),-q.GetZ(),q.GetW()]),target:[...targetMm]};},
  releaseGrab(){grab=undefined;},
  spawnSphere(id:string,positionMm:Vec3,velocityMmS:Vec3,radiusMm=6){spawnPreview(id,positionMm,velocityMmS,radiusMm,'sphere');},
  spawnBox(id:string,positionMm:Vec3,velocityMmS:Vec3,halfSizeMm=6){spawnPreview(id,positionMm,velocityMmS,halfSizeMm,'box');},
  step(seconds=1/200){if(disposed)throw new Error(t('Physics world was disposed'));if(!Number.isFinite(seconds)||seconds<=0||seconds>.1||Math.abs(seconds*200-Math.round(seconds*200))>1e-8)throw new Error(t('Step must be a positive multiple of 1/200 s, at most 0.1 s'));for(let i=0;i<Math.round(seconds*200);i++){if(grab){const body=byId.get(grab.id),p=body.GetPosition(),q=body.GetRotation(),point=quaternionPoint(grab.local,[q.GetX(),q.GetY(),q.GetZ(),q.GetW()]).map((v,i)=>v+[p.GetX(),p.GetY(),p.GetZ()][i]),at=new J.RVec3(...point),velocity=bodies.GetPointVelocity(body.GetID(),at),speed=[velocity.GetX(),velocity.GetY(),velocity.GetZ()],acceleration=point.map((v,i)=>400*(grab!.target[i]*.001-v)-40*speed[i]),length=Math.hypot(...acceleration),force=new J.Vec3(...acceleration.map(v=>v*Math.min(1,100/Math.max(1e-9,length))*bodyMass.get(grab!.id)!));body.AddForce(force,at);bodies.ActivateBody(body.GetID());J.destroy(force);J.destroy(at);}
    world.Step(1/200,1);elapsed+=1/200;}},
  get time(){return elapsed;},
  pose(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));const p=body.GetPosition(),q=body.GetRotation();return {positionMm:[p.GetX()*1000,p.GetY()*1000,p.GetZ()*1000],quaternion:[q.GetX(),q.GetY(),q.GetZ(),q.GetW()]};},
  angularVelocity(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));const v=body.GetAngularVelocity();return [v.GetX(),v.GetY(),v.GetZ()];},
  setAngularVelocity(id:string,velocityRadS:Vec3){if(disposed||!velocityRadS.every(Number.isFinite))throw new Error(t('Invalid physics state or velocity'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));const v=new J.Vec3(...velocityRadS);bodies.SetAngularVelocity(body.GetID(),v);bodies.ActivateBody(body.GetID());J.destroy(v);},
  geometryBoundsMm(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const body=byId.get(id),mesh=meshes.find(m=>m.id===id);if(!body||!mesh)throw new Error(t('Unknown physics body'));const p=body.GetPosition(),q=body.GetRotation(),x=q.GetX(),y=q.GetY(),z=q.GetZ(),w=q.GetW(),translation=[p.GetX()*1000,p.GetY()*1000,p.GetZ()*1000],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<mesh.positions.length;i+=3){const a=mesh.positions[i],b=mesh.positions[i+1],c=mesh.positions[i+2],u=2*(y*c-z*b),v=2*(z*a-x*c),t=2*(x*b-y*a),rotated=[a+w*u+y*t-z*v,b+w*v+z*u-x*t,c+w*t+x*v-y*u];for(let j=0;j<3;j++){const value=rotated[j]+translation[j];min[j]=Math.min(min[j],value);max[j]=Math.max(max[j],value);}}return {min,max};},
  boundsMm(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));const box=body.GetWorldSpaceBounds();return {min:[box.mMin.GetX()*1000,box.mMin.GetY()*1000,box.mMin.GetZ()*1000],max:[box.mMax.GetX()*1000,box.mMax.GetY()*1000,box.mMax.GetZ()*1000]};},
  raycast(fromMm:Vec3,toMm:Vec3){
   if(disposed||![...fromMm,...toMm].every(Number.isFinite))throw new Error(t('Invalid physics state or ray'));
   const own:any[]=[];const keep=(value:any)=>{own.push(value);return value;};
   try{const ray=keep(new J.RRayCast()),origin=keep(new J.RVec3(...fromMm.map(v=>v*.001))),direction=keep(new J.Vec3(...toMm.map((v,i)=>(v-fromMm[i])*.001)));ray.mOrigin=origin;ray.mDirection=direction;
    const settings=keep(new J.RayCastSettings()),collector=keep(new J.CastRayClosestHitCollisionCollector()),permissive=keep(new J.ObjectVsBroadPhaseLayerFilterJS());permissive.ShouldCollide=()=>true;
    const broadFilter=keep(new J.DefaultBroadPhaseLayerFilter(permissive,0)),objectFilter=keep(new J.ObjectLayerFilterJS());objectFilter.ShouldCollide=()=>true;
    const bodyFilter=keep(new J.BodyFilter()),shapeFilter=keep(new J.ShapeFilter());system.GetNarrowPhaseQuery().CastRay(ray,settings,collector,broadFilter,objectFilter,bodyFilter,shapeFilter);
    if(!collector.HadHit())return null;const hit=collector.mHit,index=hit.mBodyID.GetIndexAndSequenceNumber();const id=[...byId].find(([,body])=>body.GetID().GetIndexAndSequenceNumber()===index)?.[0];return {bodyId:id,fraction:hit.mFraction};
   }finally{for(const value of own.reverse())J.destroy(value);}
  },
  linearVelocityMmS(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));const v=body.GetLinearVelocity();return [v.GetX()*1000,v.GetY()*1000,v.GetZ()*1000];},
  setLinearVelocity(id:string,velocityMmS:Vec3){if(disposed||velocityMmS.length!==3||velocityMmS.some(v=>!Number.isFinite(v)||Math.abs(v)>10000))throw new Error(t('Invalid initial body velocity'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));if(body.IsStatic())throw new Error(t('A fixed body cannot be thrown'));const v=new J.Vec3(...velocityMmS.map(v=>v*.001));bodies.SetLinearVelocity(body.GetID(),v);bodies.ActivateBody(body.GetID());J.destroy(v);},
  applyImpulse(id:string,impulseNs:Vec3,pointMm?:Vec3){if(disposed||impulseNs.length!==3||impulseNs.some(v=>!Number.isFinite(v)||Math.abs(v)>100)||pointMm&&(pointMm.length!==3||pointMm.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6)))throw new Error(t('Invalid impulse'));const body=byId.get(id);if(!body)throw new Error(t('Unknown physics body'));if(body.IsStatic())throw new Error(t('A fixed body cannot be thrown'));const impulse=new J.Vec3(...impulseNs);if(pointMm){const point=new J.RVec3(...pointMm.map(v=>v*.001));body.AddImpulse(impulse,point);J.destroy(point);}else body.AddImpulse(impulse);bodies.ActivateBody(body.GetID());J.destroy(impulse);},
  sliderPosition(id:string){if(disposed)throw new Error(t('Physics world was disposed'));if(doc.joints?.find(j=>j.id===id)?.kind!=='slider')throw new Error(t('Unknown slider connector'));return J.castObject(constraints.get(id),J.SliderConstraint).GetCurrentPosition()*1000;},
  setSliderMotor(id:string,speedMmS:number,maxForceN:number){if(disposed||!Number.isFinite(speedMmS)||Math.abs(speedMmS)>1000||!Number.isFinite(maxForceN)||maxForceN<=0||maxForceN>10000)throw new Error(t('Invalid slider motor command'));const joint=doc.joints?.find(j=>j.id===id);if(joint?.kind!=='slider')throw new Error(t('Unknown slider connector'));const motor=J.castObject(constraints.get(id),J.SliderConstraint),settings=motor.GetMotorSettings();settings.mMinForceLimit=-maxForceN;settings.mMaxForceLimit=maxForceN;motor.SetTargetVelocity(speedMmS*.001);motor.SetMotorState(J.EMotorState_Velocity);for(const id of [joint.bodyA,joint.bodyB])bodies.ActivateBody(byId.get(id).GetID());},
  stopSliderMotor(id:string,action:'brake'|'coast'='brake'){if(disposed)throw new Error(t('Physics world was disposed'));if(doc.joints?.find(j=>j.id===id)?.kind!=='slider'||!['brake','coast'].includes(action))throw new Error(t('Unknown slider connector'));const motor=J.castObject(constraints.get(id),J.SliderConstraint);if(action==='coast')motor.SetMotorState(J.EMotorState_Off);else{const settings=motor.GetMotorSettings();if(settings.mMaxForceLimit>10000){settings.mMaxForceLimit=10;settings.mMinForceLimit=-10;}motor.SetTargetVelocity(0);motor.SetMotorState(J.EMotorState_Velocity);}},
  setHingeMotor(id:string,speedRadS:number,maxTorqueNm:number){
   if(disposed||!Number.isFinite(speedRadS)||Math.abs(speedRadS)>20||!Number.isFinite(maxTorqueNm)||maxTorqueNm<=0||maxTorqueNm>100)throw new Error(t('Invalid hinge motor command'));
   const joint=doc.joints?.find(j=>j.id===id);if(joint?.kind!=='hinge')throw new Error(t('Unknown hinge joint'));
   const hinge=J.castObject(constraints.get(id),J.HingeConstraint),motor=hinge.GetMotorSettings();
   motor.mMinTorqueLimit=-maxTorqueNm;motor.mMaxTorqueLimit=maxTorqueNm;
   hinge.SetTargetAngularVelocity(speedRadS);hinge.SetMotorState(J.EMotorState_Velocity);
   for(const body of [joint.bodyA,joint.bodyB])bodies.ActivateBody(byId.get(body).GetID());
  },
  coastHingeMotor(id:string){
   if(disposed)throw new Error(t('Physics world was disposed'));
   if(doc.joints?.find(j=>j.id===id)?.kind!=='hinge')throw new Error(t('Unknown hinge joint'));
   J.castObject(constraints.get(id),J.HingeConstraint).SetMotorState(J.EMotorState_Off);
  },
  stopHingeMotor(id:string){
   if(disposed)throw new Error(t('Physics world was disposed'));
   const joint=doc.joints?.find(j=>j.id===id);if(joint?.kind!=='hinge')throw new Error(t('Unknown hinge joint'));
   // Brake through the finite motor torque; never overwrite the body's pose/velocity.
   const hinge=J.castObject(constraints.get(id),J.HingeConstraint),motor=hinge.GetMotorSettings();
   if(motor.mMaxTorqueLimit>100){motor.mMaxTorqueLimit=.02;motor.mMinTorqueLimit=-.02;}
   hinge.SetTargetAngularVelocity(0);hinge.SetMotorState(J.EMotorState_Velocity);
   for(const body of [joint.bodyA,joint.bodyB])bodies.ActivateBody(byId.get(body).GetID());
  },
  hingeAngle(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const joint=doc.joints?.find(j=>j.id===id);if(joint?.kind!=='hinge')throw new Error(t('Unknown hinge joint'));return J.castObject(constraints.get(id),J.HingeConstraint).GetCurrentAngle();},
  dispose,
 };
}
