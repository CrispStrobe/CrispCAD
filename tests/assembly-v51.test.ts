// SPDX-License-Identifier: BSD-3-Clause
// Assemblies, document version 51 (convergence Phase 6.4 gaps): linked instances that share their
// part's definition, mates between named faces solved into placements (with stale references and
// over-constrained sets refused), the planetary set with a turning carrier, and exact edges on
// exploded drawing sheets.
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {MateError,compileModelSource,configuredDocument,createCadSession,createCommandJournal,createCommandRunner,createDocument,createPlanetaryDocument,explodedExactDrawing,generateModelSource,identityTransform,mechanismPose,parseDocument,planMechanism,planetaryLayout,serializeDocument,setLocale,solveMates,validateDocument} from '@brickwright/cad-core';
import type {AssemblyHost,CadDocument,ExactCommandHost,ExactDrawingData,MateBodyFaces,MateFaceGeometry,RigidMotion} from '@brickwright/cad-core';
import {checkMechanism,createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,exactKernelIdentity,runExactRequest} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';
import {appendPortableRevision,readPortableHistory} from '@brickwright/cad-history';
import {createPhysicsWorld,prepareDocumentCollisions} from '@brickwright/cad-physics';

vi.setConfig({testTimeout:240_000});
let exact:ExactBackend,manifold:GeometryKernel;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},240_000);
afterAll(()=>setLocale('en'));
const host:ExactCommandHost={run:async request=>runExactRequest(exact,request)};
const kernels=[exactKernelIdentity];
const assemblyHost=():AssemblyHost=>({
 bounds:async doc=>manifold.evaluate(doc).bodies.map(b=>({id:b.id,bounds:b.bounds})),
 mechanism:async (doc,settings)=>checkMechanism((bodies,options)=>manifold.interference(bodies,options),doc,manifold.evaluate(doc),settings),
});
const body=(doc:CadDocument,id:string)=>{const b=manifold.evaluate(doc).bodies.find(x=>x.id===id)!;return {volume:b.volume,min:b.bounds.min.map(v=>+v.toFixed(6)),max:b.bounds.max.map(v=>+v.toFixed(6))};};
const close=(a:readonly number[],b:readonly number[],digits=6)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],digits));
const faces=async(doc:CadDocument,id:string):Promise<MateBodyFaces>=>{const r=await host.run({operation:'faces',document:doc,bodies:[id]});if(r.operation!=='faces')throw new Error('faces');return r.bodies[0];};
/** 1-based number of the face matching `test` in the `mate faces` listing. */
const faceNumber=async(doc:CadDocument,id:string,test:(f:MateFaceGeometry)=>boolean)=>{const list=(await faces(doc,id)).faces,i=list.findIndex(test);if(i<0)throw new Error('no such face');return i+1;};
const facing=(n:readonly number[])=>(f:MateFaceGeometry)=>f.surface==='plane'&&n.every((v,i)=>Math.abs(f.normal[i]-v)<1e-6);
const bracket=()=>{
 const s=createCadSession(createDocument('Linked'));
 const part=s.add({kind:'box',size:[20,10,5]},{name:'Bracket',transform:{...identityTransform(),position:[0,0,2.5]}});
 return {s,part};
};

