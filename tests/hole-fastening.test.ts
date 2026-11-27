// SPDX-License-Identifier: BSD-3-Clause
// Hole-driven fastening (convergence Phase 6.2): ISO table values, standard holes (document
// version 47) in Manifold and in the exact kernel (true cylinders and cones), fastener plans and
// placement, standard parts, registry commands, model source, journal and history round trips.
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {COUNTERBORE_4762,HEAT_SET_INSERTS,HOLE_ENTRY_MM,ISO_10642,ISO_4017,ISO_4032,ISO_4762,ISO_7089,ISO_7380,METRIC_THREADS,THREADS,classifyClearanceBore,createCadSession,createCommandJournal,createCommandRunner,eulerFromMatrix,holeCutterVolume,holeProfile,identityTransform,parseDocument,planFastening,rotationForAxis,rotationMatrix,screwRecipe,serializeDocument,setLocale,standardHole,standardPart,tapDrillThread,checkGenerator} from '@brickwright/cad-core';
import type {CadDocument,HoleFeature,SolidNode,Vec3} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,lowerDocumentBody} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';
import {appendPortableRevision,readPortableHistory} from '@brickwright/cad-history';
import {createPresetDocument} from '../packages/editor/src/shapes.js';

vi.setConfig({testTimeout:120_000});
let exact:ExactBackend,manifold:GeometryKernel;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},120_000);
afterAll(()=>setLocale('en'));
const generated=(recipe:Parameters<typeof createPresetDocument>[2] extends infer O?O extends {recipe?:infer R}?NonNullable<R>:never:never,name:string)=>createPresetDocument(recipe.preset,name,{recipe});

describe('ISO tables',()=>{
 it('holds the ISO 273, ISO 261 and tap drill values of the standard',()=>{
  // ISO 273 fine/medium/coarse series and ISO 261 coarse pitch, spot checks across the range.
  expect(THREADS.M3).toEqual({nominal:3,pitch:.5,clearance:{close:3.2,normal:3.4,loose:3.6},tapDrill:2.5});
  expect(THREADS.M4.clearance).toEqual({close:4.3,normal:4.5,loose:4.8});
  expect(THREADS.M5.clearance.normal).toBe(5.5);
  expect(THREADS.M6).toMatchObject({pitch:1,clearance:{close:6.4,normal:6.6,loose:7},tapDrill:5});
  expect(THREADS.M8).toMatchObject({pitch:1.25,clearance:{close:8.4,normal:9,loose:10},tapDrill:6.8});
  expect(THREADS.M10.clearance).toEqual({close:10.5,normal:11,loose:12});
  expect(THREADS.M12).toMatchObject({pitch:1.75,clearance:{close:13,normal:13.5,loose:14.5},tapDrill:10.2});
  expect(THREADS.M20).toMatchObject({pitch:2.5,clearance:{close:21,normal:22,loose:24},tapDrill:17.5});
  for(const m of METRIC_THREADS){const r=THREADS[m];expect(r.clearance.close).toBeGreaterThan(r.nominal);expect(r.clearance.normal).toBeGreaterThan(r.clearance.close);expect(r.clearance.loose).toBeGreaterThan(r.clearance.normal);expect(r.tapDrill).toBeLessThan(r.nominal);}
 });
 it('holds the head, nut and washer dimensions of ISO 4762, 7380, 10642, 4017, 4032 and 7089',()=>{
  expect(ISO_4762.M3).toEqual({dk:5.5,k:3,s:2.5,t:1.3});
  expect(ISO_4762.M8).toEqual({dk:13,k:8,s:6,t:4});
  expect(ISO_7380.M5).toMatchObject({dk:9.5,k:2.75,s:3});
  expect(ISO_10642.M6).toMatchObject({dk:13.44,k:3.72,s:4});
  // A 90° head: k = (dk - d) / 2 for the theoretical head diameter.
  for(const [m,head] of Object.entries(ISO_10642))expect(head!.k).toBeCloseTo((head!.dk-THREADS[m as keyof typeof THREADS].nominal)/2,2);
  expect(ISO_4017.M10).toEqual({s:16,k:6.4});
  expect(ISO_4032.M5).toEqual({s:8,m:4.7});
  expect(ISO_4032.M12).toEqual({s:18,m:10.8});
  expect(ISO_7089.M6).toEqual({d1:6.4,d2:12,h:1.6});
  expect(ISO_7089.M10).toEqual({d1:10.5,d2:20,h:2});
  expect(COUNTERBORE_4762.M3).toEqual({diameter:6.5,depth:3.4});
  for(const m of METRIC_THREADS){const head=ISO_4762[m]!;expect(COUNTERBORE_4762[m].diameter).toBeGreaterThan(head.dk);expect(COUNTERBORE_4762[m].depth).toBeGreaterThan(head.k);expect(ISO_7089[m].d1).toBe(THREADS[m].clearance.close);}
  expect(HEAT_SET_INSERTS.M3).toEqual({pocket:4,outer:4.6,length:5.7});
 });
 it('reads the fit class back from a bore and keeps tap drills apart',()=>{
  expect(classifyClearanceBore(3.4)).toEqual({thread:'M3',fit:'normal'});
  expect(classifyClearanceBore(4.3)).toEqual({thread:'M4',fit:'close'});
  expect(classifyClearanceBore(7)).toEqual({thread:'M6',fit:'loose'});
  expect(classifyClearanceBore(5)).toBeUndefined(); // the M6 tap drill is not a clearance hole
  expect(tapDrillThread(5)).toBe('M6');
  expect(tapDrillThread(3.3)).toBe('M4');
 });
});

