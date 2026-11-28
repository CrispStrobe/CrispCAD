// SPDX-License-Identifier: BSD-3-Clause
// "Check for manufacturing" (Phase 6.3 of docs/CRISPCAD-CONVERGENCE.md): FDM printing, 3-axis CNC
// milling (with pocket depth and dogbones), laser-cut sheet and injection moulding (draft,
// undercuts along the pull, wall uniformity), plus an edge-radius check. Original code; the rules and their
// numbers follow the kernel lab's guides (cnc-internal-corner-radius, edge-radius-check,
// fdm-design-rules), not its implementation.
//
// Two sources of geometry, and every check says which it used:
// - exact: the exact kernel's B-rep of the body (the `drawing` exact request: faces with their
//   surface kind, radius and axis, edges with their curve and the two faces they bound, and a
//   face-wise mesh whose triangles know their face). Fillet radii are the surfaces' radii, edges
//   are classified convex/concave/tangent from the exact surface normals, and a wall thickness is
//   the distance from a point on an exact face to the exact face the inward ray meets (planes,
//   cylinders, spheres; other surfaces at the mesh's chord tolerance).
// - mesh: the Manifold display mesh, for bodies without an exact B-rep (an imported mesh, a
//   feature the exact kernel refuses) and for the orientation-dependent FDM checks (overhangs, bed
//   fit), which are the existing printability screen.
// Locations and marks are world millimetres, as the bodies are in the model.
import {MANUFACTURING_CHECK_VERSION,resolveManufacturingSettings,t} from '@brickwright/cad-core';
import type {ApproachAxis,ExactDrawingBody,ExactDrawingData,ManufacturingBodyReport,ManufacturingCheck,ManufacturingFinding,ManufacturingGeometry,ManufacturingMark,ManufacturingReport,ManufacturingSettings,ManufacturingStatus} from '@brickwright/cad-core';
import type {BodyMesh} from '../kernel.js';
import {TriangleBvh} from './meshBvh.js';
import {closestPointOnTriangle} from './meshClosestPoint.js';
import {checkPrintability} from './printability.js';
import type {BodyPrintability} from './printability.js';
import type {Vec3} from './vec3.js';

/** Findings listed per check (the rest are counted). */
export const MAX_MANUFACTURING_FINDINGS=25;
/** Triangles drawn for one finding. */
const MAX_MARK_TRIANGLES=6000;
/** Wall-thickness samples per body. */
const WALL_SAMPLE_BUDGET=40000;
/** Offset of a wall ray's origin into the material and its traversal floor (mm). */
const RAY_EPS=1e-4;
/** Normals closer than this are tangent (exact surface normals; degrees). */
const TANGENT_DEG=.5;
/** The same where a normal had to come from the mesh (the drawing mesh's angle limit is 10°). */
const TANGENT_MESH_DEG=12;
/** |direction · axis| above this: parallel to the axis. */
const PARALLEL=.98;
/** |normal · axis| below this: a wall along the axis (within about 11.5°). */
const WALL=.2;
/** Radii compared against limits get this allowance (mm), so R3 passes a 3 mm minimum. */
const RADIUS_TOLERANCE=1e-6;
/** A cylinder whose faces cover all but this angle (radians, about 2°) is a full bore or boss. */
const FULL_TURN_GAP=.035;
const DEG=Math.PI/180;

const sub=(a:readonly number[],b:readonly number[]):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a:readonly number[],b:readonly number[]):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const scale=(a:readonly number[],s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a:readonly number[],b:readonly number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:readonly number[],b:readonly number[]):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=(a:readonly number[])=>Math.hypot(a[0],a[1],a[2]);
const unit=(a:readonly number[]):Vec3=>{const l=length(a);return l>0?[a[0]/l,a[1]/l,a[2]/l]:[0,0,0];};
const angleBetween=(a:readonly number[],b:readonly number[])=>Math.acos(Math.min(1,Math.max(-1,dot(a,b))));
const mm=(value:number)=>Number(value.toFixed(3)).toLocaleString(undefined,{maximumFractionDigits:3});
const AXES:Record<ApproachAxis,Vec3>={'+x':[1,0,0],'-x':[-1,0,0],'+y':[0,1,0],'-y':[0,-1,0],'+z':[0,0,1],'-z':[0,0,-1]};

// ---------------------------------------------------------------------------------------------
// Triangle surfaces (the exact body's face-wise mesh, or a Manifold mesh)

export interface Surface {
 readonly positions:ArrayLike<number>;readonly indices:ArrayLike<number>;
 /** Per triangle: outward unit normal, centroid, area. */
 readonly normal:Float64Array;readonly centroid:Float64Array;readonly area:Float64Array;
 readonly count:number;readonly bvh:TriangleBvh;readonly diagonal:number;
 /** Per triangle: its B-rep face (exact surfaces only). */
 readonly faceOf?:ArrayLike<number>;
}
const vertex=(s:Surface,i:number):Vec3=>[s.positions[3*i],s.positions[3*i+1],s.positions[3*i+2]];
const corners=(s:Surface,tri:number):[Vec3,Vec3,Vec3]=>[vertex(s,s.indices[3*tri]),vertex(s,s.indices[3*tri+1]),vertex(s,s.indices[3*tri+2])];
const triNormal=(s:Surface,tri:number):Vec3=>[s.normal[3*tri],s.normal[3*tri+1],s.normal[3*tri+2]];
const triCentroid=(s:Surface,tri:number):Vec3=>[s.centroid[3*tri],s.centroid[3*tri+1],s.centroid[3*tri+2]];

function surfaceOf(positions:ArrayLike<number>,indices:ArrayLike<number>,faceOf?:ArrayLike<number>):Surface{
 const count=indices.length/3,normal=new Float64Array(3*count),centroid=new Float64Array(3*count),area=new Float64Array(count);
 const s={positions,indices} as Surface;
 let volume=0;const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let tri=0;tri<count;tri++){
  const [a,b,c]=corners(s,tri),n=cross(sub(b,a),sub(c,a)),l=length(n);
  volume+=dot(a,cross(b,c))/6;
  for(const p of [a,b,c])for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  if(l>0)normal.set([n[0]/l,n[1]/l,n[2]/l],3*tri);
  centroid.set([(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3],3*tri);
  area[tri]=l/2;
 }
 // An inward-wound mesh: flip every normal so they point out of the solid.
 if(volume<0)for(let i=0;i<normal.length;i++)normal[i]=-normal[i];
 return {positions,indices,normal,centroid,area,count,bvh:new TriangleBvh({vertices:positions,triangles:indices}),diagonal:count?length(sub(max,min)):0,...(faceOf?{faceOf}:{})};
}

// ---------------------------------------------------------------------------------------------
// The exact model: faces with analytic normals, classified edges, cylinder groups

type EdgeKind='convex'|'concave'|'tangent'|'seam';
export interface EdgeInfo {readonly index:number;readonly kind:EdgeKind;readonly point:Vec3;readonly tangent:Vec3;readonly normals?:readonly [Vec3,Vec3];readonly angleDeg:number;readonly approximate:boolean;readonly line:boolean}
export interface CylinderGroup {readonly faces:number[];readonly radius:number;readonly origin:Vec3;readonly direction:Vec3;readonly concave:boolean;readonly full:boolean;readonly hMin:number;readonly hMax:number;
 /** Angle the faces cover around the axis (radians; 2π for a full bore or boss). */
 readonly span:number}
export interface ExactModel {
 readonly body:ExactDrawingBody;readonly surface:Surface;
 readonly faceTris:number[][];readonly faceArea:number[];
 /** Edges of each face (indices into body.edges). */
 readonly faceEdges:number[][];
 readonly edges:EdgeInfo[];
 readonly cylinders:CylinderGroup[];
 /** Face index → its cylinder group. */
 readonly cylinderOf:Map<number,CylinderGroup>;
}

/** +1 when the face's outward normal points away from its axis (a boss or a round), −1 toward it. */
function radialSign(face:ExactDrawingBody['faces'][number]){
 if(!face.axis)return 1;
 const d=unit(face.axis.direction),q=sub(face.point,face.axis.origin),r=sub(q,scale(d,dot(q,d)));
 return dot(face.normal,r)>=0?1:-1;
}
function radialUnit(origin:readonly number[],direction:readonly number[],p:readonly number[]):Vec3{
 const d=unit(direction),q=sub(p,origin);return unit(sub(q,scale(d,dot(q,d))));
}

/** The exact outward normal of face `f` at a point on (or within the chord tolerance of) it;
 * undefined for surfaces without a closed form here (the caller uses the mesh). */
function exactNormal(body:ExactDrawingBody,f:number,p:readonly number[]):Vec3|undefined{
 const face=body.faces[f];
 switch(face.surface){
  case 'plane':return [...face.normal] as Vec3;
  case 'cylinder':return face.axis?scale(radialUnit(face.axis.origin,face.axis.direction,p),radialSign(face)):undefined;
  case 'cone':{
   if(!face.axis)return undefined;
   const d=unit(face.axis.direction),r0=radialUnit(face.axis.origin,d,face.point),a=dot(face.normal,r0),b=dot(face.normal,d);
   return unit(add(scale(radialUnit(face.axis.origin,d,p),a),scale(d,b)));
  }
  case 'sphere':{
   if(!face.axis)return undefined;
   const c=face.axis.origin,s=dot(face.normal,sub(face.point,c))>=0?1:-1;
   return scale(unit(sub(p,c)),s);
  }
  case 'torus':{
   if(!face.axis||face.radius===undefined)return undefined;
   const o=face.axis.origin,d=unit(face.axis.direction);
   // The tube centre of face.point lies in the torus's mid plane: that fixes the normal's sign.
   const candidates=[1,-1].map(s=>({s,c:sub(face.point,scale(face.normal,s*face.radius!))}));
   const {s,c}=candidates.sort((x,y)=>Math.abs(dot(sub(x.c,o),d))-Math.abs(dot(sub(y.c,o),d)))[0];
   const q0=sub(c,o),major=length(sub(q0,scale(d,dot(q0,d))));
   const centre=add(o,scale(radialUnit(o,d,p),major));
   return scale(unit(sub(p,centre)),s);
  }
  default:return undefined;
 }
}

function nearestTriangle(m:{surface:Surface;faceTris:number[][]},f:number,p:Vec3):number{
 let best=-1,bestD=Infinity;
 for(const tri of m.faceTris[f]??[]){
  const [a,b,c]=corners(m.surface,tri),q=closestPointOnTriangle(p,a,b,c),d=length(sub(q,p));
  if(d<bestD){bestD=d;best=tri;}
 }
 return best;
}
/** Normal of face `f` at `p`: exact where the surface has a closed form, else the nearest triangle's. */
function normalAt(m:ExactModel|{body:ExactDrawingBody;surface:Surface;faceTris:number[][]},f:number,p:Vec3):{n:Vec3;exact:boolean}{
 const n=exactNormal(m.body,f,p);
 if(n&&length(n)>0)return {n,exact:true};
 const tri=nearestTriangle(m,f,p);
 return {n:tri>=0?triNormal(m.surface,tri):[...m.body.faces[f].normal] as Vec3,exact:false};
}

