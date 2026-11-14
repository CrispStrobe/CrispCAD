// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createCadSession,importOpenSCAD,compileCode,getOpenSCADImportWarnings,exportOpenSCAD,exportJSCAD} from '@brickwright/cad-core';
import {createGeometryKernel,getBundledFontData} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {Font} from 'three/addons/loaders/FontLoader.js';
import type {FontData} from 'three/addons/loaders/FontLoader.js';
import {ShapeUtils} from 'three';
let kernel:GeometryKernel;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function evaluate(source:string,parameters:Record<string,string>={}){const program=importOpenSCAD(source);program.parameters=parameters;const session=createCadSession();try{session.addCode(program);return kernel.evaluate(session.state.document);}finally{session.dispose();}}
const modeling=createRequire(import.meta.url)('@jscad/modeling');
it('resolves string selectors, escaped literals and inactive statements without executing unavailable operations',()=>{
 const source='mode="print"; title="A\\\"B"; if(mode=="print") cube([len(title),2,3]); else import("unavailable.stl");';expect(evaluate(source).volume).toBeCloseTo(18);expect(evaluate('if(false) imaginary() imaginary(); else cube(2);').volume).toBeCloseTo(8);expect(evaluate('if(true){cube(2);}else if(true)notImplemented();').volume).toBeCloseTo(8);expect(getOpenSCADImportWarnings(importOpenSCAD(source)).join(' ')).toContain('String settings');
});
it('hoists final global assignments and keeps numeric overrides and dependencies live',()=>{
 const source='cube([width,depth,2]); width=2; depth=width/2; width=8;';expect(evaluate(source).volume).toBeCloseTo(64);expect(evaluate(source,{width:'12'}).volume).toBeCloseTo(144);expect(compileCode(importOpenSCAD('title="metadata"; width=3; cube(width);')).parameters).not.toHaveProperty('title');expect(()=>importOpenSCAD('a=b;b=a;cube(a);')).toThrow('dependency cycle');
});
it('supports vector arithmetic, dot products, length, norm, concatenation and dynamic scalar indexing',()=>{
 expect(evaluate('v=[1,2,3]; cube(v*2+[1,1,1]);').volume).toBeCloseTo(105);expect(evaluate('v=[3,4]; cube(norm(v));').volume).toBeCloseTo(125);expect(evaluate('v=[2,3,4];i=0;cube(v[i]);',{i:'2'}).volume).toBeCloseTo(64);expect(evaluate('cube(len(concat([1,2],[3])));').volume).toBeCloseTo(27);expect(evaluate('cube(len("🧱"));').volume).toBeCloseTo(1);
});
it('preserves render geometry while exposing colour and console losses and respecting render modifiers',()=>{
 const program=importOpenSCAD('echo(str("unused ",missing));color("red",0.5)render(convexity=8)cube(2);'),warnings=getOpenSCADImportWarnings(program);expect(warnings.join(' ')).toContain('colours');expect(warnings.join(' ')).toContain('Echo');expect(evaluate('echo("test");color("red")cube(2);').volume).toBeCloseTo(8);expect(evaluate('%unsupported();*unsupported();#cube(2);').volume).toBeCloseTo(8);expect(evaluate('cube(4); !translate([5,0,0])cube(2);').volume).toBeCloseTo(8);
});
it('implements facet controls with dynamic scope and keeps explicit quality overrides editable',()=>{
 const volume=(n:number)=>n*Math.sin(2*Math.PI/n);expect(evaluate('$fn=0;$fa=45;$fs=.1;cylinder(h=2,r=1);').volume).toBeCloseTo(volume(8),5);expect(evaluate('module b(){cylinder(h=2,r=1);}module a($fa=30,$fs=.1){b();}a();').volume).toBeCloseTo(volume(12),5);expect(evaluate('q=6;$fn=q;cylinder(h=2,r=1);',{q:'12'}).volume).toBeCloseTo(volume(12),5);expect(evaluate('cylinder(h=2,r=1,$fn=7.9);').volume).toBeCloseTo(volume(7),5);
});
it('retains nested loop bindings including dependent inner ranges',()=>{
 expect(evaluate('for(x=[0:2],y=[0:x])translate([x*3,y*3,0])cube(1);').volume).toBeCloseTo(6);expect(evaluate('n=2;for(x=[0:n],y=[1,2])translate([x*3,y*3,0])cube(1);',{n:'3'}).volume).toBeCloseTo(8);
});
it('keeps profile modules, lexical dimensions, loops and branches parametric through extrusion',()=>{
 const source='n=2;module hole(r){circle(r,$fn=12);}linear_extrude(2)difference(){width=20;square([width,10]);for(x=[1:n])translate([x*5,5])hole(1);}';expect(evaluate(source).volume).toBeCloseTo(400-12,4);expect(evaluate(source,{n:'3'}).volume).toBeCloseTo(400-18,4);expect(evaluate('linear_extrude(2)if(false)unsupported();else square([3,4]);').volume).toBeCloseTo(24);
});
it('honours parallel assign and sequential let operator bindings',()=>{
 expect(evaluate('a=2;let(a=3,b=a+1)cube([a,b,1]);').volume).toBeCloseTo(12);expect(evaluate('a=2;assign(a=3,b=a+1)cube([a,b,1]);').volume).toBeCloseTo(9);
});
it('keeps module child geometry in the caller lexical scope and supports indexed children',()=>{
 const source='width=2;module wrap(width=99){translate([10,0,0])children();}wrap(){cube(width);translate([5,0,0])cube(width);}';expect(evaluate(source).volume).toBeCloseTo(16);expect(evaluate('module pick(){children(1);}pick(){cube(2);cube(3);}').volume).toBeCloseTo(27);expect(evaluate('module copies(){for(i=[0:$children-1])translate([i*10,0,0])children(i);}copies(){cube(2);cube(3);}').volume).toBeCloseTo(35);expect(evaluate('module ignored(){cube(2);}ignored() unsupported();').volume).toBeCloseTo(8);
});
it('hoists nested module/function definitions and retains their lexical variables',()=>{
 const source='module parent(width){child();module child(){cube(size());}function size()=width+1;}parent(2);';expect(evaluate(source).volume).toBeCloseTo(27);expect(evaluate('module x(){cube(1);}module x(){cube(3);}x();').volume).toBeCloseTo(27);expect(evaluate('width=2;module child(){cube(width);}module parent(){module child(){cube(3);}child();}parent();translate([10,0,0])child();').volume).toBeCloseTo(35);
});
it('reflects, negatively scales, rotates around an arbitrary axis and resizes actual solid bounds',()=>{
 const mirrored=evaluate('mirror([1,1,0])cube([2,3,4]);');expect(mirrored.volume).toBeCloseTo(24);[-3,-2,0].forEach((v,i)=>expect(mirrored.bodies[0].bounds.min[i]).toBeCloseTo(v,8));expect(evaluate('scale([-1,2,1])cube([2,3,4]);').volume).toBeCloseTo(48);expect(evaluate('resize([10,0,8])cube([2,3,4]);').volume).toBeCloseTo(240);
 const actual=evaluate('rotate(a=37,v=[1,2,3])cube([2,3,4]);').bodies[0],m=modeling.maths.mat4.fromRotation([],37*Math.PI/180,[1,2,3]),reference=modeling.transforms.transform(m,modeling.primitives.cuboid({size:[2,3,4],center:[1,1.5,2]})),bounds=modeling.measurements.measureBoundingBox(reference);for(let i=0;i<3;i++){expect(actual.bounds.min[i]).toBeCloseTo(bounds[0][i],5);expect(actual.bounds.max[i]).toBeCloseTo(bounds[1][i],5);}
 for(const source of ['mirror([1,1,0])cube([2,3,4]);','rotate(a=37,v=[1,2,3])cube([2,3,4]);']){const p=importOpenSCAD(source);expect(evaluate(exportOpenSCAD(p)).volume).toBeCloseTo(24);expect(exportJSCAD(p)).toContain('main');}
});
it('computes Minkowski sums rather than replacing them with convex hulls or bounding boxes',()=>{
 const g=evaluate('minkowski(){cube([2,3,4]);cube([1,2,3]);}');expect(g.volume).toBeCloseTo(105);expect(g.bodies[0].bounds).toEqual({min:[0,0,0],max:[3,5,7]});expect(()=>exportJSCAD(importOpenSCAD('minkowski(){cube(2);cube(1);}'))).toThrow('exported to JSCAD');
});
it('reproduces text contours against the independent Three font path and keeps alignment and size live',()=>{
 const data=getBundledFontData('sans'),font=new Font(data as unknown as FontData),shapes=font.generateShapes('BO',10);let area=0;for(const shape of shapes){const points=shape.extractPoints(8);area+=Math.abs(ShapeUtils.area(points.shape))-points.holes.reduce((sum,hole)=>sum+Math.abs(ShapeUtils.area(hole)),0);}const source='size=10;linear_extrude(2)text("BO",size=size,halign="center",valign="center");',result=evaluate(source);expect(result.volume).toBeCloseTo(area*2,3);expect(evaluate(source,{size:'20'}).volume/result.volume).toBeCloseTo(4);expect(result.bodies[0].bounds.min[0]+result.bodies[0].bounds.max[0]).toBeCloseTo(0,5);expect(getOpenSCADImportWarnings(importOpenSCAD(source)).join(' ')).toContain('font metrics');expect(()=>exportJSCAD(importOpenSCAD(source))).toThrow('Text profiles');expect(evaluate(exportOpenSCAD(importOpenSCAD(source))).volume).toBeCloseTo(result.volume,4);
});
it('normalizes module inputs using their incoming values and handles undefined defaults lazily',()=>{
 expect(evaluate('module part(size=2){size=(size[0]==undef)?[size,size,size]:size;cube(size);}part();').volume).toBeCloseTo(8);expect(evaluate('module part(height=3){height=max(height,5);cube(height);}part();').volume).toBeCloseTo(125);expect(evaluate('w=8;if(true){w=w-2;cube(w);}').volume).toBeCloseTo(216);expect(evaluate('side=is_undef(side)?4:side;cube(side);').volume).toBeCloseTo(64);expect(evaluate('module part(x){if(is_undef(x))cube(2);else cube(x);}part();').volume).toBeCloseTo(8);
});
it('retains dynamic string choices, vector components and string indexing through profile branches',()=>{
 expect(evaluate('n=0;mode=n>0?"large":"small";if(mode=="large")cube(3);else cube(2);',{n:'1'}).volume).toBeCloseTo(27);expect(evaluate('v=[2,3,4];cube([v.x,v.y,v.z]);').volume).toBeCloseTo(24);expect(evaluate('linear_extrude(2)for(i=[0:1])translate([i*20,0])text("AB"[i],size=10);').volume).toBeGreaterThan(10);
});
it('retains closed indexed polyhedra and triangulates concave planar faces',()=>{
 const points=[[0,0,0],[2,0,0],[2,3,0],[0,3,0],[0,0,4],[2,0,4],[2,3,4],[0,3,4]],faces=[[3,2,1,0],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],source=`polyhedron(points=${JSON.stringify(points)},faces=${JSON.stringify(faces.map(face=>[...face].reverse()))});`;expect(evaluate(source).volume).toBeCloseTo(24);expect(evaluate(exportOpenSCAD(importOpenSCAD(source))).volume).toBeCloseTo(24);
 const outline=[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]],vertices=[...outline.map(p=>[...p,0]),...outline.map(p=>[...p,2])],indexed=[[5,4,3,2,1,0],[6,7,8,9,10,11],...outline.map((_,i)=>[i,(i+1)%6,(i+1)%6+6,i+6])];expect(evaluate(`polyhedron(${JSON.stringify(vertices)},${JSON.stringify(indexed.map(face=>[...face].reverse()))});`).volume).toBeCloseTo(10);
 expect(()=>evaluate(`polyhedron(${JSON.stringify(points)},[[0,1,2],[4,5,6],[0,1,5],[1,2,6]]);`)).toThrow();
});
it('offsets planar profiles and computes concave planar Minkowski sums without filling their holes',()=>{
 expect(evaluate('linear_extrude(2)offset(delta=1)square([10,10]);').volume).toBeCloseTo(288);expect(evaluate('linear_extrude(2)offset(delta=-1)square([10,10]);').volume).toBeCloseTo(128);
 expect(evaluate('linear_extrude(7)minkowski(){square([2,3]);square([1,2]);}').volume).toBeCloseTo(105);expect(evaluate('linear_extrude(1)minkowski(){difference(){square([10,10]);translate([2,2])square([6,6]);}square([2,2]);}').volume).toBeCloseTo(128);
 expect(()=>importOpenSCAD('linear_extrude(2)offset(delta=1,chamfer=true)square(10);')).toThrow('chamfer');
});
it('short-circuits boolean guards and evaluates module children in the dimensional context of their consumer',()=>{
 expect(evaluate('x=undef;if(is_undef(x)||x<1)cube(2);').volume).toBeCloseTo(8);expect(evaluate('if(false && invalid())cube(3);else cube(2);').volume).toBeCloseTo(8);expect(evaluate('module extruded(h){linear_extrude(h)children();}extruded(3)square([2,4]);').volume).toBeCloseTo(24);expect(evaluate('module m(s=2){cube(s);}m(unrecognized=9);').volume).toBeCloseTo(8);expect(getOpenSCADImportWarnings(importOpenSCAD('module m(s=2){cube(s);}m(unrecognized=9);')).join(' ')).toContain('arguments are ignored');
});
it('keeps polygon choices editable and treats undefined loop endpoints and nonpositive primitives as empty contributions',()=>{
 const source='profiles=[[[0,0],[2,0],[0,2]],[[0,0],[2,0],[2,2],[0,2]]];i=0;linear_extrude(2)polygon(profiles[i]);';expect(evaluate(source).volume).toBeCloseTo(4);expect(evaluate(source,{i:'1'}).volume).toBeCloseTo(8);
 expect(evaluate('profiles=[[[0,0],[2,0],[0,2]],[[0,0],[2,0],[2,2],[0,2]]];linear_extrude(2)for(i=[0:len(profiles)])translate([i*10,0])polygon(profiles[i]);').volume).toBeCloseTo(12);
 expect(evaluate('cube([-1,2,3]);cube(1);').volume).toBeCloseTo(1);expect(evaluate('difference(){cube(2);cylinder(h=2,r1=0,r2=0);}').volume).toBeCloseTo(8);expect(evaluate('n=-1;cube([n,2,3]);cube(1);').volume).toBeCloseTo(1);
});
it('reports actual geometry resource failures distinctly and releases the failed construction',()=>{
 try{evaluate('minkowski(){sphere(2,$fn=128);sphere(3,$fn=128);}');throw Error('Expected budget failure');}catch(error:any){expect(error.code).toBe('resource-limit');expect(error.message).toContain('pair budget');}expect(evaluate('cube(2);').volume).toBeCloseTo(8);
 expect(evaluate('module m(){function size()=2;value=size();translate([10,0,0]){function size()=3;cube(value);}}m();').volume).toBeCloseTo(8);
});
it('retains generated polygon vertices through parameter edits, nested generators and filters',()=>{
 const source='n=4;r=2;linear_extrude(3)polygon([for(i=[0:n-1]) [r*cos(360*i/n),r*sin(360*i/n)]]);';expect(evaluate(source).volume).toBeCloseTo(24);expect(evaluate(source,{n:'6'}).volume).toBeCloseTo(18*Math.sqrt(3));expect(importOpenSCAD(source).source).toContain('polygonGenerated2d');
 const filtered='linear_extrude(2)polygon([for(i=[0:7]) if(i%2==0) [2*cos(45*i),2*sin(45*i)]]);';expect(evaluate(filtered).volume).toBeCloseTo(16);
 const nested='linear_extrude(2)polygon([for(i=[0:1])for(j=[0:1]) [i==0?j*2:(1-j)*2,i*3]]);';expect(evaluate(nested).volume).toBeCloseTo(12);
 expect(evaluate('n=4;function vertices(n)=[for(i=[0:n-1],a=i*360/n)[2*cos(a),2*sin(a)]];linear_extrude(2)polygon(vertices(n));').volume).toBeCloseTo(16);
 expect(evaluate('linear_extrude(2)polygon([each [[0,0],[2,0]],each [[2,3],[0,3]]]);').volume).toBeCloseTo(12);
});
it('keeps comprehension array lengths, indexing and expression-level let live',()=>{
 expect(evaluate('n=2;points=[for(i=[0:n]) i*2+1];cube(points[1]);').volume).toBeCloseTo(27);
 expect(evaluate('n=2;points=[for(i=[0:n]) i*2+1];cube(len(points));',{n:'3'}).volume).toBeCloseTo(64);
 expect(evaluate('n=2;v=[for(i=[0:n]) [i*2,3]];cube(v[1][0]);').volume).toBeCloseTo(8);
 expect(evaluate('cube(let(a=2,b=a+1) a*b);').volume).toBeCloseTo(216);
 expect(evaluate('linear_extrude(2)polygon([for(i=[0:3])let(a=90*i)[2*cos(a),2*sin(a)]]);').volume).toBeCloseTo(16);
});
it('uses bounded lazy scalar indexing without duplicating vector branches',()=>{
 const source='values=[2,3,4];i=0;width=values[i]+1;cube(width);';expect(evaluate(source).volume).toBeCloseTo(27);expect(evaluate(source,{i:'2'}).volume).toBeCloseTo(125);expect(()=>evaluate(source,{i:'3'})).toThrow('List index');
 expect(evaluate('v=[[2,3],[4,5]];i=0;cube(v[i][1]);',{i:'1'}).volume).toBeCloseTo(125);
});
it('retains row-major affine matrices, matrix products, reflections and shear in profiles and solids',()=>{
 const source='k=0.5;multmatrix([[1,k,0,7],[0,2,0,3],[0,0,-1,4],[0,0,0,1]])cube([2,3,4]);';const result=evaluate(source);expect(result.volume).toBeCloseTo(48);expect(result.bodies[0].bounds.min).toEqual([7,3,0]);expect(result.bodies[0].bounds.max).toEqual([10.5,9,4]);expect(evaluate(exportOpenSCAD(importOpenSCAD(source))).volume).toBeCloseTo(48);expect(exportJSCAD(importOpenSCAD(source))).toContain('transform(');
 expect(evaluate('linear_extrude(2)multmatrix([[1,.5,0,0],[0,2,0,0],[0,0,1,0],[0,0,0,1]])square([2,3]);').volume).toBeCloseTo(24);
 expect(evaluate('linear_extrude(2)mirror([1,1,0])square([2,3]);').volume).toBeCloseTo(12);
 expect(evaluate('v=[[1,2],[3,4]]*[2,3];cube([v[0],v[1],1]);').volume).toBeCloseTo(144);
 expect(evaluate('multmatrix([[1,0,0,0],[0,1,0,0],[0,0,1,0],[1,0,0,1]])cube(1);').volume).toBeCloseTo(1);
});
it('retains filtered array length and indexing through bounded native range reductions',()=>{
 const source='n=5;v=[for(i=[0:n])if(i%2==0)[i+1,2]];cube([len(v),v[1][0],2]);';expect(evaluate(source).volume).toBeCloseTo(18);expect(evaluate(source,{n:'7'}).volume).toBeCloseTo(24);
});
it('supports documented searches, codepoints, vector products and table interpolation',()=>{
 expect(evaluate('cube(search("b","abcabc")[0]+1);').volume).toBeCloseTo(8);expect(evaluate('cube(len(search("ab","abcabc",num_returns_per_match=0)[0]));').volume).toBeCloseTo(8);expect(evaluate('cube(search(7,[["a",3],["b",7]],0,1)[0]+1);').volume).toBeCloseTo(8);
 expect(evaluate('cube(ord(chr(65))-63);').volume).toBeCloseTo(8);expect(evaluate('v=cross([1,0,0],[0,3,0]);cube(v.z);').volume).toBeCloseTo(27);expect(evaluate('x=1;cube(lookup(x,[[0,2],[2,6]]));',{x:'2'}).volume).toBeCloseTo(216);
});
it('keeps repeatable native random lists parametric and discloses upstream sequence differences',()=>{
 const source='seed=5;n=3;v=rands(2,3,n,seed);cube(v[1]);';const first=evaluate(source).volume;expect(first).toBeGreaterThanOrEqual(8);expect(first).toBeLessThan(27);expect(evaluate(source).volume).toBe(first);expect(evaluate(source,{seed:'6'}).volume).not.toBe(first);expect(getOpenSCADImportWarnings(importOpenSCAD(source)).join(' ')).toContain('seeded sequences differ');expect(evaluate('cube(len(rands(0,1,3000,2)));').volume).toBeCloseTo(27000000000,-1);
});
it('rebuilds formatted lettering from numeric parameters without freezing text to import defaults',()=>{
 const source='size=2;linear_extrude(2)text(str("M",size),size=10);';const a=evaluate(source).volume,b=evaluate(source,{size:'8'}).volume;expect(a).toBeGreaterThan(0);expect(b).not.toBeCloseTo(a,2);expect(importOpenSCAD(source).source).toContain('formatSCAD');expect(getOpenSCADImportWarnings(importOpenSCAD(source)).join(' ')).not.toContain('formatting');
});
it('supports source assertions, automatic resize and axis rotations inside profiles',()=>{
 const source='side=2;assert(side>0);resize([8,0,0],auto=true)cube([side,3,4]);';expect(evaluate(source).volume).toBeCloseTo(1536);expect(()=>evaluate(source,{side:'-1'})).toThrow('assertion');expect(evaluate('linear_extrude(2)rotate(90,[0,0,1])square([2,3]);').volume).toBeCloseTo(12);expect(evaluate('cube([]);cube(2);').volume).toBeCloseTo(8);
});
it('retains scoped scalar expressions without exposing generated aliases as GUI parameters',()=>{
 const source='param width:scalar=2; const span:scalar=i*width; return forRange(i,0,3,1,move([span,0,0],box(1,1,1)));',program={version:1 as const,language:'brickwright-cad-script' as const,source,parameters:{}};const s=createCadSession();s.addCode(program);expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(4);expect(Object.keys(compileCode(program).values)).toEqual(['width']);
 const dependent='n=4;pts=[for(i=[0:n-1])let(a=360*i/n)[2*cos(a),2*sin(a)]];linear_extrude(2)polygon(pts);';expect(evaluate(dependent).volume).toBeCloseTo(16);
});
it('sweeps clockwise and revolves profiles wholly on the negative radial side',()=>{
 const clockwise=evaluate('rotate_extrude(angle=-90,$fn=64)translate([2,0])square([2,3]);');expect(clockwise.volume).toBeCloseTo(18*16*Math.sin(2*Math.PI/64),4);expect(clockwise.bodies[0].bounds.min[1]).toBeCloseTo(-4);expect(clockwise.bodies[0].bounds.max[1]).toBeCloseTo(0);expect(evaluate(exportOpenSCAD(importOpenSCAD('rotate_extrude(angle=-90,$fn=64)translate([2,0])square([2,3]);'))).volume).toBeCloseTo(clockwise.volume);expect(exportJSCAD(importOpenSCAD('rotate_extrude(angle=-90)translate([2,0])square([2,3]);'))).toContain('mirror(');
});

