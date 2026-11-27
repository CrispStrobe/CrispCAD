// SPDX-License-Identifier: BSD-3-Clause
// CAD Script `smoothLoft`: the exact kernel's smooth loft through three or more sections,
// sampled for Manifold; gated by document version 43.
import {readFileSync} from 'node:fs';
import {beforeAll,describe,expect,it} from 'vitest';
import {CAD_SCRIPT_REVISION,compileCode,compileModelSource,createCadSession,generateModelSource,importKernelCAD,parseDocument,serializeDocument,smoothLoftCurves,smoothLoftRing,smoothLoftVolume,validateDocument} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,Vec3} from '@brickwright/cad-core';
import {createGeometryKernel,type GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,type ExactBackend} from '@brickwright/cad-exact';

let manifold:GeometryKernel,exact:ExactBackend;
beforeAll(async()=>{[manifold,exact]=await Promise.all([createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),createExactBackend()]);},120_000);

const program=(source:string,version:1|2=CAD_SCRIPT_REVISION):CodeProgram=>({version,language:'brickwright-cad-script',parameters:{},source});
const smooth=(sections:Vec3[][])=>`return smoothLoft(${JSON.stringify(sections)});`;
const ruled=(sections:Vec3[][])=>`return loft(${JSON.stringify(sections)});`;
const shoelace=(ring:readonly Vec3[])=>ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+(p[0]*q[1]-q[0]*p[1])/2;},0);
const rel=(a:number,b:number)=>Math.abs(a-b)/Math.abs(b);
function build(p:CodeProgram){
 const s=createCadSession();try{s.addCode(p);const doc=s.state.document;return {doc,manifold:manifold.evaluate(doc).bodies[0],exact:exact.measure(doc).bodies[0]};}finally{s.dispose();}
}
// wind-energy/wind-turbine-blade: a round root flaring into a twisted airfoil (catalog cross-check).
const AIRFOIL=[[0.7,0.01],[0.45,0.3],[0.15,0.5],[-0.1,0.48],[-0.25,0.3],[-0.3,0],[-0.25,-0.25],[-0.1,-0.35],[0.15,-0.32],[0.45,-0.15]];
const bladeSection=([z,chord,thick,twist,round]:number[]):Vec3[]=>{const a=twist*Math.PI/180;return (round?AIRFOIL.map((_,i)=>[round*Math.cos(2*Math.PI*i/10),round*Math.sin(2*Math.PI*i/10)]):AIRFOIL.map(([u,v])=>[u*chord,v*thick/.5])).map(([x,y])=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a),z] as Vec3);};
const blade=[[300,0,0,0,88],[408,0,0,0,88],[660,360,130,14,0],[1056,270,72,8,0],[1560,180,42,3,0],[1920,128,28,1,0]].map(bladeSection);
const ngon=(r:number,n:number,z:number,turn=0,dx=0,dy=0):Vec3[]=>Array.from({length:n},(_,i)=>{const a=turn+2*Math.PI*i/n;return [dx+r*Math.cos(a),dy+r*Math.sin(a),z];});
const vase=[ngon(20,8,0),ngon(28,8,15,.2,3,1),ngon(14,8,40,.35,-2,4),ngon(22,8,55,.5,1,-3)];

