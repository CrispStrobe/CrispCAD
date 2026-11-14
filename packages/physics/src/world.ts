// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
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
 const doc=validateDocument(document);if(result.sourceKey!==documentGeometryKey(doc))throw new Error(t('Geometry is stale for this document'));const meshes=result.bodies.filter(b=>!b.reference&&!b.hole);if(!meshes.length)throw new Error(t('There are no physical solids to simulate'));if(meshes.length>256)throw new Error(t('Simulation budget is 256 bodies'));
 for(const mesh of meshes){const p=prepared.get(mesh.id);if(!p||!await isQualifiedCollision(p)||p.certificate.sourceSHA256!==await geometryHash(mesh)||p.certificate.relativeError>p.certificate.tolerance.volumeFraction||p.certificate.boundsErrorMm>p.certificate.tolerance.boundsMm||!p.hulls.length||p.hulls.length>2048)throw new Error(t`${mesh.name}: qualified collision geometry is missing or stale`);}
 if(options.mode!=='rigid-preview')for(const mesh of meshes){const intent=doc.nodes[mesh.id]?.physics?.intent??'rigid';if(intent!=='rigid'&&!(intent==='hinge'&&doc.joints?.some(j=>j.bodyA===mesh.id||j.bodyB===mesh.id)))throw new Error(t`${mesh.name}: ${intent} needs a qualified mechanical model and mates. Choose rigid-preview explicitly to simulate only its rigid geometry.`);}
 if([...prepared.values()].reduce((sum,p)=>sum+p.hulls.length,0)>4096)throw new Error(t('Simulation scene exceeds the 4096-convex-piece budget'));
 const J=options.J??await(modulePromise??=import('jolt-physics/wasm-compat').then(module=>module.default()));
 const settings=new J.JoltSettings();settings.mMaxBodies=512;settings.mMaxBodyPairs=Math.max(1024,meshes.length*meshes.length);settings.mMaxContactConstraints=8192;
 const pairs=new J.ObjectLayerPairFilterTable(2);pairs.EnableCollision(0,1);pairs.EnableCollision(1,1);
 const broad=new J.BroadPhaseLayerInterfaceTable(2,2);const staticLayer=new J.BroadPhaseLayer(0),dynamicLayer=new J.BroadPhaseLayer(1);broad.MapObjectToBroadPhaseLayer(0,staticLayer);broad.MapObjectToBroadPhaseLayer(1,dynamicLayer);J.destroy(staticLayer);J.destroy(dynamicLayer);
 settings.mObjectLayerPairFilter=pairs;settings.mBroadPhaseLayerInterface=broad;settings.mObjectVsBroadPhaseLayerFilter=new J.ObjectVsBroadPhaseLayerFilterTable(broad,2,pairs,2);
 const world=new J.JoltInterface(settings);J.destroy(settings);const system=world.GetPhysicsSystem(),bodies=system.GetBodyInterface();const gravity=new J.Vec3(0,0,-9.81);system.SetGravity(gravity);J.destroy(gravity);
 const tuning=new J.PhysicsSettings();tuning.mDeterministicSimulation=true;tuning.mUseBodyPairContactCache=false;tuning.mAllowSleeping=false;tuning.mManifoldTolerance=.00001;tuning.mContactPointPreserveLambdaMaxDistSq=.00000001;tuning.mPenetrationSlop=.00002;tuning.mSpeculativeContactDistance=.0001;tuning.mMinVelocityForRestitution=.1;tuning.mNumVelocitySteps=20;tuning.mNumPositionSteps=8;system.SetPhysicsSettings(tuning);J.destroy(tuning);
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
  try{const body=bodies.CreateBody(bc);if(!body)throw new Error(t('Jolt body allocation failed'));bodies.AddBody(body.GetID(),motion==='static'?J.EActivation_DontActivate:J.EActivation_Activate);ownedBodies.push(body);byId.set(id,body);}finally{J.destroy(bc);}
 };
 function dispose(){if(disposed)return;disposed=true;for(const c of constraints.values()){system.RemoveConstraint(c);c.Release();}for(const body of ownedBodies){bodies.RemoveBody(body.GetID());bodies.DestroyBody(body.GetID());}J.destroy(world);}
 try {
  if(options.ground!==false){const ext=new J.Vec3(2,2,.005),shape=new J.BoxShape(ext,.0001);J.destroy(ext);add(shape,'ground','static',{friction:.4,restitution:.05});const p=new J.RVec3(0,0,-.005);bodies.SetPosition(byId.get('ground').GetID(),p,J.EActivation_DontActivate);J.destroy(p);}
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
   const cs=joint.kind==='hinge'?new J.HingeConstraintSettings():new J.FixedConstraintSettings();cs.mSpace=J.EConstraintSpace_WorldSpace;const temporaries:any[]=[];const point=(p:number[])=>{const v=new J.RVec3(...p);temporaries.push(v);return v;};const vector=(p:number[])=>{const v=new J.Vec3(...p);temporaries.push(v);return v;};cs.mPoint1=point(fa.p);cs.mPoint2=point(fb.p);
   if(joint.kind==='hinge'){cs.mHingeAxis1=vector(fa.z);cs.mHingeAxis2=vector(fb.z);cs.mNormalAxis1=vector(fa.n);cs.mNormalAxis2=vector(fb.n);if(joint.limits){cs.mLimitsMin=joint.limits[0];cs.mLimitsMax=joint.limits[1];}}else{cs.mAutoDetectPoint=false;cs.mAxisX1=vector(fa.z);cs.mAxisX2=vector(fb.z);cs.mAxisY1=vector(fa.n);cs.mAxisY2=vector(fb.n);}
   const constraint=cs.Create(a,b);constraint.AddRef();system.AddConstraint(constraint);constraints.set(joint.id,constraint);temporaries.forEach(v=>J.destroy(v));J.destroy(cs);
  }
  system.OptimizeBroadPhase();
 }catch(e){dispose();throw e;}
 return {
  step(seconds=1/200){if(disposed)throw new Error(t('Physics world was disposed'));if(!Number.isFinite(seconds)||seconds<=0||seconds>.1||Math.abs(seconds*200-Math.round(seconds*200))>1e-8)throw new Error(t('Step must be a positive multiple of 1/200 s, at most 0.1 s'));for(let i=0;i<Math.round(seconds*200);i++){world.Step(1/200,1);elapsed+=1/200;}},
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
  hingeAngle(id:string){if(disposed)throw new Error(t('Physics world was disposed'));const joint=doc.joints?.find(j=>j.id===id);if(joint?.kind!=='hinge')throw new Error(t('Unknown hinge joint'));return J.castObject(constraints.get(id),J.HingeConstraint).GetCurrentAngle();},
  dispose,
 };
}
