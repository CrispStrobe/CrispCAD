// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import {checkSketchDxfLayer} from './sketch-dxf-layer.js';
import type {SketchDxfLayer} from './sketch-dxf-layer.js';
import {checkSketchDxfWidths} from './sketch-dxf-width.js';
import type {SketchDxfWidths} from './sketch-dxf-width.js';
import {isSketchPoint,maxSketchOutlinePoints,sketchBulgeMidpoint,sketchOutline,sketchSegmentsIntersect} from './sketch-outline.js';
import type {OutlineRelation} from './outline-relations.js';
import type {RegionEdgeMatch} from './region-edge-lengths.js';
import type {FeatureScalar,SketchProfile} from './features.js';
import type {SketchPoint} from './sketch-outline.js';

export type SketchOutlineProfile = {kind:'outline'; id:string; points:SketchPoint[]; bulges?:number[]; vertexIds?:string[]; relations?:OutlineRelation[]}&SketchDxfLayer&SketchDxfWidths;

export type SketchLoop =
  | SketchOutlineProfile
  | SketchCircleLoop;

export type RegionPlacementEdge=[string,string];
export type RegionLoopPlacement={
  target:string;reference:string;offset:[FeatureScalar,FeatureScalar];
  targetEdge?:RegionPlacementEdge;referenceEdge?:RegionPlacementEdge;
};
export type SketchRegionProfile={kind:'region';id:string;loops:SketchLoop[];placements?:RegionLoopPlacement[];edgeMatches?:RegionEdgeMatch[]};

type SketchCircleLoop = {kind: 'circle'; id: string; center: [FeatureScalar, FeatureScalar]; radius: FeatureScalar; segments: number}&SketchDxfLayer;
type ResolvedCircle = Omit<SketchCircleLoop, 'center' | 'radius'> & {center: SketchPoint; radius: number};

export const maxSketchRegionLoops = 16;
export function sketchOutlineProfiles(profile:SketchProfile):SketchOutlineProfile[]{
  if(profile?.kind==='outline')return [profile];
  if(profile?.kind!=='region'||!Array.isArray(profile.loops)||profile.loops.length>maxSketchRegionLoops)return [];
  return profile.loops.filter(loop=>loop?.kind==='outline');
}
export function hasOutlineRelations(profile:SketchProfile):boolean{
  return sketchOutlineProfiles(profile).some(outline=>outline.relations!==undefined);
}
export function hasSketchConstraints(profile:SketchProfile):boolean{
  return hasOutlineRelations(profile)||(profile.kind==='region'&&(profile.placements!==undefined||profile.edgeMatches!==undefined));
}

export function regionLoopEdgeIndex(loop:SketchOutlineProfile,edge:RegionPlacementEdge):number{
  if(!Array.isArray(edge)||edge.length!==2||!edge.every(id=>typeof id==='string')||
    !Array.isArray(loop.vertexIds)||!Array.isArray(loop.points)||loop.points.length!==loop.vertexIds.length)return -1;
  const start=loop.vertexIds.indexOf(edge[0]),end=(start+1)%loop.points.length;
  return start>=0&&loop.vertexIds[end]===edge[1]&&isSketchPoint(loop.points[start])&&isSketchPoint(loop.points[end])?start:-1;
}

export function regionLoopAnchor(loop:SketchOutlineProfile,edge?:RegionPlacementEdge):SketchPoint{
  if(edge===undefined&&isSketchPoint(loop.points?.[0]))return loop.points[0];
  if(edge!==undefined){
    const start=regionLoopEdgeIndex(loop,edge);
    if(start>=0)return sketchBulgeMidpoint(loop.points[start],loop.points[(start+1)%loop.points.length],loop.bulges?.[start]??0);
  }
  throw new Error(t('A region position refers to a missing edge. Restore the edge or remove its position.'));
}