const sameCylinder=(a:{radius:number;origin:Vec3;direction:Vec3},b:{radius:number;origin:Vec3;direction:Vec3})=>{
 const scaleR=Math.max(1,a.radius);
 if(Math.abs(a.radius-b.radius)>1e-6*scaleR)return false;
 if(length(cross(a.direction,b.direction))>1e-6)return false;
 const q=sub(b.origin,a.origin);
 return length(sub(q,scale(a.direction,dot(q,a.direction))))<1e-5*scaleR;
};

function buildExactModel(body:ExactDrawingBody):ExactModel{
 const surface=surfaceOf(body.mesh.positions,body.mesh.indices,body.mesh.faceOf);
 const faceTris:number[][]=body.faces.map(()=>[]),faceArea=body.faces.map(()=>0);
 for(let tri=0;tri<surface.count;tri++){const f=body.mesh.faceOf[tri];faceTris[f]?.push(tri);faceArea[f]+=surface.area[tri];}
 const faceEdges:number[][]=body.faces.map(()=>[]);
 body.edges.forEach((edge,i)=>new Set(edge.faces).forEach(f=>faceEdges[f]?.push(i)));
 const partial={body,surface,faceTris};
 // Cylinder groups: faces of one cylindrical surface (SMLib may split a bore in two).
 const cylinders:CylinderGroup[]=[],cylinderOf=new Map<number,CylinderGroup>();
 body.faces.forEach((face,f)=>{
  if(face.surface!=='cylinder'||!face.axis||face.radius===undefined)return;
  const key={radius:face.radius,origin:[...face.axis.origin] as Vec3,direction:unit(face.axis.direction)};
  let group=cylinders.find(g=>sameCylinder(g,key)&&g.concave===(radialSign(face)<0));
  if(!group){group={faces:[],...key,concave:radialSign(face)<0,full:false,hMin:Infinity,hMax:-Infinity,span:0};cylinders.push(group);}
  group.faces.push(f);cylinderOf.set(f,group);
 });
 for(let g=0;g<cylinders.length;g++){
  const group=cylinders[g],d=group.direction,u=unit(cross(Math.abs(d[0])<.9?[1,0,0]:[0,1,0],d)),v=cross(d,u);
  // Angular coverage: each triangle covers the arc between its corners (bins of half a degree).
  const bins=new Uint8Array(720);let hMin=Infinity,hMax=-Infinity;
  for(const f of group.faces)for(const tri of faceTris[f]){
   const angles=corners(surface,tri).map(p=>{
    const q=sub(p,group.origin),h=dot(q,d);hMin=Math.min(hMin,h);hMax=Math.max(hMax,h);
    return (Math.atan2(dot(q,v),dot(q,u))+2*Math.PI)%(2*Math.PI);
   }).sort((a,b)=>a-b);
   // The arc is the circle minus the largest gap between the corners.
   const gaps=[angles[1]-angles[0],angles[2]-angles[1],angles[0]+2*Math.PI-angles[2]],largest=gaps.indexOf(Math.max(...gaps));
   const start=angles[(largest+1)%3],span=2*Math.PI-gaps[largest];
   for(let b=0;b<720;b++){const centre=(b+.5)*Math.PI/360,offset=(centre-start+4*Math.PI)%(2*Math.PI);if(offset<=span)bins[b]=1;}
  }
  const gap=(720-bins.reduce((sum,b)=>sum+b,0))*Math.PI/360;
  const full={...group,full:gap<FULL_TURN_GAP,hMin,hMax,span:2*Math.PI-gap};
  cylinders[g]=full;for(const f of full.faces)cylinderOf.set(f,full);
 }
 const sameSurface=(a:number,b:number)=>{
  const fa=body.faces[a],fb=body.faces[b];
  if(cylinderOf.get(a)&&cylinderOf.get(a)===cylinderOf.get(b))return true;
  if(fa.surface==='plane'&&fb.surface==='plane')return dot(fa.normal,fb.normal)>1-1e-9&&Math.abs(dot(fa.normal,sub(fb.point,fa.point)))<1e-6;
  if(fa.surface===fb.surface&&fa.surface!=='plane'&&fa.axis&&fb.axis&&fa.radius!==undefined&&fa.radius===fb.radius)
   return length(sub(fa.axis.origin,fb.axis.origin))<1e-6&&length(cross(unit(fa.axis.direction),unit(fb.axis.direction)))<1e-6;
  return false;
 };
 const edges=body.edges.map((edge,index):EdgeInfo=>{
  const count=edge.points.length/3,at=(i:number):Vec3=>[edge.points[3*i],edge.points[3*i+1],edge.points[3*i+2]];
  const k=Math.floor((count-1)/2),point=count===2?scale(add(at(0),at(1)),.5):at(k);
  const tangent=unit(sub(at(Math.min(k+1,count-1)),at(Math.max(k-1,0))));
  // Straight: a line, or another curve whose samples lie on its chord (SMLib's chamfer rails are B-splines).
  const chord=sub(at(count-1),at(0)),chordLength=length(chord);
  const line=edge.curve==='line'||!edge.closed&&chordLength>1e-9&&Array.from({length:count},(_,i)=>i).every(i=>{const q=sub(at(i),at(0));return length(sub(q,scale(chord,dot(q,chord)/chordLength**2)))<1e-6*Math.max(1,chordLength);});
  if(edge.faces.length!==2||edge.faces[0]===edge.faces[1])return {index,kind:'seam',point,tangent,angleDeg:0,approximate:false,line};
  const [a,b]=edge.faces;
  if(sameSurface(a,b))return {index,kind:'seam',point,tangent,angleDeg:0,approximate:false,line};
  const na=normalAt(partial,a,point),nb=normalAt(partial,b,point),angle=angleBetween(na.n,nb.n)/DEG,approximate=!na.exact||!nb.exact;
  const normals=[na.n,nb.n] as const;
  if(angle<(approximate?TANGENT_MESH_DEG:TANGENT_DEG))return {index,kind:'tangent',point,tangent,normals,angleDeg:angle,approximate,line};
  // Concave when each face, next to the edge, lies on the outer side of the other.
  const ta=nearestTriangle(partial,a,point),tb=nearestTriangle(partial,b,point);
  const side=(ta>=0?dot(nb.n,sub(triCentroid(surface,ta),point)):0)+(tb>=0?dot(na.n,sub(triCentroid(surface,tb),point)):0);
  return {index,kind:side>0?'concave':'convex',point,tangent,normals,angleDeg:angle,approximate,line};
 });
 return {body,surface,faceTris,faceArea,faceEdges,edges,cylinders,cylinderOf};
}

// ---------------------------------------------------------------------------------------------
// Marks and findings

function trianglesOf(s:Surface,tris:readonly number[]):number[]{
 const out:number[]=[];
 for(const tri of tris.slice(0,MAX_MARK_TRIANGLES))for(const p of corners(s,tri))out.push(p[0],p[1],p[2]);
 return out;
}
const edgeLine=(m:ExactModel,e:number)=>Array.from(m.body.edges[e].points);
function faceMark(m:ExactModel,faces:readonly number[],extra:Partial<ManufacturingMark>={}):ManufacturingMark{
 const outline=[...new Set(faces.flatMap(f=>m.faceEdges[f]))];
 return {lines:[...outline.map(e=>edgeLine(m,e)),...(extra.lines??[])],triangles:trianglesOf(m.surface,faces.flatMap(f=>m.faceTris[f])),points:[...(extra.points??[])]};
}
const edgeMark=(m:ExactModel,edges:readonly number[]):ManufacturingMark=>({lines:edges.map(e=>edgeLine(m,e)),triangles:[],points:[]});
const location=(p:readonly number[]):[number,number,number]=>[p[0],p[1],p[2]];
function faceCentre(m:ExactModel,faces:readonly number[]):Vec3{
 let total=0;const c:Vec3=[0,0,0];
 for(const f of faces)for(const tri of m.faceTris[f]){const a=m.surface.area[tri];total+=a;for(let k=0;k<3;k++)c[k]+=a*m.surface.centroid[3*tri+k];}
 return total>0?scale(c,1/total):[...m.body.faces[faces[0]].point] as Vec3;
}

function check(id:string,label:string,geometry:ManufacturingGeometry,status:ManufacturingStatus,summary:string,findings:ManufacturingFinding[]=[],extra:Partial<Pick<ManufacturingCheck,'value'|'limit'|'unit'>>={}):ManufacturingCheck{
 return {id,label,status,summary,geometry,...extra,findings:findings.slice(0,MAX_MANUFACTURING_FINDINGS),more:Math.max(0,findings.length-MAX_MANUFACTURING_FINDINGS)};
}
const notChecked=(id:string,label:string,geometry:ManufacturingGeometry,why:string)=>check(id,label,geometry,'not-checked',why);

// ---------------------------------------------------------------------------------------------
// Wall thickness

interface WallHit {readonly thickness:number;readonly from:Vec3;readonly to:Vec3;readonly tri:number;readonly hitTri:number}
/** One wall sample for the thickness distribution: its weight is the surface area it stands for. */
interface WallSample extends WallHit {readonly weight:number}

/** The point `p` moved onto the exact surface of face `f` (planes, cylinders, spheres). */
function projectOnFace(body:ExactDrawingBody,f:number,p:Vec3):Vec3{
 const face=body.faces[f];
 if(face.surface==='plane')return sub(p,scale(face.normal,dot(face.normal,sub(p,face.point))));
 if((face.surface==='cylinder')&&face.axis&&face.radius!==undefined){
  const d=unit(face.axis.direction),q=sub(p,face.axis.origin),h=dot(q,d),r=sub(q,scale(d,h));
  return length(r)>0?add(add(face.axis.origin,scale(d,h)),scale(unit(r),face.radius)):p;
 }
 if(face.surface==='sphere'&&face.axis&&face.radius!==undefined){
  const q=sub(p,face.axis.origin);return length(q)>0?add(face.axis.origin,scale(unit(q),face.radius)):p;
 }
 return p;
}
/** Where the ray meets the exact surface of face `f`, near the mesh's answer `near`. */
function exactRayParameter(body:ExactDrawingBody,f:number,origin:Vec3,dir:Vec3,near:number):number{
 const face=body.faces[f],slack=4*body.tolerance+1e-6;
 const pick=(roots:number[])=>{
  const best=roots.filter(Number.isFinite).sort((a,b)=>Math.abs(a-near)-Math.abs(b-near))[0];
  return best!==undefined&&Math.abs(best-near)<=slack?best:near;
 };
 if(face.surface==='plane'){
  const den=dot(face.normal,dir);
  return Math.abs(den)<1e-12?near:pick([dot(face.normal,sub(face.point,origin))/den]);
 }
 const quadratic=(a:number,b:number,c:number)=>{const disc=b*b-4*a*c;if(a<1e-15||disc<0)return [];const r=Math.sqrt(disc);return [(-b-r)/(2*a),(-b+r)/(2*a)];};
 if(face.surface==='cylinder'&&face.axis&&face.radius!==undefined){
  const d=unit(face.axis.direction),q=sub(origin,face.axis.origin),a=sub(dir,scale(d,dot(dir,d))),b=sub(q,scale(d,dot(q,d)));
  return pick(quadratic(dot(a,a),2*dot(a,b),dot(b,b)-face.radius**2));
 }
 if(face.surface==='sphere'&&face.axis&&face.radius!==undefined){
  const q=sub(origin,face.axis.origin);
  return pick(quadratic(dot(dir,dir),2*dot(dir,q),dot(q,q)-face.radius**2));
 }
 return near;
}

