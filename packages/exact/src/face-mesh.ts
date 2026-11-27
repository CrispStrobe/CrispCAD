// SPDX-License-Identifier: BSD-3-Clause
// Display tessellation face by face, with planar faces triangulated here.
//
// SMLib meshes a planar face with many holes in time that grows faster than linearly with the
// hole count (measured 2026-11-26: one face of a plate with 101 holes 2.2 s CPU, with 201 holes
// 6.9 s), and that face dominates the whole-body mesh. Every other face costs a roughly constant
// amount each. So, for a body with such a face: SMLib meshes each non-planar face on its own
// (per-face meshes share the edge points of whole-body meshing, so they stay watertight), and the
// planar faces are triangulated here from exactly those boundary points: ear clipping with holes
// bridged in (Eberly's method), and a grid index so each ear test looks only at nearby vertices.
// Anything unexpected (an unknown kernel object, a loop that does not close, a polygon the ear
// clipper cannot finish) falls back to SMLib's own mesh, for the face or for the whole body.
import type {ExactKernel,ExactSolid} from '@crispcad/exact-kernel';

/** Planar faces with at least this many boundary loops (outer + holes) take the face-wise path. */
export const MANY_LOOPS=8;

// ---------------------------------------------------------------------------------------------
// Polygon with holes → triangles.

interface Node {i:number;x:number;y:number;prev:Node;next:Node;removed:boolean}
const orient=(a:{x:number;y:number},b:{x:number;y:number},c:{x:number;y:number})=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const same=(a:Node,b:Node)=>a.x===b.x&&a.y===b.y;

function ringArea(xy:ArrayLike<number>,ring:readonly number[]){
 let area=0;
 for(let j=0,k=ring.length-1;j<ring.length;k=j++)area+=xy[2*ring[k]]*xy[2*ring[j]+1]-xy[2*ring[j]]*xy[2*ring[k]+1];
 return area/2;
}
function link(xy:ArrayLike<number>,ring:readonly number[],all:Node[]):Node{
 let first:Node|undefined,last:Node|undefined;
 for(const i of ring){
  const node={i,x:xy[2*i],y:xy[2*i+1],removed:false} as Node;
  if(!first)first=node;else{last!.next=node;node.prev=last!;}
  last=node;all.push(node);
 }
 last!.next=first!;first!.prev=last!;
 return first!;
}
/** Whether the segment a→b starts into the polygon's interior at a (the polygon is CCW). */
function locallyInside(a:Node,b:{x:number;y:number}){
 const p=a.prev,n=a.next;
 return orient(p,a,n)>=0?orient(a,n,b)>0&&orient(a,b,p)>0:!(orient(a,p,b)>0&&orient(a,b,n)>0);
}
function insideTriangle(a:{x:number;y:number},b:{x:number;y:number},c:{x:number;y:number},p:{x:number;y:number},strict:boolean){
 const u=orient(a,b,p),v=orient(b,c,p),w=orient(c,a,p);
 return strict?u>0&&v>0&&w>0:u>=0&&v>=0&&w>=0;
}
/** Join a hole into the outer ring at `outer` (Eberly: the hole's rightmost vertex `m` sees it). */
function split(outer:Node,m:Node,all:Node[]){
 const a2={...outer} as Node,b2={...m} as Node,an=outer.next,bp=m.prev;
 outer.next=m;m.prev=outer;
 a2.next=an;an.prev=a2;
 b2.next=a2;a2.prev=b2;
 bp.next=b2;b2.prev=bp;
 all.push(a2,b2);
}
/** A vertex of the outer ring that the hole vertex `m` sees, found by a ray towards +x. */
function bridgeOf(m:Node,outer:Node):Node|undefined{
 let hit:Node|undefined,hx=Infinity,p=outer;
 do{
  const q=p.next;
  if(p.y<=m.y&&m.y<q.y||q.y<=m.y&&m.y<p.y){
   // The ray crosses this edge (half-open in y, so a vertex on the ray counts once).
   const x=p.y===m.y?p.x:q.y===m.y?q.x:p.x+(m.y-p.y)*(q.x-p.x)/(q.y-p.y);
   if(x===m.x)return undefined;
   if(x>m.x&&x<hx){hx=x;hit=p.y===m.y?p:q.y===m.y?q:p.x>q.x?p:q;}
  }
  p=q;
 }while(p!==outer);
 if(!hit)return undefined;
 // Reflex vertices inside the triangle (m, ray hit, candidate) block the candidate; take the one
 // seen at the smallest angle from the ray instead (nearest on ties).
 const ix={x:hx,y:m.y};let best=hit,bestCos=-Infinity,bestDist=Infinity;
 if(hit.x!==hx||hit.y!==m.y){
  bestCos=(hit.x-m.x)/Math.hypot(hit.x-m.x,hit.y-m.y);bestDist=Math.hypot(hit.x-m.x,hit.y-m.y);
  const [a,b,c]=orient(m,ix,hit)>0?[m,ix,hit]:[m,hit,ix];
  p=outer;
  do{
   if(p!==hit&&!same(p,hit)&&insideTriangle(a,b,c,p,false)&&!(p.x===m.x&&p.y===m.y)){
    const d=Math.hypot(p.x-m.x,p.y-m.y),cos=(p.x-m.x)/d;
    if((cos>bestCos||cos===bestCos&&d<bestDist)&&locallyInside(p,m)){best=p;bestCos=cos;bestDist=d;}
   }
   p=p.next;
  }while(p!==outer);
 }
 // Earlier bridges duplicate vertices: take the copy whose corner the bridge enters.
 if(!locallyInside(best,m)){
  p=outer;
  do{if(same(p,best)&&locallyInside(p,m))return p;p=p.next;}while(p!==outer);
  return undefined;
 }
 return best;
}

