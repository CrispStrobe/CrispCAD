// SPDX-License-Identifier: BSD-3-Clause
// Mechanism check: sweeps one joint (and the gears it turns through gear meshes) through its range
// and measures every pair of bodies at each sampled pose with Manifold, so collisions and
// interference along the travel are found, not only at rest. Original code; the rules (rest pose
// kept apart from the sweep, jointed pairs exempt, sampled poses never claimed as continuous proof)
// follow the kernel lab's mechanism-validation guide.
import {MECHANISM_LIMITS,activeRoots,applyMotion,jointedPairs,pairKey,planMechanism,mechanismPose,sweepValues,t} from '@brickwright/cad-core';
import type {CadDocument,MechanismCollision,MechanismReport,MechanismSettings} from '@brickwright/cad-core';
import type {BodyMesh,GeometryResult} from '../kernel.js';

type Interference=(bodies:readonly BodyMesh[],options:{minVolumeMm3?:number;clearanceMm?:number})=>{interfering:{a:string;b:string;volumeMm3:number}[];closerThanClearance:{a:string;b:string;gapMm:number}[]};

function moved(body:BodyMesh,motion:readonly number[]):BodyMesh{
 const positions=new Float32Array(body.positions.length),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<positions.length;i+=3){
  const p=applyMotion(motion,[body.positions[i],body.positions[i+1],body.positions[i+2]]);
  for(let k=0;k<3;k++){positions[i+k]=p[k];if(p[k]<min[k])min[k]=p[k];if(p[k]>max[k])max[k]=p[k];}
 }
 return {...body,positions,bounds:{min,max}};
}

/**
 * Sweeps `settings.joint` through its range (its limits, a full turn for a hinge without limits,
 * or `settings.range`) in `settings.steps` steps. Pairs a joint connects are exempt (they touch by
 * design) unless the joint sets `collideConnected`. Reference helpers and hole bodies are not
 * checked. `interference` is the geometry kernel's pairwise Manifold intersection.
 */
export function checkMechanism(interference:Interference,doc:CadDocument,geometry:GeometryResult,settings:MechanismSettings,signal?:AbortSignal):MechanismReport{
 const plan=planMechanism(doc,settings.joint,settings.range);
 const active=new Set(activeRoots(doc));
 const bodies=geometry.bodies.filter(b=>active.has(b.id)&&!b.reference&&!b.hole&&b.indices.length);
 if(bodies.length>MECHANISM_LIMITS.maxBodies)throw new Error(t`The mechanism check is limited to ${MECHANISM_LIMITS.maxBodies} bodies`);
 const exempt=jointedPairs(doc),names=new Map(bodies.map(b=>[b.id,b.name]));
 const movingIds=new Set([...plan.moving,...plan.coupled.flatMap(c=>c.moving)]);
 // Only pairs with a moving body can change between poses; the rest are checked once, at rest.
 const values=sweepValues(plan.range,settings.steps??MECHANISM_LIMITS.defaultSteps);
 const collisions=new Map<string,MechanismCollision>(),near=new Map<string,MechanismReport['near'][number]>();
 let skipped=0;
 for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)if(exempt.has(pairKey(bodies[i].id,bodies[j].id)))skipped++;
 const record=(value:number,rest:boolean,result:ReturnType<Interference>,onlyMoving:boolean)=>{
  for(const hit of result.interfering){
   const key=pairKey(hit.a,hit.b);if(exempt.has(key))continue;
   if(onlyMoving&&!movingIds.has(hit.a)&&!movingIds.has(hit.b))continue;
   const previous=collisions.get(key);
   if(previous){previous.firstAt=Math.min(previous.firstAt,value);previous.lastAt=Math.max(previous.lastAt,value);previous.poses++;previous.maxVolumeMm3=Math.max(previous.maxVolumeMm3,hit.volumeMm3);previous.atRest||=rest;}
   else collisions.set(key,{a:hit.a,b:hit.b,aName:names.get(hit.a)??hit.a,bName:names.get(hit.b)??hit.b,firstAt:value,lastAt:value,poses:1,maxVolumeMm3:hit.volumeMm3,atRest:rest});
  }
  for(const hit of result.closerThanClearance){
   const key=pairKey(hit.a,hit.b);if(exempt.has(key)||collisions.has(key))continue;
   if(onlyMoving&&!movingIds.has(hit.a)&&!movingIds.has(hit.b))continue;
   const previous=near.get(key);
   if(!previous||hit.gapMm<previous.gapMm)near.set(key,{a:hit.a,b:hit.b,aName:names.get(hit.a)??hit.a,bName:names.get(hit.b)??hit.b,at:value,gapMm:hit.gapMm});
  }
 };
 const options={minVolumeMm3:settings.minVolumeMm3??1e-3,...(settings.clearanceMm?{clearanceMm:settings.clearanceMm}:{})};
 // Rest pose: every pair.
 record(0,true,interference(bodies,options),false);
 for(const value of values){
  signal?.throwIfAborted();
  if(Math.abs(value)<1e-12)continue;
  const pose=mechanismPose(doc,plan,value);
  const posed=bodies.map(b=>{const m=pose.get(b.id);return m?moved(b,m):b;});
  record(value,false,interference(posed,options),true);
 }
 const list=[...collisions.values()];
 for(const key of collisions.keys())near.delete(key);
 return {
  joint:plan.joint.id,jointName:`${plan.joint.kind} ${names.get(plan.joint.bodyA)??plan.joint.bodyA} – ${names.get(plan.joint.bodyB)??plan.joint.bodyB}`,
  unit:plan.unit,range:plan.range,samples:values.length,moving:plan.moving,
  coupled:plan.coupled.map(c=>({joint:c.joint.id,ratio:c.ratio})),
  collisions:list,near:[...near.values()],skippedPairs:skipped,clear:!list.length,
 };
}
