// SPDX-License-Identifier: BSD-3-Clause
/**
 * Exact fillet, chamfer and shell (document version 41).
 *
 * The node stores the design intent (operation, size, selectors) and, as a cache, the exact
 * kernel's tessellation of the result (`display`). Manifold-only hosts display, simulate and
 * print that mesh without the kernel, but only while `display.sourceKey` equals
 * `exactFeatureKey` of the current model; otherwise evaluation fails with `stale-exact` and a
 * host that has the exact kernel recomputes it. STEP export and exact measures never use the
 * mesh: they rebuild the operation on the exact source.
 *
 * Selectors follow the kernel interface: every edge, or the edges of one planar face chosen by
 * its outward normal; shell faces are removed by outward normal. Since document version 44 a
 * fillet or chamfer may also name individual edges by stable references (exact-edge-references.ts).
 */
import {t} from './i18n.js';
import {geometrySignature} from './hash.js';
import {exactBodyKey} from './exact-body.js';
import {featureValue,FeatureEvaluationError} from './features.js';
import type {FeatureScalar} from './features.js';
import {evaluateParameters} from './parameters.js';
import type {CadDocument,SolidNode,Vec3} from './document.js';
import {EXACT_EDGE_REFERENCE_DOCUMENT_VERSION,checkEdgeReferences,isEdgeReferences,mapEdgeReferenceIds} from './exact-edge-references.js';
import type {ExactEdgeReferences} from './exact-edge-references.js';

/** The first document version that may contain `exact-feature` nodes. */
export const EXACT_FEATURE_DOCUMENT_VERSION=41;
export const EXACT_FEATURE_OPERATIONS=['fillet','chamfer','shell'] as const;
export type ExactFeatureOperation=typeof EXACT_FEATURE_OPERATIONS[number];
/** The planar face whose outward normal is `faceNormal`; with `outermost`, the matching face
 * furthest along the normal (otherwise exactly one face must match). Normals are in the
 * feature's local frame, the frame its source is placed in. */
export interface ExactFaceSelector {faceNormal:Vec3;outermost?:true}
/** Every edge, the edges of one planar face, or chosen edges by stable reference (version 44). */
export type ExactEdgeSelector='all'|ExactFaceSelector|ExactEdgeReferences;
/** Exact kernel tessellation of the result, valid only for the model it was computed from. */
export interface ExactFeatureDisplay {sourceKey:string;positions:number[];indices:number[]}
export interface ExactFeature {
 kind:'exact-feature';
 featureVersion:1;
 source:string;
 operation:ExactFeatureOperation;
 /** Fillet radius, chamfer distance or shell wall thickness (mm). */
 size:FeatureScalar;
 /** Fillet and chamfer only. */
 edges?:ExactEdgeSelector;
 /** Shell only: the faces removed (open) by the shell. */
 openFaces?:ExactFaceSelector[];
 /** Absent until a host with the exact kernel has computed it. */
 display?:ExactFeatureDisplay;
}
export type ExactFeatureSettings=Pick<ExactFeature,'operation'|'size'|'edges'|'openFaces'>;
/** Same bounds as imported `mesh` nodes. */
export const MAX_EXACT_DISPLAY_POSITIONS=750000;
export const MAX_EXACT_DISPLAY_INDICES=1500000;
export const MAX_EXACT_OPEN_FACES=6;
/** Tessellation used for display meshes: chordal tolerance (mm) and normal deviation (degrees). */
export const EXACT_DISPLAY_TOLERANCE={tolerance:.01,angleDeg:10} as const;
export const STALE_EXACT_CODE='stale-exact';

const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown,limit=1e6):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;
const sourceKeyPattern=/^\d{1,8}:\d{1,10}:\d{1,10}$/;

function checkFaceSelector(value:unknown):ExactFaceSelector{
 if(!record(value)||Object.keys(value).some(key=>key!=='faceNormal'&&key!=='outermost')||!Array.isArray(value.faceNormal)||value.faceNormal.length!==3||!value.faceNormal.every(v=>finite(v))
  ||Math.hypot(...(value.faceNormal as number[]))<1e-9||value.outermost!==undefined&&value.outermost!==true)
  throw new Error(t('Choose a face by a non-zero outward normal X,Y,Z.'));
 const n=value.faceNormal as number[],length=Math.hypot(...n);
 return {faceNormal:n.map(v=>v/length) as Vec3,...(value.outermost?{outermost:true as const}:{})};
}

