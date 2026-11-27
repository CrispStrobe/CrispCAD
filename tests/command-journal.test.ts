// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {compileCode,createCadSession,createCommandJournal,createCommandRunner,createDocument,exportCommandJournal,newId,portableJournalObjects,serializeDocument} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {createTerminalController} from '../packages/editor/src/terminal-controller.js';

let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});

function fixture(document?:CadDocument){
 const session=createCadSession(document),journal=createCommandJournal(session),runner=createCommandRunner(session,{journal});
 return {session,journal,runner};
}
/** Rebuild an exported program and compare it with the recorded body (volume and bounding box). */
function rebuildsLike(document:CadDocument,object:{id:string;source:string}){
 // The body and the nodes it is built from (Boolean inputs), nothing else.
 const nodes:CadDocument['nodes']={},pending=[object.id];
 while(pending.length){const id=pending.pop()!,node=document.nodes[id];nodes[id]=node;if(node.kind==='boolean')pending.push(...node.inputs);}
 const original=kernel.evaluate({...document,nodes,roots:[object.id]});
 const code=createCadSession();code.addCode({version:1,language:'brickwright-cad-script',source:object.source,parameters:{}});
 const rebuilt=kernel.evaluate(code.state.document);
 expect(rebuilt.volume,object.source).toBeGreaterThan(1);
 expect(rebuilt.volume/original.volume,object.source).toBeCloseTo(1,6);
 const flat=(bounds:{min:number[];max:number[]})=>[...bounds.min,...bounds.max];
 flat(rebuilt.bodies[0].bounds).forEach((value,i)=>expect(value,object.source).toBeCloseTo(flat(original.bodies[0].bounds)[i],4));
}
const objectBlocks=(text:string)=>text.split('\n\n').filter(block=>block.includes('// @object'));
const replayBlocks=(text:string)=>text.split('\n\n').filter(block=>block.includes('// @replay'));

