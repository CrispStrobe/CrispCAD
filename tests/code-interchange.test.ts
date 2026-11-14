// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {importOpenSCAD,exportOpenSCAD,exportJSCAD,exportCodeSource,createCadSession,codeExamples,codeExampleProgram,compileCode} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
let kernel:GeometryKernel;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const geometry=(source:string)=>{const s=createCadSession();s.addCode(importOpenSCAD(source));return kernel.evaluate(s.state.document);};
it('preserves OpenSCAD default origins, explicit centres, dimensions, diameters and transform order',()=>{
 expect(geometry('cube([10,20,30]);').bodies[0].bounds).toEqual({min:[0,0,0],max:[10,20,30]});expect(geometry('cube(10, true);').bodies[0].bounds.min).toEqual([-5,-5,-5]);
 expect(geometry('cylinder(h=20,d=10,$fn=48);').bodies[0].bounds.min[2]).toBe(0);expect(geometry('cylinder(20,5,center=true);').bodies[0].bounds.min[2]).toBe(-10);
 const result=geometry('translate([10,0,0]) rotate([0,0,90]) cube([2,4,6],center=true);');expect(result.bodies[0].bounds.min[0]).toBeCloseTo(8);expect(result.bodies[0].bounds.min[1]).toBeCloseTo(-1);
});
it('retains parameter expressions and accepts scalar scale, comments and named vectors',()=>{
 const p=importOpenSCAD('/* source */ width=20; height=width/2; $fn=48; difference(){ translate(v=[0,0,height/2]) cube([width,width,height],true); cylinder(h=50,r=3,center=true); }');expect(compileCode(p).values.height.value).toBe(10);p.parameters.width='30';expect(compileCode(p).values.height.value).toBe(15);expect(geometry('scale(2) cube(10);').volume).toBeCloseTo(8000);
});
it('preserves solid geometry through explicit constant color wrappers and discloses omitted appearance',()=>{
 const source='module part(size=4){color("#a8b0b2",alpha=0.8){cube(size,true); translate([size,0,0]) cylinder(2,1,1,$fn=30,center=true);}} part();';
 const plain='module part(size=4){{cube(size,true); translate([size,0,0]) cylinder(2,1,1,$fn=30,center=true);}} part();';
 expect(geometry(source).volume).toBeCloseTo(geometry(plain).volume);
 expect(geometry(source).bodies[0].bounds).toEqual(geometry(plain).bodies[0].bounds);
 expect(importOpenSCAD(source).source).toContain('Appearance colors omitted; solid geometry retained.');
 expect(geometry('color(c=[0.2,1,0.4],alpha=.5) cube(3);').volume).toBeCloseTo(27);
 expect(geometry('color([1,0,0,0.5]) cube(2);').volume).toBeCloseTo(8);
 expect(geometry('module color(){cube(3);} color();').volume).toBeCloseTo(27);
 for(const unsupported of ['color("red",alpha=2) cube(2);','color(c="red",0.5) cube(2);','color([1,0]) cube(2);','color([1.1,0,0]) cube(2);','color("red",other=1) cube(2);','color("red") import("file.stl");','color(fetch()) cube(2);'])expect(()=>importOpenSCAD(unsupported),unsupported).toThrow();
});
it('propagates tagged literal module colors without coercing strings into CAD expressions',()=>{
 const source='module part(col="#3b4747"){shade=col;color(shade) cube([4,2,.2],true);} part();';
 expect(geometry(source).volume).toBeCloseTo(1.6,12);
 expect(geometry(source.replace('part();','part(col="white");')).bodies[0].bounds).toEqual({min:[-2,-1,-.1],max:[2,1,.1]});
 expect(geometry('module inner(c){color(c)cube(2);} module outer(c="red"){local=c;inner(local);} outer("#fff");').volume).toBeCloseTo(8);
 expect(geometry('module part(){shade="red";color(shade)cube(2);}part();').volume).toBeCloseTo(8);
 const converted=importOpenSCAD(source);expect(converted.source).not.toContain('#3b4747');expect(converted.source).toContain('Appearance colors omitted');
 for(const source of [
  'module part(c="2"){cube(c);}part();',
  'module part(c="2"){cylinder(c,1);}part();',
  'module part(c="true"){cube(2,center=c);}part();',
  'module part(c="red"){cube(c+1);}part();',
  'module part(c="not a color"){color(c)cube(2);}part();',
  'module part(c="red"+"blue"){color(c)cube(2);}part();',
  'color(fetch("red"))cube(2);',
  'module part(c="2); return box(9,9,9); //"){cube(c);}part();',
 ])expect(()=>importOpenSCAD(source),source).toThrow();
});
it('selects tagged constant palettes through literal module indices, defaults and lexical aliases',()=>{
 const source='module part(palette=[["red","white"],["blue","#fff"]],Mat=0){alias=palette;shade=alias[Mat][1];color(shade)cube([2,3,4]);}part();';
 expect(geometry(source).volume).toBeCloseTo(24);
 expect(geometry(source.replace('part();','part(Mat=1);')).volume).toBeCloseTo(24);
 expect(geometry(source.replace('part();','part(palette=[["green","#123"],["red","white"]],Mat=1);')).volume).toBeCloseTo(24);
 expect(geometry('module outer(Mat=0){palette=["red","not a color"];module inner(){color(palette[Mat])cube(2);}translate([10,0,0]){Mat=1;inner();}}outer();').volume).toBeCloseTo(8);
 expect(geometry('module part(){palette=["red"];index=0;alias=index;color(palette[alias])cube(2);}part();').volume).toBeCloseTo(8);
 expect(importOpenSCAD(source).source).not.toContain('palette');
});
it('rejects invalid palette indices and unsafe numeric coercions',()=>{
 const wrap=(index:string)=>`module part(Mat=0){palette=["red","blue"];color(palette[${index}])cube(2);}part();`;
 for(const index of ['-1','2','unknown','fetch()','"0"'])expect(()=>importOpenSCAD(wrap(index)),index).toThrow();
 for(const source of [
  'module part(){palette=["red"];cube(palette);}part();',
  'module part(){palette=["2"];cylinder(palette[0],1);}part();',
  'module part(){palette=["red"];cube(palette+1);}part();',
  'module part(){palette=["not a color"];color(palette[0])cube(2);}part();',
 ])expect(()=>importOpenSCAD(source),source).toThrow();
});
it('bounds palette alias expansion before a compact branching source can exhaust resources',()=>{
 const aliases=['p0=["red"];',...Array.from({length:20},(_,i)=>`p${i+1}=[p${i},p${i}];`)].join('');
 expect(geometry(`module part(){${aliases}color(p20${'[0]'.repeat(21)})cube(2);}part();`).volume).toBeCloseTo(8);
 for(const source of [
  `module part(){palette=[${Array(257).fill('"red"').join(',')}];color(palette[0])cube(2);}part();`,
  `module part(){palette=${'['.repeat(34)}"red"${']'.repeat(34)};cube(2);}part();`,
 ]){try{importOpenSCAD(source);throw Error('Expected resource failure');}catch(error:any){expect(error.code,source).toBe('resource-limit');}}
 expect(()=>importOpenSCAD('module part(){palette=[palette];color(palette[0])cube(2);}part();')).toThrow('dependency cycle');
});
it('specializes the readonly preview builtin to full rendering and exports explicit facet counts',()=>{
 const counts=(shape:any):number[]=>'segments'in shape?[shape.segments]:'shapes'in shape?shape.shapes.flatMap(counts):'shape'in shape?counts(shape.shape):[];
 for(const segments of [30,64]){
  const program=importOpenSCAD(`cylinder(2,1,$fn=$preview?90:${segments});`);
  expect(program.source).toContain('Full-render import context: $preview = false.');
  expect(counts(compileCode(program).shape)).toEqual([segments]);
  const scad=exportOpenSCAD(program),jscad=exportJSCAD(program);
  expect(scad).toMatch(new RegExp(`\\$fn\\s*=\\s*${segments}`));expect(jscad).toMatch(new RegExp(`segments:\\s*${segments}`));
  expect(scad+jscad).not.toContain('$preview');expect(counts(compileCode(importOpenSCAD(scad)).shape)).toEqual([segments]);
 }
 expect(geometry('cube($preview?1/0:3);').volume).toBeCloseTo(27);
 expect(importOpenSCAD('module unused(){cube($preview?1:2);}cube(3);').source).not.toContain('Full-render import context');
 const session=createCadSession(),before=structuredClone(session.state.document);
 for(const source of ['$preview=true;cube(2);','module part(){$preview=true;cube(2);}part();','module part($preview){cube(2);}part(false);','module part($preview=false){cube(2);}part();','cube(2,$preview=true);','for($preview=[0])cube(2);','vector=[2,3];cube(vector[$preview]);','module part(i=$preview){vector=[2,3];cube(vector[i]);}part();','module unused(){$preview=true;}cube(2);'])expect(()=>session.addCode(importOpenSCAD(source)),source).toThrow();
 expect(session.state.document).toEqual(before);expect(importOpenSCAD('cube(2);').source).not.toContain('Full-render import context');
});
it('indexes numeric vectors with module-local literal provenance while retaining symbolic coordinates',()=>{
 const source='width=4;module part(Size=0){table=[[width,2,1],[6,3,2]];cube(table[Size]);}part();';
 const program=importOpenSCAD(source);program.parameters.width='5';expect(compileCode(program).shape).toMatchObject({kind:'move',shape:{kind:'box',size:[5,2,1]}});
 expect(geometry(source.replace('part();','part(Size=1);')).volume).toBeCloseTo(36);
 expect(geometry('module part(){index=1;alias=index;vector=[2,3];cube(vector[alias]);}part();').volume).toBeCloseTo(27);
 expect(geometry('module outer(i=0){vector=[2,3];module inner(){cube(vector[i]);}translate([10,0,0]){i=1;inner();}}outer();').volume).toBeCloseTo(8);
 const wrap=(index:string)=>`module part(i=0){vector=[2,3];cube(vector[${index}]);}part();`;
 for(const index of ['-1','2','unknown','$preview','"0"','fetch()'])expect(()=>importOpenSCAD(wrap(index)),index).toThrow();
 for(const source of ['global=0;module part(){vector=[2,3];cube(vector[global]);}part();','function index()=0;module part(i){vector=[2,3];cube(vector[i]);}part(index());','module part(i=0+0){vector=[2,3];cube(vector[i]);}part();','module part(){vector=[2,3];for(i=[0])cube(vector[i]);}part();','vector=[2,3];function size(i)=vector[i];cube(size(0));'])expect(geometry(source).volume,source).toBeCloseTo(8);expect(()=>importOpenSCAD('module part(){vector=["2","3"];cube(vector[0]);}part();')).toThrow();
 const aliases=Array.from({length:34},(_,i)=>`i${i}=${i===33?'0':`i${i+1}`};`).join('');
 try{importOpenSCAD(`module part(){${aliases}vector=[2,3];cube(vector[i0]);}part();`);throw Error('Expected resource failure');}catch(error:any){expect(error.code).toBe('resource-limit');}
});
it('normalizes only two-component translations to XY with zero Z and preserves lexical dimensions',()=>{
 expect(geometry('translate([0,0])cube([2,3,4]);').bodies[0].bounds).toEqual({min:[0,0,0],max:[2,3,4]});
 const source='translate([7,-3])cube([2,4,6],true);',program=importOpenSCAD(source);
 expect(geometry(source).bodies[0].bounds).toEqual({min:[6,-5,-3],max:[8,-1,3]});
 expect(program.source).toContain('Two-component translations interpreted as [x,y,0].');
 expect(exportOpenSCAD(program)).toContain('[7, -3, 0]');expect(exportJSCAD(program)).toContain('[7, -3, 0]');
 expect(geometry(exportOpenSCAD(program)).bodies[0].bounds).toEqual(geometry(source).bodies[0].bounds);
 const parametric=importOpenSCAD('x=4;module part(v=[x,2]){alias=v;translate(v=alias,$fn=20)sphere(1);}part();');parametric.parameters.x='9';
 expect(compileCode(parametric).shape).toMatchObject({kind:'move',vector:[9,2,0],shape:{kind:'sphere',segments:20}});
 expect(geometry('module outer(x=3){offset=[x,2];module inner(){translate(offset)cube(2,true);}translate([10,0]){x=9;inner();}}outer();').bodies[0].bounds).toEqual({min:[12,1,-1],max:[14,3,1]});
 const counts=(shape:any):number[]=>'segments'in shape?[shape.segments]:'shapes'in shape?shape.shapes.flatMap(counts):'shape'in shape?counts(shape.shape):[];
 expect(counts(compileCode(importOpenSCAD('$fn=12;translate([1,2],$fn=20)sphere(1);translate([4,5,6])sphere(1);')).shape)).toEqual([20,12]);
 for(const source of ['translate([])cube(2);','translate([1])cube(2);','translate([1,2,3,4])cube(2);','translate(2)cube(2);','translate(["1",2])cube(2);','translate(["red","blue"])cube(2);','translate([1,[2]])cube(2);','translate([1/0,2])cube(2);','translate([1e8,2])cube(2);','rotate([1,2])cube(2);','scale([1,2])cube(2);','cube([1,2]);'])expect(()=>importOpenSCAD(source),source).toThrow();
 expect(importOpenSCAD('translate([1,2,3])cube(2);').source).not.toContain('Two-component translations interpreted');
 expect(importOpenSCAD('module unused(){translate([1,2])cube(2);}cube(2);').source).not.toContain('Two-component translations interpreted');
});
it('scopes transform fragment counts through child modules and restores each enclosing scope',()=>{
 const counts=(shape:any):number[]=>'segments'in shape?[shape.segments]:'shapes'in shape?shape.shapes.flatMap(counts):'shape'in shape?counts(shape.shape):[];
 const source='$fn=12; module part(){sphere(1);} translate([0,0,0],$fn=20){part(); rotate([0,0,45],$fn=24){scale(2,$fn=28) part(); part();} sphere(1,$fn=16); part();} translate([8,0,0]) part();';
 expect(counts(compileCode(importOpenSCAD(source)).shape)).toEqual([20,28,24,16,20,12]);
 const parametric=importOpenSCAD('count=20; translate([0,0,0],$fn=count) sphere(1);');parametric.parameters.count='24';expect(counts(compileCode(parametric).shape)).toEqual([24]);
 expect(geometry('linear_extrude(2) translate([1,0],$fn=4) circle(1);').volume).toBeCloseTo(4);
 for(const source of ['translate([0,0,0],$fn=[20]) sphere(1);','translate([0,0,0],$fn=5000) sphere(1);','rotate(0,$fn=3) sphere(1);','translate([0,0,0],$fn=1/0) sphere(1);'])expect(()=>importOpenSCAD(source),source).toThrow();
});
it('retains highlighted intersection operands and reports omitted preview appearance',()=>{
 const source='intersection(){#cube(0.5,center=false,);cylinder(1,0.5,0.5,$fn=40,center=true);}';
 const converted=importOpenSCAD(source),result=geometry(source);
 expect(converted.source).toContain('Preview highlights omitted; solid geometry retained.');
 expect(result.bodies[0].bounds).toEqual({min:[0,0,0],max:[0.5,0.5,0.5]});
 expect(result.volume).toBeCloseTo(.625*Math.sin(Math.PI/20),12);
 expect(geometry('linear_extrude(2) #square(3);').volume).toBeCloseTo(18);
 for(const modifier of ['%','*'])expect(()=>geometry(`${modifier}cube(2);`),modifier).toThrow('no printable');expect(geometry('!cube(2);').volume).toBeCloseTo(8);
 expect(()=>importOpenSCAD('#import("file.stl");')).toThrow();
});
it('refuses unsupported geometry and language features rather than approximating or executing them',()=>{
 for(const source of ['include <foo.scad>;','linear_extrude(height=5,v=[1,0,0]) square(2);','sphere($fn=1200);','import("https://example.com/a.stl");'])expect(()=>importOpenSCAD(source),source).toThrow();
});
it('exports effective overrides as readable native defaults, preserving dependencies and comments',()=>{
 const p=codeExampleProgram('box');p.parameters={width:'40',height:'width / 2'};const text=exportCodeSource(p);expect(text).toContain('\n');const values=compileCode({...p,source:text,parameters:{}}).values;expect(values.width.value).toBe(40);expect(values.height.value).toBe(20);
 const commented={...p,source:'// param width: mm = 1;\nparam width: mm = 30; // comment ;\nparam height: mm = width / 2;\nreturn box(width, 10, height);',parameters:{width:'60'}};expect(compileCode({...commented,source:exportCodeSource(commented),parameters:{}}).values.height.value).toBe(30);
});
for(const example of codeExamples)it(`round-trips OpenSCAD snapshot without losing CSG volume: ${example.id}`,()=>{
 const p=codeExampleProgram(example.id),s=createCadSession();s.addCode(p);const expected=kernel.evaluate(s.state.document);const text=exportOpenSCAD(p),actual=geometry(text);expect(actual.volume).toBeCloseTo(expected.volume,4);expect(exportJSCAD(p)).toContain("require('@jscad/modeling')");expect(p.source.split('\n').length).toBeGreaterThan(1);
});
it('exports all example snapshots to actual JSCAD solids with compatible dimensions and volume',async()=>{
 const {createRequire}=await import('node:module'),{runInNewContext}=await import('node:vm');const require=createRequire(import.meta.url),modeling=require('@jscad/modeling');
 for(const example of codeExamples){const p=codeExampleProgram(example.id),session=createCadSession();session.addCode(p);const expected=kernel.evaluate(session.state.document),context={module:{exports:{} as any},require:(id:string)=>{if(id!=='@jscad/modeling')throw Error('Unexpected package');return modeling;}};
  runInNewContext(exportJSCAD(p)+'\nmodule.exports.solid = main();',context,{timeout:4000});const solid=context.module.exports.solid,volume=modeling.measurements.measureVolume(solid);expect(volume,example.id).toBeGreaterThan(0);expect(Math.abs(volume-expected.volume)/expected.volume,example.id).toBeLessThan(.025);const bounds=modeling.measurements.measureBoundingBox(solid);for(let i=0;i<3;i++){const tolerance=Math.max(.1,(expected.bodies[0].bounds.max[i]-expected.bodies[0].bounds.min[i])*.005);expect(Math.abs(bounds[0][i]-expected.bodies[0].bounds.min[i]),example.id).toBeLessThan(tolerance);expect(Math.abs(bounds[1][i]-expected.bodies[0].bounds.max[i]),example.id).toBeLessThan(tolerance);}
 }
},20000);