/** Translate each target so its anchor follows the reference anchor. */
export function positionRegionLoops(profile:SketchRegionProfile,resolve:(value:FeatureScalar)=>number):SketchRegionProfile{
  if(profile.placements===undefined)return profile;
  const invalidPlacement=()=>new Error(t('Invalid region loop position. Choose two distinct outline loops.'));
  const outlines=new Map(sketchOutlineProfiles(profile).map(loop=>[loop.id,loop]));
  if(!Array.isArray(profile.placements)||!profile.placements.length||profile.placements.length>=maxSketchRegionLoops||
     outlines.size<2)throw invalidPlacement();
  const positions=new Map<string,RegionLoopPlacement>();
  for(const placement of profile.placements){
    if(!placement||typeof placement.target!=='string'||typeof placement.reference!=='string'||
      placement.target===placement.reference||
      !outlines.has(placement.target)||!outlines.has(placement.reference)||
      !Array.isArray(placement.offset)||placement.offset.length!==2||
      !placement.offset.every(value=>typeof value==='number'||typeof value==='string'&&value.trim()&&value.length<=160))
      throw invalidPlacement();
    if(positions.has(placement.target))throw new Error(t('A loop can have only one position reference.'));
    positions.set(placement.target,placement);
  }
  const visiting=new Set<string>();
  const moved=new Map<string,SketchOutlineProfile>();
  function position(id:string):SketchOutlineProfile{
    const cached=moved.get(id);
    if(cached)return cached;
    const loop=outlines.get(id)!,placement=positions.get(id);
    if(!placement)return loop;
    if(visiting.has(id))throw new Error(t('Region loop positions cannot contain a cycle.'));
    visiting.add(id);
    const anchor=regionLoopAnchor(position(placement.reference),placement.referenceEdge);
    const origin=regionLoopAnchor(loop,placement.targetEdge);
    if(!isSketchPoint(anchor)||!isSketchPoint(origin)||loop.points.length>maxSketchOutlinePoints||!loop.points.every(isSketchPoint))throw invalidPlacement();
    const x=anchor[0]+resolve(placement.offset[0]),y=anchor[1]+resolve(placement.offset[1]);
    if(!isSketchPoint([x,y]))throw new Error(t('The positioned loop is outside the sketch coordinate range.'));
    const [dx,dy]=[x-origin[0],y-origin[1]];
    if(Math.abs(dx)<=1e-9&&Math.abs(dy)<=1e-9){
      visiting.delete(id);
      moved.set(id,loop);
      return loop;
    }
    const points=loop.points.map(([px,py]):SketchPoint=>[px+dx,py+dy]);
    if(!points.every(isSketchPoint))throw new Error(t('The positioned loop is outside the sketch coordinate range.'));
    const placed={...loop,points};
    moved.set(id,placed);
    visiting.delete(id);
    return placed;
  }
  for(const id of positions.keys())position(id);
  if([...moved].every(([id,loop])=>loop===outlines.get(id)))return profile;
  return {...profile,loops:profile.loops.map(loop=>moved.get(loop.id)??loop)};
}
const maxRegionVertices = 1024;
const invalid = () => new Error(t('A region needs one outside boundary and separate holes that do not touch or cross.'));
const edges = (points: SketchPoint[]) => points.map((point, i) => [point, points[(i + 1) % points.length]] as const);

function inside([x, y]: SketchPoint, polygon: SketchPoint[]) {
  let result = false;
  for (const [[ax, ay], [bx, by]] of edges(polygon)) {
    if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) result = !result;
  }
  return result;
}

function distanceSquared([x,y]: SketchPoint, [ax,ay]: SketchPoint, [bx,by]: SketchPoint) {
  const dx = bx - ax, dy = by - ay;
  const projection = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - projection * dx) ** 2 + (y - ay - projection * dy) ** 2;
}

type ResolvedLoop = {loop: Extract<SketchLoop, {kind: 'outline'}> | ResolvedCircle; points: SketchPoint[]; area: number};

function boundariesTouch(a: ResolvedLoop, b: ResolvedLoop): boolean {
  if (a.loop.kind === 'circle' && b.loop.kind === 'circle') {
    const d = Math.hypot(a.loop.center[0] - b.loop.center[0], a.loop.center[1] - b.loop.center[1]);
    return d <= a.loop.radius + b.loop.radius && d >= Math.abs(a.loop.radius - b.loop.radius);
  }
  if (a.loop.kind === 'circle' || b.loop.kind === 'circle') {
    const [circle, polygon] = a.loop.kind === 'circle' ? [a.loop, b.points] : [b.loop, a.points];
    if (circle.kind !== 'circle') throw invalid();
    const r2 = circle.radius ** 2;
    return edges(polygon).some(([start, end]) => {
      const at = ([x,y]: SketchPoint) => (x - circle.center[0]) ** 2 + (y - circle.center[1]) ** 2;
      return Math.max(at(start), at(end)) >= r2 && distanceSquared(circle.center,start,end) <= r2;
    });
  }
  const aEdges = edges(a.points), bEdges = edges(b.points);
  return aEdges.some(([start,end]) => bEdges.some(([p,q]) => sketchSegmentsIntersect(start,end,p,q)));
}

