// SPDX-License-Identifier: BSD-3-Clause
import {evaluateSketch, featureValue, t} from '@brickwright/cad-core';
import type {CadDocument, SketchPoint} from '@brickwright/cad-core';

const pointsPerMillimetre = 72 / 25.4;
const decimal = (value: number) => Number(value.toFixed(5)).toString();
const pair = (x: number, y: number) => decimal(x) + ' ' + decimal(y);

// Helvetica with WinAnsi encoding covers the Latin-1 characters below. Hex
// text keeps dynamic sketch names out of the PDF operators and offsets ASCII.
const textOperand = (value: string) => '<' + [...value].map(character => {
  const code = character.charCodeAt(0);
  return (code >= 32 && code < 127 || code >= 160 && code <= 255 ? code : 63).toString(16);
}).join('') + '>';

function singlePagePdf(width: number, height: number, content: string) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
      pair(width * pointsPerMillimetre, height * pointsPerMillimetre) +
      '] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream'
  ];
  let pdf = '%PDF-1.6\n';
  const offsets = ['0000000000 65535 f\r\n'];
  for (const [index, body] of objects.entries()) {
    offsets.push(String(pdf.length).padStart(10, '0') + ' 00000 n\r\n');
    pdf += (index + 1) + ' 0 obj\n' + body + '\nendobj\n';
  }
  const xref = pdf.length;
  pdf += 'xref\n0 ' + offsets.length + '\n' + offsets.join('') +
    'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return new TextEncoder().encode(pdf);
}

export function exportSketchPdf(doc: CadDocument, featureId: string) {
  const feature = doc.nodes[featureId];
  if (feature?.kind !== 'extrusion' || feature.provenance?.length) {
    throw new Error(t('PDF template export requires an original sketch extrusion.'));
  }
  const sketch = doc.sketches![feature.sketchId];
  const shape = evaluateSketch(sketch, doc);
  const {contour, holes = []} = shape;
  const literalCircles = sketch.profile.kind === 'region'
    ? sketch.profile.loops.flatMap(loop => loop.kind === 'circle' ? [{
      x: featureValue(loop.center[0], doc), y: featureValue(loop.center[1], doc), radius: featureValue(loop.radius, doc)
    }] : [])
    : sketch.profile.kind === 'circle' ? [{
      x: sketch.profile.center?.[0] ?? 0, y: sketch.profile.center?.[1] ?? 0,
      radius: featureValue(sketch.profile.radius, doc)
    }] : [];
  const xs = contour.map(point => point[0]), ys = contour.map(point => point[1]);
  for (const {x, y, radius} of literalCircles) {
    xs.push(x-radius, x+radius);
    ys.push(y-radius, y+radius);
  }
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const drawingWidth = Math.max(...xs) - minX, drawingHeight = Math.max(...ys) - minY;
  const paper = [[210,297], [297,210]].find(([width, height]) => drawingWidth <= width-30 && drawingHeight <= height-80);
  if (!paper) throw new Error(t('This sketch is too large for a full-size A4 drilling template.'));
  const [width, height] = paper;
  const offsetX = (width-drawingWidth)/2-minX;
  const offsetY = (height-80-drawingHeight)/2+35-minY;
  const point = ([x,y]: SketchPoint) => pair(x+offsetX,y+offsetY);
  const commands = ['q', pair(pointsPerMillimetre,0) + ' ' + pair(0,pointsPerMillimetre) + ' 0 0 cm', '0 G', '0 g'];
  const line = (x: number, y: number, endX: number, endY: number) =>
    commands.push(pair(x,y) + ' m ' + pair(endX,endY) + ' l S');
  const text = (x: number, y: number, size: number, label: string) =>
    commands.push('BT /F1 ' + decimal(size) + ' Tf ' + pair(x,y) + ' Td ' + textOperand(label) + ' Tj ET');

  text(15,height-16,5,t('Drilling template'));
  text(15,height-23,3.5,[...sketch.name].slice(0,60).join(''));
  text(15,height-30,3,t`${sketch.plane} sketch plane · ${decimal(drawingWidth)} × ${decimal(drawingHeight)} mm`);
  text(15,26,3,t('Print at actual size (100%).'));
  text(15,21,3,t('50 mm scale check'));
  commands.push('0.18 w');
  line(15,16,65,16);
  line(15,14,15,18);
  line(65,14,65,18);

  commands.push('0.25 w');
  for (const loop of [contour,...holes]) {
    commands.push(point(loop[0]) + ' m ' + loop.slice(1).map(p => point(p)+' l').join(' ') + ' h S');
  }
  commands.push('0.15 w');
  for (const {x,y,radius} of literalCircles) {
    const px=x+offsetX, py=y+offsetY, mark=Math.min(2,radius*.7);
    line(px-mark,py,px+mark,py);
    line(px,py-mark,px,py+mark);
  }
  commands.push('Q');
  const name = sketch.name.replace(/[^\p{L}\p{N} ._-]+/gu,'-').trim() || 'sketch';
  return {name:name+'-1-to-1.pdf',mime:'application/pdf',bytes:singlePagePdf(width,height,commands.join('\n')+'\n')};
}
