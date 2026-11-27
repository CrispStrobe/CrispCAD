// SPDX-License-Identifier: BSD-3-Clause
// Display tessellation face by face, with planar faces triangulated here.
//
// SMLib meshes a planar face with many holes in time that grows faster than linearly with the
// hole count (measured 2026-11-26: one face of a plate with 101 holes 2.2 s CPU, with 201 holes
// 6.9 s), and that face dominates the whole-body mesh. Every other face costs a roughly constant
// amount each (about 20 ms), which a plate with hundreds of holes pays hundreds of times. So, for a
// body with such a face: faces of revolution between two full circles (a hole's wall, a chamfered
// or rounded rim) are meshed here from their own surface (rows of points around their axis), SMLib
// meshes each remaining non-planar face on its own (per-face meshes share the edge points of
// whole-body meshing, so they stay watertight), and the planar faces are triangulated here from
// exactly their neighbours' boundary points: ear clipping with holes bridged in (Eberly's method),
// and a grid index so each ear test looks only at nearby vertices. Anything unexpected (an unknown
// kernel object, a loop that does not close, a polygon the ear clipper cannot finish, a face of
// revolution whose samples leave the surface its kind says) falls back to SMLib's own mesh, for the
// face, its chain of coaxial faces or the whole body.
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
interface SmFace {readonly geomType:string;readonly radius:number;normalAt(point?:readonly number[]):SmVector;positionAt(u:number,v:number):SmVector;wires():ArrayLike<unknown>;edges():Iterable<SmEdge>;mesh(tolerance:number,angle:number):SmMesh;_identity():string}
interface SmPart {faces():Iterable<SmFace>}
const partOf=(solid:ExactSolid):SmPart|undefined=>{
 const part=(solid as unknown as {part?:SmPart}).part;
 return part&&typeof part.faces==='function'?part:undefined;
};

/** Vertices welded at 1 nm (the precision display meshes are stored at). */
/** Integer grid cells → values, without building a string key per lookup (a display mesh looks
 * up hundreds of thousands of points). Collisions of the hash are resolved by comparing cells. */
export class CellMap {
 private readonly buckets=new Map<number,number[]>();
 private static hash(ix:number,iy:number,iz:number){return Math.imul(ix|0,73856093)^Math.imul(iy|0,19349663)^Math.imul(iz|0,83492791)^Math.imul(Math.floor(ix/4294967296)|0,2654435761);}
 get(ix:number,iy:number,iz:number):number|undefined{
  const list=this.buckets.get(CellMap.hash(ix,iy,iz));
  if(list)for(let i=0;i<list.length;i+=4)if(list[i]===ix&&list[i+1]===iy&&list[i+2]===iz)return list[i+3];
  return undefined;
 }
 set(ix:number,iy:number,iz:number,value:number){
  const key=CellMap.hash(ix,iy,iz),list=this.buckets.get(key);
  if(list)list.push(ix,iy,iz,value);else this.buckets.set(key,[ix,iy,iz,value]);
 }
}
/** A directed edge between two vertex indices as one number (indices stay below 2^26 here). */
export const edgeKey=(a:number,b:number)=>a*67108864+b;

/** Vertices welded at 1 nm (the precision display meshes are stored at). */
class Pool {
 readonly positions:number[]=[];
 private readonly cells=new CellMap();
 private static readonly Q=1e-6;
 add(x:number,y:number,z:number){
  const q=Pool.Q,ix=Math.round(x/q),iy=Math.round(y/q),iz=Math.round(z/q);
  let index=this.cells.get(ix,iy,iz);
  if(index!==undefined)return index;
  // A point within the weld distance can round to the next cell: look there too.
  const fx=x/q-ix,fy=y/q-iy,fz=z/q-iz,dx=Math.abs(fx)>.4?Math.sign(fx):0,dy=Math.abs(fy)>.4?Math.sign(fy):0,dz=Math.abs(fz)>.4?Math.sign(fz):0;
  if(dx||dy||dz)for(const ox of dx?[0,dx]:[0])for(const oy of dy?[0,dy]:[0])for(const oz of dz?[0,dz]:[0]){
   index=this.cells.get(ix+ox,iy+oy,iz+oz);
   if(index!==undefined){this.cells.set(ix,iy,iz,index);return index;}
  }
  index=this.positions.length/3;this.positions.push(x,y,z);this.cells.set(ix,iy,iz,index);
  return index;
 }
}