it('projects tilted 2D transforms before extrusion and keeps affine profile exports editable',()=>{
 expect(evaluate('linear_extrude(2)rotate([60,0,0])square([2,3]);').volume).toBeCloseTo(6,5);expect(evaluate('linear_extrude(2)rotate(60,[1,1,1])square([2,3]);').volume).toBeCloseTo(8,5);expect(evaluate('linear_extrude(2)multmatrix([[1,0,0,0],[0,1,0,0],[.5,.5,1,5]])square([2,3]);').volume).toBeCloseTo(12);
});
it('retains custom assertion messages, live parameters and SCAD number formatting in solid and profile contexts',()=>{
 const source='width=3;assert(width>2,str("width=",width));cube(width);';expect(()=>evaluate(source,{width:'1'})).toThrow('width=1');expect(getOpenSCADImportWarnings(importOpenSCAD(source)).join(' ')).not.toContain('messages');
 expect(()=>evaluate('side=2;linear_extrude(2)assert(side>0,str("side=",side))square(side);',{side:'-1'})).toThrow('side=-1');
 expect(evaluate('n=1.23456789;cube(len(str(n)));').volume).toBeCloseTo(343);expect(evaluate('flag=true;cube(len(str(flag)));').volume).toBeCloseTo(64);expect(evaluate('flag=true;if(is_bool(flag))cube(2);else cube(3);').volume).toBeCloseTo(8);
 expect(evaluate('for(i=[0:3])if("abc"[i]=="b")cube(2);').volume).toBeCloseTo(8);
});
it('matches independently observed cylinder precedence and retains notices for harmless unsupported argument names',()=>{
 const actual=evaluate('cylinder(r=2,r2=.5,h=10,$fn=8);');expect(actual.volume).toBeCloseTo((10/3)*(4+1+.25)*4*Math.sin(Math.PI/4),5);
 expect(evaluate('linear_extrude(2)circle(1,h=5,$fn=8);').volume).toBeCloseTo(8*Math.sin(Math.PI/4),5);expect(getOpenSCADImportWarnings(importOpenSCAD('color("red",other=1)cube(2);')).join(' ')).toContain('Unrecognized');expect(()=>importOpenSCAD('linear_extrude(height=5,v=[1,0,0])square(2);')).toThrow('direction');
});
