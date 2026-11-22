// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';
import type {AssemblySection} from '@brickwright/cad-geometry';
import type {AssemblyProjection} from './assembly-drawing.js';
import {dimensionText} from './drawing-annotation.js';
import type {DrawingLayout} from './drawing-page.js';

export function addAssemblySection(page:DrawingLayout,projection:AssemblyProjection,section:AssemblySection,topX:number,topY:number,rightX:number){
 if(!section.bodies.length)throw new Error(t('The section plane misses the assembly solids.'));
 const {axis,position,jog}=section.cut,across=axis===0?1:0;
 const {origin}=projection,[top,front]=projection.views;
 const width=(axis===0?top.height:top.width)*page.factor,height=front.height*page.factor;
 if(rightX+width>274||topY+height>169)throw new Error(t('This drawing does not fit on A4 at this scale. Choose a smaller scale.'));
 const planeAlong=(value:number)=>(value-origin[axis])*page.factor;
 const first=planeAlong(position),second=jog?planeAlong(jog.position):first;
 const span=axis===0?top.height:top.width;
 const mark=(along:number,plane:number,offset=0):SketchPoint=>axis===0
  ?[topX+plane+offset,topY+along]
  :[topX+along,topY+plane+offset];
 const firstEnd=-3,lastEnd=span*page.factor+3,direction=axis===0?-1:1;
 const line=[mark(firstEnd,first)];
 if(jog){
  const transition=(jog.at-origin[across])*page.factor;
  line.push(mark(transition,first),mark(transition,second));
 }
 line.push(mark(lastEnd,second));
 page.paths.push({stroke:'cut',points:line});
 for(const [end,plane] of [[firstEnd,first],[lastEnd,second]]){
  page.paths.push({stroke:'visible',points:[mark(end-1.1,plane,-direction*2),mark(end,plane,direction*2),mark(end+1.1,plane,-direction*2)]});
  const [x,y]=mark(end,plane,-direction*4);
  page.texts.push({x:x+1,y:y+1,text:'A',size:2.8});
 }
 page.texts.push({x:rightX,y:topY+height+4,text:jog?t('Offset section A-A'):t('Section A-A'),size:3.5});
 const value=dimensionText(position)+(jog?' / '+dimensionText(jog.position):'');
 page.texts.push({x:rightX,y:topY+height+9,text:axis===0?t`World X = ${value} mm`:t`World Y = ${value} mm`,size:2.8});
 let crossingsChecked=0;
 for(const [index,body] of section.bodies.entries()){
  const loops=body.loops.map(loop=>loop.map(([u,z]):SketchPoint=>[rightX+(u-origin[across])*page.factor,topY+(z-origin[2])*page.factor]));
  const slope=index%2?-1:1;
  const acrossHatch=([x,y]:SketchPoint)=>x-slope*y;
  let min=Infinity,max=-Infinity;
  for(const loop of loops){
   page.paths.push({stroke:'section',points:loop,closed:true});
   for(const point of loop){
    const coordinate=acrossHatch(point);
    min=Math.min(min,coordinate);max=Math.max(max,coordinate);
   }
  }
  for(let intercept=Math.ceil(min/3)*3;intercept<max;intercept+=3){
   const intersections:number[]=[];
   for(const loop of loops)for(const [i,a] of loop.entries()){
    if(++crossingsChecked>1000000)throw new Error(t('This section exceeds the drawing detail limit.'));
    const b=loop[(i+1)%loop.length],ca=acrossHatch(a),cb=acrossHatch(b);
    if((ca>intercept)===(cb>intercept))continue;
    intersections.push(a[0]+(b[0]-a[0])*(intercept-ca)/(cb-ca));
   }
   intersections.sort((a,b)=>a-b);
   for(let i=1;i<intersections.length;i+=2){
    const [left,right]=[intersections[i-1],intersections[i]];
    if(right-left>1e-6)page.paths.push({stroke:'hatch',points:[[left,slope*(left-intercept)],[right,slope*(right-intercept)]]});
   }
  }
 }
}
