// SPDX-License-Identifier: BSD-3-Clause
// Linked instances (document version 51). An `instance` node places one more copy of a top-level
// body (its source, the part's definition) without copying its construction: the instance's
// geometry is the source's construction, scaled by the source's scale, then turned and moved by the
// instance's own rotation and position. Editing the source (its dimensions, sketch, code, features
// or parameters) changes every instance; moving or turning the source moves only the source.
//
// Rules (checkInstances): an instance is a top-level body and never an operand; its source is a
// top-level body that is not itself an instance, a reference helper or a hole; an instance has
// scale 1 (the part's scale belongs to its source), no role, no reference flag and no generator.
// When an edit leaves a source no longer top-level, the session follows the part: a fillet,
// chamfer or shell made directly on the source, or holes cut into it, become the new source (the
// instances keep their place); anything else (delete, combine, mirror…) turns its instances into
// independent copies of the source as it was, so no instance changes shape or disappears.
//
// Original code.
import {t} from './i18n.js';
import type {CadDocument,SolidNode,Transform,Vec3} from './document.js';
import {eulerFromMatrix,rotationMatrix} from './fasteners.js';
import {isSketchFeature} from './features.js';
import {isEdgeReferences,mapEdgeReferenceIds} from './exact-edge-references.js';

export const INSTANCE_DOCUMENT_VERSION=51;
/** A placement of a top-level body's construction (see the module header). */
export interface InstanceShape {kind:'instance';instanceVersion:1;source:string}
export const MAX_INSTANCES=1000;

/** Structural check of an `instance` node (document.ts calls it for kind `instance`). */
export function checkInstanceShape(raw:Record<string,unknown>,version:number,hasNode:(id:unknown)=>boolean):boolean{
 return version>=INSTANCE_DOCUMENT_VERSION&&raw.instanceVersion===1&&hasNode(raw.source)&&raw.source!==raw.id;
}
const unitScale=(transform:Transform)=>transform.scale.every(v=>v===1);
/** Graph rules for instances (after the node and root checks). */
export function checkInstances(doc:CadDocument){
 const roots=new Set(doc.roots);let count=0;
 const fail=(why:string):never=>{throw new Error(t`Invalid linked instance: ${why}`);};
 for(const node of Object.values(doc.nodes)){
  if(node.kind!=='instance')continue;
  if(++count>MAX_INSTANCES)fail(t('too many linked instances'));
  for(const key of Object.keys(node))if(!['id','name','color','transform','physics','kind','instanceVersion','source'].includes(key))fail(t`${node.name} has the field ${key}, which a linked instance cannot have`);
  if(!roots.has(node.id))fail(t`${node.name} must stay a top-level body; unlink it before combining or changing it`);
  const source=doc.nodes[node.source];
  if(!roots.has(node.source))fail(t`the source of ${node.name} must be a top-level body`);
  if(source.kind==='instance')fail(t`${node.name} is linked to another instance; link it to the part itself`);
  if(source.reference||source.role==='hole')fail(t`${node.name} is linked to a reference helper or a hole`);
  if(!unitScale(node.transform))fail(t`${node.name} is scaled; scale its source instead`);
 }
 for(const node of Object.values(doc.nodes)){
  if(node.kind==='boolean'&&node.inputs.some(id=>doc.nodes[id].kind==='instance')||(node.kind==='mirror'||node.kind==='pattern'||node.kind==='split'||node.kind==='exact-feature')&&doc.nodes[node.source].kind==='instance')
   fail(t('a linked instance cannot be an operand; unlink it first'));
 }
}
/** Construction inputs plus an instance's source: every node a node's geometry is built from. */
export function modelInputs(node:SolidNode|undefined,construction:(node:SolidNode|undefined)=>readonly string[]):readonly string[]{
 return node?.kind==='instance'?[...construction(node),node.source]:construction(node);
}
export const isInstance=(node:SolidNode|undefined):node is Extract<SolidNode,{kind:'instance'}>=>node?.kind==='instance';
/** Instances of `source` in the document, in root order. */
export const instancesOf=(doc:Pick<CadDocument,'roots'|'nodes'>,source:string)=>doc.roots.filter(id=>{const n=doc.nodes[id];return n?.kind==='instance'&&n.source===source;});

// --- Rigid placements ---------------------------------------------------------------------------