/**
 * Wall thickness by inward rays from points spread over the surface (at most WALL_SAMPLE_BUDGET):
 * each ray starts on the face, goes against its outward normal, and the first surface it meets
 * ends the wall. On an exact model the start lies on the exact face and the end on the exact face
 * hit. A short hop whose middle is outside the solid is an air gap, not a wall, and is ignored.
 */
function sampleWalls(s:Surface,limit:number,options:{model?:ExactModel;filter?:(tri:number)=>boolean;collect?:WallSample[];budget?:number}={}):{thinnest:number;samples:number;thin:WallHit[]}{
 const budget=options.budget??WALL_SAMPLE_BUDGET;
 const tris:number[]=[];
 for(let tri=0;tri<s.count;tri++)if(s.area[tri]>1e-12&&(!options.filter||options.filter(tri)))tris.push(tri);
 const longest=tris.map(tri=>{const [a,b,c]=corners(s,tri);return Math.max(length(sub(b,a)),length(sub(c,b)),length(sub(a,c)));});
 let spacing=Math.max(limit,s.diagonal/200,1e-3);
 const perTri=()=>longest.map(l=>Math.min(12,Math.max(1,Math.ceil(l/spacing))));
 let n=perTri();
 while(n.reduce((sum,k)=>sum+k*(k+1)/2,0)>budget&&spacing<s.diagonal){spacing*=1.5;n=perTri();}
 const model=options.model;
 let thinnest=Infinity,samples=0;const thin:WallHit[]=[];
 tris.forEach((tri,i)=>{
  const [a,b,c]=corners(s,tri),k=n[i],ab=sub(b,a),ac=sub(c,a);
  for(let u=0;u<k;u++)for(let v=0;u+v<k;v++){
   if(samples>=budget*1.2)return;
   const p=add(a,add(scale(ab,(u+1/3)/k),scale(ac,(v+1/3)/k)));
   const f=model?model.body.mesh.faceOf[tri]:-1;
   const start=model?projectOnFace(model.body,f,p):p;
   // The exact normal where the surface has a closed form; otherwise this triangle's own.
   const n=(model?exactNormal(model.body,f,start):undefined)??triNormal(s,tri);
   const dir=scale(n,-1),origin=sub(start,scale(n,RAY_EPS));
   samples++;
   const hit=s.bvh.raycast(origin,dir,{tMin:RAY_EPS,skipTri:tri});
   if(!hit)continue;
   const tHit=model?exactRayParameter(model.body,model.body.mesh.faceOf[hit.triIndex],origin,dir,hit.t):hit.t;
   const thickness=tHit+RAY_EPS;
   if(!options.collect&&thickness>=thinnest&&thickness>=limit)continue;
   const middle=add(origin,scale(dir,tHit/2));
   if(!s.bvh.pointInside(middle))continue;
   if(options.collect){
    // Across the wall, not along it: a ray from a rim runs down the wall it tops, so the wall is
    // twice the distance from the hop's middle to the nearest surface (the inscribed ball there).
    const across=Math.min(thickness,2*(s.bvh.closestPoint(middle)?.distance??Infinity));
    options.collect.push({thickness:across,from:start,to:add(origin,scale(dir,tHit)),tri,hitTri:hit.triIndex,weight:s.area[tri]/(k*(k+1)/2)});
   }
   thinnest=Math.min(thinnest,thickness);
   if(thickness<limit-1e-9)thin.push({thickness,from:start,to:add(origin,scale(dir,tHit)),tri,hitTri:hit.triIndex});
  }
 });
 return {thinnest,samples,thin};
}

/**
 * The exact minimum distance between two faces where it has a closed form: opposite parallel
 * planes, a plane and a bore whose axis is parallel to it, two parallel bores. The closest points
 * are taken next to the sampled thinnest spot and must lie on both faces (within the mesh's chord
 * tolerance); otherwise undefined, and the sampled value stands.
 */
function exactPairMinimum(m:ExactModel,fa:number,fb:number,near:WallHit):{thickness:number;from:Vec3;to:Vec3}|undefined{
 const A=m.body.faces[fa],B=m.body.faces[fb],tol=2*m.body.tolerance+1e-6;
 const onFace=(f:number,p:Vec3)=>{const tri=nearestTriangle(m,f,p);if(tri<0)return false;const [a,b,c]=corners(m.surface,tri);return length(sub(closestPointOnTriangle(p,a,b,c),p))<=tol;};
 const accept=(thickness:number,from:Vec3,to:Vec3)=>thickness>0&&thickness<=near.thickness+1e-6&&onFace(fa,from)&&onFace(fb,to)?{thickness,from,to}:undefined;
 const bore=(f:number)=>{const g=m.cylinderOf.get(f);return g&&g.concave?g:undefined;};
 if(A.surface==='plane'&&B.surface==='plane'){
  if(dot(A.normal,B.normal)>-1+1e-9)return undefined;
  const d=Math.abs(dot(A.normal,sub(B.point,A.point))),from=projectOnFace(m.body,fa,near.from);
  return accept(d,from,sub(from,scale(A.normal,d)));
 }
 const planeBore=(plane:number,cyl:number,swap:boolean)=>{
  const P=m.body.faces[plane],g=bore(cyl);
  if(!g||Math.abs(dot(P.normal,g.direction))>1e-9)return undefined;
  // The axis point next to the sample, the plane's foot from it, and the bore's point toward the plane.
  const sample=swap?near.from:near.to,h=dot(sub(sample,g.origin),g.direction),axisPoint=add(g.origin,scale(g.direction,h));
  const D=dot(P.normal,sub(P.point,axisPoint)),toward=scale(P.normal,Math.sign(D)),foot=sub(axisPoint,scale(P.normal,dot(P.normal,sub(axisPoint,P.point))));
  const rim=add(axisPoint,scale(toward,g.radius)),d=Math.abs(D)-g.radius;
  return swap?accept(d,rim,foot):accept(d,foot,rim);
 };
 if(A.surface==='plane'&&B.surface==='cylinder')return planeBore(fa,fb,false);
 if(A.surface==='cylinder'&&B.surface==='plane')return planeBore(fb,fa,true);
 const ga=bore(fa),gb=bore(fb);
 if(ga&&gb&&length(cross(ga.direction,gb.direction))<1e-9){
  const h=dot(sub(near.from,ga.origin),ga.direction),ca=add(ga.origin,scale(ga.direction,h));
  const q=sub(gb.origin,ca),cb=sub(gb.origin,scale(ga.direction,dot(q,ga.direction))),between=unit(sub(cb,ca));
  return accept(length(sub(cb,ca))-ga.radius-gb.radius,add(ca,scale(between,ga.radius)),sub(cb,scale(between,gb.radius)));
 }
 return undefined;
}

function wallCheck(id:string,label:string,s:Surface,limit:number,model:ExactModel|undefined,options:{filter?:(tri:number)=>boolean;status?:'fail'|'warn';what?:string}={}):ManufacturingCheck{
 const geometry:ManufacturingGeometry=model?'exact':'mesh';
 const sampled=sampleWalls(s,limit,{model,filter:options.filter}),{samples,thin}=sampled;let thinnest=sampled.thinnest;
 if(!samples)return notChecked(id,label,geometry,t('No faces to measure.'));
 thin.sort((a,b)=>a.thickness-b.thickness);
 // One finding per pair of faces (exact) or per thin spot (mesh, spots within 2 × the limit merge).
 const groups:{key:string;worst:WallHit;tris:Set<number>}[]=[];
 for(const hit of thin){
  const key=model?[model.body.mesh.faceOf[hit.tri],model.body.mesh.faceOf[hit.hitTri]].sort((a,b)=>a-b).join('|'):'';
  const group=model?groups.find(g=>g.key===key):groups.find(g=>length(sub(g.worst.from,hit.from))<2*limit);
  if(group){group.tris.add(hit.tri);group.tris.add(hit.hitTri);}
  else groups.push({key,worst:hit,tris:new Set([hit.tri,hit.hitTri])});
 }
 let thinnestAll=thinnest;
 const findings=groups.map(({key,worst:sampled,tris}):ManufacturingFinding=>{
  const faces=model?[...new Set(key.split('|').map(Number))]:undefined;
  const pair=model?[model.body.mesh.faceOf[sampled.tri],model.body.mesh.faceOf[sampled.hitTri]]:undefined;
  const closed=model&&pair&&pair[0]!==pair[1]?exactPairMinimum(model,pair[0],pair[1],sampled):undefined;
  const worst=closed?{...sampled,...closed}:sampled;
  thinnestAll=Math.min(thinnestAll,worst.thickness);
  const measure={lines:[[...worst.from,...worst.to]],points:[...worst.from,...worst.to]};
  return {text:closed?t`${mm(worst.thickness)} mm thick (limit ${mm(limit)} mm), exact between the two faces`:t`${mm(worst.thickness)} mm thick (limit ${mm(limit)} mm)`,value:worst.thickness,location:location(worst.from),
   ...(faces?{faces}:{}),mark:model&&faces?faceMark(model,faces,measure):{...measure,triangles:trianglesOf(s,[...tris])}};
 });
 findings.sort((a,b)=>(a.value??0)-(b.value??0));
 thinnest=thinnestAll;
 const what=options.what??t('Walls');
 if(!Number.isFinite(thinnest))return check(id,label,geometry,'info',t`No opposite wall found within the part (${samples} samples).`,[],{limit,unit:'mm'});
 if(!findings.length)return check(id,label,geometry,'pass',t`${what} are at least ${mm(limit)} mm; thinnest ${mm(thinnest)} mm (${samples} samples).`,[],{value:thinnest,limit,unit:'mm'});
 return check(id,label,geometry,options.status??'fail',t`${what} as thin as ${mm(thinnest)} mm, below ${mm(limit)} mm, in ${findings.length} places (${samples} samples).`,findings,{value:thinnest,limit,unit:'mm'});
}

// ---------------------------------------------------------------------------------------------
// Edge radius

