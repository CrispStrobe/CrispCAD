// SPDX-License-Identifier: BSD-3-Clause
import {maxSketchOutlinePoints,t} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function parseSketchPoint(text: string): SketchPoint {
  const pair = text.split(',').map(value => value.trim());
  if (pair.length !== 2 || !pair.every(value => decimal.test(value) && Number.isFinite(Number(value)))) {
    throw new Error(t('Enter coordinates as X, Y in millimetres.'));
  }
  return [Number(pair[0]), Number(pair[1])];
}

export function parseSketchOutline(rows: string[]) {
  if (rows.length > maxSketchOutlinePoints) {
    throw new Error(t('An outline needs 3–256 finite points within 100000 mm of the sketch origin.'));
  }
  const points: SketchPoint[] = [], bulges: number[] = [];
  for (const row of rows) {
    const coordinates = row.trim().split(',');
    const bulge = coordinates.length === 3 ? coordinates.pop()!.trim() : '0';
    if (!decimal.test(bulge) || !Number.isFinite(Number(bulge))) {
      throw new Error(t('Enter one finite bulge per outline point.'));
    }
    const relative = coordinates[0].startsWith('@');
    if (relative) coordinates[0] = coordinates[0].slice(1);
    const [x, y] = parseSketchPoint(coordinates.join(','));
    const previous = points.at(-1);
    if (relative && !previous) throw new Error(t('Enter the first point as absolute X, Y coordinates.'));
    points.push(relative && previous ? [previous[0] + x, previous[1] + y] : [x,y]);
    bulges.push(Number(bulge));
  }
  return bulges.some(Boolean) ? {points, bulges} : {points};
}

export function formatSketchPoints(points: SketchPoint[], bulges?: number[]) {
  return points.map(([x, y], i) => bulges?.[i] ? [x,y,bulges[i]].join(', ') : [x,y].join(', '));
}

/** Move the arc's midpoint perpendicular to its chord while keeping its endpoints fixed. */
export function sketchDraggedBulge([ax,ay]:SketchPoint,[bx,by]:SketchPoint,bulge:number,[dx,dy]:SketchPoint,step:number) {
  const x=bx-ax,y=by-ay,chord=Math.hypot(x,y);
  if(!chord)return bulge;
  const offset=(dx*y-dy*x)/chord;
  const distance=chord*bulge/2+offset;
  const snapped=step>0?Math.round(distance/step)*step:distance;
  return Number((2*snapped/chord).toFixed(8));
}
