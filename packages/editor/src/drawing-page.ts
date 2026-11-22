// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {DrawingScale,SketchPoint} from '@brickwright/cad-core';
import type {AssemblyDrawingCurve} from './assembly-curve-dimension.js';
import type {AssemblyDrawingEdge} from './assembly-edge-dimension.js';
import type {DrawingAnchorPoint} from './drawing-annotation.js';

type Stroke = 'visible'|'hidden'|'center'|'dimension'|'border'|'cut'|'hatch'|'section'|'annotation';
export type DrawingPath = {points:SketchPoint[]; stroke:Stroke; closed?:boolean};
export type DrawingCircle = {center:SketchPoint; radius:number};
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

export function addDrawingFrame(page:Pick<DrawingLayout,'paths'|'texts'>,title:string,subtitle:string,scale?:DrawingScale){
 const path=(stroke:Stroke,points:SketchPoint[],closed?:boolean)=>page.paths.push({stroke,points,closed});
 const text=(x:number,y:number,size:number,text:string)=>page.texts.push({x,y,size,text});
 path('border',drawingBorder(8,8,281,194),true);
 text(14,190,5,title);
 text(14,183,3.5,subtitle);
 if(!scale)return;
 path('border',[[8,26],[289,26]]);
 text(14,17,3.5,t`Scale ${scale} · mm · A4`);
 text(110,17,3,t('Print at actual size (100%).'));
 path('dimension',[[229,14],[279,14]]);
 for(const x of [229,279])path('dimension',[[x,12],[x,16]]);
 text(229,18,2.5,t('50 mm scale check'));
}
