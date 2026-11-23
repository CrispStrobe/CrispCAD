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

const arcSweeps=['ccw-minor','cw-minor','ccw-major','cw-major'] as const;
export type OutlineArcSweep=(typeof arcSweeps)[number];
type ArcRadius<Edge,Dimension>={kind:'radius';edge:Edge;radius:Dimension;sweep:OutlineArcSweep};
type ResolvedArcRadius=ArcRadius<number,number>;
export type OutlineRelation=OutlineRule<[string,string],FeatureScalar>|ArcRadius<[string,string],FeatureScalar>;
export type OutlineSolveRequest={points:SketchPoint[];constraints:OutlineRule<number,number>[]};
export const maxConstrainedOutlinePoints=32;
export const maxOutlineRelations=48;

export function outlineArcSweep(bulge:number):OutlineArcSweep{
 return bulge>0?(bulge>1?'ccw-major':'ccw-minor'):(bulge< -1?'cw-major':'cw-minor');
}

export function outlineBulgesForRadii(points:SketchPoint[],bulges:number[]|undefined,radii:readonly ResolvedArcRadius[]):number[]|undefined{
 if(!radii.length)return bulges;
 const result=bulges?.slice()??points.map(()=>0);
 for(const {edge,radius,sweep} of radii){
  const a=points[edge],b=points[(edge+1)%points.length];
  const halfChord=Math.hypot(b[0]-a[0],b[1]-a[1])/2;
  if(halfChord-radius>1e-8+radius*1e-12)throw new Error(t('The arc radius must be at least half its chord length.'));
  const ratio=Math.min(1,halfChord/radius);
  const minor=ratio/(1+Math.sqrt((1-ratio)*(1+ratio)));
  const magnitude=sweep.endsWith('major')?1/minor:minor;
  if(!(magnitude>0&&magnitude<=10000))throw new Error(t('Rounded outline exceeds the curve size or detail limit.'));
  result[edge]=sweep.startsWith('cw-')?-magnitude:magnitude;
 }
 return result;
}

export function outlineRadiiSatisfied(points:SketchPoint[],bulges:number[]|undefined,radii:readonly ResolvedArcRadius[]):boolean{
 if(!radii.length)return true;
 try{
  const expected=outlineBulgesForRadii(points,bulges,radii)!;
  return radii.every(({edge})=>Math.abs((bulges?.[edge]??0)-expected[edge])<=Math.abs(expected[edge])*1e-9);
 }catch{return false;}
}

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
):(OutlineRule<number,number>|ResolvedArcRadius)[]{
 const {points,vertexIds,relations}=profile;
 if(relations===undefined)return [];
 const invalid=()=>new Error(t('Invalid outline constraint definitions.'));
 if(points.length<3||points.length>maxConstrainedOutlinePoints||!Array.isArray(vertexIds)||vertexIds.length!==points.length||
  !Array.isArray(relations)||!relations.length||relations.length>maxOutlineRelations)throw invalid();
 const indexById=new Map(vertexIds.map((id,index)=>[id,index]));
 const radiusEdges=new Set<number>();
 const dimension=(value:FeatureScalar)=>{
  if(typeof value!=='number'&&(typeof value!=='string'||!value.trim()||value.length>160))throw invalid();
  const length=resolveLength(value);
  if(!Number.isFinite(length)||length<.01||length>100000)throw new Error(t('Dimension must be between 0.01 and 100000 mm'));
  return length;
 };
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
   case 'length':return {kind:relation.kind,edge,length:dimension(relation.length)};
   case 'radius':{
    if(!arcSweeps.includes(relation.sweep))throw invalid();
    if(radiusEdges.has(edge))throw new Error(t('An arc can have only one driving radius.'));
    radiusEdges.add(edge);
    return {kind:relation.kind,edge,radius:dimension(relation.radius),sweep:relation.sweep};
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
