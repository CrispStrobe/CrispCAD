// SPDX-License-Identifier: BSD-3-Clause
// Assemblies (convergence Phase 6.4, document version 50): groups, a STEP file's product structure
// kept as groups, suppression, configurations, exploded views (also on drawing sheets), the
// mechanism check (a joint and the gears it drives swept through their range with Manifold) and
// the planetary gear preset.
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {activeRoots,configuredDocument,createCadSession,createCommandJournal,createCommandRunner,createDocument,createPlanetaryDocument,documentGeometryKey,explodeOffsets,generateModelSource,groupBodies,identityTransform,parseDocument,planetaryLayout,planMechanism,mechanismPose,applyMotion,runStepImport,serializeDocument,setLocale,stepImportGroups,validateDocument} from '@brickwright/cad-core';
import type {AssemblyHost,CadDocument,ExactCommandHost} from '@brickwright/cad-core';
import {checkMechanism,createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,exactKernelIdentity,runExactRequest} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';
import {appendPortableRevision,readPortableHistory} from '@brickwright/cad-history';

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
const boxes=()=>{
 const s=createCadSession();
 const a=s.add({kind:'box',size:[10,10,10]},{name:'Base',transform:{...identityTransform(),position:[0,0,5]}});
 const b=s.add({kind:'box',size:[10,10,10]},{name:'Lid',transform:{...identityTransform(),position:[0,0,15]}});
 const c=s.add({kind:'cylinder',radius:2,height:10,segments:48},{name:'Pin',transform:{...identityTransform(),position:[20,0,5]}});
 return {s,a,b,c};
};

describe('groups',()=>{
 it('groups bodies in one Undo step at document version 50, and older documents are unchanged',async()=>{
  const {s,a,b,c}=boxes(),before=s.state.document.version;
  expect(before).toBeLessThan(50);
  const outer=s.groupBodies('Housing',[a,b]),inner=s.groupBodies('Hardware',[c],{parent:outer});
  const doc=s.state.document;
  expect(doc.version).toBe(50);
  expect(groupBodies(doc.assembly,outer)).toEqual([a,b,c]);
  expect(doc.assembly!.groups!.find(g=>g.id===inner)!.parent).toBe(outer);
  // Save and load, model source and the history archive keep the groups.
  expect(parseDocument(serializeDocument(doc)).assembly).toEqual(doc.assembly);
  const source=createCadSession(doc);source.enableModelSource();
  const text=source.modelSource;expect(text).toContain('Housing');
  const reread=createCadSession(doc);reread.applyModelSource(text);
  expect(reread.state.document.assembly).toEqual(doc.assembly);
  const archive=await appendPortableRevision(undefined,doc,'Grouped');
  const back=await readPortableHistory(archive);
  expect(back.readDocument(back.project.headId).assembly).toEqual(doc.assembly);
  s.undo();s.undo();
  expect(s.state.document.assembly).toBeUndefined();
  expect(s.state.document.version).toBe(before);
 });
 it('drops deleted bodies from groups, and empty groups with them; a copy keeps its groups',()=>{
  const {s,a,b,c}=boxes();
  const g=s.groupBodies('Housing',[a,b]);
  s.remove([a]);
  expect(s.state.document.assembly!.groups![0].members).toEqual([b]);
  s.remove([b]);
  expect(s.state.document.assembly).toBeUndefined();
  void g;
  const t=boxes();t.s.groupBodies('Pair',[t.a,t.b]);
  const fragment=t.s.fragment([t.a,t.b,t.c]);
  expect(fragment.assembly!.groups![0].members).toEqual([t.a,t.b]);
  t.s.insert(fragment,[50,0,0]);
  const groups=t.s.state.document.assembly!.groups!;
  expect(groups).toHaveLength(2);
  expect(new Set(groups[1].members.map(id=>t.s.state.document.nodes[id].name))).toEqual(new Set(['Base 2','Lid 2']));
  expect(()=>validateDocument({...t.s.state.document,assembly:{version:1,groups:[{id:'x',name:'X',members:[t.a]},{id:'y',name:'Y',members:[t.a]}]}})).toThrow(/two groups/);
  expect(()=>validateDocument({...t.s.state.document,version:49,assembly:{version:1}})).toThrow(/version 50/);
  expect(()=>validateDocument({...t.s.state.document,assembly:{version:1,groups:[{id:'x',name:'X',members:[],parent:'y'},{id:'y',name:'Y',members:[t.a],parent:'x'}]}})).toThrow(/cycle/);
 });
 it('runs group, ungroup and groups from the terminal and records them in the journal',()=>{
  const {s}=boxes(),journal=createCommandJournal(s),runner=createCommandRunner(s,{journal});
  expect(runner.run('group "Top half" Base Lid').output).toMatch(/Grouped 2 bodies as Top half/);
  expect(runner.run('groups').output).toMatch(/▸ Top half \(2\)[\s\S]*· Base[\s\S]*· Pin/);
  const id=s.state.document.assembly!.groups![0].id;
  runner.run('ungroup "Top half"');
  expect(s.state.document.assembly).toBeUndefined();
  expect(journal.entries.map(e=>e.invocation)).toEqual([expect.stringMatching(/^group "Top half" [\w-]+ [\w-]+$/),expect.stringMatching(/^ungroup [\w-]+$/)]);
  void id;
 });
});

