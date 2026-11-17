// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import type { CadDocument, Vec3 } from './document.js';
export interface PartPhysics {
  version: 1;
  motion: 'dynamic' | 'static';
  densityKgM3: number;
  friction: number;
  restitution: number;
  intent: 'rigid' | 'hinge' | 'spring' | 'snap-fit' | 'thread' | 'gear' | 'belt' | 'face-coupling' | 'sliding-fit';
  /** Mechanical intent is not a qualification claim. Solver coupling requires an explicit mate. */
  parameters?: Record<string, number>;
  sourcePreset?: string;
  material?:string;
  initialVelocityMmS?:Vec3;
  initialAngularVelocityDps?:Vec3;
  /** Candidate convex pieces only. Runtime qualification against the current mesh is mandatory. */
  collisionAssembly?: {positions:number[];indices:number[]}[];
  /** annular-grid stores outer/inner rows per section; closed=false is an
   * open sweep with capped ends, not an open solid mesh. Hints still require
   * actual-geometry qualification and never confer simulation authority. */
  collisionHint?: {kind:'tube-grid'|'radial-profile'|'annular-grid';segments:number;sides:number;layout:'rows'|'columns';closed:boolean;seam?:boolean;stride?:number};
}
export interface CadJoint {
  id: string;
  kind: 'hinge' | 'fixed' | 'slider' | 'pivot';
  /** false: adjacent rigid links do not collide; other contacts remain active.
   * Undefined retains the original mated-part exclusion behavior. */
  collideConnected?:boolean;
  bodyA: string;
  bodyB: string;
  /** Anchors and axes in each root body's untransformed millimetre coordinates. */
  anchorA: Vec3; anchorB: Vec3; axisA: Vec3; axisB: Vec3;
  limits?: [number, number]; // hinge: radians; slider: millimetres
  coneAngle?:number; // pivot cone half-angle, radians
  /** Stable program address, independent of joint order and body display names. */
  control?: {port:string};
}
export function allocateMotorPort(joints:readonly CadJoint[]):string{const used=new Set(joints.flatMap(j=>j.control?[j.control.port]:[]));for(let i=0;i<2001;i++){const port=i<26?String.fromCharCode(65+i):`M${i+1}`;if(!used.has(port))return port;}throw new Error(t('No free CAD motor port'));}
export const defaultPartPhysics = (): PartPhysics => ({version:1,motion:'dynamic',densityKgM3:1050,friction:.4,restitution:.05,intent:'rigid'});
export function checkPhysics(doc: CadDocument) {
 const number=(x:unknown,lo:number,hi:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=lo&&x<=hi;
 const vector=(x:unknown):x is Vec3=>Array.isArray(x)&&x.length===3&&x.every(v=>number(v,-1e6,1e6));
 const fail=(why:string):never=>{throw new Error(t`Invalid CAD physics: ${why}`);};
 for(const node of Object.values(doc.nodes)) {
  if(node.kind==='boolean'&&!node.reference&&node.inputs.some(id=>doc.nodes[id].reference))fail(t('reference helpers cannot become printable operands'));
  if(node.reference!==undefined&&typeof node.reference!=='boolean')fail(t('bad reference flag'));
  const p=node.physics;if(p===undefined)continue;
  if(!p||p.version!==1||!['dynamic','static'].includes(p.motion)||!number(p.densityKgM3,1,30000)||!number(p.friction,0,2)||!number(p.restitution,0,1)||!['rigid','hinge','spring','snap-fit','thread','gear','belt','face-coupling','sliding-fit'].includes(p.intent))fail(t`bad body properties on ${node.id}`);
  if(p.material!==undefined&&(!['plastic','wood','steel','rubber','ice','foam','custom'].includes(p.material)))fail(t('Unknown material preset'));
  if(doc.version<8&&(p.initialVelocityMmS!==undefined||p.initialAngularVelocityDps!==undefined))fail(t('Initial velocity requires project version 8'));
  for(const [value,max]of [[p.initialVelocityMmS,10000],[p.initialAngularVelocityDps,720]] as const)if(value!==undefined&&(!vector(value)||value.some(v=>Math.abs(v)>max)))fail(t('Invalid initial body velocity'));
  if(p.parameters!==undefined&&(!p.parameters||typeof p.parameters!=='object'||Array.isArray(p.parameters)||Object.keys(p.parameters).length>30||!Object.entries(p.parameters).every(([key,value])=>/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)&&number(value,-1e9,1e9))))fail(t('bad mechanical parameters'));
  if(p.sourcePreset!==undefined&&(typeof p.sourcePreset!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(p.sourcePreset)))fail(t('bad preset provenance'));
  if(p.collisionAssembly!==undefined){const pieces=p.collisionAssembly;if(!Array.isArray(pieces)||!pieces.length||pieces.length>2048||pieces.some(piece=>!piece||!Array.isArray(piece.positions)||piece.positions.length<12||piece.positions.length>192||piece.positions.length%3||!piece.positions.every(v=>number(v,-1e6,1e6))||!Array.isArray(piece.indices)||piece.indices.length<12||piece.indices.length>384||piece.indices.length%3||!piece.indices.every(i=>Number.isInteger(i)&&i>=0&&i<piece.positions.length/3)))fail(t('Invalid collision assembly'));}
  if(p.collisionHint!==undefined){
   const h=p.collisionHint,annular=h?.kind==='annular-grid';
   if(node.kind!=='mesh'||!h||!['tube-grid','radial-profile','annular-grid'].includes(h.kind)||!Number.isInteger(h.segments)||!number(h.segments,annular?1:3,annular?64:h.kind==='tube-grid'?4096:1024)||!Number.isInteger(h.sides)||!number(h.sides,3,h.kind==='tube-grid'?64:256)||!['rows','columns'].includes(h.layout)||typeof h.closed!=='boolean'||h.seam!==undefined&&typeof h.seam!=='boolean'||h.stride!==undefined&&(!Number.isInteger(h.stride)||!number(h.stride,1,8))||annular&&(h.layout!=='rows'||h.closed||h.seam===false||h.stride!==undefined)||node.positions.length<(annular?2:1)*((h.segments+1)*(h.sides+(h.seam===false?0:1)))*3)fail(t('bad collision hint'));
  }
 }
 if(doc.joints===undefined)return;
 if(!Array.isArray(doc.joints)||doc.joints.length>2000)fail(t('bad joint list'));const ids=new Set<string>(),ports=new Set<string>();
 for(const j of doc.joints){if(!j||typeof j.id!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(j.id)||ids.has(j.id)||!['hinge','fixed','slider','pivot'].includes(j.kind)||(['slider','pivot'].includes(j.kind)&&doc.version<8)||j.bodyA===j.bodyB||![j.bodyA,j.bodyB].every(id=>doc.roots.includes(id)&&!doc.nodes[id].reference&&doc.nodes[id].role!=='hole')||![j.anchorA,j.anchorB,j.axisA,j.axisB].every(vector)||Math.abs(Math.hypot(...j.axisA)-1)>1e-5||Math.abs(Math.hypot(...j.axisB)-1)>1e-5||j.limits!==undefined&&(!Array.isArray(j.limits)||j.limits.length!==2||!['hinge','slider'].includes(j.kind)||!j.limits.every(v=>number(v,j.kind==='slider'?-100000:-Math.PI*2,j.kind==='slider'?100000:Math.PI*2))||j.limits[0]>j.limits[1]))fail(t('bad joint'));if(j.collideConnected!==undefined&&typeof j.collideConnected!=='boolean')fail(t('Invalid connected-link collision setting'));if(j.coneAngle!==undefined&&(j.kind!=='pivot'||!number(j.coneAngle,0,Math.PI)))fail(t('Invalid pivot cone angle'));ids.add(j.id);if(j.control!==undefined){if(!['hinge','slider'].includes(j.kind)||!j.control||typeof j.control.port!=='string'||!/^[A-Z][A-Z0-9_-]{0,15}$/.test(j.control.port)||ports.has(j.control.port))fail(t('Invalid or duplicate CAD motor port'));ports.add(j.control.port);}}
}
