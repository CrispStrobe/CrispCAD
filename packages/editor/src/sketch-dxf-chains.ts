// SPDX-License-Identifier: BSD-3-Clause
import {isSketchPoint,maxSketchOutlinePoints,sketchDxfLayerFields,sketchOutline,sketchPath,t} from '@brickwright/cad-core';
import type {SketchDxfLayer,SketchPoint} from '@brickwright/cad-core';

export type DxfEdge = {a:SketchPoint; b:SketchPoint; bulge:number; index:number}&SketchDxfLayer;
type Chain={index:number;points:SketchPoint[];bulges?:number[]}&SketchDxfLayer;
const endpointTolerance=1e-6;

export function joinDxfEdges(input:DxfEdge[],mode:'outline'|'path') {
 const closed=mode==='outline';
 const invalid=()=>new Error(closed
  ?t('DXF lines and arcs must join into closed loops without branches or duplicate edges.')
  :t('DXF lines and arcs must join into one open path without branches or duplicate edges.'));
 const coordinates:SketchPoint[]=[],adjacent:number[][]=[];
 const buckets=new Map<string,number[]>();
 function vertex(point:SketchPoint){
  if(!isSketchPoint(point))throw invalid();
  const x=Math.floor(point[0]/endpointTolerance),y=Math.floor(point[1]/endpointTolerance);
  let nearest=-1,distance=endpointTolerance;
  for(let i=x-1;i<=x+1;i++)for(let j=y-1;j<=y+1;j++){
   for(const id of buckets.get(i+':'+j)??[]){
    const other=coordinates[id],d=Math.hypot(other[0]-point[0],other[1]-point[1]);
    if(d<=distance){nearest=id;distance=d;}
   }
  }
  if(nearest>=0)return nearest;
  const id=coordinates.length,key=x+':'+y;
  const bucket=buckets.get(key)??[];
  bucket.push(id);buckets.set(key,bucket);
  coordinates.push(point);adjacent.push([]);
  return id;
 }
 const edges=input.map((edge,id)=>{
  const start=vertex(edge.a),end=vertex(edge.b);
  if(start===end)throw invalid();
  adjacent[start].push(id);adjacent[end].push(id);
  return {...edge,start,end};
 });
 if(adjacent.some(connected=>connected.length>2||closed&&connected.length!==2))throw invalid();
 const used=new Set<number>();

 function trace(origin:number,firstId:number):Chain{
  const points:SketchPoint[]=[],bulges:number[]=[];
  const first=edges[firstId],layer=first.dxfLayer?.toUpperCase();
  let at=origin,next:number|undefined=firstId;
  while(next!==undefined){
   if(used.has(next)||points.length>=maxSketchOutlinePoints)throw invalid();
   const edge=edges[next],forward=edge.start===at;
   if(edge.dxfLayer?.toUpperCase()!==layer)throw new Error(closed
    ?t('Use the same DXF layer for every line and arc in a closed loop.')
    :t('Use the same DXF layer for every line and arc in an open path.'));
   used.add(next);
   points.push(coordinates[at]);
   bulges.push((forward?edge.bulge:-edge.bulge)||0);
   at=forward?edge.end:edge.start;
   if(at===origin)break;
   next=adjacent[at].find(candidate=>!used.has(candidate));
  }
  if(closed&&at!==origin||!closed&&at===origin)throw invalid();
  if(!closed){points.push(coordinates[at]);bulges.push(0);}
  const curved=bulges.some(Boolean),curves=curved?bulges:undefined;
  if(closed&&points.length<(curved?2:3))throw invalid();
  const normalized=closed?sketchOutline(points,curves):sketchPath(points,curves);
  return {index:first.index,points:closed&&!curved?normalized:points,
   ...(curves?{bulges:curves}:{}),...sketchDxfLayerFields(first)};
 }

 if(!closed){
  const terminals=adjacent.flatMap((adjacentEdges,i)=>adjacentEdges.length===1?[i]:[]);
  if(terminals.length!==2)throw invalid();
  const start=terminals[0],path=trace(start,adjacent[start][0]);
  if(used.size!==edges.length)throw invalid();
  return [path];
 }
 const loops:Chain[]=[];
 for(const [id,edge] of edges.entries())if(!used.has(id))loops.push(trace(edge.start,id));
 return loops;
}
