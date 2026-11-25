// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import {outlineRelationsForSolve} from './outline-relations.js';
import {regionEdgeLengthsMatch} from './region-edge-lengths.js';
import {checkDrawingVertexIds} from './drawing-sheet.js';
import {isSketchPoint,sketchOutline,sketchPath} from './sketch-outline.js';
import {evaluateSketchRegion,positionRegionLoops,sketchOutlineProfiles} from './sketch-region.js';
import {checkSketchDxfLayer,sketchDxfLayerFields} from './sketch-dxf-layer.js';
import type {SketchDxfLayer} from './sketch-dxf-layer.js';
import {checkSketchDxfWidths} from './sketch-dxf-width.js';
import type {SketchDxfWidths} from './sketch-dxf-width.js';
import type {SketchOutlineProfile,SketchRegionProfile} from './sketch-region.js';
import type {SketchPoint} from './sketch-outline.js';
import {constructionInputs} from './document.js';
import type {CadDocument, Vec3} from './document.js';
import {evaluateExpression, evaluateParameters} from './parameters.js';
import {evaluateExactFeature} from './exact-feature.js';
import type {Quantity, ParameterUnit} from './parameters.js';

/** A literal or bounded expression, never an executable script or a triangle index. */
export type FeatureScalar = number | string;
export type SketchPlane = 'XY' | 'XZ' | 'YZ';
export type SketchPathAnchor = {vertexId:string; x:FeatureScalar; y:FeatureScalar};
/** The endpoint of one segment is driven from the preceding point in sketch coordinates. */
export type SketchPathSegmentConstraint={from:string; to:string; distance:FeatureScalar; direction:FeatureScalar};
export type SketchPathProfile = {
  kind:'path'; id:string; points:SketchPoint[]; bulges?:number[];
  vertexIds?:string[]; anchors?:SketchPathAnchor[]; segmentConstraints?:SketchPathSegmentConstraint[];
}&SketchDxfLayer&SketchDxfWidths;
export type SketchProfile =
  {kind:'rectangle'; id:string; width:FeatureScalar; depth:FeatureScalar} |
  ({kind:'circle'; id:string; radius:FeatureScalar; segments:number; center?:SketchPoint}&SketchDxfLayer) |
  SketchOutlineProfile |
  SketchPathProfile |
  SketchRegionProfile;
/** Profiles are analytic design inputs. Rectangle closure/orthogonality and circle
 * closure are enforced by construction; a general constraint solver comes later. */
