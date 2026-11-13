// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {codeExamples,codeExampleProgram,compileCode,createCadSession} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,importSTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it('offers 34 distinct, independently editable programs',()=>{
 expect(codeExamples.length).toBeGreaterThanOrEqual(34);expect(new Set(codeExamples.map(e=>e.id)).size).toBe(codeExamples.length);
 const a=codeExampleProgram('box');a.parameters.width='80';expect(codeExampleProgram('box').parameters).toEqual({});
});
for(const example of codeExamples)it(`builds and round-trips STL: ${example.id}`,()=>{
 const program=codeExampleProgram(example.id);compileCode(program);const session=createCadSession();session.addCode(program,example.title.en);const geometry=kernel.evaluate(session.state.document);
 expect(geometry.bodies).toHaveLength(1);expect(geometry.volume).toBeGreaterThan(0);const body=geometry.bodies[0];expect(body.positions.every(Number.isFinite)).toBe(true);
 const mesh=importSTL(exportSTL(geometry.bodies));const imported=createCadSession();imported.add({...mesh,kind:"mesh"});const roundtrip=kernel.evaluate(imported.state.document);expect(roundtrip.volume).toBeCloseTo(geometry.volume,1);
 session.update(session.state.document.roots[0],{transform:{position:[0,0,-body.bounds.min[2]],rotation:[0,0,0],scale:[1,1,1]}});expect(kernel.evaluate(session.state.document).bodies[0].bounds.min[2]).toBeCloseTo(0,5);
});