export interface Blend {readonly faces:number[];readonly radius:number;readonly convex:boolean;readonly surface:string}
export interface Chamfer {readonly face:number;readonly rails:number[];readonly widthMm?:number}

function edgeBreaks(m:ExactModel):{blends:Blend[];chamfers:Chamfer[];broken:Set<number>}{
 const {body,edges}=m,blends:Blend[]=[],chamfers:Chamfer[]=[],broken=new Set<number>();
 const tangentTo=(f:number)=>m.faceEdges[f].some(e=>edges[e].kind==='tangent');
 const seen=new Set<number>();
 body.faces.forEach((face,f)=>{
  if(seen.has(f)||face.radius===undefined||!['cylinder','torus','sphere'].includes(face.surface))return;
  const group=m.cylinderOf.get(f);
  if(group?.full)return; // a bore or a boss, not an edge treatment
  const faces=group?group.faces:[f];faces.forEach(g=>seen.add(g));
  if(!faces.some(tangentTo))return;
  blends.push({faces,radius:face.radius,convex:group?!group.concave:isConvexBlend(body,f),surface:face.surface});
 });
 // Chamfers: a planar strip between two parallel convex rails at a bevel angle, narrower than
 // long; or a cone ring between convex circular edges (a countersink-like bevel).
 const bevel=(e:number)=>edges[e].kind==='convex'&&edges[e].angleDeg>=10&&edges[e].angleDeg<=80;
 body.faces.forEach((face,f)=>{
  const own=m.faceEdges[f];
  if(face.surface==='plane'){
   const rails=own.filter(e=>edges[e].line&&bevel(e)).sort((a,b)=>body.edges[b].length-body.edges[a].length);
   for(let i=0;i<rails.length;i++)for(let j=i+1;j<rails.length;j++){
    const a=edges[rails[i]],b=edges[rails[j]];
    if(Math.abs(dot(a.tangent,b.tangent))<.999)continue;
    const offset=sub(b.point,a.point),width=length(sub(offset,scale(a.tangent,dot(offset,a.tangent))));
    if(width<=0||width>=.5*Math.min(body.edges[rails[i]].length,body.edges[rails[j]].length))continue;
    const neighbours=[rails[i],rails[j]].map(e=>body.edges[e].faces.find(g=>g!==f)!);
    if(neighbours.some(g=>m.faceArea[g]<=m.faceArea[f]))continue;
    chamfers.push({face:f,rails:[rails[i],rails[j]],widthMm:width});broken.add(rails[i]);broken.add(rails[j]);
    return;
   }
  }else if(face.surface==='cone'){
   const real=own.filter(e=>edges[e].kind!=='seam');
   if(real.length&&real.every(bevel)&&real.some(e=>body.edges[e].curve==='circle')){chamfers.push({face:f,rails:real});real.forEach(e=>broken.add(e));}
  }
 });
 // Edges between two chamfer faces (mitres at a corner) belong to the bevel.
 const chamferFaces=new Set(chamfers.map(c=>c.face));
 m.edges.forEach(e=>{const faces=body.edges[e.index].faces;if(faces.length===2&&faces.every(f=>chamferFaces.has(f)))broken.add(e.index);});
 return {blends,chamfers,broken};
}
/** A torus or sphere patch is a convex round when its outward normal points away from its centre. */
function isConvexBlend(body:ExactDrawingBody,f:number){
 const face=body.faces[f];
 if(face.surface==='sphere'&&face.axis)return dot(face.normal,sub(face.point,face.axis.origin))>0;
 if(face.surface==='torus'&&face.axis&&face.radius!==undefined){
  const o=face.axis.origin,d=unit(face.axis.direction);
  const centres=[1,-1].map(s=>({s,c:sub(face.point,scale(face.normal,s*face.radius!))}));
  return centres.sort((x,y)=>Math.abs(dot(sub(x.c,o),d))-Math.abs(dot(sub(y.c,o),d)))[0].s>0;
 }
 return true;
}

function edgeRadiusCheck(m:ExactModel,s:ManufacturingSettings):ManufacturingCheck{
 const label=t('Edge radius'),{blends,chamfers,broken}=edgeBreaks(m);
 const sharp=m.edges.filter(e=>(e.kind==='convex'||e.kind==='concave')&&!broken.has(e.index));
 const external=sharp.filter(e=>e.kind==='convex'),internal=sharp.filter(e=>e.kind==='concave');
 const findings:ManufacturingFinding[]=[];
 const radiusText=(b:Blend)=>(b.convex?t('Round'):t('Fillet'))+` R${mm(b.radius)}`;
 for(const b of blends){
  if(s.minRadiusMm!==undefined&&b.radius<s.minRadiusMm-RADIUS_TOLERANCE)findings.push({text:t`${radiusText(b)} below the minimum R${mm(s.minRadiusMm)}`,value:b.radius,location:location(faceCentre(m,b.faces)),faces:b.faces,mark:faceMark(m,b.faces)});
  if(s.maxRadiusMm!==undefined&&b.radius>s.maxRadiusMm+RADIUS_TOLERANCE)findings.push({text:t`${radiusText(b)} above the maximum R${mm(s.maxRadiusMm)}`,value:b.radius,location:location(faceCentre(m,b.faces)),faces:b.faces,mark:faceMark(m,b.faces)});
 }
 const refused=s.edgeBreak==='all'?sharp:s.edgeBreak==='external'?external:s.edgeBreak==='internal'?internal:[];
 for(const e of refused)findings.push({text:e.kind==='convex'?t`Sharp external edge, ${mm(m.body.edges[e.index].length)} mm long`:t`Sharp internal edge, ${mm(m.body.edges[e.index].length)} mm long`,value:0,location:location(e.point),edges:[e.index],faces:[...m.body.edges[e.index].faces],mark:edgeMark(m,[e.index])});
 const radii=blends.map(b=>b.radius),low=mm(Math.min(...radii)),high=mm(Math.max(...radii)),range=radii.length?(low===high?`R${low}`:`R${low}–R${high}`):'';
 const summary=[
  blends.length?t`${blends.length} fillets and rounds (${range})`:t('no fillets or rounds'),
  t`${chamfers.length} chamfers`,
  t`${external.length} sharp external and ${internal.length} sharp internal edges`,
 ].join(', ')+'.';
 const rules=s.minRadiusMm!==undefined||s.maxRadiusMm!==undefined||s.edgeBreak!=='none';
 const approximate=m.edges.some(e=>e.approximate&&e.kind!=='seam')?' '+t('Edges on cones of revolution or freeform faces were classified at the mesh tolerance.'):'';
 if(!rules)return check('edges.radius',label,'exact','info',summary+' '+t('No edge rules set.')+approximate);
 if(findings.length)return check('edges.radius',label,'exact','fail',summary+approximate,findings,{value:Math.min(...findings.map(f=>f.value??0)),...(s.minRadiusMm!==undefined?{limit:s.minRadiusMm}:{}),unit:'mm'});
 return check('edges.radius',label,'exact','pass',summary+approximate,[],{...(radii.length?{value:Math.min(...radii)}:{}),...(s.minRadiusMm!==undefined?{limit:s.minRadiusMm}:{}),unit:'mm'});
}

// ---------------------------------------------------------------------------------------------
// CNC milling

const reachable=(s:Surface,from:Vec3,axis:Vec3)=>s.bvh.raycast(from,axis,{tMin:1e-6})===null;
/** Unit approach direction of each setup (the tool comes from +axis toward the part). */
const axisVectors=(axes:readonly ApproachAxis[])=>axes.map(a=>AXES[a]);

/** A sharp vertical internal corner: collinear concave edges along a setup axis between two walls. */
interface SharpCorner {readonly edges:number[];length:number;readonly point:Vec3;readonly axis:Vec3;readonly normals:readonly [Vec3,Vec3];lo:number;hi:number}
/**
 * Internal corners along the setups' axes, open to the tool: sharp ones (radius 0, concave
 * straight edges between two walls) and partial concave cylinders along an axis (corner fillets;
 * full bores are drilled, not milled).
 */
function internalCorners(m:ExactModel,s:ManufacturingSettings):{sharp:SharpCorner[];fillets:CylinderGroup[]}{
 const axes=axisVectors(s.approachAxes),merged=new Map<string,SharpCorner>();
 for(const e of m.edges){
  if(e.kind!=='concave'||!e.line||!e.normals)continue;
  const [na,nb]=e.normals,air=unit(add(na,nb)),probe=add(e.point,scale(air,1e-3));
  const floor=axes.some(a=>Math.abs(dot(e.tangent,a))<1-PARALLEL&&(dot(na,a)>PARALLEL&&Math.abs(dot(nb,a))<WALL||dot(nb,a)>PARALLEL&&Math.abs(dot(na,a))<WALL)&&reachable(m.surface,probe,a));
  if(floor)continue;
  const axis=axes.find(a=>Math.abs(dot(e.tangent,a))>PARALLEL&&Math.abs(dot(na,a))<WALL&&Math.abs(dot(nb,a))<WALL&&reachable(m.surface,probe,a));
  if(!axis)continue;
  const len=m.body.edges[e.index].length,points=m.body.edges[e.index].points;
  let lo=Infinity,hi=-Infinity;
  for(let i=0;i<points.length;i+=3){const h=points[i]*axis[0]+points[i+1]*axis[1]+points[i+2]*axis[2];lo=Math.min(lo,h);hi=Math.max(hi,h);}
  // Collinear pieces of one corner line count as one corner.
  const key=[...sub(e.point,scale(axis,dot(e.point,axis)))].map(v=>Math.round(v*1e4)).join(',');
  const entry=merged.get(key);
  if(entry){entry.edges.push(e.index);entry.length+=len;entry.lo=Math.min(entry.lo,lo);entry.hi=Math.max(entry.hi,hi);}
  else merged.set(key,{edges:[e.index],length:len,point:e.point,axis,normals:[na,nb],lo,hi});
 }
 const fillets=m.cylinders.filter(g=>g.concave&&!g.full&&axes.some(a=>Math.abs(dot(g.direction,a))>PARALLEL));
 return {sharp:[...merged.values()],fillets};
}

