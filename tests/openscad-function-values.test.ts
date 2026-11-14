// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {compileCode,createCadSession,importOpenSCAD} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function evaluate(source:string,parameters:Record<string,string>={}){
 const program=importOpenSCAD(source);program.parameters=parameters;const s=createCadSession();try{s.addCode(program);return kernel.evaluate(s.state.document).volume;}finally{s.dispose();}
}
it('captures lexical function parameters and retains symbolic dimensions on edits',()=>{
 const source='size=2;function make(x)=function(y=3)x*y;f=make(size);cube(f());';
 expect(evaluate(source)).toBeCloseTo(216);expect(evaluate(source,{size:'3'})).toBeCloseTo(729);
 expect(evaluate('function make(x)=function(y)x+y;f=make(2);module p(x){cube(f(y=3));}p(20);')).toBeCloseTo(125);
});
it('passes and returns closures with independent capture environments',()=>{
 expect(evaluate('function make(x)=function(y)x+y;f=make(2);g=make(4);function apply(f,x)=f(x);cube([apply(f,1),apply(g,1),1]);')).toBeCloseTo(15);
 expect(evaluate('f=function(x)function(y)x+y;g=f(2);cube(g(3));')).toBeCloseTo(125);
 expect(evaluate('f=function(x)x;cube(is_function(f)&&!is_num(f)&&!is_string(f)&&!is_undef(f)?2:1);')).toBeCloseTo(8);
});
it('evaluates let bindings sequentially with lexical closure captures',()=>{
 expect(evaluate('x=7;cube(let(x=2,y=x+1) y);')).toBeCloseTo(27);
 expect(evaluate('x=7;f=let(x=2)function(y)x+y;cube(f(1));')).toBeCloseTo(27);
 expect(evaluate('f=let(x=2,g=function(y)x+y)g;cube(f(1));')).toBeCloseTo(27);
});
it('searches fixed tables with duplicate keys, selected columns and explicit missing matches',()=>{
 expect(evaluate('v=["size",3];table=[["size",2],v,["other",9]];matches=search(["size"],table,0)[0];cube(table[matches[len(matches)-1]][1]);')).toBeCloseTo(27);
 expect(evaluate('table=[["a",2],["b",3],["c",3]];cube(len(search([3],table,0,1)[0]));')).toBeCloseTo(8);
 expect(evaluate('cube(len(search(["missing"],[["x",1]],0)[0])+1);')).toBeCloseTo(1);
 expect(evaluate('cube(search(["a"],[["a",2],["a",3]],1)[0]+2);')).toBeCloseTo(8);
 expect(evaluate('cube(len(search(["a"],[["a",2],["a",3],["a",4]],2)[0]));')).toBeCloseTo(8);
});
it('keeps assertion conditions live through closure calls and unused let bindings',()=>{
 for(const source of ['n=2;f=function(x)assert(n>0)x;cube(f(2));','n=2;cube(let(unused=assert(n>0)2)2);']){
  const p=importOpenSCAD(source);p.parameters.n='-1';expect(()=>compileCode(p)).toThrow('Assertion failed');
 }
 expect(()=>importOpenSCAD('n=2;function make(v)=function(x)x;f=make(assert(n>0)2);cube(f(2));')).toThrow('parameter-dependent assertion');
 expect(()=>importOpenSCAD('n=2;f=assert(n>0)function(x)x;cube(f(2));')).toThrow('parameter-dependent assertion');
});
it('refuses dynamic lookup decisions and retains existing recursion and value-work limits',()=>{
 expect(()=>importOpenSCAD('n=2;v=search([n],[[2,3]],0);cube(len(v));')).toThrow('parameter-dependent search');
 expect(()=>importOpenSCAD('f=function(n)n==0?1:f(n-1);cube(f(100));')).toThrow('construction limit');
 expect(()=>importOpenSCAD('f=function(x)x;cube(f);')).toThrow();
 expect(()=>importOpenSCAD('f=function(x,x)x;cube(2);')).toThrow('function literal parameter');
 expect(()=>importOpenSCAD('cube(search("a",["a"]));')).toThrow('fixed needle and table');
 const values=Array(140).fill('1').join(',');expect(()=>importOpenSCAD(`a=search([${values}],[${values}],0);cube(2);`)).toThrow('construction limit');
});
