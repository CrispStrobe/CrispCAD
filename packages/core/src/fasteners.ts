// SPDX-License-Identifier: BSD-3-Clause
// Hole-driven fastening (convergence Phase 6.2): standard holes as `hole` nodes (document version
// 47), standard parts from the ISO tables in fastener-tables.ts, and the plan that places a
// fastener stack in a hole. Original code; design after the kernel lab's hole-driven-fastening,
// metric-clearance-holes and standard-parts-library guides.
//
// A hole node is a cutter in its own frame: the mouth is the origin, the hole runs along -Z into
// the material. Manifold and the exact kernel both revolve the same profile (`holeProfile`), so the
// exact solid has true cylinders and cones and the display mesh has the same outline.
import {t} from './i18n.js';
import type {CadDocument,SolidNode,Transform,Vec3} from './document.js';
import {identityTransform,newId} from './document.js';
import type {GeneratorRecipe} from './generators.js';
import {CLEARANCE_FITS,COUNTERBORE_4762,EXTERNAL_THREAD_DEPTH,HEAT_SET_INSERTS,HEAT_SET_POCKET_EXTRA,ISO_10642,ISO_4017,ISO_4026,ISO_4032,ISO_4762,ISO_7089,ISO_7380,METRIC_THREADS,STOCK_LENGTHS,THREADS} from './fastener-tables.js';
import type {ClearanceFit,MetricThread} from './fastener-tables.js';

export * from './fastener-tables.js';

/** The document version that introduced `hole` nodes. */
export const HOLE_DOCUMENT_VERSION=47;
/** The cutter reaches this far past the mouth (and past the far face of a through hole), so the
 * Boolean never meets a coplanar face. Part of the version-47 geometry contract. */
export const HOLE_ENTRY_MM=.2;

export const HOLE_TYPES=['clearance','tapped','counterbore','countersink','heat-set'] as const;
export type HoleType=typeof HOLE_TYPES[number];
export interface HoleStandard {type:HoleType;thread:MetricThread;fit?:ClearanceFit}
/** The geometry of a `hole` node. The resolved dimensions are stored, so a later table change
 * never moves saved geometry; `standard` says what they were made from. */
export interface HoleFeature {
 kind:'hole';
 holeVersion:1;
 standard:HoleStandard;
 /** Bore diameter (clearance, tap drill or insert pocket), mm. */
 diameter:number;
 /** Material depth from the mouth, mm (for a through hole, the material thickness). */
 depth:number;
 through?:true;
 counterbore?:{diameter:number;depth:number};
 countersink?:{diameter:number;angle:number};
 /** Display resolution only (the exact kernel builds true circles). */
 segments:number;
}

const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const isThread=(v:unknown):v is MetricThread=>typeof v==='string'&&(METRIC_THREADS as readonly string[]).includes(v);
/** Depth of the countersink cone below the mouth. */
export const countersinkDepth=(h:Pick<HoleFeature,'diameter'|'countersink'>)=>h.countersink?(h.countersink.diameter-h.diameter)/2/Math.tan(h.countersink.angle*Math.PI/360):0;
/** Depth of the seat (counterbore or countersink) below the mouth. */
export const seatDepth=(h:Pick<HoleFeature,'diameter'|'counterbore'|'countersink'>)=>h.counterbore?h.counterbore.depth:countersinkDepth(h);

