// SPDX-License-Identifier: BSD-3-Clause
// `loft([...], {pairing: "closest"})` (document version 46): sections re-started at the vertex and
// direction closest to the previous section, as OpenCASCADE's ThruSections pairs them, identically
// in the Manifold mesh and in the exact kernel (`pairing: 'closest'`). The default stays authored.
import {readFileSync} from 'node:fs';
import {beforeAll,describe,expect,it} from 'vitest';
import {CAD_SCRIPT_REVISION,closestLoftOrders,compileCode,compileModelSource,createCadSession,generateModelSource,importKernelCAD,parseDocument,serializeDocument,setLocale,smoothLoftCurves,smoothLoftVolume,validateDocument} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,Vec3} from '@brickwright/cad-core';
import {createGeometryKernel,type GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,type ExactBackend} from '@brickwright/cad-exact';

let manifold:GeometryKernel,exact:ExactBackend;
beforeAll(async()=>{[manifold,exact]=await Promise.all([createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),createExactBackend()]);},120_000);

const program=(source:string,version:1|2=CAD_SCRIPT_REVISION):CodeProgram=>({version,language:'brickwright-cad-script',parameters:{},source});
const ngon=(r:number,n:number,z:number,turn=0,start=0,dx=0,reverse=false):Vec3[]=>{const ring=Array.from({length:n},(_,i)=>{const a=turn+2*Math.PI*i/n;return [dx+r*Math.cos(a),r*Math.sin(a),z] as Vec3;});const rotated=[...ring.slice(start),...ring.slice(0,start)];return reverse?rotated.reverse():rotated;};
const loftSource=(sections:Vec3[][],options='')=>`return loft(${JSON.stringify(sections)}${options});`;
const closest=', {pairing: "closest"}';
function build(p:CodeProgram){
 const s=createCadSession();try{s.addCode(p);const doc=s.state.document;return {doc,manifold:manifold.evaluate(doc).bodies[0],exact:exact.measure(doc).bodies[0]};}finally{s.dispose();}
}
const rel=(a:number,b:number)=>Math.abs(a-b)/Math.abs(b);
const shoelace=(ring:readonly Vec3[])=>ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+(p[0]*q[1]-q[0]*p[1])/2;},0);
/** Prismoidal formula: exact for ruled sides. */
function ruledVolume(sections:readonly Vec3[][]):number{
 let v=0;for(let s=0;s+1<sections.length;s++){const a=sections[s],b=sections[s+1],h=b[0][2]-a[0][2],mid=a.map((p,i)=>p.map((x,k)=>(x+b[i][k])/2) as Vec3);v+=h/6*(shoelace(a)+4*shoelace(mid)+shoelace(b));}
 return Math.abs(v);
}
/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed:number){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}

describe('closest pairing rule',()=>{
 it('re-starts a section at the vertex closest to the previous one, and keeps the first section',()=>{
  // A square drawn from another corner, and one drawn the other way round.
  const a=ngon(10,4,0),b=ngon(10,4,5,0,2),c=ngon(10,4,9,0,1,0,true);
  expect(closestLoftOrders([a,b,c])).toEqual([{start:0,forward:true},{start:2,forward:true},{start:0,forward:false}]);
 });
 it('lines the centroids up in the first plane before comparing (shifted sections keep their start)',()=>{
  expect(closestLoftOrders([ngon(10,6,0),ngon(10,6,10,0,0,40)])).toEqual([{start:0,forward:true},{start:0,forward:true}]);
 });
});

