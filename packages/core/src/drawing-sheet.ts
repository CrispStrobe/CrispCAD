// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import type {FeatureScalar,SketchProfile} from './features.js';
import type {SketchPoint} from './sketch-outline.js';
import type {SketchOutlineProfile} from './sketch-region.js';
import type {CadDocument,Vec3} from './document.js';

export const drawingScales = ['1:5','1:2','1:1','2:1','5:1'] as const;
export type DrawingScale = typeof drawingScales[number];
export type DrawingSource = {featureId:string; sketchId:string; profileId:string};
export type AssemblyDrawingSource = {kind:'assembly'};
export type DrawingSectionJog = {at:FeatureScalar; position:FeatureScalar};
export const assemblySectionJogLimit=4;
export type DrawingSection = {axis:'u'|'v'; position:FeatureScalar; jog?:DrawingSectionJog; additionalJogs?:DrawingSectionJog[]};
export type DrawingDimensionKind = 'linear-x'|'linear-y'|'aligned'|'diameter'|'radius'|'arc-length';
export type DrawingAnnotation = {
 id:string; sketchId:string; kind:DrawingDimensionKind; from:string; to?:string; at:[number,number];
};
export type AssemblyEdgeDimension={
 id:string; bodyId:string; view:0|1|2; endpoints:[Vec3,Vec3]; at:[number,number];
};
export type AssemblyCurveSource='cylinder'|{sketchId:string; profileId:string; anchor:string};
export type AssemblyCurveDimension={
 id:string; bodyId:string; view:AssemblyEdgeDimension['view']; at:SketchPoint;
 kind:'radius'|'diameter'|'arc-length'; source:AssemblyCurveSource;
};
export const drawingAnnotationLimit=24;
export const drawingTitleBlockLimits={number:24,revision:12,drawnBy:16} as const;
export type DrawingTitleBlock=Partial<Record<keyof typeof drawingTitleBlockLimits,string>>;
export type DrawingInputs = {title:string; titleBlock?:DrawingTitleBlock; source:DrawingSource|AssemblyDrawingSource; scale:DrawingScale; hiddenLines:boolean; section?:DrawingSection; annotations?:DrawingAnnotation[]; partsList?:boolean; edgeDimensions?:AssemblyEdgeDimension[]; curveDimensions?:AssemblyCurveDimension[]};
export type DrawingSheet = DrawingInputs & {id:string};

const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
const id = (value:unknown):value is string => typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);

export const isDrawingVertex=(value:unknown):value is string=>typeof value==='string'&&/^vertex:[a-zA-Z0-9_-]{1,96}:[a-zA-Z0-9_-]{1,96}$/.test(value)&&value.split(':').slice(1).every(id);

export const isDrawingArc=(value:unknown):value is string=>typeof value==='string'&&
 /^arc:[a-zA-Z0-9_-]{1,96}:[a-zA-Z0-9_-]{1,96}:[a-zA-Z0-9_-]{1,96}$/.test(value)&&value.split(':').slice(1).every(id);

const isDrawingCircle=(value:string)=>value.startsWith('circle:')&&id(value.slice(7));
const anchor=(value:unknown):value is string=>typeof value==='string'&&
 (/^bounds:(sw|se|nw|ne)$/.test(value)||isDrawingCircle(value)||isDrawingVertex(value));

export function validDrawingPosition(x:number,y:number){
 return Number.isFinite(x)&&Number.isFinite(y)&&x>=10&&x<=265&&y>=28&&y<=176;
}

const edgePoint=(value:unknown):value is Vec3=>Array.isArray(value)&&value.length===3&&
 Array.from(value).every(axis=>typeof axis==='number'&&Number.isFinite(axis)&&Math.abs(axis)<=1e6);

const sectionScalar=(value:unknown):value is FeatureScalar=>typeof value==='number'
 ? Number.isFinite(value)&&Math.abs(value)<=100000
 : typeof value==='string'&&!!value.trim()&&value.length<=160&&!/[\u0000-\u001f]/.test(value);