describe('standard holes',()=>{
 it('resolves each hole type from the tables',()=>{
  expect(standardHole({type:'clearance',thread:'M4',depth:6,through:true})).toMatchObject({diameter:4.5,depth:6,through:true,standard:{type:'clearance',thread:'M4',fit:'normal'}});
  expect(standardHole({type:'clearance',thread:'M4',fit:'loose',depth:6}).diameter).toBe(4.8);
  expect(standardHole({type:'tapped',thread:'M5'})).toMatchObject({diameter:4.2,depth:10});
  expect(standardHole({type:'counterbore',thread:'M3',depth:10,through:true})).toMatchObject({diameter:3.4,counterbore:{diameter:6.5,depth:3.4}});
  expect(standardHole({type:'countersink',thread:'M5',depth:8,through:true})).toMatchObject({diameter:5.5,countersink:{diameter:11.2,angle:90}});
  expect(standardHole({type:'heat-set',thread:'M3'})).toMatchObject({diameter:4,depth:6.7});
  expect(()=>standardHole({type:'counterbore',thread:'M3',depth:3})).toThrow('3.4 mm deep');
  expect(()=>standardHole({type:'countersink',thread:'M2',depth:5})).toThrow('M3 to M12');
  expect(()=>standardHole({type:'heat-set',thread:'M8'})).toThrow('No heat-set insert');
  expect(()=>standardHole({type:'clearance',thread:'M3'})).toThrow('depth');
 });
 it('cuts the same volume in Manifold and in the exact kernel, with true cylinders and cones',()=>{
  const cases:HoleFeature[]=[
   standardHole({type:'clearance',thread:'M5',depth:10,through:true}),
   standardHole({type:'counterbore',thread:'M4',depth:10,through:true}),
   standardHole({type:'countersink',thread:'M6',depth:10,through:true}),
   standardHole({type:'tapped',thread:'M6',depth:7}),
   standardHole({type:'heat-set',thread:'M4'}),
  ];
  for(const hole of cases){
   const session=createCadSession(),plate=session.add({kind:'box',size:[30,30,10]},{transform:{...identityTransform(),position:[0,0,5]}});
   session.addStandardHoles([{hole:{...hole,segments:256},transform:{...identityTransform(),position:[0,0,10]}}],plate);
   const doc=session.state.document,body=doc.roots[0];
   expect(doc.version).toBe(47);
   const top=(hole.counterbore?.diameter??hole.countersink?.diameter??hole.diameter)/2,expected=9000-(holeCutterVolume({...hole,through:undefined})-Math.PI*top*top*HOLE_ENTRY_MM);
   const mesh=manifold.evaluate(doc).bodies[0].volume;
   const solid=exact.kernel.scope(()=>{
    const s=lowerDocumentBody(exact.kernel,doc,body);
    return {volume:exact.kernel.volume(s),surfaces:exact.kernel.topology(s).faces.map(f=>`${f.surface}${f.radius!==undefined?':'+Number(f.radius.toFixed(6)):''}`)};
   });
   expect(solid.volume).toBeCloseTo(expected,6);
   expect(Math.abs(mesh-expected)/expected).toBeLessThan(2e-4); // 256 segments
   expect(solid.surfaces).toContain(`cylinder:${hole.diameter/2}`);
   if(hole.counterbore)expect(solid.surfaces).toContain(`cylinder:${hole.counterbore.diameter/2}`);
   if(hole.countersink)expect(solid.surfaces.some(s=>s.startsWith('cone'))).toBe(true);
   expect(solid.surfaces.every(s=>/^(plane|cylinder|cone)/.test(s))).toBe(true);
  }
 });
 it('drills along any axis and joins an existing solid/hole union',()=>{
  const session=createCadSession(),plate=session.add({kind:'box',size:[40,20,8]});
  const runner=createCommandRunner(session);
  runner.run(`hole clearance M3 through 20 at -15,0,10 axis 0,0,-1 in ${plate}`);
  const union=session.state.document.roots[0];
  runner.run('hole tapped M4 8 at 20,0,0 axis -1,0,0 in '+union);
  const doc=session.state.document;expect(doc.roots).toEqual([union]);
  const node=doc.nodes[union] as Extract<SolidNode,{kind:'boolean'}>;expect(node.inputs).toHaveLength(3);
  const side=doc.nodes[node.inputs[2]];expect(side.transform.rotation).toEqual([90,0,90]);
  // The side hole: Ø3.3 × 8 along -X from x = 20 (the end face), so it removes π·1.65²·8 from the 2560 mm³ bar.
  const volume=exact.kernel.scope(()=>exact.kernel.volume(lowerDocumentBody(exact.kernel,doc,union)));
  expect(volume).toBeCloseTo(40*20*8-Math.PI*1.7**2*8-Math.PI*1.65**2*8,6);
 });
 it('refuses invalid hole nodes and older document versions',()=>{
  const session=createCadSession();
  session.addStandardHoles([{hole:standardHole({type:'clearance',thread:'M3',depth:5}),transform:identityTransform()}]);
  const doc=JSON.parse(serializeDocument(session.state.document)) as CadDocument,id=doc.roots[0];
  expect(()=>parseDocument(JSON.stringify({...doc,version:46}))).toThrow('version 47');
  const bad=structuredClone(doc);(bad.nodes[id] as unknown as {role:string}).role='solid';expect(()=>parseDocument(JSON.stringify(bad))).toThrow('standard hole');
  const deep=structuredClone(doc);Object.assign(deep.nodes[id],{counterbore:{diameter:6,depth:9}});expect(()=>parseDocument(JSON.stringify(deep))).toThrow('standard hole');
  expect(()=>session.setRole('solid',[id])).toThrow();
 });
});