export interface ArtworkProfileLink {
 mode:'fill'|'stroke'|'centerline'; signature:string; sourceKey?:string; toleranceMm?:number; maxGapMm?:number;
}
export const artworkProfileKeyPattern=/^(paper|svg):[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,119}$/;
export interface PlanarSketch {version:1; id:string; name:string; plane:SketchPlane; profile:SketchProfile; artworkSourceId?:string; artworkProfile?:ArtworkProfileLink}
export interface ExtrusionFeature {kind:'extrusion'; featureVersion:1; sketchId:string; distance:FeatureScalar; symmetric:boolean}
export interface RevolutionFeature {
  kind:'revolution';
  featureVersion:1;
  sketchId:string;
  angle:FeatureScalar;
  axisOffset?:FeatureScalar;
}
export interface MirrorFeature {
  kind:'mirror';
  source:string;
  plane:SketchPlane;
  offset:FeatureScalar;
}
export type PatternSettings<T=FeatureScalar> = {axis:'X'|'Y'|'Z';count:T}&(
  {mode:'linear';spacing:T}|{mode:'circular';center:[T,T];sweep:T}
);
export interface PatternFeature {kind:'pattern';source:string;pattern:PatternSettings}
export function mapPatternScalars<T,U>(settings:PatternSettings<T>,map:(value:T)=>U):PatternSettings<U>{
  const common={axis:settings.axis,count:map(settings.count)};
  return settings.mode==='linear'
    ?{...common,mode:'linear',spacing:map(settings.spacing)}
    :{...common,mode:'circular',center:[map(settings.center[0]),map(settings.center[1])],sweep:map(settings.sweep)};
}
export function patternExpressions(settings:PatternSettings):string[]{
  const values=settings.mode==='linear'?[settings.count,settings.spacing]:[settings.count,...settings.center,settings.sweep];
  return values.filter((value):value is string=>typeof value==='string');
}
export function evaluatePattern(node:PatternFeature&{id:string},doc:CadDocument){
  try{
    const settings=node.pattern;
    if(!record(settings)||!['linear','circular'].includes(settings.mode)||!['X','Y','Z'].includes(settings.axis))
      throw new Error(t('Choose a pattern type and an X, Y or Z axis'));
    const axis=['X','Y','Z'].indexOf(settings.axis);
    const count=featureValue(settings.count,doc,'scalar');
    if(!Number.isInteger(count)||count<2||count>64)throw new Error(t('Pattern count must be a whole number from 2 to 64'));
    if(settings.mode==='linear'){
      const spacing=featureValue(settings.spacing,doc);
      if(Math.abs(spacing)<.01||Math.abs(spacing)*(count-1)>1000000)throw new Error(t('Use a spacing of at least 0.01 mm in either direction and a total span of at most 1000000 mm'));
      return {mode:settings.mode,axis,count,spacing};
    }
    if(!Array.isArray(settings.center)||settings.center.length!==2)throw new Error(t('Enter two coordinates for the pattern center'));
    const center:Vec3=[0,0,0];
    const perpendicular=[0,1,2].filter(index=>index!==axis);
    perpendicular.forEach((index,i)=>{center[index]=featureValue(settings.center[i],doc);});
    if(center.some(value=>Math.abs(value)>100000))throw new Error(t('Pattern center must be within 100000 mm on each axis'));
    const sweep=featureValue(settings.sweep,doc,'deg');
    if(Math.abs(sweep)<.1||Math.abs(sweep)>360)throw new Error(t('Sweep magnitude must be between 0.1° and 360°'));
    return {mode:settings.mode,axis,count,center,sweep};
  }catch(error){
    throw new FeatureEvaluationError({source:'feature',id:node.id,message:error instanceof Error?error.message:String(error)});
  }
}
export function evaluateMirror(node:MirrorFeature&{id:string},doc:CadDocument){
  try{
    const axis=(['YZ','XZ','XY'] as const).indexOf(node.plane);
    if(axis<0)throw new Error(t('Choose XY, XZ or YZ as the mirror plane'));
    const offset=featureValue(node.offset,doc);
    if(Math.abs(offset)>100000)throw new Error(t('Mirror offset must be between -100000 and 100000 mm'));
    return {axis,offset};
  }catch(error){
    throw new FeatureEvaluationError({source:'feature',id:node.id,message:error instanceof Error?error.message:String(error)});
  }
}
export function isSketchFeature(node:CadDocument['nodes'][string]):node is CadDocument['nodes'][string] & (ExtrusionFeature|RevolutionFeature) {
  return node.kind==='extrusion'||node.kind==='revolution';
}
export interface FeatureDiagnostic {source:'sketch'|'feature'; id:string; message:string; code?:string}
export class FeatureEvaluationError extends Error {
  readonly code?:string;
  constructor(readonly diagnostic:FeatureDiagnostic) {super(t`${diagnostic.source === 'sketch' ? t('sketch') : t('feature')} ${diagnostic.id}: ${diagnostic.message}`);this.name='FeatureEvaluationError';this.code=diagnostic.code;}
}
const idOk=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function featureValue(input:FeatureScalar,doc:Pick<CadDocument,'parametric'>,unit:ParameterUnit='mm'):number {
  if(typeof input==='number'){if(!Number.isFinite(input)||Math.abs(input)>1e6)throw new Error(t('Literal exceeds the finite design range'));return input;}
  const values=doc.parametric?evaluateParameters(doc.parametric):Object.create(null) as Record<string,Quantity>;
  const q=evaluateExpression(input,name=>{if(!Object.hasOwn(values,name))throw new Error(t`Unknown parameter “${name}”`);return values[name];});
  const length=unit==='mm'?1:0,angle=unit==='deg'?1:0;
  if((q.length!==0||q.angle!==0)&&(q.length!==length||q.angle!==angle))throw new Error(t`Expression must produce ${unit}`);
  if(Math.abs(q.value)>1e6)throw new Error(t('Expression exceeds the finite design range'));return q.value;
}
/** Resolve point locks and directed segment dimensions in authoring order. */
export function resolveSketchPath(profile:SketchPathProfile,doc:Pick<CadDocument,'parametric'>):SketchPoint[] {
  const {points,vertexIds,anchors,segmentConstraints}=profile;
  if(vertexIds===undefined&&anchors===undefined&&segmentConstraints===undefined)return points;
  const invalidLocks=()=>new Error(t('Invalid path point locks.'));
  const invalidSegments=()=>new Error(t('Invalid path segment constraints. Each constraint must link consecutive points.'));
  if(!Array.isArray(points)||points.length>256||!Array.from(points).every(isSketchPoint)||!Array.isArray(vertexIds)||vertexIds.length!==points.length||
    !Array.from(vertexIds).every(idOk)||new Set(vertexIds).size!==vertexIds.length)throw segmentConstraints===undefined?invalidLocks():invalidSegments();
  if(anchors!==undefined&&(!Array.isArray(anchors)||!anchors.length||anchors.length>points.length))throw invalidLocks();
  if(segmentConstraints!==undefined&&(!Array.isArray(segmentConstraints)||!segmentConstraints.length||segmentConstraints.length>=points.length))throw invalidSegments();
  if(anchors===undefined&&segmentConstraints===undefined)throw invalidLocks();
  const indices=new Map(vertexIds.map((id,index)=>[id,index]));
  const resolved=points.slice();
  const locked=new Set<string>();
  const scalar=(value:unknown)=>typeof value==='number'||typeof value==='string';
  for(const anchor of anchors??[]){
    if(!record(anchor)||!indices.has(anchor.vertexId)||locked.has(anchor.vertexId)||![anchor.x,anchor.y].every(scalar))throw invalidLocks();
    locked.add(anchor.vertexId);
    resolved[indices.get(anchor.vertexId)!]=[featureValue(anchor.x,doc),featureValue(anchor.y,doc)];
  }
  const drivers=new Map<number,SketchPathSegmentConstraint>();
  for(const constraint of segmentConstraints??[]){
    if(!record(constraint)||![constraint.distance,constraint.direction].every(scalar))throw invalidSegments();
    const from=indices.get(constraint.from),to=indices.get(constraint.to);
    if(from===undefined||to!==from+1)throw invalidSegments();
    if(locked.has(constraint.to)||drivers.has(to))throw new Error(t('A point can have only one driver. Remove its lock or its other segment constraint.'));
    drivers.set(to,constraint);
  }
  for(let to=1;to<resolved.length;to++){
    const driver=drivers.get(to);
    if(!driver)continue;
    const length=dimension(driver.distance,doc),degrees=featureValue(driver.direction,doc,'deg')%360;
    const quarter=((degrees%360+360)%360)/90;
    const radians=degrees*Math.PI/180;
    const [u,v]=Number.isInteger(quarter)?[[1,0],[0,1],[-1,0],[0,-1]][quarter]:[Math.cos(radians),Math.sin(radians)];
    const [x,y]=resolved[to-1];
    const point:SketchPoint=[x+u*length,y+v*length];
    if(!isSketchPoint(point))throw new Error(t('The driven point lies outside the sketch coordinate range.'));
    resolved[to]=point;
  }
  return resolved;
}

