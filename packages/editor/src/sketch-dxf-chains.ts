// SPDX-License-Identifier: BSD-3-Clause
import {isSketchPoint,maxSketchOutlinePoints,sketchOutline,t} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';

export type DxfEdge = {a:SketchPoint; b:SketchPoint; bulge:number; index:number; dxfLayer?:string};
const endpointTolerance=1e-6;

export function joinDxfEdges(input:DxfEdge[]) {
 const invalid=()=>new Error(t('DXF lines and arcs must join into closed loops without branches or duplicate edges.'));
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
 if(adjacent.some(connected=>connected.length!==2))throw invalid();
 const used=new Set<number>();
 const loops=[];
 for(const [id,first] of edges.entries()){
  if(used.has(id))continue;
  const points:SketchPoint[]=[],bulges:number[]=[];
  const origin=first.start,layer=first.dxfLayer?.toUpperCase();
  let at=origin,next=id;
  do{
   if(used.has(next)||points.length>=maxSketchOutlinePoints)throw invalid();
   const edge=edges[next],forward=edge.start===at;
   if(edge.dxfLayer?.toUpperCase()!==layer)throw new Error(t('Use the same DXF layer for every line and arc in a closed loop.'));
   used.add(next);
   points.push(coordinates[at]);bulges.push(forward?edge.bulge:-edge.bulge);
   at=forward?edge.end:edge.start;
   next=adjacent[at].find(candidate=>candidate!==next)!;
  }while(at!==origin);
  const curved=bulges.some(Boolean);
  if(points.length<(curved?2:3))throw invalid();
  const outline=sketchOutline(points,curved?bulges:undefined);
  loops.push({index:first.index,kind:'outline' as const,points:curved?points:outline,
   ...(curved?{bulges:bulges.map(value=>value===0?0:value)}:{}),
   ...(first.dxfLayer?{dxfLayer:first.dxfLayer}:{})});
 }
 return loops;
}
