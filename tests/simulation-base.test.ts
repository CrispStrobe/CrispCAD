// SPDX-License-Identifier: BSD-3-Clause
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createCadSession,defaultSimulationSettings,identityTransform,parseDocument,serializeDocument,generateModelSource,compileModelSource} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {strToU8,unzipSync,zipSync} from 'fflate';
import {attachCadProject,extractCadProject} from '../packages/brickwright/src/index.js';
import {createSimulationController} from '../packages/editor/src/simulation-controller.js';

const client=vi.hoisted(()=>({send:vi.fn(),dispose:vi.fn()}));
vi.mock('../packages/editor/src/simulation-client.js',()=>({createSimulationClient:()=>client}));
beforeEach(()=>{
 vi.stubGlobal('document',Object.assign(new EventTarget(),{hidden:false,baseURI:'https://brickwright.test/'}));
 vi.stubGlobal('window',new EventTarget());
 client.send.mockReset().mockResolvedValue({time:0,poses:[],angles:{},speeds:{},linearPositions:{},linearSpeeds:{}});
 client.dispose.mockReset();
});
afterEach(()=>vi.unstubAllGlobals());

function assembly(fixBase?:boolean):CadDocument{
 const session=createCadSession();
 try{
  const a=session.add({kind:'box',size:[10,10,10]}),b=session.add({kind:'box',size:[10,10,10]},{transform:{...identityTransform(),position:[20,0,0]}});
  session.addJoint('hinge',a,b,[10,0,0],[0,1,0]);
  session.setSimulation({...defaultSimulationSettings(),...(fixBase===undefined?{}:{fixBase})});
  return structuredClone(session.state.document);
 }finally{session.dispose();}
}
const controllerFor=(session:ReturnType<typeof createCadSession>)=>createSimulationController(session,'/manifold.wasm',async()=>{},()=>{},()=>{});

it('retains optional free-base and fixed-base defaults through file, source and undo/redo round trips',()=>{
 const session=createCadSession(assembly(false)),free=session.serialize(),retained=session.state.document;
 expect(parseDocument(free).simulation?.fixBase).toBe(false);
 expect(compileModelSource(generateModelSource(retained),retained).simulation?.fixBase).toBe(false);
 session.setSimulation({...defaultSimulationSettings(),fixBase:true});
 const fixed=session.serialize();expect(parseDocument(fixed).simulation?.fixBase).toBe(true);
 expect(retained.simulation?.fixBase).toBe(false);
 session.undo();expect(session.serialize()).toBe(free);
 session.redo();expect(session.serialize()).toBe(fixed);
 const legacy=assembly();expect(serializeDocument(parseDocument(serializeDocument(legacy)))).toBe(serializeDocument(legacy));
 expect(Object.hasOwn(legacy.simulation!,'fixBase')).toBe(false);
 session.dispose();
});

it('rejects malformed base defaults before changing a project or its history',()=>{
 const session=createCadSession(assembly(false)),before=session.serialize(),revision=session.state.revision;
 for(const value of [null,0,1,'false',{},[]]){
  const invalid=JSON.parse(before);invalid.simulation.fixBase=value;
  expect(()=>parseDocument(JSON.stringify(invalid))).toThrow('Invalid simulation');
  expect(()=>session.setSimulation(invalid.simulation)).toThrow('Invalid simulation');
  expect(session.serialize()).toBe(before);expect(session.state.revision).toBe(revision);
 }
 session.dispose();
});

it('preserves the free-base default through the Lite SB3 sidecar without changing host state or history bytes',()=>{
 const document=assembly(false),original=zipSync({'project.json':strToU8('{"targets":[]}'),'brickwright/state.json':strToU8('{"keep":true}'),'brickwright/history.json':strToU8('{"revisions":[1,2,3]}')});
 const saved=attachCadProject(original,document),restored=extractCadProject(saved)!;
 expect(serializeDocument(restored)).toBe(serializeDocument(document));
 expect(restored.simulation?.fixBase).toBe(false);
 const before=unzipSync(original),after=unzipSync(saved);
 for(const [path,bytes] of Object.entries(before))expect(after[path]).toEqual(bytes);
});

it('adopts first-assembly settings into an unconfigured empty project in one undoable insertion',()=>{
 const source=assembly(false),session=createCadSession(),before=session.serialize();
 source.simulation!.groundFriction=.65;
 session.insert(source,[40,0,0]);
 const inserted=session.serialize();
 expect(session.state.revision).toBe(1);
 expect(session.state.document.simulation).toEqual(source.simulation);
 expect(session.state.document.joints?.[0].control?.port).toBe('A');
 source.simulation!.fixBase=true;source.simulation!.groundFriction=.1;
 expect(session.state.document.simulation?.fixBase).toBe(false);
 expect(session.state.document.simulation?.groundFriction).toBe(.65);
 session.undo();expect(session.serialize()).toBe(before);
 session.redo();expect(session.serialize()).toBe(inserted);
 session.dispose();
});

it('preserves host settings for nonempty or explicitly configured empty scenes',()=>{
 for(const populated of [false,true]){
  const session=createCadSession();session.setSimulation({...defaultSimulationSettings(),fixBase:true,gravity:[0,0,-1.62],groundFriction:.7});
  if(populated)session.add({kind:'box',size:[4,4,4]});
  const before=session.serialize(),settings=session.state.document.simulation;
  session.insert(assembly(false));expect(session.state.document.simulation).toEqual(settings);
  session.undo();expect(session.serialize()).toBe(before);session.dispose();
 }
 const existing=createCadSession();existing.add({kind:'box',size:[4,4,4]});existing.insert(assembly(false));
 expect(existing.state.document.simulation).toBeUndefined();existing.dispose();
});

it('refuses to overwrite opaque legacy simulation data when inserting a new assembly',()=>{
 const legacy=assembly();legacy.version=7;legacy.simulation={opaque:'retain'} as any;
 const session=createCadSession(legacy),before=session.serialize();
 expect(()=>session.insert(assembly(false))).toThrow('legacy');expect(session.serialize()).toBe(before);
 session.dispose();
});

it('passes the saved free-base default to the worker after insertion and keeps preview overrides out of history',async()=>{
 const session=createCadSession();session.insert(assembly(false));
 const controller=controllerFor(session),before=session.serialize(),revision=session.state.revision;
 try{
  expect(controller.fixBase).toBe(false);await controller.prepare();
  expect(client.send).toHaveBeenLastCalledWith(expect.objectContaining({op:'start',fixBase:false}));
  controller.setFixBase(true);await controller.prepare();
  expect(client.send).toHaveBeenLastCalledWith(expect.objectContaining({op:'start',fixBase:true}));
  expect(session.serialize()).toBe(before);expect(session.state.revision).toBe(revision);
  session.load(assembly(false));expect(controller.fixBase).toBe(false);
  await controller.prepare();expect(client.send).toHaveBeenLastCalledWith(expect.objectContaining({op:'start',fixBase:false}));
 }finally{controller.dispose();session.dispose();}
});

it('retains automatic joint-based behavior when no saved default exists and ignores legacy opaque fields',()=>{
 for(const document of [assembly(),{...assembly(),version:7,simulation:{fixBase:false}} as CadDocument]){
  const session=createCadSession(document),controller=controllerFor(session);
  expect(controller.fixBase).toBe(true);controller.dispose();session.dispose();
 }
 const empty=createCadSession(),controller=controllerFor(empty);
 expect(controller.fixBase).toBe(false);empty.setSimulation({...defaultSimulationSettings(),fixBase:true});expect(controller.fixBase).toBe(true);
 controller.dispose();empty.dispose();
});
