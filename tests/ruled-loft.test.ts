// SPDX-License-Identifier: BSD-3-Clause
// CAD Script revision 2: `loft` builds ruled side surfaces; revision 1 keeps the fixed diagonal.
import {readFileSync} from 'node:fs';
import {beforeAll,describe,expect,it} from 'vitest';
import {CAD_SCRIPT_REVISION,validateDocument,compileCode,createCadSession,createDocument,generateModelSource,compileModelSource,hasTriangulatedLofts,importKernelCAD,parseDocument,serializeDocument} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram,Vec3} from '@brickwright/cad-core';
import {createGeometryKernel,type GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,type ExactBackend} from '@brickwright/cad-exact';

let manifold:GeometryKernel,exact:ExactBackend;
beforeAll(async()=>{[manifold,exact]=await Promise.all([createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),createExactBackend()]);},120_000);

const program=(source:string,version:1|2):CodeProgram=>({version,language:'brickwright-cad-script',parameters:{},source});
const ngon=(r:number,n:number,z:number,turn=0):Vec3[]=>Array.from({length:n},(_,i)=>{const a=turn+2*Math.PI*i/n;return [r*Math.cos(a),r*Math.sin(a),z];});
const loftSource=(sections:Vec3[][])=>`return loft(${JSON.stringify(sections)});`;
const shoelace=(ring:readonly Vec3[])=>ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+(p[0]*q[1]-q[0]*p[1])/2;},0);
/** Prismoidal formula: exact for ruled sides, whose cross-section area is quadratic in z. */
function ruledVolume(sections:readonly Vec3[][]):number{
 let v=0;for(let s=0;s+1<sections.length;s++){const a=sections[s],b=sections[s+1],h=b[0][2]-a[0][2],mid=a.map((p,i)=>p.map((x,k)=>(x+b[i][k])/2) as Vec3);v+=h/6*(shoelace(a)+4*shoelace(mid)+shoelace(b));}
 return Math.abs(v);
}
/** Side area of the ruled (bilinear) patches plus both caps, by 24-point Gauss-Legendre per patch. */
function ruledArea(sections:readonly Vec3[][]):number{
 const n=24,nodes:number[]=[],weights:number[]=[];
 for(let i=1;i<=n;i++){let x=Math.cos(Math.PI*(i-.25)/(n+.5)),dp=0;for(let it=0;it<100;it++){let p0=1,p1=x;for(let k=2;k<=n;k++){const p2=((2*k-1)*x*p1-(k-1)*p0)/k;p0=p1;p1=p2;}dp=n*(x*p1-p0)/(x*x-1);const dx=p1/dp;x-=dx;if(Math.abs(dx)<1e-15)break;}nodes.push((x+1)/2);weights.push(1/((1-x*x)*dp*dp));}
 let area=Math.abs(shoelace(sections[0]))+Math.abs(shoelace(sections.at(-1)!));
 for(let s=0;s+1<sections.length;s++)for(let j=0;j<sections[s].length;j++){
  const a=sections[s][j],b=sections[s][(j+1)%sections[s].length],d=sections[s+1][j],c=sections[s+1][(j+1)%sections[s].length];
  for(let i=0;i<n;i++)for(let k=0;k<n;k++){const u=nodes[i],v=nodes[k];
   const pu=[0,1,2].map(m=>(1-v)*(b[m]-a[m])+v*(c[m]-d[m])),pv=[0,1,2].map(m=>(1-u)*(d[m]-a[m])+u*(c[m]-b[m]));
   area+=weights[i]*weights[k]*Math.hypot(pu[1]*pv[2]-pu[2]*pv[1],pu[2]*pv[0]-pu[0]*pv[2],pu[0]*pv[1]-pu[1]*pv[0]);}
 }
 return area;
}
function build(p:CodeProgram){
 const s=createCadSession();try{s.addCode(p);const doc=s.state.document;return {doc,manifold:manifold.evaluate(doc).bodies[0],exact:exact.measure(doc).bodies[0]};}finally{s.dispose();}
}
const rel=(a:number,b:number)=>Math.abs(a-b)/Math.abs(b);
// fire-station/bay-warning-beacon lower lamp (catalog cross-check, cause 4).
const beacon=[ngon(82,10,0),ngon(77.9,10,150,Math.PI/10)];