describe('smoothLoft',{timeout:120_000},()=>{
 it('is the ruled frustum when every vertex runs along a straight line (closed form)',()=>{
  // Four sections on one frustum: chord-length parameters are proportional along every vertex
  // line, so the cubic interpolation reproduces the lines and the solid is the frustum.
  const bottom=ngon(30,6,0,.1),top=ngon(12,6,50,.1,8,-5),at=(s:number)=>bottom.map((p,i)=>p.map((v,k)=>v+(top[i][k]-v)*s) as Vec3);
  const sections=[0,.2,.7,1].map(at),h=50,V=h/6*(shoelace(bottom)+4*shoelace(at(.5))+shoelace(top));
  expect(rel(smoothLoftVolume(smoothLoftCurves(sections)),V)).toBeLessThan(1e-12);
  const built=build(program(smooth(sections)));
  expect(rel(built.exact.volume,V)).toBeLessThan(1e-9);expect(rel(built.manifold.volume,V)).toBeLessThan(1e-6);
 });

 it('builds the kernel surface in the exact backend and samples it in Manifold within tolerance',()=>{
  for(const sections of [vase,blade,vase.map(r=>[...r].reverse()),[...vase].reverse(),vase.slice(0,3)]){
   const curves=smoothLoftCurves(sections),V=smoothLoftVolume(curves),built=build(program(smooth(sections)));
   expect(built.doc.version).toBe(43);
   // The exact backend refuses a smooth loft whose kernel volume differs from V by 1e-7.
   expect(rel(built.exact.volume,V)).toBeLessThan(1e-9);
   expect(rel(built.manifold.volume,V)).toBeLessThan(5e-4);
   // Independent of the Gauss rule: slice the surface at 4,000 heights (Simpson on z).
   const z=(v:number)=>smoothLoftRing(curves,v)[0][2],z0=sections[0][0][2],z1=sections.at(-1)![0][2],n=4000;
   const vAt=(target:number)=>{let lo=0,hi=1;for(let i=0;i<60;i++){const m=(lo+hi)/2;if((z(m)-target)*(z1-z0)<0)lo=m;else hi=m;}return (lo+hi)/2;};
   let simpson=0;for(let i=0;i<=n;i++){const zz=z0+(z1-z0)*i/n;simpson+=(i===0||i===n?1:i%2?4:2)*Math.abs(shoelace(smoothLoftRing(curves,vAt(zz))));}
   expect(rel(Math.abs(simpson*(z1-z0)/n/3),V)).toBeLessThan(1e-7);
  }
 });

 it('passes through every section and gives a closed, manifold mesh',()=>{
  const shape=compileCode(program(smooth(blade))).shape;
  if(shape.kind!=='polyhedron')throw Error('loft');
  expect(shape.smooth).toHaveLength(blade.length);expect(shape.ruled).toBeUndefined();
  const keys=new Set(shape.points.map(p=>p.join(',')));
  for(const ring of blade)for(const p of ring)expect(keys.has(p.join(','))).toBe(true);
  const edges=new Map<string,number>();
  for(const face of shape.faces)for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length];edges.set(`${a}>${b}`,(edges.get(`${a}>${b}`)??0)+1);}
  for(const [edge,uses] of edges){const [a,b]=edge.split('>');expect(uses).toBe(1);expect(edges.get(`${b}>${a}`)).toBe(1);}
  expect(shape.faces.length).toBeLessThan(20000);
  const built=build(program(smooth(blade)));expect(built.manifold.volume).toBeGreaterThan(0);
 });

 it('equals loft through two sections, in either revision, and ignores the program revision',()=>{
  const two=[ngon(10,5,0),ngon(8,5,12,.4)];
  expect(compileCode(program(smooth(two),2)).shape).toEqual(compileCode(program(ruled(two),2)).shape);
  expect(compileCode(program(smooth(vase),1)).shape).toEqual(compileCode(program(smooth(vase),2)).shape);
  const compiled=compileCode(program(smooth(vase)));expect(compiled.usesSmoothLoft).toBe(true);expect(compiled.usesLoft).toBe(false);
  expect(compileCode(program(ruled(vase))).usesSmoothLoft).toBe(false);
 });

 it('refuses sections that make the surface fold back along Z, and invalid sections',()=>{
  const folding=[ngon(10,6,0),ngon(10,6,1,0,40,0),ngon(10,6,2),ngon(10,6,30)];
  expect(()=>compileCode(program(smooth(folding)))).toThrow('folds back along Z');
  expect(()=>compileCode(program(smooth([ngon(10,6,0),ngon(10,6,10).reverse(),ngon(10,6,20)])))).toThrow('Loft');
  expect(()=>compileCode(program(smooth([ngon(10,6,0)])))).toThrow('Loft');
 });
});