describe('STEP product structure',()=>{
 it('groups the bodies of an assembly as the file nests them (Adafruit MPM3610, Fusion)',async()=>{
  const session=createCadSession(undefined,{kernels});
  const bytes=readFileSync('library/sources/adafruit-electronics/4739 MPM3610 5V Buck.step');
  const done=await runStepImport(session,host,{name:'4739 MPM3610 5V Buck.step',bytes});
  const doc=session.state.document,groups=doc.assembly!.groups!;
  expect(doc.version).toBe(50);
  expect(doc.roots).toHaveLength(23);
  // The top product holds the board and every component; the IC (several bodies) is its own group.
  const top=groups.find(g=>g.parent===undefined)!;
  expect(top.name).toBe('PCB Component');
  expect(groupBodies(doc.assembly,top.id)).toHaveLength(23);
  const ic=groups.find(g=>g.name==='MPM3610:IC1')!;
  expect(ic.parent).toBe(top.id);
  expect(ic.source).toEqual({kind:'step',product:'MPM3610',instance:'MPM3610:IC1'});
  expect(ic.members.length).toBeGreaterThan(1);
  // A component of one body takes its occurrence's name instead of "Body2".
  const names=top.members.map(id=>doc.nodes[id].name);
  expect(names).toEqual(expect.arrayContaining(['Board:1','0805-NO:C1','0805-NO:C2','0603-NO:R1']));
  expect(done.output).toMatch(/Kept the file’s assembly as \d+ groups/);
  // Undo removes the bodies and the groups together.
  session.undo();
  expect(session.state.document.assembly).toBeUndefined();
 });
 it('imports a file without assemblies without groups, and builds groups from occurrence chains',async()=>{
  const session=createCadSession(undefined,{kernels});
  await runStepImport(session,host,{name:'711 DC Toy Motor.step',bytes:readFileSync('library/sources/adafruit-motors/711 DC Toy Motor/711 DC Toy Motor.step')});
  expect(session.state.document.assembly).toBeUndefined();
  expect(session.state.document.version).toBe(45);
  const o=(instance:string|null,product:string)=>({instance,product});
  const plan=stepImportGroups([
   [o(null,'panel'),o('plate','plate')],
   [o(null,'panel'),o('standoff_0','standoff')],[o(null,'panel'),o('standoff_1','standoff')],
   [o(null,'panel'),o('motor:1','motor'),o('can','can')],[o(null,'panel'),o('motor:1','motor'),o('shaft','shaft')],
  ],['plate','standoff','standoff','can','shaft']);
  expect(plan.names).toEqual(['plate','standoff_0','standoff_1','can','shaft']);
  expect(plan.groups.map(g=>[g.name,g.members,g.parent])).toEqual([['panel',[0,1,2],undefined],['motor:1',[3,4],0]]);
  expect(stepImportGroups([[o(null,'a')],[o(null,'a')]],['x','y']).groups).toEqual([]);
  expect(stepImportGroups([null,[o(null,'a'),o('b','b')]],['x','y']).groups).toEqual([]);
 });
});

