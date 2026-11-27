// SPDX-License-Identifier: BSD-3-Clause
import {drawingArcId,drawingOutlines,evaluateExtrusion,featureValue,localToWorldPoint,rotatePoint,sketchBulgeTessellation,sketchPoint} from '@brickwright/cad-core';
import type {AssemblyCurveDimension,AssemblyCurveSource,CadDocument,SketchPlane,SketchPoint,SolidNode,Transform,Vec3} from '@brickwright/cad-core';
import type {AssemblyDrawingEdge} from './assembly-edge-dimension.js';
import type {PaperArc} from './exact-drawing-layout.js';
import {placeDrawingAnnotation} from './drawing-annotation.js';
import type {DrawingAnchorPoint} from './drawing-annotation.js';
import type {DrawingLayout} from './drawing-page.js';
import {drawingViews} from './drawing-page.js';

type Curve={source:AssemblyCurveSource;center:SketchPoint;radius:number;segments:number;arc?:{start:number;sweep:number}};
type View=AssemblyCurveDimension['view'];
type Segment=AssemblyDrawingEdge['visible'];

export type AssemblyDrawingCurve={
 bodyId:string;view:View;source:AssemblyCurveSource;anchor:DrawingAnchorPoint;visible:Segment[];
};

function bodyCurves(node:SolidNode,doc:CadDocument){
 if(node.kind==='cylinder'){
  const curves:Curve[]=[{source:'cylinder',center:[0,0],radius:node.radius,segments:node.segments}];
  return {plane:'XY' as const,start:-node.height/2,end:node.height/2,curves};
 }
 if(node.kind!=='extrusion')return;
 const {id:sketchId,profile}=doc.sketches![node.sketchId],profileId=profile.id;
 const circles=profile.kind==='circle'?[profile]:profile.kind==='region'?profile.loops.filter(loop=>loop.kind==='circle'):[];
 const curves:Curve[]=circles.map(circle=>({
  source:{sketchId,profileId,anchor:'circle:'+circle.id},
  center:circle.center?[featureValue(circle.center[0],doc),featureValue(circle.center[1],doc)]:[0,0],
  radius:featureValue(circle.radius,doc),segments:circle.segments
 }));
 for(const outline of drawingOutlines(profile))for(const [i,bulge] of (outline.bulges??[]).entries()){
  const a=outline.points[i],b=outline.points[(i+1)%outline.points.length];
  const arc=sketchBulgeTessellation(a,b,bulge,outline.points.length);
  if(!arc)continue;
  const {center,radius,start,sweep,segments}=arc;
  curves.push({source:{sketchId,profileId,anchor:drawingArcId(outline,i)},center,radius,segments,arc:{start,sweep}});
 }
 if(!curves.length)return;
 const {plane,start,distance}=evaluateExtrusion(node,doc);
 return {plane,start,end:start+distance,curves};
}

function viewAxes(plane:SketchPlane,transform:Transform,view:View){
 const {horizontal,vertical,depth}=drawingViews[view];
 const basis=(x:number,y:number)=>rotatePoint(sketchPoint(plane,x,y,0).map((v,i)=>v*transform.scale[i]) as Vec3,transform.rotation);
 const u=basis(1,0),v=basis(0,1),scale=Math.hypot(...u),other=Math.hypot(...v);
 // Radius and arc length are meaningful only in a face-on, circular projection.
 if(Math.abs(u[depth])>scale*1e-8||Math.abs(v[depth])>other*1e-8||Math.abs(scale-other)>scale*1e-8)return;
 const handedness=Math.sign(u[horizontal]*v[vertical]-u[vertical]*v[horizontal]);
 const angle=(start:number)=>Math.atan2(u[vertical]*Math.cos(start)+v[vertical]*Math.sin(start),
  u[horizontal]*Math.cos(start)+v[horizontal]*Math.sin(start));
 return {scale,handedness,angle};
}

/** With `arcs` (the visible arcs of an exact drawing, per view), an authored curve is visible where an
 * exact arc of the same centre and radius is; otherwise where its tessellation chords are. */
