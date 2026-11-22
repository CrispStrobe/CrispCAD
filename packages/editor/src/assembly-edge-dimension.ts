// SPDX-License-Identifier: BSD-3-Clause
import {localToWorldPoint,worldToLocalPoint} from '@brickwright/cad-core';
import type {AssemblyEdgeDimension,CadDocument,SketchPoint,Vec3} from '@brickwright/cad-core';
import type {AssemblyProjection} from './assembly-drawing.js';
import {placeDrawingAnnotation} from './drawing-annotation.js';
import type {DrawingLayout} from './drawing-page.js';
import {drawingViews} from './drawing-page.js';

export type AssemblyDrawingEdge={
 bodyId:string; view:AssemblyEdgeDimension['view']; world:[Vec3,Vec3];
 visible:[SketchPoint,SketchPoint]; projected:[SketchPoint,SketchPoint];
};

export function assemblyDrawingEdges(projection:AssemblyProjection,placements:readonly (readonly [AssemblyProjection['views'][number],number,number])[],factor:number){
 const edges:AssemblyDrawingEdge[]=[];
 for(const [index,[view,left,bottom]] of placements.entries()){
  const {horizontal,vertical}=drawingViews[index],{origin}=projection;
  const point=(u:number,v:number):SketchPoint=>[left+u*factor,bottom+v*factor];
  const projected=(world:Vec3)=>point(world[horizontal]-origin[horizontal],world[vertical]-origin[vertical]);
  const {edgePicks:data}=view;
  for(let i=0;i<data.length;i+=11){
   const a:Vec3=[data[i+1],data[i+2],data[i+3]],b:Vec3=[data[i+4],data[i+5],data[i+6]];
   edges.push({bodyId:projection.bodyIds[data[i]],view:index as AssemblyDrawingEdge['view'],world:[a,b],
    visible:[point(data[i+7],data[i+8]),point(data[i+9],data[i+10])],projected:[projected(a),projected(b)]});
  }
 }
 return edges;
}

export function pickAssemblyEdge<T extends Pick<AssemblyDrawingEdge,'visible'>>(edges:T[],point:SketchPoint,tolerance:number){
 let picked:T|undefined,distance=tolerance;
 for(const edge of edges){
  const [a,b]=edge.visible,dx=b[0]-a[0],dy=b[1]-a[1];
  const span=dx*dx+dy*dy;
  if(!span)continue;
  const along=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/span));
  const separation=Math.hypot(point[0]-a[0]-along*dx,point[1]-a[1]-along*dy);
  if(separation<distance){distance=separation;picked=edge;}
 }
 return picked;
}

export function saveAssemblyEdge(edge:AssemblyDrawingEdge,doc:CadDocument,at:SketchPoint,id:string):AssemblyEdgeDimension{
 const {bodyId,view}=edge,transform=doc.nodes[bodyId].transform;
 const [a,b]=edge.world;
 return {id,bodyId,view,at,endpoints:[worldToLocalPoint(a,transform),worldToLocalPoint(b,transform)]};
}

export function addAssemblyEdgeDimensions(page:DrawingLayout,doc:CadDocument,dimensions:AssemblyEdgeDimension[]){
 const matches=(a:Vec3,b:Vec3)=>a.every((coordinate,i)=>
  Math.abs(coordinate-b[i])<=Math.max(2e-4,Math.abs(coordinate)*2e-7));
 for(const item of dimensions){
  const transform=doc.nodes[item.bodyId]?.transform;
  const world=transform?item.endpoints.map(point=>localToWorldPoint(point,transform)):undefined;
  const edge=world?page.assemblyEdges?.find(edge=>edge.bodyId===item.bodyId&&edge.view===item.view&&
   ((matches(edge.world[0],world[0])&&matches(edge.world[1],world[1]))||
    (matches(edge.world[1],world[0])&&matches(edge.world[0],world[1])))):undefined;
  const drawing=edge?placeDrawingAnnotation({id:item.id,sketchId:'assembly',kind:'aligned',from:'a',to:'b',at:item.at},
   'assembly',edge.projected.map((point,index)=>({id:index?'b':'a',point,label:''})),page.factor):undefined;
  if(!drawing){page.annotationIssues.push(item.id);continue;}
  for(const points of drawing.paths)page.paths.push({points,stroke:'annotation'});
  page.texts.push({x:drawing.position[0],y:drawing.position[1],text:drawing.text,size:2.8});
 }
}