export function closePathProfile(profile:SketchPathProfile,doc:Pick<CadDocument,'parametric'>):Extract<SketchProfile,{kind:'outline'}> {
  const outline=structuredClone({kind:'outline' as const,id:profile.id,points:resolveSketchPath(profile,doc)});
  return {...outline,...(profile.bulges?{bulges:[...profile.bulges]}:{}),...sketchDxfLayerFields(profile),...(profile.dxfWidths?{dxfWidths:structuredClone(profile.dxfWidths)}:{})};
}

function dimension(input:FeatureScalar,doc:Pick<CadDocument,'parametric'>):number {const v=featureValue(input,doc);if(v<.01||v>100000)throw new Error(t('Dimension must be between 0.01 and 100000 mm'));return v;}
export function evaluateSketch(sketch:PlanarSketch,doc:Pick<CadDocument,'parametric'>):{contour:SketchPoint[];holes?:SketchPoint[][];loopIds?:string[];edgeIds:string[]} {
  try {
    if(!record(sketch)||sketch.version!==1||!idOk(sketch.id)||typeof sketch.name!=='string'||!sketch.name.trim()||sketch.name.length>160||/[\u0000-\u001f]/.test(sketch.name)||!['XY','XZ','YZ'].includes(sketch.plane)||!record(sketch.profile)||!idOk(sketch.profile.id))throw new Error(t('Invalid sketch schema'));
    const p=sketch.profile;
    if(p.kind==='outline'||p.kind==='circle'||p.kind==='path')checkSketchDxfLayer(p);
    if(p.kind==='region')return evaluateSketchRegion(p.loops, value => featureValue(value, doc));
    if(p.kind==='rectangle') {const w=dimension(p.width,doc)/2,d=dimension(p.depth,doc)/2;return {contour:[[-w,-d],[w,-d],[w,d],[-w,d]],edgeIds:['bottom','right','top','left'].map(side=>`${p.id}:${side}`)};}
    if(p.kind==='outline'||p.kind==='path')checkSketchDxfWidths(p,p.kind==='outline');
    if(p.kind==='path')return {contour:sketchPath(resolveSketchPath(p,doc),p.bulges),edgeIds:p.points.slice(0,-1).map((_,i)=>`${p.id}:edge-${i}`)};
    if(p.kind==='outline') {const contour=sketchOutline(p.points,p.bulges);return {contour,edgeIds:p.points.map((_,i)=>`${p.id}:edge-${i}`)};}
    if(p.kind==='circle') {const center=p.center??[0,0];if(!isSketchPoint(center))throw new Error(t('Circle center must be within 100000 mm of the sketch origin.'));const r=dimension(p.radius,doc);if(!Number.isInteger(p.segments)||p.segments<12||p.segments>256)throw new Error(t('Circle segments must be an integer between 12 and 256'));return {contour:Array.from({length:p.segments},(_,i)=>[center[0]+r*Math.cos(i*2*Math.PI/p.segments),center[1]+r*Math.sin(i*2*Math.PI/p.segments)]),edgeIds:[`${p.id}:circumference`]};}
    throw new Error(t('Unsupported sketch profile version or kind'));
  } catch(error){throw new FeatureEvaluationError({source:'sketch',id:sketch?.id??'unknown',message:error instanceof Error?error.message:String(error)});}
}
export function evaluateExtrusion(node:ExtrusionFeature&{id:string},doc:CadDocument) {
  try {
    if(node.featureVersion!==1)throw new Error(t('Unsupported extrusion definition version'));
    if(typeof node.sketchId!=='string'||!Object.hasOwn(doc.sketches??{},node.sketchId)||typeof node.symmetric!=='boolean')throw new Error(t('Extrusion requires an existing sketch and a symmetric flag'));
    const sketch=doc.sketches![node.sketchId];
    if(sketch.profile.kind==='path')throw new Error(t('Close the sketch path before creating a solid.'));
    const profile=evaluateSketch(sketch,doc),distance=dimension(node.distance,doc);
    return {...profile,plane:sketch.plane,distance,start:node.symmetric?-distance/2:0};
  } catch(error){if(error instanceof FeatureEvaluationError)throw error;throw new FeatureEvaluationError({source:'feature',id:node.id,message:error instanceof Error?error.message:String(error)});}
}
/** The axis is parallel to sketch Y and is positioned along sketch X. */
export function evaluateRevolution(node:RevolutionFeature&{id:string},doc:CadDocument) {
  try {
    if(node.featureVersion!==1||typeof node.sketchId!=='string'||!Object.hasOwn(doc.sketches??{},node.sketchId))
      throw new Error(t('Revolution requires an existing sketch'));
    const sketch=doc.sketches![node.sketchId];
    if(sketch.profile.kind==='path')throw new Error(t('Close the sketch path before creating a solid.'));
    const profile=evaluateSketch(sketch,doc);
    const angle=featureValue(node.angle,doc,'deg');
    if(Math.abs(angle)<.1||Math.abs(angle)>360)throw new Error(t('Sweep magnitude must be between 0.1° and 360°'));
    const radial=profile.contour.map(point=>point[0]);
    const min=Math.min(...radial),max=Math.max(...radial);
    const axisOffset=node.axisOffset===undefined?min:featureValue(node.axisOffset,doc);
    if(Math.abs(axisOffset)>100000)throw new Error(t('Axis must be within 100000 mm of the sketch origin'));
    if(min<axisOffset-1e-8&&max>axisOffset+1e-8)throw new Error(t('Revolved profiles must stay on one side of the radial axis'));
    return {...profile,plane:sketch.plane,angle,axisOffset};
  }catch(error){
    if(error instanceof FeatureEvaluationError)throw error;
    throw new FeatureEvaluationError({source:'feature',id:node.id,message:error instanceof Error?error.message:String(error)});
  }
}
export function checkSketchCollection(doc:CadDocument){
  if(doc.sketches!==undefined&&(doc.version<3||!record(doc.sketches)||Object.keys(doc.sketches).length>256))
    throw new Error(t('Sketches require document version 3 and at most 256 sketches'));
}
export function checkFeatures(doc:CadDocument) {
  checkSketchCollection(doc);
  if(doc.sketches!==undefined){
    for(const [id,sketch] of Object.entries(doc.sketches)){
      if(!idOk(id)||sketch.id!==id)throw new Error(t('Invalid sketch identity'));
      if(sketch.artworkSourceId!==undefined&&(doc.version<39||typeof sketch.artworkSourceId!=='string'||
         !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(sketch.artworkSourceId)))
        throw new Error(t('Invalid sketch artwork link'));
      const source=sketch.artworkProfile;
      const validTolerance=(value:unknown)=>value===undefined||typeof value==='number'&&value>=.01&&value<=10;
      if(source!==undefined&&(doc.version<40||!sketch.artworkSourceId||!record(source)||
         !['fill','stroke','centerline'].includes(source.mode)||
         (source.mode==='centerline')!==(sketch.profile?.kind==='path')||
         typeof source.signature!=='string'||!/^\d{1,8}:\d{1,10}:\d{1,10}$/.test(source.signature)||
         source.sourceKey!==undefined&&(typeof source.sourceKey!=='string'||!artworkProfileKeyPattern.test(source.sourceKey))||
         !validTolerance(source.toleranceMm)||!validTolerance(source.maxGapMm)||
         source.mode!=='fill'&&source.maxGapMm!==undefined))
        throw new Error(t('Invalid sketch artwork link'));
      if(sketch.profile?.kind==='path'){
      if(doc.version<15)throw new Error(t('Open sketch paths require document version 15'));
      if(doc.version<28&&sketch.profile.segmentConstraints!==undefined)throw new Error(t('Path segment constraints require document version 28'));
      if(doc.version<16&&(sketch.profile.anchors!==undefined||sketch.profile.vertexIds!==undefined))throw new Error(t('Path point locks require document version 16'));
    }
    evaluateSketch(sketch,doc);checkDrawingVertexIds(sketch.profile,doc.version);
    if(sketch.profile.kind==='region'&&sketch.profile.edgeMatches!==undefined){
      if(doc.version<38)throw new Error(t('Region edge length matches require document version 38'));
      if(!regionEdgeLengthsMatch(sketch.profile))throw new Error(t('Solve region edge matches before saving.'));
    }
    if(sketch.profile.kind==='region'&&sketch.profile.placements!==undefined){
      if(doc.version<36)throw new Error(t('Region loop positions require document version 36'));
      if(doc.version<37&&Array.isArray(sketch.profile.placements)&&sketch.profile.placements.some(
        placement=>placement?.referenceEdge!==undefined||placement?.targetEdge!==undefined))
        throw new Error(t('Region edge anchors require document version 37'));
      if(positionRegionLoops(sketch.profile,value=>featureValue(value,doc))!==sketch.profile)
        throw new Error(t('Region loop positions do not match the saved geometry.'));
    }
    for(const outline of sketchOutlineProfiles(sketch.profile)){
      if(outline.relations===undefined)continue;
      if(sketch.profile.kind==='region'&&doc.version<35)throw new Error(t('Region outline constraints require document version 35'));
      if(doc.version<31)throw new Error(t('Outline constraints require document version 31'));
      const relations=outlineRelationsForSolve(outline,length=>featureValue(length,doc));
      if(doc.version<32&&relations.some(relation=>relation.kind==='radius'))throw new Error(t('Driving arc radii require document version 32'));
      if(doc.version<33&&relations.some(relation=>relation.kind==='tangent'))throw new Error(t('Arc tangency requires document version 33'));
      if(doc.version<34&&relations.some(relation=>relation.kind==='arc-tangent'))throw new Error(t('Arc-to-arc tangency requires document version 34'));
    }
   }}
  for(const node of Object.values(doc.nodes)){
    if(node.kind==='extrusion'){if(doc.version<3)throw new Error(t('Extrusion features require document version 3'));evaluateExtrusion(node,doc);}
    else if(node.kind==='mirror')evaluateMirror(node,doc);
    else if(node.kind==='pattern')evaluatePattern(node,doc);
    else if(node.kind==='exact-feature')evaluateExactFeature(node,doc);
    else if(node.kind==='revolution'){if(doc.version<12)throw new Error(t('Revolution features require document version 12'));evaluateRevolution(node,doc);}
  }
}
export function sketchFeatureExpressions(node:ExtrusionFeature|RevolutionFeature):string[] {
  return (node.kind==='extrusion'?[node.distance]:[node.angle,node.axisOffset]).filter((value):value is string=>typeof value==='string');
}
export function sketchExpressions(sketch:PlanarSketch):string[] {
  const profile=sketch.profile;
  const outlineValues=(outline:SketchOutlineProfile)=>(outline.relations??[]).flatMap(relation=>
    relation.kind==='length'?[relation.length]:relation.kind==='radius'?[relation.radius]:[]);
  const values=profile.kind==='rectangle'?[profile.width,profile.depth]:
    profile.kind==='circle'?[profile.radius]:
    profile.kind==='path'?[...(profile.anchors??[]).flatMap(anchor=>[anchor.x,anchor.y]),
      ...(profile.segmentConstraints??[]).flatMap(constraint=>[constraint.distance,constraint.direction])]:
    profile.kind==='outline'?outlineValues(profile):
    profile.kind==='region'?[...profile.loops.flatMap(loop=>loop.kind==='circle'?[...loop.center,loop.radius]:outlineValues(loop)),
      ...(profile.placements??[]).flatMap(placement=>placement.offset)]:[];
  return values.filter((value):value is string=>typeof value==='string');
}
export function rewriteSketchExpressions(sketch:PlanarSketch,rewrite:(s:string)=>string) {
  const transform=(value:FeatureScalar)=>typeof value==='string'?rewrite(value):value;
  const profile=sketch.profile;
  if(profile.kind==='rectangle'){
    profile.width=transform(profile.width);
    profile.depth=transform(profile.depth);
  }else if(profile.kind==='circle'){
    profile.radius=transform(profile.radius);
  }else if(profile.kind==='path'){
    for(const anchor of profile.anchors??[]){
      anchor.x=transform(anchor.x);
      anchor.y=transform(anchor.y);
    }
    for(const constraint of profile.segmentConstraints??[]){
      constraint.distance=transform(constraint.distance);
      constraint.direction=transform(constraint.direction);
    }
  }
  for(const outline of sketchOutlineProfiles(profile)){
    for(const relation of outline.relations??[]){
      if(relation.kind==='length')relation.length=transform(relation.length);
      if(relation.kind==='radius')relation.radius=transform(relation.radius);
    }
  }
  if(profile.kind==='region'){
    for(const placement of profile.placements??[])placement.offset=[transform(placement.offset[0]),transform(placement.offset[1])];
    for(const loop of profile.loops){
      if(loop.kind!=='circle')continue;
      loop.center=[transform(loop.center[0]),transform(loop.center[1])];
      loop.radius=transform(loop.radius);
    }
  }
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
  for(const n of Object.values(doc.nodes)){const deps=constructionInputs(n).map(id=>`feature:${id}`);
    if(isSketchFeature(n))deps.push(`sketch:${n.sketchId}`,...sketchFeatureExpressions(n).flatMap(references));
    if(n.kind==='mirror'&&typeof n.offset==='string')deps.push(...references(n.offset));
    if(n.kind==='pattern')deps.push(...patternExpressions(n.pattern).flatMap(references));
    if(n.kind==='exact-feature'&&typeof n.size==='string')deps.push(...references(n.size));
    for(const b of doc.parametric?.bindings??[])if(b.nodeId===n.id)deps.push(...references(b.expression));
    entries.push({key:`feature:${n.id}`,id:n.id,kind:'feature',label:n.name,dependencies:[...new Set(deps)]});}
  const byKey=new Map(entries.map(e=>[e.key,e])),ordered:DesignGraphEntry[]=[],seen=new Set<string>(),visiting=new Set<string>();
  function visit(key:string){if(seen.has(key))return;if(visiting.has(key))throw new Error(t`Design dependency cycle at ${key}`);const e=byKey.get(key);if(!e)throw new Error(t`Missing design dependency ${key}`);visiting.add(key);e.dependencies.forEach(visit);visiting.delete(key);seen.add(key);ordered.push(e);}
  entries.forEach(e=>visit(e.key));return ordered;
}
export function affectedDesignEntries(doc:CadDocument,changedKeys:readonly string[]):DesignGraphEntry[]{const affected=new Set(changedKeys);return designGraph(doc).filter(entry=>{if(affected.has(entry.key)||entry.dependencies.some(key=>affected.has(key))){affected.add(entry.key);return true;}return false;});}
/** Map local (u,v,normal) to a right-handed principal sketch frame. */
export function sketchPoint(plane:SketchPlane,u:number,v:number,n:number):Vec3{return plane==='XY'?[u,v,n]:plane==='XZ'?[u,-n,v]:[n,u,v];}
