// SPDX-License-Identifier: BSD-3-Clause
// Drawing sheets without the editor: lay out a saved or ad-hoc sheet from evaluated geometry (and,
// for exact edges, the exact kernel's drawing and section data) and write it as PDF, SVG or DXF.
// The MCP tool `cad_drawing` and the CLI verb `drawing` use it; the editor's dialog runs the same
// layout and writers. Plain functions: no DOM, so it runs in Node.
import {drawingScales,isAssemblyDrawingSource,t} from '@brickwright/cad-core';
import type {CadDocument,DrawingInputs,DrawingScale,ExactDrawingData,ExactSectionData} from '@brickwright/cad-core';
import type {AssemblyCut,AssemblySection,GeometryResult} from '@brickwright/cad-geometry';
import {assemblyCutJogs} from '@brickwright/cad-geometry';
import {projectAssembly,resolveAssemblyCut} from './assembly-drawing.js';
import type {AssemblyProjection} from './assembly-drawing.js';
import {layoutDrawingPages} from './drawing-layout.js';
import type {DrawingLayout} from './drawing-layout.js';
import {exportDrawingPdf} from './drawing-pdf.js';
import {exportDrawingSvg} from './drawing-svg.js';
import {exportDrawingDxf} from './drawing-dxf.js';
import type {DxfVersion} from './drawing-dxf.js';
import {isExactProjection,projectExactAssembly} from './exact-drawing-projection.js';

export {DXF_VERSIONS,drawingDxfBytes} from './drawing-dxf.js';
export type {DxfVersion} from './drawing-dxf.js';
export {drawingSvg} from './drawing-svg.js';
export {resolveAssemblyCut} from './assembly-drawing.js';

export type DrawingFormat='pdf'|'svg'|'dxf';
export const DRAWING_FORMATS:readonly DrawingFormat[]=['pdf','svg','dxf'];

/** The sheet a request names (a saved sheet's id or title), or a new assembly sheet with exact edges
 * and automatic dimensions; `overrides` change it for this rendering only. */
export function drawingSheetFor(doc:CadDocument,name?:string,overrides:{scale?:DrawingScale;hiddenLines?:boolean;exactEdges?:boolean;autoDimensions?:boolean}={}):{sheet:DrawingInputs;saved:boolean}{
 let sheet:DrawingInputs;
 const saved=name!==undefined;
 if(name!==undefined){
  const found=(doc.drawings??[]).filter(item=>item.id===name||item.title===name);
  if(found.length!==1)throw new Error(found.length?t`Several drawing sheets are called ${name}; give its id.`:t`No drawing sheet ${name}. Saved sheets: ${(doc.drawings??[]).map(item=>item.title).join(', ')||t('none saved')}`);
  sheet=structuredClone(found[0]);
 }else sheet={title:doc.title.trim().slice(0,80)||t('Drawing sheet'),source:{kind:'assembly'},scale:'1:1',hiddenLines:true,exactEdges:true,autoDimensions:true};
 if(overrides.scale!==undefined){
  if(!drawingScales.includes(overrides.scale))throw new Error(t`Choose a drawing scale: ${drawingScales.join(', ')}`);
  sheet.scale=overrides.scale;
 }
 if(overrides.hiddenLines!==undefined)sheet.hiddenLines=overrides.hiddenLines;
 if(isAssemblyDrawingSource(sheet.source)){
  const exact=overrides.exactEdges??!!sheet.exactEdges,auto=exact&&(overrides.autoDimensions??(overrides.exactEdges&&!saved?true:!!sheet.autoDimensions));
  delete sheet.exactEdges;delete sheet.autoDimensions;
  if(exact)sheet.exactEdges=true;
  if(auto)sheet.autoDimensions=true;
 }
 return {sheet,saved};
}

/** The cut of an assembly sheet's section (resolved parameters), if it has one. */
export function drawingSheetCut(doc:CadDocument,sheet:DrawingInputs):AssemblyCut|undefined{
 return isAssemblyDrawingSource(sheet.source)&&sheet.section?resolveAssemblyCut(doc,sheet.section):undefined;
}
/** The planes an exact section request cuts at. */
export const sectionPlanes=(cut:AssemblyCut)=>({axis:cut.axis,positions:[cut.position,...assemblyCutJogs(cut).map(jog=>jog.position)]});

export interface DrawingRenderInput {
 geometry:GeometryResult;
 /** The exact kernel's drawing data (sheets with exact edges). */
 exact?:ExactDrawingData;
 /** The mesh slice of the sheet's section, and the exact cut faces for exact sheets. */
 section?:AssemblySection&{exact?:ExactSectionData};
}
export interface DrawingRender {
 pages:DrawingLayout[];
 /** The scale used (the sheet's, or the largest that fits when `fit` was asked). */
 scale:DrawingScale;
 /** What the sheet says about where its lines came from, and what was left off. */
 notes:string[];
}

/**
 * Lay out a sheet. With `fit`, an assembly sheet that does not fit at its scale is tried at smaller
 * scales (and a larger one first when it is small), so a default sheet always lands on A4.
 */
export function renderDrawingSheet(doc:CadDocument,sheet:DrawingInputs,input:DrawingRenderInput,options:{fit?:boolean}={}):DrawingRender{
 const assembly=isAssemblyDrawingSource(sheet.source);
 let projection:AssemblyProjection|undefined;
 if(assembly){
  projection=sheet.exactEdges&&input.exact?projectExactAssembly(input.geometry,input.exact):projectAssembly(input.geometry);
  if(sheet.exactEdges&&!input.exact)throw new Error(t('Exact edges are unavailable: the exact kernel did not run.'));
  if(input.section)projection={...projection,sections:[input.section]};
 }
 const scales=options.fit&&assembly?[...drawingScales].reverse():[sheet.scale];
 let failure:unknown;
 for(const scale of scales){
  try{
   const pages=layoutDrawingPages(doc,{...sheet,scale},projection);
   const notes:string[]=[],exact=projection&&isExactProjection(projection)?projection.exact:undefined;
   if(exact){
    notes.push(t`Edges from the exact B-rep: ${exact.exactBodies.length} bodies`);
    for(const body of exact.meshBodies)notes.push(t`${body.name} drawn from its mesh: ${body.reason}`);
   }
   const auto=pages[0].autoDimensions;
   if(auto)notes.push(t`Automatic dimensions: ${auto.placed} placed, ${auto.callouts} hole callouts, ${auto.omitted} left off for lack of room`);
   return {pages,scale,notes};
  }catch(error){failure=error;if(!options.fit)throw error;}
 }
 throw failure;
}

/** Write a laid-out sheet: PDF (every page), SVG or DXF (the views page). */
export function writeDrawing(render:DrawingRender,title:string,format:DrawingFormat,dxfVersion:DxfVersion='R2000'){
 const [first,...rest]=render.pages;
 if(format==='pdf')return exportDrawingPdf(first,title,rest);
 if(format==='svg')return exportDrawingSvg(first,title);
 if(format==='dxf')return exportDrawingDxf(first,title,dxfVersion);
 throw new Error(t`Choose a drawing format: ${DRAWING_FORMATS.join(', ')}`);
}
