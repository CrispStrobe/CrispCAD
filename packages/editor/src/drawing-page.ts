// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {DrawingScale,DrawingTitleBlock,SketchPoint} from '@brickwright/cad-core';
import type {AssemblyDrawingCurve} from './assembly-curve-dimension.js';
import type {AssemblyDrawingEdge} from './assembly-edge-dimension.js';
import type {DrawingAnchorPoint} from './drawing-annotation.js';

type Stroke = 'visible'|'hidden'|'center'|'dimension'|'border'|'cut'|'hatch'|'section'|'annotation';
export type DrawingPath = {points:SketchPoint[]; stroke:Stroke; closed?:boolean};
/** A circle, or with `arc` a circular arc from `start` through `sweep` (radians, counter-clockwise on
 * paper); `hidden` draws it dashed. */
export type DrawingCircle = {center:SketchPoint; radius:number; arc?:{start:number; sweep:number}; hidden?:true};
export type DrawingText = {x:number; y:number; size:number; text:string};
export type DrawingLayout = {
 width:number; height:number; paths:DrawingPath[]; circles:DrawingCircle[]; texts:DrawingText[];
 anchors:DrawingAnchorPoint[]; annotationIssues:string[]; factor:number; assemblyEdges?:AssemblyDrawingEdge[]; assemblyCurves?:AssemblyDrawingCurve[];
};
export const drawingViews = [
 {view:'Top view', horizontal:0, vertical:1, depth:2, near:1},
 {view:'Front view', horizontal:0, vertical:2, depth:1, near:-1},
 {view:'Right view', horizontal:1, vertical:2, depth:0, near:1}
] as const;
export const drawingBorder=(x:number,y:number,w:number,h:number):SketchPoint[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];

export function addDrawingFrame(page:Pick<DrawingLayout,'paths'|'texts'>,title:string,subtitle:string,
 {scale,titleBlock,continuation}: {scale?:DrawingScale;titleBlock?:DrawingTitleBlock;continuation?:string}){
 const path=(stroke:Stroke,points:SketchPoint[],closed?:boolean)=>page.paths.push({stroke,points,closed});
 const text=(x:number,y:number,size:number,text:string)=>page.texts.push({x,y,size,text});
 path('border',drawingBorder(8,8,281,194),true);
 text(14,190,5,title);
 text(14,183,3.5,subtitle);
 if(!scale&&!continuation)return;
 path('border',[[8,26],[289,26]]);
 if(titleBlock){
  const fields=[
   {label:t('Drawing number'),value:titleBlock.number,x:14},
   {label:t('Revision'),value:titleBlock.revision,x:105},
   {label:t('Drawn by'),value:titleBlock.drawnBy,x:157}
  ];
  path('border',[[8,18.5],[216,18.5]]);
  path('border',[[216,8],[216,26]]);
  for(const x of [100,152])path('border',[[x,8],[x,18.5]]);
  for(const {label,value,x} of fields){
   text(x,15,2.5,label);
   if(value)text(x,10.5,3.3,value);
  }
 }
 if(continuation)text(14,titleBlock?21:17,3,continuation);
 if(!scale)return;
 text(14,titleBlock?21:17,titleBlock?3:3.5,t`Scale ${scale} · mm · A4`);
 text(titleBlock?78:110,titleBlock?21:17,3,t('Print at actual size (100%).'));
 path('dimension',[[229,14],[279,14]]);
 for(const x of [229,279])path('dimension',[[x,12],[x,16]]);
 text(229,18,2.5,t('50 mm scale check'));
}
