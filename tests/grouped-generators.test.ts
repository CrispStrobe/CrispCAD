// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,importOpenSCAD} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function volume(source:string,parameters:Record<string,string>={}){const program=importOpenSCAD(source),s=createCadSession();try{s.addCode({...program,parameters});return kernel.evaluate(s.state.document).volume;}finally{s.dispose();}}
for(const [list,expected]of [
 ['[for(i=[1:2])(for(j=[3:4])i+j)]',6554],
 ['[for(i=[1:2])(each [i,i*2])]',4221],
 ['[for(i=[1:2])i,(for(j=[3:4])j)]',4321],
 ['[for(i=[1:2])(let(x=i*2) for(j=[1:2])x+j)]',6543],
 ['[for(i=[1:2])let(x=i*2)(for(j=[1:2])x+j)]',6543],
]as const)it('matches official grouped-generator ordering: '+list,()=>{
 expect(volume(`v=${list};cube([v[0]+10*v[1]+100*v[2]+1000*v[3],1,1]);`)).toBeCloseTo(expected);
});
it('keeps normal parenthesized expressions and let arithmetic distinct from generators',()=>{
 expect(volume('v=[for(i=[1:2])(let(x=i*2)x)+3];cube([v[0]+10*v[1],1,1]);')).toBeCloseTo(75);
 expect(volume('v=[(let(n=2)n)+3];cube(v[0]);')).toBeCloseTo(125);
 expect(volume('v=[0,(for(i=[1:2])i)];cube(v[0]+10*v[1]+100*v[2]);')).toBeCloseTo(210**3);
 expect(volume('v=[for(i=[1:3])(if(i%2) i else -i)];cube(abs(v[0]+10*v[1]+100*v[2]));')).toBeCloseTo(281**3);
});
it('retains grouped generators through edits, empty inputs and nested reductions',()=>{
 const src='n=3;v=max([for(i=[1:n])(for(j=[1:n])if(i!=j)i*j)]);cube(v);';expect(volume(src)).toBeCloseTo(216);expect(volume(src,{n:'4'})).toBeCloseTo(1728);
 expect(volume('v=[for(i=[])(for(j=[1:2])unsupported())];cube(len(v)+1);')).toBeCloseTo(1);
});
it('does not accept unsupported extra grouping and retains depth/work guards',()=>{
 for(const expression of ['[(for(i=[1:2])i)]','[for(i=[1:2])((for(j=[1:2])i+j))]'])expect(()=>importOpenSCAD(`v=${expression};cube(len(v));`)).toThrow();
 const source='v=['+'for(i=[1:2])('.repeat(34)+'1'+')'.repeat(34)+'];cube(len(v));';expect(()=>importOpenSCAD(source)).toThrow(/limit|nesting/);
});