describe('loft pairing option',{timeout:240_000},()=>{
 it('leaves default lofts byte-identical: no option and pairing "authored" build the same mesh',()=>{
  const sections=[ngon(20,5,0),ngon(14,5,12,.4,2),ngon(18,5,30,.1,4)];
  const plain=compileCode(program(loftSource(sections))),authored=compileCode(program(loftSource(sections,', {pairing: "authored"}')));
  expect(JSON.stringify(authored.shape)).toBe(JSON.stringify(plain.shape));
  expect(plain.usesLoftPairing).toBe(false);expect(authored.usesLoftPairing).toBe(true);
  // A program without the option keeps its document version (42 for a ruled loft).
  const s=createCadSession();try{s.addCode(program(loftSource(sections)));expect(s.state.document.version).toBe(42);}finally{s.dispose();}
 });

 it('pairs a re-drawn square with its closest corners: a prism, not a twisted loft',()=>{
  const sections=[ngon(10,4,0),ngon(10,4,20,0,1)];
  const authored=build(program(loftSource(sections))),paired=build(program(loftSource(sections,closest)));
  const prism=2*10*10*20;
  expect(authored.manifold.volume).toBeLessThan(prism*.9);
  expect(rel(paired.manifold.volume,prism)).toBeLessThan(1e-6);expect(rel(paired.exact.volume,prism)).toBeLessThan(1e-9);
  expect(paired.doc.version).toBe(46);
 });

 it('agrees with the exact kernel on random twisted, re-started, reversed, shifted and descending lofts',()=>{
  const next=random(46);let checked=0;
  for(let trial=0;trial<24;trial++){
   const n=3+Math.floor(next()*7),count=2+Math.floor(next()*3),descending=next()<.25,clockwise=next()<.25;
   let z=0;const sections=Array.from({length:count},(_,s)=>{if(s)z+=(descending?-1:1)*(8+next()*10);return ngon(10+next()*12,n,z,next()*2*Math.PI,Math.floor(next()*n),(next()-.5)*6,clockwise);});
   const shape=compileCode(program(loftSource(sections,closest))).shape;
   if(shape.kind!=='polyhedron')throw Error('loft');
   const built=build(program(loftSource(sections,closest)));
   expect(rel(built.exact.volume,built.manifold.volume)).toBeLessThan(2e-6);
   // The mesh is the ruled loft of the re-started sections.
   if(shape.ruled){expect(rel(built.exact.volume,ruledVolume(shape.ruled))).toBeLessThan(1e-9);expect(shape.closest).toHaveLength(count);checked++;}
  }
  expect(checked).toBeGreaterThan(12);
 });

 it('pairs smoothLoft sections the same way in the mesh and the exact kernel',()=>{
  const next=random(43);
  for(let trial=0;trial<8;trial++){
   let z=0;const n=4+Math.floor(next()*5),sections=Array.from({length:3+Math.floor(next()*2)},(_,s)=>{if(s)z+=14+next()*6;return ngon(14+next()*6,n,z,next()*.6,Math.floor(next()*n),(next()-.5)*3);});
   const p=program(`return smoothLoft(${JSON.stringify(sections)}${closest});`),shape=compileCode(p).shape;
   if(shape.kind!=='polyhedron'||!shape.smooth||!shape.closest)throw Error('smooth loft');
   const built=build(p);
   expect(rel(built.exact.volume,smoothLoftVolume(smoothLoftCurves(shape.smooth)))).toBeLessThan(1e-9);
   expect(rel(built.manifold.volume,built.exact.volume)).toBeLessThan(1e-3);
  }
 });

 it('turns a section drawn the other way round, which an authored loft refuses',()=>{
  const sections=[ngon(10,6,0),ngon(8,6,15,.2,3,0,true),ngon(10,6,30,.1)];
  expect(()=>compileCode(program(loftSource(sections)))).toThrow('consistent winding');
  const built=build(program(loftSource(sections,closest))),shape=compileCode(program(loftSource(sections,closest))).shape;
  if(shape.kind!=='polyhedron'||!shape.ruled)throw Error('ruled loft');
  expect(rel(built.exact.volume,ruledVolume(shape.ruled))).toBeLessThan(1e-9);
  expect(rel(built.manifold.volume,built.exact.volume)).toBeLessThan(2e-6);
 });

 it('refuses malformed options, in English and German',()=>{
  const sections=JSON.stringify([ngon(10,4,0),ngon(10,4,5)]);
  expect(()=>compileCode(program(`return loft(${sections}, {pairing: "nearest"});`))).toThrow('Loft pairing must be "authored" or "closest"');
  expect(()=>compileCode(program(`return loft(${sections}, {ruled: "closest"});`))).toThrow('Loft options take only pairing');
  expect(()=>compileCode(program(`return loft(${sections}, {pairing: "closest", ruled: 1});`))).toThrow('Loft options take only pairing');
  expect(()=>compileCode(program(`return loft(${sections}, {pairing: closest});`))).toThrow('Loft pairing must be');
  expect(compileCode(program(`return loft(${sections}, {pairing: "closest",});`)).usesLoftPairing).toBe(true);
  setLocale('de');try{expect(()=>compileCode(program(`return loft(${sections}, {pairing: "x"});`))).toThrow('Loft-Zuordnung (pairing) muss');}finally{setLocale('en');}
 });
});

describe('document version 46',{timeout:120_000},()=>{
 const sections=[ngon(10,4,0),ngon(10,4,20,0,1)];
 it('raises a document holding the option to 46, refuses it below, and Undo returns',()=>{
  const s=createCadSession(),initial=s.state.document.version;
  try{
   s.addCode(program(loftSource(sections,closest)),'Paired');
   const doc=structuredClone(s.state.document);expect(doc.version).toBe(46);
   expect(()=>validateDocument({...doc,version:45})).toThrow('requires document version 46');
   expect(()=>validateDocument({...doc,version:999 as 46})).toThrow('unsupported format, version or units');
   s.undo();expect(s.state.document.version).toBe(initial);
   // The option written as "authored" is still the option: version 46 (older SDKs cannot parse it).
   s.addCode(program(loftSource(sections,', {pairing: "authored"}')));expect(s.state.document.version).toBe(46);
  }finally{s.dispose();}
 });
 it('round-trips through serialization and model source',()=>{
  const s=createCadSession();
  try{
   s.addCode(program(loftSource(sections,closest)),'Paired');s.addCode(program(loftSource(sections)),'Authored');
   const text=s.serialize(),parsed=parseDocument(text);
   expect(serializeDocument(parsed)).toBe(text);expect(parsed.version).toBe(46);
   const rebuilt=compileModelSource(generateModelSource(parsed),parsed);
   expect(rebuilt.version).toBe(46);
   const volumes=manifold.evaluate(rebuilt).bodies.map(b=>b.volume).sort((a,b)=>a-b);
   expect(volumes[1]).toBeCloseTo(4000,6);expect(volumes[0]).toBeLessThan(3600);
  }finally{s.dispose();}
 });
});

