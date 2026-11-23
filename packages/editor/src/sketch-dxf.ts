// SPDX-License-Identifier: BSD-3-Clause
import {constantDxfWidth,t} from '@brickwright/cad-core';
import type {CadDocument,DxfSegmentWidth,PlanarSketch,SketchDxfLinetype,SketchPoint} from '@brickwright/cad-core';
import {describeSketchExchange,sketchForExchange} from './sketch-exchange.js';

/** Export the authored sketch in its local plane, at its evaluated size in mm. */
export function exportSketchDxf(doc: CadDocument, featureId: string) {
  return writeSketchDxf(doc,sketchForExchange(doc,featureId,'DXF'));
}

export function exportSketchPathDxf(doc:CadDocument,sketch:PlanarSketch){
  if(sketch.profile.kind!=='path')throw new Error(t('Select an open sketch path'));
  return writeSketchDxf(doc,sketch);
}

function writeSketchDxf(doc:CadDocument,sketch:PlanarSketch){
  const {name,layers,entities}=describeSketchExchange(doc,sketch);
  const linetypes=new Map<string,SketchDxfLinetype>();
  for(const {style} of layers){
    const type=style?.linetype,key=type?.name.toUpperCase();
    if(type&&key&&!linetypes.has(key))linetypes.set(key,type);
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
  if(linetypes.size){
    pair(0,'TABLE');pair(2,'LTYPE');pair(70,linetypes.size+1);
    for(const {name,pattern} of [{name:'CONTINUOUS',pattern:[]},...linetypes.values()]){
      pair(0,'LTYPE');
      pair(100,'AcDbSymbolTableRecord');
      pair(100,'AcDbLinetypeTableRecord');
      pair(2,name);pair(70,0);pair(3,'');pair(72,65);
      pair(73,pattern.length);
      pair(40,pattern.reduce((sum,length)=>sum+Math.abs(length),0));
      for(const length of pattern){pair(49,length);pair(74,0);}
    }
    pair(0,'ENDTAB');
  }
  pair(0, 'TABLE');
  pair(2, 'LAYER');
  pair(70, layers.length);
  for (const {name,style} of layers) {
    pair(0, 'LAYER');
    pair(100, 'AcDbSymbolTableRecord');
    pair(100, 'AcDbLayerTableRecord');
    pair(2, name);
    pair(70,style?.flags??0);
    pair(62,style?.color??7);
    pair(6,style?.linetype?linetypes.get(style.linetype.name.toUpperCase())!.name:'CONTINUOUS');
    if(style?.trueColor!==undefined)pair(420,style.trueColor);
    if(style?.plot!==undefined)pair(290,Number(style.plot));
    if(style?.lineweight!==undefined)pair(370,style.lineweight);
  }
  pair(0, 'ENDTAB');
  pair(0, 'ENDSEC');
  pair(0, 'SECTION');
  pair(2, 'ENTITIES');

  const circle = (center: SketchPoint, radius: number, layer = '0') => {
    pair(0, 'CIRCLE');
    pair(100, 'AcDbEntity');
    pair(8, layer);
    pair(100, 'AcDbCircle');
    pair(10, center[0]);
    pair(20, center[1]);
    pair(30, 0);
    pair(40, radius);
  };
  const polyline = (points: SketchPoint[], layer = '0', bulges?: number[], closed = true, widths?:DxfSegmentWidth[]) => {
    pair(0, 'LWPOLYLINE');
    pair(100, 'AcDbEntity');
    pair(8, layer);
    pair(100, 'AcDbPolyline');
    pair(90, points.length);
    pair(70, closed ? 1 : 0);
    const constant=widths?constantDxfWidth(widths,closed):undefined;
    if(constant)pair(43,constant);
    points.forEach(([x, y], index) => {
      pair(10, x);
      pair(20, y);
      if(widths&&!constant){
        const [start,end]=widths[index];
        if(start)pair(40,start);
        if(end)pair(41,end);
      }
      const bulge = bulges?.[index];
      if (bulge) pair(42, bulge);
    });
  };
  for(const entity of entities){
    if(entity.kind==='circle')circle(entity.center,entity.radius,entity.layer);
    else polyline(entity.points,entity.layer,entity.bulges,entity.closed,entity.widths);
  }

  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  return {
    name: name + '.dxf',
    mime: 'application/dxf',
    bytes: new TextEncoder().encode(lines.join('\r\n') + '\r\n')
  };
}