describe('fastening',()=>{
 it('picks the bolt stack of a through clearance hole: shortest stocked length past the nut',()=>{
  // M5 lap joint, 12 mm grip: 1.0 washer + 12 + 1.0 washer + 4.7 nut + 2 × 0.8 = 20.3 → M5 × 25 (lab guide).
  const plan=planFastening('h',standardHole({type:'clearance',thread:'M5',depth:12,through:true}));
  expect(plan.mode).toBe('bolt');
  expect(plan.parts.map(p=>[p.role,p.part.designation])).toEqual([['screw','ISO 4017 M5×25'],['head washer','ISO 7089 5'],['tail washer','ISO 7089 5'],['nut','ISO 4032 M5']]);
  expect(plan.protrusion).toBeCloseTo(25-20.3+1.6,9);
  expect(plan.parts[0].z).toBe(1);expect(plan.parts[3].z).toBeCloseTo(-12-1-4.7,9);
 });
 it('seats a socket head in its counterbore and a countersunk head flush',()=>{
  const cb=planFastening('h',standardHole({type:'counterbore',thread:'M6',depth:10,through:true}));
  // Head on the counterbore floor (6.4 deep); 3.6 grip + 1.6 washer + 5.2 nut + 2 = 12.4 → M6 × 14.
  expect(cb.parts[0]).toMatchObject({z:-6.4,part:{designation:'ISO 4762 M6×14'}});
  expect(cb.parts.map(p=>p.role)).toEqual(['screw','tail washer','nut']);
  const cs=planFastening('h',standardHole({type:'countersink',thread:'M6',depth:10,through:true}));
  // ISO 10642 length includes the head: 10 + 1.6 + 5.2 + 2 = 18.8 → M6 × 20 (the flange of the lab guide).
  expect(cs.parts[0]).toMatchObject({z:-3.72,part:{designation:'ISO 10642 M6×20'}});
  const blind=planFastening('h',standardHole({type:'tapped',thread:'M4',depth:9}));
  expect(blind).toMatchObject({mode:'screw',parts:[{part:{designation:'ISO 4762 M4×8'},z:0}]});
  const insert=planFastening('h',standardHole({type:'heat-set',thread:'M3'}));
  expect(insert.parts).toMatchObject([{role:'insert',z:-5.7,part:{designation:'Heat-set insert M3×5.7'}}]);
  expect(()=>planFastening('h',standardHole({type:'countersink',thread:'M6',depth:10,through:true}),{family:'socket-head'})).toThrow('countersunk');
  expect(()=>planFastening('h',standardHole({type:'clearance',thread:'M20',depth:200,through:true}))).toThrow('reaches');
 });
 it('maps ISO dimensions onto the screw generator',()=>{
  const recipe=screwRecipe(standardPart('socket-head','M3',10))!;
  expect(checkGenerator(recipe)).toBe(recipe);
  expect(recipe.values).toMatchObject({pitch:.5,length:10,headDiameter:5.5,headHeight:3,slotWidth:2.5});
  expect(recipe.values.diameter+2*recipe.values.threadDepth).toBeCloseTo(3,9);
  expect(recipe.driveDepth).toBe(1.3);
  const csk=screwRecipe(standardPart('countersunk','M5',20))!;
  expect(csk.values.length).toBeCloseTo(20-3.1,9);
  // Head height from the generator's cone: (dk/2 - d/2) / tan(45°) = k.
  expect((csk.values.headDiameter/2-csk.values.diameter/2-csk.values.threadDepth)).toBeCloseTo(3.1,9);
  for(const family of ['socket-head','button-head','countersunk','hex-bolt','set-screw'] as const)for(const m of ['M3','M4','M5','M6','M8'] as const){
   const part=standardPart(family,m,family==='hex-bolt'?20:family==='countersunk'?10:8);const r=screwRecipe(part);if(r)expect(()=>checkGenerator(r)).not.toThrow();
  }
  expect(screwRecipe(standardPart('socket-head','M2',10))).toBeUndefined(); // 0.4 mm pitch: envelope
 });
 it('places a threaded stack along the hole axis and the parts touch nothing they should not',()=>{
  const session=createCadSession(),plate=session.add({kind:'box',size:[30,30,8]},{transform:{...identityTransform(),position:[0,0,4]}});
  const runner=createCommandRunner(session,{generated});
  runner.run(`hole clearance M5 through 8 at 0,0,8 in ${plate}`);
  const out=runner.run('fasten').output!;
  expect(out).toContain('ISO 4017 M5×20');
  const doc=session.state.document;expect(doc.roots).toHaveLength(5);
  const result=manifold.evaluate(doc),byName=(text:string)=>result.bodies.find(b=>b.name.startsWith(text))!;
  const screw=byName('ISO 4017'),nut=byName('ISO 4032');
  expect(screw.bounds.max[2]).toBeCloseTo(8+1+3.5,3); // washer, then the 3.5 mm hex head
  expect(screw.bounds.min[2]).toBeCloseTo(8+1-20,3);
  expect(nut.bounds.max[2]).toBeCloseTo(-1,3);expect(nut.bounds.min[2]).toBeCloseTo(-1-4.7,3);
  const clash=manifold.interference(result.bodies.filter(b=>!b.name.startsWith('ISO 4017')),{minVolumeMm3:1e-3});
  expect(clash.interfering).toEqual([]); // plate, washers and nut do not overlap
  expect(doc.nodes[doc.roots[1]].generator?.preset).toBe('screw');
 });
 it('fastens a hole drilled sideways and holes inside a rotated body',()=>{
  const session=createCadSession(),plate=session.add({kind:'box',size:[20,20,40]},{transform:{...identityTransform(),position:[0,0,20]}});
  const runner=createCommandRunner(session);
  runner.run(`hole counterbore M4 through 20 at 10,0,30 axis -1,0,0 in ${plate}`);
  runner.run('fasten M4 envelope');
  const doc=session.state.document,result=manifold.evaluate(doc),screw=result.bodies.find(b=>b.name.startsWith('ISO 4762'))!;
  // Head on the counterbore floor 4.4 mm inside x = 10, shank towards -X.
  expect(screw.bounds.max[0]).toBeCloseTo(10-4.4+4,3);expect(screw.bounds.min[2]).toBeCloseTo(30-3.5,2);
  // Rotating the whole union moves the fastener frame with it.
  const union=doc.roots[0];session.transform([{id:union,transform:{...identityTransform(),rotation:[0,0,90]}}]);
  const second=createCommandRunner(session).run('fasten '+doc.nodes[union].name+' envelope');
  expect(second.output).toContain('ISO 4762 M4');
  const moved=manifold.evaluate(session.state.document).bodies.filter(b=>b.name.startsWith('ISO 4762'))[1];
  expect(moved.bounds.max[1]).toBeCloseTo(10-4.4+4,3);
 });
 it('round-trips matrices and axes',()=>{
  for(const r of [[0,0,0],[30,-20,10],[90,0,-90],[-45,60,170]] as Vec3[]){const back=eulerFromMatrix(rotationMatrix(r));rotationMatrix(back).forEach((v,i)=>expect(v).toBeCloseTo(rotationMatrix(r)[i],10));}
  for(const axis of [[0,0,-1],[1,0,0],[0,1,0],[0,0,1],[1,2,-3]] as Vec3[]){const m=rotationMatrix(rotationForAxis(axis)),l=Math.hypot(...axis);[m[2],m[5],m[8]].forEach((v,i)=>expect(-v).toBeCloseTo(axis[i]/l,10));}
 });
});