/** Structural check of a `hole` node (document.ts calls it for kind `hole`). */
export function checkHoleShape(raw:Record<string,unknown>,version:number):boolean{
 if(version<HOLE_DOCUMENT_VERSION||raw.holeVersion!==1||raw.role!=='hole')return false;
 const s=raw.standard as Record<string,unknown>|undefined;
 if(!s||typeof s!=='object'||!(HOLE_TYPES as readonly string[]).includes(String(s.type))||!isThread(s.thread)||s.fit!==undefined&&!(CLEARANCE_FITS as readonly string[]).includes(String(s.fit)))return false;
 if(Object.keys(s).some(key=>!['type','thread','fit'].includes(key)))return false;
 if(!finite(raw.diameter,.1,200)||!finite(raw.depth,.1,2000)||raw.through!==undefined&&raw.through!==true||!Number.isInteger(raw.segments)||!finite(raw.segments,12,256))return false;
 const cb=raw.counterbore as {diameter?:unknown;depth?:unknown}|undefined,cs=raw.countersink as {diameter?:unknown;angle?:unknown}|undefined;
 if(cb!==undefined&&cs!==undefined)return false;
 if(cb!==undefined&&(!cb||!finite(cb.diameter,(raw.diameter as number)+.01,400)||!finite(cb.depth,.01,(raw.depth as number)-.01)||Object.keys(cb).length!==2))return false;
 if(cs!==undefined&&(!cs||!finite(cs.diameter,(raw.diameter as number)+.01,400)||!finite(cs.angle,60,120)||Object.keys(cs).length!==2))return false;
 if(cs&&countersinkDepth(raw as unknown as HoleFeature)>=(raw.depth as number)-.01)return false;
 return true;
}

/** The cutter's half-section in (radius, z), counter-clockwise, mouth at z = 0, axis -Z. */
export function holeProfile(h:Pick<HoleFeature,'diameter'|'depth'|'through'|'counterbore'|'countersink'>):[number,number][]{
 const r=h.diameter/2,bottom=-(h.depth+(h.through?HOLE_ENTRY_MM:0)),top=HOLE_ENTRY_MM;
 if(h.counterbore){const R=h.counterbore.diameter/2;return [[0,bottom],[r,bottom],[r,-h.counterbore.depth],[R,-h.counterbore.depth],[R,top],[0,top]];}
 if(h.countersink){const R=h.countersink.diameter/2;return [[0,bottom],[r,bottom],[r,-countersinkDepth(h)],[R,0],[R,top],[0,top]];}
 return [[0,bottom],[r,bottom],[r,top],[0,top]];
}
/** Volume of the cutter (exact, from the profile), for tests and reports. */
export function holeCutterVolume(h:Pick<HoleFeature,'diameter'|'depth'|'through'|'counterbore'|'countersink'>):number{
 // Pappus: V = 2π ∮ r·z-area moment; for a profile of segments, sum of frustum volumes.
 const p=holeProfile(h);let v=0;
 for(let i=0;i<p.length;i++){const [r1,z1]=p[i],[r2,z2]=p[(i+1)%p.length];v+=Math.PI*(z2-z1)*(r1*r1+r1*r2+r2*r2)/3;}
 return Math.abs(v);
}

