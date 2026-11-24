// SPDX-License-Identifier: BSD-3-Clause
// Flattens the ported involute outlines into the polygon profiles used by
// CAD Script. Arcs in both outlines are centred on the gear axis.
import { internalSpurGearBoreOutline, spurGearOutline, type SpurGearOutline, type SpurGearProfileOptions } from './spurGear.js';

export const SPUR_GEAR_MAX_TEETH = 200;
/** Chord angle used for tip and root arcs. */
const ARC_STEP_RAD = Math.PI / 90;

function flatten(outline: SpurGearOutline): [number, number][] {
  const points: [number, number][] = [outline.start];
  const push = (p: [number, number]) => {
    const last = points[points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) points.push(p);
  };
  for (const segment of outline.segments) {
    if (segment.kind === 'spline') { segment.points.forEach(push); continue; }
    const from = points[points.length - 1], r = Math.hypot(segment.to[0], segment.to[1]);
    const a0 = Math.atan2(from[1], from[0]);
    let sweep = Math.atan2(segment.to[1], segment.to[0]) - a0;
    while (sweep <= 0) sweep += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(sweep / ARC_STEP_RAD));
    for (let i = 1; i < steps; i++) push([r * Math.cos(a0 + (sweep * i) / steps), r * Math.sin(a0 + (sweep * i) / steps)]);
    push(segment.to);
  }
  const first = points[0], last = points[points.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-9) points.pop();
  return points;
}

/** Closed CCW polygon of an external involute spur gear, tooth 0 on +X,
 *  centred on the origin. Throws SpurGearProfileError for invalid teeth. */
export function spurGearPolygon(options: SpurGearProfileOptions): [number, number][] {
  return flatten(spurGearOutline(options));
}

/** Tooth-space cutter for an internal (ring) gear with the same rack:
 *  subtract it from a larger disc to make the ring. */
export function internalSpurGearPolygon(options: SpurGearProfileOptions): [number, number][] {
  return flatten(internalSpurGearBoreOutline(options));
}