it('converts planar polygon, square and circle extrusions with explicit centering',()=>{
 expect(geometry('linear_extrude(height=5) polygon(points=[[0,0],[20,0],[20,10],[0,10]]);').volume).toBeCloseTo(1000);expect(geometry('linear_extrude(height=5,center=true) square([20,10],center=true);').bodies[0].bounds).toEqual({min:[-10,-5,-2.5],max:[10,5,2.5]});expect(geometry('linear_extrude(10) circle(d=12,$fn=6);').volume).toBeGreaterThan(0);
 for(const source of ['linear_extrude(5) square([-2,3]);','linear_extrude(5) circle(r=-2);','linear_extrude(5) polygon([[0,0],[1,1],[0,1],[1,0]]);'])expect(()=>geometry(source)).toThrow();
});

it('expands reusable modules symbolically, hoists definitions, and preserves parameter overrides',()=>{
 const p=importOpenSCAD('width=8; part(width); module part(size=4){ translate([size/2,0,0]) cube([size,2,3],center=true); }');
 expect(compileCode(p).values.width.value).toBe(8);p.parameters.width='12';
 const session=createCadSession();session.addCode(p);const result=kernel.evaluate(session.state.document);
 expect(result.volume).toBeCloseTo(72);expect(result.bodies[0].bounds).toEqual({min:[0,-1,-1.5],max:[12,1,1.5]});
 expect(geometry('module a(s=3){b(s);} module b(t){cube(t);} a();').volume).toBeCloseTo(27);
});
it('keeps module lexical globals separate from caller arguments and evaluates defaults in the definition scope',()=>{
 expect(geometry('size=2; module inner(){cube(size);} module outer(size=9){inner();} outer();').volume).toBeCloseTo(8);
 expect(geometry('size=2; module part(size=9,height=size){cube([size,height,1]);} part();').volume).toBeCloseTo(18);
 expect(geometry('size=2; module part(size=9,height=size){cube([size,height,1]);} part(height=4);').volume).toBeCloseTo(36);
});
it('hoists nested modules and captures each declaration scope across separate outer instances',()=>{
 const source='module outer(width=5){part();size=width+1;module part(){cube([size,2,1]);}} outer();translate([20,0,0])outer(8);';
 expect(geometry(source).volume).toBeCloseTo(30);
 expect(geometry('module outer(){part();module part(size=side){cube(size);}side=3;}outer();').volume).toBeCloseTo(27);
 expect(geometry('module outer(size=3){module inner(n=size){cube([n,n,1]);}module caller(size=10){inner();}caller();translate([20,0,0])inner(4);}outer();').volume).toBeCloseTo(25);
});
it('resolves module names in the definition environment and restores sibling block registries',()=>{
 const source='module part(){cube(2);}module helper(){part();}module outer(){module part(){cube(9);}translate([20,0,0])helper();part();}outer();';
 expect(geometry(source).volume).toBeCloseTo(737);
 expect(geometry('module outer(){module part(){cube(2);}translate([10,0,0]){module part(){cube(3);}part();}part();}outer();').volume).toBeCloseTo(35);
 expect(geometry('module outer(){module first(){second();}module second(){cube(2);}first();}outer();').volume).toBeCloseTo(8);
 for(const source of ['module outer(){module hidden(){cube(2);}hidden();}outer();hidden();','translate([10,0,0]){module hidden(){cube(2);}hidden();}translate([20,0,0])hidden();'])expect(()=>importOpenSCAD(source),source).toThrow();
});
it('retains caller fragment scope in nested modules while bounding recursion and rejecting unsupported definitions',()=>{
 const counts=(shape:any):number[]=>'segments'in shape?[shape.segments]:'shapes'in shape?shape.shapes.flatMap(counts):'shape'in shape?counts(shape.shape):[];
 const source='$fn=12;module outer(){module inner(){sphere(1);}inner();translate([3,0,0],$fn=20)inner();inner();}outer($fn=16);translate([9,0,0])sphere(1);';
 expect(counts(compileCode(importOpenSCAD(source)).shape)).toEqual([16,20,16,12]);
 try{importOpenSCAD('module outer(){module a(){b();}module b(){a();}a();}outer();');throw Error('Expected resource failure');}catch(error:any){expect(error.code).toBe('resource-limit');}
 for(const source of [
  'module outer(){module part(){include <file.scad>;}part();}outer();',
 ])expect(()=>importOpenSCAD(source),source).toThrow();
});
it('accepts symbolic vectors, indexing, boolean flags and module vector defaults',()=>{
 const p=importOpenSCAD('width=10; size=[width,width/2,3]; centered=true; module part(v=size){cube(v,centered);} part();');
 p.parameters.width='20';const session=createCadSession();session.addCode(p);const result=kernel.evaluate(session.state.document);
 expect(result.volume).toBeCloseTo(600);expect(result.bodies[0].bounds.min).toEqual([-10,-5,-1.5]);
 expect(geometry('v=[[2,3,4],[5,6,7]]; module part(s){cube([s[0],s[1]+1,s[2]]);} part(v[0]);').volume).toBeCloseTo(32);
});
it('supports degree math and keeps expressions live through source interchange',()=>{
 const p=importOpenSCAD('angle=30; side=sin(angle)*10; cube([side,max(2,3),sqrt(16)]);');
 expect(compileCode(p).values.side.value).toBeCloseTo(5);p.parameters.angle='90';expect(compileCode(p).values.side.value).toBeCloseTo(10);
 expect(geometry('cube([abs(round(-2.5)),pow(2,3),cos(0)*2]);').volume).toBeCloseTo(48);
 expect(geometry('cube([2*PI,1,1]);').volume).toBeCloseTo(2*Math.PI);
 expect(geometry('width=PI; PI=4; cube([width,1,1]);').volume).toBeCloseTo(4);
});
it('bounds module recursion and refuses child modules, bad arguments and unsupported scope semantics',()=>{
 for(const source of [
  'module a(){a();} a();',
  'module a(s){cube(s);} a();',
  'module a(s=2){cube(s);} a(2,s=3);',

  'v=[1,2,3]; cube(v[5]);',
  'cube(sqrt(-1));',
  'cube(random(1));',
 ])expect(()=>importOpenSCAD(source),source).toThrow();
});

