// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';

export type SketchPoint = [number, number];
export const maxSketchOutlinePoints = 256;
const maxSketchCurveVertices = 1024;

export function isSketchPoint(value: unknown): value is SketchPoint {
  return Array.isArray(value) && value.length === 2 &&
    value.every(axis => typeof axis === 'number' && Number.isFinite(axis) && Math.abs(axis) <= 100000);
}

const cross = (a: SketchPoint, b: SketchPoint, c: SketchPoint) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const on = (p: SketchPoint, a: SketchPoint, b: SketchPoint) =>
    p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
export const sketchSegmentsIntersect = (a: SketchPoint, b: SketchPoint, c: SketchPoint, d: SketchPoint) => {
    const p = cross(a, b, c), q = cross(a, b, d), r = cross(c, d, a), s = cross(c, d, b);
    return (p * q < 0 && r * s < 0) || (p === 0 && on(c, a, b)) ||
      (q === 0 && on(d, a, b)) || (r === 0 && on(a, c, d)) || (s === 0 && on(b, c, d));
  };

function normalizeOutline(points: SketchPoint[]): SketchPoint[] {
  const invalid = () => new Error(t('Outline edges must form one closed loop without crossings or overlaps.'));
  let area2 = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < .00001) throw invalid();
    if (cross(a, b, c) === 0 && (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0) {
      throw invalid();
    }
    area2 += cross(points[0], a, b);
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (sketchSegmentsIntersect(a, b, points[j], points[(j + 1) % points.length])) throw invalid();
    }
  }
  if (Math.abs(area2) < .0002) throw invalid();
  return area2 < 0 ? [...points].reverse() : points;
}


/** Signed DXF bulge (tan(sweep/4)) resolved in the sketch plane. */
export function sketchBulgeArc(a: SketchPoint, b: SketchPoint, bulge: number) {
  if (!bulge) return undefined;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const centerOffset = (1 / bulge - bulge) / 4;
  const center: SketchPoint = [(a[0]+b[0])/2 - dy*centerOffset, (a[1]+b[1])/2 + dx*centerOffset];
  const radius = Math.hypot(dx,dy) * (Math.abs(bulge) + 1 / Math.abs(bulge)) / 4;
  if (!Number.isFinite(radius) || !center.every(Number.isFinite)) return undefined;
  return {center, radius, start: Math.atan2(a[1]-center[1], a[0]-center[0]), sweep: 4*Math.atan(bulge)};
}

/** The halfway point along the signed arc, or the midpoint of a straight edge. */
export function sketchBulgeMidpoint([ax,ay]:SketchPoint,[bx,by]:SketchPoint,bulge:number):SketchPoint {
  return [(ax+bx+(by-ay)*bulge)/2,(ay+by-(bx-ax)*bulge)/2];
}

/** Build a simple counter-clockwise contour from native DXF bulges.
 * The authored bulge is tan(signed sweep/4) for the outgoing edge.
 */
export function sketchOutline(points: SketchPoint[], bulges?: number[]): SketchPoint[] {
  const hasCurves = bulges !== undefined;
  if (!Array.isArray(points) || points.length < (hasCurves ? 2 : 3) ||
      points.length > maxSketchOutlinePoints || !points.every(isSketchPoint)) {
    throw new Error(t('An outline needs 3–256 finite points within 100000 mm of the sketch origin.'));
  }
  if (!hasCurves) return normalizeOutline(points);
  if (!Array.isArray(bulges) || bulges.length !== points.length ||
      !bulges.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10000)) {
    throw new Error(t('Enter one finite bulge per outline point.'));
  }
  const contour: SketchPoint[] = [];
  const tolerance = .025;
  const invalid = () => new Error(t('Rounded outline exceeds the curve size or detail limit.'));
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i+1)%points.length], bulge = bulges[i];
    const dx = b[0]-a[0], dy = b[1]-a[1], chord = Math.hypot(dx,dy);
    if (chord < .00001) throw new Error(t('Outline edges must form one closed loop without crossings or overlaps.'));
    contour.push(a);
    if (bulge === 0) continue;
    if (chord * Math.abs(bulge) < tolerance * 2 && Math.abs(4 * Math.atan(bulge)) < Math.PI / 32 && points.length > 2) continue;
    const arc = sketchBulgeArc(a,b,bulge);
    if (!arc) throw invalid();
    const {center:[centerX,centerY],radius,start,sweep} = arc;
    const step = Math.min(Math.PI/32, 4*Math.asin(Math.sqrt(Math.min(1,tolerance/(2*radius)))));
    const segments = Math.max(2, Math.ceil(Math.abs(sweep)/step));
    if (contour.length + segments - 1 > maxSketchCurveVertices) throw invalid();
    for (let j = 1; j < segments; j++) {
      const angle = start+sweep*j/segments;
      const point: SketchPoint = [centerX+radius*Math.cos(angle),centerY+radius*Math.sin(angle)];
      if (!isSketchPoint(point)) throw invalid();
      contour.push(point);
    }
  }
  if (contour.length < 3 || contour.length > maxSketchCurveVertices) throw invalid();
  return normalizeOutline(contour);
}