describe('linked instances',()=>{
 it('places instances at document version 51 that follow every edit of the part, not its placement',()=>{
  const {s,part}=bracket(),before=s.state.document.version;
  expect(before).toBeLessThan(51);
  const [a,b]=s.addInstances(part,[{position:[40,0,2.5],rotation:[0,0,90]},{position:[0,40,2.5],rotation:[90,0,0]}]);
  let doc=s.state.document;
  expect(doc.version).toBe(51);
  expect(doc.nodes[a]).toMatchObject({kind:'instance',instanceVersion:1,source:part,name:'Bracket instance',transform:{scale:[1,1,1]}});
  expect(doc.nodes[b].name).toBe('Bracket instance 2');
  // One definition: no copy of the box is stored.
  expect(Object.values(doc.nodes).filter(n=>n.kind==='box')).toHaveLength(1);
  expect(body(doc,a)).toMatchObject({min:[35,-10,0],max:[45,10,5]});
  expect(body(doc,a).volume).toBeCloseTo(1000,6);
  expect(body(doc,b)).toMatchObject({min:[-10,37.5,-2.5],max:[10,42.5,7.5]});
  // Editing the part changes every instance; moving the part moves only the part.
  s.update(part,{size:[30,10,5]} as never);
  s.transform([{id:part,transform:{position:[5,5,2.5],rotation:[0,0,30],scale:[1,1,2]}}]);
  doc=s.state.document;
  expect(body(doc,a).volume).toBeCloseTo(3000,6);
  expect(body(doc,a)).toMatchObject({min:[35,-15,-2.5],max:[45,15,7.5]});
  expect(body(doc,b).volume).toBeCloseTo(3000,6);
  // Undo returns to the earlier version.
  s.undo();s.undo();s.undo();
  expect(s.state.document.version).toBe(before);
  expect(s.state.document.roots).toEqual([part]);
 });
 it('refuses scaled instances, instances as operands, chains and version 50 documents',()=>{
  const {s,part}=bracket(),[a]=s.addInstances(part,[{position:[30,0,2.5],rotation:[0,0,0]}]);
  const doc=s.state.document;
  expect(()=>s.transform([{id:a,transform:{...doc.nodes[a].transform,scale:[2,2,2]}}])).toThrow(/scaled; scale its source/);
  expect(()=>s.combine('union',[part,a])).toThrow(/must stay a top-level body|cannot be an operand/);
  const chained=structuredClone(doc) as CadDocument;chained.nodes[part]={...chained.nodes[a],id:part,source:a} as never;
  expect(()=>validateDocument(chained)).toThrow();
  const old=structuredClone(doc) as CadDocument;old.version=50;
  expect(()=>validateDocument(old)).toThrow(/document version 51/);
  // An instance of an instance links to the part itself.
  const [c]=s.addInstances(a,[{position:[60,0,2.5],rotation:[0,0,0]}]);
  expect((s.state.document.nodes[c] as {source:string}).source).toBe(part);
 });
 it('saves and loads; model source and the history archive keep instances; older documents open unchanged',async()=>{
  const {s,part}=bracket();s.addInstances(part,[{position:[30,0,2.5],rotation:[0,0,45]}]);
  const doc=s.state.document,text=serializeDocument(doc);
  expect(parseDocument(text)).toEqual(doc);
  expect(serializeDocument(parseDocument(text))).toBe(text);
  const source=generateModelSource(doc);
  expect(source).toMatch(/instance\("[\w-]+", \{/);
  expect(validateDocument(compileModelSource(source,doc)).nodes).toEqual(doc.nodes);
  const archive=await appendPortableRevision(undefined,doc,'Linked');
  const back=await readPortableHistory(archive);
  expect(back.readDocument(back.project.headId).nodes).toEqual(doc.nodes);
  // A version 50 document (the planetary preset) round-trips byte for byte and keeps its version.
  const planetary=createPlanetaryDocument(),saved=serializeDocument(planetary);
  expect(planetary.version).toBe(50);
  expect(serializeDocument(parseDocument(saved))).toBe(saved);
  expect(createCadSession(parseDocument(saved)).state.document.version).toBe(50);
 });
 it('follows the part through a fillet and a cut made on it; deleting or combining it leaves copies',async()=>{
  const {s:plain,part}=bracket(),s=createCadSession(plain.state.document,{kernels}),runner=createCommandRunner(s,{exact:host});
  const [a]=s.addInstances(part,[{position:[40,0,2.5],rotation:[0,0,90]}]);
  const placed=body(s.state.document,a);
  await runner.runAsync(`fillet 1 ${part}`);
  let doc=s.state.document;
  const fillet=doc.roots.find(id=>doc.nodes[id].kind==='exact-feature')!;
  expect((doc.nodes[a] as {source:string}).source).toBe(fillet);
  expect(body(doc,a).volume).toBeCloseTo(body(doc,fillet).volume,5);
  expect(body(doc,a).volume).toBeLessThan(1000);
  close(body(doc,a).min,placed.min,5);close(body(doc,a).max,placed.max,5);
  // A hole cut into the part (it is the first operand of the subtraction).
  const cutter=s.add({kind:'cylinder',radius:2,height:20,segments:48},{name:'Cutter',transform:{...identityTransform(),position:[5,0,0]}});
  s.combine('subtract',[fillet,cutter]);
  doc=s.state.document;
  const cut=doc.roots.find(id=>doc.nodes[id].kind==='boolean')!;
  expect((doc.nodes[a] as {source:string}).source).toBe(cut);
  expect(body(doc,a).volume).toBeCloseTo(body(doc,cut).volume,4);
  close(body(doc,a).min,placed.min,4);close(body(doc,a).max,placed.max,4);
  // The exact kernel builds the instance from the part's B-rep.
  const measured=await host.run({operation:'measure',document:doc,bodies:[cut,a]});
  if(measured.operation!=='measure')throw new Error('measure');
  expect(measured.bodies[1].volume).toBeCloseTo(measured.bodies[0].volume,6);
  const step=await host.run({operation:'export-step',document:doc,bodies:[cut,a]});
  expect(step.operation==='export-step'&&step.bodies).toHaveLength(2);
  // Deleting the part leaves the instance as an independent copy, same shape and place; Undo relinks.
  const volume=body(doc,a).volume;
  s.remove([cut]);
  doc=s.state.document;
  expect(doc.nodes[a].kind).toBe('boolean');
  expect(doc.roots).toEqual([a]);
  expect(body(doc,a).volume).toBeCloseTo(volume,6);
  close(body(doc,a).min,placed.min,4);
  s.undo();
  expect(s.state.document.nodes[a].kind).toBe('instance');
  // Combining the part with something else: the instance keeps the old shape.
  const other=s.add({kind:'box',size:[2,2,2]},{name:'Tab',transform:{...identityTransform(),position:[0,0,6]}});
  s.combine('union',[cut,other]);
  expect(s.state.document.nodes[a].kind).toBe('boolean');
  expect(body(s.state.document,a).volume).toBeCloseTo(volume,6);
 });
 it('copies: an instance alone becomes an independent copy, with its part it stays linked',()=>{
  const {s,part}=bracket(),[a]=s.addInstances(part,[{position:[30,0,2.5],rotation:[0,0,0]}]);
  const alone=s.fragment([a]);
  expect(Object.values(alone.nodes).some(n=>n.kind==='instance')).toBe(false);
  expect(Object.values(alone.nodes)).toHaveLength(1);
  const both=s.fragment([part,a]);
  s.insert(both,[0,50,0]);
  const doc=s.state.document,pasted=doc.roots.slice(2);
  expect(doc.nodes[pasted[1]].kind).toBe('instance');
  expect((doc.nodes[pasted[1]] as {source:string}).source).toBe(pasted[0]);
  s.duplicate([a]);
  const copy=s.state.document.roots.at(-1)!;
  expect(s.state.document.nodes[copy]).toMatchObject({kind:'instance',source:part});
 });
 it('runs instance and unlink from the terminal with journal lines; suppressing the part keeps its instances',()=>{
  const {s,part}=bracket(),journal=createCommandJournal(s,{kernels}),runner=createCommandRunner(s,{journal});
  const done=runner.run('instance Bracket count 2 step 30,0,0 rotate 0,0,90');
  expect(done.invocation).toBe(`instance ${part} count 2 step 30,0,0 rotate 0,0,90`);
  expect(done.output).toMatch(/Placed 2 linked instances of Bracket/);
  const [a,b]=s.state.document.roots.slice(1);
  expect(body(s.state.document,b)).toMatchObject({min:[55,-10,0],max:[65,10,5]});
  s.setSuppressed([part],true);
  const built=manifold.evaluate(s.state.document);
  expect(built.bodies.map(x=>x.id)).toEqual([a,b]);
  const configured=configuredDocument(s.state.document);
  expect(configured.roots).toEqual([a,b]);
  expect(validateDocument(configured).nodes[a].kind).toBe('box');
  s.setSuppressed([part],false);
  expect(runner.run(`unlink ${a}`).output).toMatch(/Unlinked 1 instances/);
  expect(s.state.document.nodes[a].kind).toBe('box');
  expect(journal.entries.map(e=>e.invocation).filter(Boolean)).toEqual([`instance ${part} count 2 step 30,0,0 rotate 0,0,90`,`unlink ${a}`]);
  expect(() => runner.run('unlink Bracket')).toThrow(/Select linked instances/);
 });
});

describe('mates',()=>{
 const rig=()=>{
  const s=createCadSession(createDocument('Mates'));
  const block=s.add({kind:'box',size:[40,40,10]},{name:'Block',transform:{...identityTransform(),position:[0,0,5]}});
  const bore=s.add({kind:'cylinder',radius:3,height:20,segments:48},{name:'Bore',transform:{...identityTransform(),position:[10,5,5]}});
  s.combine('subtract',[block,bore]);
  const base=s.state.document.roots[0];s.update(base,{name:'Base'});
  const lid=s.add({kind:'box',size:[40,40,4]},{name:'Lid',transform:{...identityTransform(),position:[70,-20,30],rotation:[20,-35,10]}});
  const pin=s.add({kind:'cylinder',radius:3,height:20,segments:48},{name:'Pin',transform:{...identityTransform(),position:[-60,20,15],rotation:[50,0,30]}});
  return {s,base,lid,pin,bore};
 };
 it('solves coincident, concentric and distance mates into placements, one Undo step each, at version 51',async()=>{
  const {s,base,lid,pin}=rig(),journal=createCommandJournal(s,{kernels}),runner=createCommandRunner(s,{exact:host,journal});
  const before=s.state.document.version;
  const listed=await runner.runAsync('mate faces Base');
  expect(listed.output).toMatch(/Base \([\w-]+\): 7 faces/);
  expect(listed.output).toMatch(/cylinder/);
  const top=await faceNumber(s.state.document,base,facing([0,0,1])),under=await faceNumber(s.state.document,lid,f=>f.surface==='plane'&&f.area>1000&&f.normal[2]<-.5);
  const first=await runner.runAsync(`mate coincident Base ${top} Lid ${under}`);
  expect(first.output).toMatch(/1 mates hold; 1 bodies moved: Lid/);
  expect(first.output).toMatch(/3 degrees of freedom are left/);
  expect(first.invocation).toMatch(/^mate coincident [\w-]+ [\w-]+:f1 [\w-]+ [\w-]+:f0$/);
  let doc=s.state.document;
  expect(doc.version).toBe(51);
  // The lid's underside now lies on the base's top face, facing it.
  const moved=(await faces(doc,lid)).faces.find(f=>f.name===doc.assembly!.mates![0].b.face)!;
  close(moved.normal,[0,0,-1],9);expect(moved.point[2]).toBeCloseTo(10,9);
  // Pin in the bore, its top 3 mm above the lid's top (planar faces pointing the same way).
  const bore=await faceNumber(doc,base,f=>f.surface==='cylinder'),side=await faceNumber(doc,pin,f=>f.surface==='cylinder');
  await runner.runAsync(`mate concentric Base ${bore} Pin ${side}`);
  doc=s.state.document;
  const lidTop=await faceNumber(doc,lid,f=>f.surface==='plane'&&f.area>1000&&f.normal[2]>.5),pinCaps=(await faces(doc,pin)).faces.filter(f=>f.surface==='plane');
  const cap=pinCaps.reduce((a,b)=>a.normal[2]>b.normal[2]?a:b);
  const third=await runner.runAsync(`mate distance 3 Lid ${lidTop} Pin ${cap.name} aligned`);
  expect(third.output).toMatch(/3 mates hold/);
  doc=s.state.document;
  const pinBox=body(doc,pin);
  close([(pinBox.min[0]+pinBox.max[0])/2,(pinBox.min[1]+pinBox.max[1])/2],[10,5],5);
  expect(pinBox.max[2]).toBeCloseTo(17,5);expect(pinBox.min[2]).toBeCloseTo(-3,5);
  expect(body(doc,base)).toMatchObject({min:[-20,-20,0],max:[20,20,10]});
  // Saved, loaded and listed.
  expect(parseDocument(serializeDocument(doc)).assembly!.mates).toEqual(doc.assembly!.mates);
  expect((await runner.runAsync('mate')).output).toMatch(/^1\. coincident: Base [\w-]+:f1 – Lid [\w-]+:f0/);
  expect(journal.entries.map(e=>e.invocation)).toEqual(doc.assembly!.mates!.map(m=>expect.stringMatching(new RegExp(`^mate ${m.kind}.* ${m.a.face} .* ${m.b.face}`))));
  // mate solve after moving the pin by hand puts it back.
  s.transform([{id:pin,transform:{...doc.nodes[pin].transform,position:[0,0,50]}}]);
  expect((await runner.runAsync('mate solve')).output).toMatch(/3 mates hold; 1 bodies moved: Pin/);
  expect(body(s.state.document,pin).max[2]).toBeCloseTo(17,5);
  // Each mate is one Undo step together with the placements it solved.
  s.undo();s.undo();
  expect(s.state.document.assembly!.mates).toHaveLength(3);
  s.undo();
  expect(s.state.document.assembly!.mates).toHaveLength(2);
  s.undo();s.undo();
  expect(s.state.document.assembly?.mates).toBeUndefined();
  expect(s.state.document.version).toBe(before);
  expect(body(s.state.document,lid).max[2]).toBeGreaterThan(20);
 });
 it('refuses over-constrained mates, naming the mate, and moves nothing',async()=>{
  const {s,base,lid}=rig(),runner=createCommandRunner(s,{exact:host});
  const top=await faceNumber(s.state.document,base,facing([0,0,1])),under=await faceNumber(s.state.document,lid,f=>f.surface==='plane'&&f.area>1000&&f.normal[2]<-.5);
  await runner.runAsync(`mate coincident Base ${top} Lid ${under}`);
  const revision=s.state.revision;
  await expect(runner.runAsync(`mate distance 5 Base ${top} Lid ${under}`)).rejects.toThrow(/Mate 2 \(distance\) conflicts with the mates before it: they cannot all hold \(over-constrained/);
  await expect(runner.runAsync(`mate coincident Base ${top} Lid ${under}`)).rejects.toThrow(/Mate 2 \(coincident\) adds nothing the other mates do not already fix \(over-constrained\)/);
  // Two parallel planes at different distances from one face.
  const bottom=await faceNumber(s.state.document,base,facing([0,0,-1]));
  await expect(runner.runAsync(`mate distance 2 Base ${bottom} Lid ${under} aligned`)).rejects.toThrow(/over-constrained/);
  expect(s.state.revision).toBe(revision);
 });
 it('reports a stale face reference instead of binding another face; refuses faces of the wrong kind',async()=>{
  const {s,base,pin,bore}=rig(),runner=createCommandRunner(s,{exact:host});
  const hole=await faceNumber(s.state.document,base,f=>f.surface==='cylinder'),side=await faceNumber(s.state.document,pin,f=>f.surface==='cylinder');
  await runner.runAsync(`mate concentric Base ${hole} Pin ${side}`);
  const holeFace=s.state.document.assembly!.mates![0].a.face;
  expect(holeFace.startsWith(bore+':')).toBe(true);
  // Move the bore out of the block: the hole and its face are gone; the cut still has faces.
  s.transform([{id:bore,transform:{...s.state.document.nodes[bore].transform,position:[100,0,5]}}]);
  const revision=s.state.revision;
  await expect(runner.runAsync('mate solve')).rejects.toThrow(new RegExp(`Mate 1 \\(concentric\\): Base has no face ${holeFace} any more`));
  expect(s.state.revision).toBe(revision);
  // Every mate is solved again with a new one, so the stale one goes first.
  await expect(runner.runAsync(`mate concentric Base 1 Pin ${side}`)).rejects.toThrow(/has no face .* any more/);
  await runner.runAsync('mate delete 1');
  const flat=await faceNumber(s.state.document,base,facing([0,0,1]));
  await expect(runner.runAsync(`mate concentric Base ${flat} Pin ${side}`)).rejects.toThrow(/is a plane, not a face with an axis/);
  await expect(runner.runAsync(`mate coincident Base ${flat} Pin 99`)).rejects.toThrow(/Pin has no face 99/);
  // The solver itself never matches another face: a name that is not on the body is an error.
  const mates=[{id:'m1',kind:'coincident' as const,a:{body:base,face:`${bore}:f7`},b:{body:pin,face:`${pin}:f0`}}];
  const both=[await faces(s.state.document,base),await faces(s.state.document,pin)];
  expect(()=>solveMates(s.state.document,mates,both)).toThrow(MateError);
 });
 it('mates linked instances by the faces their part names; journal replay finds the same faces',async()=>{
  const {s,base,pin}=rig(),journal=createCommandJournal(s,{kernels}),runner=createCommandRunner(s,{exact:host,journal});
  const [copy]=s.addInstances(pin,[{position:[0,-40,30],rotation:[0,90,0]}]);
  const hole=await faceNumber(s.state.document,base,f=>f.surface==='cylinder'),side=await faceNumber(s.state.document,copy,f=>f.surface==='cylinder');
  const done=await runner.runAsync(`mate concentric Base ${hole} "Pin instance" ${side}`);
  expect(done.output).toMatch(/moved: Pin instance/);
  const mate=s.state.document.assembly!.mates![0];
  expect(mate.b.face.startsWith(pin+':')).toBe(true);
  const box=body(s.state.document,copy);
  close([(box.min[0]+box.max[0])/2,(box.min[1]+box.max[1])/2],[10,5],5);
  // Unlinking renames the mate's face to the copy's own leaf.
  s.unlinkInstances([copy]);
  const after=s.state.document.assembly!.mates![0].b.face;
  expect(after.startsWith(pin+':')).toBe(false);
  expect(after.split(':')[0]).toBe(copy);
  expect((await runner.runAsync('mate solve')).output).toMatch(/1 mates hold; 0 bodies moved/);
 });
});

describe('planetary gear set with a turning carrier',()=>{
 const angle=(m:RigidMotion)=>Math.atan2(m[4],m[0])*180/Math.PI;
 it('holds the ring or the sun and turns the carrier at the Willis ratios',()=>{
  expect(planetaryLayout().speeds).toEqual({sun:1,carrier:0,ring:-1/3});
  expect(planetaryLayout({fixed:'ring'}).speeds).toEqual({sun:4,carrier:1,ring:0});
  expect(planetaryLayout({fixed:'sun',planetTeeth:18,sunTeeth:12}).speeds).toEqual({sun:0,carrier:1,ring:(12+48)/48});
  expect(()=>planetaryLayout({fixed:'planet' as never})).toThrow(/carrier, the ring or the sun/);
  for(const [fixed,sun,ring] of [['ring',4,0],['sun',0,4/3]] as const){
   const doc=createPlanetaryDocument({fixed});
   expect(doc.version).toBe(50);
   expect(doc.roots.map(id=>doc.nodes[id].name)).toEqual(['Frame','Carrier plate','Sun gear','Planet gear 1','Planet gear 2','Planet gear 3','Ring gear']);
   const named=(n:string)=>doc.roots.find(id=>doc.nodes[id].name===n)!;
   expect(doc.nodes[named('Frame')].physics!.motion).toBe('static');
   expect(doc.nodes[named('Carrier plate')].physics!.motion).toBe('dynamic');
   const carrier=doc.joints!.find(j=>j.bodyB===named('Carrier plate'))!;
   expect(carrier).toMatchObject({bodyA:named('Frame'),control:{port:'A'},gearMesh:{ratio:-1}});
   expect(doc.joints!.filter(j=>j.bodyA===named('Carrier plate'))).toHaveLength(5);
   const plan=planMechanism(doc,carrier.id);
   expect(plan.moving).toHaveLength(6);
   const pose=mechanismPose(doc,plan,10);
   expect(angle(pose.get(named('Carrier plate'))!)).toBeCloseTo(10,9);
   expect(angle(pose.get(named('Sun gear'))!)).toBeCloseTo(10*sun,9);
   expect(angle(pose.get(named('Ring gear'))!)).toBeCloseTo(10*ring,9);
   // The planets go round with the carrier: planet 1's centre moves along the circle.
   const centre=doc.nodes[named('Planet gear 1')].transform.position,m=pose.get(named('Planet gear 1'))!;
   const x=m[0]*centre[0]+m[1]*centre[1]+m[3],y=m[4]*centre[0]+m[5]*centre[1]+m[7];
   expect(Math.atan2(y,x)*180/Math.PI).toBeCloseTo(10,9);
  }
  // The carrier-held set is the one version 50 made.
  const held=createPlanetaryDocument();
  expect(held.roots).toHaveLength(6);
  expect(held.joints).toHaveLength(5);
 });
 it('meshes without tooth interference over a tooth pitch and a full carrier turn; out of phase it collides',async()=>{
  for(const fixed of ['ring','sun'] as const){
   const doc=createPlanetaryDocument({fixed}),carrier=doc.joints!.find(j=>j.control?.port==='A')!;
   const fine=await assemblyHost().mechanism(doc,{joint:carrier.id,range:[0,30],steps:12});
   expect(fine.collisions).toEqual([]);
   expect(fine.coupled).toHaveLength(5);
   const turn=await assemblyHost().mechanism(doc,{joint:carrier.id,steps:24});
   expect(turn.clear).toBe(true);
   const bad=structuredClone(doc) as CadDocument;
   for(const id of bad.roots)if(bad.nodes[id].name.startsWith('Planet'))bad.nodes[id].transform.rotation[2]+=15;
   const clash=await assemblyHost().mechanism(validateDocument(bad),{joint:carrier.id,range:[0,0],steps:1});
   expect(clash.collisions.length).toBeGreaterThanOrEqual(3);
  }
 });
 it('inserts from the terminal; the simulation refuses a turning carrier rather than turn it wrongly',async()=>{
  const s=createCadSession(createDocument('Bench')),runner=createCommandRunner(s);
  expect(runner.run('planetary').invocation).toBe('planetary sun 12 planet 12 planets 3 module 2 width 6 backlash 0.2');
  s.undo();
  const done=runner.run('planetary fixed ring');
  expect(done.invocation).toBe('planetary sun 12 planet 12 planets 3 module 2 width 6 backlash 0.2 fixed ring');
  expect(done.output).toMatch(/the sun runs at 4 × the carrier: the carrier turns at 0.25 × the sun/);
  expect(()=>runner.run('planetary fixed planet')).toThrow(/fixed carrier\|ring\|sun/);
  const doc=s.state.document,geometry=manifold.evaluate(doc),prepared=await prepareDocumentCollisions(doc,geometry,manifold);
  await expect(createPhysicsWorld(doc,geometry,prepared,{ground:false})).rejects.toThrow(/turning carrier cannot be simulated yet/);
 },600_000);
});

describe('exploded drawings with exact edges',()=>{
 it('moves each body\'s B-rep edges, faces and mesh by its exploded offset',async()=>{
  const s=createCadSession(createDocument('Stack'));
  const a=s.add({kind:'box',size:[10,10,10]},{name:'Lower',transform:{...identityTransform(),position:[0,0,5]}});
  const b=s.add({kind:'cylinder',radius:4,height:6,segments:48},{name:'Upper',transform:{...identityTransform(),position:[0,0,13]}});
  const drawn=await host.run({operation:'drawing',document:s.state.document,bodies:[]});
  if(drawn.operation!=='drawing')throw new Error('drawing');
  const data:ExactDrawingData={bodies:drawn.bodies,failures:drawn.failures};
  const moved=explodedExactDrawing(data,new Map([[b,[0,0,20]]]));
  const before=data.bodies.find(x=>x.id===b)!,after=moved.bodies.find(x=>x.id===b)!;
  expect(moved.bodies.find(x=>x.id===a)).toBe(data.bodies.find(x=>x.id===a));
  expect(after.bounds.min[2]).toBeCloseTo(before.bounds.min[2]+20,9);
  expect(after.mesh.positions[2]).toBeCloseTo(before.mesh.positions[2]+20,9);
  expect(after.edges[0].points[2]).toBeCloseTo(before.edges[0].points[2]+20,9);
  const circle=after.edges.find(e=>e.circle)!,original=before.edges[after.edges.indexOf(circle)];
  expect(circle.circle!.center[2]).toBeCloseTo(original.circle!.center[2]+20,9);
  expect(after.faces[0].point[2]).toBeCloseTo(before.faces[0].point[2]+20,9);
  expect(explodedExactDrawing(data,new Map())).toBe(data);
 });
});

describe('German',()=>{
 it('translates mates, instances and the turning carrier',async()=>{
  setLocale('de');
  try{
   const {s,part}=bracket(),runner=createCommandRunner(s,{exact:host});
   expect(runner.run('instance Bracket').output).toMatch(/verknüpfte Instanzen von Bracket platziert/);
   expect(runner.run('mate').output).toMatch(/Keine Verknüpfungen/);
   const other=s.add({kind:'box',size:[5,5,5]},{name:'Cap',transform:{...identityTransform(),position:[0,30,2.5]}});
   const top=await faceNumber(s.state.document,part,facing([0,0,1])),bottom=await faceNumber(s.state.document,other,facing([0,0,-1]));
   expect((await runner.runAsync(`mate coincident Bracket ${top} Cap ${bottom}`)).output).toMatch(/1 Verknüpfungen gelten; 1 Körper bewegt: Cap/);
   await expect(runner.runAsync(`mate coincident Bracket ${top} Cap ${bottom}`)).rejects.toThrow(/Verknüpfung 2 \(deckungsgleich\) legt nichts fest/);
   expect(runner.run('planetary fixed sun').output).toMatch(/Bei festem Sonnenrad dreht sich der Steg/);
  }finally{setLocale('en');}
 });
});

describe('MCP',()=>{
 it('places instances and mates in cad_run_commands and reads them in cad_assembly',async()=>{
  const {createCodeHost}=await import('../apps/mcp/host.mjs');
  const mcp=await createCodeHost();
  try{
   const {revision}=await mcp.call('cad_get_model');
   const run=await mcp.call('cad_run_commands',{commands:'box 20,20,10\ninstance Box count 2 step 0,0,30',expectedRevision:revision});
   expect(run.committed).toBe(true);
   const read=await mcp.call('cad_assembly',{});
   expect(read.version).toBe(51);
   expect(read.instances).toHaveLength(2);
   const box=read.instances[0].source;
   const listed=await mcp.call('cad_run_commands',{commands:`mate faces ${box}`,expectedRevision:(await mcp.call('cad_get_model')).revision});
   expect(listed.results[0].output).toMatch(/6 faces/);
   const top=/(\d+): ([\w-]+:f\d+) · plane · [\d.]+ mm² · normal \[0, 0, 1\]/.exec(listed.results[0].output)!,bottom=/(\d+): ([\w-]+:f\d+) · plane · [\d.]+ mm² · normal \[0, 0, -1\]/.exec(listed.results[0].output)!;
   const mated=await mcp.call('cad_run_commands',{commands:`mate coincident ${box} ${top[1]} "Box instance" ${bottom[1]}`,expectedRevision:(await mcp.call('cad_get_model')).revision});
   expect(mated.results[0].invocation).toBe(`mate coincident ${box} ${top[2]} ${read.instances[0].id} ${bottom[2]}`);
   expect((await mcp.call('cad_assembly',{})).mates).toHaveLength(1);
  }finally{await mcp.dispose();}
 });
});
