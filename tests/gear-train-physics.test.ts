// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,defaultPartPhysics,defaultSimulationSettings,externalCenterDistanceMm,externalSpeedRatio,identityTransform,meshAlignDeg,validateDocument} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '@brickwright/cad-physics';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const gear=(teeth:number)=>({version:1 as const,language:'brickwright-cad-script' as const,parameters:{},source:`return extrudeProfile(5, spurGear2d(2, ${teeth}, 20, 0.3));`});
const [z1,z2]=[12,24],distance=externalCenterDistanceMm(2,z1,2,z2);
function pair(){
 const s=createCadSession(),settings=defaultSimulationSettings();settings.gravity=[0,0,0];s.setSimulation(settings);
 const base=s.add({kind:'box',size:[80,40,4]},{name:'Base',transform:{...identityTransform(),position:[distance/2,0,-4]}});s.update(base,{physics:{...defaultPartPhysics(),motion:'static'}});
 const driver=s.addCode(gear(z1),'Driver'),driven=s.addCode(gear(z2),'Driven');
 s.update(driven,{transform:{...identityTransform(),position:[distance,0,0],rotation:[0,0,meshAlignDeg(z2)]}});
 const input=s.addJoint('hinge',base,driver,[0,0,2.5],[0,0,1]),output=s.addJoint('hinge',base,driven,[distance,0,2.5],[0,0,1]);
 return {s,base,driver,driven,input,output};
}
// Distance the point `c` (mm, at rest) has moved under the body's current pose.
function moved(world:Awaited<ReturnType<typeof createPhysicsWorld>>,id:string,c:number[]){const {positionMm:t,quaternion:[x,y,z,w]}=world.pose(id),uv=[y*c[2]-z*c[1],z*c[0]-x*c[2],x*c[1]-y*c[0]],uuv=[y*uv[2]-z*uv[1],z*uv[0]-x*uv[2],x*uv[1]-y*uv[0]];return Math.hypot(...c.map((v,i)=>v+2*(w*uv[i]+uuv[i])+t[i]-v));}

describe('gear meshes',()=>{
 it('drive a 12:24 spur pair at exactly −z1/z2 with the axles held',async()=>{
  const {s,driver,driven,input,output}=pair();s.meshGears(input,output,externalSpeedRatio(z1,z2));
  const doc=structuredClone(s.state.document);s.dispose();
  const geometry=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,geometry,kernel),world=await createPhysicsWorld(doc,geometry,prepared,{ground:false});
  try{
   let a0=world.hingeAngle(input),b0=world.hingeAngle(output),da=0,db=0,drift=0;
   for(let i=0;i<600;i++){world.setHingeMotor(input,2,1e-3);world.setHingeMotor(output,0,1e-4);world.step(.005);
    const a=world.hingeAngle(input),b=world.hingeAngle(output);da+=Math.atan2(Math.sin(a-a0),Math.cos(a-a0));db+=Math.atan2(Math.sin(b-b0),Math.cos(b-b0));a0=a;b0=b;
    drift=Math.max(drift,moved(world,driver,[0,0,2.5]),moved(world,driven,[distance,0,2.5]));}
   expect(da).toBeGreaterThan(4);
   expect(db/da).toBeCloseTo(-z1/z2,3);
   expect(drift).toBeLessThan(0.05);
  }finally{world.dispose();}
 },120000);

 it('are validated, copied with their partner and pruned with it',()=>{
  const {s,base,driver,driven,input,output}=pair();
  expect(()=>s.meshGears(input,input,-0.5)).toThrow();expect(()=>s.meshGears(input,output,0)).toThrow();
  s.meshGears(input,output,-0.5);expect(s.state.document.joints!.find(j=>j.id===input)!.gearMesh).toEqual({joint:output,ratio:-0.5});
  const broken=structuredClone(s.state.document);broken.joints!.find(j=>j.id===input)!.gearMesh={joint:'missing',ratio:-0.5};expect(()=>validateDocument(broken)).toThrow(/gear mesh/);
  // Copying all three bodies remaps the mesh onto the copied hinges.
  s.select([base,driver,driven]);s.duplicate();const copies=s.state.document.joints!.filter(j=>![input,output].includes(j.id));
  expect(copies).toHaveLength(2);const meshed=copies.find(j=>j.gearMesh)!;expect(copies.map(j=>j.id)).toContain(meshed.gearMesh!.joint);
  s.removeJoint(output);expect(s.state.document.joints!.find(j=>j.id===input)!.gearMesh).toBeUndefined();
  s.undo();expect(s.state.document.joints!.find(j=>j.id===input)!.gearMesh?.joint).toBe(output);
  s.unmeshGears(input);expect(s.state.document.joints!.find(j=>j.id===input)!.gearMesh).toBeUndefined();
  s.dispose();
 });
});

it('the Gear pair shape is a simulation-ready parametric mechanism',async()=>{
 const {createPresetDocument}=await import('../packages/editor/src/shapes.js');
 const doc=validateDocument(createPresetDocument('gear-pair'));
 const [input,output]=doc.joints!;expect(input.gearMesh).toEqual({joint:output.id,ratio:-0.5});
 expect(Object.values(doc.nodes).filter(n=>n.kind==='code')).toHaveLength(2);
 const geometry=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,geometry,kernel),world=await createPhysicsWorld(doc,geometry,prepared);
 try{let a0=world.hingeAngle(input.id),b0=world.hingeAngle(output.id),da=0,db=0;
  for(let i=0;i<300;i++){world.setHingeMotor(input.id,3,5e-3);world.step(.005);const a=world.hingeAngle(input.id),b=world.hingeAngle(output.id);da+=Math.atan2(Math.sin(a-a0),Math.cos(a-a0));db+=Math.atan2(Math.sin(b-b0),Math.cos(b-b0));a0=a;b0=b;}
  expect(da).toBeGreaterThan(3);expect(db/da).toBeCloseTo(-0.5,3);
 }finally{world.dispose();}
},120000);