function cncCornerCheck(m:ExactModel,s:ManufacturingSettings):ManufacturingCheck{
 const label=t('Internal corner radius'),toolR=s.toolDiameterMm/2,findings:ManufacturingFinding[]=[],advice:ManufacturingFinding[]=[];
 const {sharp,fillets}=internalCorners(m,s);
 for(const corner of sharp)findings.push({text:t`Sharp internal corner (radius 0), ${mm(corner.length)} mm long; the R${mm(toolR)} tool leaves a radius`,value:0,location:location(corner.point),edges:corner.edges,faces:[...new Set(corner.edges.flatMap(e=>m.body.edges[e].faces))],mark:edgeMark(m,corner.edges)});
 // Concave partial cylinders along a setup axis: pocket-corner fillets. Full bores are drilled.
 let smallest=Infinity;
 for(const g of fillets){
  smallest=Math.min(smallest,g.radius);
  const depth=g.hMax-g.hMin,where=location(faceCentre(m,g.faces));
  if(g.radius<toolR-RADIUS_TOLERANCE)findings.push({text:t`Corner fillet R${mm(g.radius)} below the R${mm(toolR)} tool radius (Ø${mm(s.toolDiameterMm)} end mill)`,value:g.radius,location:where,faces:g.faces,mark:faceMark(m,g.faces)});
  else if(g.radius<depth/3-RADIUS_TOLERANCE)advice.push({text:t`Corner fillet R${mm(g.radius)} is ${mm(depth)} mm deep: below a third of its depth (R${mm(depth/3)}), which needs a long, slender tool`,value:g.radius,location:where,faces:g.faces,mark:faceMark(m,g.faces)});
 }
 const value=sharp.length?0:Number.isFinite(smallest)?smallest:undefined;
 const extra={...(value!==undefined?{value}:{}),limit:toolR,unit:'mm' as const};
 if(findings.length){
  const parts=[sharp.length?t`${sharp.length} sharp internal corners (radius 0)`:'',findings.length-sharp.length?t`${findings.length-sharp.length} corner fillets as small as R${mm(smallest)}`:''].filter(Boolean).join(t(' and '));
  return check('cnc.internal-corners',label,'exact','fail',t`${parts} below the R${mm(toolR)} tool radius (Ø${mm(s.toolDiameterMm)} end mill); add fillets ≥ R${mm(toolR)} or use a smaller tool.`,[...findings,...advice],extra);
 }
 if(advice.length)return check('cnc.internal-corners',label,'exact','warn',t`All internal corners along the tool axes are ≥ R${mm(toolR)}, but ${advice.length} are deeper than three times their radius.`,advice,extra);
 return check('cnc.internal-corners',label,'exact','pass',t`All internal corners along the tool axes are ≥ R${mm(toolR)}.`,[],extra);
}

/** A circle of radius `r` about `centre` in the plane normal to `axis`, as a closed polyline. */
function circleLine(centre:Vec3,axis:Vec3,r:number,segments=32):number[]{
 const u=unit(cross(Math.abs(axis[0])<.9?[1,0,0]:[0,1,0],axis)),v=cross(axis,u),out:number[]=[];
 for(let i=0;i<=segments;i++){const a=2*Math.PI*i/segments;out.push(...add(centre,add(scale(u,r*Math.cos(a)),scale(v,r*Math.sin(a)))));}
 return out;
}
const atHeight=(p:Vec3,axis:Vec3,h:number):Vec3=>add(p,scale(axis,h-dot(p,axis)));

/**
 * Dogbones: an end mill leaves its own radius in every internal corner along its axis, so a
 * square-cornered part (a tenon, a sheet slotted into it, a PCB) does not seat there. Each sharp
 * corner and each corner fillet below the tool radius needs a relief cut. With `dogbones` on, the
 * finding gives the classic dogbone: a hole of the tool's diameter centred on the corner's
 * bisector one tool radius from the corner, so its edge passes through the corner. Corners already
 * relieved (a concave cylinder of at least the tool's radius covering half a turn or more) are
 * counted, not listed.
 */
function dogboneCheck(m:ExactModel,s:ManufacturingSettings):ManufacturingCheck{
 const label=t('Dogbones'),toolR=s.toolDiameterMm/2,{sharp,fillets}=internalCorners(m,s),findings:ManufacturingFinding[]=[];
 // A dogbone cut is a concave cylinder of at least the tool's radius through the corner: its two
 // lobes cover half a turn or more, where a corner fillet covers the corner's supplement (90° for a
 // right angle).
 const relieved=fillets.filter(g=>g.span>.8*Math.PI&&g.radius>=toolR-RADIUS_TOLERANCE).length;
 const suggestion=(corner:Vec3,air:Vec3,axis:Vec3,lo:number,hi:number,lines:number[][])=>{
  const centre=add(corner,scale(air,toolR)),mid=atHeight(centre,axis,(lo+hi)/2);
  return {centre:mid,mark:{lines:[...lines,circleLine(atHeight(centre,axis,lo),axis,toolR),circleLine(atHeight(centre,axis,hi),axis,toolR),[...atHeight(centre,axis,lo),...atHeight(centre,axis,hi)]],triangles:[],points:[...mid]}};
 };
 for(const c of sharp){
  const sum=add(c.normals[0],c.normals[1]),air=unit(sub(sum,scale(c.axis,dot(sum,c.axis))));
  const lines=c.edges.map(e=>edgeLine(m,e)),faces=[...new Set(c.edges.flatMap(e=>m.body.edges[e].faces))],where=atHeight(c.point,c.axis,(c.lo+c.hi)/2);
  if(s.dogbones){
   const {centre,mark}=suggestion(c.point,air,c.axis,c.lo,c.hi,lines);
   findings.push({text:t`Sharp internal corner, ${mm(c.length)} mm long: dogbone Ø${mm(s.toolDiameterMm)} centred at ${pointText(centre)}`,value:0,location:location(centre),edges:c.edges,faces,mark});
  }else findings.push({text:t`Sharp internal corner, ${mm(c.length)} mm long: the tool leaves R${mm(toolR)}, so a square-cornered part does not seat`,value:0,location:location(where),edges:c.edges,faces,mark:{lines,triangles:[],points:[]}});
 }
 for(const g of fillets){
  if(g.radius>=toolR-RADIUS_TOLERANCE)continue;
  // The corner the fillet rounds: on the fillet's bisector, r / cos(span / 2) from its axis.
  const c=faceCentre(m,g.faces),h=dot(sub(c,g.origin),g.direction),axisPoint=add(g.origin,scale(g.direction,h));
  const toCorner=unit(sub(c,axisPoint)),corner=add(axisPoint,scale(toCorner,g.radius/Math.max(.1,Math.cos(g.span/2))));
  const lo=dot(g.origin,g.direction)+g.hMin,hi=dot(g.origin,g.direction)+g.hMax,axis=g.direction;
  if(s.dogbones){
   const {centre,mark}=suggestion(corner,scale(toCorner,-1),axis,lo,hi,[]);
   const face=faceMark(m,g.faces);
   findings.push({text:t`Corner fillet R${mm(g.radius)}, ${mm(hi-lo)} mm deep: dogbone Ø${mm(s.toolDiameterMm)} centred at ${pointText(centre)}`,value:g.radius,location:location(centre),faces:g.faces,mark:{lines:[...face.lines,...mark.lines],triangles:face.triangles,points:mark.points}});
  }else findings.push({text:t`Corner fillet R${mm(g.radius)} below the R${mm(toolR)} the tool leaves: a square-cornered part does not seat`,value:g.radius,location:location(c),faces:g.faces,mark:faceMark(m,g.faces)});
 }
 const done=relieved?' '+t`${relieved} corners are already relieved.`:'';
 if(!findings.length)return check('cnc.dogbones',label,'exact','pass',(sharp.length+fillets.length?t`No internal corner along the tool axes is tighter than the R${mm(toolR)} tool.`:t('No internal corners along the tool axes.'))+done,[],{limit:toolR,unit:'mm'});
 const how=s.dogbones?t`Suggested dogbones are holes of the tool's Ø${mm(s.toolDiameterMm)} whose edge passes through the corner.`:t('Turn on Suggest dogbones to list where to put them.');
 return check('cnc.dogbones',label,'exact','warn',t`${findings.length} internal corners need a dogbone where a square-cornered part must fit (the Ø${mm(s.toolDiameterMm)} end mill leaves R${mm(toolR)}).`+' '+how+done,findings,{value:Math.min(...findings.map(f=>f.value??0)),limit:toolR,unit:'mm'});
}
const pointText=(p:readonly number[])=>`[${p.map(v=>mm(v)).join(', ')}]`;

/**
 * The boundary loops of a planar face: its edges joined end to end (closed edges are loops of
 * their own), and which one is the outer loop (the largest extent in the face's plane).
 */
function faceLoops(m:ExactModel,f:number):{loops:number[][];outer:number}{
 const own=m.faceEdges[f].filter(e=>m.edges[e].kind!=='seam'),key=(p:readonly number[])=>p.map(v=>Math.round(v*1e5)).join(',');
 const parent=new Map<string,string>(),findRoot=(k:string):string=>{let r=k;while(parent.get(r)!==r)r=parent.get(r)!;parent.set(k,r);return r;};
 const ends=own.map(e=>{
  const pts=m.body.edges[e].points,n=pts.length/3;
  const a=key([pts[0],pts[1],pts[2]]),b=m.body.edges[e].closed?a:key([pts[3*n-3],pts[3*n-2],pts[3*n-1]]);
  for(const k of [a,b])if(!parent.has(k))parent.set(k,k);
  parent.set(findRoot(a),findRoot(b));
  return a;
 });
 const byRoot=new Map<string,number[]>();
 own.forEach((e,i)=>{const r=findRoot(ends[i]);byRoot.set(r,[...(byRoot.get(r)??[]),e]);});
 const loops=[...byRoot.values()],n=m.body.faces[f].normal,u=unit(cross(Math.abs(n[0])<.9?[1,0,0]:[0,1,0],n)),v=cross(n,u);
 const extent=(loop:number[])=>{
  let a0=Infinity,a1=-Infinity,b0=Infinity,b1=-Infinity;
  for(const e of loop){const pts=m.body.edges[e].points;for(let i=0;i<pts.length;i+=3){const p=[pts[i],pts[i+1],pts[i+2]];a0=Math.min(a0,dot(p,u));a1=Math.max(a1,dot(p,u));b0=Math.min(b0,dot(p,v));b1=Math.max(b1,dot(p,v));}}
  return (a1-a0)*(b1-b0);
 };
 let outer=0;loops.forEach((loop,i)=>{if(extent(loop)>extent(loops[outer]))outer=i;});
 return {loops,outer};
}

/**
 * Pocket depth against the tool: a pocket's floor is a planar face facing a setup axis, open to the
 * tool along it, whose outer boundary rises into walls all round (concave edges, or tangent into a
 * floor fillet); an outer loop with a convex edge is an open side (a step). Holes, islands and
 * deeper pockets inside the floor do not matter. The walls are the faces joined to the floor
 * through concave or tangent edges, and the pocket's own depth is their height above the floor. A
 * pocket in the floor of another pocket is that much deeper for the tool, so the depth is counted
 * from the top of the outermost pocket. A depth above `maxPocketDepthRatio` tool diameters fails:
 * a standard end mill's reach.
 */