it('caps symbolic argument expansion before recursive expressions can exhaust memory',()=>{
 try{importOpenSCAD('module a(x){a(x+x);} a(1);');throw Error('Expected resource failure');}catch(error:any){expect(error.code).toBe('resource-limit');}
 expect(geometry('module b(){cylinder(2,1);} module a($fn=6){b();} a();').volume).toBeCloseTo(3*Math.sqrt(3));
});
it('inlines user scalar/vector functions symbolically, with hoisted definitions and lexical defaults',()=>{
 const p=importOpenSCAD('width=5; dimensions=size(width); cube(dimensions); function twice(x)=x*2; function size(w=width)=[w,twice(w),3];');
 p.parameters.width='7';const session=createCadSession();session.addCode(p);expect(kernel.evaluate(session.state.document).volume).toBeCloseTo(294);
 expect(geometry('global=2; function size(x=global)=x; module part(global=9){cube(size());} part();').volume).toBeCloseTo(8);
 expect(geometry('function size(x=3,y=4)=[x,y,2]; cube(size(y=5));').volume).toBeCloseTo(30);
 expect(geometry('function size()=[2,3,4]; cube(size()[1]);').volume).toBeCloseTo(27);
 expect(geometry('function profile(w)=[[0,0],[w,0],[w,w],[0,w]]; linear_extrude(3) polygon(profile(4));').volume).toBeCloseTo(48);
 expect(geometry('module part(){cylinder(2,1);} part($fn=6);').volume).toBeCloseTo(3*Math.sqrt(3));
});
it('bounds user-function recursion and diagnoses unsupported conditionals without executing them',()=>{
 for(const source of ['function f(x)=f(x+x); cube(f(1));','function f(x)=x; cube('+'f('.repeat(33)+'1'+')'.repeat(33)+');']){
  try{importOpenSCAD(source);throw Error('Expected resource failure');}catch(error:any){expect(error.code).toBe('resource-limit');}
 }
 for(const source of ['function f(x)=x; cube(f());','function f(x)=x; cube(f(1,x=2));','function f(x)=x; cube(f(y=1));'])expect(()=>importOpenSCAD(source),source).toThrow();
});

