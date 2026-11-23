// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {describe,expect,it} from 'vitest';
import {verifyOutlineSolve} from '../packages/editor/src/outline-constraint-solve.js';
import type {OutlineSolveRequest} from '../packages/editor/src/outline-constraint-solve.js';

const sandbox=createContext({});
sandbox.self=sandbox;
runInContext(readFileSync('packages/editor/assets/sketch-constraints.dart.js','utf8'),sandbox);
const run=(request:OutlineSolveRequest)=>JSON.parse(sandbox.solveBrickwrightOutline(JSON.stringify(request)));
const draft:OutlineSolveRequest={
 points:[[0,0],[38,3],[35,22],[2,20]],
 constraints:[
  {kind:'horizontal',edge:0},{kind:'vertical',edge:1},{kind:'parallel',edge:0,other:2},
  {kind:'perpendicular',edge:2,other:3},{kind:'length',edge:0,length:40},
  {kind:'equal',edge:0,other:2},{kind:'length',edge:1,length:20}
 ]
};
describe('dart_csp outline worker artifact',()=>{
 it('solves coupled edge relations and returns the correct rank',()=>{
  expect(verifyOutlineSolve(draft,run(draft))).toEqual({
   points:[[0,0],[40,0],[40,20],[0,20]],degrees:0
  });
  const partial={...draft,constraints:draft.constraints.slice(0,1)};
  expect(verifyOutlineSolve(partial,run(partial))).toMatchObject({degrees:5});
 });
 it('rejects incompatible dimensions and false worker success',()=>{
  const impossible:OutlineSolveRequest={...draft,constraints:[...draft.constraints,{kind:'length',edge:0,length:45}]};
  expect(()=>verifyOutlineSolve(impossible,run(impossible))).toThrow('Could not solve');
  expect(()=>verifyOutlineSolve(draft,{status:'solved',degrees:0,points:draft.points})).toThrow('did not meet');
  expect(()=>verifyOutlineSolve(draft,{status:'solved',degrees:0,points:[[1,1],[40,1],[40,21],[1,21]]})).toThrow('invalid outline');
 });
});
