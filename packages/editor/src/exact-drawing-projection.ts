// SPDX-License-Identifier: BSD-3-Clause
// Hidden-line projection of an assembly from the exact B-rep.
//
// The lines of a body the exact kernel built are its B-rep edges and the silhouettes of its curved
// faces, not the creases of a display mesh: a hole is one circle, not 32 chords, and a cylinder's
// outline sits at its true radius. What hides a line is decided against a face-wise mesh of the
// same B-rep (exact-drawing.ts in @brickwright/cad-exact), whose triangles know their face:
//
// - A triangle hides a point when the point projects inside it and lies behind it by more than the
//   depth tolerance (twice the mesh's chord tolerance, so a curved face's chords never hide the
//   curve they approximate).
// - Near a triangle side that runs along a B-rep edge, the triangle hides nothing within the
//   lateral margin (again twice the chord tolerance): an exact curve bulges past the chords of the
//   face it bounds, and those slivers must not hide it.
// - Silhouettes are the mesh edges inside one curved face where the face turns from facing the
//   viewer to facing away. On cylinders they are moved onto the exact generator line, on spheres
//   onto the exact outline circle; on other curved surfaces (cones, tori, splines) they stay at
//   the mesh's chord tolerance and are counted as such in the projection's report.
//
// Circular edges seen face-on, and sphere outlines, come out as true arcs (centre, radius, start,
// sweep), so the PDF draws circles, not polygons. Hidden pieces that coincide with visible lines
// (the far rim of a through hole, a hole's rim seen edge-on along a face) are removed.
//
// Bodies the kernel could not build are projected from their display mesh, as the mesh path does
// (mesh creases and silhouettes), in the same hidden-line pass, and listed with the reason.
import {t} from '@brickwright/cad-core';
import type {ExactDrawingBody,ExactDrawingData,SketchPoint,Vec3} from '@brickwright/cad-core';
import type {BodyMesh,GeometryResult} from '@brickwright/cad-geometry';
import {meshDrawingTopology} from './assembly-drawing.js';
import type {AssemblyProjection} from './assembly-drawing.js';
import {drawingViews} from './drawing-page.js';

/** A circular arc on paper-independent view coordinates (model millimetres from the view origin). */
export type DrawingArc={center:SketchPoint;radius:number;start:number;sweep:number;hidden:boolean};
export type DrawingPolyline={points:SketchPoint[];hidden:boolean};
export type ExactViewLines={arcs:DrawingArc[];polylines:DrawingPolyline[]};
export type ExactProjectionReport={
 /** Bodies drawn from their exact B-rep. */
 exactBodies:string[];
 /** Bodies drawn from their display mesh, and why. */
 meshBodies:{id:string;name:string;reason:string}[];
 /** Silhouette lines of curved faces other than cylinders and spheres, left at the mesh's chord tolerance. */
 tessellatedSilhouettes:number;
 /** Largest chord tolerance of the occlusion meshes (mm). */
 tolerance:number;
 /** Exact overall size of the drawn bodies (mm). */
 size:Vec3;
 /** Full cylindrical holes grouped by exact diameter. */
 holes:{diameter:number;count:number}[];
};
export type ExactAssemblyProjection=AssemblyProjection&{
 exact:ExactProjectionReport;
 /** Arcs and polylines per view, in the order of `views` (top, front, right). */
 lines:ExactViewLines[];
 /** An isometric view (from front, right and top), visible lines only. */
 iso:{width:number;height:number;segments:Float64Array;lines:ExactViewLines};
};
export const isExactProjection=(projection:AssemblyProjection):projection is ExactAssemblyProjection=>'exact' in projection;

type Frame={u:Vec3;v:Vec3;d:Vec3};
const dot=(a:readonly number[],b:readonly number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:readonly number[],b:readonly number[]):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a:readonly number[],b:readonly number[]):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a:readonly number[],b:readonly number[],s=1):Vec3=>[a[0]+b[0]*s,a[1]+b[1]*s,a[2]+b[2]*s];
const norm=(a:readonly number[]):Vec3=>{const l=Math.hypot(a[0],a[1],a[2]);return [a[0]/l,a[1]/l,a[2]/l];};
const axisVector=(i:number):Vec3=>[i===0?1:0,i===1?1:0,i===2?1:0];

const standardFrames:Frame[]=drawingViews.map(({horizontal,vertical,depth,near})=>({u:axisVector(horizontal),v:axisVector(vertical),d:axisVector(depth).map(x=>x*near) as Vec3}));
/** Isometric: seen from +X, −Y, +Z (front, right and top at once), world Z up on paper. */
export const isoFrame:Frame=(()=>{
 const d=norm([1,-1,1]),v=norm(add([0,0,1],d,-d[2]));
 return {u:cross(v,d),v,d};
})();

