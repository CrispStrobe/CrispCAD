// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {CadDocument,DrawingInputs} from '@brickwright/cad-core';
import type {AssemblyProjection} from './assembly-drawing.js';
import {addDrawingFrame} from './drawing-page.js';
import type {DrawingLayout} from './drawing-page.js';

const lineHeight=5;
const nameWidth=68;

function wrapName(name:string){
 const lines:string[]=[];
 let characters=[...name];
 while(characters.length>nameWidth){
  const lastSpace=characters.slice(0,nameWidth+1).lastIndexOf(' ');
  const split=lastSpace>nameWidth/2?lastSpace:nameWidth;
  lines.push(characters.slice(0,split).join(''));
  characters=[...characters.slice(split).join('').trimStart()];
 }
 lines.push(characters.join(''));
 return lines;
}

export function layoutAssemblyPartsList(doc:CadDocument,sheet:DrawingInputs,projection:AssemblyProjection){
 const pages:DrawingLayout[]=[];
 const newPage=():DrawingLayout=>{
  const page:DrawingLayout={width:297,height:210,paths:[],texts:[],circles:[],anchors:[],annotationIssues:[],factor:1};
  addDrawingFrame(page,sheet.title,t('Parts list'));
  page.texts.push({x:17,y:169,text:t('Item'),size:3.4},{x:38,y:169,text:t('Body name'),size:3.4});
  page.paths.push({points:[[14,166],[283,166]],stroke:'border'});
  pages.push(page);
  return page;
 };
 let page=newPage(),y=160;
 for(const [index,id] of projection.bodyIds.entries()){
  const lines=wrapName(doc.nodes[id].name);
  if(y-lines.length*lineHeight<30){page=newPage();y=160;}
  page.texts.push({x:17,y,text:String(index+1),size:3});
  for(const [line,name] of lines.entries())page.texts.push({x:38,y:y-line*lineHeight,text:name,size:3});
  y-=lines.length*lineHeight;
 }
 for(const [i,page] of pages.entries()){
  page.paths.push({points:[[8,26],[289,26]],stroke:'border'});
  page.texts.push({x:14,y:17,size:3,text:t`Parts list ${i+1} of ${pages.length}`});
 }
 return pages;
}
