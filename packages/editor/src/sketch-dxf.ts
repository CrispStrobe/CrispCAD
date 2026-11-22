// SPDX-License-Identifier: BSD-3-Clause
import {evaluateSketch, featureValue, resolveSketchPath, t} from '@brickwright/cad-core';
import type {CadDocument,PlanarSketch,SketchPoint} from '@brickwright/cad-core';

/** Export the authored sketch in its local plane, at its evaluated size in mm. */
export function exportSketchDxf(doc: CadDocument, featureId: string) {
  const feature = doc.nodes[featureId];
  if (feature?.kind !== 'extrusion' || feature.provenance?.length) {
    throw new Error(t('DXF export requires an original sketch extrusion.'));
  }
  return writeSketchDxf(doc,doc.sketches![feature.sketchId]);
}

export function exportSketchPathDxf(doc:CadDocument,sketch:PlanarSketch){
  if(sketch.profile.kind!=='path')throw new Error(t('Select an open sketch path'));
  return writeSketchDxf(doc,sketch);
}

function writeSketchDxf(doc:CadDocument,sketch:PlanarSketch){
  const {contour} = evaluateSketch(sketch, doc);
  const profile = sketch.profile;
  const layers = new Map([['0', '0']]);
  const registerLayer = (name: string) => {
    const key = name.toUpperCase();
    if (!layers.has(key)) layers.set(key, name);
    return layers.get(key)!;
  };
  if (profile.kind === 'region') {
    for (const loop of profile.loops) if (loop.dxfLayer) registerLayer(loop.dxfLayer);
  } else if ((profile.kind === 'outline' || profile.kind === 'circle' || profile.kind === 'path') && profile.dxfLayer) {
    registerLayer(profile.dxfLayer);
  }
  const lines: string[] = [];
  const pair = (code: number, value: string | number) => lines.push(String(code), String(value));
  pair(0, 'SECTION');
  pair(2, 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1021');
  pair(9, '$INSUNITS');
  pair(70, 4);
  pair(0, 'ENDSEC');
  pair(0, 'SECTION');
  pair(2, 'TABLES');
  pair(0, 'TABLE');
  pair(2, 'LAYER');
  pair(70, layers.size);
  for (const name of layers.values()) {
    pair(0, 'LAYER');
    pair(100, 'AcDbSymbolTableRecord');
    pair(100, 'AcDbLayerTableRecord');
    pair(2, name);
    pair(70, 0);
    pair(62, 7);
    pair(6, 'CONTINUOUS');
  }
  pair(0, 'ENDTAB');
  pair(0, 'ENDSEC');
  pair(0, 'SECTION');
  pair(2, 'ENTITIES');

  const circle = (center: SketchPoint, radius: number, layer = '0') => {
    pair(0, 'CIRCLE');
    pair(100, 'AcDbEntity');
    pair(8, registerLayer(layer));
    pair(100, 'AcDbCircle');
    pair(10, center[0]);
    pair(20, center[1]);
    pair(30, 0);
    pair(40, radius);
  };
  const polyline = (points: SketchPoint[], layer = '0', bulges?: number[], closed = true) => {
    pair(0, 'LWPOLYLINE');
    pair(100, 'AcDbEntity');
    pair(8, registerLayer(layer));
    pair(100, 'AcDbPolyline');
    pair(90, points.length);
    pair(70, closed ? 1 : 0);
    points.forEach(([x, y], index) => {
      pair(10, x);
      pair(20, y);
      const bulge = bulges?.[index];
      if (bulge) pair(42, bulge);
    });
  };
  if (profile.kind === 'region') {
    for (const loop of profile.loops) {
      if (loop.kind === 'circle') circle([featureValue(loop.center[0], doc), featureValue(loop.center[1], doc)], featureValue(loop.radius, doc), loop.dxfLayer);
      else polyline(loop.points, loop.dxfLayer, loop.bulges);
    }
  } else if (profile.kind === 'circle') {
    circle(profile.center ?? [0,0], featureValue(profile.radius, doc), profile.dxfLayer);
  } else if (profile.kind === 'path') {
    polyline(resolveSketchPath(profile,doc), profile.dxfLayer, profile.bulges, false);
  } else if (profile.kind === 'outline') {
    polyline(profile.bulges ? profile.points : contour, profile.dxfLayer, profile.bulges);
  } else polyline(contour);

  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  const safeName = sketch.name.replace(/[^\p{L}\p{N} ._-]+/gu, '-').trim() || 'sketch';
  return {
    name: safeName + '.dxf',
    mime: 'application/dxf',
    bytes: new TextEncoder().encode(lines.join('\r\n') + '\r\n')
  };
}