const validJog=(value:unknown)=>record(value)&&sectionScalar(value.at)&&sectionScalar(value.position);

export function checkDrawingSheets(doc:CadDocument) {
 if(doc.drawings===undefined)return;
 const unique=new Set<string>();
 const invalid=()=>new Error(t('Invalid drawing sheets in this CAD project.'));
 if(doc.version<9||!Array.isArray(doc.drawings)||doc.drawings.length>64)throw invalid();
 for(const sheet of doc.drawings){
  if(!record(sheet)||!id(sheet.id)||unique.has(sheet.id)||typeof sheet.title!=='string'||
     !sheet.title.trim()||sheet.title.length>80||/[\u0000-\u001f]/.test(sheet.title)||
     !drawingScales.includes(sheet.scale as DrawingScale)||typeof sheet.hiddenLines!=='boolean'||!record(sheet.source))throw invalid();
  if(sheet.titleBlock!==undefined){
   if(doc.version<29||!record(sheet.titleBlock))throw invalid();
   const fields=Object.entries(sheet.titleBlock);
   if(!fields.length||fields.some(([key,value])=>{
    if(!Object.hasOwn(drawingTitleBlockLimits,key)||typeof value!=='string')return true;
    return !value.trim()||value.length>drawingTitleBlockLimits[key as keyof DrawingTitleBlock]||/[\u0000-\u001f\u007f-\u009f]/.test(value);
   }))throw invalid();
  }
  if(isAssemblyDrawingSource(sheet.source)){
   if(doc.version<21||sheet.annotations!==undefined)throw invalid();
   if(sheet.section!==undefined&&(doc.version<23||!record(sheet.section)||(sheet.section.jog!==undefined&&doc.version<24)))throw invalid();
  }else if(Object.hasOwn(sheet.source,'kind')||!id(sheet.source.featureId)||!id(sheet.source.sketchId)||!id(sheet.source.profileId))throw invalid();
  if(sheet.partsList!==undefined&&(doc.version<22||!isAssemblyDrawingSource(sheet.source)||typeof sheet.partsList!=='boolean'))throw invalid();
  if(sheet.section!==undefined){
   if(doc.version<10||!record(sheet.section)||!['u','v'].includes(String(sheet.section.axis)))throw invalid();
   if(!sectionScalar(sheet.section.position))throw invalid();
   const jog=sheet.section.jog;
   if(jog!==undefined&&(doc.version<17||!validJog(jog)))throw invalid();
   const extra=sheet.section.additionalJogs;
   if(extra!==undefined&&(doc.version<26||!isAssemblyDrawingSource(sheet.source)||!jog||
      !Array.isArray(extra)||!extra.length||extra.length>=assemblySectionJogLimit||!Array.from(extra).every(validJog)))throw invalid();
  }
  if(sheet.edgeDimensions!==undefined){
   if(doc.version<25||!isAssemblyDrawingSource(sheet.source)||!Array.isArray(sheet.edgeDimensions)||sheet.edgeDimensions.length>drawingAnnotationLimit)throw invalid();
   const edgeIds=new Set<string>();
   for(const edge of sheet.edgeDimensions){
    if(!record(edge)||!id(edge.id)||edgeIds.has(edge.id)||!id(edge.bodyId)||(edge.view!==0&&edge.view!==1&&edge.view!==2)||
       !Array.isArray(edge.endpoints)||edge.endpoints.length!==2||
       !Array.isArray(edge.at)||edge.at.length!==2||!validDrawingPosition(edge.at[0],edge.at[1]))throw invalid();
    const [a,b]=edge.endpoints;
    if(!edgePoint(a)||!edgePoint(b)||a.every((coordinate,index)=>coordinate===b[index]))throw invalid();
    edgeIds.add(edge.id);
   }
  }
  if(sheet.curveDimensions!==undefined){
   if(doc.version<27||!isAssemblyDrawingSource(sheet.source)||!Array.isArray(sheet.curveDimensions)||
      sheet.curveDimensions.length+(sheet.edgeDimensions?.length??0)>drawingAnnotationLimit)throw invalid();
   const ids=new Set(sheet.edgeDimensions?.map(edge=>edge.id));
   for(const curve of sheet.curveDimensions){
    if(!record(curve)||!id(curve.id)||ids.has(curve.id)||!id(curve.bodyId)||(curve.view!==0&&curve.view!==1&&curve.view!==2)||
       !Array.isArray(curve.at)||curve.at.length!==2||!validDrawingPosition(curve.at[0],curve.at[1]))throw invalid();
    const source=curve.source;
    const arc=record(source)&&isDrawingArc(source.anchor);
    if(source!=='cylinder'&&(!record(source)||!id(source.sketchId)||!id(source.profileId)||
       typeof source.anchor!=='string'||(!arc&&!isDrawingCircle(source.anchor))))throw invalid();
    if(curve.kind!=='radius'&&(arc?curve.kind!=='arc-length':curve.kind!=='diameter'))throw invalid();
    ids.add(curve.id);
   }
  }
  if(sheet.annotations!==undefined){
   if(doc.version<11||!Array.isArray(sheet.annotations)||sheet.annotations.length>drawingAnnotationLimit)throw invalid();
   const annotationIds=new Set<string>();
   for(const dimension of sheet.annotations){
    if(!record(dimension)||!id(dimension.id)||annotationIds.has(dimension.id)||!id(dimension.sketchId)||
       typeof dimension.from!=='string'||!Array.isArray(dimension.at)||dimension.at.length!==2||
       !validDrawingPosition(dimension.at[0],dimension.at[1]))throw invalid();
    if(dimension.kind==='aligned'&&doc.version<19)throw invalid();
    if(doc.version<18&&[dimension.from,dimension.to].some(isDrawingVertex))throw invalid();
    if(dimension.kind==='radius'||dimension.kind==='arc-length'){
     const validSource=isDrawingArc(dimension.from)||(dimension.kind==='radius'&&isDrawingCircle(dimension.from));
     if(doc.version<20||!validSource||dimension.to!==undefined)throw invalid();
    }else if(dimension.kind==='diameter'){
     if(!isDrawingCircle(dimension.from)||dimension.to!==undefined)throw invalid();
    }else if(!['linear-x','linear-y','aligned'].includes(String(dimension.kind))||
      !anchor(dimension.from)||!anchor(dimension.to)||dimension.to===dimension.from)throw invalid();
    annotationIds.add(dimension.id);
   }
  }
  unique.add(sheet.id);
 }
}