describe('command journal export',()=>{
 it('exports created primitives, folding their later transforms, as faithful CAD Script',()=>{
  const {session,journal,runner}=fixture();
  runner.runScript('box 40,30,10 0,0,5\nsphere 6 30,0,6\ncylinder 4 12 -20,5,6\nselect "Box"\nmove 0,0,0 @10,0,0\nrotate 15,0,30\nscale 1,2,1');
  const text=journal.export();
  expect(text.startsWith('// crispcad-journal 1 · cadscript\n// Data only. Never evaluate this text as JavaScript.')).toBe(true);
  expect(objectBlocks(text)).toHaveLength(3);expect(replayBlocks(text)).toHaveLength(0);
  expect(text).toContain('// from: box 40,30,10 0,0,5; move 0,0,0 10,0,0; rotate 15,0,30; scale 1,2,1');
  expect(text).toContain('return move([10, 0, 5], rotate([15, 0, 30], scale([1, 2, 1], box(40, 30, 10))));');
  // Each object program compiles and builds the same solid as the recorded body.
  const exported=portableJournalObjects(journal.entries);expect(exported.map(o=>o.id)).toEqual(session.state.document.roots);
  for(const object of exported){
   const document=session.state.document,original=kernel.evaluate({...document,nodes:{[object.id]:document.nodes[object.id]},roots:[object.id]});
   const code=createCadSession();code.addCode({version:1,language:'brickwright-cad-script',source:object.source,parameters:{}});
   expect(compileCode({version:1,language:'brickwright-cad-script',source:object.source,parameters:{}}).shape).toBeDefined();
   const rebuilt=kernel.evaluate(code.state.document);
   expect(rebuilt.volume).toBeCloseTo(original.volume,6);
   const flat=(bounds:{min:number[];max:number[]})=>[...bounds.min,...bounds.max];
   flat(rebuilt.bodies[0].bounds).forEach((value,i)=>expect(value).toBeCloseTo(flat(original.bodies[0].bounds)[i],5));
  }
 });
 it('exports sketch extrusions and revolutions on every plane as equivalent CAD Script',()=>{
  const {session,journal,runner}=fixture();
  runner.runScript('rect 0,0 20,30\nextrude Rectangle 5\ncircle 50,0 8\nextrude Circle 12\nselect "Extrusion 2"\nmove 0,0,0 0,10,3\nrotate 0,0,30');
  session.addSketchExtrusion({id:newId(),kind:'rectangle',width:10,depth:4},{name:'Side',plane:'XZ',distance:6,symmetric:true,position:[1,2,3]});
  session.addSketchExtrusion({id:newId(),kind:'outline',points:[[0,0],[12,0],[12,8],[0,8]],bulges:[0,0.4,0,0]},{name:'Arched',plane:'YZ',distance:3});
  session.addSketchRevolution({id:newId(),kind:'outline',points:[[5,0],[9,0],[9,6],[5,6]]},{name:'Ring',plane:'XY',angle:270,position:[0,-40,0]});
  session.addSketchRevolution({id:newId(),kind:'circle',radius:2,center:[6,1],segments:32},{name:'Torus',plane:'YZ',angle:360,axisOffset:1});
  session.addSketchRevolution({id:newId(),kind:'rectangle',width:4,depth:6},{name:'Disc',plane:'XZ',angle:90});
  const text=journal.export();
  expect(replayBlocks(text)).toEqual([]);expect(objectBlocks(text)).toHaveLength(7);
  expect(text).toContain('// from: rectangle 0,0 20,30; extrude ');
  expect(text).toContain('return extrudeProfile(5, rectangle2d(20, 30));');
  expect(text).toContain('return move([0, 10, 3], rotate([0, 0, 30], extrudeProfile(12, move2d(50, 0, circle2d(8, 64)))));');
  expect(text).toContain('return move([1, 2, 3], rotate([90, 0, 0], move([0, 0, -3], extrudeProfile(6, rectangle2d(10, 4, true)))));');
  expect(text).toMatch(/return rotate\(\[90, 0, 90\], extrudeProfile\(3, polygon2d\(\[/);
  expect(text).toContain('revolve(move2d(-5, 0, move2d(5, 0, rectangle2d(4, 6))), 270, 128)');
  const exported=portableJournalObjects(journal.entries);expect(exported.map(o=>o.id)).toEqual(session.state.document.roots);
  for(const object of exported){
   const document=session.state.document,original=kernel.evaluate({...document,nodes:{[object.id]:document.nodes[object.id]},roots:[object.id]});
   const code=createCadSession();code.addCode({version:1,language:'brickwright-cad-script',source:object.source,parameters:{}});
   const rebuilt=kernel.evaluate(code.state.document);
   expect(rebuilt.volume).toBeGreaterThan(1);
   // Same polygons; only float rounding of the nested transforms differs.
   expect(rebuilt.volume/original.volume).toBeCloseTo(1,7);
   const flat=(bounds:{min:number[];max:number[]})=>[...bounds.min,...bounds.max];
   flat(rebuilt.bodies[0].bounds).forEach((value,i)=>expect(value).toBeCloseTo(flat(original.bodies[0].bounds)[i],5));
  }
 });
 it('keeps sketches non-portable when they are unused, consumed or driven by parameters from before the journal',()=>{
  const session=createCadSession();
  session.setParametric({version:1,parameters:{h:{expression:'7',unit:'mm'}},bindings:[]});
  const {session:own,journal:ownJournal,runner:ownRunner}=fixture(session.state.document);
  const sketch=own.addSketch({id:newId(),kind:'rectangle',width:10,depth:10},{name:'Param',plane:'XY'});
  own.extrudeSketch(sketch,{distance:'h'});
  // A literal extrusion that a non-portable edit (a hole cutter that stays on its own) consumes, and a sketch nothing extrudes.
  ownRunner.runScript('circle 0,0 4\ncircle 30,0 4\nrect 50,0 60,10');
  const circles=Object.values(own.state.document.sketches!).filter(s=>s.name==='Circle').map(s=>s.id);
  ownRunner.run(`extrude ${circles[0]} 3`);ownRunner.run(`extrude ${circles[1]} 3`);
  own.setRole('hole',[own.state.document.roots.at(-1)!]);
  const text=ownJournal.export(),objects=objectBlocks(text);
  // Only the first circle's extrusion is portable: "h" was defined before the journal started.
  expect(objects).toHaveLength(1);expect(objects[0]).toContain(`// from: circle 0,0 4; extrude ${circles[0]} 3`);
  expect(objects[0]).toContain('return extrudeProfile(3, circle2d(4, 64));');
  const replay=replayBlocks(text).map(block=>block.split('\n')[0]);
  expect(replay.filter(line=>line.includes('Extrude sketch'))).toHaveLength(1);
  expect(replay.some(line=>line.includes('rectangle 50,0 60,10'))).toBe(true);
  expect(replay.some(line=>line.includes(`extrude ${circles[1]} 3`))).toBe(true);
  expect(replay.some(line=>line.includes('circle 30,0 4'))).toBe(true);
  // Editing the portable sketch later folds into its extrusion.
  own.updateSketch(circles[0],{profile:{...own.state.document.sketches![circles[0]].profile,radius:5} as never});
  expect(ownJournal.export()).toContain('return extrudeProfile(3, circle2d(5, 64));');
 });
 it('exports parametric profiles with their parameters, folding later parameter edits',()=>{
  const {session,journal}=fixture();
  session.setParametric({version:1,parameters:{w:{expression:'24',unit:'mm'},h:{expression:'w / 4',unit:'mm'},r:{expression:'5',unit:'mm'},sweep:{expression:'270',unit:'deg'}},bindings:[]});
  const plate=session.addSketch({id:newId(),kind:'rectangle',width:'w',depth:'h * 2 + 1 mm'},{name:'Plate',plane:'XY'});
  session.extrudeSketch(plate,{distance:'h',symmetric:true});
  const side=session.addSketch({id:newId(),kind:'rectangle',width:'w / 2',depth:'h'},{name:'Side',plane:'XZ'});
  session.extrudeSketch(side,{distance:'r'});
  session.addSketchRevolution({id:newId(),kind:'circle',radius:'r / 2',center:[12,3],segments:48},{name:'Ring',plane:'YZ',angle:'sweep',axisOffset:'r',position:[0,40,0]});
  session.addSketchRevolution({id:newId(),kind:'rectangle',width:'r',depth:'h'},{name:'Disc',plane:'XY',angle:'sweep',position:[-40,0,0]});
  // A later edit of a parameter (and a new one nothing uses) changes the bodies, not their programs.
  session.setParametric({...session.state.document.parametric!,parameters:{...session.state.document.parametric!.parameters,w:{expression:'30',unit:'mm'}}});
  const text=journal.export();
  expect(replayBlocks(text)).toEqual([]);expect(objectBlocks(text)).toHaveLength(4);
  expect(text).toContain('// from: Edit parameters; Add sketch; Extrude sketch; Edit parameters\nparam w: mm = 30;\nparam h: mm = w / 4;\nreturn move([0, 0, -h / 2], extrudeProfile(h, rectangle2d(w, (h * 2 + 1 mm), true)));');
  expect(text).toContain('param r: mm = 5;\nparam sweep: deg = 270;\nreturn move([0, 40, 0], move([0, r, 0], rotate([0, 0, 90], revolve(move2d(-r, 0, move2d(12, 3, circle2d((r / 2), 48))), sweep, 128))));');
  expect(text).toContain('revolve(move2d(-(-r / 2), 0, rectangle2d(r, h, true)), sweep, 128)');
  const exported=portableJournalObjects(journal.entries);expect(exported.map(o=>o.id)).toEqual(session.state.document.roots);
  for(const object of exported)rebuildsLike(session.state.document,object);
  // The programs stay parametric: overriding a parameter changes the rebuilt body.
  const first=compileCode({version:1,language:'brickwright-cad-script',source:exported[0].source,parameters:{w:'40'}});
  expect(first.values.w.value).toBe(40);expect(first.values.h.value).toBe(10);
 });
 it('keeps parameters non-portable with bindings, or when created with ones nothing exports',()=>{
  const {session,journal}=fixture();
  session.setParametric({version:1,parameters:{h:{expression:'7',unit:'mm'},unused:{expression:'1',unit:'mm'}},bindings:[]});
  const sketch=session.addSketch({id:newId(),kind:'rectangle',width:10,depth:'h'},{name:'Param',plane:'XY'});
  session.extrudeSketch(sketch,{distance:3});
  // One record created both parameters; "unused" has no CAD Script equivalent, so the record stays replay text, and with it the sketch.
  expect(objectBlocks(journal.export())).toHaveLength(0);
  const second=fixture();
  second.session.setParametric({version:1,parameters:{h:{expression:'7',unit:'mm'}},bindings:[]});
  const box=second.session.add({kind:'box',size:[2,3,4]},{name:'Driven'});
  const s2=second.session.addSketch({id:newId(),kind:'circle',radius:'h',segments:32},{name:'Disc',plane:'XY'});
  second.session.extrudeSketch(s2,{distance:'h'});
  expect(objectBlocks(second.journal.export())).toHaveLength(2);
  second.session.setParametric({...second.session.state.document.parametric!,bindings:[{nodeId:box,property:'positionX',expression:'h'}]});
  // A binding drives body properties from parameters: the edit and every body tracked so far become replay text.
  expect(objectBlocks(second.journal.export())).toHaveLength(0);
 });
 it('exports Booleans of portable bodies, hole roles and nested Booleans included, as equivalent CAD Script',()=>{
  const {session,journal,runner}=fixture();
  runner.runScript('box 40,30,10 0,0,5\ncylinder 4 30 10,0,5\nsphere 6 -10,0,10\nbox 20,20,20 60,0,0\nsphere 13 60,0,0');
  const [plate,bore,dome,cube,ball]=session.state.document.roots;
  session.transform([{id:bore,transform:{position:[10,0,5],rotation:[30,0,0],scale:[1,1,1]}}]);
  const cut=session.combine('subtract',[plate,bore]);
  const blob=session.combine('union',[cut,dome]);
  session.transform([{id:blob,transform:{position:[0,0,3],rotation:[0,0,15],scale:[1,1,1]}}]);
  session.update(blob,{name:'Bracket',color:'#ff0000'});
  const intersection=session.combine('intersect',[cube,ball]);
  // A sketch extrusion with a hole cutter from a parametric circle, joined by hole roles.
  session.setParametric({version:1,parameters:{d:{expression:'3',unit:'mm'}},bindings:[]});
  const base=session.addSketchExtrusion({id:newId(),kind:'rectangle',width:30,depth:30},{name:'Base',plane:'XY',distance:5,position:[0,60,0]});
  const holeSketch=session.addSketch({id:newId(),kind:'circle',radius:'d',segments:32},{name:'Hole',plane:'XY'});
  const hole=session.extrudeSketch(holeSketch,{distance:20});
  session.transform([{id:hole,transform:{position:[5,60,-5],rotation:[0,0,0],scale:[1,1,1]}}]);
  session.setRole('hole',[hole]);
  const joined=session.combine('union',[base,hole]);
  const text=journal.export();
  expect(replayBlocks(text)).toEqual([]);
  const objects=objectBlocks(text);expect(objects).toHaveLength(3);
  expect(objects[0]).toContain('// @object 1 "Bracket" color #ff0000');
  expect(objects[0]).toContain('return move([0, 0, 3], rotate([0, 0, 15], union(subtract(move([0, 0, 5], box(40, 30, 10)), move([10, 0, 5], rotate([30, 0, 0], cylinder(4, 30, 48)))), move([-10, 0, 10], sphere(6, 48)))));');
  expect(objects[1]).toContain('return intersect(move([60, 0, 0], box(20, 20, 20)), move([60, 0, 0], sphere(13, 48)));');
  expect(objects[2]).toContain('param d: mm = 3;\nreturn subtract(move([0, 60, 0], extrudeProfile(5, rectangle2d(30, 30, true))), move([5, 60, -5], extrudeProfile(20, circle2d(d, 32))));');
  const exported=portableJournalObjects(journal.entries);expect(exported.map(o=>o.id)).toEqual(session.state.document.roots);
  for(const object of exported)rebuildsLike(session.state.document,object);
  // Separating a Boolean gives its inputs back as bodies of their own.
  session.separate(intersection);
  expect(portableJournalObjects(journal.entries).map(o=>o.id).sort()).toEqual([...session.state.document.roots].sort());
  expect(objectBlocks(journal.export())).toHaveLength(4);expect(replayBlocks(journal.export())).toEqual([]);
  // A hole cutter on its own has no CAD Script equivalent: separating the hole-role union leaves it, and the record that made the union, as replay text.
  session.separate(joined);
  expect(portableJournalObjects(journal.entries).map(o=>o.id).sort()).toEqual([blob,cube,ball].sort());
  expect(replayBlocks(journal.export()).length).toBeGreaterThan(0);
 });
 it('keeps a Boolean non-portable when an input or a later edit is',()=>{
  const {session,journal,runner}=fixture();
  runner.runScript('box 10,10,10\nsphere 7');
  session.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:'return box(3, 3, 30);'},'Code');
  const [box,sphere,code]=session.state.document.roots;
  session.combine('subtract',[box,code]);
  // The code object is not portable, so neither is the subtraction, nor the box it consumed.
  const text=journal.export();
  expect(objectBlocks(text)).toHaveLength(1);expect(objectBlocks(text)[0]).toContain('sphere(7, 48)');
  expect(portableJournalObjects(journal.entries).map(o=>o.id)).toEqual([sphere]);
  expect(replayBlocks(text).some(block=>block.includes('box 10,10,10'))).toBe(true);
 });
 it('keeps non-portable edits as marked canonical replay text and resolves undo/redo',()=>{
  const {session,journal,runner}=fixture();
  runner.runScript('box 10,10,10\nrect 0,0 20,30\nbox 5,5,5 30,0,2.5\nundo\nredo\nsphere 3\nundo');
  const text=journal.export();
  expect(objectBlocks(text)).toHaveLength(2);
  const replay=replayBlocks(text);expect(replay).toHaveLength(1);
  expect(replay[0]).toMatch(/^\/\/ @replay 2 non-portable: rectangle 0,0 20,30\n\/\/\| apply \{/);
  expect(text).toContain('undone edits are not included');expect(text).not.toContain('sphere(');
  // Every replay payload is commented out: the export is never executable source.
  for(const line of text.split('\n'))if(line.startsWith('//| '))expect(line.slice(4)).toMatch(/^(apply|select|undo|redo) /);
  expect(session.state.document.roots).toHaveLength(2);
 });
 it('makes bodies non-portable when a non-portable edit consumes or changes them',()=>{
  const {session,journal,runner}=fixture();
  runner.runScript('box 10,10,10\nbox 4,4,20\nsphere 2 50,0,0\nselect all\nunion');
  // A union of portable bodies is portable; turning it into a reference is not, and that takes its inputs along.
  expect(objectBlocks(journal.export())).toHaveLength(1);
  session.update(session.state.document.roots[0],{reference:true});
  expect(objectBlocks(journal.export())).toHaveLength(0);expect(replayBlocks(journal.export())).toHaveLength(5);
  runner.run('box 1,2,3');const id=session.state.document.roots.at(-1)!;session.update(id,{name:'Renamed',color:'#ff0000'});
  expect(journal.export()).toContain('// @object 1 "Renamed" color #ff0000');
  session.setRole('hole',[id]);
  expect(objectBlocks(journal.export())).toHaveLength(0);
 });
 it('treats GUI-recorded primitives like typed ones and keeps the GUI summary',()=>{
  const {session,journal}=fixture();const id=session.add({kind:'box',size:[2,3,4]},{name:'GUI box'});
  session.transform([{id,transform:{position:[1,2,3],rotation:[0,0,0],scale:[1,1,1]}}]);
  expect(journal.export()).toContain('// from: Add box; Transform selection\nreturn move([1, 2, 3], box(2, 3, 4));');
 });
 it('exports a replay stream that the headless runner reproduces on the recorded project',()=>{
  const initial=createDocument('Journal');const {session,journal,runner}=fixture(initial);
  runner.runScript('box 10,10,10\nrect 0,0 20,30\nselect all\nmove 0,0,0 1,2,3\nundo\nredo');
  const replay=journal.export('replay');expect(replay.split('\n')[0]).toBe('// crispcad-journal 1 · replay');
  const copy=createCadSession(initial);createCommandRunner(copy).runScript(replay);
  expect(serializeDocument(copy.state.document)).toBe(serializeDocument(session.state.document));
 });
 it('never changes the model, its history or saved data, and stays bounded',()=>{
  const {session,runner}=fixture(),journal=createCommandJournal(session,{entries:3});
  for(let i=0;i<5;i++)runner.run(`box ${i+1},1,1`);
  const saved=session.serialize(),revision=session.state.revision,past=session.history.past;
  expect(journal.entries).toHaveLength(3);expect(journal.dropped).toBe(2);
  expect(journal.export()).toContain('2 earlier entries exceeded the journal limit');
  expect(session.serialize()).toBe(saved);expect(session.state.revision).toBe(revision);expect(session.history.past).toEqual(past);
  expect(saved).not.toContain('crispcad-journal');
  session.load(createDocument('Other'));expect(journal.entries).toEqual([]);
  expect(exportCommandJournal([])).toContain('// No model edits recorded.');
 });
 it('is available as a terminal command without adding history',async()=>{
  const session=createCadSession(),terminal=createTerminalController(session,{executeEditorCommand:()=>{},openCodeWorkspace:()=>{}});
  await terminal.submit('box 10,20,30 0,0,15');await terminal.submit('select none');await terminal.submit('select all');await terminal.submit('m 0,0,0 @5,0,0');
  const revision=session.state.revision;
  await terminal.submit('journal');expect(terminal.state.entries.at(-1)?.summary).toMatch(/^4 journal entries · 1 portable objects/);
  await terminal.submit('journal export');
  const output=terminal.state.entries.at(-1)!;expect(output.kind).toBe('output');
  expect(output.summary).toContain('// from: box 10,20,30 0,0,15; move 0,0,0 5,0,0\nreturn move([5, 0, 15], box(10, 20, 30));');
  await terminal.submit('journal export replay');expect(terminal.state.entries.at(-1)?.summary).toContain('\nselect [');
  await terminal.submit('journal export json');expect(terminal.state.entries.at(-1)?.kind).toBe('error');
  expect(terminal.exportJournal()).toBe(output.summary);
  expect(session.state.revision).toBe(revision);expect(session.history.past).toHaveLength(2);
  terminal.dispose();
 });
});