const bins=48;
const maxBucketVisits=24000000;
const maxCoverageChecks=4000000;
const cosineCrease=Math.cos(Math.PI/6);
const detailError=()=>new Error(t('This assembly exceeds the drawing detail limit. Use a simpler representation.'));

type Triangle={a:Vec3;b:Vec3;c:Vec3;det:number;left:number;bottom:number;right:number;top:number;nearest:number;margin:[number,number,number];stamp:number;owner:number};
/** A line to draw: 3D points (a polyline), what it is, and how to report it. */
type Candidate={
 body:number;points:Vec3[];
 /** A silhouette of a sphere or cylinder, which its own face never hides: the face's owner key. */
 own?:number;
 /** A straight B-rep or mesh edge (picked for edge dimensions with its full end points). */
 line?:[Vec3,Vec3];
 /** Points lie on this circle (a circular edge, or a sphere's outline); `face-on` arcs are drawn as arcs. */
 circle?:{center:Vec3;radius:number;e1:Vec3;e2:Vec3;angles:number[]};
};
type Piece={candidate:Candidate;chord:number;from:number;to:number;hidden:boolean};

/** Unit vectors e1, e2 in the plane of a circle with axis `axis`, e1 towards `start`. */
function circleBasis(center:readonly number[],axis:readonly number[],start:readonly number[]){
 const a=norm(axis),e1=norm(sub(start,center)),e2=cross(a,e1);
 return {e1,e2,angle:(p:readonly number[])=>{const r=sub(p,center);return Math.atan2(dot(r,e2),dot(r,e1));}};
}

/** Angles to sample on an arc from 0 to `sweep`, with the view's extreme points included. */
function arcAngles(sweep:number,e1:Vec3,e2:Vec3,frame:Frame){
 const steps=Math.max(4,Math.ceil(Math.abs(sweep)/(2*Math.PI)*128));
 const angles=Array.from({length:steps+1},(_,i)=>sweep*i/steps);
 for(const w of [frame.u,frame.v])for(const base of [Math.atan2(dot(e2,w),dot(e1,w))]){
  for(const extreme of [base,base+Math.PI,base-Math.PI,base+2*Math.PI,base-2*Math.PI]){
   const along=sweep>=0?extreme:-extreme,limit=Math.abs(sweep);
   if(along>1e-9&&along<limit-1e-9)angles.push(extreme);
  }
 }
 return [...new Set(angles)].sort((x,y)=>sweep>=0?x-y:y-x);
}

/** Lines of one exact body for one view: its edges and the silhouettes of its curved faces. */
function exactCandidates(body:ExactDrawingBody,index:number,frame:Frame,report:{tessellated:number}):Candidate[]{
 const out:Candidate[]=[],{faces}=body;
 const point=(flat:readonly number[],i:number):Vec3=>[flat[3*i],flat[3*i+1],flat[3*i+2]];
 for(const edge of body.edges){
  const count=edge.points.length/3;
  if(count<2)continue;
  // Edges between coplanar faces (a polyhedron's triangulation) are no edges of the shape.
  if(edge.faces.length===2){
   const [f,g]=edge.faces.map(i=>faces[i]);
   if(f&&g&&f.surface==='plane'&&g.surface==='plane'&&dot(f.normal,g.normal)>1-1e-9&&Math.abs(dot(sub(f.point,g.point),f.normal))<1e-6)continue;
  }
  const first=point(edge.points,0),last=point(edge.points,count-1);
  if(edge.curve==='line'){out.push({body:index,points:[first,last],line:[first,last]});continue;}
  if(edge.circle&&edge.circle.radius>0){
   const {center,radius,axis}=edge.circle,{e1,e2,angle}=circleBasis(center,axis,first);
   const step=angle(point(edge.points,1));
   const sweep=(edge.closed?2*Math.PI:Math.min(2*Math.PI,edge.length/radius))*(step<0?-1:1);
   const angles=arcAngles(sweep,e1,e2,frame);
   const at=(a:number)=>add(add(center,e1,radius*Math.cos(a)),e2,radius*Math.sin(a));
   out.push({body:index,points:angles.map(at),circle:{center:[...center] as Vec3,radius,e1,e2,angles}});
   continue;
  }
  out.push({body:index,points:Array.from({length:count},(_,i)=>point(edge.points,i))});
 }
 // Silhouettes: inside one curved face, mesh edges between a triangle facing the viewer and one not.
 const {positions}=body.mesh,{normals,pairs}=meshAdjacency(body);
 const vertex=(i:number):Vec3=>[positions[3*i],positions[3*i+1],positions[3*i+2]];
 const facing=(k:number)=>normals[3*k]*frame.d[0]+normals[3*k+1]*frame.d[1]+normals[3*k+2]*frame.d[2]>1e-9;
 const byFace=new Map<number,[number,number][]>();
 for(let i=0;i<pairs.length;i+=5){
  if(facing(pairs[i+3])===facing(pairs[i+4]))continue;
  const face=pairs[i+2],list=byFace.get(face),segment:[number,number]=[pairs[i],pairs[i+1]];
  if(list)list.push(segment);else byFace.set(face,[segment]);
 }
 for(const [faceIndex,segments] of byFace){
  const face=faces[faceIndex];
  let snap:(p:Vec3)=>Vec3=p=>p;
  let circle:Candidate['circle'],snapped=true;
  if(face.surface==='cylinder'&&face.axis&&face.radius){
   const o=face.axis.origin,a=norm(face.axis.direction),side=cross(a,frame.d),l=Math.hypot(...side);
   if(l<1e-9)continue;
   const n=side.map(x=>x/l) as Vec3,r=face.radius;
   snap=p=>{const s=dot(sub(p,o),a),foot=add(o,a,s);return add(foot,n,dot(sub(p,foot),n)>=0?r:-r);};
  }else if(face.surface==='sphere'&&face.axis&&face.radius){
   const c=face.axis.origin,r=face.radius,e1=norm(frame.u),e2=norm(frame.v);
   snap=p=>{const q=sub(p,c),x=dot(q,e1),y=dot(q,e2),l=Math.hypot(x,y)||1;return add(add(c,e1,r*x/l),e2,r*y/l);};
   circle={center:[...c] as Vec3,radius:r,e1,e2,angles:[]};
  }else{report.tessellated+=1;snapped=false;}
  // A sphere or cylinder never hides its own outline; its chords only would, by the chord sag.
  const own=snapped?ownerKey(index,faceIndex):undefined;
  for(const chain of chains(segments)){
   const points=chain.map(i=>snap(vertex(i)));
   if(circle){
    const angles=points.map(p=>Math.atan2(dot(sub(p,circle!.center),circle!.e2),dot(sub(p,circle!.center),circle!.e1)));
    for(let i=1;i<angles.length;i++){while(angles[i]-angles[i-1]>Math.PI)angles[i]-=2*Math.PI;while(angles[i]-angles[i-1]<-Math.PI)angles[i]+=2*Math.PI;}
    out.push({body:index,points,own,circle:{...circle,angles}});
   }else out.push({body:index,points,own});
  }
 }
 return out;
}

