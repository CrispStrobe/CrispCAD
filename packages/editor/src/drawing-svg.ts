// SPDX-License-Identifier: BSD-3-Clause
// A drawing sheet as a standalone SVG file: the paper in millimetres (width and height in mm, one
// user unit per millimetre, so it prints and imports at actual size), lines in the PDF's weights
// and dash patterns, circles and arcs as SVG circles and arcs, ellipses as exact SVG elliptical
// arcs, text in Helvetica (Arial or a sans-serif font where it is missing).
import {t} from '@brickwright/cad-core';
import {svgEllipseArc} from './drawing-conic.js';
import type {DrawingLayout,DrawingPath} from './drawing-page.js';

const number=(value:number)=>String(Number(value.toFixed(4))+0);
const escape=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/** Stroke weight (mm) and dash pattern of each kind of line, as in the PDF. */
const strokes:Record<DrawingPath['stroke'],{width:number;dash?:string}>={
 visible:{width:.26},section:{width:.26},hidden:{width:.14,dash:'1.4 0.9'},cut:{width:.14,dash:'3.5 1 0.7 1'},
 hatch:{width:.1},center:{width:.14},dimension:{width:.14},border:{width:.14},annotation:{width:.14},
};

/** The SVG text of one sheet (paper coordinates are y-up; SVG's are y-down). */
export function drawingSvg(layout:DrawingLayout,title:string){
 const h=layout.height,y=(v:number)=>number(h-v),groups=new Map<string,string[]>();
 const add=(stroke:DrawingPath['stroke'],d:string)=>{const l=groups.get(stroke);if(l)l.push(d);else groups.set(stroke,[d]);};
 for(const {points,stroke,closed} of layout.paths)add(stroke,points.map(([px,py],i)=>(i?'L':'M')+number(px)+' '+y(py)).join(' ')+(closed?' Z':''));
 const circles:string[]=[];
 for(const {center:[cx,cy],radius,arc,hidden} of layout.circles){
  if(!arc){circles.push(`<circle class="${hidden?'hidden':'visible'}" cx="${number(cx)}" cy="${y(cy)}" r="${number(radius)}"/>`);continue;}
  const at=(a:number)=>number(cx+radius*Math.cos(a))+' '+y(cy+radius*Math.sin(a));
  add(hidden?'hidden':'visible','M'+at(arc.start)+' A'+number(radius)+' '+number(radius)+' 0 '+(Math.abs(arc.sweep)>Math.PI?1:0)+' '+(arc.sweep>0?0:1)+' '+at(arc.start+arc.sweep));
 }
 for(const ellipse of layout.ellipses??[]){
  const {rx,ry,rotation,point}=svgEllipseArc(ellipse,h),full=ellipse.sweep>=2*Math.PI-1e-9;
  const at=(t:number)=>point(t).map(number).join(' ');
  const arc=(t:number,large:number)=>' A'+number(rx)+' '+number(ry)+' '+number(rotation)+' '+large+' 0 '+at(t);
  add(ellipse.hidden?'hidden':'visible','M'+at(ellipse.start)+(full?arc(ellipse.start+Math.PI,0)+arc(ellipse.start,0):arc(ellipse.start+ellipse.sweep,ellipse.sweep>Math.PI?1:0)));
 }
 const style=Object.entries(strokes).map(([name,{width,dash}])=>`.${name}{fill:none;stroke:#000;stroke-width:${width};stroke-linecap:round;stroke-linejoin:round${dash?`;stroke-dasharray:${dash}`:''}}`).join('');
 const texts=layout.texts.map(({x,y:ty,size,text,angle})=>`<text x="${number(x)}" y="${y(ty)}" font-size="${number(size)}"${angle?` transform="rotate(${number(-angle)} ${number(x)} ${y(ty)})"`:''}>${escape(text)}</text>`);
 return [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<svg xmlns="http://www.w3.org/2000/svg" width="${number(layout.width)}mm" height="${number(h)}mm" viewBox="0 0 ${number(layout.width)} ${number(h)}">`,
  `<title>${escape(title)}</title>`,
  `<desc>${escape(t('Drawing sheet, 1 unit = 1 mm on paper. Print at actual size (100%).'))}</desc>`,
  `<style>${style}text{font-family:Helvetica,Arial,sans-serif;fill:#000}</style>`,
  `<rect width="${number(layout.width)}" height="${number(h)}" fill="#fff"/>`,
  ...[...groups].map(([stroke,list])=>`<path class="${stroke}" d="${list.join(' ')}"/>`),
  ...circles,
  ...texts,
  '</svg>',''
 ].join('\n');
}

const fileName=(title:string,extension:string)=>(title.replace(/[^\p{L}\p{N} ._-]+/gu,'-').trim()||'drawing')+extension;

/** The first page of a sheet (the views) as an SVG file. Parts list pages stay in the PDF. */
export function exportDrawingSvg(layout:DrawingLayout,title:string){
 if(layout.annotationIssues.length)throw new Error(t('Repair or remove unavailable drawing dimensions before exporting.'));
 return {name:fileName(title,'.svg'),mime:'image/svg+xml',bytes:new TextEncoder().encode(drawingSvg(layout,title))};
}
export {fileName as drawingFileName};