function pocketDepthCheck(m:ExactModel,s:ManufacturingSettings):ManufacturingCheck{
 const label=t('Pocket depth'),D=s.toolDiameterMm,limit=s.maxPocketDepthRatio*D,axes=axisVectors(s.approachAxes),{body,edges}=m;
 const height=(faces:Iterable<number>,a:Vec3)=>{let hi=-Infinity;for(const f of faces)for(const tri of m.faceTris[f])for(const p of corners(m.surface,tri))hi=Math.max(hi,dot(p,a));return hi;};
 const pockets=new Map<number,{floor:number;own:number;walls:number[];axis:Vec3;parent?:number}>();
 body.faces.forEach((face,f)=>{
  if(face.surface!=='plane'||!m.faceTris[f].length)return;
  const a=axes.find(axis=>dot(face.normal,axis)>PARALLEL);if(!a)return;
  const {loops,outer}=faceLoops(m,f);
  if(!loops.length||loops[outer].some(e=>edges[e].kind!=='concave'&&edges[e].kind!=='tangent'))return;
  const probeTri=[...m.faceTris[f]].sort((x,y)=>m.surface.area[y]-m.surface.area[x])[0];
  if(!reachable(m.surface,add(triCentroid(m.surface,probeTri),scale(a,1e-3)),a))return;
  // The walls: every face reached from the floor's outer loop through concave or tangent edges that
  // does not itself face the tool (another floor, the top).
  const walls=new Set<number>(),queue:number[]=[];
  const visit=(e:number,from:number)=>{
   for(const h of body.edges[e].faces){
    if(h===f||h===from||walls.has(h))continue;
    const hf=body.faces[h];if(hf.surface==='plane'&&dot(hf.normal,a)>PARALLEL)continue;
    walls.add(h);queue.push(h);
   }
  };
  for(const e of loops[outer])visit(e,f);
  while(queue.length&&walls.size<500){const g=queue.pop()!;for(const e of m.faceEdges[g])if(edges[e].kind==='concave'||edges[e].kind==='tangent')visit(e,g);}
  if(!walls.size)return;
  const own=height(walls,a)-dot(face.point,a);
  if(own>1e-6)pockets.set(f,{floor:f,own,walls:[...walls],axis:a});
 });
 // A pocket whose walls end (convex) in the floor of another pocket lies in that pocket.
 for(const p of pockets.values())for(const w of p.walls)for(const e of m.faceEdges[w]){
  if(edges[e].kind!=='convex')continue;
  const other=body.edges[e].faces.find(g=>g!==w&&g!==p.floor&&pockets.has(g)&&pockets.get(g)!.axis===p.axis);
  if(other!==undefined)p.parent=other;
 }
 const depthOf=(f:number,seen=new Set<number>()):number=>{const p=pockets.get(f)!;if(p.parent===undefined||seen.has(f))return p.own;seen.add(f);return p.own+depthOf(p.parent,seen);};
 const list=[...pockets.values()].map(p=>({...p,depth:depthOf(p.floor)}));
 const extra={limit,unit:'mm' as const};
 if(!list.length)return check('cnc.pocket-depth',label,'exact','pass',t('No pockets along the tool axes.'),[],extra);
 const deepest=Math.max(...list.map(p=>p.depth));
 const findings=list.filter(p=>p.depth>limit+RADIUS_TOLERANCE).sort((x,y)=>y.depth-x.depth).map((p):ManufacturingFinding=>({
  text:(p.parent!==undefined?t`Pocket ${mm(p.depth)} mm deep (${mm(p.own)} mm below the pocket around it)`:t`Pocket ${mm(p.depth)} mm deep`)+': '+t`${mm(p.depth/D)} × the Ø${mm(D)} end mill, beyond ${mm(s.maxPocketDepthRatio)} ×`,
  value:p.depth,location:location(faceCentre(m,[p.floor])),faces:[p.floor,...p.walls],mark:faceMark(m,[p.floor])}));
 if(findings.length)return check('cnc.pocket-depth',label,'exact','fail',t`${findings.length} of ${list.length} pockets deeper than ${mm(s.maxPocketDepthRatio)} × the Ø${mm(D)} end mill (${mm(limit)} mm), the deepest ${mm(deepest)} mm; use a larger or long-reach tool, or a shallower pocket.`,findings,{...extra,value:deepest});
 return check('cnc.pocket-depth',label,'exact','pass',t`${list.length} pockets, the deepest ${mm(deepest)} mm (limit ${mm(s.maxPocketDepthRatio)} × Ø${mm(D)} = ${mm(limit)} mm).`,[],{...extra,value:deepest});
}

/** Surface no setup reaches: facing away from every approach axis, or under material along it. */
function undercutCheck(s:Surface,settings:ManufacturingSettings,model?:ExactModel,mould=false):ManufacturingCheck{
 const label=t('Undercuts'),geometry:ManufacturingGeometry=model?'exact':'mesh';
 // A mould's two halves part along the pull axis: each face must release toward one of them.
 const names:readonly ApproachAxis[]=mould?[settings.pullAxis,(settings.pullAxis[0]==='+'?'-':'+')+settings.pullAxis[1] as ApproachAxis]:settings.approachAxes;
 const axes=axisVectors(names),from=names.join(', '),id=mould?'mold.undercuts':'cnc.undercuts';
 const low=axes.map(a=>{let v=Infinity;for(let i=0;i<s.positions.length;i+=3)v=Math.min(v,s.positions[i]*a[0]+s.positions[i+1]*a[1]+s.positions[i+2]*a[2]);return v;});
 const hidden:number[]=[];let area=0;
 for(let tri=0;tri<s.count;tri++){
  if(s.area[tri]<=1e-12)continue;
  const n=triNormal(s,tri),c=triCentroid(s,tri);
  const ok=axes.some((a,k)=>{
   const na=dot(n,a);
   // The face the part rests on in the vice: flat on its lowest plane, facing straight away.
   if(!mould&&na<-PARALLEL&&corners(s,tri).every(p=>dot(p,a)-low[k]<1e-3))return true;
   if(na<-1e-3)return false;
   return s.bvh.raycast(add(c,scale(n,1e-3)),a,{tMin:1e-6,skipTri:tri})===null;
  });
  if(!ok){hidden.push(tri);area+=s.area[tri];}
 }
 const findings:ManufacturingFinding[]=[];
 if(model){
  const byFace=new Map<number,number[]>();
  for(const tri of hidden){const f=model.body.mesh.faceOf[tri];byFace.set(f,[...(byFace.get(f)??[]),tri]);}
  for(const [f,tris] of byFace){
   const a=tris.reduce((sum,tri)=>sum+s.area[tri],0);
   findings.push({text:mould?t`${mm(a)} mm² of this face does not release toward ${from}`:t`${mm(a)} mm² of this face cannot be reached from ${from}`,value:a,location:location(faceCentre(model,[f])),faces:[f],mark:{lines:model.faceEdges[f].map(e=>edgeLine(model,e)),triangles:trianglesOf(s,tris),points:[]}});
  }
  findings.sort((a,b)=>(b.value??0)-(a.value??0));
 }else if(hidden.length){
  const largest=[...hidden].sort((a,b)=>s.area[b]-s.area[a])[0];
  findings.push({text:mould?t`${mm(area)} mm² of surface does not release toward ${from}`:t`${mm(area)} mm² of surface cannot be reached from ${from}`,value:area,location:location(triCentroid(s,largest)),mark:{lines:[],triangles:trianglesOf(s,hidden),points:[]}});
 }
 const extra={value:area,limit:settings.maxUndercutAreaMm2,unit:'mm2' as const};
 if(mould){
  if(area>settings.maxUndercutAreaMm2)return check(id,label,geometry,'fail',t`${mm(area)} mm² of surface is locked in the mould opening along ${from}; it needs a side action (slide or lifter), another parting direction or a redesign.`,findings,extra);
  return check(id,label,geometry,'pass',t`No undercuts: every surface releases toward ${from}.`,[],extra);
 }
 if(area>settings.maxUndercutAreaMm2)return check(id,label,geometry,'fail',t`${mm(area)} mm² of surface cannot be reached from ${from}; it needs another setup, a 4/5-axis machine or a redesign.`,findings,extra);
 return check(id,label,geometry,'pass',t`No undercuts: every surface is reachable from ${from}.`,[],extra);
}

/** Mesh-only CNC corners: concave creases along a setup axis (no radii on a mesh). */
function meshCornerCheck(s:Surface,settings:ManufacturingSettings):ManufacturingCheck{
 const label=t('Internal corner radius'),axes=axisVectors(settings.approachAxes);
 const edges=new Map<string,number[]>(),key=(i:number)=>[0,1,2].map(k=>Math.round(s.positions[3*i+k]*1e4)).join(',');
 for(let tri=0;tri<s.count;tri++)for(let k=0;k<3;k++){
  const a=key(s.indices[3*tri+k]),b=key(s.indices[3*tri+(k+1)%3]),id=a<b?a+'|'+b:b+'|'+a;
  edges.set(id,[...(edges.get(id)??[]),tri,s.indices[3*tri+k],s.indices[3*tri+(k+1)%3]]);
 }
 const findings:ManufacturingFinding[]=[];
 for(const uses of edges.values()){
  if(uses.length!==6)continue;
  const [t1,i,j,t2]=uses,n1=triNormal(s,t1),n2=triNormal(s,t2);
  if(dot(n1,n2)>Math.cos(60*DEG))continue;
  const p=vertex(s,i),q=vertex(s,j),d=unit(sub(q,p)),mid=scale(add(p,q),.5);
  if(dot(n2,sub(triCentroid(s,t1),mid))<=1e-6)continue;
  const air=unit(add(n1,n2)),probe=add(mid,scale(air,1e-3));
  const axis=axes.find(a=>Math.abs(dot(d,a))>PARALLEL&&Math.abs(dot(n1,a))<WALL&&Math.abs(dot(n2,a))<WALL&&reachable(s,probe,a));
  if(!axis)continue;
  findings.push({text:t`Sharp internal corner, ${mm(length(sub(q,p)))} mm long`,value:0,location:location(mid),mark:{lines:[[...p,...q]],triangles:[],points:[]}});
 }
 const why=t('Fillet radii cannot be measured on a mesh; only creases sharper than 60° were looked for.');
 if(findings.length)return check('cnc.internal-corners',label,'mesh','fail',t`${findings.length} sharp internal corners (mesh edges) along the tool axes.`+' '+why,findings,{value:0,limit:settings.toolDiameterMm/2,unit:'mm'});
 return check('cnc.internal-corners',label,'mesh','info',t('No sharp internal corners along the tool axes.')+' '+why);
}

// ---------------------------------------------------------------------------------------------
// Holes (FDM minimum hole, laser hole vs sheet thickness)

