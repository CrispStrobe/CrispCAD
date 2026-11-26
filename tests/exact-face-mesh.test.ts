// SPDX-License-Identifier: BSD-3-Clause
// Display meshes of exact solids with many holes in one planar face (packages/exact/src/face-mesh.ts):
// the polygon-with-holes triangulator, and the face-wise path that replaced SMLib's whole-body
// mesh for such bodies (superlinear in the hole count: 10-19 s CPU for a plate with 200 holes).
import {beforeAll,describe,expect,it} from 'vitest';
import {createExactBackend,createInThreadExactHost,displayMesh,displayTessellation,exactKernelIdentity,triangulatePolygon} from '@brickwright/cad-exact';
import type {ExactBackend,ExactKernel,ExactSolid} from '@brickwright/cad-exact';

let backend:ExactBackend,k:ExactKernel;
beforeAll(async()=>{backend=await createExactBackend();k=backend.kernel;},120_000);

const area=(xy:number[],triangles:number[])=>{
 let sum=0;
 for(let t=0;t<triangles.length;t+=3){
  const [a,b,c]=[triangles[t],triangles[t+1],triangles[t+2]];
  const value=((xy[2*b]-xy[2*a])*(xy[2*c+1]-xy[2*a+1])-(xy[2*b+1]-xy[2*a+1])*(xy[2*c]-xy[2*a]))/2;
  expect(value).toBeGreaterThanOrEqual(0);
  sum+=value;
 }
 return sum;
};
/** A w×h rectangle (with `split` extra points on each side) and `holes` regular polygons. */
function plate(w:number,h:number,holes:[number,number,number][],sides=24,split=0){
 const xy:number[]=[],rings:number[][]=[];
 const ring:number[]=[];const corners=[[0,0],[w,0],[w,h],[0,h]];
 corners.forEach(([x,y],i)=>{const [nx,ny]=corners[(i+1)%4];for(let s=0;s<=split;s++){ring.push(xy.length/2);xy.push(x+(nx-x)*s/(split+1),y+(ny-y)*s/(split+1));}});
 rings.push(ring);
 for(const [cx,cy,r] of holes){const hole:number[]=[];for(let i=0;i<sides;i++){hole.push(xy.length/2);xy.push(cx+r*Math.cos(2*Math.PI*i/sides),cy+r*Math.sin(2*Math.PI*i/sides));}rings.push(hole);}
 return {xy,rings};
}
const polygonArea=(r:number,sides:number)=>sides*r*r*Math.sin(2*Math.PI/sides)/2;

describe('triangulatePolygon',()=>{
 it('triangulates a square with a hole, keeping every point, whatever the ring orientation',()=>{
  for(const reverse of [false,true]){
   const {xy,rings}=plate(10,10,[[5,5,2]],8,2);
   const input=reverse?rings.map(ring=>[...ring].reverse()):rings;
   const triangles=triangulatePolygon(xy,input)!;
   expect(triangles).not.toBeNull();
   expect(new Set(triangles).size).toBe(xy.length/2);
   expect(area(xy,triangles)).toBeCloseTo(100-polygonArea(2,8),9);
   // Collinear points on the outline stay boundary points: n points in a polygon with h holes
   // make n + 2h - 2 triangles.
   expect(triangles.length/3).toBe(xy.length/2+2*1-2);
  }
 });
 it('bridges hundreds of holes, including holes on one row and one column (equal x and y)',()=>{
  const holes:[number,number,number][]=[];
  for(let i=0;i<20;i++)for(let j=0;j<20;j++)holes.push([3+6*i,3+6*j,2]);
  const {xy,rings}=plate(120,120,holes,32);
  const started=performance.now(),triangles=triangulatePolygon(xy,rings)!;
  expect(triangles).not.toBeNull();
  expect(triangles.length/3).toBe(xy.length/2+2*holes.length-2);
  expect(area(xy,triangles)).toBeCloseTo(120*120-holes.length*polygonArea(2,32),6);
  expect(performance.now()-started).toBeLessThan(5000);
 });
 it('refuses what it cannot triangulate instead of returning a wrong mesh',()=>{
  expect(triangulatePolygon([0,0,1,0,2,0],[[0,1,2]])).toBeNull();
  // A hole poking out of the outline.
  const {xy,rings}=plate(10,10,[[9,5,2]],8);
  expect(triangulatePolygon(xy,rings)).toBeNull();
 });
});