describe('.kcad.ts converter',{timeout:240_000},()=>{
 // A square drawn from a later corner in each section, as kernelCAD models often are.
 const source=(options:string,turns=[0,1,2])=>`meta({ name: 'post', license: 'MIT' });
const square = (r, start) => { const c = [[r, r], [-r, r], [-r, -r], [r, -r]]; let p = path().moveTo(...c[start % 4]); for (let i = 1; i < 4; i++) p = p.lineTo(...c[(start + i) % 4]); return p.close(); };
return square(10, ${turns[0]}).loft([${turns.slice(1).map((t,i)=>`square(${8-2*i}, ${t})`).join(', ')}], { spacing: 20${options} });`;
 it('writes pairing "closest" on ruled and smooth lofts, and builds them as ThruSections pairs them',()=>{
  const ruled=importKernelCAD(source(', ruled: true'));
  expect(ruled.warnings).toEqual([]);
  const program=ruled.parts[0].program;
  expect(program.source).toMatch(/^return loft\(.*, \{pairing: "closest"\}\);$/s);expect(program.version).toBe(2);
  // Frusta of squares 20, 16, 12 mm over 20 mm each: h/3 (A0 + sqrt(A0 A1) + A1).
  const frusta=20/3*(400+320+256)+20/3*(256+192+144);
  const built=build(program);
  expect(rel(built.manifold.volume,frusta)).toBeLessThan(1e-6);expect(rel(built.exact.volume,frusta)).toBeLessThan(1e-9);
  expect(built.doc.version).toBe(46);
  const smooth=importKernelCAD(source(''));
  expect(smooth.parts[0].program.source).toMatch(/^return smoothLoft\(.*, \{pairing: "closest"\}\);$/s);
  const shape=compileCode(smooth.parts[0].program).shape;if(shape.kind!=='polyhedron'||!shape.smooth||!shape.closest)throw Error('smooth loft');
  const smoothBuilt=build(smooth.parts[0].program);
  expect(rel(smoothBuilt.exact.volume,smoothLoftVolume(smoothLoftCurves(shape.smooth)))).toBeLessThan(1e-9);
  expect(rel(smoothBuilt.manifold.volume,smoothBuilt.exact.volume)).toBeLessThan(1e-4);
 });
 it('keeps every digit of sections whose closest pairing is a tie that rounding would decide',()=>{
  // Twelve-gons turned against each other by half a step: two starts are equally close.
  const tie=`meta({ name: 'sack', license: 'CC0-1.0' });
const sides = 12, R = 450, H = 820;
const ring = (r, back, rot) => { const pt = (k) => { const a = rot + (2 * Math.PI * k) / sides, sy = Math.sin(a), rr = r * (1 + back * Math.max(0, sy)); return [rr * Math.cos(a), rr * sy]; }; let p = path().moveTo(pt(0)[0], pt(0)[1]); for (let k = 1; k < sides; k++) p = p.lineTo(pt(k)[0], pt(k)[1]); return p.close(); };
return ring(R * 0.85, 0, 0).loft([ring(R, 0.05, Math.PI / sides), ring(R * 0.9, 0.1, 0), ring(R * 0.6, 0.15, Math.PI / sides), ring(R * 0.28, 0.1, 0)], { planes: [{ plane: 'XY', origin: [0, 0, 0] }, { plane: 'XY', origin: [0, 0, H * 0.25] }, { plane: 'XY', origin: [0, R * 0.08, H * 0.55] }, { plane: 'XY', origin: [0, R * 0.3, H * 0.85] }, { plane: 'XY', origin: [0, R * 0.42, H] }], ruled: true });`;
  const program=importKernelCAD(tie).parts[0].program,shape=compileCode(program).shape;
  expect(program.source).toMatch(/\d\.\d{9,}/);
  if(shape.kind!=='polyhedron'||!shape.closest)throw Error('ruled loft');
  // As the source's own numbers pair: every section keeps its start.
  expect(closestLoftOrders(shape.closest)).toEqual(shape.closest.map(()=>({start:0,forward:true})));
  // A loft without a tie is written with the usual six decimals.
  expect(importKernelCAD(source(', ruled: true')).parts[0].program.source).not.toMatch(/\d\.\d{7,}/);
 });
});
