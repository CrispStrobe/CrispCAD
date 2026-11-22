// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import {isSketchPoint,sketchOutline} from './sketch-outline.js';
import {evaluateSketchRegion} from './sketch-region.js';
import type {SketchLoop} from './sketch-region.js';
import type {SketchPoint} from './sketch-outline.js';
import type {CadDocument, Vec3} from './document.js';
import {evaluateExpression, evaluateParameters} from './parameters.js';
import type {Quantity, ParameterUnit} from './parameters.js';

/** A literal or bounded expression, never an executable script or a triangle index. */
export type FeatureScalar = number | string;
export type SketchPlane = 'XY' | 'XZ' | 'YZ';
export type SketchProfile =
  {kind:'rectangle'; id:string; width:FeatureScalar; depth:FeatureScalar} |
  {kind:'circle'; id:string; radius:FeatureScalar; segments:number; center?:SketchPoint} |
  {kind:'outline'; id:string; points:SketchPoint[]} |
  {kind:'region'; id:string; loops:SketchLoop[]};
/** Profiles are analytic design inputs. Rectangle closure/orthogonality and circle
 * closure are enforced by construction; a general constraint solver comes later. */
export interface PlanarSketch {version:1; id:string; name:string; plane:SketchPlane; profile:SketchProfile}
export interface ExtrusionFeature {kind:'extrusion'; featureVersion:1; sketchId:string; distance:FeatureScalar; symmetric:boolean}
export interface FeatureDiagnostic {source:'sketch'|'feature'; id:string; message:string; code?:string}
export class FeatureEvaluationError extends Error {
  readonly code?:string;
  constructor(readonly diagnostic:FeatureDiagnostic) {super(t`${diagnostic.source === 'sketch' ? t('sketch') : t('feature')} ${diagnostic.id}: ${diagnostic.message}`);this.name='FeatureEvaluationError';this.code=diagnostic.code;}
}
const idOk=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function featureValue(input:FeatureScalar,doc:CadDocument,unit:ParameterUnit='mm'):number {
  if(typeof input==='number'){if(!Number.isFinite(input)||Math.abs(input)>1e6)throw new Error(t('Literal exceeds the finite design range'));return input;}
  const values=doc.parametric?evaluateParameters(doc.parametric):Object.create(null) as Record<string,Quantity>;
  const q=evaluateExpression(input,name=>{if(!Object.hasOwn(values,name))throw new Error(t`Unknown parameter “${name}”`);return values[name];});
  const length=unit==='mm'?1:0,angle=unit==='deg'?1:0;
  if((q.length!==0||q.angle!==0)&&(q.length!==length||q.angle!==angle))throw new Error(t`Expression must produce ${unit}`);
  if(Math.abs(q.value)>1e6)throw new Error(t('Expression exceeds the finite design range'));return q.value;
}
function dimension(input:FeatureScalar,doc:CadDocument):number {const v=featureValue(input,doc);if(v<.01||v>100000)throw new Error(t('Dimension must be between 0.01 and 100000 mm'));return v;}
export function evaluateSketch(sketch:PlanarSketch,doc:CadDocument):{contour:SketchPoint[];holes?:SketchPoint[][];edgeIds:string[]} {
  try {
    if(!record(sketch)||sketch.version!==1||!idOk(sketch.id)||typeof sketch.name!=='string'||!sketch.name.trim()||sketch.name.length>160||/[\u0000-\u001f]/.test(sketch.name)||!['XY','XZ','YZ'].includes(sketch.plane)||!record(sketch.profile)||!idOk(sketch.profile.id))throw new Error(t('Invalid sketch schema'));
    const p=sketch.profile;
    if(p.kind==='region')return evaluateSketchRegion(p.loops);
    if(p.kind==='rectangle') {const w=dimension(p.width,doc)/2,d=dimension(p.depth,doc)/2;return {contour:[[-w,-d],[w,-d],[w,d],[-w,d]],edgeIds:['bottom','right','top','left'].map(side=>`${p.id}:${side}`)};}
    if(p.kind==='outline') {const contour=sketchOutline(p.points);return {contour,edgeIds:contour.map((_,i)=>`${p.id}:edge-${i}`)};}
    if(p.kind==='circle') {const center=p.center??[0,0];if(!isSketchPoint(center))throw new Error(t('Circle center must be within 100000 mm of the sketch origin.'));const r=dimension(p.radius,doc);if(!Number.isInteger(p.segments)||p.segments<12||p.segments>256)throw new Error(t('Circle segments must be an integer between 12 and 256'));return {contour:Array.from({length:p.segments},(_,i)=>[center[0]+r*Math.cos(i*2*Math.PI/p.segments),center[1]+r*Math.sin(i*2*Math.PI/p.segments)]),edgeIds:[`${p.id}:circumference`]};}
    throw new Error(t('Unsupported sketch profile version or kind'));
  } catch(error){throw new FeatureEvaluationError({source:'sketch',id:sketch?.id??'unknown',message:error instanceof Error?error.message:String(error)});}
}
export function evaluateExtrusion(node:ExtrusionFeature&{id:string},doc:CadDocument) {
  try {
    if(node.featureVersion!==1)throw new Error(t('Unsupported extrusion definition version'));
    if(typeof node.sketchId!=='string'||!Object.hasOwn(doc.sketches??{},node.sketchId)||typeof node.symmetric!=='boolean')throw new Error(t('Extrusion requires an existing sketch and a symmetric flag'));
    const sketch=doc.sketches![node.sketchId],profile=evaluateSketch(sketch,doc),distance=dimension(node.distance,doc);
    return {...profile,plane:sketch.plane,distance,start:node.symmetric?-distance/2:0};
  } catch(error){if(error instanceof FeatureEvaluationError)throw error;throw new FeatureEvaluationError({source:'feature',id:node.id,message:error instanceof Error?error.message:String(error)});}
}
export function checkFeatures(doc:CadDocument) {
  if(doc.sketches!==undefined){if(doc.version<3||!record(doc.sketches)||Object.keys(doc.sketches).length>256)throw new Error(t('Sketches require document version 3 and at most 256 sketches'));
    for(const [id,sketch] of Object.entries(doc.sketches)){if(!idOk(id)||sketch.id!==id)throw new Error(t('Invalid sketch identity'));evaluateSketch(sketch,doc);}}
  for(const node of Object.values(doc.nodes))if(node.kind==='extrusion'){if(doc.version<3)throw new Error(t('Extrusion features require document version 3'));evaluateExtrusion(node,doc);}
}
export function sketchExpressions(sketch:PlanarSketch):string[]{const p=sketch.profile;return (p.kind==='rectangle'?[p.width,p.depth]:p.kind==='circle'?[p.radius]:[]).filter((v):v is string=>typeof v==='string');}
export function rewriteSketchExpressions(sketch:PlanarSketch,rewrite:(s:string)=>string) {
  const p=sketch.profile;for(const key of p.kind==='rectangle'?['width','depth'] as const:p.kind==='circle'?['radius'] as const:[]){const fields=p as unknown as Record<string,FeatureScalar>;if(typeof fields[key]==='string')fields[key]=rewrite(fields[key] as string);}
}
/** Semantic references deliberately cover only analytic construction here. They
 * are not promises that arbitrary B-rep faces survive a topology change. */
