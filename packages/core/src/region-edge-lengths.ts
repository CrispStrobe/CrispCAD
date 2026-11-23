// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import {regionLoopEdgeIndex,sketchOutlineProfiles} from './sketch-region.js';
import {isOutlineCurveRule,maxConstrainedOutlinePoints,maxOutlineRelations,outlineBulgesForCurves,outlineRelationsForSolve,outlineSatisfiesRelations} from './outline-relations.js';
import type {FeatureScalar} from './features.js';
import type {RegionPlacementEdge,SketchOutlineProfile,SketchRegionProfile} from './sketch-region.js';
import type {OutlineDragTarget,OutlineSolveRequest} from './outline-relations.js';
import {isSketchPoint} from './sketch-outline.js';
import type {SketchPoint} from './sketch-outline.js';

export type RegionEdgeMatch={reference:string;referenceEdge:RegionPlacementEdge;target:string;targetEdge:RegionPlacementEdge};
type Match={reference:string;referenceIndex:number;targetIndex:number};
type Solve=(request:OutlineSolveRequest,signal:AbortSignal,target?:OutlineDragTarget)=>Promise<SketchPoint[]>;

function straightEdge(loop:SketchOutlineProfile,edge:RegionPlacementEdge):number{
 const index=regionLoopEdgeIndex(loop,edge);
 if(index<0)throw new Error(t('An edge length match refers to a missing edge.'));
 if(loop.bulges?.[index]||loop.relations?.some(rule=>isOutlineCurveRule(rule)&&regionLoopEdgeIndex(loop,rule.edge)===index))
  throw new Error(t('Match lengths between straight edges.'));
 return index;
}
function edgeLength(loop:SketchOutlineProfile,index:number):number{
 const a=loop.points[index],b=loop.points[(index+1)%loop.points.length];
 const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
 if(length<.01||length>100000)throw new Error(t('Dimension must be between 0.01 and 100000 mm'));
 return length;
}

function matchPlan(profile:SketchRegionProfile){
 const loops=new Map(sketchOutlineProfiles(profile).map(loop=>[loop.id,loop]));
 const matches=new Map<string,Match[]>();
 const saved=profile.edgeMatches;
 if(saved===undefined)return {loops,matches,order:[]};
 const invalid=()=>new Error(t('Invalid region edge length match.'));
 if(!Array.isArray(saved)||!saved.length||saved.length>maxOutlineRelations)throw invalid();
 for(const match of saved){
  if(!match||typeof match.reference!=='string'||typeof match.target!=='string'||match.reference===match.target)throw invalid();
  const reference=loops.get(match.reference),target=loops.get(match.target);
  if(!reference||!target)throw invalid();
  const referenceIndex=straightEdge(reference,match.referenceEdge),targetIndex=straightEdge(target,match.targetEdge);
  if(target.points.length<3||target.points.length>maxConstrainedOutlinePoints||!target.points.every(isSketchPoint))
   throw new Error(t('Region length matches can move outlines with 3–32 points.'));
  const group=matches.get(target.id)??[];
  if(group.some(item=>item.targetIndex===targetIndex))throw new Error(t('A straight edge can have only one region length reference.'));
  group.push({reference:reference.id,referenceIndex,targetIndex});
  matches.set(target.id,group);
 }
 const visiting=new Set<string>(),visited=new Set<string>(),order:string[]=[];
 function visit(id:string){
  if(visited.has(id)||!matches.has(id))return;
  if(visiting.has(id))throw new Error(t('Region edge length matches cannot contain a cycle.'));
  visiting.add(id);
  for(const match of matches.get(id)!)visit(match.reference);
  visiting.delete(id);
  visited.add(id);order.push(id);
 }
 for(const id of matches.keys())visit(id);
 return {loops,matches,order};
}

export function regionEdgeLengthsMatch(profile:SketchRegionProfile):boolean{
 if(profile.edgeMatches===undefined)return true;
 const {loops,matches}=matchPlan(profile);
 for(const [id,group] of matches){
  if(group.some(match=>Math.abs(edgeLength(loops.get(id)!,match.targetIndex)-edgeLength(loops.get(match.reference)!,match.referenceIndex))>1e-6))return false;
 }
 return true;
}

/** Solve reference loops in dependency order before driving their dependent edges. */
export async function solveRegionEdgeLengths(
 profile:SketchRegionProfile,resolve:(value:FeatureScalar)=>number,solve:Solve,signal:AbortSignal,
 drag?:OutlineDragTarget&{loopId:string},
):Promise<SketchRegionProfile>{
 if(profile.edgeMatches===undefined&&!drag)return profile;
 const {loops,matches,order}=matchPlan(profile);
 if(drag){
  const loop=loops.get(drag.loopId);
  if(!loop||!Number.isInteger(drag.index)||drag.index<1||drag.index>=loop.points.length||!isSketchPoint(drag.point))
   throw new Error(t('The drag target is outside the sketch coordinate limits.'));
  if(!matches.has(drag.loopId))order.unshift(drag.loopId);
 }
 let changed=false;
 for(const id of order){
  signal.throwIfAborted();
  const loop=loops.get(id)!;
  const target=drag?.loopId===id?{index:drag.index,point:drag.point}:undefined;
  const driven=(matches.get(id)??[]).map(match=>({kind:'length' as const,edge:match.targetIndex,length:edgeLength(loops.get(match.reference)!,match.referenceIndex)}));
  if(!target&&driven.every(rule=>Math.abs(edgeLength(loop,rule.edge)-rule.length)<=1e-6))continue;
  const rules=outlineRelationsForSolve(loop,resolve);
  const request:OutlineSolveRequest={points:loop.points,constraints:[...rules.filter(rule=>!isOutlineCurveRule(rule)),...driven]};
  if(request.constraints.length>maxOutlineRelations)throw new Error(t('Too many outline constraints to solve this region match.'));
  const points=request.constraints.length?await solve(structuredClone(request),signal,target):
   loop.points.map((point,index)=>target?.index===index?target.point:point);
  signal.throwIfAborted();
  if(!outlineSatisfiesRelations(request,points))throw new Error(t('The solved outline did not meet every constraint.'));
  const bulges=outlineBulgesForCurves(points,loop.bulges,rules.filter(isOutlineCurveRule));
  loops.set(id,{...loop,points:structuredClone(points),...(bulges?{bulges}:{})});
  changed=true;
 }
 return changed?{...profile,loops:profile.loops.map(loop=>loops.get(loop.id)??loop)}:profile;
}