export interface HoleRequest {
 type:HoleType;thread:MetricThread;fit?:ClearanceFit;
 /** Blind depth, or the material thickness of a through hole (mm). Tapped and heat-set holes have a default. */
 depth?:number;through?:boolean;segments?:number;
}
/** Resolve a standard hole from the tables. Refuses what the tables do not cover. */
export function standardHole(request:HoleRequest):HoleFeature{
 const {type,thread}=request,row=THREADS[thread];
 if(!(HOLE_TYPES as readonly string[]).includes(type))throw new Error(t`Unknown hole type ${String(type)}; choose clearance, tapped, counterbore, countersink or heat-set.`);
 if(!row)throw new Error(t`Unknown thread ${String(thread)}; stocked threads: ${METRIC_THREADS.join(', ')}.`);
 const fit=request.fit??'normal';
 if(!(CLEARANCE_FITS as readonly string[]).includes(fit))throw new Error(t('Choose the fit close, normal or loose.'));
 const through=!!request.through,segments=request.segments??64;
 if(through&&type==='heat-set')throw new Error(t('A heat-set insert pocket is blind; give its depth instead of through.'));
 const insert=HEAT_SET_INSERTS[thread];
 if(type==='heat-set'&&!insert)throw new Error(t`No heat-set insert is stocked for ${thread}; stocked: ${Object.keys(HEAT_SET_INSERTS).join(', ')}.`);
 const depth=request.depth??(type==='heat-set'?insert!.length+HEAT_SET_POCKET_EXTRA:type==='tapped'?Math.round(row.nominal*2*10)/10:undefined);
 if(depth===undefined||!finite(depth,.1,2000))throw new Error(t('Give the hole depth, or through and the material thickness (mm).'));
 const standard:HoleStandard={type,thread,...(type==='clearance'||type==='counterbore'||type==='countersink'?{fit}:{})};
 const base={kind:'hole' as const,holeVersion:1 as const,standard,depth,...(through?{through:true as const}:{}),segments};
 if(type==='tapped')return {...base,diameter:row.tapDrill};
 if(type==='heat-set'){
  if(depth<insert!.length)throw new Error(t`The pocket for a ${thread} insert must be at least ${insert!.length} mm deep.`);
  return {...base,diameter:insert!.pocket};
 }
 const diameter=row.clearance[fit];
 if(type==='counterbore'){
  const cb=COUNTERBORE_4762[thread];
  if(depth<=cb.depth+.1)throw new Error(t`A ${thread} counterbore is ${cb.depth} mm deep; the hole must be deeper.`);
  return {...base,diameter,counterbore:{diameter:cb.diameter,depth:cb.depth}};
 }
 if(type==='countersink'){
  const head=ISO_10642[thread];
  if(!head)throw new Error(t`ISO 10642 countersunk screws are stocked for M3 to M12, not ${thread}.`);
  const hole={...base,diameter,countersink:{diameter:head.dk,angle:90}};
  if(countersinkDepth(hole)>=depth-.01)throw new Error(t`The countersink for ${thread} is ${Number(countersinkDepth(hole).toFixed(3))} mm deep; the hole must be deeper.`);
  return hole;
 }
 return {...base,diameter};
}

/** ISO 273 fit class and thread of a bore diameter (0.1 mm match, the nearest row wins). */
export function classifyClearanceBore(diameter:number):{thread:MetricThread;fit:ClearanceFit}|undefined{
 let best:{thread:MetricThread;fit:ClearanceFit}|undefined,delta=Infinity;
 for(const thread of METRIC_THREADS)for(const fit of ['normal','close','loose'] as const){
  const d=Math.abs(THREADS[thread].clearance[fit]-diameter);
  if(d<=.1+1e-9&&d<delta-1e-9){best={thread,fit};delta=d;}
 }
 return best;
}
/** The thread whose coarse tap drill a bore matches (0.02 mm), if any. */
export function tapDrillThread(diameter:number):MetricThread|undefined{
 return METRIC_THREADS.find(thread=>Math.abs(THREADS[thread].tapDrill-diameter)<=.02+1e-9);
}

/** Human summary of a hole: "M3 counterbore, normal fit, through 8 mm". */
export function describeHole(h:HoleFeature):string{
 const s=h.standard,depth=h.through?t`through ${h.depth} mm`:t`${h.depth} mm deep`;
 const kind=s.type==='clearance'?t('clearance hole'):s.type==='tapped'?t('tapped hole'):s.type==='counterbore'?t('counterbored hole'):s.type==='countersink'?t('countersunk hole'):t('heat-set insert pocket');
 return [`${s.thread} ${kind}`,...(s.fit?[s.fit==='close'?t('close fit'):s.fit==='loose'?t('loose fit'):t('normal fit')]:[]),`Ø${h.diameter}`,depth].join(', ');
}

// ---- Standard parts ----