export interface FacewiseMesh {positions:number[];indices:number[];
 /** Planar faces triangulated here, those handed back to SMLib, and faces of revolution (hole
  * walls, chamfered and rounded rims) meshed here as bands. */
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
 * Tessellate `solid` face by face: faces of revolution between full circles here (`bands`), SMLib
 * per other non-planar face, planar faces triangulated here from the same boundary points. Returns
 * undefined when the solid is not an smlibwasm part (call inside `k.scope`). The result is not
 * checked for closedness here; `displayMesh` does that. With `bands: false` every non-planar face
 * is SMLib's (a planar face SMLib has to mesh does not share the bands' circle points).
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
  const directed=new Set<number>(),segments:[number,number][]=[];
  for(let t=0;t<mesh.triangles.length;t+=3){
   const a=map[mesh.triangles[t]],b=map[mesh.triangles[t+1]],c=map[mesh.triangles[t+2]];
   if(a===b||b===c||c===a)continue;
   indices.push(a,b,c);
   directed.add(edgeKey(a,b));directed.add(edgeKey(b,c));directed.add(edgeKey(c,a));
  }
  for(const key of directed){const a=Math.floor(key/67108864),b=key-a*67108864;if(!directed.has(edgeKey(b,a)))segments.push([a,b]);}
  return segments;
 };
 const planarFaces:SmFace[]=[];
 const analytic=options.bands!==false?revolutionMeshes(faces,options):new Map<string,SmMesh>();
 for(const face of faces){
  if(face.geomType==='plane'){planarFaces.push(face);continue;}
  boundary.set(face._identity(),addMesh(analytic.get(face._identity())??face.mesh(options.tolerance,options.angleDeg)));
  tag(face);
 }
 const bands=analytic.size;
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
 * Faces of revolution between two full circles: a hole's wall (cylinder), a chamfered rim (cone)
 * or a rounded rim (a torus, or SMLib's surface of revolution of an arc), as fillets, chamfers and shells of drilled plates make them by the
 * hundred. SMLib spends a roughly constant ~20 ms meshing each such face (a 200-hole plate with
 * rounded rims has 400), so they are meshed here instead, from the surface's own parameters: rows
 * of points around the axis at the profile's positions (two for a straight profile, as many as the
 * chordal tolerance and the angle need along a torus' arc), joined by quads.
 *
 * Neighbouring faces of revolution share their circles, and the planar faces around them are
 * triangulated here from those circles' points, so all faces whose circles connect use the same
 * angles: one count per such chain of coaxial circles (the most any of its rows needs). A face is
 * meshed here only if every face across its circles is planar or meshed here as well; anything
 * else (a seam that is not a full circle, a circle off the axis, a surface the checks do not
 * recognise) is left to SMLib, and so are the faces next to it.
 */
interface RevolutionFace {face:SmFace;id:string;keys:[string,string];others:[SmFace,SmFace];
 circles:[{center:number[];radius:number;normal:number[]}, {center:number[];radius:number;normal:number[]}];
 samples:number[][]}
const circleKey=(c:SmVector,r:number)=>`${Math.round(c.x*1e6)},${Math.round(c.y*1e6)},${Math.round(c.z*1e6)},${Math.round(r*1e6)}`;
const dot=(a:readonly number[],b:readonly number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a:readonly number[],b:readonly number[])=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
function revolutionMeshes(faces:readonly SmFace[],options:{tolerance:number;angleDeg:number}):Map<string,SmMesh>{
 const candidates=new Map<string,RevolutionFace>();
 for(const face of faces){
  const kind=face.geomType;
  if(kind!=='cylinder'&&kind!=='cone'&&kind!=='torus'&&kind!=='revolution')continue;
  // A periodic face's loop runs circle, seam, circle, seam; edges() leaves the seam out.
  const edges=[...face.edges()],id=face._identity();
  if(edges.length!==2)continue;
  const circles:RevolutionFace['circles'][number][]=[],keys:string[]=[],others:SmFace[]=[];
  for(const edge of edges){
   if(edge.geomType!=='circle'||!edge.isClosed)break;
   const adjacent=[...edge.faces()].filter(f=>f._identity()!==id);
   if(adjacent.length!==1)break;
   const c=edge.arcCenter,n=edge.normal,r=edge.radius;
   if(!(r>0))break;
   circles.push({center:[c.x,c.y,c.z],radius:r,normal:normalise([n.x,n.y,n.z])});keys.push(circleKey(c,r));others.push(adjacent[0]);
  }
  if(circles.length!==2||keys[0]===keys[1])continue;
  if(Math.abs(dot(circles[0].normal,circles[1].normal))<1-1e-9)continue;
  // Points of the face (its parameter box is the face: it is bounded by two full circles), the
  // middle first, to find and check its profile.
  let samples:number[][];
  try{samples=[.5,.1,.25,.4,.6,.75,.9].map(t=>{const p=face.positionAt(t,t);return [p.x,p.y,p.z];});}catch{continue;}
  candidates.set(id,{face,id,keys:keys as [string,string],others:others as [SmFace,SmFace],circles:circles as RevolutionFace['circles'],samples});
 }
 const out=new Map<string,SmMesh>();
 for(;;){
  // A face stays only if each face across its circles is planar or stays as well.
  for(let changed=true;changed;){
   changed=false;
   for(const [id,c] of candidates)if(c.others.some(f=>f.geomType!=='plane'&&!candidates.has(f._identity()))){candidates.delete(id);changed=true;}
  }
  // Chains of coaxial circles joined by these faces (union-find on the circles).
  const parent=new Map<string,string>();
  const find=(key:string):string=>{let p=parent.get(key)??key;while(p!==(parent.get(p)??p))p=parent.get(p)!;parent.set(key,p);return p;};
  for(const c of candidates.values()){const a=find(c.keys[0]),b=find(c.keys[1]);if(a!==b)parent.set(a,b);}
  const chains=new Map<string,RevolutionFace[]>();
  for(const c of candidates.values()){const root=find(c.keys[0]),list=chains.get(root);if(list)list.push(c);else chains.set(root,[c]);}
  const rejected:string[]=[];
  out.clear();
  for(const chain of chains.values()){
   const meshes=meshChain(chain,options);
   if(meshes)for(const [id,mesh] of meshes)out.set(id,mesh);
   else rejected.push(...chain.map(c=>c.id));
  }
  if(!rejected.length)return out;
  for(const id of rejected)candidates.delete(id);
 }
}
/** Mesh one chain of faces around one axis with one angle count, or undefined if any face does
 * not fit the surface its kind says (then SMLib meshes the whole chain). */
function meshChain(chain:readonly RevolutionFace[],options:{tolerance:number;angleDeg:number}):Map<string,SmMesh>|undefined{
 const origin=chain[0].circles[0].center,axis=chain[0].circles[0].normal;
 const scale=Math.max(1,...chain.flatMap(c=>c.circles.map(circle=>circle.radius)));
 const meridian=(p:readonly number[])=>{const d=sub(p,origin),z=dot(d,axis);return [Math.hypot(d[0]-z*axis[0],d[1]-z*axis[1],d[2]-z*axis[2]),z];};
 const angleStep=options.angleDeg*Math.PI/180;
 const rowsOf=new Map<string,[number,number][]>();
 for(const c of chain){
  // Both circles on the chain's axis.
  for(const circle of c.circles){
   if(Math.abs(dot(circle.normal,axis))<1-1e-9)return undefined;
   const d=sub(circle.center,origin),z=dot(d,axis);
   if(Math.hypot(d[0]-z*axis[0],d[1]-z*axis[1],d[2]-z*axis[2])>1e-7*scale)return undefined;
  }
  const [r0,z0]=[c.circles[0].radius,dot(sub(c.circles[0].center,origin),axis)],[r1,z1]=[c.circles[1].radius,dot(sub(c.circles[1].center,origin),axis)];
  const eps=1e-6*scale,samples=c.samples.map(meridian),[rm,zm]=samples[0];
  let rows:[number,number][];
  // The profile through circle 0, the face's middle and circle 1: a line, or for a torus or a
  // surface of revolution (SMLib makes a hole rim's round one) possibly an arc. Every sample of the
  // face must lie on it.
  const ax=r1-r0,az=z1-z0,bx=rm-r0,bz=zm-z0,det=2*(ax*bz-az*bx);
  const chord=Math.hypot(ax,az);
  if(!(chord>eps))return undefined;
  const straight=Math.abs(det)/chord<=2*eps;
  if(straight||c.face.geomType==='cylinder'||c.face.geomType==='cone'){
   if(!straight)return undefined;
   for(const [r,z] of samples)if(Math.abs((r-r0)*az-(z-z0)*ax)/chord>eps)return undefined;
   if(c.face.geomType==='cylinder'&&(Math.abs(r0-r1)>eps||Math.abs(c.face.radius-r0)>eps))return undefined;
   rows=[[r0,z0],[r1,z1]];
  }else{
   // The circle through the three points (in meridian coordinates, relative to circle 0).
   const a2=ax*ax+az*az,b2=bx*bx+bz*bz,ox=(bz*a2-az*b2)/det,oz=(ax*b2-bx*a2)/det,R=r0+ox,Z=z0+oz,rho=Math.hypot(ox,oz);
   if(!(rho>eps)||!Number.isFinite(rho))return undefined;
   for(const [r,z] of samples)if(Math.abs(Math.hypot(r-R,z-Z)-rho)>eps)return undefined;
   const angle=(r:number,z:number)=>Math.atan2(z-Z,r-R),turn=(x:number)=>((x%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
   const phi0=angle(r0,z0);
   // The arc from circle 0 to circle 1 that passes the face's middle, and holds every sample.
   let sweep=turn(angle(r1,z1)-phi0);
   if(turn(angle(rm,zm)-phi0)>sweep)sweep-=2*Math.PI;
   for(const [r,z] of samples){const along=sweep>0?turn(angle(r,z)-phi0):turn(phi0-angle(r,z));if(along>Math.abs(sweep)+1e-9)return undefined;}
   const step=Math.min(angleStep,2*Math.acos(Math.max(-1,1-options.tolerance/rho)));
   const m=Math.max(1,Math.ceil(Math.abs(sweep)/step-1e-9));
   rows=Array.from({length:m+1},(_,j)=>j===0?[r0,z0]:j===m?[r1,z1]:[R+rho*Math.cos(phi0+sweep*j/m),Z+rho*Math.sin(phi0+sweep*j/m)]);
  }
  if(rows.some(([r])=>!(r>eps)))return undefined;
  rowsOf.set(c.id,rows);
 }
 const radii=[...rowsOf.values()].flat().map(([r])=>r);
 const count=Math.max(8,Math.ceil(360/options.angleDeg-1e-9),...radii.map(r=>Math.ceil(Math.PI/Math.max(Math.acos(Math.max(-1,1-options.tolerance/r)),1e-9))));
 if(count>4096)return undefined;
 const helper=Math.abs(axis[0])<.9?[1,0,0]:[0,1,0],u=normalise(cross(helper,axis)),v=cross(axis,u);
 const cos=Array.from({length:count},(_,i)=>Math.cos(2*Math.PI*i/count)),sin=Array.from({length:count},(_,i)=>Math.sin(2*Math.PI*i/count));
 const meshes=new Map<string,SmMesh>();
 for(const c of chain){
  const rows=rowsOf.get(c.id)!,vertices=new Float64Array(3*count*rows.length);
  rows.forEach(([r,z],j)=>{
   for(let i=0;i<count;i++)for(let k=0;k<3;k++)vertices[3*(j*count+i)+k]=origin[k]+z*axis[k]+r*(cos[i]*u[k]+sin[i]*v[k]);
  });
  // Orient by the face's outward normal at a quad in the middle row.
  const j=Math.floor((rows.length-1)/2),a=j*count,b=a+1,B=a+count+1;
  const at=(q:number)=>[vertices[3*q],vertices[3*q+1],vertices[3*q+2]];
  const pa=at(a),pb=at(b),pB=at(B),centroid=[0,1,2].map(k=>(pa[k]+pb[k]+pB[k])/3);
  let outward:SmVector;
  try{outward=c.face.normalAt(centroid);}catch{return undefined;}
  const facing=dot(cross(sub(pb,pa),sub(pB,pa)),[outward.x,outward.y,outward.z]);
  if(!facing)return undefined;
  const triangles=new Uint32Array(6*count*(rows.length-1));
  for(let row=0;row+1<rows.length;row++)for(let i=0;i<count;i++){
   const p=row*count+i,q=row*count+(i+1)%count,P=p+count,Q=q+count;
   triangles.set(facing>0?[p,q,Q,p,Q,P]:[p,Q,q,p,P,Q],6*(row*count+i));
  }
  meshes.set(c.id,{vertices,triangles});
 }
 return meshes;
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