describe('document version 43',{timeout:120_000},()=>{
 it('raises a document holding smoothLoft to version 43 and refuses it below',()=>{
  const s=createCadSession(),initial=s.state.document.version,id=s.addCode(program(smooth(vase)),'Vase');
  const doc=structuredClone(s.state.document) as CadDocument;expect(doc.version).toBe(43);
  // A program whose only loft is smoothLoft is stored at revision 1: both revisions agree on it.
  const node=doc.nodes[id];expect(node.kind==='code'&&node.program.version).toBe(1);
  expect(()=>validateDocument({...doc,version:42})).toThrow('requires document version 43');
  // What an SDK before smoothLoft does: it knows only versions up to 42.
  expect(()=>validateDocument({...doc,version:999 as 43})).toThrow('unsupported format, version or units');
  s.undo();expect(s.state.document.version).toBe(initial);
 });

 it('round-trips through serialization and model source',()=>{
  const s=createCadSession();s.addCode(program(smooth(vase)),'Vase');s.addCode(program(ruled(vase)),'Ruled');
  const text=s.serialize(),parsed=parseDocument(text);
  expect(serializeDocument(parsed)).toBe(text);expect(parsed.version).toBe(43);
  const source=generateModelSource(parsed),rebuilt=compileModelSource(source,parsed);
  expect(rebuilt.version).toBe(43);
  expect(Object.values(rebuilt.nodes).map(n=>n.kind==='code'?n.program.source:'').sort()).toEqual(Object.values(parsed.nodes).map(n=>n.kind==='code'?n.program.source:'').sort());
  expect(manifold.evaluate(rebuilt).volume).toBeCloseTo(manifold.evaluate(parsed).volume,6);
 });
});

describe('kernelCAD converter',{timeout:120_000},()=>{
 const source=(options:string,count=4)=>`meta({ name: 'vase', license: 'MIT' });
const ring = (r, turn, dx) => { let p = path().moveTo(dx + r * Math.cos(turn), r * Math.sin(turn)); for (let i = 1; i < 8; i++) p = p.lineTo(dx + r * Math.cos(turn + 2 * Math.PI * i / 8), r * Math.sin(turn + 2 * Math.PI * i / 8)); return p.close(); };
const rs = [[20, 0, 0], [28, 0.2, 3], [14, 0.35, -2], [22, 0.5, 1]].slice(0, ${count});
return ring(...rs[0]).loft(rs.slice(1).map(r => ring(...r)), { spacing: 18${options} });`;
 it('converts smooth lofts through three or more sections as smoothLoft, without a warning',()=>{
  const converted=importKernelCAD(source(''));
  expect(converted.warnings).toEqual([]);
  const [part]=converted.parts;expect(part.program.source).toMatch(/^return smoothLoft\(/);
  const built=build(part.program),shape=compileCode(part.program).shape;
  if(shape.kind!=='polyhedron'||!shape.smooth)throw Error('smooth loft');
  expect(rel(built.exact.volume,smoothLoftVolume(smoothLoftCurves(shape.smooth)))).toBeLessThan(1e-9);
  expect(importKernelCAD(source(', ruled: true')).parts[0].program.source).toMatch(/^return loft\(/);
  expect(importKernelCAD(source('',2)).parts[0].program.source).toMatch(/^return loft\(/);
 });

 it('reads exact bounds of the smooth surface, not of its mesh',()=>{
  const converted=importKernelCAD(source('').replace(/return ring\(\.\.\.rs\[0\]\)\.loft\((.*)\);$/s,'const v = ring(...rs[0]).loft($1);\nconst b = v.boundingBox({ exact: true });\nreturn box(b.max[0] - b.min[0], 1, 1);'));
  const sections=compileCode({...converted.parts[0].program,source:'return smoothLoft('+/smoothLoft\((.*)\)/s.exec(importKernelCAD(source('')).parts[0].program.source)![1]+');'}).shape;
  if(sections.kind!=='polyhedron'||!sections.smooth)throw Error('smooth loft');
  const curves=smoothLoftCurves(sections.smooth);let lo=Infinity,hi=-Infinity;
  for(let i=0;i<=20000;i++)for(const p of smoothLoftRing(curves,i/20000)){lo=Math.min(lo,p[0]);hi=Math.max(hi,p[0]);}
  const width=Number(/box\(([^,]+),/.exec(converted.parts[0].program.source)![1]);
  expect(width).toBeCloseTo(hi-lo,4);
 });
});