/** Structural checks run during document validation (version, source, display buffers). */
export function checkExactFeatureShape(raw:Record<string,unknown>,version:number,hasNode:(id:unknown)=>boolean):boolean{
 if(version<EXACT_FEATURE_DOCUMENT_VERSION||raw.featureVersion!==1||!hasNode(raw.source)||raw.source===raw.id)return false;
 if(isEdgeReferences(raw.edges)&&version<EXACT_EDGE_REFERENCE_DOCUMENT_VERSION)return false;
 if(raw.display===undefined)return true;
 const d=raw.display;
 if(!record(d)||Object.keys(d).some(key=>!['sourceKey','positions','indices'].includes(key))||typeof d.sourceKey!=='string'||!sourceKeyPattern.test(d.sourceKey))return false;
 const {positions,indices}=d;
 if(!Array.isArray(positions)||positions.length<9||positions.length>MAX_EXACT_DISPLAY_POSITIONS||positions.length%3||!positions.every(v=>finite(v)))return false;
 const vertices=positions.length/3;
 return Array.isArray(indices)&&indices.length>=12&&indices.length<=MAX_EXACT_DISPLAY_INDICES&&!(indices.length%3)&&indices.every(i=>Number.isInteger(i)&&i>=0&&i<vertices);
}

export interface EvaluatedExactFeature {
 operation:ExactFeatureOperation;
 size:number;
 edges?:'all'|ExactFaceSelector|ExactEdgeReferences;
 openFaces?:ExactFaceSelector[];
}
/** Validated settings with the size resolved and face normals normalised. */
export function evaluateExactFeature(node:ExactFeature&{id:string},doc:Pick<CadDocument,'parametric'>):EvaluatedExactFeature{
 try{
  if(node.featureVersion!==1)throw new Error(t('Unsupported exact feature definition version'));
  if(!(EXACT_FEATURE_OPERATIONS as readonly string[]).includes(node.operation))throw new Error(t('Choose fillet, chamfer or shell'));
  const size=featureValue(node.size,doc);
  if(size<.01||size>10000)throw new Error(node.operation==='shell'?t('Wall thickness must be between 0.01 and 10000 mm'):t('Fillet and chamfer sizes must be between 0.01 and 10000 mm'));
  if(node.operation==='shell'){
   if(node.edges!==undefined)throw new Error(t('A shell removes faces; it has no edge selection'));
   if(!Array.isArray(node.openFaces)||!node.openFaces.length||node.openFaces.length>MAX_EXACT_OPEN_FACES)throw new Error(t`Open between 1 and ${MAX_EXACT_OPEN_FACES} faces of the shell, each by its outward normal`);
   const openFaces=node.openFaces.map(checkFaceSelector);
   const keys=openFaces.map(face=>face.faceNormal.map(v=>v.toFixed(9)).join(','));
   if(new Set(keys).size!==keys.length)throw new Error(t('Each open shell face needs a different normal'));
   return {operation:node.operation,size,openFaces};
  }
  if(node.openFaces!==undefined)throw new Error(t('Only a shell has open faces'));
  if(node.edges===undefined)throw new Error(t('Choose all edges or the edges of one face'));
  return {operation:node.operation,size,edges:node.edges==='all'?'all':isEdgeReferences(node.edges)?checkEdgeReferences(node.edges):checkFaceSelector(node.edges)};
 }catch(error){
  throw new FeatureEvaluationError({source:'feature',id:node.id,message:error instanceof Error?error.message:String(error)});
 }
}