export type DesignReference = {kind:'sketch-profile';sketchId:string;profileId:string}|{kind:'feature-output';featureId:string};
export function resolveDesignReference(doc:CadDocument,reference:DesignReference):PlanarSketch|CadDocument['nodes'][string] {
  if(reference.kind==='sketch-profile'){const sketch=doc.sketches?.[reference.sketchId];if(!sketch||sketch.profile.id!==reference.profileId)throw new Error(t('Sketch reference is no longer available'));return sketch;}
  if(reference.kind!=='feature-output'||!Object.hasOwn(doc.nodes,reference.featureId))throw new Error(t('Feature output reference is no longer available'));return doc.nodes[reference.featureId];
}
export interface DesignGraphEntry {key:string;id:string;kind:'parameter'|'sketch'|'feature';label:string;dependencies:string[]}
/** Derived from canonical definitions, never a second mutable feature history. */
export function designGraph(doc:CadDocument):DesignGraphEntry[] {
  const values=doc.parametric?evaluateParameters(doc.parametric):{};
  const references=(expression:string)=>{const names=new Set<string>();evaluateExpression(expression,name=>{if(!Object.hasOwn(values,name))throw new Error(t`Unknown parameter “${name}”`);names.add(`parameter:${name}`);return values[name];});return [...names];};
  const entries:DesignGraphEntry[]=[];
  for(const [name,p] of Object.entries(doc.parametric?.parameters??{}))entries.push({key:`parameter:${name}`,id:name,kind:'parameter',label:name,dependencies:references(p.expression)});
  for(const s of Object.values(doc.sketches??{}))entries.push({key:`sketch:${s.id}`,id:s.id,kind:'sketch',label:s.name,dependencies:[...new Set(sketchExpressions(s).flatMap(references))]});
  for(const n of Object.values(doc.nodes)){const deps=n.kind==='boolean'?n.inputs.map(id=>`feature:${id}`):n.kind==='extrusion'?[`sketch:${n.sketchId}`,...(typeof n.distance==='string'?references(n.distance):[])]:[];
    for(const b of doc.parametric?.bindings??[])if(b.nodeId===n.id)deps.push(...references(b.expression));
    entries.push({key:`feature:${n.id}`,id:n.id,kind:'feature',label:n.name,dependencies:[...new Set(deps)]});}
  const byKey=new Map(entries.map(e=>[e.key,e])),ordered:DesignGraphEntry[]=[],seen=new Set<string>(),visiting=new Set<string>();
  function visit(key:string){if(seen.has(key))return;if(visiting.has(key))throw new Error(t`Design dependency cycle at ${key}`);const e=byKey.get(key);if(!e)throw new Error(t`Missing design dependency ${key}`);visiting.add(key);e.dependencies.forEach(visit);visiting.delete(key);seen.add(key);ordered.push(e);}
  entries.forEach(e=>visit(e.key));return ordered;
}
export function affectedDesignEntries(doc:CadDocument,changedKeys:readonly string[]):DesignGraphEntry[]{const affected=new Set(changedKeys);return designGraph(doc).filter(entry=>{if(affected.has(entry.key)||entry.dependencies.some(key=>affected.has(key))){affected.add(entry.key);return true;}return false;});}
/** Map local (u,v,normal) to a right-handed principal sketch frame. */
export function sketchPoint(plane:SketchPlane,u:number,v:number,n:number):Vec3{return plane==='XY'?[u,v,n]:plane==='XZ'?[u,-n,v]:[n,u,v];}
