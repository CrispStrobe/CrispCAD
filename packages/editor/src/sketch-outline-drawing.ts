// SPDX-License-Identifier: BSD-3-Clause
import {newId,t} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';

const ns='http://www.w3.org/2000/svg';
const svgElement=<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>)=>{
  const node=document.createElementNS(ns,tag);
  for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
  return node;
};

export function mountSketchOutlineDrawing(onFinish:(points:SketchPoint[])=>void,onCancel:()=>void,snap:()=>number){
  const layout=document.createElement('section');
  layout.className='sketch-outline-drawing';
  layout.hidden=true;
  const toolbar=document.createElement('div');
  toolbar.className='sketch-drawing-controls';
  const grid=svgElement('svg',{role:'img','aria-label':t('2D outline drawing grid')});
  const gridId='sketch-grid-'+newId();
  const hoverLine=svgElement('line',{class:'sketch-drawing-hover'});
  const info=document.createElement('p');
  info.textContent=t('Click or tap to add corners. Hold Shift for horizontal or vertical edges. Click the first point to close the outline.');
  const button=(title:string,onClick:()=>void)=>{
    const control=document.createElement('button');control.type='button';control.textContent=t(title);control.onclick=onClick;toolbar.append(control);return control;
  };
  let points:SketchPoint[]=[],extent=60,hover:SketchPoint|undefined;
  const close=()=>{if(points.length>=3)onFinish(points.map(point=>[...point]));};
  const undo=button('Undo point',()=>{points.pop();render();});
  button('Zoom in',()=>{extent=Math.max(3,extent/1.5);render();});
  button('Zoom out',()=>{extent=Math.min(6000,extent*1.5);render();});
  const finish=button('Close outline',close);
  button('Cancel drawing',onCancel);
  layout.append(grid,toolbar,info);
  function render(){
    grid.setAttribute('viewBox',`${-extent} ${-extent} ${2*extent} ${2*extent}`);
    const step=Math.max(snap(),10**Math.floor(Math.log10(extent/6)));
    const pattern=svgElement('pattern',{id:gridId,patternUnits:'userSpaceOnUse',width:step,height:step});
    pattern.append(svgElement('path',{d:`M 0 ${step} V 0 H ${step}`,class:'sketch-drawing-gridline'}));
    grid.replaceChildren(pattern,svgElement('rect',{x:-extent,y:-extent,width:2*extent,height:2*extent,fill:`url(#${gridId})`}),
      svgElement('path',{d:`M ${-extent} 0 H ${extent} M 0 ${-extent} V ${extent}`,class:'sketch-drawing-axis'}));
    if(points.length)grid.append(svgElement('polyline',{points:points.map(([x,y])=>`${x},${-y}`).join(' '),class:'sketch-drawing-line'}));
    grid.append(hoverLine);
    renderHover();
    points.forEach(([x,y],index)=>grid.append(svgElement('circle',{cx:x,cy:-y,r:extent*.025,class:index?'sketch-drawing-point':'sketch-drawing-start'})));
    undo.disabled=!points.length;
    finish.disabled=points.length<3;
  }
  function renderHover(){
    const last=points.at(-1);
    hoverLine.style.display=hover&&last?'':'none';
    if(!hover||!last)return;
    hoverLine.setAttribute('x1',String(last[0]));
    hoverLine.setAttribute('y1',String(-last[1]));
    hoverLine.setAttribute('x2',String(hover[0]));
    hoverLine.setAttribute('y2',String(-hover[1]));
  }
  function locate(event:PointerEvent):SketchPoint|undefined{
    const matrix=grid.getScreenCTM();if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    if(Math.abs(point.x)>extent||Math.abs(point.y)>extent)return;
    const [x,y]=[point.x,-point.y],step=snap();
    const round=(value:number)=>Number((step>0?Math.round(value/step)*step:value).toFixed(5));
    let snapped:SketchPoint=[round(x),round(y)];
    const first=points[0],last=points.at(-1);
    if(points.length>=3&&Math.hypot(x-first[0],y-first[1])<=extent*.045)return first;
    if(event.shiftKey&&last){
      snapped=Math.abs(x-last[0])>=Math.abs(y-last[1])?[snapped[0],last[1]]:[last[0],snapped[1]];
    }
    return snapped;
  }
  grid.onpointermove=event=>{if(event.pointerType==='touch')return;hover=locate(event);renderHover();};
  grid.onpointerleave=()=>{hover=undefined;renderHover();};
  grid.onpointerdown=event=>{
    if(event.button!==0)return;
    const next=locate(event);if(!next)return;
    event.preventDefault();
    if(points.length>=3&&next===points[0]){close();return;}
    const last=points.at(-1);
    if(points.length>=32||last?.every((value,index)=>value===next[index]))return;
    points.push(next);hover=undefined;render();
  };
  return {layout,open(){points=[];extent=60;hover=undefined;layout.hidden=false;render();},close(){layout.hidden=true;}};
}
