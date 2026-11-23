// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {compileModelSource,createCadSession,createDocument,identityTransform,parseDocument,validateDocument} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL} from '@brickwright/cad-geometry';
import {decodeStep,maxStepBytes} from '../packages/editor/src/decode-step.js';
import type {StepMesh} from '../packages/editor/src/decode-step.js';

const asset=(path:string)=>readFileSync(path);
const wasm=Uint8Array.from(asset('packages/editor/assets/step-tessellator.wasm')).buffer;
const motor='library/sources/adafruit-motors/3777 TT Motor/3777 TT Motor.step';
const bounds=(parts:StepMesh[])=>{
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const {positions} of parts)positions.forEach((value,index)=>{
  const axis=index%3;
  min[axis]=Math.min(min[axis],value);
  max[axis]=Math.max(max[axis],value);
 });
 return {min,max};
};

it('uses the published STEP units and keeps named supplier meshes with their colors',async()=>{
 const input=asset(motor),meshes=await decodeStep(wasm,input);
 expect(meshes).toHaveLength(8);
 expect(meshes[0]).toMatchObject({name:'TT Motor 3777 v10 / body A',color:'#fff985'});
 expect(bounds(meshes)).toEqual({min:[-11.2,-18.3,-54.6],max:[11.2,18.3,16]});
 const metres=await decodeStep(wasm,new TextEncoder().encode(input.toString().replace('SI_UNIT(.MILLI.,.METRE.)','SI_UNIT($,.METRE.)')));
 expect(bounds(metres)).toEqual({min:[-11200,-18300,-54600],max:[11200,18300,16000]});
});

it('preserves the placed parts of the retained Feather RP2040 assembly',async()=>{
 const meshes=await decodeStep(wasm,asset('library/sources/adafruit-electronics/4884 Feather RP2040.step'));
 expect(meshes.length).toBeGreaterThan(20);
 const {min,max}=bounds(meshes);
 expect(max[0]-min[0]).toBeGreaterThan(20);
 expect(max[0]-min[0]).toBeLessThan(65);
 expect(max[1]-min[1]).toBeGreaterThan(15);
 expect(max[1]-min[1]).toBeLessThan(65);
});

it('rejects invalid input and bounds the reader input before instantiating',async()=>{
 await expect(decodeStep(wasm,new TextEncoder().encode('invalid STEP'))).rejects.toThrow();
 await expect(decodeStep(wasm,new Uint8Array(maxStepBytes+1))).rejects.toThrow('file limit');
});

it('retains an open reference without admitting it into the printable mesh',async()=>{
 const document=createDocument('Source fixture');
 document.version=30;
 const id='bracket';
 document.nodes[id]={
  id,kind:'mesh',surface:true,reference:true,name:'Reference face',color:'#556677',
  positions:[0,0,0,10,0,0,0,5,0],indices:[0,1,2],
  transform:{...identityTransform(),position:[3,4,5],rotation:[0,0,90]}
 };
 document.roots=[id];
 const session=createCadSession();
 session.insert(document,[0,0,0],{label:'Import geometry'});
 const doc=parseDocument(session.serialize());
 expect(doc.version).toBe(30);
 expect(compileModelSource(session.modelSource,doc).nodes).toEqual(doc.nodes);
 expect(()=>validateDocument({...doc,version:29})).toThrow('Surface meshes');
 const kernel=await createGeometryKernel({wasmBinary:asset('node_modules/manifold-3d/manifold.wasm')});
 const geometry=kernel.evaluate(doc);
 expect(geometry.triangles).toBe(0);
 expect(geometry.bodies[0]).toMatchObject({reference:true,volume:0,bounds:{min:[-2,4,5],max:[3,14,5]}});
 expect(()=>exportSTL(geometry.bodies)).toThrow('no solid triangles');
 session.undo();
 expect(session.state.document.roots).toEqual([]);
});
