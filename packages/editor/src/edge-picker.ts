// SPDX-License-Identifier: BSD-3-Clause
// Edge picking for exact fillets and chamfers of individual edges. The exact kernel lists the
// body's B-rep edges (`edges` request: sample points and stable references); this draws them as a
// line drawing in an SVG the user taps. Every edge has a wide, invisible hit stroke, so a finger
// on a tablet can pick it, and view buttons turn the drawing; no keyboard is needed. Edges without
// a stable reference (a fillet's round, a seam) are drawn dimmed and cannot be picked.
import {formatEdgeReference,t} from '@brickwright/cad-core';
import type {ExactBodyEdge,ExactEdgeReference} from '@brickwright/cad-core';

const SVG='http://www.w3.org/2000/svg';
type View='iso'|'top'|'front'|'right';
/** Orthographic views: screen x and y (up) directions in model coordinates. */
const VIEWS:Record<View,{label:string;x:readonly number[];y:readonly number[]}>={
 iso:{label:'Iso',x:[Math.SQRT1_2,-Math.SQRT1_2,0],y:[-1/Math.sqrt(6),-1/Math.sqrt(6),2/Math.sqrt(6)]},
 top:{label:'Top',x:[1,0,0],y:[0,1,0]},
 front:{label:'Front',x:[1,0,0],y:[0,0,1]},
 right:{label:'Right',x:[0,1,0],y:[0,0,1]},
};
const dot=(a:readonly number[],b:readonly number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

export interface EdgePicker {
 readonly element:HTMLElement;
 /** The picked edges' stable references, in edge order. */
 selected():ExactEdgeReference[];
 /** Show `edges`; `preselect` are references to mark as picked (those not found are reported). */
 show(edges:readonly ExactBodyEdge[],preselect?:readonly ExactEdgeReference[]):void;
 /** Returns a function that removes the listener. */
 onChange(listener:()=>void):()=>void;
 /** The listed edges and the indices (into them) of the picked ones, for picking in the 3D view. */
 edges():readonly ExactBodyEdge[];
 picked():number[];
 /** Toggle the edge at `index` (as a tap in the drawing does); edges without a reference are ignored. */
 toggle(index:number):void;
 clear():void;
 /** One line saying how many edges are chosen (and how many previously chosen ones are gone). */
 summary():string;
}

export function createEdgePicker():EdgePicker{
 const element=document.createElement('div');element.className='edge-picker';
 const views=document.createElement('div');views.className='edge-picker-views';views.setAttribute('role','group');views.setAttribute('aria-label',t('Edge view'));
 const svg=document.createElementNS(SVG,'svg');svg.setAttribute('class','edge-picker-drawing');svg.setAttribute('role','group');svg.setAttribute('aria-label',t('Tap edges to choose them'));
 const summary=document.createElement('p');summary.className='edge-picker-summary';summary.setAttribute('aria-live','polite');
 const clear=document.createElement('button');clear.type='button';clear.textContent=t('Clear edges');
 const bar=document.createElement('div');bar.className='edge-picker-bar';bar.append(summary,clear);
 element.append(views,svg,bar);
 let view:View='iso',edges:readonly ExactBodyEdge[]=[],missing=0;
 const picked=new Set<number>(),listeners:(()=>void)[]=[];
 const changed=()=>{update();listeners.forEach(listener=>listener());};
 const viewButtons=(Object.keys(VIEWS) as View[]).map(key=>{
  const button=document.createElement('button');button.type='button';button.textContent=t(VIEWS[key].label);
  button.setAttribute('aria-pressed',String(key===view));button.dataset.view=key;
  button.onclick=()=>{view=key;viewButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));draw();};
  views.append(button);return button;
 });
 clear.onclick=()=>{if(picked.size){picked.clear();changed();}};

 function toggleEdge(i:number){if(!edges[i]?.reference)return;if(picked.has(i))picked.delete(i);else picked.add(i);changed();}
 const summaryText=()=>(picked.size?t`${picked.size} edges chosen`:t('Tap the edges to round or bevel.'))+(missing?' '+t`${missing} previously chosen edges no longer exist; choose them again.`:'');
 function update(){
  for(const path of svg.querySelectorAll<SVGPathElement>('[data-edge]')){
   const on=picked.has(Number(path.dataset.edge));
   path.setAttribute('aria-checked',String(on));
   path.parentElement?.classList.toggle('picked',on);
  }
  summary.textContent=summaryText();
  clear.disabled=!picked.size;
 }

 function draw(){
  svg.replaceChildren();
  const {x,y}=VIEWS[view];
  const projected=edges.map(edge=>edge.points.map(p=>[dot(p,x),-dot(p,y)] as const));
  const all=projected.flat();
  if(!all.length){update();return;}
  const minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0])),minY=Math.min(...all.map(p=>p[1])),maxY=Math.max(...all.map(p=>p[1]));
  const size=Math.max(maxX-minX,maxY-minY,1e-6),pad=size*.08;
  svg.setAttribute('viewBox',`${minX-pad} ${minY-pad} ${maxX-minX+2*pad} ${maxY-minY+2*pad}`);
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  edges.forEach((edge,i)=>{
   const d='M'+projected[i].map(p=>`${p[0]},${p[1]}`).join('L');
   const group=document.createElementNS(SVG,'g');group.setAttribute('class',edge.reference?'edge':'edge unpickable');
   const line=document.createElementNS(SVG,'path');line.setAttribute('d',d);line.setAttribute('class','edge-line');
   group.append(line);
   if(edge.reference){
    const hit=document.createElementNS(SVG,'path');hit.setAttribute('d',d);hit.setAttribute('class','edge-hit');
    hit.dataset.edge=String(i);hit.setAttribute('role','checkbox');hit.setAttribute('tabindex','0');
    hit.setAttribute('aria-label',t`Edge ${edge.number}: ${edge.curve}, ${Number(edge.length.toPrecision(4))} mm`);
    const toggle=()=>toggleEdge(i);
    hit.addEventListener('click',toggle);
    hit.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();toggle();}});
    group.append(hit);
   }
   svg.append(group);
  });
  update();
 }

 return {
  element,
  selected:()=>[...picked].sort((a,b)=>a-b).map(i=>edges[i].reference!),
  show(next,preselect=[]){
   edges=next;picked.clear();
   const keys=new Map(next.flatMap((edge,i)=>edge.reference?[[formatEdgeReference(edge.reference),i] as const]:[]));
   missing=0;
   for(const ref of preselect){const i=keys.get(formatEdgeReference(ref));if(i===undefined)missing++;else picked.add(i);}
   draw();
  },
  onChange(listener){listeners.push(listener);return ()=>{const i=listeners.indexOf(listener);if(i>=0)listeners.splice(i,1);};},
  edges:()=>edges,
  picked:()=>[...picked].sort((a,b)=>a-b),
  toggle:toggleEdge,
  clear(){if(!picked.size)return;picked.clear();changed();},
  summary:summaryText,
 };
}
