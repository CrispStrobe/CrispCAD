// SPDX-License-Identifier: BSD-3-Clause
import {evaluateSketch,featureValue,resolveSketchPath,t} from '@brickwright/cad-core';
import type {CadDocument,DxfSegmentWidth,PlanarSketch,SketchDxfLayer,SketchDxfLayerStyle,SketchPoint} from '@brickwright/cad-core';

export type SketchExchangeEntity =
 {kind:'circle';layer:string;center:SketchPoint;radius:number} |
 {kind:'polyline';layer:string;points:SketchPoint[];closed:boolean;bulges?:number[];widths?:DxfSegmentWidth[]};

export function sketchForExchange(doc:CadDocument,featureId:string,format:'DXF'|'DWG'){
 const feature=doc.nodes[featureId];
 if(feature?.kind!=='extrusion'||feature.provenance?.length){
  throw new Error(format==='DXF'?t('DXF export requires an original sketch extrusion.'):t('DWG export requires an original sketch extrusion.'));
 }
 return doc.sketches![feature.sketchId];
}

export function describeSketchExchange(doc:CadDocument,sketch:PlanarSketch){
 const {contour}=evaluateSketch(sketch,doc);
 const {profile}=sketch;
 const layers=new Map<string,{name:string;style?:SketchDxfLayerStyle}>([['0',{name:'0'}]]);
 const registerLayer=({dxfLayer:name='0',dxfLayerStyle:style}:SketchDxfLayer)=>{
  const key=name.toUpperCase(),existing=layers.get(key);
  if(!existing)layers.set(key,{name,style});
  else if(!existing.style&&style)existing.style=style;
  return layers.get(key)!.name;
 };
 const entities:SketchExchangeEntity[]=[];
 const circle=(center:SketchPoint,radius:number,layer:SketchDxfLayer)=>{
  entities.push({kind:'circle',layer:registerLayer(layer),center,radius});
 };
 const polyline=(points:SketchPoint[],closed:boolean,layer:SketchDxfLayer={},bulges?:number[],widths?:DxfSegmentWidth[])=>{
  entities.push({kind:'polyline',layer:registerLayer(layer),points,closed,bulges,widths});
 };
 if(profile.kind==='region'){
  for(const loop of profile.loops){
   if(loop.kind==='circle')circle([featureValue(loop.center[0],doc),featureValue(loop.center[1],doc)],featureValue(loop.radius,doc),loop);
   else polyline(loop.points,true,loop,loop.bulges,loop.dxfWidths);
  }
 }else if(profile.kind==='circle')circle(profile.center??[0,0],featureValue(profile.radius,doc),profile);
 else if(profile.kind==='path')polyline(resolveSketchPath(profile,doc),false,profile,profile.bulges,profile.dxfWidths);
 else if(profile.kind==='outline')polyline(profile.bulges||profile.dxfWidths?profile.points:contour,true,profile,profile.bulges,profile.dxfWidths);
 else polyline(contour,true);
 const name=sketch.name.replace(/[^\p{L}\p{N} ._-]+/gu,'-').trim()||'sketch';
 return {name,layers:[...layers.values()],entities};
}
export type SketchExchange=ReturnType<typeof describeSketchExchange>;