export const PART_FAMILIES=['socket-head','button-head','countersunk','hex-bolt','set-screw','hex-nut','washer','heat-set-insert'] as const;
export type PartFamily=typeof PART_FAMILIES[number];
export type ScrewFamily='socket-head'|'button-head'|'countersunk'|'hex-bolt'|'set-screw';
export const SCREW_FAMILIES:readonly ScrewFamily[]=['socket-head','button-head','countersunk','hex-bolt','set-screw'];
export const PART_STANDARDS:Readonly<Record<PartFamily,string>>={'socket-head':'ISO 4762','button-head':'ISO 7380-1','countersunk':'ISO 10642','hex-bolt':'ISO 4017','set-screw':'ISO 4026','hex-nut':'ISO 4032','washer':'ISO 7089','heat-set-insert':'heat-set insert'};
const familyAliases:Record<string,PartFamily>={'shcs':'socket-head','iso4762':'socket-head','din912':'socket-head','bhcs':'button-head','iso7380':'button-head','flat-head':'countersunk','iso10642':'countersunk','din7991':'countersunk','hex':'hex-bolt','iso4017':'hex-bolt','din933':'hex-bolt','iso4026':'set-screw','grub':'set-screw','nut':'hex-nut','iso4032':'hex-nut','din934':'hex-nut','iso7089':'washer','din125':'washer','insert':'heat-set-insert','heat-set':'heat-set-insert'};
export function partFamily(word:string):PartFamily|undefined{
 const key=word.toLowerCase().replace(/\s+/g,'');
 return (PART_FAMILIES as readonly string[]).includes(key)?key as PartFamily:familyAliases[key];
}
/** Threads a family is stocked in. */
export function familyThreads(family:PartFamily):MetricThread[]{
 if(family==='hex-nut'||family==='washer')return [...METRIC_THREADS];
 if(family==='heat-set-insert')return METRIC_THREADS.filter(thread=>HEAT_SET_INSERTS[thread]);
 return METRIC_THREADS.filter(thread=>STOCK_LENGTHS[family][thread]);
}
export interface StandardPart {
 family:PartFamily;thread:MetricThread;
 /** Nominal length l of a screw (ISO 10642: overall, including the head). */
 length?:number;
 /** "ISO 4762 M3×10". */
 designation:string;
 /** Height of the head above the bearing plane (screws), or the part's height (nut, washer, insert). */
 height:number;
}
/** A standard part from the tables; refuses unstocked families, threads and lengths. */
export function standardPart(family:PartFamily,thread:MetricThread,length?:number):StandardPart{
 if(!(PART_FAMILIES as readonly string[]).includes(family))throw new Error(t`Unknown part family ${String(family)}; families: ${PART_FAMILIES.join(', ')}.`);
 const threads=familyThreads(family);
 if(!threads.includes(thread))throw new Error(t`${PART_STANDARDS[family]} is stocked for ${threads.join(', ')}, not ${String(thread)}.`);
 const name=(text:string)=>`${PART_STANDARDS[family]} ${text}`;
 if(family==='hex-nut')return {family,thread,designation:name(thread),height:ISO_4032[thread].m};
 if(family==='washer')return {family,thread,designation:name(`${THREADS[thread].nominal}`),height:ISO_7089[thread].h};
 if(family==='heat-set-insert'){const i=HEAT_SET_INSERTS[thread]!;return {family,thread,designation:t`Heat-set insert ${thread}×${i.length}`,height:i.length};}
 const lengths=STOCK_LENGTHS[family][thread]!;
 if(length===undefined)throw new Error(t`Give the screw length; stocked ${thread} lengths: ${lengths.join(', ')} mm.`);
 if(!lengths.includes(length))throw new Error(t`${PART_STANDARDS[family]} ${thread}×${length} is not stocked; stocked lengths: ${lengths.join(', ')} mm.`);
 const height=family==='socket-head'?ISO_4762[thread]!.k:family==='button-head'?ISO_7380[thread]!.k:family==='hex-bolt'?ISO_4017[thread]!.k:family==='countersunk'?ISO_10642[thread]!.k:0;
 return {family,thread,length,designation:name(`${thread}×${length}`),height};
}
const isScrew=(family:PartFamily):family is ScrewFamily=>(SCREW_FAMILIES as readonly string[]).includes(family);