it('retains local declarative dependencies, lexical shadowing and last assignments across module instances',()=>{
 const p=importOpenSCAD('width=4; module part(n){cube(size); size=[w,w,1]; w=n*width; w=n*width+1;} part(2); translate([20,0,0]) part(3);');
 p.parameters.width='5';const session=createCadSession();session.addCode(p);expect(kernel.evaluate(session.state.document).volume).toBeCloseTo(121+256);
 expect(geometry('width=2; module part(width=3){cube(width); translate([10,0,0]){width=4; cube(width);} translate([20,0,0]) cube(width);} part();').volume).toBeCloseTo(27+64+27);
 expect(geometry('module part(){difference(){size=6; cube(size); translate([2,2,-1]) cube([2,2,8]);}} part();').volume).toBeCloseTo(216-24);
 expect(geometry('module part(){cylinder(2,1); $fn=6;} part();').volume).toBeCloseTo(3*Math.sqrt(3));
});
it('refuses cyclic local bindings and bounds deep local dependency chains',()=>{
 for(const source of ['module a(){x=x+1; cube(x);} a();','module a(){x=y; y=x; cube(x);} a();','module a(){v=[v]; cube(v);} a();'])expect(()=>importOpenSCAD(source),source).toThrow('dependency cycle');
 const definitions=Array.from({length:34},(_,i)=>`v${i}=${i===33?'1':`v${i+1}`};`).join('');
 try{importOpenSCAD(`module a(){${definitions} cube(v0);} a();`);throw Error('Expected resource failure');}catch(error:any){expect(error.code).toBe('resource-limit');}
});