/** Undirected segments joined into polylines at vertices where exactly two meet. */
function chains(segments:[number,number][]):number[][]{
 const next=new Map<number,number[]>();
 for(const [a,b] of segments){for(const [x,y] of [[a,b],[b,a]]){const l=next.get(x);if(l)l.push(y);else next.set(x,[y]);}}
 const used=new Set<string>(),key=(a:number,b:number)=>a<b?a+','+b:b+','+a,out:number[][]=[];
 const walk=(start:number,second:number)=>{
  const chain=[start,second];used.add(key(start,second));
  let previous=start,current=second;
  while(next.get(current)?.length===2){
   const [x,y]=next.get(current)!,following=x===previous?y:x;
   if(used.has(key(current,following)))break;
   used.add(key(current,following));chain.push(following);previous=current;current=following;
  }
  return chain;
 };
 // Open chains from their ends first, then closed loops.
 for(const [v,list] of next)if(list.length!==2)for(const w of list)if(!used.has(key(v,w)))out.push(walk(v,w));
 for(const [a,b] of segments)if(!used.has(key(a,b)))out.push(walk(a,b));
 return out;
}

/** Lines of a body drawn from its display mesh, as the mesh projection finds them. */
function meshCandidates(model:ReturnType<typeof meshDrawingTopology>,index:number,frame:Frame):Candidate[]{
 const out:Candidate[]=[];
 for(const edge of model.edges){
  const [n,...neighbors]=edge.normals;
  if(neighbors.length&&!neighbors.some(m=>dot(n,m)<cosineCrease||(dot(n,frame.d)>1e-8)!==(dot(m,frame.d)>1e-8)))continue;
  const a=model.vertices[edge.a],b=model.vertices[edge.b];
  out.push({body:index,points:[a,b],line:[a,b]});
 }
 return out;
}

/** `margin(k, j)`: how far inside side j of triangle k a point must lie to be hidden (0 inside a face). */
type Occluder={positions:ArrayLike<number>;indices:ArrayLike<number>;margin?:(triangle:number,side:number)=>number;faceOf?:ArrayLike<number>};
const ownerKey=(body:number,face:number)=>body*1048576+face;

/** Sides along a straight B-rep edge (two planes meet in a line) get the `straight` margin; sides
 * along a curve, whose chords the exact curve bulges past, the `curved` one. */
function exactOccluder(body:ExactDrawingBody,straight:number,curved:number):Occluder{
 const {indices,faceOf}=body.mesh,{boundary}=meshAdjacency(body);
 return {positions:body.mesh.positions,indices,faceOf,margin:(k,j)=>boundary[3*k+j]===0?0:boundary[3*k+j]===1?straight:curved};
}

/** Per body, once: unit triangle normals, which triangle sides bound their face (1 between two
 * planes, 2 otherwise), and the sides shared by two triangles of one curved face (a, b, face,
 * triangle, other triangle). */