/**
 * The screw generator recipe of a standard screw (a threaded V-thread mesh, docs/SCREW-REDESIGN.md),
 * or undefined where the generator's limits do not reach (pitch under 0.5 mm, more than 64 turns):
 * such parts are inserted as envelopes. Frame as the generator's: the bearing plane at z = 0, the
 * head above it, the shank below (for ISO 10642, z = 0 is the bottom of the head cone).
 */
export function screwRecipe(part:StandardPart):GeneratorRecipe|undefined{
 if(!isScrew(part.family)||part.length===undefined)return undefined;
 const row=THREADS[part.thread],P=row.pitch,depth=EXTERNAL_THREAD_DEPTH*P,core=row.nominal-2*depth;
 const shank=part.family==='countersunk'?part.length-part.height:part.length;
 if(P<.5||core<2||depth<.2||shank<1||shank>200||shank/P>64)return undefined;
 const head=part.family==='socket-head'?ISO_4762[part.thread]!:part.family==='button-head'?ISO_7380[part.thread]!:part.family==='countersunk'?ISO_10642[part.thread]!:undefined;
 const hex=part.family==='hex-bolt'?ISO_4017[part.thread]!:undefined,set=part.family==='set-screw'?ISO_4026[part.thread]!:undefined;
 const headDiameter=head?.dk??hex?.s??row.nominal+1,headHeight=Math.max(1,head?.k??hex?.k??1);
 const slotWidth=head?.s??set?.s??Math.max(.5,headDiameter/4);
 const recipe:GeneratorRecipe={version:2,preset:'screw',values:{diameter:core,length:shank,pitch:P,threadDepth:depth,starts:1,hand:1,headDiameter,headHeight,slotWidth},
  headStyle:part.family==='socket-head'?'cylindrical':part.family==='button-head'?'pan':part.family==='countersunk'?'countersunk':part.family==='hex-bolt'?'hex':'headless',
  driveStyle:part.family==='hex-bolt'?'none':'hex',driveDepth:head?.t??set?.t??0,headAngle:90,threadAngle:60,orientation:'head-up',rootOverlap:Math.min(.3,P*.15)};
 if(recipe.driveStyle==='none')recipe.driveDepth=.5;
 return recipe;
}

const n=(v:number)=>String(Number(v.toFixed(6)));
const hexPoints=(s:number)=>{const r=s/Math.sqrt(3);return '['+Array.from({length:6},(_,i)=>`[${n(r*Math.cos(i*Math.PI/3))},${n(r*Math.sin(i*Math.PI/3))}]`).join(',')+']';};
/** CAD Script of a part's envelope (nominal head and shank, nominal bores; no thread). Exact and
 * Manifold both build it. Same frame as `screwRecipe`; nuts, washers and inserts stand on z = 0. */
export function partEnvelopeSource(part:StandardPart):string{
 const row=THREADS[part.thread],d=row.nominal,ring=(outer:number,inner:number,h:number)=>`return subtract(move([0,0,${n(h/2)}],cylinder(${n(outer/2)},${n(h)},64)),move([0,0,${n(h/2)}],cylinder(${n(inner/2)},${n(h+1)},64)));`;
 if(part.family==='washer'){const w=ISO_7089[part.thread];return ring(w.d2,w.d1,w.h);}
 if(part.family==='heat-set-insert'){const i=HEAT_SET_INSERTS[part.thread]!;return ring(i.outer,d,i.length);}
 if(part.family==='hex-nut'){const m=ISO_4032[part.thread];return `return subtract(extrude(${n(m.m)},${hexPoints(m.s)}),move([0,0,${n(m.m/2)}],cylinder(${n(d/2)},${n(m.m+1)},64)));`;}
 const L=part.family==='countersunk'?part.length!-part.height:part.length!,shank=`move([0,0,${n(-L/2)}],cylinder(${n(d/2)},${n(L)},64))`;
 if(part.family==='set-screw'){const s=ISO_4026[part.thread]!;return `return subtract(${shank},move([0,0,${n(-s.t)}],extrude(${n(s.t+.1)},${hexPoints(s.s)})));`;}
 if(part.family==='hex-bolt'){const h=ISO_4017[part.thread]!;return `return union(extrude(${n(h.k)},${hexPoints(h.s)}),${shank});`;}
 const head=part.family==='socket-head'?ISO_4762[part.thread]!:part.family==='button-head'?ISO_7380[part.thread]!:ISO_10642[part.thread]!;
 const headSolid=part.family==='countersunk'?`move([0,0,${n(head.k/2)}],frustum(${n(d/2)},${n(head.dk/2)},${n(head.k)},64))`:`move([0,0,${n(head.k/2)}],cylinder(${n(head.dk/2)},${n(head.k)},64))`;
 return `return subtract(union(${headSolid},${shank}),move([0,0,${n(head.k-head.t)}],extrude(${n(head.t+.1)},${hexPoints(head.s)})));`;
}

