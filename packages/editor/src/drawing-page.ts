// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {DrawingScale,DrawingTitleBlock,SketchPoint} from '@brickwright/cad-core';
import type {AssemblyDrawingCurve} from './assembly-curve-dimension.js';
import type {AssemblyDrawingEdge} from './assembly-edge-dimension.js';
import type {DrawingAnchorPoint} from './drawing-annotation.js';
import type {DrawingEllipse} from './drawing-conic.js';
import type {ExactNamedTopology} from './exact-drawing-projection.js';

/** `thread`: thin continuous lines of cosmetic threads; `error`: a datum or tolerance whose reference no longer resolves. */
type Stroke = 'visible'|'hidden'|'center'|'dimension'|'border'|'cut'|'hatch'|'section'|'annotation'|'thread'|'error';
export type DrawingPath = {points:SketchPoint[]; stroke:Stroke; closed?:boolean};
/** A circle, or with `arc` a circular arc from `start` through `sweep` (radians, counter-clockwise on
 * paper); `hidden` draws it dashed. */
export type DrawingCircle = {center:SketchPoint; radius:number; arc?:{start:number; sweep:number}; hidden?:true;
 /** A thin continuous line (a cosmetic thread's 3/4 circle) instead of a visible outline. */
 thin?:true};
/** `angle`: degrees counter-clockwise on paper (vertical dimension text: 90). */
export type DrawingText = {x:number; y:number; size:number; text:string; angle?:number};
export type {DrawingEllipse};
/**
 * What a dimension measures, beside the lines and text it is drawn with, so a DXF file can carry it
 * as a DIMENSION entity (drawing-dxf.ts). Points are on paper (mm). `rotated`: a horizontal or vertical
 * (`angle` 0 or 90) dimension between `points[0]` and `points[1]` with its line through `points[2]`;
 * `aligned`: the same, parallel to the two points; `diameter`: `points[0]` on the circle where the
 * leader starts and `points[1]` opposite; `radius`: the centre and the point on the curve.
 * `measurement` is the value in model millimetres; `text` what the sheet shows.
 */
export type DrawingDimension = {
 kind:'rotated'|'aligned'|'diameter'|'radius'; points:SketchPoint[]; angle?:number;
 measurement:number; text:string; textAt:SketchPoint;
 /** The page's paths and texts that draw it (the same objects). */
 paths:DrawingPath[]; texts:DrawingText[];
};
export type DrawingLayout = {
 width:number; height:number; paths:DrawingPath[]; circles:DrawingCircle[]; texts:DrawingText[];
 /** Elliptical arcs (circles seen at an angle, oblique cuts of cylinders), exact drawings only. */
 ellipses?:DrawingEllipse[];
 anchors:DrawingAnchorPoint[]; annotationIssues:string[]; factor:number;
 /** What automatic dimensions placed (exact assembly sheets with automatic dimensions). */
 autoDimensions?:{placed:number;omitted:number;callouts:number}; assemblyEdges?:AssemblyDrawingEdge[]; assemblyCurves?:AssemblyDrawingCurve[];
 /** Dimensions drawn on the page, for DXF DIMENSION entities. */
 dimensions?:DrawingDimension[];
 /** Exact assembly sheets: where named faces and edges are on paper, for attaching datums and tolerances. */
 gdt?:DrawingGdtPick;
};
/** The exact topology of the drawn bodies and how each view maps world millimetres to paper. */
export type DrawingGdtPick={topology:ExactNamedTopology[];origin:readonly number[];factor:number;views:{left:number;bottom:number}[]};

/** Record a dimension drawn with `paths` and `texts` (already on the page). */
export function recordDimension(page:Pick<DrawingLayout,'dimensions'>,dimension:DrawingDimension){
 (page.dimensions??=[]).push(dimension);
}
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
