// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';

export type SketchPoint = [number, number];
export const maxSketchOutlinePoints = 256;

export function isSketchPoint(value: unknown): value is SketchPoint {
  return Array.isArray(value) && value.length === 2 &&
    value.every(axis => typeof axis === 'number' && Number.isFinite(axis) && Math.abs(axis) <= 100000);
}

/** Validate one simple closed loop and return the winding expected by the kernel. */
export function sketchOutline(points: SketchPoint[]): SketchPoint[] {
  if (!Array.isArray(points) || points.length < 3 || points.length > maxSketchOutlinePoints ||
      !points.every(isSketchPoint)) {
    throw new Error(t('An outline needs 3–256 finite points within 100000 mm of the sketch origin.'));
  }
  const cross = (a: SketchPoint, b: SketchPoint, c: SketchPoint) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (p: SketchPoint, a: SketchPoint, b: SketchPoint) =>
    p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  const crosses = (a: SketchPoint, b: SketchPoint, c: SketchPoint, d: SketchPoint) => {
    const p = cross(a, b, c), q = cross(a, b, d), r = cross(c, d, a), s = cross(c, d, b);
    return (p * q < 0 && r * s < 0) || (p === 0 && on(c, a, b)) ||
      (q === 0 && on(d, a, b)) || (r === 0 && on(a, c, d)) || (s === 0 && on(b, c, d));
  };
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
      if (crosses(a, b, points[j], points[(j + 1) % points.length])) throw invalid();
    }
  }
  if (Math.abs(area2) < .0002) throw invalid();
  return area2 < 0 ? [...points].reverse() : points;
}