describe('suppression and configurations',()=>{
 it('leaves suppressed bodies out of geometry, physics and exact export, and back in on unsuppress',async()=>{
  const {s,a,b,c}=boxes();
  s.addJoint('hinge',a,b,[0,0,10],[0,0,1]);
  const key=documentGeometryKey(s.state.document);
  s.setSuppressed([b],true);
  const doc=s.state.document;
  expect(documentGeometryKey(doc)).not.toBe(key);
  expect(activeRoots(doc)).toEqual([a,c]);
  expect(manifold.evaluate(doc).bodies.map(x=>x.id)).toEqual([a,c]);
  const configured=configuredDocument(doc);
  expect(configured.roots).toEqual([a,c]);
  expect(configured.joints).toEqual([]);
  const step=await host.run({operation:'export-step',document:doc,bodies:[]});
  expect(step.operation==='export-step'&&step.bodies.map(x=>x.id)).toEqual([a,c]);
  expect(()=>s.setSuppressed([a,c],true)).toThrow(/At least one body/);
  s.setSuppressed([b],false);
  expect(s.state.document.assembly).toBeUndefined();
  expect(documentGeometryKey(s.state.document)).toBe(key);
 });
 it('saves named parameter and suppression variants and switches between them in one Undo step each',()=>{
  const s=createCadSession();
  s.setParametric({version:1,parameters:{width:{expression:'20 mm',unit:'mm'},holes:{expression:'2',unit:'scalar'}},bindings:[]});
  const plate=s.add({kind:'box',size:[20,10,4]},{name:'Plate'});
  const cover=s.add({kind:'box',size:[20,10,1]},{name:'Cover',transform:{...identityTransform(),position:[0,0,5]}});
  s.setParametric({...s.state.document.parametric!,bindings:[{nodeId:plate,property:'width',expression:'width'}]});
  const runner=createCommandRunner(s);
  runner.run('config save Compact');
  s.setParametric({...s.state.document.parametric!,parameters:{...s.state.document.parametric!.parameters,width:{expression:'35 mm',unit:'mm'}}});
  runner.run('suppress Cover');
  runner.run('config save "Wide, open"');
  const size=()=>(s.state.document.nodes[plate] as {size:number[]}).size[0];
  expect(size()).toBe(35);
  expect(runner.run('config use Compact').output).toMatch(/Switched to the configuration Compact/);
  expect(size()).toBe(20);
  expect(activeRoots(s.state.document)).toEqual([plate,cover]);
  runner.run('config use "Wide, open"');
  expect(size()).toBe(35);
  expect(activeRoots(s.state.document)).toEqual([plate]);
  expect(runner.run('config').output).toMatch(/✓ Wide, open: width = 35 mm, holes = 2; 1 suppressed/);
  s.undo();
  expect(size()).toBe(20);
  expect(s.state.document.assembly!.active).toBe(s.state.document.assembly!.configurations![0].id);
  expect(parseDocument(serializeDocument(s.state.document)).assembly).toEqual(s.state.document.assembly);
  runner.run('config delete Compact');
  expect(s.state.document.assembly!.configurations!.map(c=>c.name)).toEqual(['Wide, open']);
  expect(()=>runner.run('config use Missing')).toThrow(/Unknown configuration/);
 });
});