function contains(a: ResolvedLoop, b: ResolvedLoop) {
  const [x,y] = b.points[0];
  return a.loop.kind === 'circle'
    ? Math.hypot(x - a.loop.center[0], y - a.loop.center[1]) < a.loop.radius
    : inside(b.points[0],a.points);
}

export function evaluateSketchRegion(loops: SketchLoop[], resolve = (scalar: FeatureScalar) => typeof scalar === 'number' ? scalar : NaN) {
  if (!Array.isArray(loops) || loops.length < 2 || loops.length > maxSketchRegionLoops) throw invalid();
  const ids = new Set<string>();
  let vertices = 0;
  const resolved: ResolvedLoop[] = loops.map(loop => {
    if (!loop || typeof loop.id !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(loop.id) || ids.has(loop.id)) throw invalid();
    checkSketchDxfLayer(loop);
    ids.add(loop.id);
    let points: SketchPoint[], area: number, resolvedLoop: ResolvedLoop['loop'];
    if (loop.kind === 'circle') {
      if (!Array.isArray(loop.center) || loop.center.length !== 2 ||
          ![...loop.center, loop.radius].every(value => typeof value === 'number' || (typeof value === 'string' && value.trim())) ||
          !Number.isInteger(loop.segments) || loop.segments < 12 || loop.segments > 256) throw invalid();
      const center: SketchPoint = [resolve(loop.center[0]), resolve(loop.center[1])];
      const radius = resolve(loop.radius);
      if (!isSketchPoint(center) || !Number.isFinite(radius) || radius < .01 || radius > 100000) throw invalid();
      resolvedLoop = {...loop, center, radius};
      const [x,y] = center;
      points = Array.from({length:loop.segments}, (_,i) => {
        const angle = i * 2 * Math.PI / loop.segments;
        return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)] as SketchPoint;
      });
      area = Math.PI * radius ** 2;
    } else if (loop.kind === 'outline') {
      checkSketchDxfWidths(loop,true);
      points = sketchOutline(loop.points, loop.bulges);
      resolvedLoop = loop;
      const [x,y] = points[0];
      area = edges(points).reduce((sum,[[ax,ay],[bx,by]]) => sum + (ax-x)*(by-y) - (ay-y)*(bx-x),0)/2;
    } else throw invalid();
    vertices += points.length;
    if (vertices > maxRegionVertices) throw invalid();
    return {loop:resolvedLoop,points,area};
  });
  const [boundary,...holes] = resolved.sort((a,b) => b.area-a.area);
  for (let i=0;i<holes.length;i++) {
    const hole = holes[i];
    if (boundariesTouch(boundary,hole) || !contains(boundary,hole)) throw invalid();
    for (const other of holes.slice(0,i)) {
      if (boundariesTouch(other,hole) || contains(other,hole) || contains(hole,other)) throw invalid();
    }
  }
  // The mesh kernel needs a positive outer contour and negative hole contours.
  // Validate the same tessellated boundaries too, notably for circular outer edges.
  if (boundary.loop.kind === 'circle') {
    const asPolygon = (resolved: ResolvedLoop): ResolvedLoop => ({
      ...resolved, loop: {kind: 'outline', id: resolved.loop.id, points: resolved.points}
    });
    const outer = asPolygon(boundary);
    if (holes.map(asPolygon).some(hole => boundariesTouch(outer, hole) || !contains(outer, hole))) throw invalid();
  }
  return {
    contour: boundary.points,
    loopIds: [boundary,...holes].map(({loop})=>loop.id),
    holes: holes.map(hole => [...hole.points].reverse()),
    edgeIds: [boundary,...holes].flatMap(({loop}) => loop.kind === 'circle'
      ? [loop.id+':circumference']
      : loop.points.map((_,i) => loop.id+':edge-'+i))
  };
}
