// SPDX-License-Identifier: BSD-3-Clause
import {documentGeometryKey,drawingArcId,drawingOutlines,drawingVertexId,evaluateExtrusion,featureValue,isAssemblyDrawingSource,resolveDrawingSource,sketchBulgeArc,sketchPoint,t} from '@brickwright/cad-core';
import type {CadDocument,DrawingInputs,SketchPoint,Vec3} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
import {layoutAssemblyPartsList} from './assembly-parts-list.js';
import type {AssemblyProjection} from './assembly-drawing.js';
import {assemblyProjection,layoutAssemblyDrawing} from './assembly-drawing.js';
import {addDrawingFrame,drawingBorder as border,drawingViews as order} from './drawing-page.js';
import type {DrawingCircle,DrawingLayout,DrawingPath,DrawingText} from './drawing-page.js';
export type {DrawingLayout} from './drawing-page.js';

import {dimensionText,placeDrawingAnnotation} from './drawing-annotation.js';
import type {DrawingAnchorPoint} from './drawing-annotation.js';
import {offsetSectionMaterial,sectionMaterial} from './drawing-section.js';

const label=dimensionText;
const bounds=(points:SketchPoint[])=>{
 const x=points.map(p=>p[0]),y=points.map(p=>p[1]);
 return {left:Math.min(...x),bottom:Math.min(...y),right:Math.max(...x),top:Math.max(...y)};
};

function outlineCorners(points:SketchPoint[],bulges?:number[]){
 const tangent=(index:number,end:boolean):SketchPoint=>{
  const a=points[index],b=points[(index+1)%points.length];
  const arc=sketchBulgeArc(a,b,bulges?.[index]??0);
  if(arc){
   const angle=arc.start+(end?arc.sweep:0)+Math.sign(arc.sweep)*Math.PI/2;
   return [Math.cos(angle),Math.sin(angle)];
  }
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  return [dx/length,dy/length];
 };
 return points.filter((_,index)=>{
  const incoming=tangent((index+points.length-1)%points.length,true),outgoing=tangent(index,false);
  return incoming[0]*outgoing[0]+incoming[1]*outgoing[1]<1-1e-8;
 });
}