const adjacency=new WeakMap<ExactDrawingBody,{normals:Float64Array;boundary:Uint8Array;pairs:Uint32Array}>();
function meshAdjacency(body:ExactDrawingBody){
 let cached=adjacency.get(body);
 if(cached)return cached;
 const {positions:p,indices,faceOf}=body.mesh,count=indices.length/3,vertices=p.length/3;
 const normals=new Float64Array(3*count),boundary=new Uint8Array(3*count),pairs:number[]=[];
 const sides=new Map<number,number>();
 for(let k=0;k<count;k++){
  const a=3*indices[3*k],b=3*indices[3*k+1],c=3*indices[3*k+2];
  const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz)||1;
  normals[3*k]=nx/l;normals[3*k+1]=ny/l;normals[3*k+2]=nz/l;
  for(let j=0;j<3;j++)sides.set(indices[3*k+j]*vertices+indices[3*k+(j+1)%3],k);
 }
 const curved=body.faces.map(face=>face.surface!=='plane');
 for(let k=0;k<count;k++)for(let j=0;j<3;j++){
  const a=indices[3*k+j],b=indices[3*k+(j+1)%3],other=sides.get(b*vertices+a);
  // A side is a face boundary when no triangle of the same face runs along it the other way.
  if(other===undefined||faceOf[other]!==faceOf[k]){boundary[3*k+j]=other!==undefined&&!curved[faceOf[k]]&&!curved[faceOf[other]]?1:2;continue;}
  if(a<b&&curved[faceOf[k]])pairs.push(a,b,faceOf[k],k,other);
 }
 cached={normals,boundary,pairs:Uint32Array.from(pairs)};
 adjacency.set(body,cached);
 return cached;
}

