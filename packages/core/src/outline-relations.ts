// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import type {FeatureScalar} from './features.js';
import type {SketchOutlineProfile} from './sketch-region.js';
import {isSketchPoint} from './sketch-outline.js';
import type {SketchPoint} from './sketch-outline.js';

export type OutlineRule<Edge,Length> =
 {kind:'horizontal'|'vertical';edge:Edge} |
 {kind:'length';edge:Edge;length:Length} |
 {kind:'parallel'|'perpendicular'|'equal';edge:Edge;other:Edge};

export type OutlineRelation=OutlineRule<[string,string],FeatureScalar>;
export type OutlineSolveRequest={points:SketchPoint[];constraints:OutlineRule<number,number>[]};
export const maxConstrainedOutlinePoints=32;
export const maxOutlineRelations=48;

export function outlineSatisfiesRelations(request:OutlineSolveRequest,points:SketchPoint[]):boolean{
 if(!Array.isArray(points)||points.length!==request.points.length||!points.every(isSketchPoint)||
   points[0].some((value,axis)=>value!==request.points[0][axis]))return false;
 const tolerance=1e-6;
 const edges=points.map(([x,y],index)=>{
  const next=points[(index+1)%points.length],dx=next[0]-x,dy=next[1]-y;
  return {dx,dy,length:Math.hypot(dx,dy)};
 });
 return request.constraints.every(constraint=>{
  const a=edges[constraint.edge];
  switch(constraint.kind){
   case 'horizontal':return Math.abs(a.dy)<=tolerance;
   case 'vertical':return Math.abs(a.dx)<=tolerance;
   case 'length':return Math.abs(a.length-constraint.length)<=tolerance;
   default:{
    const b=edges[constraint.other];
    if(constraint.kind==='equal')return Math.abs(a.length-b.length)<=tolerance;
    const norm=a.length*b.length;
    if(norm<=tolerance*tolerance)return false;
    const residual=constraint.kind==='parallel'?a.dx*b.dy-a.dy*b.dx:a.dx*b.dx+a.dy*b.dy;
    return Math.abs(residual/norm)<=tolerance;
   }
  }
 });
}

export function outlineRelationsForSolve(
 profile:Pick<SketchOutlineProfile,'points'|'vertexIds'|'relations'>,
 resolveLength:(length:FeatureScalar)=>number
):OutlineRule<number,number>[]{
 const {points,vertexIds,relations}=profile;
 if(relations===undefined)return [];
 const invalid=()=>new Error(t('Invalid outline constraint definitions.'));
 if(points.length<3||points.length>maxConstrainedOutlinePoints||!Array.isArray(vertexIds)||vertexIds.length!==points.length||
  !Array.isArray(relations)||!relations.length||relations.length>maxOutlineRelations)throw invalid();
 const indexById=new Map(vertexIds.map((id,index)=>[id,index]));
 const indexOf=(edge:unknown)=>{
  if(!Array.isArray(edge)||edge.length!==2||edge.some(id=>typeof id!=='string'))throw invalid();
  const index=indexById.get(edge[0]);
  if(index===undefined||edge[1]!==vertexIds[(index+1)%points.length])throw invalid();
  return index;
 };
 return Array.from(relations,relation=>{
  if(!relation||typeof relation!=='object'||Array.isArray(relation))throw invalid();
  const edge=indexOf(relation.edge);
  switch(relation.kind){
   case 'horizontal':
   case 'vertical':return {kind:relation.kind,edge};
   case 'length':{
    if(typeof relation.length!=='number'&&(typeof relation.length!=='string'||!relation.length.trim()||relation.length.length>160))throw invalid();
    const length=resolveLength(relation.length);
    if(!Number.isFinite(length)||length<.01||length>100000)throw new Error(t('Dimension must be between 0.01 and 100000 mm'));
    return {kind:relation.kind,edge,length};
   }
   case 'parallel':
   case 'perpendicular':
   case 'equal':{
    const other=indexOf(relation.other);
    if(edge===other)throw invalid();
    return {kind:relation.kind,edge,other};
   }
   default:throw invalid();
  }
 });
}