/** A 3 mm plate with `n` holes of 2 mm radius, 6 mm apart, built as one extruded profile. */
function holePlate(n:number):ExactSolid{
 const cols=Math.ceil(Math.sqrt(n*1.25)),rows=Math.ceil(n/cols),P=k.profile,holes=[];
 for(let i=0;i<n;i++)holes.push(P.translate(P.circle(2),[4+i%cols*6,4+Math.floor(i/cols)*6]));
 return k.extrude(P.subtract(P.rectangle(cols*6+2,rows*6+2,false),...holes),3);
}
const meshVolume=(mesh:{positions:number[];indices:number[]})=>{
 let v=0;const p=mesh.positions,ix=mesh.indices;
 for(let t=0;t<ix.length;t+=3){const a=3*ix[t],b=3*ix[t+1],c=3*ix[t+2];v+=p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])-p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]);}
 return v/6;
};
const cpuMs=()=>{const u=process.cpuUsage();return (u.user+u.system)/1000;};

describe('face-wise display mesh of plates with many holes',()=>{
 it('meshes a plate with 200 holes closed, within the chordal tolerance, in linear time',()=>{
  k.scope(()=>{
   const solid=holePlate(200),exact=k.volume(solid);
   const before=cpuMs(),mesh=displayTessellation(k,solid,'Plate'),cpu=cpuMs()-before;
   // SMLib's whole-body mesh took 9.8-18.7 s CPU here (2026-11-26, shared Apple M1); the face-wise path
   // 0.4-1.5 s. The bound is generous for a loaded machine, and still fails the old path.
   expect(cpu).toBeLessThan(10_000);
   // Each hole wall is a band of 36 quads (10°); the planar faces keep exactly its points.
   expect(mesh.indices.length/3).toBe(200*72+2*(4+200*36+2*200-2)+4*2);
   const volume=meshVolume(mesh);
   expect(volume).toBeGreaterThan(exact);
   expect((volume-exact)/exact).toBeLessThan(.01);
  });
 },180_000);
 it('falls back to the kernel mesh for bodies without such a face, unchanged',()=>{
  k.scope(()=>{
   const solid=holePlate(3);
   const ours=displayTessellation(k,solid,'Plate'),kernel=displayMesh(k.tessellate(solid,{tolerance:.01,angleDeg:10}),'Plate');
   expect(ours).toEqual(kernel);
  });
 },60_000);
 it('builds an exact feature on a many-hole plate through the command path',async()=>{
  const {createCadSession,createCommandRunner,exactFeatureKey}=await import('@brickwright/cad-core');
  const session=createCadSession(undefined,{kernels:[exactKernelIdentity]});
  const centres=Array.from({length:12},(_,i)=>[4+i%6*6,4+Math.floor(i/6)*6]);
  const holes=centres.map(([x,y])=>`move([${x}, ${y}, 1.5], cylinder(2, 6, 64))`).join(', ');
  session.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:`return subtract(move([19, 7, 1.5], box(38, 14, 3)), ${holes});`},'Plate');
  // Chamfer the edges of the front face only: the top and bottom keep their 12 holes.
  const result=await createCommandRunner(session,{exact:createInThreadExactHost()}).runAsync('chamfer 0.5 Plate --face -y');
  expect(result.edited,result.output).toBe(true);
  const id=session.state.document.roots.find(root=>session.state.document.nodes[root].kind==='exact-feature')!;
  const node=session.state.document.nodes[id] as unknown as {display:{sourceKey:string;positions:number[];indices:number[]}};
  expect(node.display.sourceKey).toBe(exactFeatureKey(session.state.document,id));
  // The face-wise path meshed it: each hole rim has the band's 36 points (SMLib's mesh has 64).
  const p=node.display.positions,rim=[];
  for(let i=0;i<p.length;i+=3)if(Math.abs(p[i+2]-3)<1e-6&&centres.some(([x,y])=>Math.abs(Math.hypot(p[i]-x,p[i+1]-y)-2)<1e-6))rim.push(i);
  expect(rim.length).toBe(12*36);
 },300_000);
});