describe('standard parts, commands and persistence',()=>{
 it('inserts envelope parts with ISO dimensions in both kernels',()=>{
  const session=createCadSession(),runner=createCommandRunner(session);
  for(const line of ['part hex-nut M8','part washer M6 at 30,0,0','part heat-set-insert M3 at 60,0,0','part socket-head M2 8 at 90,0,0','part countersunk M5 16 at 120,0,0 envelope'])runner.run(line);
  const doc=session.state.document,result=manifold.evaluate(doc);
  const [nut,washer,insert,screw,csk]=result.bodies;
  const size=(b:typeof nut)=>b.bounds.max.map((v,i)=>v-b.bounds.min[i]);
  expect(size(nut)[2]).toBeCloseTo(6.8,4);expect(size(nut)[0]).toBeCloseTo(13*2/Math.sqrt(3),4);expect(size(nut)[1]).toBeCloseTo(13,4);
  expect(size(washer)[2]).toBeCloseTo(1.6,4);expect(size(washer)[0]).toBeCloseTo(12,1);
  expect(size(insert)[2]).toBeCloseTo(5.7,4);
  expect(screw.bounds.max[2]).toBeCloseTo(2,4);expect(screw.bounds.min[2]).toBeCloseTo(-8,4);
  expect(csk.bounds.max[2]).toBeCloseTo(3.1,4);expect(csk.bounds.min[2]).toBeCloseTo(3.1-16,4);
  // Exact volumes agree with Manifold's (64-segment display) within the chord error.
  for(const [i,id] of doc.roots.entries()){const v=exact.kernel.scope(()=>exact.kernel.volume(lowerDocumentBody(exact.kernel,doc,id)));expect(Math.abs(v-result.bodies[i].volume)/v).toBeLessThan(5e-3);}
  // ISO 7089 M6 washer: π/4 (12² - 6.4²) 1.6.
  expect(exact.kernel.scope(()=>exact.kernel.volume(lowerDocumentBody(exact.kernel,doc,doc.roots[1])))).toBeCloseTo(Math.PI/4*(144-6.4**2)*1.6,6);
  expect(()=>runner.run('part socket-head M3 11')).toThrow('not stocked');
  expect(()=>runner.run('part countersunk M2 8')).toThrow('M3');
 });
 it('lists the tables, records invocations, survives model source, history and Undo',async()=>{
  const session=createCadSession(),journal=createCommandJournal(session),runner=createCommandRunner(session,{journal});
  expect(runner.run('fasteners M3').output).toContain('3.2/3.4/3.6');
  const plate=session.add({kind:'box',size:[20,20,6]});
  const hole=runner.run(`hole countersink M4 through 6 at 0,0,3 in ${plate}`);
  expect(hole.invocation).toBe(`hole countersink M4 normal through 6 at 0,0,3 axis 0,0,-1 in ${plate}`);
  runner.run('fasten envelope');
  expect(journal.entries.map(e=>e.invocation)).toContain(hole.invocation);expect(journal.export()).not.toBe('');
  const doc=session.state.document;
  // Model source writes `hole(id, {...})` and reads it back unchanged.
  const source=createCadSession(doc);source.enableModelSource();
  const text=source.modelSource;expect(text).toContain('hole(');
  const reread=createCadSession(doc);reread.applyModelSource(text);
  expect(reread.state.document.nodes).toEqual(doc.nodes);expect(reread.state.document.roots).toEqual(doc.roots);
  const archive=await appendPortableRevision(undefined,doc,'Fastened');
  const back=(await readPortableHistory(archive));
  expect(JSON.parse(serializeDocument(back.readDocument(back.project.headId)))).toEqual(JSON.parse(serializeDocument(doc)));
  session.undo();session.undo();expect(session.state.document.version).toBeLessThan(47);
 });
 it('speaks German',()=>{
  setLocale('de');
  try{
   const session=createCadSession(),runner=createCommandRunner(session);
   expect(()=>runner.run('hole drill M3 5')).toThrow('Unbekannte Bohrungsart');
   expect(runner.run('hole tapped M3').output).toContain('Gewindebohrung');
  }finally{setLocale('en');}
 });
});

