import 'fake-indexeddb/auto';
import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,evaluateExpression,evaluateParameters,identityTransform,parseDocument,validateDocument,documentGeometryKey} from '@brickwright/cad-core';
import type {ParametricDesign} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {openHistoryStore} from '@brickwright/cad-history';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const design=():ParametricDesign=>({version:1,parameters:{width:{expression:'4 cm',unit:'mm'},half:{expression:'width / 2',unit:'mm'}},bindings:[]});
const fixture=()=>{const s=createCadSession(),id=s.add({kind:'box',size:[30,20,10]});const d=design();d.bindings=[{nodeId:id,property:'width',expression:'width'},{nodeId:id,property:'depth',expression:'half'}];s.setParametric(d);return {s,id};};
describe('optional parameter design intent',()=>{
  it('evaluates dependencies, precedence and unit conversion without JS',()=>{
    const d=design();d.parameters.offset={expression:'(width + 1 in) / 2',unit:'mm'};d.parameters.angle={expression:'3.141592653589793 rad',unit:'deg'};
    const values=evaluateParameters(d);expect(values.width.value).toBe(40);expect(values.half.value).toBe(20);expect(values.offset.value).toBeCloseTo(32.7);expect(values.angle.value).toBeCloseTo(180);
    expect(evaluateExpression('-(2 + 3) * 4 / 2',()=>{throw Error();}).value).toBe(-10);
  });
  it('refuses cycles, incompatible units, division by zero and unknown references',()=>{
    const d=design();d.parameters.width.expression='half';expect(()=>evaluateParameters(d)).toThrow('cycle');
    d.parameters.width.expression='90 deg';expect(()=>evaluateParameters(d)).toThrow('produce mm');
    d.parameters.width.expression='2 mm + 3';expect(()=>evaluateParameters(d)).toThrow('matching units');
    d.parameters.width.expression='1 / 0';expect(()=>evaluateParameters(d)).toThrow('division by zero');
    d.parameters.width.expression='missing';expect(()=>evaluateParameters(d)).toThrow('unknown');
  });
  it('bounds input and rejects scripts, property access and prototype names',()=>{
    for(const expression of ['globalThis.alert(1)','constructor.constructor(1)','width[0]','1; 2','1e999','('.repeat(34)+'1'+')'.repeat(34),'1+'.repeat(128)+'1'])expect(()=>evaluateExpression(expression,()=>({value:1,length:0,angle:0}))).toThrow();
    const d=design();d.parameters.constructor={expression:'2',unit:'mm'};expect(()=>evaluateParameters(d)).toThrow('invalid parameter');
  });
  it('recomputes a retained boolean and invalidates its physical geometry key',()=>{
    const {s,id}=fixture();const cutter=s.add({kind:'box',size:[5,40,20]});s.combine('subtract',[id,cutter]);
    expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(7000);
    const before=documentGeometryKey(s.state.document),d=structuredClone(s.state.document.parametric!);d.parameters.width.expression='60';s.setParametric(d);
    expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(16500);expect(documentGeometryKey(s.state.document)).not.toBe(before);
    expect(s.state.document.version).toBe(2);
  });
  it('applies all expressions atomically with undo/redo and preserves the previous design after failure',()=>{
    const {s,id}=fixture(),before=s.serialize(),revision=s.state.revision,d=structuredClone(s.state.document.parametric!);d.parameters.width.expression='-10';
    expect(()=>s.setParametric(d)).toThrow('dimensions');expect(s.serialize()).toBe(before);expect(s.state.revision).toBe(revision);
    d.parameters.width.expression='60';s.setParametric(d);expect((s.state.document.nodes[id] as {size:number[]}).size).toEqual([60,30,10]);
    s.undo();expect(s.serialize()).toBe(before);s.redo();expect((s.state.document.nodes[id] as {size:number[]}).size[0]).toBe(60);
  });
  it('prevents direct overwrites of driven values while keeping independent edits available',()=>{
    const {s,id}=fixture();expect(()=>s.update(id,{size:[22,20,10]})).toThrow('driven');s.update(id,{size:[40,20,15]});
    expect((s.state.document.nodes[id] as {size:number[]}).size).toEqual([40,20,15]);
    const d=structuredClone(s.state.document.parametric!);d.bindings.push({nodeId:id,property:'positionZ',expression:'width / 2'});s.setParametric(d);
    expect(()=>s.transform([{id,transform:identityTransform()}])).toThrow('driven');
  });
  it('retains dimension bindings in duplicates and cleans bindings when deleting bodies',()=>{
    const {s,id}=fixture();s.duplicate([id]);const copy=s.state.selection[0];expect(s.state.document.parametric!.bindings).toHaveLength(4);
    const d=structuredClone(s.state.document.parametric!);d.parameters.width.expression='50';s.setParametric(d);expect((s.state.document.nodes[copy] as {size:number[]}).size[0]).toBe(50);
    s.remove([id]);expect(s.state.document.parametric!.bindings.every(b=>b.nodeId===copy)).toBe(true);s.undo();expect(s.state.document.nodes[id]).toBeDefined();
  });
  it('refuses stale, unsupported, duplicate or missing-node bindings on import',()=>{
    const {s,id}=fixture();expect(parseDocument(s.serialize())).toEqual(s.state.document);
    const stale=structuredClone(s.state.document);(stale.nodes[id] as {size:number[]}).size[0]=45;expect(()=>validateDocument(stale)).toThrow('stale');
    const old=structuredClone(s.state.document);old.version=1;expect(()=>validateDocument(old)).toThrow('version 2');
    const bad=structuredClone(s.state.document);bad.parametric!.bindings.push(bad.parametric!.bindings[0]);expect(()=>validateDocument(bad)).toThrow('only one');
    bad.parametric!.bindings=[{nodeId:'missing',property:'width',expression:'width'}];expect(()=>validateDocument(bad)).toThrow('invalid binding');
    expect(()=>validateDocument({...s.state.document,parametric:null})).toThrow('schema');
  });
  it('requires explicit joint detachment before driving an articulated body',()=>{
    const s=createCadSession(createPresetDocument('hinge')),d=design();d.bindings=[{nodeId:s.state.document.roots[0],property:'positionZ',expression:'width'}];
    expect(()=>s.setParametric(d)).toThrow('detach joints');s.detachJoints(s.state.document.roots);s.setParametric(d);expect(s.state.document.nodes[s.state.document.roots[0]].transform.position[2]).toBe(40);
  });
  it('restores formula-bearing revisions and round-trips their full history backups',async()=>{
    const {s,id}=fixture(),store=await openHistoryStore(`parameters-${crypto.randomUUID()}`);const first=await store.append(s.state.document,'40 mm');
    const d=structuredClone(s.state.document.parametric!);d.parameters.width.expression='55';s.setParametric(d);const later=await store.append(s.state.document,'55 mm');
    s.load(await store.readDocument(first.id));expect(s.state.document.parametric!.parameters.width.expression).toBe('4 cm');
    const restore=await store.append(s.state.document,'Restore',first.id);expect(restore.parentId).toBe(first.id);expect((await store.readDocument(later.id)).parametric!.parameters.width.expression).toBe('55');
    const imported=await store.importArchive(await store.exportArchive(s.state.document.id));const restored=await store.readDocument(imported.headId);expect(restored.version).toBe(2);expect((restored.nodes[id] as {size:number[]}).size[0]).toBe(40);await store.close();
  });
});

it('evaluates safe degree math with dimensional checks and bounded function arguments',()=>{
 const lookup=(name:string)=>{throw Error(name);};
 expect(evaluateExpression('sin(30 deg) * 20 mm',lookup)).toEqual({value:expect.closeTo(10),length:1,angle:0});
 expect(evaluateExpression('sqrt(9 mm * 9 mm)',lookup)).toEqual({value:9,length:1,angle:0});
 expect(evaluateExpression('max(2 cm, 15 mm)',lookup)).toEqual({value:20,length:1,angle:0});
 expect(evaluateExpression('atan2(1 mm, 1 mm)',lookup).value).toBe(45);
 expect(evaluateExpression('abs(round(-2.5))',lookup).value).toBe(3);
 for(const source of ['sin(2 mm)','max(1 mm, 2 deg)','sqrt(1 mm)','sqrt(-1)','ln(0)','sin()','pow(1)','nope(1)','sin('.repeat(34)+'0'+')'.repeat(34)])expect(()=>evaluateExpression(source,lookup),source).toThrow();
});