export function isAssemblyDrawingSource(value:unknown):value is AssemblyDrawingSource{
 return record(value)&&value.kind==='assembly';
}

export function drawingAssemblyAvailable(doc:CadDocument){
 return doc.roots.some(id=>!doc.nodes[id].reference&&doc.nodes[id].role!=='hole');
}

/** A drawing survives removal of its source so it can be repaired or restored by Undo. */
export function resolveDrawingSource(doc:CadDocument, source:DrawingSource){
 const node=Object.hasOwn(doc.nodes,source.featureId)?doc.nodes[source.featureId]:undefined;
 const sketch=doc.sketches&&Object.hasOwn(doc.sketches,source.sketchId)?doc.sketches[source.sketchId]:undefined;
 if(node?.kind!=='extrusion'||node.sketchId!==sketch?.id||sketch.profile.id!==source.profileId)return undefined;
 return {node,sketch};
}

export function drawingSourceFor(doc:CadDocument,featureId:string):DrawingSource|undefined{
 const node=Object.hasOwn(doc.nodes,featureId)?doc.nodes[featureId]:undefined;
 const sketch=node?.kind==='extrusion'?doc.sketches?.[node.sketchId]:undefined;
 return sketch?{featureId,sketchId:sketch.id,profileId:sketch.profile.id}:undefined;
}


