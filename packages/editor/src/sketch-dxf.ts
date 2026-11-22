// SPDX-License-Identifier: BSD-3-Clause
import {evaluateSketch, featureValue, t} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';

/** Export the authored sketch in its local plane, at its evaluated size in mm. */
export function exportSketchDxf(doc: CadDocument, featureId: string) {
  const feature = doc.nodes[featureId];
  if (feature?.kind !== 'extrusion' || feature.provenance?.length) {
    throw new Error(t('DXF export requires an original sketch extrusion.'));
  }
  const sketch = doc.sketches![feature.sketchId];
  const {contour} = evaluateSketch(sketch, doc);
  const lines: string[] = [];
  const pair = (code: number, value: string | number) => lines.push(String(code), String(value));
  pair(0, 'SECTION');
  pair(2, 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1015');
  pair(9, '$INSUNITS');
  pair(70, 4);
  pair(0, 'ENDSEC');
  pair(0, 'SECTION');
  pair(2, 'ENTITIES');

  if (sketch.profile.kind === 'circle') {
    pair(0, 'CIRCLE');
    pair(100, 'AcDbEntity');
    pair(8, '0');
    pair(100, 'AcDbCircle');
    pair(10, 0);
    pair(20, 0);
    pair(30, 0);
    pair(40, featureValue(sketch.profile.radius, doc));
  } else {
    pair(0, 'LWPOLYLINE');
    pair(100, 'AcDbEntity');
    pair(8, '0');
    pair(100, 'AcDbPolyline');
    pair(90, contour.length);
    pair(70, 1);
    for (const [x, y] of contour) {
      pair(10, x);
      pair(20, y);
    }
  }

  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  const safeName = sketch.name.replace(/[^\p{L}\p{N} ._-]+/gu, '-').trim() || 'sketch';
  return {
    name: safeName + '.dxf',
    mime: 'application/dxf',
    bytes: new TextEncoder().encode(lines.join('\r\n') + '\r\n')
  };
}
