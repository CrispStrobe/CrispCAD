// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {compileCode,importOpenSCAD} from '@brickwright/cad-core';
import type {CodeShape} from '@brickwright/cad-core';

function shapes(source:string,parameters:Record<string,string>={}){
 const program=importOpenSCAD(source);program.parameters=parameters;
 const result:CodeShape[]=[];
 function visit(shape:CodeShape){result.push(shape);if('shapes' in shape)shape.shapes.forEach(visit);else if('shape' in shape)visit(shape.shape);}
 visit(compileCode(program).shape);return result;
}
const counts=(source:string,parameters:Record<string,string>={})=>shapes(source,parameters).flatMap(s=>s.kind==='cylinder'?[s.segments]:[]);
const normalizer='module part(){$fa=($fa>=12)?1:$fa;$fs=($fs>=2)?.4:$fs;cylinder(r=1,h=2);}';

it('reads fragment builtins as scalars without changing unspecified legacy tessellation',()=>{
 expect(shapes('cube([$fa,$fs,1+$fn]);').find(s=>s.kind==='box')).toEqual({kind:'box',size:[12,2,1]});
 expect(counts('cylinder(r=1,h=2);')).toEqual([48]);
 expect(counts('unused=$fa; cylinder(r=1,h=2);')).toEqual([48]);
 expect(counts(normalizer+'part();')).toEqual([16]);
});

it('prefers global and caller special controls to self-shadow builtin fallback',()=>{
 expect(counts('$fa=9;$fs=.1;'+normalizer+'part();')).toEqual([40]);
 expect(counts(normalizer+'part($fa=6,$fs=.1);')).toEqual([60]);
 expect(counts(normalizer+'translate([0,0,0],$fa=4,$fs=.1)part();')).toEqual([63]);
 expect(counts('q=9;$fa=q;$fs=.1;'+normalizer+'part();',{q:'6'})).toEqual([60]);
});

it('restores outer controls and keeps positive fn precedence through nested calls',()=>{
 expect(counts(normalizer+'module outer($fa=9,$fs=.1){part();cylinder(r=1,h=2);}outer();cylinder(r=1,h=2);')).toEqual([40,40,48]);
 expect(counts(normalizer+'part($fn=7);')).toEqual([7]);
 expect(counts('module part(){$fn=$fn;'+normalizer+'part();}part($fn=9);')).toEqual([9]);
 expect(counts('module part(){$fn=$fn;cylinder(r=1,h=2);}part();')).toEqual([5]);
});

it('keeps ordinary cyclic bindings and existing fragment resource guards fail closed',()=>{
 for(const source of ['module p(){a=a+1;cube(a);}p();','module p(){a=b;b=a;cube(a);}p();','a=b;b=a;cube(a);'])expect(()=>importOpenSCAD(source),source).toThrow('dependency cycle');
 expect(()=>importOpenSCAD(normalizer+'part($fn=4097);')).toThrow();
 expect(()=>importOpenSCAD('module p(){$fa=$fa;$fs=$fs;sphere(r=1,$fn=4096);}p();')).toThrow();
});


it('distinguishes construction nesting without changing resource classification or limits',()=>{
 const prefix='translate([0,0,0])'.repeat(33);
 for(const source of [prefix+'cube(1);','linear_extrude(1)'+prefix+'square(1);']){
  try{importOpenSCAD(source);throw new Error('Expected depth rejection');}
  catch(error){expect(error).toMatchObject({code:'resource-limit',detail:'OpenSCAD construction nesting exceeds 32'});}
 }
 expect(counts('cylinder(r=1,h=2);')).toEqual([48]);
});