/** Visible and hidden pieces of every candidate in one view. */
function hiddenLines(candidates:Candidate[],occluders:Occluder[],frame:Frame,offset:[number,number],extent:[number,number],tolerance:number,stub:number):Piece[]{
 const project=(p:readonly number[]):Vec3=>[dot(p,frame.u)-offset[0],dot(p,frame.v)-offset[1],dot(p,frame.d)];
 const [width,height]=[Math.max(extent[0],1e-6),Math.max(extent[1],1e-6)];
 const cells:Triangle[][]=Array.from({length:bins*bins},()=>[]);
 const bin=(v:number,size:number)=>Math.min(bins-1,Math.max(0,Math.floor(v/size*bins)));
 let visits=0,checks=0;
 const spend=()=>{if(++visits>maxBucketVisits)throw detailError();};
 for(const [o,occluder] of occluders.entries()){
  const {positions,indices,faceOf}=occluder;
  for(let k=0;k<indices.length/3;k++){
   const [a,b,c]=[0,1,2].map(j=>project([positions[3*indices[3*k+j]],positions[3*indices[3*k+j]+1],positions[3*indices[3*k+j]+2]]));
   const det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
   if(Math.abs(det)<1e-10)continue;
   // Barycentric margins: lambda_a measures the distance to side bc, and so on.
   const side=(p:Vec3,q:Vec3)=>Math.hypot(q[0]-p[0],q[1]-p[1]);
   const m=(j:number,p:Vec3,q:Vec3)=>{const margin=occluder.margin?.(k,j)??0;return margin?margin*side(p,q)/Math.abs(det):0;};
   const triangle:Triangle={a,b,c,det,left:Math.min(a[0],b[0],c[0]),bottom:Math.min(a[1],b[1],c[1]),right:Math.max(a[0],b[0],c[0]),top:Math.max(a[1],b[1],c[1]),
    nearest:Math.max(a[2],b[2],c[2]),margin:[m(1,b,c),m(2,c,a),m(0,a,b)],stamp:-1,owner:faceOf?ownerKey(o,faceOf[k]):-1};
   for(let y=bin(triangle.bottom,height);y<=bin(triangle.top,height);y++)for(let x=bin(triangle.left,width);x<=bin(triangle.right,width);x++){spend();cells[y*bins+x].push(triangle);}
  }
 }
 const cover=(tri:Triangle,p:Vec3,q:Vec3):[number,number]|undefined=>{
  const {a,b,c,det}=tri;
  const f=(s:Vec3)=>{
   const x=s[0]-a[0],y=s[1]-a[1];
   const u=(x*(c[1]-a[1])-y*(c[0]-a[0]))/det,v=((b[0]-a[0])*y-(b[1]-a[1])*x)/det;
   return [1-u-v-tri.margin[0],u-tri.margin[1],v-tri.margin[2],a[2]+u*(b[2]-a[2])+v*(c[2]-a[2])-s[2]-tolerance];
  };
  const start=f(p),end=f(q);
  let lo=0,hi=1;
  for(let k=0;k<4;k++){
   if(start[k]<=0&&end[k]<=0){
    // On a mesh side inside a face the neighbouring triangle continues the cover.
    if(k===3||tri.margin[k]>0||start[k]<-1e-10||end[k]<-1e-10)return undefined;
    continue;
   }
   if(start[k]<0)lo=Math.max(lo,start[k]/(start[k]-end[k]));
   else if(end[k]<0)hi=Math.min(hi,start[k]/(start[k]-end[k]));
  }
  return hi-lo>1e-9?[lo,hi]:undefined;
 };
 const pieces:Piece[]=[],lengths=new Map<Piece,number>();
 let stamp=0;
 for(const candidate of candidates){
  const points=candidate.points.map(project),linePieces:Piece[]=[];
  for(let i=0;i+1<points.length;i++){
   const p=points[i],q=points[i+1],length=Math.hypot(q[0]-p[0],q[1]-p[1]);
   if(length<1e-7)continue;
   const threshold=Math.min(p[2],q[2])+tolerance,covered:[number,number][]=[];
   stamp++;
   let hidden=false;
   // Cells along the chord, column by column.
   const [l,r]=p[0]<=q[0]?[p,q]:[q,p],dx=r[0]-l[0],dy=r[1]-l[1],stride=width/bins;
   const x0=bin(l[0],width),x1=bin(r[0],width);
   for(let x=x0;x<=x1&&!hidden;x++){
    const ys=dx<1e-12?[l[1],r[1]]:[l[1]+dy*Math.max(0,(x*stride-l[0])/dx),l[1]+dy*Math.min(1,((x+1)*stride-l[0])/dx)];
    for(let y=bin(Math.min(...ys),height);y<=bin(Math.max(...ys),height)&&!hidden;y++){
     for(const tri of cells[y*bins+x]){
      spend();
      if(tri.stamp===stamp||tri.nearest<=threshold||tri.owner===candidate.own)continue;
      tri.stamp=stamp;
      if(tri.right<Math.min(p[0],q[0])||tri.left>Math.max(p[0],q[0])||tri.top<Math.min(p[1],q[1])||tri.bottom>Math.max(p[1],q[1]))continue;
      if(++checks>maxCoverageChecks)throw detailError();
      const interval=cover(tri,p,q);
      if(!interval)continue;
      if(interval[0]<=1e-9&&interval[1]>=1-1e-9){hidden=true;break;}
      covered.push(interval);
     }
    }
   }
   if(hidden){const whole={candidate,chord:i,from:0,to:1,hidden:true};lengths.set(whole,length);linePieces.push(whole);continue;}
   covered.sort((x,y)=>x[0]-y[0]);
   let cursor=0;
   const own:Piece[]=[];
   const piece=(from:number,to:number,isHidden:boolean)=>{if((to-from)*length>1e-7)own.push({candidate,chord:i,from,to,hidden:isHidden});};
   for(let k=0;k<covered.length;k++){
    const [start]=covered[k];let end=covered[k][1];
    while(k+1<covered.length&&covered[k+1][0]<=end+1e-9)end=Math.max(end,covered[++k][1]);
    piece(cursor,start,false);piece(start,end,true);cursor=end;
   }
   piece(cursor,1,false);
   for(const p of own)lengths.set(p,(p.to-p.from)*length);
   linePieces.push(...own);
  }
  pieces.push(...smooth(linePieces,lengths,stub));
 }
 return pieces;
}

/**
 * Along one line (its pieces in order): a hidden run shorter than `stub` between visible ones is
 * visible (a steep triangle next to a tangent edge grazing it within the chord tolerance), and
 * then a visible run shorter than `stub` next to hidden ones is hidden (where a hidden line meets
 * the boundary of the face that hides it, inside the lateral margin).
 */
function smooth(pieces:Piece[],lengths:Map<Piece,number>,stub:number):Piece[]{
 const runs=()=>{
  const out:{hidden:boolean;pieces:Piece[];length:number}[]=[];
  for(const piece of pieces){
   const last=out.at(-1);
   if(last&&last.hidden===piece.hidden){last.pieces.push(piece);last.length+=lengths.get(piece)??0;}
   else out.push({hidden:piece.hidden,pieces:[piece],length:lengths.get(piece)??0});
  }
  return out;
 };
 for(const hidden of [true,false]){
  const list=runs();
  if(list.length<2)break;
  for(const run of list)if(run.hidden===hidden&&run.length<=stub)for(const piece of run.pieces)piece.hidden=!hidden;
 }
 return pieces;
}

/** Subtract from [from, to] every interval in `cut` (sorted or not). */
function subtract(from:number,to:number,cut:[number,number][]):[number,number][]{
 let parts:[number,number][]=[[from,to]];
 for(const [a,b] of cut)parts=parts.flatMap(([x,y])=>b<=x||a>=y?[[x,y] as [number,number]]:[...(a>x?[[x,a] as [number,number]]:[]),...(b<y?[[b,y] as [number,number]]:[])]);
 return parts;
}