/**
 * Triangulate the polygon `rings[0]` minus the holes `rings[1..]`. Rings list indices of points
 * whose 2D coordinates are `xy[2i], xy[2i+1]`; their orientation does not matter. Every point is
 * kept (boundary points shared with neighbouring faces must stay). Returns counter-clockwise
 * triangles, or null when the polygon is not one this simple clipper can finish (the caller then
 * meshes the face some other way). The covered area is checked against the polygon's.
 */
export function triangulatePolygon(xy:ArrayLike<number>,rings:readonly (readonly number[])[]):number[]|null{
 if(!rings.length||rings.some(ring=>ring.length<3))return null;
 const all:Node[]=[],areas=rings.map(ring=>ringArea(xy,ring));
 if(!(Math.abs(areas[0])>0))return null;
 const oriented=rings.map((ring,r)=>(r===0)===(areas[r]>0)?ring:[...ring].reverse());
 const outer=link(xy,oriented[0],all);
 // Each hole joins at its rightmost vertex, rightmost holes first: a hole not joined yet then lies
 // wholly left of the current one's bridge, which therefore crosses no edge it does not test.
 const holes=oriented.slice(1).map(ring=>{const first=link(xy,ring,all);let m=first,p=first.next;while(p!==first){if(p.x>m.x||p.x===m.x&&p.y>m.y)m=p;p=p.next;}return m;});
 holes.sort((a,b)=>b.x-a.x||b.y-a.y);
 for(const m of holes){const bridge=bridgeOf(m,outer);if(!bridge)return null;split(bridge,m,all);}

 // Grid index over every node, so an ear test only visits nodes near the ear.
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const n of all){if(n.x<minX)minX=n.x;if(n.y<minY)minY=n.y;if(n.x>maxX)maxX=n.x;if(n.y>maxY)maxY=n.y;}
 const side=Math.max(1,Math.min(1024,Math.ceil(Math.sqrt(all.length/2)))),cw=(maxX-minX)/side||1,ch=(maxY-minY)/side||1;
 const cell=(v:number,lo:number,size:number)=>Math.min(side-1,Math.max(0,Math.floor((v-lo)/size)));
 const grid:Node[][]=Array.from({length:side*side},()=>[]);
 for(const n of all)grid[cell(n.y,minY,ch)*side+cell(n.x,minX,cw)].push(n);
 const isEar=(b:Node,degenerate:boolean)=>{
  const a=b.prev,c=b.next,area=orient(a,b,c);
  if(degenerate?area<0:area<=0)return false;
  const x0=cell(Math.min(a.x,b.x,c.x),minX,cw),x1=cell(Math.max(a.x,b.x,c.x),minX,cw),y0=cell(Math.min(a.y,b.y,c.y),minY,ch),y1=cell(Math.max(a.y,b.y,c.y),minY,ch);
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const p of grid[y*side+x]){
   if(p.removed||p===a||p===b||p===c||same(p,a)||same(p,b)||same(p,c))continue;
   if(insideTriangle(a,b,c,p,false))return false;
  }
  return true;
 };

 const triangles:number[]=[];
 let ear=outer,stop=ear,degenerate=false,left=0;
 {let p=outer;do{left++;p=p.next;}while(p!==outer);}
 while(left>3){
  if(isEar(ear,degenerate)){
   triangles.push(ear.prev.i,ear.i,ear.next.i);
   ear.removed=true;ear.prev.next=ear.next;ear.next.prev=ear.prev;left--;
   ear=ear.next;stop=ear;degenerate=false;
   continue;
  }
  ear=ear.next;
  if(ear===stop){if(degenerate)return null;degenerate=true;}
 }
 if(orient(ear.prev,ear,ear.next)<0)return null;
 triangles.push(ear.prev.i,ear.i,ear.next.i);

 const expected=areas.reduce((sum,area,r)=>sum+(r===0?Math.abs(area):-Math.abs(area)),0);
 let covered=0;
 for(let t=0;t<triangles.length;t+=3){
  const a=triangles[t],b=triangles[t+1],c=triangles[t+2];
  covered+=((xy[2*b]-xy[2*a])*(xy[2*c+1]-xy[2*a+1])-(xy[2*b+1]-xy[2*a+1])*(xy[2*c]-xy[2*a]))/2;
 }
 if(!(Math.abs(covered-expected)<=1e-9*Math.abs(areas[0])+1e-12))return null;
 return triangles;
}

