// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {AssemblyProjection} from './assembly-drawing.js';
import type {GeometryResult} from '@brickwright/cad-geometry';
import type {CadDocument} from '@brickwright/cad-core';
import {layoutDrawingPages} from './drawing-layout.js';
import type {DrawingLayout} from './drawing-layout.js';
import {decimal,pair,pointsPerMillimetre,textOperand,vectorPdf} from './vector-pdf.js';

function drawingContent(layout:DrawingLayout){
 if(layout.annotationIssues.length)throw new Error(t('Repair or remove unavailable drawing dimensions before exporting.'));
 const commands=['q',pair(pointsPerMillimetre,0)+' '+pair(0,pointsPerMillimetre)+' 0 0 cm','0 G','0 g'];
 for(const {points,stroke,closed} of layout.paths){
  commands.push(stroke==='hidden'?'[1.4 0.9] 0 d':stroke==='cut'?'[3.5 1 0.7 1] 0 d':'[] 0 d');
  commands.push(stroke==='visible'||stroke==='section'?'0.26 w':stroke==='hatch'?'0.10 w':'0.14 w');
  commands.push(points.map(([x,y],i)=>pair(x,y)+(i?' l':' m')).join(' ')+(closed?' h S':' S'));
 }
 for(const {center:[x,y],radius:r} of layout.circles){
  const k=r*4*(Math.sqrt(2)-1)/3;
  const curves=[
   [x+r,y+k,x+k,y+r,x,y+r],
   [x-k,y+r,x-r,y+k,x-r,y],
   [x-r,y-k,x-k,y-r,x,y-r],
   [x+k,y-r,x+r,y-k,x+r,y]
  ];
  commands.push('[] 0 d','0.26 w',pair(x+r,y)+' m '+curves.map(curve=>curve.map(decimal).join(' ')+' c').join(' ')+' h S');
 }
 for(const {x,y,size,text} of layout.texts){
  commands.push('BT /F1 '+decimal(size)+' Tf '+pair(x,y)+' Td '+textOperand(text)+' Tj ET');
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

export function exportDrawingSetPdf(doc:CadDocument,geometry?:GeometryResult|AssemblyProjection){
 const sheets=doc.drawings??[];
 if(!sheets.length)throw new Error(t('Save a drawing sheet before exporting a drawing set.'));
 const layouts=sheets.flatMap(sheet=>{
  try{
   const pages=layoutDrawingPages(doc,sheet,geometry);
   if(pages.some(page=>page.annotationIssues.length))throw new Error(t('Repair or remove unavailable drawing dimensions before exporting.'));
   return pages;
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   throw new Error([sheet.title,message].join(' · '));
  }
 });
 const pages=layouts.map((layout,i)=>{
  layout.texts.push({x:187,y:17,size:3,text:t`Sheet ${i+1} of ${layouts.length}`});
  return {width:layout.width,height:layout.height,content:drawingContent(layout)};
 });
 return file(doc.title+' - '+t('Drawing set'),vectorPdf(pages));
}