export type PartDetail='threaded'|'envelope';
/** Builds a generated construction (the editor's createPresetDocument) for threaded screws. */
export type GeneratedBuilder=(recipe:GeneratorRecipe,name:string)=>CadDocument;
const PART_COLOR='#a9b0ba',INSERT_COLOR='#c9a64a';
/** One-body document fragment of a standard part in its own frame (see `screwRecipe`). */
export function standardPartFragment(part:StandardPart,options:{detail?:PartDetail;generated?:GeneratedBuilder}={}):{fragment:CadDocument;threaded:boolean}{
 const recipe=options.detail!=='envelope'&&options.generated?screwRecipe(part):undefined;
 if(recipe){
  const fragment=structuredClone(options.generated!(recipe,part.designation));
  const root=fragment.nodes[fragment.roots[0]];root.name=part.designation;root.color=PART_COLOR;
  return {fragment,threaded:true};
 }
 const id=newId();
 const node={id,kind:'code',name:part.designation,color:part.family==='heat-set-insert'?INSERT_COLOR:PART_COLOR,transform:identityTransform(),
  program:{version:1,language:'brickwright-cad-script',source:partEnvelopeSource(part),parameters:{}}} as SolidNode;
 return {fragment:{format:'brickwright-cad',version:4,units:'mm',id:newId(),title:part.designation,nodes:{[id]:node},roots:[id]},threaded:false};
}

// ---- Placement ----

