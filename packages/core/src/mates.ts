// SPDX-License-Identifier: BSD-3-Clause
// Mates (document version 51): coincident, concentric and distance relations between named faces
// of two top-level bodies (or linked instances), solved into the bodies' placements.
//
// - Faces are named as the exact backend names them for edge references (document version 44,
//   exact-edge-references.ts): `<leaf node id>:f<k>`, with pattern-copy prefixes. A linked
//   instance's faces carry its source's leaf names; the mate's body says which placement is meant.
// - The exact kernel lowers each mated body in world space with its faces named (exact operation
//   `faces`); a mate whose face no longer exists is an error naming the mate and the face, never
//   another face. Coincident and distance need planar faces, concentric faces with an axis
//   (cylinders, cones, tori, surfaces of revolution).
// - Solving: in each connected set of mated bodies the bodies with static physics stay where they
//   are, or else the first body of the set's first mate; every other body moves rigidly. A
//   constructive pass turns and shifts each body onto its first mates, then a damped Gauss-Newton
//   solve satisfies all mates together. Mates that cannot all hold are over-constrained: the
//   error names the first mate that conflicts with the ones before it. A mate that adds nothing
//   the others do not already fix is over-constrained too (it is redundant). Remaining degrees of
//   freedom are reported, not an error.
//
// Original code. The mate kinds follow the kernel lab's assembly guides; the solver is our own.
import {t} from './i18n.js';
import type {CadDocument,Transform,Vec3} from './document.js';
import {isExactFaceName,exactFaceNameIds} from './exact-edge-references.js';
import {composeRigid,rigidOf,transformOf} from './instances.js';
import type {RigidPlacement} from './instances.js';

export const MATE_DOCUMENT_VERSION=51;
export type MateKind='coincident'|'concentric'|'distance';
export const MATE_KINDS:readonly MateKind[]=Object.freeze(['coincident','concentric','distance']);
/** One face of one top-level body. */
export interface MateFace {body:string;face:string}
export interface AssemblyMate {
 id:string;
 kind:MateKind;
 a:MateFace;
 b:MateFace;
 /** `distance` only: millimetres from face a to face b along face a's outward normal. */
 distance?:number;
 /** Planar mates: the outward normals point the same way (default: against each other). */
 aligned?:true;
}
export const MATE_LIMITS={mates:500,bodies:64} as const;

const idOk=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** Refuses malformed mates (called from checkAssembly for version 51 documents). Face names are
 * checked for form only: a face an edit removed is reported when the mates are solved. */
