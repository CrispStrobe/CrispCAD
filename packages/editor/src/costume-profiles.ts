// SPDX-License-Identifier: BSD-3-Clause
import {EllipseCurve,LineCurve} from 'three';
import type {Path,Vector2} from 'three';
import {SVGLoader} from 'three/addons/loaders/SVGLoader.js';
import {evaluateSketchRegion,maxSketchRegionLoops,maxSketchOutlinePoints,newId,sketchOutline,sketchSegmentsIntersect,t} from '@brickwright/cad-core';
import type {SketchPoint,SketchProfile} from '@brickwright/cad-core';
import {localSvg} from './svg-icon.js';

export type CostumeRegion = {
 loops: CostumeLoop[];
 size: SketchPoint;
 origin: SketchPoint;
};
type CostumeLoop = {kind:'circle';center:SketchPoint;radius:number} | {kind:'outline';points:SketchPoint[]};
const tags = new Set(['svg','g','path','rect','circle','ellipse','polygon','polyline','line','defs','title','desc']);
const styles = new Set(['fill','fill-rule','fill-opacity','stroke','stroke-opacity','stroke-width','stroke-linejoin','stroke-linecap','stroke-miterlimit','opacity','display','visibility']);
const near = (a:Vector2,b:Vector2) => a.distanceTo(b) < 1e-7;
const point = ({x,y}:Vector2):SketchPoint => [x,-y];

function boundary(path:Path,requireExplicitClose:boolean):CostumeLoop {
 const [first]=path.curves;
 if(path.curves.length===1 && first instanceof EllipseCurve && first.xRadius>0 &&
    Math.abs(first.xRadius-first.yRadius)<=first.xRadius*1e-9 &&
    Math.abs(first.aEndAngle-first.aStartAngle)>=Math.PI*2-1e-8) {
  return {kind:'circle',center:[first.aX,-first.aY],radius:first.xRadius};
 }
 if(!first||!path.curves.every(curve=>curve instanceof LineCurve))
  throw new Error(t('Curves other than full circles are not supported yet.'));
 const curves=path.curves as LineCurve[];
 if(curves.length>maxSketchOutlinePoints)throw new Error(t('This outline has too many vertices.'));
 const last=curves.at(-1)!;
 if(requireExplicitClose&&!path.autoClose&&!near(curves[0].v1,last.v2))throw new Error(t('Close the path in Costumes before importing it.'));
 if(curves.some((curve,index)=>index>0&&!near(curves[index-1].v2,curve.v1)))throw new Error(t('The outline contains disconnected edges.'));
 const points=curves.map(curve=>point(curve.v1));
 if(!near(curves[0].v1,last.v2))points.push(point(last.v2));
 return {kind:'outline',points};
}

const displayPoints = (loop:CostumeLoop):SketchPoint[] => loop.kind==='outline'?loop.points:
 Array.from({length:64},(_,i)=>{
  const theta=Math.PI*2*i/64;
  return [loop.center[0]+Math.cos(theta)*loop.radius,loop.center[1]+Math.sin(theta)*loop.radius];
 });
const edges=(points:SketchPoint[])=>points.map((point,index)=>[point,points[(index+1)%points.length]] as const);
function region(loops:CostumeLoop[]):CostumeRegion {
 const points=loops.flatMap(displayPoints),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 const origin:SketchPoint=[Math.min(...xs),Math.min(...ys)];
 const size:SketchPoint=[Math.max(...xs)-origin[0],Math.max(...ys)-origin[1]];
 if(size.some(value=>!Number.isFinite(value)||value<=0))throw new Error(t('The artwork has no usable area.'));
 return {loops,size,origin};
}

