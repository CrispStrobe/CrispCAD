import 'fake-indexeddb/auto';
import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,compileCode,defaultCodeProgram,CadCodeError,parseDocument,documentGeometryKey} from '@brickwright/cad-core';
import type {CodeProgram} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {appendPortableRevision,readPortableHistory,openHistoryStore} from '@brickwright/cad-history';
const program=(source:string,parameters:Record<string,string>={}):CodeProgram=>({version:1,language:'brickwright-cad-script',source,parameters});
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
describe('original bounded code features',()=>{
 it('builds the parameterized three-bore plate from retained source',()=>{const p=defaultCodeProgram(),compiled=compileCode(p);expect(compiled.values.width.value).toBe(60);expect(compiled.expandedNodes).toBeLessThan(20);const s=createCadSession(),id=s.addCode(p);expect(s.state.document.version).toBe(4);const result=kernel.evaluate(s.state.document),area=48/2*9*Math.sin(2*Math.PI/48);expect(result.volume).toBeCloseTo(9000-area*15,3);expect(result.bodies[0].bounds.min[2]).toBeCloseTo(0);expect(parseDocument(s.serialize()).nodes[id]).toMatchObject({kind:'code',program:p});});
 it('distinguishes nested transform order and supports reused shapes and forward references',()=>{
  const a=createCadSession(),b=createCadSession();a.addCode(program('let part = box(2,4,6); return move([10,0,0], rotate([0,0,90], part));'));b.addCode(program('return rotate([0,0,90], move([10,0,0], box(2,4,6)));'));
  const x=kernel.evaluate(a.state.document).bodies[0],y=kernel.evaluate(b.state.document).bodies[0];expect(x.volume).toBeCloseTo(48);expect(x.bounds.min[0]).toBeCloseTo(8);expect(x.bounds.min[1]).toBeCloseTo(-1);expect(y.bounds.min[0]).toBeCloseTo(-2);expect(y.bounds.min[1]).toBeCloseTo(9);
  expect(compileCode(program('let a = move([width,0,0], b); let b=box(width,2,3); param width:mm=4; return union(a,b);')).shape.kind).toBe('union');
 });
 it('checks units, dependencies, parameter overrides and shape cycles before evaluating geometry',()=>{
  const p=defaultCodeProgram();p.parameters={width:'8 cm',thickness:'width / 20'};expect(compileCode(p).values.thickness.value).toBe(4);
  for(const source of ['param w:mm=90 deg; return box(w,2,3);','param a:mm=b;param b:mm=a;return box(a,2,3);','let a=b;let b=a;return a;','let a=box(2,3,4);let a=sphere(3);return a;','return move([1 mm,0,0], scale([2 mm,1,1],box(2,2,2)));'])expect(()=>compileCode(program(source))).toThrow();
  expect(()=>compileCode(program('return box(2,3,4);',{missing:'4'}))).toThrow('Unknown parameter');
 });
 it('reports source line/column and refuses script execution, imports and unbounded constructs',()=>{
  for(const source of ['import fs from "fs";','return globalThis.process.exit(1);','while(true) {}','return fetch("https://example.com");','return new Function("return 1")();'])expect(()=>compileCode(program(source))).toThrow(CadCodeError);
  try{compileCode(program('// comment\nreturn unknown(2);'));throw Error('expected');}catch(error){expect(error).toBeInstanceOf(CadCodeError);expect((error as CadCodeError).line).toBe(2);}
  expect(()=>compileCode({...defaultCodeProgram(),parameters:new Date() as never})).toThrow('schema');
 });
 it('bounds parsing, instancing, dependency depth and estimated mesh expansion',()=>{
  for(const source of ['//'+ 'x'.repeat(32768),'return repeat(65,[1,0,0],box(1,1,1));','return repeat(64,[1,0,0],repeat(64,[0,1,0],box(1,1,1)));','return repeat(64,[1,0,0],sphere(2,96));','return '+ 'move([1,0,0],'.repeat(34)+'box(1,1,1)'+')'.repeat(34)+';'])expect(()=>compileCode(program(source))).toThrow();
 });
 it('preserves identity, placement and appearance through edits, booleans, copying and independent local overrides',()=>{
  const s=createCadSession(),id=s.addCode(defaultCodeProgram(),'Plate');s.update(id,{color:'#123456',transform:{position:[4,5,10],rotation:[0,0,30],scale:[1,1,1]}});s.duplicate([id]);const copy=s.state.selection[0],before=s.serialize(),key=documentGeometryKey(s.state.document),p=defaultCodeProgram();p.parameters.width='80';s.updateCode(id,p);expect(documentGeometryKey(s.state.document)).not.toBe(key);expect(s.state.document.nodes[id]).toMatchObject({id,color:'#123456',transform:{position:[4,5,10]}});expect(s.state.document.nodes[copy]).toMatchObject({program:{parameters:{}}});s.undo();expect(s.serialize()).toBe(before);s.redo();
  const base=s.add({kind:'box',size:[100,100,2]});s.combine('union',[base,id]);s.updateCode(id,{...p,parameters:{width:'90'}});expect(kernel.evaluate(s.state.document).volume).toBeGreaterThan(0);
  const host=createCadSession();host.insert(s.fragment([s.state.document.roots.find(root=>root!==copy)!]),[0,0,0],{mergeParameters:true});expect(Object.values(host.state.document.nodes).some(n=>n.kind==='code'&&n.program.parameters.width==='90')).toBe(true);
 });
 it('keeps the last definition on invalid edits and refuses empty coded outputs in the kernel',()=>{
  const s=createCadSession(),id=s.addCode(defaultCodeProgram()),before=s.serialize();expect(()=>s.updateCode(id,program('return box(-1,2,3);'))).toThrow();expect(s.serialize()).toBe(before);s.updateCode(id,program('return subtract(box(2,2,2),box(4,4,4));'));expect(()=>kernel.evaluate(s.state.document)).toThrow('no printable solid');s.undo();expect(s.serialize()).toBe(before);
  const old=JSON.parse(before);old.version=3;expect(()=>parseDocument(JSON.stringify(old))).toThrow('version 4');s.addSketchExtrusion({kind:'rectangle',id:'profile',width:2,depth:3});expect(s.state.document.version).toBe(4);
 });
 it('keeps full source in portable append-only history, including restored branches and browser imports',async()=>{
  const s=createCadSession(),id=s.addCode(defaultCodeProgram());let bytes=await appendPortableRevision(undefined,s.state.document,'Create plate');const first=await readPortableHistory(bytes),firstId=first.project.headId;
  const p=defaultCodeProgram();p.parameters.width='80';s.updateCode(id,p);bytes=await appendPortableRevision(bytes,s.state.document,'Wider');const wider=await readPortableHistory(bytes),laterId=wider.project.headId;s.load(first.readDocument(firstId));bytes=await appendPortableRevision(bytes,s.state.document,'Restore',firstId);const history=await readPortableHistory(bytes);expect(history.revisions).toHaveLength(3);expect(history.revisions[2].parentId).toBe(firstId);expect(history.readDocument(laterId).nodes[id]).toMatchObject({program:{parameters:{width:'80'}}});
  const db=await openHistoryStore(`code-${crypto.randomUUID()}`);const imported=await db.importArchive(bytes);expect((await db.readDocument(imported.headId)).nodes[id]).toMatchObject({program:defaultCodeProgram()});await db.close();
  const corrupt=new Uint8Array(bytes);corrupt[corrupt.length-10]^=1;await expect(readPortableHistory(corrupt)).rejects.toThrow();
 });
});

it('derives portable session revision from validated entries rather than untrusted project metadata',async()=>{
 const session=createCadSession();session.addCode(defaultCodeProgram());const bytes=await appendPortableRevision(undefined,session.state.document,'Created');const archive=JSON.parse(new TextDecoder().decode(bytes));archive.project.serial=-20;archive.project.title='wrong';const portable=await readPortableHistory(new TextEncoder().encode(JSON.stringify(archive)));expect(portable.project.serial).toBe(1);expect(portable.project.title).toBe(session.state.document.title);
});
