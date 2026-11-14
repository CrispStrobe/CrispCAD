// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {compileCode,createCadSession,importOpenSCAD,exportOpenSCAD} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
const program=(source:string,parameters:Record<string,string>={})=>({version:1 as const,language:'brickwright-cad-script' as const,source,parameters});
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function volume(p:ReturnType<typeof program>){const s=createCadSession();try{s.addCode(p);return kernel.evaluate(s.state.document).volume;}finally{s.dispose();}}
it('keeps aliases lazy, unit checked, separate from parameters, and resolves forward references',()=>{
 const p=program('const width=half*2; const unused=1/0; param half:mm=2; return box(width,3,4);');
 expect(volume(p)).toBeCloseTo(48);expect(Object.keys(compileCode(p).parameters)).toEqual(['half']);expect(compileCode(p).values.width).toBeUndefined();p.parameters.half='3';expect(volume(p)).toBeCloseTo(72);
 expect(()=>volume(program('const angle=3 deg; return box(angle,2,3);'))).toThrow('Expected mm');
 expect(()=>compileCode({...p,parameters:{width:'4'}})).toThrow('Unknown parameter override');
});
it('keeps inactive assertion and numeric domains inactive through alias dependencies',()=>{
 const p=program('param flag:scalar=1; const bad=assertValue(false,1/0); const selected=flag?2:bad; return box(selected,2,2);');
 expect(volume(p)).toBeCloseTo(8);p.parameters.flag='0';expect(()=>compileCode(p)).toThrow('Assertion failed');
});
it('caches separately for each loop environment and retains parameter edits',()=>{
 const p=program('param width:scalar=2; const sized=width+i; return forRange(i,1,3,1,move([i*10,0,0],box(sized,1,1)));');
 expect(volume(p)).toBeCloseTo(12);p.parameters.width='3';expect(volume(p)).toBeCloseTo(15);
 expect(()=>compileCode(program('const x=i+1; return box(x,1,1);'))).toThrow('Unknown parameter');
});
it('refuses collisions, cycles, excessive dependencies, statements and expression sizes',()=>{
 for(const source of ['param x:mm=2;const x=1;return box(1,1,1);','const x=2;param x:mm=1;return box(1,1,1);','let x=box(1,1,1);const x=2;return x;','const x=2;let x=box(1,1,1);return x;','const a=b;const b=a;return box(a,1,1);'])expect(()=>compileCode(program(source))).toThrow();
 const chain=Array.from({length:34},(_,i)=>`const a${i}=${i===33?'1':`a${i+1}`};`).join('');
 try{compileCode(program(chain+'return box(a0,1,1);'));throw Error('expected limit');}catch(e:any){expect(e.code).toBe('resource-limit');}
 expect(()=>compileCode(program(Array.from({length:256},(_,i)=>`const a${i}=1;`).join('')+'return box(1,1,1);'))).toThrow('Too many statements');
 expect(()=>compileCode(program('const x='+Array(600).fill('1').join('+')+';return box(x,1,1);'))).toThrow('1024');
});
it('reuses finite alias DAGs without exponential evaluation and aborts invalid edits atomically',()=>{
 const declarations=Array.from({length:24},(_,i)=>`const a${i}=${i===23?'1':`a${i+1}+a${i+1}`};`).join('');expect(volume(program(declarations+'return box(a0/8388608,1,1);'))).toBeCloseTo(1);
 const p=program('param n:scalar=2;const v=assertValue(n>0,n);return box(v,2,2);'),s=createCadSession();try{const id=s.addCode(p),before=s.serialize();expect(()=>s.updateCode(id,{...p,parameters:{n:'-1'}})).toThrow('Assertion failed');expect(s.serialize()).toBe(before);}finally{s.dispose();}
});
it('keeps symbolic vector indexing and typed predicates live across valid and invalid edits',()=>{
 const p=importOpenSCAD('axis=0;v=[2,3][axis];cube([v+1,v+1,1]);');expect(volume(p)).toBeCloseTo(9);p.parameters.axis='1';expect(volume(p)).toBeCloseTo(16);p.parameters.axis='2';expect(()=>compileCode(p)).toThrow();
 expect(volume(importOpenSCAD('n=0;v=[2,3][n];cube(is_list(v)?1:2);'))).toBeCloseTo(8);
 expect(volume(importOpenSCAD('cube(is_undef(len(2))?2:1);'))).toBeCloseTo(8);
 expect(()=>importOpenSCAD('cube("x"+2);')).toThrow('numeric operation');
});
it('retains condition guards when inspecting conditional typed arguments that are otherwise ignored',()=>{
 for(const expr of ['is_list(assert(n>0)(flag?1:undef))','len(assert(n>0)(flag?[1]:[2]))']){
  const p=importOpenSCAD(`n=2;flag=1;function unused(v)=2;cube(unused(${expr}));`);p.parameters.n='-1';expect(()=>compileCode(p)).toThrow('Assertion failed');
 }
});

it('preserves nested undefined-result assertions through type tests, arithmetic and unused arguments',()=>{
 for(const body of ['is_undef(assert(n>0)undef)','is_undef(assert(n>0)assert(n<10)undef)','(assert(n>0)undef)==4','is_undef(len(assert(n>0)2))','is_undef((assert(n>0)undef)+1)']){
  const p=importOpenSCAD(`n=2;function unused(v)=2;cube(unused(${body}));`);expect(volume(p)).toBeCloseTo(8);p.parameters.n='-1';expect(()=>compileCode(p)).toThrow('Assertion failed');
 }
 const p=importOpenSCAD('n=2;cube(is_undef(n>0?undef:assert(false)undef)?2:1);');expect(volume(p)).toBeCloseTo(8);p.parameters.n='-1';expect(()=>compileCode(p)).toThrow('Assertion failed');
});