// ---------------------------------------------------------------------------------------------
// Face-wise display tessellation.

/** The parts of smlibwasm's object model this uses (reached through the solid's `part`). */
interface SmVector {x:number;y:number;z:number}
interface SmMesh {vertices:Float64Array;triangles:Uint32Array}
interface SmEdge {readonly geomType:string;_isStraight?():boolean;readonly start:SmVector;readonly end:SmVector;readonly isClosed:boolean;readonly radius:number;readonly arcCenter:SmVector;readonly normal:SmVector;faces():Iterable<SmFace>;_identity():string}
interface SmFace {readonly geomType:string;readonly radius:number;normalAt(point?:readonly number[]):SmVector;wires():ArrayLike<unknown>;edges():Iterable<SmEdge>;mesh(tolerance:number,angle:number):SmMesh;_identity():string}
interface SmPart {faces():Iterable<SmFace>}
const partOf=(solid:ExactSolid):SmPart|undefined=>{
 const part=(solid as unknown as {part?:SmPart}).part;
 return part&&typeof part.faces==='function'?part:undefined;
};

/** Vertices welded at 1 nm (the precision display meshes are stored at). */
class Pool {
 readonly positions:number[]=[];
 private readonly cells=new Map<string,number>();
 private static readonly Q=1e-6;
 add(x:number,y:number,z:number){
  const q=Pool.Q,ix=Math.round(x/q),iy=Math.round(y/q),iz=Math.round(z/q);
  let index=this.cells.get(`${ix},${iy},${iz}`);
  if(index!==undefined)return index;
  // A point within the weld distance can round to the next cell: look there too.
  const fx=x/q-ix,fy=y/q-iy,fz=z/q-iz,dx=Math.abs(fx)>.4?Math.sign(fx):0,dy=Math.abs(fy)>.4?Math.sign(fy):0,dz=Math.abs(fz)>.4?Math.sign(fz):0;
  if(dx||dy||dz)for(const ox of dx?[0,dx]:[0])for(const oy of dy?[0,dy]:[0])for(const oz of dz?[0,dz]:[0]){
   index=this.cells.get(`${ix+ox},${iy+oy},${iz+oz}`);
   if(index!==undefined){this.cells.set(`${ix},${iy},${iz}`,index);return index;}
  }
  index=this.positions.length/3;this.positions.push(x,y,z);this.cells.set(`${ix},${iy},${iz}`,index);
  return index;
 }
}