/** Sorted-key JSON, so the key does not depend on property order. */
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(record(value))return '{'+Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value)??'null';
}
const identifier=/[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * The key a display mesh must carry to be used: the feature's settings and the geometry of its
 * source subtree. It ignores names, colours, physics, provenance, the feature's own placement,
 * object identifiers and other displays, so renaming, moving, duplicating or pasting a feature
 * keeps its mesh, while any upstream geometry or parameter change makes it stale.
 */
export function exactFeatureKey(doc:CadDocument,id:string):string{
 const node=doc.nodes[id];
 if(node?.kind!=='exact-feature')throw new Error(t`${id} is not an exact feature`);
 const settings=evaluateExactFeature(node,doc);
 const order=new Map<string,number>(),nodes:unknown[]=[],sketches=new Map<string,unknown>(),texts:string[]=[];
 const collect=(value:unknown)=>{if(typeof value==='string')texts.push(value);else if(Array.isArray(value))value.forEach(collect);else if(record(value))Object.values(value).forEach(collect);};
 const visit=(key:string):number=>{
  const seen=order.get(key);if(seen!==undefined)return seen;
  const n=doc.nodes[key] as SolidNode;
  const {id:_id,name:_name,color:_color,physics:_physics,provenance:_provenance,generator:_generator,...geometry}=n as SolidNode&Record<string,unknown>;
  const index=nodes.length;order.set(key,index);nodes.push(null);
  const entry:Record<string,unknown>={...geometry};
  if(n.kind==='exact-feature')delete entry.display;
  // An imported body's geometry is its B-rep; its display, measures and origin follow from it.
  if(n.kind==='exact-body'){delete entry.display;delete entry.measures;delete entry.origin;entry.brep=exactBodyKey(n);}
  if(n.kind==='boolean')entry.inputs=n.inputs.map(visit);
  if(n.kind==='mirror'||n.kind==='pattern'||n.kind==='exact-feature')entry.source=visit(n.source);
  if(n.kind==='extrusion'||n.kind==='revolution'){
   const sketch=doc.sketches?.[n.sketchId];
   if(sketch&&!sketches.has(n.sketchId)){const {id:_profileId,...profile}=sketch.profile;sketches.set(n.sketchId,{plane:sketch.plane,profile});collect(profile);}
   entry.sketchId=sketch?canonical(sketches.get(n.sketchId)):null;
  }
  collect(entry);nodes[index]=entry;return index;
 };
 visit(node.source);
 // Edge references name faces by node id; the key uses each node's position in the subtree.
 if(settings.edges&&isEdgeReferences(settings.edges))settings.edges=mapEdgeReferenceIds(settings.edges,id=>{const index=order.get(id);return index===undefined?undefined:`n${index}`;});
 if(typeof node.size==='string')texts.push(node.size);
 // Expressions name parameters; their evaluated values are part of the geometry.
 let parameters:unknown=null;
 if(doc.parametric){
  const names=new Set(texts.flatMap(text=>text.match(identifier)??[]));
  try{const values=evaluateParameters(doc.parametric);parameters=Object.fromEntries(Object.keys(values).filter(name=>names.has(name)).sort().map(name=>[name,values[name]]));}
  catch{parameters=doc.parametric.parameters;}
 }
 return geometrySignature(canonical([1,settings,nodes,parameters]));
}

/** Exact features whose display is missing or out of date, in dependency order (sources first). */
export function staleExactFeatures(doc:CadDocument,within?:readonly string[]):string[]{
 const result:string[]=[],seen=new Set<string>();
 const inputs=(n:SolidNode):readonly string[]=>n.kind==='boolean'?n.inputs:n.kind==='mirror'||n.kind==='pattern'||n.kind==='exact-feature'?[n.source]:[];
 const visit=(id:string)=>{
  if(seen.has(id))return;seen.add(id);
  const n=doc.nodes[id];if(!n)return;
  inputs(n).forEach(visit);
  if(n.kind==='exact-feature'&&n.display?.sourceKey!==exactFeatureKey(doc,id))result.push(id);
 };
 (within?.length?within:doc.roots).forEach(visit);
 return result;
}

/** The error Manifold-only evaluation raises for a missing or out-of-date exact display mesh. */
export function staleExactFeatureError(node:ExactFeature&{id:string;name:string}):FeatureEvaluationError{
 const operation=node.operation==='fillet'?t('fillet'):node.operation==='chamfer'?t('chamfer'):t('shell');
 return new FeatureEvaluationError({source:'feature',id:node.id,code:STALE_EXACT_CODE,
  message:node.display?t`${node.name}: the exact ${operation} is out of date after an upstream change. Recompute it with the exact kernel (Recompute exact, or the terminal command recompute exact).`
   :t`${node.name}: the exact ${operation} has not been computed yet. Recompute it with the exact kernel (Recompute exact, or the terminal command recompute exact).`});
}