it('keeps captured local bindings independent of later inner shadowing and refuses anonymous assignment scopes',()=>{
 expect(geometry('module a(width=3){size=width; translate([10,0,0]){width=8; cube(size);}} a();').volume).toBeCloseTo(27);
 expect(()=>importOpenSCAD('module a(){ {size=4;} cube(size);} a();')).toThrow('anonymous blocks');
});

it('expands nested scalar calls once per use and retains their arithmetic context',()=>{
 let expression='1';for(let i=0;i<8;i++)expression=`f(${expression})+1`;
 expect(geometry(`function f(x)=x; cube(${expression});`).volume).toBeCloseTo(729);
});

it('supports computed palettes and literal string flows without numeric coercion',()=>{
 expect(geometry('color(str("red"))cube(2);').volume).toBeCloseTo(8);
 expect(geometry('function shade()="red";color(shade())cube(2);').volume).toBeCloseTo(8);
 expect(geometry('function size(c)=2;cube(size("red"));').volume).toBeCloseTo(8);
 expect(geometry('for(c=["red","blue"])color(c)cube(2);').volume).toBeCloseTo(8);
 expect(geometry('module part(c="red"){color(c[0])cube(2);}part();').volume).toBeCloseTo(8);
 expect(geometry('global=0;module part(){palette=["red"];color(palette[global])cube(2);}part();').volume).toBeCloseTo(8);
 expect(geometry('function index()=0;module part(Mat){palette=["red"];color(palette[Mat])cube(2);}part(index());').volume).toBeCloseTo(8);
 expect(geometry('module part(Mat=0+0){palette=["red"];color(palette[Mat])cube(2);}part();').volume).toBeCloseTo(8);
 expect(geometry('module part(){palette=["red"];index=0+0;color(palette[index])cube(2);}part();').volume).toBeCloseTo(8);
 expect(geometry('module part(){palette=["red"];for(index=[0])color(palette[index])cube(2);}part();').volume).toBeCloseTo(8);
 expect(geometry('module part(){palette=["red",2];color(palette[0])cube(2);}part();').volume).toBeCloseTo(8);
 expect(geometry('module part(){palette=[["red"],[2]];color(palette[0][0])cube(2);}part();').volume).toBeCloseTo(8);
 expect(geometry('module part(){palette=["red"];for(c=palette)color(c)cube(2);}part();').volume).toBeCloseTo(8);
 expect(geometry('module part(){palette=["red"];for(c=[palette])color(c[0])cube(2);}part();').volume).toBeCloseTo(8);
 expect(geometry('function size(p)=2;cube(size(["red"]));').volume).toBeCloseTo(8);
 expect(geometry('function palette()=["red"];color(palette()[0])cube(2);').volume).toBeCloseTo(8);
 expect(geometry('palette=["red"];color(palette[0])cube(2);').volume).toBeCloseTo(8);
});