export interface FacewiseMesh {positions:number[];indices:number[];
 /** Planar faces triangulated here, those handed back to SMLib, and hole walls meshed as bands. */
 planar:number;planarFallbacks:number;bands:number;
 /** With `faces`: the face of each triangle (its position in the part's face list, the order of
  * the kernel's `topology(solid).faces`). */
 faceOf?:number[]}

/** Whether `solid` has a planar face with at least MANY_LOOPS boundary loops (holes + outline). */
export function hasManyHoleFace(solid:ExactSolid):boolean{
 const part=partOf(solid);if(!part)return false;
 for(const face of part.faces())if(face.geomType==='plane'&&face.wires().length>=MANY_LOOPS)return true;
 return false;
}

/**
 * Tessellate `solid` face by face: SMLib per non-planar face, planar faces triangulated here from
 * the same boundary points. Returns undefined when the solid is not an smlibwasm part (call inside
 * `k.scope`). The result is not checked for closedness here; `displayMesh` does that. With
 * `bands: false` every non-planar face is SMLib's (a planar face SMLib has to mesh does not share
 * the bands' circle points).
 */
export function facewiseMesh(_k:ExactKernel,solid:ExactSolid,options:{tolerance:number;angleDeg:number;bands?:boolean;faces?:boolean}):FacewiseMesh|undefined{
 const part=partOf(solid);if(!part)return undefined;
 const faces=[...part.faces()],pool=new Pool(),indices:number[]=[];
 const faceOf:number[]|undefined=options.faces?[]:undefined,order=faceOf?new Map(faces.map((face,i)=>[face._identity(),i])):undefined;
 let current=0;
 // Record the face of every triangle added since the last call.
 const tag=(face:SmFace)=>{if(faceOf&&order){current=order.get(face._identity())!;while(faceOf.length<indices.length/3)faceOf.push(current);}};
 const boundary=new Map<string,[number,number][]>();
 const addMesh=(mesh:SmMesh)=>{
  const map=new Uint32Array(mesh.vertices.length/3);
  for(let i=0;i<map.length;i++)map[i]=pool.add(mesh.vertices[3*i],mesh.vertices[3*i+1],mesh.vertices[3*i+2]);
  const directed=new Set<string>(),segments:[number,number][]=[];
  for(let t=0;t<mesh.triangles.length;t+=3){
   const a=map[mesh.triangles[t]],b=map[mesh.triangles[t+1]],c=map[mesh.triangles[t+2]];
   if(a===b||b===c||c===a)continue;
   indices.push(a,b,c);
   directed.add(`${a},${b}`);directed.add(`${b},${c}`);directed.add(`${c},${a}`);
  }
  for(const key of directed){const [a,b]=key.split(',').map(Number);if(!directed.has(`${b},${a}`))segments.push([a,b]);}
  return segments;
 };
 const planarFaces:SmFace[]=[];
 let bands=0;
 for(const face of faces){
  if(face.geomType==='plane'){planarFaces.push(face);continue;}
  const band=options.bands!==false?cylinderBand(face,options):undefined;
  if(band)bands++;
  boundary.set(face._identity(),addMesh(band??face.mesh(options.tolerance,options.angleDeg)));
  tag(face);
 }
 let planarFallbacks=0;
 for(const face of planarFaces){
  const rings=planarRings(face,pool,boundary);
  const normal=face.normalAt(),n=[normal.x,normal.y,normal.z];
  // A right-handed basis (u, v, n): counter-clockwise in (u, v) faces along the outward normal.
  const helper=Math.abs(n[0])<.9?[1,0,0]:[0,1,0];
  const u=normalise(cross(helper,n)),v=cross(n,u);
  let triangles:number[]|null=null;
  if(rings&&rings.length===face.wires().length){
   const used=[...new Set(rings.flat())],local=new Map(used.map((index,i)=>[index,i])),xy=new Float64Array(2*used.length);
   used.forEach((index,i)=>{const p=pool.positions;xy[2*i]=p[3*index]*u[0]+p[3*index+1]*u[1]+p[3*index+2]*u[2];xy[2*i+1]=p[3*index]*v[0]+p[3*index+1]*v[1]+p[3*index+2]*v[2];});
   const result=triangulatePolygon(xy,rings.map(ring=>ring.map(index=>local.get(index)!)));
   if(result)triangles=result.map(i=>used[i]);
  }
  if(triangles)indices.push(...triangles);
  else{planarFallbacks++;addMesh(face.mesh(options.tolerance,options.angleDeg));}
  tag(face);
 }
 return {positions:pool.positions,indices,planar:planarFaces.length-planarFallbacks,planarFallbacks,bands,...(faceOf?{faceOf}:{})};
}
/**
 * A hole's wall: a cylinder face bounded by two full circles (and its seam), each shared with a planar face. Both
 * neighbours are triangulated here from this band's circle points, so the band may choose them:
 * the same angles on both circles, as many as the chord tolerance and the angle need. SMLib spends
 * a roughly constant ~20 ms per face meshing such a band, which a plate with hundreds of holes
 * pays hundreds of times. Undefined for anything else (SMLib meshes it).
 */
