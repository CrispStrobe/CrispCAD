// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {AssemblyProjection} from './assembly-drawing.js';
import type {GeometryResult} from '@brickwright/cad-geometry';
import type {CadDocument,DrawingSheet} from '@brickwright/cad-core';
import {layoutDrawingPages} from './drawing-layout.js';
import type {DrawingLayout} from './drawing-layout.js';
import {decimal,pair,pointsPerMillimetre,textOperand,vectorPdf} from './vector-pdf.js';
import {ellipseBeziers} from './drawing-conic.js';

function drawingContent(layout:DrawingLayout){
 if(layout.annotationIssues.length)throw new Error(t('Repair or remove unavailable drawing dimensions before exporting.'));
 const commands=['q',pair(pointsPerMillimetre,0)+' '+pair(0,pointsPerMillimetre)+' 0 0 cm','0 G','0 g'];
 for(const {points,stroke,closed} of layout.paths){
  commands.push(stroke==='hidden'?'[1.4 0.9] 0 d':stroke==='cut'?'[3.5 1 0.7 1] 0 d':'[] 0 d');
  commands.push(stroke==='visible'||stroke==='section'?'0.26 w':stroke==='hatch'?'0.10 w':'0.14 w');
  commands.push(points.map(([x,y],i)=>pair(x,y)+(i?' l':' m')).join(' ')+(closed?' h S':' S'));
 }
 for(const {center:[x,y],radius:r,arc,hidden} of layout.circles){
  // Cubic Béziers of at most a quarter turn each (the full circle is four of them).
  const start=arc?.start??0,sweep=arc?.sweep??2*Math.PI,count=Math.max(1,Math.ceil(Math.abs(sweep)/(Math.PI/2)-1e-9)),step=sweep/count;
  const k=4/3*Math.tan(step/4)*r,at=(a:number)=>[x+r*Math.cos(a),y+r*Math.sin(a)];
  const curves=Array.from({length:count},(_,i)=>{
   const a=start+i*step,b=a+step,[x0,y0]=at(a),[x3,y3]=at(b);
   return [x0-k*Math.sin(a),y0+k*Math.cos(a),x3+k*Math.sin(b),y3-k*Math.cos(b),x3,y3];
  });
  const [sx,sy]=at(start);
  commands.push(hidden?'[1.4 0.9] 0 d':'[] 0 d',hidden?'0.14 w':'0.26 w',pair(sx,sy)+' m '+curves.map(curve=>curve.map(decimal).join(' ')+' c').join(' ')+(arc?' S':' h S'));
 }
 // Ellipses: the affine image of the circle's Bézier arcs (within 2.7e-4 of the major semi-axis).
 for(const ellipse of layout.ellipses??[]){
  const {start:[sx,sy],curves}=ellipseBeziers(ellipse),full=ellipse.sweep>=2*Math.PI-1e-9;
  commands.push(ellipse.hidden?'[1.4 0.9] 0 d':'[] 0 d',ellipse.hidden?'0.14 w':'0.26 w',pair(sx,sy)+' m '+curves.map(curve=>curve.map(decimal).join(' ')+' c').join(' ')+(full?' h S':' S'));
 }
 for(const {x,y,size,text,angle} of layout.texts){
  if(angle){
   const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
   commands.push('BT /F1 '+decimal(size)+' Tf '+[c,s,-s,c].map(decimal).join(' ')+' '+pair(x,y)+' Tm '+textOperand(text)+' Tj ET');
  }else commands.push('BT /F1 '+decimal(size)+' Tf '+pair(x,y)+' Td '+textOperand(text)+' Tj ET');
 }
 return commands.join('\n')+'\nQ\n';
}

const file=(title:string,bytes:Uint8Array)=>{
 const name=title.replace(/[^\p{L}\p{N} ._-]+/gu,'-').trim()||'drawing';
 return {name:name+'.pdf',mime:'application/pdf',bytes};
};

export function exportDrawingPdf(layout:DrawingLayout,title:string,additional:DrawingLayout[]=[]){
 const pages=[layout,...additional].map(page=>({width:page.width,height:page.height,content:drawingContent(page)}));
 return file(title,vectorPdf(pages));
}

/** `geometry`: the assembly projection, or per sheet the one it uses (exact edges or meshes). */
export function exportDrawingSetPdf(doc:CadDocument,geometry?:GeometryResult|AssemblyProjection|((sheet:DrawingSheet)=>AssemblyProjection|undefined)){
 const sheets=doc.drawings??[];
 if(!sheets.length)throw new Error(t('Save a drawing sheet before exporting a drawing set.'));
 const layouts=sheets.flatMap(sheet=>{
  try{
   const pages=layoutDrawingPages(doc,sheet,typeof geometry==='function'?geometry(sheet):geometry);
   if(pages.some(page=>page.annotationIssues.length))throw new Error(t('Repair or remove unavailable drawing dimensions before exporting.'));
   return pages.map(layout=>({layout,hasTitleBlock:!!sheet.titleBlock}));
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   throw new Error([sheet.title,message].join(' · '));
  }
 });
 const pages=layouts.map(({layout,hasTitleBlock},i)=>{
  layout.texts.push({x:hasTitleBlock?229:187,y:hasTitleBlock?22:17,size:3,text:t`Sheet ${i+1} of ${layouts.length}`});
  return {width:layout.width,height:layout.height,content:drawingContent(layout)};
 });
 return file(doc.title+' - '+t('Drawing set'),vectorPdf(pages));
}
