// SPDX-License-Identifier: BSD-3-Clause
// Sheet additions of an assembly drawing projected from the exact B-rep (exact-drawing-projection.ts):
// its curves and silhouettes, true arcs, the isometric view where the sheet has room, and the notes
// that say which bodies were drawn from exact edges and which from their mesh, with the exact
// overall size and hole diameters.
import {t} from '@brickwright/cad-core';
import type {DrawingInputs,SketchPoint} from '@brickwright/cad-core';
import type {AssemblyProjection} from './assembly-drawing.js';
import {dimensionText} from './drawing-annotation.js';
import type {DrawingLayout,DrawingText} from './drawing-page.js';
import type {Box} from './drawing-auto-dimensions.js';
import type {DrawingArc,ExactAssemblyProjection,ExactViewLines} from './exact-drawing-projection.js';

/** A visible arc of an exact edge on paper, for curve dimensions (radius in model millimetres). */
export type PaperArc={center:SketchPoint;radius:number;paperRadius:number;start:number;sweep:number};

export const exactProjection=(projection:AssemblyProjection):ExactAssemblyProjection|undefined=>
 'exact' in projection?projection as ExactAssemblyProjection:undefined;

function addLines(page:DrawingLayout,lines:ExactViewLines,left:number,bottom:number,factor:number,hidden:boolean){
 const point=([u,v]:SketchPoint):SketchPoint=>[left+u*factor,bottom+v*factor];
 // Hidden lines first, so visible ones are drawn over them.
 for(const wanted of hidden?[true,false]:[false]){
  for(const line of lines.polylines)if(line.hidden===wanted)page.paths.push({stroke:wanted?'hidden':'visible',points:line.points.map(point)});
  for(const arc of lines.arcs)if(arc.hidden===wanted){
   const full=Math.abs(arc.sweep)>=2*Math.PI-1e-9;
   page.circles.push({center:point(arc.center),radius:arc.radius*factor,...(full?{}:{arc:{start:arc.start,sweep:arc.sweep}}),...(wanted?{hidden:true as const}:{})});
  }
  for(const e of lines.ellipses)if(e.hidden===wanted)(page.ellipses??=[]).push({center:point(e.center),major:[e.major[0]*factor,e.major[1]*factor],ratio:e.ratio,start:e.start,sweep:e.sweep,...(wanted?{hidden:true as const}:{})});
 }
}

const names=(list:string[])=>list.length<=3?list.join(', '):t`${list.slice(0,3).join(', ')} and ${list.length-3} more`;

/**
 * Draw what the exact projection adds to an assembly sheet: curves and arcs of the three views,
 * the isometric view (top right, when no section uses that corner and it fits), and the notes.
 * Returns the visible arcs of each view on paper, for curve dimensions.
 */
export function addExactAssemblyLines(page:DrawingLayout,sheet:DrawingInputs,projection:ExactAssemblyProjection,
 placements:readonly (readonly [unknown,number,number])[],factor:number,corner:{x:number;y:number;free:boolean}):{arcs:PaperArc[][];iso?:Box;notes:DrawingText[]}{
 const arcs:PaperArc[][]=[];
 let isoBox:Box|undefined;
 for(const [index,[,left,bottom]] of placements.entries()){
  const lines=projection.lines[index];
  addLines(page,lines,left,bottom,factor,sheet.hiddenLines);
  arcs.push(lines.arcs.filter((arc:DrawingArc)=>!arc.hidden).map(arc=>({center:[left+arc.center[0]*factor,bottom+arc.center[1]*factor],radius:arc.radius,paperRadius:arc.radius*factor,start:arc.start,sweep:arc.sweep})));
 }
 const {iso}=projection;
 if(corner.free){
  // The sheet's scale if the view fits there, else smaller (and said so).
  const room=[274-corner.x,169-corner.y],scale=Math.min(factor,room[0]/Math.max(iso.width,1e-9),room[1]/Math.max(iso.height,1e-9));
  if(scale>=factor*.1&&scale>0){
   for(let i=0;i<iso.segments.length;i+=5)page.paths.push({stroke:'visible',points:[[corner.x+iso.segments[i]*scale,corner.y+iso.segments[i+1]*scale],[corner.x+iso.segments[i+2]*scale,corner.y+iso.segments[i+3]*scale]]});
   addLines(page,iso.lines,corner.x,corner.y,scale,false);
   page.texts.push({x:corner.x,y:corner.y+iso.height*scale+4,text:scale<factor-1e-12?t('Isometric view (not to scale)'):t('Isometric view'),size:3.5});
   isoBox={l:corner.x,b:corner.y,r:corner.x+iso.width*scale,t:corner.y+iso.height*scale};
  }
 }
 const {exact}=projection,total=exact.exactBodies.length+exact.meshBodies.length;
 const notes:string[]=[];
 notes.push(exact.meshBodies.length
  ?t`Edges: exact B-rep for ${exact.exactBodies.length} of ${total} bodies; from the mesh: ${names(exact.meshBodies.map(body=>body.name))}`
  :total===1?t('Edges: exact B-rep (1 body)'):t`Edges: exact B-rep (${total} bodies)`);
 if(exact.exactBodies.length){
  const [x,y,z]=exact.size.map(dimensionText);
  const holes=exact.holes.map(hole=>t`${hole.count} × Ø${dimensionText(hole.diameter)}`).join(' · ');
  notes.push(t`Exact overall size ${x} × ${y} × ${z} mm`+(holes?' · '+t`Holes ${holes} mm`:''));
 }
 const noteTexts=notes.map((text,i)=>({x:14,y:36-i*3.4,text,size:2.5}));
 page.texts.push(...noteTexts);
 return {arcs,...(isoBox?{iso:isoBox}:{}),notes:noteTexts};
}