function cylinderBand(face:SmFace,options:{tolerance:number;angleDeg:number}):SmMesh|undefined{
 if(face.geomType!=='cylinder')return undefined;
 // A periodic face's loop runs circle, seam, circle, seam; edges() leaves the seam out.
 const circles=[...face.edges()];
 if(circles.length!==2)return undefined;
 for(const circle of circles){
  if(circle.geomType!=='circle'||!circle.isClosed)return undefined;
  if(![...circle.faces()].every(f=>f.geomType==='plane'||f._identity()===face._identity()))return undefined;
 }
 const r=circles[0].radius,c0=circles[0].arcCenter,c1=circles[1].arcCenter;
 if(!(r>0)||Math.abs(circles[1].radius-r)>1e-9*Math.max(1,r)||Math.abs(face.radius-r)>1e-7*Math.max(1,r))return undefined;
 const axisVector=[c1.x-c0.x,c1.y-c0.y,c1.z-c0.z],height=Math.hypot(axisVector[0],axisVector[1],axisVector[2]);
 if(!(height>0))return undefined;
 const axis=axisVector.map(x=>x/height);
 for(const circle of circles){const n=circle.normal;if(Math.abs(n.x*axis[0]+n.y*axis[1]+n.z*axis[2])<1-1e-9)return undefined;}
 const sagitta=Math.acos(Math.max(-1,1-options.tolerance/r));
 const count=Math.max(8,Math.ceil(360/options.angleDeg),Math.ceil(Math.PI/Math.max(sagitta,1e-9)));
 if(count>4096)return undefined;
 const helper=Math.abs(axis[0])<.9?[1,0,0]:[0,1,0],u=normalise(cross(helper,axis)),v=cross(axis,u);
 const vertices=new Float64Array(6*count),triangles=new Uint32Array(6*count);
 for(let i=0;i<count;i++){
  const t=2*Math.PI*i/count,cos=Math.cos(t),sin=Math.sin(t);
  for(let j=0;j<3;j++){
   const radial=r*(cos*u[j]+sin*v[j]);
   vertices[3*i+j]=[c0.x,c0.y,c0.z][j]+radial;
   vertices[3*(count+i)+j]=[c1.x,c1.y,c1.z][j]+radial;
  }
 }
 // Orient the band by the face's outward normal (into the hole for a hole's wall).
 const p0=[vertices[0],vertices[1],vertices[2]],outward=face.normalAt(p0),radial=[p0[0]-c0.x,p0[1]-c0.y,p0[2]-c0.z];
 const outwards=outward.x*radial[0]+outward.y*radial[1]+outward.z*radial[2]>0;
 for(let i=0;i<count;i++){
  const a=i,b=(i+1)%count,A=count+a,B=count+b;
  // Counter-clockwise around the axis from c0 towards c1, the quad (a, b, B, A) faces outwards.
  if(outwards)triangles.set([a,b,B,a,B,A],6*i);else triangles.set([a,B,b,a,A,B],6*i);
 }
 return {vertices,triangles};
}
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalise=(a:number[])=>{const l=Math.hypot(a[0],a[1],a[2]);return a.map(x=>x/l);};