describe('ruled lofts (revision 2)',{timeout:120_000},()=>{
 it('builds the ruled volume of twisted lofts in both kernels, and the ruled area in the exact kernel',()=>{
  const twisted=[ngon(10,4,0),ngon(10,4,20,Math.PI/4)],three=[ngon(30,6,0),ngon(24,6,15,.4),ngon(28,6,40,-.2)];
  for(const sections of [beacon,twisted,three]){
   const built=build(program(loftSource(sections),2)),V=ruledVolume(sections);
   expect(built.doc.version).toBe(42);
   expect(rel(built.manifold.volume,V)).toBeLessThan(1e-6);
   expect(rel(built.exact.volume,V)).toBeLessThan(1e-9);
   expect(rel(built.exact.area,ruledArea(sections))).toBeLessThan(1e-8);
  }
  expect(ruledVolume(beacon)).toBeCloseTo(2772519.67,2);
 });

 it('keeps the fixed diagonal for revision 1, in Manifold and in the exact kernel',()=>{
  const built=build(program(loftSource(beacon),1));
  expect(built.doc.version).toBe(4);
  expect(built.manifold.volume).toBeCloseTo(2678272.48,0);
  expect(built.exact.volume).toBeCloseTo(2678272.48,2);
  const compiled=compileCode(program(loftSource(beacon),1)).shape;
  expect(compiled).toMatchObject({kind:'polyhedron'});
  if(compiled.kind!=='polyhedron')throw Error('loft');
  expect(compiled.ruled).toBeUndefined();expect(compiled.points).toHaveLength(20);expect(compiled.faces).toHaveLength(2+2*10);
 });

 it('fans only twisted quads; untwisted lofts compile identically in both revisions',()=>{
  const frustum=[ngon(20,8,0),ngon(10,8,30)],v1=compileCode(program(loftSource(frustum),1)),v2=compileCode(program(loftSource(frustum),2));
  expect(v2.shape).toEqual(v1.shape);expect(v1.usesLoft).toBe(true);
  const twisted=compileCode(program(loftSource(beacon),2)).shape;
  if(twisted.kind!=='polyhedron')throw Error('loft');
  expect(twisted.points).toHaveLength(30);expect(twisted.faces).toHaveLength(2+4*10);expect(twisted.ruled).toHaveLength(2);
  expect(compileCode(program('let loftless = box(1, 1, 1);\nreturn loftless;',2)).usesLoft).toBe(false);
  // Syntactic: a loft in a branch the parameters do not choose still counts.
  expect(compileCode(program(`param on: scalar = 0;\nreturn choose(on > 0, ${loftSource(beacon).slice(7,-1)}, box(1, 1, 1));`,2)).usesLoft).toBe(true);
 });
});