export function assemblyDrawingCurves(
 doc:CadDocument,edges:AssemblyDrawingEdge[],paperPoint:(view:View,world:Vec3)=>SketchPoint,arcs?:PaperArc[][]
){
 const grouped=new Map<string,AssemblyDrawingEdge[][]>();
 for(const edge of edges){
  const {kind}=doc.nodes[edge.bodyId];
  if(kind!=='cylinder'&&kind!=='extrusion')continue;
  let views=grouped.get(edge.bodyId);
  if(!views){views=[[],[],[]];grouped.set(edge.bodyId,views);}
  views[edge.view].push(edge);
 }
 // An exact drawing draws circles as arcs, not as picked chords: every such body may have curves.
 if(arcs)for(const id of doc.roots){const {kind}=doc.nodes[id];if((kind==='cylinder'||kind==='extrusion')&&!grouped.has(id))grouped.set(id,[[],[],[]]);}
 const result:AssemblyDrawingCurve[]=[];
 for(const [bodyId,views] of grouped){
  const node=doc.nodes[bodyId],data=bodyCurves(node,doc);
  if(!data)continue;
  const {plane,start,end,curves}=data,{transform}=node;
  const world=([x,y]:SketchPoint,station:number)=>localToWorldPoint(sketchPoint(plane,x,y,station),transform);
  for(const [index,edges] of views.entries()){
   if(!edges.length&&!arcs?.[index]?.length)continue;
   const view=index as View,axes=viewAxes(plane,transform,view);
   if(!axes)continue;
   const {depth,near,horizontal}=drawingViews[view];
   const station=world([0,0],end)[depth]*near>world([0,0],start)[depth]*near?end:start;
   const candidates=indexVisibleChords(edges,horizontal);
   for(const curve of curves){
    const {center,radius,segments,source,arc}=curve;
    const angle=arc?.start??0,sweep=arc?.sweep??Math.PI*2;
    const samples=Array.from({length:segments+1},(_,i)=>{
     const a=angle+sweep*i/segments;
     return world([center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a)],station);
    });
    const visible=arcs?exactArcSegments(arcs[index]??[],paperPoint(view,world(center,station)),radius*axes.scale)
     :samples.slice(1).flatMap((b,i)=>candidates(samples[i],b));
    if(!visible.length)continue;
    const anchor:DrawingAnchorPoint={id:'curve',label:'',point:paperPoint(view,world(center,station)),radius:radius*axes.scale};
    if(arc)anchor.arc={start:axes.angle(arc.start),sweep:arc.sweep*axes.handedness};
    result.push({bodyId,view,source,anchor,visible});
   }
  }
 }
 return result;
}

/** Chords on paper of the visible exact arcs with this centre (paper) and radius (model mm). */
function exactArcSegments(arcs:PaperArc[],center:SketchPoint,radius:number):Segment[]{
 const out:Segment[]=[];
 for(const arc of arcs){
  if(Math.hypot(arc.center[0]-center[0],arc.center[1]-center[1])>1e-3||Math.abs(arc.radius-radius)>Math.max(1e-6,radius*1e-6))continue;
  const steps=Math.max(2,Math.ceil(Math.abs(arc.sweep)/(Math.PI/24)));
  const at=(k:number):SketchPoint=>{const a=arc.start+arc.sweep*k/steps;return [arc.center[0]+arc.paperRadius*Math.cos(a),arc.center[1]+arc.paperRadius*Math.sin(a)];};
  for(let i=0;i<steps;i++)out.push([at(i),at(i+1)]);
 }
 return out;
}

/** Match authored tessellation chords against the visible segments from the projection worker. */
function indexVisibleChords(edges:AssemblyDrawingEdge[],axis:number){
 let tolerance=2e-4;
 for(const {world:[a,b]} of edges)tolerance=Math.max(tolerance,...a.map(p=>Math.abs(p)*2e-7),...b.map(p=>Math.abs(p)*2e-7));
 const key=(a:Vec3,b:Vec3)=>Math.floor((a[axis]+b[axis])/(2*tolerance));
 const bins=new Map<number,AssemblyDrawingEdge[]>();
 for(const edge of edges){
  const index=key(...edge.world),bin=bins.get(index);
  if(bin)bin.push(edge);
  else bins.set(index,[edge]);
 }
 const same=(a:Vec3,b:Vec3)=>a.every((v,i)=>Math.abs(v-b[i])<=tolerance);
 return (a:Vec3,b:Vec3)=>{
  const index=key(a,b),visible:Segment[]=[];
  for(const neighbor of [index-1,index,index+1])for(const {world:[from,to],visible:segment} of bins.get(neighbor)??[]){
   if((same(from,a)&&same(to,b))||(same(from,b)&&same(to,a)))visible.push(segment);
  }
  return visible;
 };
}

const sameSource=(a:AssemblyCurveSource,b:AssemblyCurveSource)=>
 a==='cylinder'||b==='cylinder'?a===b:a.sketchId===b.sketchId&&a.profileId===b.profileId&&a.anchor===b.anchor;

export function supportsCurveDimension(curve:AssemblyDrawingCurve,kind:AssemblyCurveDimension['kind']){
 return kind==='radius'||(kind==='arc-length'?!!curve.anchor.arc:!curve.anchor.arc);
}

export function addAssemblyCurveDimensions(page:DrawingLayout,dimensions:AssemblyCurveDimension[]){
 for(const dimension of dimensions){
  const curve=page.assemblyCurves?.find(curve=>curve.bodyId===dimension.bodyId&&curve.view===dimension.view&&
   sameSource(curve.source,dimension.source)&&supportsCurveDimension(curve,dimension.kind));
  const drawing=curve?placeDrawingAnnotation({id:dimension.id,sketchId:'assembly',kind:dimension.kind,from:curve.anchor.id,at:dimension.at},
   'assembly',[curve.anchor],page.factor):undefined;
  if(!drawing){page.annotationIssues.push(dimension.id);continue;}
  for(const points of drawing.paths)page.paths.push({points,stroke:'annotation'});
  page.texts.push({x:drawing.position[0],y:drawing.position[1],text:drawing.text,size:2.8});
 }
}