export function checkMates(doc:CadDocument,value:unknown,fail:(why:string)=>never){
 if(doc.version<MATE_DOCUMENT_VERSION)fail(t('mates require document version 51'));
 if(!Array.isArray(value)||value.length>MATE_LIMITS.mates)fail(t('too many mates'));
 const roots=new Set(doc.roots),ids=new Set<string>();
 for(const m of value as unknown[]){
  if(!record(m)||!idOk(m.id)||ids.has(m.id)||!(MATE_KINDS as readonly unknown[]).includes(m.kind))fail(t('bad mate'));
  const mate=m as unknown as AssemblyMate;ids.add(mate.id);
  for(const key of Object.keys(m))if(!['id','kind','a','b','distance','aligned'].includes(key))fail(t`unknown mate field ${key}`);
  for(const side of [m.a,m.b])if(!record(side)||Object.keys(side).some(k=>k!=='body'&&k!=='face')||typeof side.body!=='string'||!roots.has(side.body)||!isExactFaceName(side.face))fail(t('a mate names a face of a top-level body as <node>:f<k>'));
  if(mate.a.body===mate.b.body)fail(t('a mate joins two different bodies'));
  if((mate.kind==='distance')!==(mate.distance!==undefined)||mate.distance!==undefined&&!(typeof mate.distance==='number'&&Number.isFinite(mate.distance)&&Math.abs(mate.distance)<=100000))fail(t('only a distance mate has a distance (at most 100000 mm)'));
  if(mate.aligned!==undefined&&(mate.aligned!==true||mate.kind==='concentric'))fail(t('only planar mates can be aligned'));
 }
}
/** Mates whose bodies are all top-level (the others are dropped with their body). */
export const prunedMates=(mates:readonly AssemblyMate[],roots:ReadonlySet<string>)=>mates.filter(m=>roots.has(m.a.body)&&roots.has(m.b.body));
/** Rewrites the node ids inside the face names of mates on `body` (an instance made independent). */
export function remapMateFaces(mates:readonly AssemblyMate[],body:string,map:(id:string)=>string|undefined):AssemblyMate[]{
 const face=(name:string)=>name.replace(/(^|\/)([a-zA-Z0-9][a-zA-Z0-9_-]{0,95})(?=[#:])/g,(_,lead:string,id:string)=>lead+(map(id)??id));
 return mates.map(m=>({...m,a:m.a.body===body?{...m.a,face:face(m.a.face)}:m.a,b:m.b.body===body?{...m.b,face:face(m.b.face)}:m.b}));
}
/** The leaf node a face name belongs to. */
export const mateFaceLeaf=(face:string)=>exactFaceNameIds(face).at(-1);

// --- Face geometry -------------------------------------------------------------------------------

/** One named face of a body as the exact kernel reports it, in world millimetres (exact operation
 * `faces`). Pieces of one face (split by a Boolean) are merged: the largest piece's point. */
export interface MateFaceGeometry {
 name:string;
 /** The kernel's surface kind: plane, cylinder, cone, sphere, torus, revolution, … */
 surface:string;
 area:number;
 point:Vec3;
 normal:Vec3;
 radius?:number;
 axis?:{origin:Vec3;direction:Vec3};
}
export interface MateBodyFaces {id:string;name:string;faces:readonly MateFaceGeometry[];
 /** Faces without one of our names (a fillet's round): not mateable. */
 unnamed:number}

export type MateErrorCode='stale-face'|'wrong-surface'|'over-constrained'|'redundant'|'too-many'|'unknown-body';
/** Why mates cannot be solved; `mate` is the id of the mate the message names. */
export class MateError extends Error {
 constructor(readonly code:MateErrorCode,message:string,readonly mate?:string){super(message);this.name='MateError';}
}
const planar=(f:MateFaceGeometry)=>f.surface==='plane';
const axial=(f:MateFaceGeometry)=>!!f.axis&&f.surface!=='plane'&&f.surface!=='sphere';
/** Text label of a mate: its number and kind. */
export const mateLabel=(mates:readonly AssemblyMate[],mate:AssemblyMate)=>t`Mate ${mates.indexOf(mate)+1} (${t(mate.kind)})`;

// --- Small linear algebra -----------------------------------------------------------------------

type V=[number,number,number];
type M3=[number,number,number,number,number,number,number,number,number];
const dot=(a:readonly number[],b:readonly number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:readonly number[],b:readonly number[]):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a:readonly number[],b:readonly number[]):V=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a:readonly number[],b:readonly number[]):V=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const scale=(a:readonly number[],s:number):V=>[a[0]*s,a[1]*s,a[2]*s];
const norm=(a:readonly number[])=>Math.hypot(a[0],a[1],a[2]);
const unit=(a:readonly number[]):V=>{const n=norm(a);return n>1e-15?scale(a,1/n):[0,0,0];};
const apply=(m:M3,v:readonly number[]):V=>[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
const mul=(a:M3,b:M3):M3=>{const o=new Array(9).fill(0) as M3;for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)o[i*3+j]+=a[i*3+k]*b[k*3+j];return o;};
const IDENTITY:M3=[1,0,0,0,1,0,0,0,1];
/** Rotation by angle |w| about w (Rodrigues). */
function rotationVector(w:readonly number[]):M3{
 const angle=norm(w);if(angle<1e-15)return [1,-w[2],w[1],w[2],1,-w[0],-w[1],w[0],1];
 const [x,y,z]=scale(w,1/angle),c=Math.cos(angle),s=Math.sin(angle),k=1-c;
 return [c+x*x*k,x*y*k-z*s,x*z*k+y*s,y*x*k+z*s,c+y*y*k,y*z*k-x*s,z*x*k-y*s,z*y*k+x*s,c+z*z*k];
}
/** The smallest rotation turning unit `from` onto unit `to` (half a turn about a perpendicular when opposite). */
function rotationBetween(from:V,to:V):M3{
 const c=dot(from,to),axis=cross(from,to),s=norm(axis);
 if(s<1e-12){
  if(c>0)return IDENTITY;
  const helper:V=Math.abs(from[0])<.9?[1,0,0]:[0,1,0];
  return rotationVector(scale(unit(cross(from,helper)),Math.PI));
 }
 return rotationVector(scale(axis,Math.atan2(s,c)/s));
}
/** Solves A x = b (n × n, row-major) by Gaussian elimination with partial pivoting. */
function solveLinear(A:Float64Array,b:Float64Array,n:number):Float64Array|undefined{
 const a=Float64Array.from(A),x=Float64Array.from(b);
 for(let col=0;col<n;col++){
  let pivot=col,best=Math.abs(a[col*n+col]);
  for(let r=col+1;r<n;r++){const v=Math.abs(a[r*n+col]);if(v>best){best=v;pivot=r;}}
  if(!(best>1e-300))return undefined;
  if(pivot!==col){for(let c=0;c<n;c++){const tmp=a[col*n+c];a[col*n+c]=a[pivot*n+c];a[pivot*n+c]=tmp;}const tmp=x[col];x[col]=x[pivot];x[pivot]=tmp;}
  const inv=1/a[col*n+col];
  for(let r=col+1;r<n;r++){const f=a[r*n+col]*inv;if(!f)continue;for(let c=col;c<n;c++)a[r*n+c]-=f*a[col*n+c];x[r]-=f*x[col];}
 }
 for(let r=n-1;r>=0;r--){let s=x[r];for(let c=r+1;c<n;c++)s-=a[r*n+c]*x[c];x[r]=s/a[r*n+r];}
 return x;
}

// --- Solving --------------------------------------------------------------------------------------

/** A face's frame on the body that carries it, moved with the body during the solve. */
interface Frame {point:V;dir:V}
interface Prepared {mate:AssemblyMate;fa:Frame;fb:Frame;kind:'plane'|'axis';sign:1|-1;distance:number}
export interface MateSolution {
 /** New transforms of the bodies the mates move (bodies already in place are left out). */
 placements:{id:string;transform:Transform}[];
 /** Bodies that stayed where they were (one per connected set of mated bodies, or static ones). */
 grounded:string[];
 /** Degrees of freedom the mates leave (0: every moved body is fully placed). */
 freedom:number;
 /** Largest remaining mate error (mm or, for directions, the sine of the angle). */
 residual:number;
}
const TOLERANCE=1e-7;

/**
 * Places the bodies so that every mate holds (see the module header). `faces` holds each mated
 * body's named faces in world space at its current placement. Throws MateError for a stale face,
 * a face of the wrong kind, or over-constrained mates; nothing is moved then.
 */
export function solveMates(doc:CadDocument,mates:readonly AssemblyMate[],faces:readonly MateBodyFaces[]):MateSolution{
 if(!mates.length)return {placements:[],grounded:[],freedom:0,residual:0};
 const bodyFaces=new Map(faces.map(b=>[b.id,b]));
 const name=(id:string)=>doc.nodes[id]?.name??id;
 const bodies=[...new Set(mates.flatMap(m=>[m.a.body,m.b.body]))];
 if(bodies.length>MATE_LIMITS.bodies)throw new MateError('too-many',t`Mates are limited to ${MATE_LIMITS.bodies} bodies.`);
 const lookup=(mate:AssemblyMate,side:MateFace)=>{
  if(!doc.roots.includes(side.body))throw new MateError('unknown-body',t`${mateLabel(mates,mate)}: ${name(side.body)} is not a top-level body.`,mate.id);
  const face=bodyFaces.get(side.body)?.faces.find(f=>f.name===side.face);
  if(!face)throw new MateError('stale-face',t`${mateLabel(mates,mate)}: ${name(side.body)} has no face ${side.face} any more (an upstream change removed it). Choose the face again or delete the mate; nothing was moved.`,mate.id);
  return face;
 };
 const prepared:Prepared[]=mates.map(mate=>{
  const fa=lookup(mate,mate.a),fb=lookup(mate,mate.b);
  if(mate.kind==='concentric'){
   for(const [f,side] of [[fa,mate.a],[fb,mate.b]] as const)if(!axial(f))throw new MateError('wrong-surface',t`${mateLabel(mates,mate)}: face ${side.face} of ${name(side.body)} is a ${f.surface}, not a face with an axis (cylinder, cone).`,mate.id);
   return {mate,kind:'axis',sign:1,distance:0,fa:{point:[...fa.axis!.origin] as V,dir:unit(fa.axis!.direction)},fb:{point:[...fb.axis!.origin] as V,dir:unit(fb.axis!.direction)}};
  }
  for(const [f,side] of [[fa,mate.a],[fb,mate.b]] as const)if(!planar(f))throw new MateError('wrong-surface',t`${mateLabel(mates,mate)}: face ${side.face} of ${name(side.body)} is a ${f.surface}, not a plane.`,mate.id);
  return {mate,kind:'plane',sign:mate.aligned?-1:1,distance:mate.kind==='distance'?mate.distance!:0,fa:{point:[...fa.point] as V,dir:unit(fa.normal)},fb:{point:[...fb.point] as V,dir:unit(fb.normal)}};
 });
 // Connected sets of mated bodies, each with its grounded bodies.
 const parent=new Map(bodies.map(b=>[b,b])),find=(b:string):string=>{let r=b;while(parent.get(r)!==r)r=parent.get(r)!;parent.set(b,r);return r;};
 for(const m of mates)parent.set(find(m.a.body),find(m.b.body));
 const grounded=new Set<string>();
 for(const b of bodies)if(doc.nodes[b].physics?.motion==='static')grounded.add(b);
 for(const m of mates){const root=find(m.a.body);if(![...grounded].some(g=>find(g)===root))grounded.add(m.a.body);}
 const run=(list:readonly Prepared[])=>solvePrepared(list,bodies,grounded);
 const result=run(prepared);
 if(result.residual>TOLERANCE){
  // Name the first mate that cannot hold together with the ones before it.
  for(let k=1;k<=prepared.length;k++){
   const prefix=run(prepared.slice(0,k));
   if(prefix.residual>TOLERANCE){const m=prepared[k-1].mate;throw new MateError('over-constrained',t`${mateLabel(mates,m)} conflicts with the mates before it: they cannot all hold (over-constrained; ${+prefix.residual.toFixed(4)} left). Delete or change one of them; nothing was moved.`,m.id);}
  }
  throw new MateError('over-constrained',t`The mates cannot all hold (over-constrained; ${+result.residual.toFixed(4)} left). Nothing was moved.`);
 }
 if(result.redundant){const m=result.redundant;throw new MateError('redundant',t`${mateLabel(mates,m)} adds nothing the other mates do not already fix (over-constrained). Delete it; nothing was moved.`,m.id);}
 const placements:{id:string;transform:Transform}[]=[];
 for(const [id,motion] of result.motions){
  // Bodies that already sat where the mates want them (to solver precision) are left as they are.
  const node=doc.nodes[id],before=rigidOf(node.transform),after=composeRigid(motion,before);
  if(after.rotation.every((v,i)=>Math.abs(v-before.rotation[i])<1e-9)&&after.translation.every((v,i)=>Math.abs(v-before.translation[i])<1e-7))continue;
  placements.push({id,transform:transformOf(after,node.transform.scale)});
 }
 return {placements,grounded:bodies.filter(b=>grounded.has(b)),freedom:result.freedom,residual:result.residual};
}

function solvePrepared(input:readonly Prepared[],bodies:readonly string[],grounded:ReadonlySet<string>){
 const list=input.map(p=>({...p,fa:{point:[...p.fa.point] as V,dir:[...p.fa.dir] as V},fb:{point:[...p.fb.point] as V,dir:[...p.fb.dir] as V}}));
 const involved=new Set(list.flatMap(p=>[p.mate.a.body,p.mate.b.body]));
 const movable=bodies.filter(b=>involved.has(b)&&!grounded.has(b));
 const motions=new Map<string,RigidPlacement>(movable.map(b=>[b,{rotation:[...IDENTITY] as M3,translation:[0,0,0]}]));
 // Rigidly move every frame of `body` by rotation R about c, then by τ (and record it).
 const move=(body:string,R:M3,c:V,tau:V)=>{
  for(const p of list)for(const [side,frame] of [[p.mate.a,p.fa],[p.mate.b,p.fb]] as const){
   if(side.body!==body)continue;
   const q=add(add(apply(R,sub(frame.point,c)),c),tau);frame.point[0]=q[0];frame.point[1]=q[1];frame.point[2]=q[2];
   const d=unit(apply(R,frame.dir));frame.dir[0]=d[0];frame.dir[1]=d[1];frame.dir[2]=d[2];
  }
  const step:RigidPlacement={rotation:R,translation:add(sub(c,apply(R,c)),tau)};
  motions.set(body,composeRigid(step,motions.get(body)!));
 };
 const centre=(body:string):V=>{const pts=list.flatMap(p=>[...(p.mate.a.body===body?[p.fa.point]:[]),...(p.mate.b.body===body?[p.fb.point]:[])]);return pts.length?scale(pts.reduce((s,q)=>add(s,q),[0,0,0] as V),1/pts.length):[0,0,0];};
 // Constructive pass: each body, once reached from a placed one, is turned and shifted onto the
 // mates it has with placed bodies.
 const placed=new Set(grounded);
 for(let progress=true;progress;){
  progress=false;
  for(const body of movable){
   if(placed.has(body))continue;
   const links=list.filter(p=>p.mate.a.body===body&&placed.has(p.mate.b.body)||p.mate.b.body===body&&placed.has(p.mate.a.body));
   if(!links.length)continue;
   const oriented=links.map(p=>{const moving=p.mate.b.body===body?p.fb:p.fa,fixed=p.mate.b.body===body?p.fa:p.fb;return {p,moving,fixed};});
   const c=centre(body);
   // Directions: a planar mate wants the moving normal at −sign × the fixed one; an axis either way.
   const target=(o:typeof oriented[number],current:V):V=>o.p.kind==='plane'?scale(o.fixed.dir,-o.p.sign):(dot(current,o.fixed.dir)>=0?o.fixed.dir:scale(o.fixed.dir,-1));
   const first=oriented[0],R1=rotationBetween(first.moving.dir,target(first,first.moving.dir)),w1=target(first,first.moving.dir);
   let R=R1;
   for(const o of oriented.slice(1)){
    const v=apply(R,o.moving.dir),w=target(o,v),vp=sub(v,scale(w1,dot(v,w1))),wp=sub(w,scale(w1,dot(w,w1)));
    if(norm(vp)<1e-6||norm(wp)<1e-6)continue;
    const angle=Math.atan2(dot(cross(unit(vp),unit(wp)),w1),dot(unit(vp),unit(wp)));
    R=mul(rotationVector(scale(w1,angle)),R);break;
   }
   move(body,R,c,[0,0,0]);
   // Shift: least squares over the linear position conditions, smallest move for free directions.
   const rows:{a:V;b:number}[]=[];
   for(const o of oriented){
    if(o.p.kind==='plane'){
     // The distance runs from face a to face b along a's normal; b's normal is −sign × a's.
     const n=o.fixed.dir;
     if(o.moving===o.p.fb)rows.push({a:n,b:o.p.distance-dot(sub(o.moving.point,o.fixed.point),n)});
     else rows.push({a:n,b:dot(sub(o.fixed.point,o.moving.point),n)+o.p.sign*o.p.distance});
    }else{
     const d=o.fixed.dir,helper:V=Math.abs(d[0])<.9?[1,0,0]:[0,1,0],u=unit(cross(d,helper)),w=cross(d,u),off=sub(o.moving.point,o.fixed.point);
     rows.push({a:u,b:-dot(off,u)},{a:w,b:-dot(off,w)});
    }
   }
   const AtA=new Float64Array(9),Atb=new Float64Array(3);
   for(const r of rows)for(let i=0;i<3;i++){Atb[i]+=r.a[i]*r.b;for(let j=0;j<3;j++)AtA[i*3+j]+=r.a[i]*r.a[j];}
   const ridge=1e-10*(AtA[0]+AtA[4]+AtA[8]+1);for(let i=0;i<3;i++)AtA[i*4]+=ridge;
   const tau=solveLinear(AtA,Atb,3);
   if(tau)move(body,IDENTITY,[0,0,0],[tau[0],tau[1],tau[2]]);
   placed.add(body);progress=true;
  }
 }
 // Residuals of every mate with the movable bodies moved by x (6 values each: rotation vector about
 // the body's centre, then translation).
 const index=new Map(movable.map((b,i)=>[b,i])),centres=new Map(movable.map(b=>[b,centre(b)]));
 const rowsOf=(p:Prepared)=>p.kind==='plane'?4:6;
 const m=list.reduce((s,p)=>s+rowsOf(p),0),n=6*movable.length;
 const framed=(body:string,frame:Frame,x:Float64Array,point:boolean):V=>{
  const i=index.get(body);if(i===undefined)return point?frame.point:frame.dir;
  const R=rotationVector([x[6*i],x[6*i+1],x[6*i+2]]),c=centres.get(body)!;
  return point?add(add(apply(R,sub(frame.point,c)),c),[x[6*i+3],x[6*i+4],x[6*i+5]]):apply(R,frame.dir);
 };
 const mateResidual=(p:Prepared,x:Float64Array,out:Float64Array,at:number)=>{
  const pa=framed(p.mate.a.body,p.fa,x,true),da=framed(p.mate.a.body,p.fa,x,false),pb=framed(p.mate.b.body,p.fb,x,true),db=framed(p.mate.b.body,p.fb,x,false);
  if(p.kind==='plane'){const s=add(da,scale(db,p.sign));out[at]=s[0];out[at+1]=s[1];out[at+2]=s[2];out[at+3]=dot(sub(pb,pa),da)-p.distance;}
  else{const c1=cross(da,db),c2=cross(sub(pb,pa),da);out[at]=c1[0];out[at+1]=c1[1];out[at+2]=c1[2];out[at+3]=c2[0];out[at+4]=c2[1];out[at+5]=c2[2];}
 };
 const residual=(x:Float64Array)=>{const out=new Float64Array(m);let at=0;for(const p of list){mateResidual(p,x,out,at);at+=rowsOf(p);}return out;};
 const jacobian=(x:Float64Array)=>{
  const J=new Float64Array(m*n),h=1e-6,plus=Float64Array.from(x),minus=Float64Array.from(x);
  for(let col=0;col<n;col++){
   const body=movable[Math.floor(col/6)];
   plus[col]=x[col]+h;minus[col]=x[col]-h;
   let at=0;
   for(const p of list){
    const rows=rowsOf(p);
    if(p.mate.a.body===body||p.mate.b.body===body){
     const rp=new Float64Array(rows),rm=new Float64Array(rows);mateResidual(p,plus,rp,0);mateResidual(p,minus,rm,0);
     for(let r=0;r<rows;r++)J[(at+r)*n+col]=(rp[r]-rm[r])/(2*h);
    }
    at+=rows;
   }
   plus[col]=x[col];minus[col]=x[col];
  }
  return J;
 };
 const zero=new Float64Array(n),sumSq=(r:Float64Array)=>r.reduce((s,v)=>s+v*v,0),maxAbs=(r:Float64Array)=>r.reduce((s,v)=>Math.max(s,Math.abs(v)),0);
 // Damped Gauss-Newton (Levenberg-Marquardt) from the constructive placement.
 let r=residual(zero),lambda=1e-3;
 for(let iteration=0;iteration<200&&n&&maxAbs(r)>TOLERANCE*1e-2;iteration++){
  const J=jacobian(zero),A=new Float64Array(n*n),g=new Float64Array(n);
  for(let i=0;i<m;i++){const ri=r[i];if(!ri&&!J.subarray(i*n,(i+1)*n).some(Boolean))continue;for(let a=0;a<n;a++){const ja=J[i*n+a];if(!ja)continue;g[a]+=ja*ri;for(let b=0;b<n;b++)A[a*n+b]+=ja*J[i*n+b];}}
  let improved=false;
  for(let attempt=0;attempt<20&&!improved;attempt++){
   const D=Float64Array.from(A);for(let i=0;i<n;i++)D[i*n+i]+=lambda*(A[i*n+i]+1e-9);
   const step=solveLinear(D,g.map(v=>-v),n);
   if(!step){lambda*=10;continue;}
   const next=residual(step);
   if(sumSq(next)<sumSq(r)){
    for(const body of movable){const i=index.get(body)!,c=centres.get(body)!;move(body,rotationVector([step[6*i],step[6*i+1],step[6*i+2]]),c,[step[6*i+3],step[6*i+4],step[6*i+5]]);centres.set(body,centre(body));}
    r=residual(zero);lambda=Math.max(1e-12,lambda/3);improved=true;
   }else lambda*=4;
  }
  if(!improved)break;
 }
 // Rank of the conditions at the solution: redundancy per mate and the freedom left.
 const J=jacobian(zero),basis:Float64Array[]=[];let redundant:AssemblyMate|undefined,at=0;
 for(const p of list){
  let added=0;
  for(let row=0;row<rowsOf(p);row++){
   const v=Float64Array.from(J.subarray((at+row)*n,(at+row+1)*n)),length=Math.sqrt(sumSq(v));
   if(length<1e-9)continue;
   for(const b of basis){let d=0;for(let i=0;i<n;i++)d+=v[i]*b[i];for(let i=0;i<n;i++)v[i]-=d*b[i];}
   const rest=Math.sqrt(sumSq(v));
   if(rest>1e-6*length){for(let i=0;i<n;i++)v[i]/=rest;basis.push(v);added++;}
  }
  if(!added&&!redundant)redundant=p.mate;
  at+=rowsOf(p);
 }
 return {motions,residual:maxAbs(r),freedom:n-basis.length,redundant};
}

/** Text for a solve (the mate command's output). */
export function formatMateSolution(doc:CadDocument,mates:readonly AssemblyMate[],solution:MateSolution):string{
 const name=(id:string)=>doc.nodes[id]?.name??id;
 const lines=[t`${mates.length} mates hold; ${solution.placements.length} bodies moved${solution.placements.length?`: ${solution.placements.map(p=>name(p.id)).join(', ')}`:''}.`];
 if(solution.grounded.length)lines.push(t`Stayed in place: ${solution.grounded.map(name).join(', ')}.`);
 lines.push(solution.freedom?t`${solution.freedom} degrees of freedom are left (the mates do not fix every moved body completely).`:t('Every moved body is fully placed.'));
 return lines.join('\n');
}
/** Text listing of the mates. */
export function listMates(doc:CadDocument):string{
 const mates=doc.assembly?.mates??[];
 if(!mates.length)return t('No mates. Add one with mate coincident|concentric|distance; list a body\'s faces with mate faces "body".');
 const name=(id:string)=>doc.nodes[id]?.name??id;
 return mates.map((m,i)=>`${i+1}. ${t(m.kind)}${m.kind==='distance'?` ${+m.distance!.toFixed(6)} mm`:''}${m.aligned?t(' (aligned)'):''}: ${name(m.a.body)} ${m.a.face} – ${name(m.b.body)} ${m.b.face}  ${m.id}`).join('\n');
}

/** The mateable faces of a body, numbered as `mate` accepts them (1-based, in kernel order). */
export function formatMateFaces(body:MateBodyFaces):string{
 const point=(p:readonly number[])=>`[${p.map(v=>+v.toFixed(4)).join(', ')}]`;
 return [t`${body.name} (${body.id}): ${body.faces.length} faces${body.unnamed?t`, ${body.unnamed} without a stable name`:''}`,...body.faces.map((f,i)=>`  ${i+1}: ${f.name} · ${f.surface} · ${+f.area.toFixed(3)} mm² · ${f.axis?t`axis ${point(f.axis.origin)} ${point(f.axis.direction)}`:t`normal ${point(f.normal)} at ${point(f.point)}`}`)].join('\n');
}