/** The boundary loops of a planar face as pooled point indices: the boundary segments its
 * non-planar neighbours' meshes have in its plane, plus its straight edges to planar neighbours.
 * Undefined when they do not chain into simple closed loops. */
function planarRings(face:SmFace,pool:Pool,boundary:Map<string,[number,number][]>):number[][]|undefined{
 const self=face._identity(),normal=face.normalAt(),segments=new Set<string>(),p=pool.positions;
 let offset:number|undefined;
 const neighbours=new Set<string>();
 for(const edge of face.edges()){
  const others=[...edge.faces()].filter(f=>f._identity()!==self);
  if(others.length!==1)return undefined;
  const other=others[0];
  if(other.geomType==='plane'){
   // Two planes meet in a straight line (a chamfer's edges are straight B-splines).
   if(!(edge._isStraight?edge._isStraight():edge.geomType==='line'))return undefined;
   const s=edge.start,e=edge.end,a=pool.add(s.x,s.y,s.z),b=pool.add(e.x,e.y,e.z);
   offset??=normal.x*s.x+normal.y*s.y+normal.z*s.z;
   if(a!==b)segments.add(a<b?`${a},${b}`:`${b},${a}`);
  }else{
   neighbours.add(other._identity());
   if(offset===undefined){const s=edge.start;offset=normal.x*s.x+normal.y*s.y+normal.z*s.z;}
  }
 }
 if(offset===undefined)return undefined;
 // Boundary points lie on the face's edges, within the kernel's edge tolerance (about 1e-5 mm).
 const eps=2e-5+1e-9*Math.abs(offset);
 const onPlane=(i:number)=>Math.abs(normal.x*p[3*i]+normal.y*p[3*i+1]+normal.z*p[3*i+2]-offset!)<=eps;
 for(const id of neighbours){
  const list=boundary.get(id);if(!list)return undefined;
  for(const [a,b] of list)if(onPlane(a)&&onPlane(b))segments.add(a<b?`${a},${b}`:`${b},${a}`);
 }
 const adjacent=new Map<number,number[]>();
 for(const key of segments){
  const [a,b]=key.split(',').map(Number);
  for(const [x,y] of [[a,b],[b,a]]){const list=adjacent.get(x);if(list)list.push(y);else adjacent.set(x,[y]);}
 }
 for(const list of adjacent.values())if(list.length!==2)return undefined;
 const rings:number[][]=[],seen=new Set<number>();
 for(const start of adjacent.keys()){
  if(seen.has(start))continue;
  const ring=[start];seen.add(start);
  let previous=start,current=adjacent.get(start)![0];
  while(current!==start){
   if(seen.has(current))return undefined;
   ring.push(current);seen.add(current);
   const [x,y]=adjacent.get(current)!;const next=x===previous?y:x;previous=current;current=next;
  }
  if(ring.length<3)return undefined;
  rings.push(ring);
 }
 // The outer loop first: the one enclosing the largest area in the face's plane.
 const helper=Math.abs(normal.x)<.9?[1,0,0]:[0,1,0],n=[normal.x,normal.y,normal.z],u=normalise(cross(helper,n)),v=cross(n,u);
 const area=(ring:number[])=>{let s=0;for(let j=0,k=ring.length-1;j<ring.length;k=j++){const a=ring[k],b=ring[j];const ax=p[3*a]*u[0]+p[3*a+1]*u[1]+p[3*a+2]*u[2],ay=p[3*a]*v[0]+p[3*a+1]*v[1]+p[3*a+2]*v[2],bx=p[3*b]*u[0]+p[3*b+1]*u[1]+p[3*b+2]*u[2],by=p[3*b]*v[0]+p[3*b+1]*v[1]+p[3*b+2]*v[2];s+=ax*by-bx*ay;}return Math.abs(s);};
 const areas=rings.map(area),outer=areas.indexOf(Math.max(...areas));
 return [rings[outer],...rings.filter((_,i)=>i!==outer)];
}