type M3=[number,number,number,number,number,number,number,number,number];
const mul=(a:M3,b:M3):M3=>{const o=new Array(9).fill(0) as M3;for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)o[i*3+j]+=a[i*3+k]*b[k*3+j];return o;};
const transpose=(m:M3):M3=>[m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]];
const apply=(m:M3,v:readonly number[]):Vec3=>[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
const tidy=(v:number)=>Math.abs(v)<1e-9?0:Number(v.toFixed(9));
/** A rigid motion (rotation matrix and translation) of world space. */
export interface RigidPlacement {rotation:M3;translation:Vec3}
/** The rigid part (rotation, position) of a transform, as a motion of the unplaced construction. */
export const rigidOf=(transform:Transform):RigidPlacement=>({rotation:rotationMatrix(transform.rotation),translation:[...transform.position] as Vec3});
export const composeRigid=(a:RigidPlacement,b:RigidPlacement):RigidPlacement=>({rotation:mul(a.rotation,b.rotation),translation:apply(a.rotation,b.translation).map((v,i)=>v+a.translation[i]) as Vec3});
export const invertRigid=(a:RigidPlacement):RigidPlacement=>{const r=transpose(a.rotation);return {rotation:r,translation:apply(r,a.translation).map(v=>-v) as Vec3};};
/** A transform with this rigid placement and the given scale. */
export const transformOf=(placement:RigidPlacement,scale:Vec3=[1,1,1]):Transform=>({position:placement.translation.map(tidy) as Vec3,rotation:eulerFromMatrix(placement.rotation),scale:[...scale] as Vec3});

/**
 * Where an instance must sit when its source `from` is replaced by `to`, a node built on `from`
 * in world space (a fillet on it, holes cut into it): `to`'s construction already contains `from`'s
 * placement, so the instance's placement is composed with the inverse of `from`'s rigid placement.
 */
export function retargetedPlacement(instance:Transform,from:Transform):Transform{
 return transformOf(composeRigid(rigidOf(instance),invertRigid(rigidOf(from))));
}

/**
 * Turns linked instance `id` of draft `d` into an independent copy of its source as `from` holds
 * it (the draft itself, or the document before an edit that removed the source): the source's
 * construction, sketches and parameter bindings are copied with new ids, the copy's root takes the
 * instance's id, name, colour, physics and placement (and the source's scale), so nothing about the
 * body's shape or place changes. Returns old → new node ids of the copied construction.
 */
export function materializeInstance(d:CadDocument,id:string,from:CadDocument,makeId:()=>string):Map<string,string>{
 const instance=d.nodes[id];
 if(instance?.kind!=='instance')throw new Error(t('Select a linked instance'));
 const sourceId=instance.source,source=from.nodes[sourceId];
 if(!source)throw new Error(t`The source of ${instance.name} no longer exists`);
 const map=new Map<string,string>(),sketches=new Map<string,string>();
 const copy=(key:string):string=>{
  const known=map.get(key);if(known)return known;
  const next=key===sourceId?id:makeId();map.set(key,next);
  const n=structuredClone(from.nodes[key]) as SolidNode;n.id=next;
  if(n.kind==='boolean')n.inputs=n.inputs.map(copy);
  if(n.kind==='mirror'||n.kind==='split'||n.kind==='pattern'||n.kind==='exact-feature')n.source=copy(n.source);
  if(n.kind==='exact-feature'&&isEdgeReferences(n.edges))n.edges=mapEdgeReferenceIds(n.edges,old=>map.get(old));
  if(isSketchFeature(n)){
   let sketchId=sketches.get(n.sketchId);
   if(!sketchId){sketchId=makeId();sketches.set(n.sketchId,sketchId);const sketch=structuredClone(from.sketches![n.sketchId]);sketch.id=sketchId;sketch.profile.id=makeId();delete sketch.artworkSourceId;delete sketch.artworkProfile;(d.sketches??={})[sketchId]=sketch;}
   n.sketchId=sketchId;
  }
  d.nodes[next]=n;return next;
 };
 copy(sourceId);
 const root=d.nodes[id] as SolidNode&Record<string,unknown>;
 root.name=instance.name;root.color=instance.color;
 if(instance.physics)root.physics=structuredClone(instance.physics);else delete root.physics;
 root.transform={position:[...instance.transform.position] as Vec3,rotation:[...instance.transform.rotation] as Vec3,scale:[...source.transform.scale] as Vec3};
 // Bindings of the copied construction follow it, except those that drive the source's placement.
 const placement=new Set(['positionX','positionY','positionZ','rotationX','rotationY','rotationZ']);
 if(d.parametric&&from.parametric)for(const b of from.parametric.bindings)if(map.has(b.nodeId)&&!(b.nodeId===sourceId&&placement.has(b.property))&&d.parametric.parameters&&!d.parametric.bindings.some(x=>x.nodeId===map.get(b.nodeId)&&x.property===b.property))d.parametric.bindings.push({...b,nodeId:map.get(b.nodeId)!});
 return map;
}