type ViewOutput={segments:number[];picks:number[];lines:ExactViewLines};

/** Turn pieces into drawable lines: straight edges, arcs (face-on circles and outlines) and polylines. */
function assemble(pieces:Piece[],frame:Frame,offset:[number,number],epsilon:number,hiddenWanted:boolean):ViewOutput{
 const project=(p:readonly number[]):SketchPoint=>[dot(p,frame.u)-offset[0],dot(p,frame.v)-offset[1]];
 type Flat={a:SketchPoint;b:SketchPoint;hidden:boolean;piece:Piece;depth:number};
 const flats:Flat[]=[],arcs:{key:string;center:SketchPoint;radius:number;from:number;to:number;hidden:boolean}[]=[];
 const faceOn=(circle:NonNullable<Candidate['circle']>)=>Math.abs(dot(cross(circle.e1,circle.e2),frame.d))>1-1e-9;
 for(const piece of pieces){
  const {candidate,chord,from,to}=piece,{points,circle}=candidate;
  if(circle&&faceOn(circle)){
   const a0=circle.angles[chord],a1=circle.angles[chord+1];
   const center=project(circle.center),handed=Math.sign(dot(cross(circle.e1,circle.e2),frame.d));
   // The arc's angle on paper: the circle's start direction projected, turned by the sweep.
   const base=Math.atan2(dot(circle.e1,frame.v),dot(circle.e1,frame.u));
   const angle=(a:number)=>base+handed*a;
   const s=angle(a0+(a1-a0)*from),e=angle(a0+(a1-a0)*to);
   arcs.push({key:center.map(x=>Math.round(x/epsilon)).join(',')+':'+Math.round(circle.radius/epsilon),center,radius:circle.radius,from:Math.min(s,e),to:Math.max(s,e),hidden:piece.hidden});
   continue;
  }
  const p=points[chord],q=points[chord+1],at=(s:number)=>project(add(p,sub(q,p),s));
  flats.push({a:at(from),b:at(to),hidden:piece.hidden,piece,depth:dot(add(p,sub(q,p),(from+to)/2),frame.d)});
 }
 // Lines along lines already drawn are not drawn again: visible pieces nearest first (the far
 // copy of a coincident edge is dropped), then hidden pieces against everything visible.
 const cell=Math.max(epsilon*50,1),grid=new Map<string,Flat[]>();
 const cellsOf=(f:Flat,visit:(key:string)=>void)=>{
  const x0=Math.floor(Math.min(f.a[0],f.b[0])/cell),x1=Math.floor(Math.max(f.a[0],f.b[0])/cell);
  const y0=Math.floor(Math.min(f.a[1],f.b[1])/cell),y1=Math.floor(Math.max(f.a[1],f.b[1])/cell);
  if((x1-x0+1)*(y1-y0+1)>4096){visit('wide');return;}
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)visit(x+','+y);
 };
 /** The parts of `f` not along a line in the grid. */
 const remainder=(f:Flat):Flat[]=>{
  const dx=f.b[0]-f.a[0],dy=f.b[1]-f.a[1],length=Math.hypot(dx,dy);
  if(length<=epsilon)return [];
  const near=new Set<Flat>();
  cellsOf(f,key=>{for(const g of grid.get(key)??[])near.add(g);});
  for(const g of grid.get('wide')??[])near.add(g);
  const cut:[number,number][]=[];
  for(const g of near){
   const off=(p:SketchPoint)=>Math.abs((p[0]-f.a[0])*dy-(p[1]-f.a[1])*dx)/length;
   if(off(g.a)>epsilon||off(g.b)>epsilon)continue;
   const along=(p:SketchPoint)=>((p[0]-f.a[0])*dx+(p[1]-f.a[1])*dy)/(length*length);
   const s=along(g.a),e=along(g.b);
   cut.push([Math.min(s,e),Math.max(s,e)]);
  }
  if(!cut.length)return [f];
  return subtract(0,1,cut).filter(([s,e])=>(e-s)*length>epsilon).map(([s,e])=>({...f,a:[f.a[0]+dx*s,f.a[1]+dy*s],b:[f.a[0]+dx*e,f.a[1]+dy*e]}));
 };
 const kept:Flat[]=[];
 for(const f of flats.filter(f=>!f.hidden).sort((x,y)=>y.depth-x.depth))for(const part of remainder(f)){
  kept.push(part);
  cellsOf(part,key=>{const l=grid.get(key);if(l)l.push(part);else grid.set(key,[part]);});
 }
 if(hiddenWanted)for(const f of flats)if(f.hidden)kept.push(...remainder(f));
 // Arcs of one circle: a visible arc wins over hidden and duplicate ones.
 const outArcs:DrawingArc[]=[];
 const byCircle=new Map<string,typeof arcs>();
 for(const arc of arcs){const l=byCircle.get(arc.key);if(l)l.push(arc);else byCircle.set(arc.key,[arc]);}
 const turn=2*Math.PI;
 // Intervals moved into [0, 2π], split where they cross 2π.
 const normalise=(list:[number,number][])=>{
  const out:[number,number][]=[];
  for(const [a,b] of list){
   if(b-a>=turn-1e-9){out.push([0,turn]);continue;}
   const shift=Math.floor(a/turn)*turn,s=a-shift,e=b-shift;
   if(e>turn){out.push([s,turn],[0,e-turn]);}else out.push([s,e]);
  }
  return out.sort((x,y)=>x[0]-y[0]);
 };
 const merge=(list:[number,number][])=>{
  const out:[number,number][]=[];
  for(const [a,b] of normalise(list)){const last=out.at(-1);if(last&&a<=last[1]+1e-9)last[1]=Math.max(last[1],b);else out.push([a,b]);}
  // An arc through angle 0 is one arc.
  if(out.length>1&&out[0][0]<=1e-9&&out.at(-1)![1]>=turn-1e-9){const first=out.shift()!;out.at(-1)![1]=first[1]+turn;}
  return out;
 };
 for(const list of byCircle.values()){
  const {center,radius}=list[0];
  const shown=merge(list.filter(a=>!a.hidden).map(a=>[a.from,a.to]));
  for(const [a,b] of shown)outArcs.push({center,radius,start:a,sweep:Math.min(2*Math.PI,b-a),hidden:false});
  if(!hiddenWanted)continue;
  const cut=normalise(shown).flatMap(([a,b])=>[[a,b],[a+turn,b+turn]] as [number,number][]);
  for(const [a,b] of merge(list.filter(a=>a.hidden).map(a=>[a.from,a.to])))
   for(const [s,e] of subtract(a,b,cut))if((e-s)*radius>epsilon)outArcs.push({center,radius,start:s,sweep:e-s,hidden:true});
 }
 // Straight edges become segments (and picks); curves and silhouettes join into polylines.
 const segments:number[]=[],picks:number[]=[],polylines:DrawingPolyline[]=[];
 const runs=new Map<Candidate,Flat[]>();
 for(const f of kept){
  if(f.piece.candidate.line){
   segments.push(...f.a,...f.b,f.hidden?1:0);
   if(!f.hidden){const [a,b]=f.piece.candidate.line;picks.push(f.piece.candidate.body,...a,...b,...f.a,...f.b);}
   continue;
  }
  const l=runs.get(f.piece.candidate);if(l)l.push(f);else runs.set(f.piece.candidate,[f]);
 }
 for(const list of runs.values()){
  list.sort((x,y)=>x.piece.chord-y.piece.chord||x.piece.from-y.piece.from);
  let current:DrawingPolyline|undefined;
  for(const f of list){
   const last=current?.points.at(-1);
   if(current&&current.hidden===f.hidden&&last&&Math.hypot(last[0]-f.a[0],last[1]-f.a[1])<=epsilon)current.points.push(f.b);
   else{current={points:[f.a,f.b],hidden:f.hidden};polylines.push(current);}
  }
 }
 // Drop points that lie on the line through their neighbours (an edge-on circle is a line).
 for(const line of polylines){
  const p=line.points,out=[p[0]];
  for(let i=1;i+1<p.length;i++){
   const a=out.at(-1)!,b=p[i],c=p[i+1],l=Math.hypot(c[0]-a[0],c[1]-a[1]);
   if(l>0&&Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/l<=epsilon*.01&&(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])>=0)continue;
   out.push(b);
  }
  out.push(p.at(-1)!);line.points=out;
 }
 return {segments,picks,lines:{arcs:outArcs,polylines}};
}