function holeCheck(id:string,m:ExactModel,minDiameter:number,status:'fail'|'warn',rule:string,along?:Vec3):ManufacturingCheck{
 const label=t('Hole size'),bores=m.cylinders.filter(g=>g.concave&&g.full&&(!along||Math.abs(dot(g.direction,along))>PARALLEL));
 if(!bores.length)return check(id,label,'exact','pass',t('No round holes.'),[],{limit:minDiameter,unit:'mm'});
 const small=bores.filter(g=>2*g.radius<minDiameter-RADIUS_TOLERANCE).sort((a,b)=>a.radius-b.radius);
 const smallest=Math.min(...bores.map(g=>2*g.radius));
 const findings=small.map((g):ManufacturingFinding=>({text:t`Hole Ø${mm(2*g.radius)} below Ø${mm(minDiameter)}`,value:2*g.radius,location:location(faceCentre(m,g.faces)),faces:g.faces,mark:faceMark(m,g.faces)}));
 if(findings.length)return check(id,label,'exact',status,t`${findings.length} of ${bores.length} round holes below Ø${mm(minDiameter)} (smallest Ø${mm(smallest)}); ${rule}`,findings,{value:smallest,limit:minDiameter,unit:'mm'});
 return check(id,label,'exact','pass',t`${bores.length} round holes, the smallest Ø${mm(smallest)} (limit Ø${mm(minDiameter)}).`,[],{value:smallest,limit:minDiameter,unit:'mm'});
}

// ---------------------------------------------------------------------------------------------
// Laser-cut sheet

interface Sheet {readonly axis:Vec3;readonly thickness:number}
/** A flat sheet: two parallel planes of the same outline, everything else perpendicular to them. */
function sheetOf(s:Surface,model?:ExactModel):{sheet?:Sheet;offending:number[]}{
 let best:{n:Vec3;area:number}|undefined;
 if(model)model.body.faces.forEach((face,f)=>{if(face.surface==='plane'&&(!best||model.faceArea[f]>best.area))best={n:[...face.normal] as Vec3,area:model.faceArea[f]};});
 else for(let tri=0;tri<s.count;tri++)if(!best||s.area[tri]>best.area)best={n:triNormal(s,tri),area:s.area[tri]};
 if(!best)return {offending:[]};
 const axis=best.n,levels:{h:number;ids:number[]}[]=[],offending:number[]=[];
 const classify=(n:Vec3,p:Vec3,id:number)=>{
  const c=dot(n,axis);
  if(Math.abs(c)>1-1e-6){
   const h=dot(p,axis),level=levels.find(l=>Math.abs(l.h-h)<1e-6);
   if(level)level.ids.push(id);else levels.push({h,ids:[id]});
   return;
  }
  if(Math.abs(c)>1e-6)offending.push(id);
 };
 if(model)model.body.faces.forEach((face,f)=>{
  if(face.surface==='plane')classify([...face.normal] as Vec3,[...face.point] as Vec3,f);
  else if(face.surface==='cylinder'&&face.axis){if(Math.abs(dot(unit(face.axis.direction),axis))<1-1e-6)offending.push(f);}
  else if(model.faceTris[f].some(tri=>Math.abs(dot(triNormal(s,tri),axis))>1e-3))offending.push(f);
 });
 else for(let tri=0;tri<s.count;tri++)if(s.area[tri]>1e-12)classify(triNormal(s,tri),triCentroid(s,tri),tri);
 levels.sort((a,b)=>a.h-b.h);
 // Faces parallel to the sheet between its two sides (steps, pocket floors) cannot be cut.
 for(const level of levels.slice(1,-1))offending.push(...level.ids);
 if(levels.length<2||offending.length)return {offending};
 return {sheet:{axis,thickness:levels[levels.length-1].h-levels[0].h},offending};
}

function laserChecks(s:Surface,settings:ManufacturingSettings,model?:ExactModel):ManufacturingCheck[]{
 const geometry:ManufacturingGeometry=model?'exact':'mesh',label=t('Flat sheet');
 const {sheet,offending}=sheetOf(s,model);
 if(!sheet){
  const findings:ManufacturingFinding[]=model?offending.slice(0,MAX_MANUFACTURING_FINDINGS*4).map(f=>({text:t`Face not perpendicular to the sheet (${model.body.faces[f].surface})`,location:location(faceCentre(model,[f])),faces:[f],mark:faceMark(model,[f])})):offending.length?[{text:t('Surface not perpendicular to the sheet'),location:location(triCentroid(s,offending[0])),mark:{lines:[],triangles:trianglesOf(s,offending),points:[]}}]:[];
  const why=t('Not a flat sheet of one thickness: a laser cuts straight through a sheet, so every face must be one of its two sides or perpendicular to them.');
  return [check('laser.sheet',label,geometry,'fail',why,findings),notChecked('laser.min-web',t('Minimum web'),geometry,t('Not a flat sheet.')),...(model?[notChecked('laser.min-hole',t('Hole size'),geometry,t('Not a flat sheet.'))]:[])];
 }
 const a=sheet.axis,named=Math.abs(a[0])>PARALLEL?'X':Math.abs(a[1])>PARALLEL?'Y':Math.abs(a[2])>PARALLEL?'Z':a.map(v=>mm(v)).join(', ');
 const out=[check('laser.sheet',label,geometry,'pass',t`A flat sheet ${mm(sheet.thickness)} mm thick, normal along ${named}.`,[],{value:sheet.thickness,unit:'mm'})];
 const web=settings.minWallMm??sheet.thickness;
 // Webs: in-plane wall thickness, measured from the cut faces only.
 out.push(wallCheck('laser.min-web',t('Minimum web'),s,web,model,{filter:tri=>Math.abs(dot(triNormal(s,tri),a))<.5,status:'warn',what:t('Webs between cuts')}));
 if(model)out.push(holeCheck('laser.min-hole',model,Math.max(sheet.thickness,settings.minWallMm??0),'warn',t('holes smaller than the sheet thickness cut poorly.'),a));
 return out;
}

// ---------------------------------------------------------------------------------------------
// Injection moulding

/**
 * Draft: the angle between a face and the pull direction, asin |n · pull|. Faces along the pull
 * with less than `minDraftDeg` drag on the mould as the part is ejected. On the exact B-rep each
 * triangle takes its face's exact normal at its centroid, and the findings are per B-rep face (its
 * area below the minimum and its smallest draft); on a mesh, one finding for all of it.
 */
function draftCheck(s:Surface,settings:ManufacturingSettings,model?:ExactModel):ManufacturingCheck{
 const label=t('Draft angle'),geometry:ManufacturingGeometry=model?'exact':'mesh',a=AXES[settings.pullAxis],min=settings.minDraftDeg;
 const extra={limit:min,unit:'deg' as const};
 if(min<=0)return check('mold.draft',label,geometry,'info',t('No minimum draft set.'),[],extra);
 const low=new Map<number,{tris:number[];area:number;least:number}>();let area=0,least=90,smallest=90;
 for(let tri=0;tri<s.count;tri++){
  if(s.area[tri]<=1e-12)continue;
  const f=model?model.body.mesh.faceOf[tri]:-1,c=triCentroid(s,tri);
  const n=(model?exactNormal(model.body,f,projectOnFace(model.body,f,c)):undefined)??triNormal(s,tri);
  const draft=Math.asin(Math.min(1,Math.abs(dot(n,a))))/DEG;
  smallest=Math.min(smallest,draft);
  if(draft>=min-1e-9)continue;
  const entry=low.get(f)??{tris:[],area:0,least:90};
  entry.tris.push(tri);entry.area+=s.area[tri];entry.least=Math.min(entry.least,draft);low.set(f,entry);
  area+=s.area[tri];least=Math.min(least,draft);
 }
 const findings:ManufacturingFinding[]=[];
 for(const [f,entry] of low){
  if(model){
   if(entry.area<1e-6)continue;
   findings.push({text:t`${mm(entry.area)} mm² of this face (${model.body.faces[f].surface}) has ${mm(entry.least)}° draft, below ${mm(min)}°`,value:entry.least,location:location(faceCentre(model,[f])),faces:[f],mark:{lines:model.faceEdges[f].map(e=>edgeLine(model,e)),triangles:trianglesOf(s,entry.tris),points:[]}});
  }else findings.push({text:t`${mm(entry.area)} mm² of surface with ${mm(entry.least)}° draft, below ${mm(min)}°`,value:entry.least,location:location(triCentroid(s,entry.tris[0])),mark:{lines:[],triangles:trianglesOf(s,entry.tris),points:[]}});
 }
 findings.sort((x,y)=>(x.value??0)-(y.value??0));
 if(!findings.length)return check('mold.draft',label,geometry,'pass',t`Every face has at least ${mm(min)}° draft along ${settings.pullAxis}; the least ${mm(smallest)}°.`,[],{...extra,value:smallest});
 return check('mold.draft',label,geometry,'fail',t`${mm(area)} mm² of surface has less than ${mm(min)}° draft along ${settings.pullAxis} (as little as ${mm(least)}°), in ${findings.length} places; add draft so the part ejects.`,findings,{...extra,value:least});
}

/** Weighted median of the samples' thickness. */
function nominalThickness(samples:readonly WallSample[]):number{
 const sorted=[...samples].sort((a,b)=>a.thickness-b.thickness),total=sorted.reduce((sum,x)=>sum+x.weight,0);
 let acc=0;for(const x of sorted){acc+=x.weight;if(acc>=total/2)return x.thickness;}
 return sorted.length?sorted[sorted.length-1].thickness:NaN;
}

/**
 * Wall uniformity: a moulded part cools evenly, and does not sink or warp, when its walls are close
 * to one nominal thickness. The wall is sampled as for the minimum wall, but each sample is the
 * diameter of the ball that fits at the middle of its hop (so a rim's ray running down its own wall
 * reads the wall, not the wall's height). The nominal is the area-weighted median; a face (exact)
 * or a spot (mesh) whose median wall is thicker than `maxWallMm` or outside `wallVariation` of the
 * nominal is listed.
 */
