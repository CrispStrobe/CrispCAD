import {axisLabel} from './resize-label-layout.js';
import type {ScreenRect} from './resize-label-layout.js';
import {fineNumberKeys} from './precision.js';
// SPDX-License-Identifier: BSD-3-Clause
import type {CadSession,Transform} from '@brickwright/cad-core';
import {t} from '@brickwright/cad-core';
export interface TransformAxisAnchor {axis:'X'|'Y'|'Z';point:[number,number];direction:[number,number];visible:boolean;guide?:{from:[number,number];to:[number,number]}}
export interface TransformPreview {screenBounds?:ScreenRect;resizing?:boolean;dimensionHandles?:boolean;mode:'select'|'translate'|'rotate'|'scale';poses:{id:string;transform:Transform}[];dragging:boolean;axes:TransformAxisAnchor[];bounds?:{min:[number,number,number];max:[number,number,number]};valid:boolean;warning?:string}
/** Numbers attach to projected axes/handles; view previews never create model edits. */
export function mountTransformReadout(parent:HTMLElement,session:CadSession,onError:(e:unknown)=>void,onVisibilityChange?:(visible:boolean)=>void){
 const panel=document.createElement('section');panel.className='transform-readout';panel.setAttribute('aria-label',t('On-canvas parameters'));panel.hidden=true;parent.append(panel);
 const ns='http://www.w3.org/2000/svg',guides=document.createElementNS(ns,'svg');guides.classList.add('readout-guides');guides.setAttribute('aria-hidden','true');panel.append(guides);
 let visible=false,last:TransformPreview|undefined;
 const lines=['X','Y','Z'].map(axis=>{const line=document.createElementNS(ns,'line');line.dataset.axis=axis;guides.append(line);return line;});
 const inputs=['X','Y','Z'].map((axis,index)=>{const input=document.createElement('input');input.type='number';input.step='.1';input.className='axis-number';input.dataset.axis=axis;panel.append(input);
  input.addEventListener('change',()=>{if(!last||last.dragging)return;const key=last.mode==='rotate'?'rotation':last.mode==='scale'?'scale':'position';try{const value=Number(input.value);if(!input.value.trim()||!Number.isFinite(value))throw new Error(t('Enter a finite numeric value'));session.transform(last.poses.map(({id})=>{const transform=structuredClone(session.state.document.nodes[id].transform);transform[key][index]=value;return {id,transform};}));}catch(error){onError(error);}refresh({...last,poses:last.poses.filter(p=>!!session.state.document.nodes[p.id]).map(p=>({id:p.id,transform:structuredClone(session.state.document.nodes[p.id].transform)}))});});
  input.addEventListener('keydown',e=>{if(fineNumberKeys(input,e))return;e.stopPropagation();if(e.key==='Enter'){e.preventDefault();input.blur();}else if(e.key==='Escape'){input.value=String(last?.poses[0]?.transform[last.mode==='rotate'?'rotation':last.mode==='scale'?'scale':'position'][index]??0);input.blur();}});return input;});
 function refresh(next:TransformPreview){last=next;panel.hidden=!visible||!next.poses.length||next.mode==='select'&&next.dimensionHandles!==false&&!next.dragging||next.mode==='scale'&&next.dimensionHandles!==false||!!next.resizing;if(panel.hidden)return;const key=next.mode==='rotate'?'rotation':next.mode==='scale'?'scale':'position',name=key==='rotation'?'Rotation':key==='scale'?'Scale':'Position';
  panel.dataset.dragging=String(next.dragging);panel.dataset.valid=String(next.valid);
  const occupied:ScreenRect[]=[];
  inputs.forEach((input,i)=>{const axis=['X','Y','Z'][i],property=`${key}${axis}`,anchor=next.axes.find(a=>a.axis===axis),line=lines[i];
   input.setAttribute('aria-label',t`On-canvas ${t(name)} ${axis}`);input.readOnly=next.dragging;input.disabled=next.poses.some(p=>session.state.document.parametric?.bindings.some(b=>b.nodeId===p.id&&b.property===property));
   input.title=!next.valid?(next.warning??t('Cannot commit this transform')):input.disabled?t('Driven by an expression; edit it in Parameters'):`${t(name)} ${axis} (${key==='rotation'?'°':key==='scale'?'×':'mm'})${next.poses.length>1?t(' · per-object value'):''}`;
   const focused=(input.getRootNode() as ShadowRoot).activeElement===input;if(!focused||next.dragging)input.value=String(Number(next.poses[0].transform[key][i].toFixed(5)));
   const width=Math.max(34,Math.min(92,input.value.length*7+12));input.style.width=`${width}px`;input.hidden=!anchor?.visible;
   line.style.display=anchor?.visible&&anchor.guide?'':'none';
   if(!anchor?.visible)return;
   if(anchor.guide){line.setAttribute('x1',String(anchor.guide.from[0]));line.setAttribute('y1',String(anchor.guide.from[1]));line.setAttribute('x2',String(anchor.guide.to[0]));line.setAttribute('y2',String(anchor.guide.to[1]));}
   const dx=anchor.direction[0],dy=anchor.direction[1],distance=8+Math.abs(dx)*width/2+Math.abs(dy)*11,layout=next.screenBounds?axisLabel(anchor.point,anchor.direction,next.screenBounds,{width:parent.clientWidth,height:parent.clientHeight},occupied,width):undefined;
   const x=layout?.x??anchor.point[0]+dx*distance,y=layout?.y??anchor.point[1]+dy*distance;
   input.hidden=!!next.screenBounds&&!layout||x-width/2<2||x+width/2>parent.clientWidth-2||y<13||y>parent.clientHeight-44;
   if(input.hidden)line.style.display='none';
   if(!input.hidden&&layout){occupied.push(layout.rect);line.style.display='';line.setAttribute('x1',String(anchor.point[0]));line.setAttribute('y1',String(anchor.point[1]));line.setAttribute('x2',String(x-dx*distance));line.setAttribute('y2',String(y-dy*distance));}
   input.style.left=`${x}px`;input.style.top=`${y}px`;input.dataset.anchorX=String(anchor.point[0]);input.dataset.anchorY=String(anchor.point[1]);
  });
 }
 return {update:refresh,get visible(){return visible;},setVisible(value:boolean){visible=value;if(last)refresh(last);onVisibilityChange?.(value);},dispose(){panel.remove();}};
}