describe('MCP and CLI',()=>{
 it('adds holes, fastens them and inserts parts through the MCP tools, one saved step each',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {createCodeHost}=await import('../apps/mcp/host.mjs');
  const folder=await mkdtemp(join(tmpdir(),'cad-fastening-')),host=await createCodeHost({project:join(folder,'p.bcad')});
  try{
   const table=await host.call('cad_fastener_table',{thread:'M6'});
   expect(table.threads.M6.clearance).toEqual({close:6.4,normal:6.6,loose:7});expect(table.text).toContain('ISO 4032: s 10, m 5.2');
   let {revision}=await host.call('cad_get_model');
   ({revision}=await host.call('cad_run_commands',{commands:'box 40,40,10 0,0,5',expectedRevision:revision}));
   const plate=(await host.call('cad_get_model')).objects[0].id;
   const preview=await host.call('cad_add_hole',{type:'counterbore',thread:'M5',through:true,depth:10,position:[0,0,10],targetId:plate,expectedRevision:revision,preview:true});
   expect(preview.committed).toBe(false);expect(preview.geometry.bodies[0].volumeMm3).toBeLessThan(16000);
   const added=await host.call('cad_add_hole',{type:'counterbore',thread:'M5',through:true,depth:10,position:[0,0,10],targetId:plate,expectedRevision:revision});
   expect(added.committed).toBe(true);expect(added.results[0].invocation).toBe(`hole counterbore M5 normal through 10 at 0,0,10 axis 0,0,-1 in ${plate}`);
   const fastened=await host.call('cad_fasten',{expectedRevision:added.revision});
   expect(fastened.results[0].output).toContain('ISO 4762 M5×12'); // 10 − 5.4 + 1 + 4.7 + 1.6 = 11.9
   const model=await host.call('cad_get_model');expect(model.objects.map((o:{name:string})=>o.name)).toEqual(['Box','ISO 4762 M5×12','ISO 7089 5','ISO 4032 M5']);
   const part=await host.call('cad_insert_part',{family:'washer',thread:'M8',position:[50,0,0],expectedRevision:model.revision});
   expect(part.results[0].output).toBe('ISO 7089 8');
   await expect(host.call('cad_insert_part',{family:'socket-head',thread:'M3',length:11,expectedRevision:part.revision})).rejects.toThrow('not stocked');
   // Threaded: the screw generator recipe is kept on the screw.
   expect((await host.call('cad_get_model_source')).source).toContain('preset: "screw"');
  }finally{await host.dispose();await rm(folder,{recursive:true,force:true});}
 });
});