function wallUniformityCheck(s:Surface,settings:ManufacturingSettings,model?:ExactModel):ManufacturingCheck{
 const label=t('Wall uniformity'),geometry:ManufacturingGeometry=model?'exact':'mesh',v=settings.wallVariation,maxWall=settings.maxWallMm??4;
 const collected:WallSample[]=[];
 sampleWalls(s,Infinity,{model,collect:collected,budget:WALL_SAMPLE_BUDGET/2});
 const samples=collected.filter(x=>Number.isFinite(x.thickness)&&x.thickness>0);
 if(!samples.length)return check('mold.wall-uniformity',label,geometry,'info',t('No opposite wall found within the part.'),[],{unit:'mm'});
 const nominal=nominalThickness(samples),lowest=Math.min(...samples.map(x=>x.thickness)),highest=Math.max(...samples.map(x=>x.thickness));
 // Per B-rep face on the exact body; on a mesh, spots of nearby samples.
 const groups:{key:number;samples:WallSample[];centre:Vec3}[]=[];
 const radius=Math.max(2*nominal,s.diagonal/50);
 for(const x of samples){
  const key=model?model.body.mesh.faceOf[x.tri]:-1;
  const group=model?groups.find(g=>g.key===key):groups.find(g=>length(sub(g.centre,x.from))<radius);
  if(group)group.samples.push(x);else groups.push({key,samples:[x],centre:x.from});
 }
 const findings:ManufacturingFinding[]=[];
 for(const g of groups){
  const median=nominalThickness(g.samples),deviation=median/nominal-1;
  const thick=median>maxWall+1e-9,uneven=Math.abs(deviation)>v+1e-9;
  if(!thick&&!uneven)continue;
  const worst=[...g.samples].sort((a,b)=>Math.abs(b.thickness-nominal)-Math.abs(a.thickness-nominal))[0];
  const why=thick?t`thicker than the ${mm(maxWall)} mm maximum`:deviation>0?t`${mm(100*deviation)} % thicker than nominal`:t`${mm(-100*deviation)} % thinner than nominal`;
  const text=t`Wall ${mm(median)} mm against ${mm(nominal)} mm nominal: ${why}`;
  const measure={lines:[[...worst.from,...worst.to]],points:[...worst.from]};
  findings.push({text,value:median,location:location(model?faceCentre(model,[g.key]):g.centre),...(model?{faces:[g.key]}:{}),
   mark:model?faceMark(model,[g.key],measure):{...measure,triangles:trianglesOf(s,[...new Set(g.samples.map(x=>x.tri))])}});
 }
 findings.sort((a,b)=>Math.abs((b.value??nominal)-nominal)-Math.abs((a.value??nominal)-nominal));
 const extra={value:nominal,unit:'mm' as const};
 const range=t`nominal ${mm(nominal)} mm (median of ${samples.length} samples), from ${mm(lowest)} to ${mm(highest)} mm`;
 if(findings.length)return check('mold.wall-uniformity',label,geometry,'warn',t`Walls are uneven: ${range}; ${findings.length} regions differ by more than ${mm(100*v)} % or exceed ${mm(maxWall)} mm, which risks sink marks, voids and warping.`,findings,extra);
 return check('mold.wall-uniformity',label,geometry,'pass',t`Walls are even: ${range}, within ${mm(100*v)} % and at most ${mm(maxWall)} mm.`,[],extra);
}

// ---------------------------------------------------------------------------------------------
// FDM rows from the mesh printability screen

function fdmMeshChecks(p:BodyPrintability,settings:ManufacturingSettings):ManufacturingCheck[]{
 const rows:ManufacturingCheck[]=[];
 rows.push(p.topology.watertight?check('fdm.watertight',t('Watertight mesh'),'mesh','pass',t('Closed, manifold mesh.'))
  :check('fdm.watertight',t('Watertight mesh'),'mesh','fail',t`${p.topology.openEdges} open, ${p.topology.nonManifoldEdges} non-manifold edges`));
 const current=p.current,best=p.orientations?.[0];
 if(current&&best){
  const overhangs=current.overhangs.map((o):ManufacturingFinding=>({text:t`${mm(o.areaMm2)} mm² overhang up to ${mm(o.maxOverhangDeg)}°${o.spanMm!==undefined?t` (bridge ${mm(o.spanMm)} mm)`:''}`,value:o.areaMm2,location:location(scale(add(o.bboxMin,o.bboxMax),.5)),mark:{lines:[boxLines(o.bboxMin,o.bboxMax)],triangles:[],points:[]}}));
  rows.push(check('fdm.overhangs',t('Overhangs as modelled'),'mesh',current.unsupportedAreaMm2>0?'warn':'pass',current.unsupportedAreaMm2>0?t`${mm(current.unsupportedAreaMm2)} mm² unsupported steeper than ${mm(settings.maxOverhangDeg)}° in ${current.overhangRegions} regions.`:t`No unsupported overhang steeper than ${mm(settings.maxOverhangDeg)}°.`,overhangs,{value:current.unsupportedAreaMm2,unit:'mm2'}));
  const rotation=Math.abs(best.rotation.deg)<1e-9?t('as modelled'):t`rotate ${mm(best.rotation.deg)}° about ${best.rotation.axis[0]?'X':best.rotation.axis[1]?'Y':'Z'}`;
  rows.push(check('fdm.orientation',t('Print orientation'),'mesh',best.fitsBed?(best.unsupportedAreaMm2>0?'warn':'pass'):'fail',
   best.fitsBed?t`Best: ${best.label??''} up (${rotation}), ${mm(best.unsupportedAreaMm2)} mm² unsupported.`:t`Does not fit the ${settings.bedSizeMm.x} × ${settings.bedSizeMm.y} × ${settings.bedSizeMm.z} mm bed in any axis orientation.`));
  if(best.bedContactLow||best.tipRisk)rows.push(check('fdm.bed-contact',t('Bed adhesion'),'mesh','warn',best.tipRisk?t('Tall part on a small base may tip'):t('Small bed contact area')));
 }
 return rows;
}
const boxLines=(a:readonly number[],b:readonly number[])=>{
 const p=(x:number,y:number,z:number)=>[x?b[0]:a[0],y?b[1]:a[1],z?b[2]:a[2]];
 return [p(0,0,0),p(1,0,0),p(1,1,0),p(0,1,0),p(0,0,0),p(0,0,1),p(1,0,1),p(1,1,1),p(0,1,1),p(0,0,1)].flat();
};

// ---------------------------------------------------------------------------------------------
// The report

export interface ManufacturingInput {
 /** The design's evaluated meshes (Manifold): every body, and the FDM orientation checks. */
 readonly meshes:readonly BodyMesh[];
 /** The exact kernel's data for the bodies it could build (the `drawing` exact request). */
 readonly exact?:ExactDrawingData;
 /** Why there is no exact data at all, when it was asked for (the kernel failed to load or run). */
 readonly exactUnavailable?:string;
 /** `id · package version` of the exact kernel. */
 readonly kernel?:string;
 /** Top-level bodies to check; empty: every solid body. */
 readonly bodies?:readonly string[];
}

/** Check the bodies for `settings.process`; read-only. */
export function checkManufacturing(input:ManufacturingInput,options:Partial<ManufacturingSettings>={}):ManufacturingReport{
 const settings=resolveManufacturingSettings(options);
 const solids=input.meshes.filter(b=>!b.reference&&!b.hole&&b.indices.length>0&&(!input.bodies?.length||input.bodies.includes(b.id)));
 const missing=input.bodies?.filter(id=>!input.meshes.some(b=>b.id===id))??[];
 if(missing.length)throw new RangeError(t`Unknown object id: ${missing[0]}`);
 const bodies=solids.map((mesh):ManufacturingBodyReport=>{
  const exactBody=settings.exact?input.exact?.bodies.find(b=>b.id===mesh.id):undefined;
  const failure=input.exact?.failures.find(f=>f.id===mesh.id);
  const reason=exactBody?undefined:!settings.exact?t('exact geometry not requested'):failure?t`no exact B-rep: ${failure.message}`:input.exactUnavailable?t`exact kernel unavailable: ${input.exactUnavailable}`:t('no exact B-rep for this body');
  const model=exactBody?buildExactModel(exactBody):undefined;
  const meshSurface=()=>surfaceOf(mesh.positions,mesh.indices);
  const surface=model?model.surface:meshSurface();
  const checks:ManufacturingCheck[]=[];
  if(settings.process==='fdm'){
   const printability=checkPrintability([mesh],{nozzleMm:settings.nozzleMm,minWallMm:settings.minWallMm??2*settings.nozzleMm,maxOverhangDeg:settings.maxOverhangDeg,maxBridgeMm:settings.maxBridgeMm,bedSizeMm:settings.bedSizeMm}).bodies[0];
   const limit=settings.minWallMm??2*settings.nozzleMm;
   if(model)checks.push(wallCheck('fdm.min-wall',t('Minimum wall thickness'),surface,limit,model));
   else{
    const w=printability.minWall,findings=w.violations.map((v):ManufacturingFinding=>({text:t`${mm(v.thicknessMm)} mm thick (limit ${mm(limit)} mm)`,value:v.thicknessMm,location:v.location,mark:{lines:[],triangles:[],points:[...v.location]}}));
    checks.push(w.thinnestMm===null?check('fdm.min-wall',t('Minimum wall thickness'),'mesh','info',t('No opposite wall found within the part.'))
     :check('fdm.min-wall',t('Minimum wall thickness'),'mesh',findings.length?'fail':'pass',findings.length?t`Walls as thin as ${mm(w.thinnestMm)} mm, below ${mm(limit)} mm (${w.sampleCount} samples).`:t`Walls are at least ${mm(limit)} mm; thinnest ${mm(w.thinnestMm)} mm (${w.sampleCount} samples).`,findings,{value:w.thinnestMm,limit,unit:'mm'}));
   }
   checks.push(model?holeCheck('fdm.min-hole',model,settings.minHoleMm,'fail',t('they print undersized or close up.')):notChecked('fdm.min-hole',t('Hole size'),'mesh',t('Hole diameters need the exact B-rep.')));
   checks.push(...fdmMeshChecks(printability,settings));
  }else if(settings.process==='cnc'){
   checks.push(model?cncCornerCheck(model,settings):meshCornerCheck(surface,settings));
   checks.push(model?pocketDepthCheck(model,settings):notChecked('cnc.pocket-depth',t('Pocket depth'),'mesh',t('Pocket floors and walls need the exact B-rep.')));
   checks.push(model?dogboneCheck(model,settings):notChecked('cnc.dogbones',t('Dogbones'),'mesh',t('Corner radii need the exact B-rep; the mesh check lists sharp internal corners.')));
   checks.push(undercutCheck(surface,settings,model));
   checks.push(wallCheck('cnc.min-wall',t('Minimum wall thickness'),surface,settings.minWallMm??.8,model));
  }else if(settings.process==='molding'){
   checks.push(draftCheck(surface,settings,model));
   checks.push(undercutCheck(surface,settings,model,true));
   checks.push(wallCheck('mold.min-wall',t('Minimum wall thickness'),surface,settings.minWallMm??.8,model));
   checks.push(wallUniformityCheck(surface,settings,model));
  }else checks.push(...laserChecks(surface,settings,model));
  checks.push(model?edgeRadiusCheck(model,settings):notChecked('edges.radius',t('Edge radius'),'mesh',t('Fillet radii and sharp edges need the exact B-rep.')));
  return {id:mesh.id,name:mesh.name,geometry:model?'exact':'mesh',...(reason?{reason}:{}),checks};
 });
 return {version:MANUFACTURING_CHECK_VERSION,process:settings.process,settings,bodies,...(input.kernel&&bodies.some(b=>b.geometry==='exact')?{kernel:input.kernel}:{}),
  disclaimer:t('Design screening against rules of thumb, not a quote or a guarantee that the part can be made. Wall thickness is sampled; exact checks use the B-rep, mesh checks the tessellation.')};
}

// Shared with the surface-blend inspection (blends.ts), which reads the same exact model.
export {buildExactModel,edgeBreaks,faceMark,faceCentre,edgeMark};
