// SPDX-License-Identifier: BSD-3-Clause
import {constantDxfWidth,evaluateSketch, featureValue, resolveSketchPath, t} from '@brickwright/cad-core';
import type {CadDocument,DxfSegmentWidth,PlanarSketch,SketchDxfLayer,SketchDxfLayerStyle,SketchDxfLinetype,SketchPoint} from '@brickwright/cad-core';

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
  const layers=new Map<string,{name:string;style?:SketchDxfLayerStyle}>([['0',{name:'0'}]]);
  const registerLayer=({dxfLayer:name='0',dxfLayerStyle:style}:SketchDxfLayer)=>{
    const key=name.toUpperCase(),existing=layers.get(key);
    if(!existing)layers.set(key,{name,style});
    else if(!existing.style&&style)existing.style=style;
  };
  if(profile.kind==='region')profile.loops.forEach(registerLayer);
  else if(profile.kind==='outline'||profile.kind==='circle'||profile.kind==='path')registerLayer(profile);
  const layerName=(name:string)=>layers.get(name.toUpperCase())!.name;
  const linetypes=new Map<string,SketchDxfLinetype>();
  for(const {style} of layers.values()){
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
  pair(70, layers.size);
  for (const {name,style} of layers.values()) {
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
    pair(8, layerName(layer));
    pair(100, 'AcDbCircle');
    pair(10, center[0]);
    pair(20, center[1]);
    pair(30, 0);
    pair(40, radius);
  };
  const polyline = (points: SketchPoint[], layer = '0', bulges?: number[], closed = true, widths?:DxfSegmentWidth[]) => {
    pair(0, 'LWPOLYLINE');
    pair(100, 'AcDbEntity');
    pair(8, layerName(layer));
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
  if (profile.kind === 'region') {
    for (const loop of profile.loops) {
      if (loop.kind === 'circle') circle([featureValue(loop.center[0], doc), featureValue(loop.center[1], doc)], featureValue(loop.radius, doc), loop.dxfLayer);
      else polyline(loop.points,loop.dxfLayer,loop.bulges,true,loop.dxfWidths);
    }
  } else if (profile.kind === 'circle') {
    circle(profile.center ?? [0,0], featureValue(profile.radius, doc), profile.dxfLayer);
  } else if (profile.kind === 'path') {
    polyline(resolveSketchPath(profile,doc),profile.dxfLayer,profile.bulges,false,profile.dxfWidths);
  } else if (profile.kind === 'outline') {
    polyline(profile.bulges||profile.dxfWidths?profile.points:contour,profile.dxfLayer,profile.bulges,true,profile.dxfWidths);
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