export function drawingOutlines(profile:SketchProfile):SketchOutlineProfile[]{
 return profile.kind==='outline'?[profile]:profile.kind==='region'&&Array.isArray(profile.loops)
  ? profile.loops.filter((loop):loop is SketchOutlineProfile=>loop?.kind==='outline'):[];
}

const outlineVertexId=(outline:SketchOutlineProfile,index:number)=>outline.vertexIds?.[index]??`p${index}`;

export function drawingVertexId(outline:SketchOutlineProfile,index:number){
 return `vertex:${outline.id}:${outlineVertexId(outline,index)}`;
}

export function drawingArcId(outline:SketchOutlineProfile,index:number){
 const next=(index+1)%outline.points.length;
 return `arc:${outline.id}:${outlineVertexId(outline,index)}:${outlineVertexId(outline,next)}`;
}

export function checkDrawingVertexIds(profile:SketchProfile,version:CadDocument['version']){
 for(const {points,vertexIds} of drawingOutlines(profile)){
  if(vertexIds!==undefined&&(version<18||!Array.isArray(vertexIds)||vertexIds.length!==points.length||
     !Array.from(vertexIds).every(id)||new Set(vertexIds).size!==vertexIds.length)){
   throw new Error(t('Invalid outline vertex identities.'));
  }
 }
}

/** Persist the IDs used by the drawing preview when its first outline dimension is saved. */
export function initializeDrawingOutlineIds(profile:SketchProfile,newId:()=>string){
 const links=new Map<string,string>();
 for(const outline of drawingOutlines(profile)){
  if(outline.vertexIds)continue;
  const vertices=outline.points.map((_,index)=>drawingVertexId(outline,index));
  const arcs=outline.bulges?.map((bulge,index)=>bulge?drawingArcId(outline,index):undefined);
  outline.vertexIds=outline.points.map(()=>newId());
  vertices.forEach((from,index)=>links.set(from,drawingVertexId(outline,index)));
  arcs?.forEach((from,index)=>{if(from)links.set(from,drawingArcId(outline,index));});
 }
 return links;
}

/** Reuse exact survivors. A single moved row can also be identified by its unchanged position in the outline. */
export function retainDrawingVertexIds(before:SketchProfile,after:SketchProfile,newId:()=>string){
 const previous=drawingOutlines(before);
 for(const outline of drawingOutlines(after)){
  if(outline.relations!==undefined)continue;
  if(after.kind==='region'&&Array.isArray(after.placements)&&after.placements.some(item=>
    (item?.target===outline.id&&item.targetEdge)||(item?.reference===outline.id&&item.referenceEdge)))continue;
  const original=previous.find(item=>item.id===outline.id&&item.vertexIds);
  if(!original)continue;
  if(!Array.isArray(outline.points))continue;
  if(after.kind==='region'&&Array.isArray(after.placements)&&after.placements.some(item=>item?.target===outline.id||item?.reference===outline.id)&&
    outline.points.length===original.points.length){
   outline.vertexIds=original.vertexIds!.slice();
   continue;
  }
  const key=(point:readonly number[])=>JSON.stringify(point);
  const indices=new Map(original.points.map((point,index)=>[key(point),index]));
  const ids=outline.points.map(point=>{
   const index=indices.get(key(point));
   return index===undefined?undefined:original.vertexIds![index];
  });
  const unmatched=ids.flatMap((value,index)=>value===undefined?[index]:[]);
  if(unmatched.length===1&&ids.length===original.points.length){
   const index=unmatched[0],prior=original.vertexIds![index];
   if(!ids.includes(prior))ids[index]=prior;
  }
  outline.vertexIds=ids.map(value=>value??newId());
 }
}
