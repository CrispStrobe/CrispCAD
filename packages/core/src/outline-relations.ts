// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import type {FeatureScalar} from './features.js';
import type {SketchOutlineProfile} from './sketch-region.js';

export type OutlineRule<Edge,Length> =
 {kind:'horizontal'|'vertical';edge:Edge} |
 {kind:'length';edge:Edge;length:Length} |
 {kind:'parallel'|'perpendicular'|'equal';edge:Edge;other:Edge};

export type OutlineRelation=OutlineRule<[string,string],FeatureScalar>;
export const maxConstrainedOutlinePoints=32;
export const maxOutlineRelations=48;

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