type M3=[number,number,number,number,number,number,number,number,number];
/** Fixed-axis X, then Y, then Z rotation (degrees) as a row-major matrix (R = Rz·Ry·Rx). */
export function rotationMatrix(r:Vec3):M3{
 const [a,b,c]=r.map(v=>v*Math.PI/180),ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cc=Math.cos(c),sc=Math.sin(c);
 return [cc*cb,cc*sb*sa-sc*ca,cc*sb*ca+sc*sa, sc*cb,sc*sb*sa+cc*ca,sc*sb*ca-cc*sa, -sb,cb*sa,cb*ca];
}
const mul=(a:M3,b:M3):M3=>{const o=new Array(9).fill(0) as M3;for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)o[i*3+j]+=a[i*3+k]*b[k*3+j];return o;};
const apply=(m:M3,v:Vec3):Vec3=>[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
const clean=(v:number)=>Math.abs(v)<1e-9?0:Number(v.toFixed(9));
/** Fixed-axis XYZ Euler angles (degrees) of a rotation matrix. */
export function eulerFromMatrix(m:M3):Vec3{
 const sb=-m[6];
 if(Math.abs(sb)>1-1e-12){const b=Math.sign(sb)*90,c=Math.atan2(-m[1],m[4])*180/Math.PI;return [0,b,clean(c)];}
 return [clean(Math.atan2(m[7],m[8])*180/Math.PI),clean(Math.asin(sb)*180/Math.PI),clean(Math.atan2(m[3],m[0])*180/Math.PI)];
}
/** Rotation (degrees) that turns local -Z onto the unit direction `axis`. */
export function rotationForAxis(axis:Vec3):Vec3{
 const l=Math.hypot(...axis);if(!(l>1e-9))throw new Error(t('The hole axis must be a non-zero direction.'));
 const [x,y,z]=axis.map(v=>-v/l) as Vec3; // local +Z goes to -axis
 // Rotate +Z to (x,y,z): about X by a, then about Z by c: Rz(c)Rx(a)·(0,0,1) = (sin a sin c, -sin a cos c, cos a).
 const a=Math.acos(Math.max(-1,Math.min(1,z))),c=Math.hypot(x,y)<1e-12?0:Math.atan2(x,-y);
 return [clean(a*180/Math.PI),0,clean(c*180/Math.PI)];
}
export interface WorldFrame {origin:Vec3;rotation:M3}
/** World frame of a node: its transform composed with the transforms of the constructions above
 * it. Refuses scaled frames (a scaled hole no longer has its standard size). */
export function nodeWorldFrame(doc:CadDocument,id:string):WorldFrame{
 const chain:string[]=[id];
 for(let current=id;;){
  const parent=Object.values(doc.nodes).find(node=>node.kind==='boolean'&&node.inputs.includes(current)||(node.kind==='mirror'||node.kind==='pattern'||node.kind==='exact-feature')&&node.source===current);
  if(!parent)break;
  if(parent.kind!=='boolean')throw new Error(t`${doc.nodes[id].name} is inside a mirror, pattern or exact feature; fasten its holes on the source body.`);
  chain.push(parent.id);current=parent.id;
 }
 let origin:Vec3=[0,0,0],rotation:M3=[1,0,0,0,1,0,0,0,1];
 for(const key of chain){
  const tr=doc.nodes[key].transform;
  if(tr.scale.some(v=>Math.abs(v-1)>1e-9))throw new Error(t`${doc.nodes[key].name} is scaled; reset its scale to 1 before fastening.`);
  const r=rotationMatrix(tr.rotation);origin=apply(r,origin).map((v,i)=>v+tr.position[i]) as Vec3;rotation=mul(r,rotation);
 }
 return {origin,rotation};
}
/** Transform that puts a part's local frame at `z` along the hole frame (z up = out of the material). */
export function placeInFrame(frame:WorldFrame,z:number,flip=false):Transform{
 const rotation=flip?mul(frame.rotation,[1,0,0,0,-1,0,0,0,-1]):frame.rotation,offset=apply(frame.rotation,[0,0,z]);
 return {...identityTransform(),position:frame.origin.map((v,i)=>clean(v+offset[i])) as Vec3,rotation:eulerFromMatrix(rotation)};
}
export function frameFromAxis(origin:Vec3,axis:Vec3):WorldFrame{return {origin:[...origin] as Vec3,rotation:rotationMatrix(rotationForAxis(axis))};}

export type FastenMode='screw'|'bolt';
export interface FastenRequest {family?:ScrewFamily|'heat-set-insert';mode?:FastenMode;length?:number;protrusionPitches?:number}
export interface PlannedPart {part:StandardPart;z:number;role:'screw'|'head washer'|'tail washer'|'nut'|'insert'}
export interface FasteningPlan {holeId:string;hole:HoleFeature;mode:FastenMode;parts:PlannedPart[];protrusion?:number;
 /** Clamped length the screw spans (grip), mm. */
 grip?:number}
const defaultFamily=(h:HoleFeature):ScrewFamily|'heat-set-insert'=>h.standard.type==='countersink'?'countersunk':h.standard.type==='heat-set'?'heat-set-insert':h.standard.type==='clearance'&&h.through?'hex-bolt':'socket-head';

/**
 * Pick the fastener stack for one standard hole: the family the hole is made for, and in bolt mode
 * (through clearance, counterbored and countersunk holes) the shortest stocked screw that reaches
 * through head washer, grip, tail washer and nut plus `protrusionPitches` pitches (default 2); in
 * screw mode the longest stocked screw the hole takes.
 */
export function planFastening(holeId:string,h:HoleFeature,request:FastenRequest={}):FasteningPlan{
 const thread=h.standard.thread,row=THREADS[thread],family=request.family??defaultFamily(h);
 if(family==='heat-set-insert'||h.standard.type==='heat-set'){
  if(h.standard.type!=='heat-set'||family!=='heat-set-insert')throw new Error(t('Heat-set inserts go into heat-set pockets, and a heat-set pocket takes an insert.'));
  const part=standardPart('heat-set-insert',thread);
  return {holeId,hole:h,mode:'screw',parts:[{part,z:-part.height,role:'insert'}]};
 }
 if(h.standard.type==='countersink'&&family!=='countersunk')throw new Error(t('A countersunk hole takes a countersunk (ISO 10642) screw.'));
 if(h.standard.type==='counterbore'&&!['socket-head','button-head'].includes(family))throw new Error(t('A counterbored hole takes a socket or button head screw.'));
 if(h.standard.type==='tapped'&&family==='countersunk')throw new Error(t('A tapped hole has no countersink; use a socket, button or hex head screw.'));
 const mode=request.mode??(h.through&&h.standard.type!=='tapped'?'bolt':'screw');
 if(mode==='bolt'&&(!h.through||h.standard.type==='tapped'))throw new Error(t('A bolt with a nut needs a through clearance, counterbored or countersunk hole.'));
 const lengths=STOCK_LENGTHS[family][thread];
 if(!lengths)throw new Error(t`${PART_STANDARDS[family]} is not stocked for ${thread}.`);
 const washer=ISO_7089[thread],nut=ISO_4032[thread],seat=h.counterbore?h.counterbore.depth:0;
 const headWasher=mode==='bolt'&&h.standard.type==='clearance'&&family!=='set-screw';
 // Bearing plane of the head in the hole frame; ISO 10642 lengths include the head.
 const bearing=family==='countersunk'?-ISO_10642[thread]!.k:headWasher?washer.h:0-seat;
 const reachFromBearing=(bottom:number)=>bearing-bottom+(family==='countersunk'?ISO_10642[thread]!.k:0);
 let length:number;
 if(request.length!==undefined){
  if(!lengths.includes(request.length))throw new Error(t`${PART_STANDARDS[family]} ${thread}×${request.length} is not stocked; stocked lengths: ${lengths.join(', ')} mm.`);
  length=request.length;
 }else if(mode==='bolt'){
  const needed=reachFromBearing(-h.depth-washer.h-nut.m-(request.protrusionPitches??2)*row.pitch),pick=lengths.find(l=>l>=needed-1e-9);
  if(pick===undefined)throw new Error(t`No stocked ${PART_STANDARDS[family]} ${thread} screw reaches ${Number(needed.toFixed(2))} mm (longest ${lengths.at(-1)} mm).`);
  length=pick;
 }else{
  const room=reachFromBearing(-h.depth),pick=[...lengths].reverse().find(l=>l<=room+1e-9);
  if(pick===undefined)throw new Error(t`No stocked ${PART_STANDARDS[family]} ${thread} screw fits a hole ${Number(room.toFixed(2))} mm deep (shortest ${lengths[0]} mm).`);
  length=pick;
 }
 const screw=standardPart(family,thread,length),parts:PlannedPart[]=[{part:screw,z:bearing,role:'screw'}];
 const plan:FasteningPlan={holeId,hole:h,mode,parts,grip:Number((h.depth-seat).toFixed(6))};
 if(headWasher)parts.push({part:standardPart('washer',thread),z:0,role:'head washer'});
 if(mode==='bolt'){
  parts.push({part:standardPart('washer',thread),z:-h.depth-washer.h,role:'tail washer'},{part:standardPart('hex-nut',thread),z:-h.depth-washer.h-nut.m,role:'nut'});
  const tip=bearing-(family==='countersunk'?length-ISO_10642[thread]!.k:length);
  plan.protrusion=Number(((-h.depth-washer.h-nut.m)-tip).toFixed(6));
 }
 return plan;
}