describe('revision gate and document version 42',{timeout:120_000},()=>{
 const legacy=()=>{const s=createCadSession();s.addCode(program(loftSource(beacon),1),'Lamp');return s;};

 it('stores loft-free programs as revision 1 and leaves the document version alone',()=>{
  const s=createCadSession(),id=s.addCode(program('return box(10, 10, 10);',CAD_SCRIPT_REVISION));
  const node=s.state.document.nodes[id];
  expect(node.kind==='code'&&node.program.version).toBe(1);expect(s.state.document.version).toBe(4);
 });

 it('refuses revision-2 programs below document version 42 and unknown revisions',()=>{
  const s=createCadSession();s.addCode(program(loftSource(beacon),2));
  const doc=structuredClone(s.state.document) as CadDocument;expect(doc.version).toBe(42);
  expect(()=>validateDocument({...doc,version:41})).toThrow('requires document version 42');
  // What an SDK before revision 2 does: it knows only document versions up to 41 and program revision 1.
  expect(()=>validateDocument({...doc,version:44 as 42})).toThrow('unsupported format, version or units');
  const node=Object.values(doc.nodes)[0];if(node.kind!=='code')throw Error('code');
  expect(()=>compileCode({...node.program,version:3 as 2})).toThrow('Unsupported code program schema');
  expect(()=>compileCode({...node.program,version:1})).not.toThrow();
 });

 it('round-trips revisions through serialization and model source',()=>{
  const s=legacy();s.addCode(program(loftSource(beacon),2),'Ruled');
  const doc=s.state.document,text=serializeDocument(doc),parsed=parseDocument(text);
  expect(serializeDocument(parsed)).toBe(text);expect(parsed.version).toBe(42);
  const versions=(d:CadDocument)=>Object.values(d.nodes).map(n=>n.kind==='code'?n.program.version:0).sort();
  expect(versions(parsed)).toEqual([1,2]);
  const source=generateModelSource(doc);expect(source).toMatch(/, 2\);/);
  const rebuilt=compileModelSource(source,doc);expect(versions(rebuilt)).toEqual([1,2]);
 });

 it('never changes saved revision-1 lofts when a document is opened, edited elsewhere or copied',()=>{
  const s=legacy(),saved=s.serialize(),reopened=createCadSession(parseDocument(saved));
  expect(reopened.serialize()).toBe(saved);
  const id=reopened.state.document.roots[0];
  reopened.addCode(program('return box(5, 5, 5);',2),'Other');
  reopened.duplicate([id]);
  const lamps=Object.values(reopened.state.document.nodes).filter(n=>n.kind==='code'&&n.name.startsWith('Lamp'));
  expect(lamps).toHaveLength(2);for(const lamp of lamps)expect(lamp.kind==='code'&&lamp.program.version).toBe(1);
  expect(reopened.state.document.version).toBe(4);
  const node=reopened.state.document.nodes[id];if(node.kind!=='code')throw Error('code');
  // An edit of a revision-1 loft keeps revision 1.
  reopened.updateCode(id,{...node.program,source:node.program.source+'\n// edited'});
  const edited=reopened.state.document.nodes[id];expect(edited.kind==='code'&&edited.program.version).toBe(1);
  expect(hasTriangulatedLofts((edited as Extract<typeof edited,{kind:'code'}>).program)).toBe(true);
 });

 it('gives a loft added to an existing loft-free program ruled sides',()=>{
  const s=createCadSession(),id=s.addCode(program('return box(5, 5, 5);',1));
  s.updateCode(id,program(loftSource(beacon),1));
  const node=s.state.document.nodes[id];expect(node.kind==='code'&&node.program.version).toBe(2);expect(s.state.document.version).toBe(42);
  s.undo();expect(s.state.document.version).toBe(4);
 });

 it('upgrades triangulated lofts in one undoable step',()=>{
  const s=legacy(),before=s.serialize(),id=s.state.document.roots[0];
  expect(s.upgradeLofts()).toEqual([id]);
  const node=s.state.document.nodes[id];expect(node.kind==='code'&&node.program.version).toBe(2);
  expect(s.state.document.version).toBe(42);expect(s.state.label).toBe('Upgrade lofts to ruled surfaces');
  expect(manifold.evaluate(s.state.document).volume).toBeCloseTo(2772519.67,0);
  expect(()=>s.upgradeLofts()).toThrow('No triangulated lofts to upgrade');
  s.undo();expect(s.serialize()).toBe(before);
  expect(manifold.evaluate(s.state.document).volume).toBeCloseTo(2678272.48,0);
  s.redo();expect(s.state.document.version).toBe(42);
  const fresh=createCadSession(createDocument());fresh.addCode(program('return box(1, 1, 1);',1));
  expect(()=>fresh.upgradeLofts()).toThrow('No triangulated lofts to upgrade');
 });

 it('converts kernelCAD ruled lofts as revision 2 and loft-free parts as revision 1',()=>{
  const converted=importKernelCAD(`meta({ name: 'beacon', license: 'MIT' });
const ngon = (r, turn) => { let p = path().moveTo(r * Math.cos(turn), r * Math.sin(turn)); for (let i = 1; i < 10; i++) p = p.lineTo(r * Math.cos(turn + 2 * Math.PI * i / 10), r * Math.sin(turn + 2 * Math.PI * i / 10)); return p.close(); };
const m = assembly('beacon');
m.part('lamp', ngon(82, 0).loft(ngon(77.9, Math.PI / 10), { spacing: 150, ruled: true }));
m.part('base', box(10, 10, 10));
return m;`);
  const [lamp,base]=converted.parts;
  expect(lamp.program.version).toBe(2);expect(base.program.version).toBe(1);
  const built=build(lamp.program);
  // The converter prints coordinates rounded, hence 1e-8.
  expect(rel(built.exact.volume,ruledVolume(beacon))).toBeLessThan(1e-8);expect(rel(built.manifold.volume,ruledVolume(beacon))).toBeLessThan(1e-6);
 });
});