describe('exploded views',()=>{
 it('plans steps from the bodies, offsets them with the slider and never moves the model',async()=>{
  const {s,a,b,c}=boxes();
  const runner=createCommandRunner(s,{assembly:assemblyHost()});
  const before=structuredClone(s.state.document.nodes);
  const done=await runner.runAsync('explode auto axis +z spacing 12');
  expect(done.invocation).toBe('explode auto axis 0,0,1 spacing 12');
  const view=s.state.document.assembly!.views![0];
  // Base and Pin share the lowest centre (Base, first in the model, stays); Pin moves 12 mm up, Lid 24.
  expect(view.steps.map(step=>step.bodies)).toEqual([[c],[b]]);
  expect(explodeOffsets(s.state.document,view.id,1).get(b)).toEqual([0,0,24]);
  expect(explodeOffsets(s.state.document,view.id,1).get(c)).toEqual([0,0,12]);
  // Steps run one after the other: at half, the first is done and the second not started.
  expect(explodeOffsets(s.state.document,view.id,.5).get(c)).toEqual([0,0,12]);
  expect(explodeOffsets(s.state.document,view.id,.5).has(b)).toBe(false);
  expect(explodeOffsets(s.state.document,view.id,.75).get(b)).toEqual([0,0,12]);
  expect(explodeOffsets(s.state.document,view.id,0).size).toBe(0);
  for(const id of [a,b,c])expect(s.state.document.nodes[id].transform).toEqual(before[id].transform);
  // Radial: every item moves away from the centre.
  await runner.runAsync('explode auto radial spacing 5 name Spread');
  const spread=s.state.document.assembly!.views!.find(v=>v.name==='Spread')!;
  expect(spread.steps).toHaveLength(3);
  expect(spread.steps.every(step=>step.distance===5)).toBe(true);
  // A group moves as a whole; steps run one after the other.
  s.groupBodies('Stack',[a,b]);
  await runner.runAsync('explode auto axis +x spacing 30 name Sideways');
  const side=s.state.document.assembly!.views!.find(v=>v.name==='Sideways')!;
  expect(side.steps).toHaveLength(1);
  expect(explodeOffsets(s.state.document,side.id,1).get(a)).toEqual(explodeOffsets(s.state.document,side.id,1).get(b));
  expect(runner.run('explode').output).toMatch(/Sideways/);
  runner.run('explode delete Spread');
  expect(s.state.document.assembly!.views!.map(v=>v.name)).toEqual(['Exploded view','Sideways']);
  expect(()=>runner.run('explode auto')).toThrow(/needs evaluated geometry/);
 });
 it('draws an assembly sheet in an exploded view (version 50) and drops it with the view',async()=>{
  const {s}=boxes();
  await createCommandRunner(s,{assembly:assemblyHost()}).runAsync('explode auto');
  const view=s.state.document.assembly!.views![0].id;
  const sheet=s.saveDrawingSheet({title:'Exploded',source:{kind:'assembly'},scale:'1:1',hiddenLines:false,explode:{view,factor:1}});
  expect(s.state.document.drawings![0].explode).toEqual({view,factor:1});
  expect(()=>validateDocument({...s.state.document,drawings:[{...s.state.document.drawings![0],explode:{view,factor:0}}]})).toThrow();
  s.removeExplodedView(view);
  expect(s.state.document.drawings!.find(d=>d.id===sheet)!.explode).toBeUndefined();
 });
});

