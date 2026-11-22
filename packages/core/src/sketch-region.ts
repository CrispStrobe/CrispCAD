// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import {isSketchPoint, sketchOutline, sketchSegmentsIntersect} from './sketch-outline.js';
import type {SketchPoint} from './sketch-outline.js';

export type SketchLoop =
  | {kind: 'outline'; id: string; points: SketchPoint[]}
  | {kind: 'circle'; id: string; center: SketchPoint; radius: number; segments: number};

export const maxSketchRegionLoops = 16;
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

type ResolvedLoop = {loop: SketchLoop; points: SketchPoint[]; area: number};

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

export function evaluateSketchRegion(loops: SketchLoop[]) {
  if (!Array.isArray(loops) || loops.length < 2 || loops.length > maxSketchRegionLoops) throw invalid();
  const ids = new Set<string>();
  let vertices = 0;
  const resolved: ResolvedLoop[] = loops.map(loop => {
    if (!loop || typeof loop.id !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(loop.id) || ids.has(loop.id)) throw invalid();
    ids.add(loop.id);
    let points: SketchPoint[], area: number;
    if (loop.kind === 'circle') {
      if (!isSketchPoint(loop.center) || !Number.isFinite(loop.radius) || loop.radius < .01 || loop.radius > 100000 ||
          !Number.isInteger(loop.segments) || loop.segments < 12 || loop.segments > 256) throw invalid();
      const [x,y] = loop.center;
      points = Array.from({length:loop.segments}, (_,i) => {
        const angle = i * 2 * Math.PI / loop.segments;
        return [x + loop.radius * Math.cos(angle), y + loop.radius * Math.sin(angle)] as SketchPoint;
      });
      area = Math.PI * loop.radius ** 2;
    } else if (loop.kind === 'outline') {
      points = sketchOutline(loop.points);
      const [x,y] = points[0];
      area = edges(points).reduce((sum,[[ax,ay],[bx,by]]) => sum + (ax-x)*(by-y) - (ay-y)*(bx-x),0)/2;
    } else throw invalid();
    vertices += points.length;
    if (vertices > maxRegionVertices) throw invalid();
    return {loop,points,area};
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
    holes: holes.map(hole => [...hole.points].reverse()),
    edgeIds: [boundary,...holes].flatMap(({loop,points}) => loop.kind === 'circle'
      ? [loop.id+':circumference']
      : points.map((_,i) => loop.id+':edge-'+i))
  };
}