export function layoutDrawing(doc:CadDocument,sheet:DrawingInputs,geometry?:GeometryResult|AssemblyProjection):DrawingLayout {
 if(isAssemblyDrawingSource(sheet.source)){
  if(!geometry)throw new Error(t('The assembly drawing needs evaluated geometry.'));
  if(geometry.sourceKey&&geometry.sourceKey!==documentGeometryKey(doc))throw new Error(t('The assembly geometry changed. Refresh the drawing.'));
  return layoutAssemblyDrawing(sheet,assemblyProjection(geometry));
 }
 const source=resolveDrawingSource(doc,sheet.source);
 if(!source)throw new Error(t('Drawing source unavailable. Choose another sketch extrusion.'));
 const {node,sketch}=source;
 const {contour,holes=[],loopIds=[],start,distance}=evaluateExtrusion(node,doc);
 const profile=sketch.profile;
 const circlesByLoop=new Map<string,DrawingCircle>();
 if(profile.kind==='region')for(const loop of profile.loops){
  if(loop.kind!=='circle')continue;
  circlesByLoop.set(loop.id,{
   center:[featureValue(loop.center[0],doc),featureValue(loop.center[1],doc)],
   radius:featureValue(loop.radius,doc)
  });
 }
 const contours=[contour,...holes];
 const circleAt=(i:number)=>profile.kind==='circle'
  ? {center:profile.center??[0,0] as SketchPoint,radius:featureValue(profile.radius,doc)}
  : circlesByLoop.get(loopIds[i]);
 const pointsAt=(i:number)=>{
  const circle=circleAt(i);
  if(!circle)return contours[i];
  const {center:[x,y],radius}=circle;
  return [[x-radius,y],[x+radius,y],[x,y-radius],[x,y+radius]] as SketchPoint[];
 };
 const section=sheet.section?(()=>{
  const axis=sheet.section.axis==='u'?0:1;
  const coordinate=(value:NonNullable<DrawingInputs['section']>['position'])=>{
   const resolved=featureValue(value,doc);
   if(Math.abs(resolved)>100000)throw new Error(t('Section position is outside the sketch coordinate range.'));
   return resolved;
  };
  const cut=coordinate(sheet.section.position);
  const jog=sheet.section.jog?{at:coordinate(sheet.section.jog.at),position:coordinate(sheet.section.jog.position)}:undefined;
  if(jog&&Math.abs(cut-jog.position)<1e-8)throw new Error(t('Choose different positions for the two section legs.'));
  const sectionContours=contours.map((points,i)=>({points,circle:circleAt(i)}));
  const material=jog?offsetSectionMaterial(sectionContours,axis,cut,jog.position,jog.at):sectionMaterial(sectionContours,axis,cut);
  if(!material.length)throw new Error(t('The section plane misses the part. Move the section position.'));
  return {axis,cut,jog,material};
 })():undefined;
 const outline=profile.kind==='region'?profile.loops.find(loop=>loop.id===loopIds[0]):profile;
 const corners=outline?.kind==='outline'?outlineCorners(outline.points,outline.bulges):[];
 const world=([x,y]:SketchPoint,n:number)=>sketchPoint(sketch.plane,x,y,n);
 const boxSamples=pointsAt(0).flatMap(point=>[world(point,start),world(point,start+distance)]);
 const station=sketch.plane==='XY'?2:sketch.plane==='XZ'?1:0;
 const [num,denom]=sheet.scale.split(':').map(Number);
 const factor=num/denom;
 const views=order.map(({view,horizontal,vertical,depth,near})=>{
  const project=(point:Vec3):SketchPoint=>[point[horizontal],point[vertical]];
  const faceOn=horizontal!==station&&vertical!==station;
  const limits=bounds(boxSamples.map(project));
  const width=limits.right-limits.left,height=limits.top-limits.bottom;
  const drawings:DrawingPath[]=[],circles:DrawingCircle[]=[];
  const line=(points:SketchPoint[],stroke:DrawingPath['stroke'],closed?:boolean)=>drawings.push({points,stroke,closed});
  if(faceOn){
   for(const [i,loop] of contours.entries()){
    const circle=circleAt(i);
    if(!circle){
     line(loop.map(point=>project(world(point,start))),'visible',true);
     continue;
    }
    const center=project(world(circle.center,start)),[x,y]=center;
    const radius=circle.radius,arm=Math.min(radius*.65,2/factor);
    circles.push({center,radius});
    line([[x-arm,y],[x+arm,y]],'center');
    line([[x,y-arm],[x,y+arm]],'center');
   }
  }else{
   line(border(limits.left,limits.bottom,width,height),'visible',true);
   const axis=horizontal===station?vertical:horizontal;
   const min=axis===horizontal?limits.left:limits.bottom,max=axis===horizontal?limits.right:limits.top;
   const axialEdges=new Map<number,'visible'|'hidden'>();
   const addEdge=(value:number,stroke:'visible'|'hidden')=>{
    if(value<=min+1e-7||value>=max-1e-7)return;
    const key=Number(value.toFixed(8));
    if(axialEdges.get(key)!=='visible')axialEdges.set(key,stroke);
   };
   if(corners.length){
    const boundary=contour.map(point=>world(point,start));
    for(const point of corners){
     const vertex=world(point,start),coordinate=vertex[axis];
     const blocked=boundary.some((a,i)=>{
      const b=boundary[(i+1)%boundary.length];
      if(coordinate<Math.min(a[axis],b[axis])-1e-8||coordinate>Math.max(a[axis],b[axis])+1e-8)return false;
      const delta=b[axis]-a[axis];
      if(Math.abs(delta)<1e-8)return Math.max(a[depth]*near,b[depth]*near)>vertex[depth]*near+1e-7;
      const t=(coordinate-a[axis])/delta;
      return (a[depth]+t*(b[depth]-a[depth]))*near>vertex[depth]*near+1e-7;
     });
     addEdge(coordinate,blocked?'hidden':'visible');
    }
   }
   for(const [index] of holes.entries()){
    const coordinates=pointsAt(index+1).map(point=>world(point,start)[axis]);
    addEdge(Math.min(...coordinates),'hidden');addEdge(Math.max(...coordinates),'hidden');
   }
   for(const [value,stroke] of axialEdges){
    if(stroke==='hidden'&&!sheet.hiddenLines)continue;
    if(axis===horizontal)line([[value,limits.bottom],[value,limits.top]],stroke);
    else line([[limits.left,value],[limits.right,value]],stroke);
   }
  }
  return {view,width,height,limits,drawings,circles,faceOn,project};
 });

 const [top,front,right]=views;
 const minX=26,baseline=48,gap=24;
 const rightX=minX+front.width*factor+gap,topY=baseline+front.height*factor+gap;
 if(rightX+right.width*factor>282||topY+top.height*factor>170){
  throw new Error(t('This drawing does not fit on A4 at this scale. Choose a smaller scale.'));
 }
 const paths:DrawingPath[]=[],texts:DrawingText[]=[],circles:DrawingCircle[]=[];
 const anchors:DrawingAnchorPoint[]=[];
 const addPath=(stroke:DrawingPath['stroke'],points:SketchPoint[],closed?:boolean)=>paths.push({stroke,points,closed});
 const addText=(x:number,y:number,text:string,size=3)=>texts.push({x,y,text,size});
 for(const [view,x,y] of [[top,minX,topY],[front,minX,baseline],[right,rightX,baseline]] as const){
  const {limits,width,height}=view,w=width*factor,h=height*factor;
  for(const path of view.drawings)addPath(path.stroke,path.points.map(([a,b])=>[x+(a-limits.left)*factor,y+(b-limits.bottom)*factor]),path.closed);
  for(const circle of view.circles){
   const [a,b]=circle.center;
   circles.push({center:[x+(a-limits.left)*factor,y+(b-limits.bottom)*factor],radius:circle.radius*factor});
  }
  if(view.faceOn){
   anchors.push(
    {id:'bounds:sw',label:t('Lower-left profile bounds'),point:[x,y]},
    {id:'bounds:se',label:t('Lower-right profile bounds'),point:[x+w,y]},
    {id:'bounds:nw',label:t('Upper-left profile bounds'),point:[x,y+h]},
    {id:'bounds:ne',label:t('Upper-right profile bounds'),point:[x+w,y+h]}
   );
   // The face-on view projects the positive sketch axes onto paper X and Y.
   const paper=(point:SketchPoint):SketchPoint=>{
    const [u,v]=view.project(world(point,start));
    return [x+(u-limits.left)*factor,y+(v-limits.bottom)*factor];
   };
   const addCircleAnchor=(id:string,label:string,circle:DrawingCircle)=>{
    anchors.push({id:'circle:'+id,label,radius:circle.radius,point:paper(circle.center)});
   };
   if(profile.kind==='circle')addCircleAnchor(profile.id,t('Circle center'),circleAt(0)!);
   const outlines=drawingOutlines(profile);
   for(const [loopIndex,outline] of outlines.entries()){
    for(const [index,point] of outline.points.entries()){
     const coordinates=point.map(dimensionText).join(', ');
     const name=profile.kind==='region'
      ? t`Outline ${loopIndex+1}, point ${index+1} (${coordinates})`
      : t`Outline point ${index+1} (${coordinates})`;
     anchors.push({id:drawingVertexId(outline,index),label:name,point:paper(point)});
     const next=(index+1)%outline.points.length;
     const arc=sketchBulgeArc(point,outline.points[next],outline.bulges?.[index]??0);
     if(arc){
      const label=profile.kind==='region'
       ?t`Outline ${loopIndex+1}, arc ${index+1}`
       :t`Arc ${index+1}`;
      anchors.push({id:drawingArcId(outline,index),label,point:paper(arc.center),radius:arc.radius,
       arc:{start:arc.start,sweep:arc.sweep}});
     }
    }
   }
   let holeIndex=0;
   for(const [id,circle] of circlesByLoop){
    const name=id===loopIds[0]?t('Outer circle'):t`Hole ${++holeIndex}`;
    addCircleAnchor(id,name,circle);
   }
  }
  if(section&&view.faceOn){
   const axis=section.axis,across=axis===0?1:0;
   const span=pointsAt(0).map(point=>point[across]);
   const place=(other:number,position:number,offset=0):SketchPoint=>{
    const cut=position+offset/factor;
    const [u,v]=view.project(world(axis===0?[cut,other]:[other,cut],start));
    return [x+(u-limits.left)*factor,y+(v-limits.bottom)*factor];
   };
   const {cut,jog}=section,second=jog?.position??cut;
   const firstEnd=Math.min(...span)-3/factor,lastEnd=Math.max(...span)+3/factor;
   addPath('cut',[place(firstEnd,cut),...(jog?[place(jog.at,cut),place(jog.at,second)]:[]),place(lastEnd,second)]);
   const direction=axis===0?-1:1;
   for(const [end,position] of [[firstEnd,cut],[lastEnd,second]]){
    addPath('visible',[place(end-1.1/factor,position,-direction*2),place(end,position,direction*2),place(end+1.1/factor,position,-direction*2)]);
    const [mx,my]=place(end,position,-direction*3);
    addText(mx+1,my+1,'A',2.8);
   }
  }
  addText(x,y+h+4,t(view.view),3.5);
  const bottom=y-6,left=x-7;
  addPath('dimension',[[x,y-1],[x,bottom],[x+w,bottom],[x+w,y-1]]);
  addPath('dimension',[[x-1,bottom-1],[x+1,bottom+1]]);
  addPath('dimension',[[x+w-1,bottom-1],[x+w+1,bottom+1]]);
  addText(x+1,bottom-5,label(width)+' mm',2.5);
  addPath('dimension',[[x-1,y],[left,y],[left,y+h],[x-1,y+h]]);
  addPath('dimension',[[left-1,y-1],[left+1,y+1]]);
  addPath('dimension',[[left-1,y+h-1],[left+1,y+h+1]]);
  addText(left-9,y+h/2,label(height),2.5);
 }
 if(section){
  const {material,axis,cut,jog}=section;
  const left=material[0][0],right=material.at(-1)![1];
  const height=distance*factor,width=(right-left)*factor;
  if(rightX+width>282||topY+height>166){
   throw new Error(t('This drawing does not fit on A4 at this scale. Choose a smaller scale.'));
  }
  for(const [start,end] of material){
   const x=rightX+(start-left)*factor,y=topY,w=(end-start)*factor;
   addPath('section',border(x,y,w,height),true);
   for(let intercept=Math.floor((x-height)/3)*3;intercept<x+w;intercept+=3){
    const left=Math.max(x,intercept),right=Math.min(x+w,intercept+height);
    if(right-left>1e-6)addPath('hatch',[[left,y+left-intercept],[right,y+right-intercept]]);
   }
  }
  addText(rightX,topY+height+4,t(jog?'Offset section A-A':'Section A-A'),3.5);
  const coordinate=axis===0?t('Sketch X'):t('Sketch Y');
  addText(rightX,topY+height+9,coordinate+' = '+label(cut)+(jog?' / '+label(jog.position):'')+' mm',2.8);
 }
 addDrawingFrame({paths,texts},sheet.title,t`Sketch extrusion · ${sketch.name}`,sheet.scale);
 const diameters=new Map<string,number>();
 for(const id of loopIds.slice(1)){
  const circle=circlesByLoop.get(id);
  if(!circle)continue;
  const {radius}=circle;
  const diameter=label(radius*2);
  diameters.set(diameter,(diameters.get(diameter)??0)+1);
 }
 for(const [index,[diameter,count]] of [...diameters.entries()].entries()){
  addText(15+54*(index%5),34-Math.floor(index/5)*3.2,t`${count} × Ø${diameter} mm`,2.5);
 }
 const annotationIssues:string[]=[];
 for(const annotation of sheet.annotations??[]){
  const drawing=placeDrawingAnnotation(annotation,sketch.id,anchors,factor);
  if(!drawing){
   annotationIssues.push(annotation.id);
   continue;
  }
  for(const points of drawing.paths)addPath('annotation',points);
  addText(...drawing.position,drawing.text,2.8);
 }
 return {width:297,height:210,paths,texts,circles,anchors,annotationIssues,factor};
}

export function layoutDrawingPages(doc:CadDocument,sheet:DrawingInputs,geometry?:GeometryResult|AssemblyProjection){
 const primary=layoutDrawing(doc,sheet,geometry);
 if(!sheet.partsList||!isAssemblyDrawingSource(sheet.source)||!geometry)return [primary];
 return [primary,...layoutAssemblyPartsList(doc,sheet,assemblyProjection(geometry))];
}