/** Exact size and grouped full cylindrical holes of the exactly built bodies. */
function measures(bodies:readonly ExactDrawingBody[],min:Vec3,max:Vec3){
 const holes=new Map<number,number>();
 for(const body of bodies)for(const [index,face] of body.faces.entries()){
  if(face.surface!=='cylinder'||!face.axis||!face.radius)continue;
  const foot=add(face.axis.origin,norm(face.axis.direction),dot(sub(face.point,face.axis.origin),norm(face.axis.direction)));
  if(dot(sub(face.point,foot),face.normal)>=0)continue;
  if(!body.edges.some(edge=>edge.closed&&edge.circle&&edge.faces.includes(index)))continue;
  const diameter=Math.round(face.radius*2e6)/1e6;
  holes.set(diameter,(holes.get(diameter)??0)+1);
 }
 return {size:[0,1,2].map(i=>max[i]-min[i]) as Vec3,holes:[...holes].sort((a,b)=>a[0]-b[0]).map(([diameter,count])=>({diameter,count}))};
}

/**
 * The assembly's top, front and right views (and an isometric one) with lines from the exact
 * B-rep where `exact` has the body, and from the display mesh otherwise.
 */
export function projectExactAssembly(geometry:GeometryResult,exact:ExactDrawingData):ExactAssemblyProjection{
 const bodies=geometry.bodies.filter(body=>!body.reference&&!body.hole&&body.indices.length>0);
 if(!bodies.length)throw new Error(t('Add a solid body to draw the assembly.'));
 const byId=new Map(exact.bodies.map(body=>[body.id,body]));
 const failures=new Map(exact.failures.map(failure=>[failure.id,failure]));
 const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
 const grow=(lo:readonly number[],hi:readonly number[])=>{for(const i of [0,1,2]){min[i]=Math.min(min[i],lo[i]);max[i]=Math.max(max[i],hi[i]);}};
 for(const body of bodies){
  grow(body.bounds.min,body.bounds.max);
  const solid=byId.get(body.id);
  if(solid)grow(solid.bounds.min,solid.bounds.max);
 }
 const meshTriangles=bodies.reduce((sum,body)=>sum+(byId.has(body.id)?0:body.indices.length/3),0);
 if(meshTriangles>100000)throw detailError();
 const tolerance=Math.max(1e-6,...bodies.map(body=>byId.get(body.id)?.tolerance??0));
 const extent=Math.max(...[0,1,2].map(i=>max[i]-min[i]));
 const depthTolerance=Math.max(2*tolerance,extent*1e-7,1e-6),margin=2*tolerance,straightMargin=Math.max(1e-6,extent*1e-9),epsilon=Math.max(1e-4,tolerance*.5);
 const meshModels=new Map<string,ReturnType<typeof meshDrawingTopology>>();
 const occluders:Occluder[]=bodies.map(body=>{
  const solid=byId.get(body.id);
  if(solid)return exactOccluder(solid,straightMargin,margin);
  return {positions:body.positions,indices:body.indices};
 });
 const report={tessellated:0};
 const candidatesFor=(frame:Frame,countSilhouettes:boolean)=>bodies.flatMap((body,i)=>{
  const solid=byId.get(body.id);
  if(solid)return exactCandidates(solid,i,frame,countSilhouettes?report:{tessellated:0});
  let model=meshModels.get(body.id);
  if(!model){model=meshDrawingTopology(body as BodyMesh);meshModels.set(body.id,model);}
  return meshCandidates(model,i,frame);
 });
 const corners:Vec3[]=[0,1,2,3,4,5,6,7].map(k=>[k&1?max[0]:min[0],k&2?max[1]:min[1],k&4?max[2]:min[2]]);
 const bounds=(frame:Frame)=>{
  const us=corners.map(c=>dot(c,frame.u)),vs=corners.map(c=>dot(c,frame.v));
  return {offset:[Math.min(...us),Math.min(...vs)] as [number,number],extent:[Math.max(...us)-Math.min(...us),Math.max(...vs)-Math.min(...vs)] as [number,number]};
 };
 const lines:ExactViewLines[]=[];
 const views=drawingViews.map((view,index)=>{
  const frame=standardFrames[index],{offset,extent:size}=bounds(frame);
  const pieces=hiddenLines(candidatesFor(frame,true),occluders,frame,offset,size,depthTolerance,3*margin);
  const out=assemble(pieces,frame,offset,epsilon,true);
  lines.push(out.lines);
  return {view:view.view,width:size[0],height:size[1],segments:Float64Array.from(out.segments),edgePicks:Float64Array.from(out.picks)};
 });
 const {offset,extent:isoSize}=bounds(isoFrame);
 const isoOut=assemble(hiddenLines(candidatesFor(isoFrame,false),occluders,isoFrame,offset,isoSize,depthTolerance,3*margin),isoFrame,offset,epsilon,false);
 const meshBodies=bodies.filter(body=>!byId.has(body.id)).map(body=>{
  const failure=failures.get(body.id);
  return {id:body.id,name:failure?.name??body.id,reason:failure?.message??t('The exact kernel did not return this body.')};
 });
 const exactBodies=bodies.filter(body=>byId.has(body.id)).map(body=>body.id);
 const exactMin:Vec3=[Infinity,Infinity,Infinity],exactMax:Vec3=[-Infinity,-Infinity,-Infinity];
 for(const id of exactBodies){const b=byId.get(id)!.bounds;for(const i of [0,1,2]){exactMin[i]=Math.min(exactMin[i],b.min[i]);exactMax[i]=Math.max(exactMax[i],b.max[i]);}}
 const measured=exactBodies.length?measures(exactBodies.map(id=>byId.get(id)!),exactMin,exactMax):{size:[0,0,0] as Vec3,holes:[]};
 return {
  views,origin:min,bodyIds:bodies.map(body=>body.id),sourceKey:geometry.sourceKey,lines,
  iso:{width:isoSize[0],height:isoSize[1],segments:Float64Array.from(isoOut.segments),lines:isoOut.lines},
  exact:{exactBodies,meshBodies,tessellatedSilhouettes:report.tessellated,tolerance,...measured},
 };
}
