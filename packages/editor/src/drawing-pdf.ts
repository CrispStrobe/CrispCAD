// SPDX-License-Identifier: BSD-3-Clause
import type {DrawingLayout} from './drawing-layout.js';
import {decimal,pair,pointsPerMillimetre,singlePagePdf,textOperand} from './vector-pdf.js';

export function exportDrawingPdf(layout:DrawingLayout,title:string){
 const commands=['q',pair(pointsPerMillimetre,0)+' '+pair(0,pointsPerMillimetre)+' 0 0 cm','0 G','0 g'];
 for(const {points,stroke,closed} of layout.paths){
  commands.push(stroke==='hidden'?'[1.4 0.9] 0 d':'[] 0 d');
  commands.push(stroke==='visible'?'0.26 w':'0.14 w');
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
 const name=title.replace(/[^\p{L}\p{N} ._-]+/gu,'-').trim()||'drawing';
 return {name:name+'.pdf',mime:'application/pdf',bytes:singlePagePdf(layout.width,layout.height,commands.join('\n')+'\nQ\n')};
}