describe('mechanism check',()=>{
 it('finds the pose range where a swinging arm hits a stop, and nothing for a clear one',async()=>{
  const s=createCadSession();
  const base=s.add({kind:'box',size:[10,10,10]},{name:'Base',transform:{...identityTransform(),position:[0,0,5]}});
  const arm=s.add({kind:'box',size:[40,4,4]},{name:'Arm',transform:{...identityTransform(),position:[25,0,12]}});
  const stop=s.add({kind:'box',size:[4,4,20]},{name:'Stop',transform:{...identityTransform(),position:[0,30,12]}});
  const hinge=s.addJoint('hinge',base,arm,[0,0,12],[0,0,1],{limits:[0,Math.PI]});
  void stop;
  const runner=createCommandRunner(s,{assembly:assemblyHost()});
  expect(runner.run('mechanism').output).toMatch(/1\. \[A\] hinge Base – Arm \(0° … 180°\)/);
  const done=await runner.runAsync('mechanism A steps 36');
  expect(done.invocation).toBe('mechanism A steps 36');
  expect(done.output).toMatch(/Collision: Arm and Stop, from 85° to 95° \(3 poses\)/);
  const report=await assemblyHost().mechanism(s.state.document,{joint:hinge,range:[0,45],steps:9});
  expect(report.clear).toBe(true);
  expect(report.skippedPairs).toBe(1);
  expect(report.samples).toBe(10);
  // The kinematics: at 90° the arm's far end is at (0, 45, 12).
  const plan=planMechanism(s.state.document,hinge),pose=mechanismPose(s.state.document,plan,90);
  applyMotion(pose.get(arm)!,[45,0,12]).forEach((v,i)=>expect(v).toBeCloseTo([0,45,12][i],9));
  expect(()=>planMechanism(s.state.document,'nope')).toThrow(/Unknown joint/);
 });
 it('refuses closed loops, fixed joints and a slider without limits',()=>{
  const {s,a,b}=boxes();
  const h=s.addJoint('hinge',a,b,[0,0,10],[0,0,1]);s.addJoint('fixed',b,a,[0,0,10],[0,0,1]);
  expect(()=>planMechanism(s.state.document,h)).toThrow(/closes a loop/);
  const t=boxes(),slider=t.s.addJoint('slider',t.a,t.b,[0,0,10],[0,0,1]),fixed=t.s.addJoint('fixed',t.a,t.c,[0,0,10],[0,0,1]);
  expect(()=>planMechanism(t.s.state.document,slider)).toThrow(/no limits/);
  expect(planMechanism(t.s.state.document,slider,[-5,5]).unit).toBe('mm');
  expect(()=>planMechanism(t.s.state.document,fixed)).toThrow(/Only hinges and sliders/);
 });
});

describe('planetary gear set',()=>{
 it('lays out sun, planets and ring with the tooth and spacing rules',()=>{
  const l=planetaryLayout();
  expect(l).toMatchObject({sun:12,planet:12,ring:36,planets:3,centreDistance:24});
  expect(l.ratio).toBeCloseTo(-1/3,12);
  expect(()=>planetaryLayout({sunTeeth:13,planets:3})).toThrow(/divisible/);
  expect(()=>planetaryLayout({sunTeeth:12,planetTeeth:30,planets:6})).toThrow(/too large to fit/);
 });
 it('meshes at rest and through a full turn of the sun; the ring turns at −zs/zr',async()=>{
  const doc=createPlanetaryDocument();
  expect(doc.version).toBe(50);
  expect(doc.roots).toHaveLength(6);
  expect(doc.assembly!.groups![0].name).toBe('Planetary gear set');
  expect(doc.assembly!.views![0].steps).toHaveLength(3);
  const sunHinge=doc.joints!.find(j=>doc.nodes[j.bodyB].name==='Sun gear')!;
  const plan=planMechanism(doc,sunHinge.id);
  const ring=plan.coupled.find(c=>doc.nodes[c.joint.bodyB].name==='Ring gear')!;
  expect(ring.ratio).toBeCloseTo(-12/36,12);
  expect(plan.coupled.filter(c=>doc.nodes[c.joint.bodyB].name.startsWith('Planet')).map(c=>c.ratio)).toEqual([-1,-1,-1]);
  // One tooth pitch of the sun in fine steps, then a full turn: no tooth interference anywhere.
  const s=createCadSession(doc);
  const fine=await assemblyHost().mechanism(s.state.document,{joint:sunHinge.id,range:[0,30],steps:12});
  expect(fine.collisions).toEqual([]);
  const turn=await assemblyHost().mechanism(s.state.document,{joint:sunHinge.id,steps:24});
  expect(turn.clear).toBe(true);
  // Turned half a tooth out of phase, the planets collide with the sun and the ring.
  const bad=structuredClone(doc) as CadDocument;
  for(const id of bad.roots)if(bad.nodes[id].name.startsWith('Planet'))bad.nodes[id].transform.rotation[2]+=15;
  const clash=await assemblyHost().mechanism(validateDocument(bad),{joint:sunHinge.id,range:[0,0],steps:1});
  expect(clash.collisions.length).toBeGreaterThanOrEqual(3);
  expect(clash.collisions.every(c=>c.atRest)).toBe(true);
 });
 it('inserts from the terminal into an existing design with its group and exploded view',()=>{
  const s=createCadSession(createDocument('Bench')),runner=createCommandRunner(s);
  const done=runner.run('planetary sun 12 planet 18 planets 3 module 1.5');
  expect(done.invocation).toBe('planetary sun 12 planet 18 planets 3 module 1.5 width 6 backlash 0.2');
  expect(done.output).toMatch(/ring 48 teeth/);
  const doc=s.state.document;
  expect(doc.assembly!.groups).toHaveLength(1);
  expect(doc.assembly!.views).toHaveLength(1);
  expect(doc.joints).toHaveLength(5);
  expect(doc.joints!.filter(j=>j.gearMesh)).toHaveLength(4);
 });
});