export function costumeSketchProfile(source:CostumeRegion,width:number):SketchProfile {
 if(!Number.isFinite(width)||width<.01||width>100000)throw new Error(t('Enter a width from 0.01 to 100000 mm.'));
 const scale=width/source.size[0];
 const convert=([x,y]:SketchPoint):SketchPoint=>[(x-source.origin[0])*scale,(y-source.origin[1])*scale];
 const loops=source.loops.map(loop=>loop.kind==='outline'?
  {kind:'outline' as const,id:newId(),points:sketchOutline(loop.points.map(convert))}:
  {kind:'circle' as const,id:newId(),center:convert(loop.center),radius:loop.radius*scale,segments:64});
 if(loops.length>1){evaluateSketchRegion(loops);return {kind:'region',id:newId(),loops};}
 const [loop]=loops;
 if(loop.kind==='circle'&&(!Number.isFinite(loop.radius)||loop.radius<.01||loop.radius>100000))
  throw new Error(t('Circle radius must be between 0.01 and 100000 mm.'));
 return loop;
}

export function readCostumeProfiles(source:string){
 const xml=localSvg(source,tags);
 for(const node of xml.querySelectorAll('*')){
  if(node.hasAttribute('class')||node.hasAttribute('clip-path')||node.hasAttribute('mask')||node.hasAttribute('filter')||
     node.localName==='svg'&&node!==xml.documentElement)throw new Error(t('Remove styles, clipping, masks, or nested SVG before importing.'));
  const declarations=(node.getAttribute('style')||'').split(';').filter(part=>part.trim()).map(part=>part.split(':').map(value=>value.trim()));
  if(declarations.some(([name,value])=>!styles.has(name)||!value||value.includes('!important')))
   throw new Error(t('The SVG uses unsupported styling.'));
  const values=new Map(declarations.map(([name,value])=>[name,value]));
  const style=(name:string)=>values.get(name)??node.getAttribute(name);
  if(style('visibility')==='hidden'||style('display')==='none'||style('opacity')==='0'){
   if(node===xml.documentElement)return {profiles:[],issues:[],strokes:false};
   node.remove();
  }
 }
 const profiles:CostumeRegion[]=[],issues=new Set<string>();
 let strokes=false;
 const paths=new SVGLoader().parse(new XMLSerializer().serializeToString(xml)).paths;
 if(paths.length>100)throw new Error(t('This artwork contains too many paths.'));
 for(const path of paths){
  const style=path.userData?.style;
  if(style?.stroke&&style.stroke!=='none')strokes=true;
  if(style?.visibility==='hidden'||Number(style?.fillOpacity)===0||['none','transparent'].includes(style?.fill))continue;
  try {
   if(style?.fillRule&&!['evenodd','nonzero'].includes(style.fillRule))throw new Error(t('The SVG uses an unsupported fill rule.'));
   if(path.subPaths.length>maxSketchRegionLoops)throw new Error(t('A region supports up to 16 loops.'));
   const boundaries=path.subPaths.map(subpath=>boundary(subpath,true));
   const vertexCount=boundaries.reduce((count,loop)=>count+(loop.kind==='circle'?64:loop.points.length),0);
   if(vertexCount>1024)throw new Error(t('This outline has too many vertices.'));
   const outlineEdges=boundaries.map(loop=>edges(displayPoints(loop)));
   for(let i=0;i<boundaries.length;i++){
    costumeSketchProfile(region([boundaries[i]]),40);
    if(outlineEdges.slice(0,i).some(other=>other.some(([a,b])=>outlineEdges[i].some(([c,d])=>sketchSegmentsIntersect(a,b,c,d)))))
     throw new Error(t('Separate touching or crossing contours in Costumes before importing.'));
   }
   const shapes=SVGLoader.createShapes(path).map(shape=>region([boundary(shape,false),...shape.holes.map(hole=>boundary(hole,false))]));
   for(const shape of shapes)costumeSketchProfile(shape,40);
   profiles.push(...shapes);
  } catch(error) {issues.add(error instanceof Error?error.message:String(error));}
 }
 return {profiles,issues:[...issues],strokes};
}