describe('German',()=>{
 it('translates the assembly commands and reports',async()=>{
  setLocale('de');
  try{
   const {s}=boxes(),runner=createCommandRunner(s,{assembly:assemblyHost()});
   expect(runner.run('group Gehäuse Base Lid').output).toMatch(/Gruppe|gruppiert/i);
   expect(()=>runner.run('config use X')).toThrow(/Unbekannte Konfiguration/);
   s.addJoint('hinge',s.state.document.roots[0],s.state.document.roots[2],[0,0,10],[0,0,1],{limits:[0,.5]});
   expect((await runner.runAsync('mechanism 1 steps 2')).output).toMatch(/Mechanismus/);
  }finally{setLocale('en');}
 });
});

describe('MCP and CLI',()=>{
 it('runs the assembly commands in cad_run_commands, reads the assembly and checks the mechanism',async()=>{
  const {createCodeHost}=await import('../apps/mcp/host.mjs');
  const host=await createCodeHost();
  try{
   const {revision}=await host.call('cad_get_model');
   const run=await host.call('cad_run_commands',{commands:'planetary\nexplode auto radial spacing 20 group "Planetary gear set" name Spread',expectedRevision:revision});
   expect(run.committed).toBe(true);
   expect(run.results.map((r:{invocation:string})=>r.invocation)).toEqual(['planetary sun 12 planet 12 planets 3 module 2 width 6 backlash 0.2',expect.stringMatching(/^explode auto radial 0,0,1 spacing 20 group [\w-]+ name Spread$/)]);
   const read=await host.call('cad_assembly',{view:'Spread',factor:.5});
   expect(read.version).toBe(50);
   expect(read.groups[0]).toMatchObject({name:'Planetary gear set'});
   expect(read.groups[0].bodies).toHaveLength(6);
   expect(read.views.map((v:{name:string})=>v.name)).toEqual(['Exploded view','Spread']);
   expect(Object.keys(read.explode.offsets).length).toBeGreaterThan(0);
   expect(read.joints.map((j:{port:string})=>j.port)).toEqual(['A','B','C','D','E']);
   expect(host.definitions.find((d:{name:string})=>d.name==='cad_check_mechanism').annotations.readOnlyHint).toBe(true);
   const before=(await host.call('cad_get_model')).revision;
   const check=await host.call('cad_check_mechanism',{joint:'A',range:[0,30],steps:3});
   expect(check).toMatchObject({clear:true,unit:'deg',samples:4});
   expect(check.coupled).toHaveLength(4);
   expect(check.text).toMatch(/Mechanism check of hinge Carrier plate – Sun gear/);
   expect((await host.call('cad_get_model')).revision).toBe(before);
  }finally{await host.dispose();}
 });
});
