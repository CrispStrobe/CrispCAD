// SPDX-License-Identifier: BSD-3-Clause
import {CubicBezierCurve,EllipseCurve,LineCurve,QuadraticBezierCurve} from 'three';
import type {Curve,Path,Vector2} from 'three';
import {SVGLoader} from 'three/addons/loaders/SVGLoader.js';
import {evaluateSketchRegion,maxSketchRegionLoops,maxSketchOutlinePoints,newId,sketchOutline,sketchSegmentsIntersect,t} from '@brickwright/cad-core';
import type {SketchPoint,SketchProfile} from '@brickwright/cad-core';
import {localSvg} from './svg-icon.js';

export type CostumeRegion = {
 loops: CostumeLoop[];
 size: SketchPoint;
 origin: SketchPoint;
 approximated?: boolean;
 gapRepair?: {edges:ClosingEdge[];limitMm:number};
};
type ClosingEdge = readonly [SketchPoint,SketchPoint];
type CostumeLoop = {kind:'circle';center:SketchPoint;radius:number} | {kind:'outline';points:SketchPoint[]};
const tags = new Set(['svg','g','path','rect','circle','ellipse','polygon','polyline','line','defs','title','desc']);
const styles = new Set(['fill','fill-rule','fill-opacity','stroke','stroke-opacity','stroke-width','stroke-linejoin','stroke-linecap','stroke-miterlimit','opacity','display','visibility']);
const near = (a:Vector2,b:Vector2) => a.distanceTo(b) < 1e-7;
const point = ({x,y}:Vector2):SketchPoint => [x,-y];

type CostumeImportOptions = {widthMm:number;toleranceMm?:number;maxGapMm?:number};

function secondDerivativeBound(curve:Curve<Vector2>):number {
 const secondDifference=(a:Vector2,b:Vector2,c:Vector2)=>a.clone().add(c).addScaledVector(b,-2).length();
 if(curve instanceof QuadraticBezierCurve)return 2*secondDifference(curve.v0,curve.v1,curve.v2);
 if(curve instanceof CubicBezierCurve)return 6*Math.max(
  secondDifference(curve.v0,curve.v1,curve.v2),secondDifference(curve.v1,curve.v2,curve.v3));
 if(curve instanceof EllipseCurve){
  const turn=2*Math.PI,delta=curve.aEndAngle-curve.aStartAngle;
  if(Math.abs(delta)<Number.EPSILON)return 0;
  const forward=((delta%turn)+turn)%turn;
  const sweep=forward<Number.EPSILON?turn:curve.aClockwise?turn-forward:forward;
  return Math.max(curve.xRadius,curve.yRadius)*sweep**2;
 }
 throw new Error(t('This SVG curve cannot be approximated.'));
}

export function costumeCurveSteps(curve:Curve<Vector2>,tolerance:number):number {
 if(curve instanceof LineCurve)return 1;
 // Linear interpolation error is bounded by max |p''| times step² / 8.
 const steps=4*Math.max(1,Math.ceil(Math.sqrt(secondDerivativeBound(curve)/(8*tolerance))/4));
 if(!Number.isFinite(steps)||steps>maxSketchOutlinePoints)
  throw new Error(t('Increase the curve tolerance to stay within 256 vertices per outline.'));
 return steps;
}

function boundary(path:Path,options?:CostumeImportOptions) {
 const curves=path.curves,[first]=curves,last=curves.at(-1);
 if(!first||!last)throw new Error(t('The artwork has no usable area.'));
 if(curves.length>maxSketchOutlinePoints)throw new Error(t('This outline has too many vertices.'));
 const start=first.getPoint(0),end=last.getPoint(1);
 const open=!path.autoClose&&!near(start,end);
 if(open&&options?.maxGapMm===undefined)throw new Error(t('Close the path in Costumes before importing it.'));
 if(curves.some((curve,index)=>index>0&&!near(curves[index-1].getPoint(1),curve.getPoint(0))))
  throw new Error(t('The outline contains disconnected edges.'));
 if(curves.length===1 && first instanceof EllipseCurve && first.xRadius>0 &&
    Math.abs(first.xRadius-first.yRadius)<=first.xRadius*1e-9 &&
    Math.abs(first.aEndAngle-first.aStartAngle)>=Math.PI*2-1e-8) {
  const loop:CostumeLoop={kind:'circle',center:[first.aX,-first.aY],radius:first.xRadius};
  return {loop,area:first.xRadius**2*Math.PI*(first.aClockwise?1:-1),approximated:false};
 }
 const approximated=curves.some(curve=>!(curve instanceof LineCurve));
 if(approximated&&options?.toleranceMm===undefined)throw new Error(t('Enable curve approximation to preview filled curves.'));
 let tolerance=1;
 if(approximated&&options?.toleranceMm!==undefined){
  // These sample positions also occur in the final polygon. Their span is a
  // lower bound on the source width used when converting the result to mm.
  const xs=curves.flatMap(curve=>[0,.25,.5,.75,1].map(value=>curve.getPoint(value).x));
  tolerance=(Math.max(...xs)-Math.min(...xs))*options.toleranceMm/options.widthMm;
 }
 const vertices:Vector2[]=[];
 for(const curve of curves){
  const steps=costumeCurveSteps(curve,tolerance);
  if(vertices.length+steps>maxSketchOutlinePoints)
   throw new Error(t('Increase the curve tolerance to stay within 256 vertices per outline.'));
  for(let i=0;i<steps;i++)vertices.push(curve.getPoint(i/steps));
 }
 if(!near(vertices[0],end))vertices.push(end);
 if(vertices.length>maxSketchOutlinePoints)throw new Error(t('This outline has too many vertices.'));
 const points=vertices.map(point),[x,y]=points[0];
 const area=edges(points).reduce((sum,[[ax,ay],[bx,by]])=>sum+(ax-x)*(by-y)-(ay-y)*(bx-x),0)/2;
 const loop:CostumeLoop={kind:'outline',points};
 return {loop,area,approximated,closingEdge:open?[point(end),point(start)] as const:undefined};
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
 const repair=source.gapRepair;
 if(repair?.edges.some(([[ax,ay],[bx,by]])=>Math.hypot(bx-ax,by-ay)*scale>repair.limitMm))
  throw new Error(t('This outline gap exceeds the maximum at the selected width.'));
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

function containsPoint(points:SketchPoint[],[x,y]:SketchPoint):boolean {
 let inside=false;
 for(const [[ax,ay],[bx,by]] of edges(points)){
  if((ay>y)!==(by>y)&&x<ax+(bx-ax)*(y-ay)/(by-ay))inside=!inside;
 }
 return inside;
}

function filledRegions(boundaries:ReturnType<typeof boundary>[],evenOdd:boolean,width:number,maxGapMm?:number):CostumeRegion[] {
 const contours=boundaries.map((contour,index)=>({...contour,index,points:displayPoints(contour.loop)}))
  .sort((a,b)=>Math.abs(b.area)-Math.abs(a.area));
 if(contours.reduce((count,contour)=>count+contour.points.length,0)>1024)
  throw new Error(t('This outline has too many vertices.'));
 type Region = (typeof contours)[number][];
 const parents:{points:SketchPoint[];winding:number;region?:Region}[]=[];
 const regions:Region[]=[];
 for(const contour of contours){
  costumeSketchProfile(region([contour.loop]),width);
  const contourEdges=edges(contour.points);
  if(parents.some(other=>edges(other.points).some(([a,b])=>contourEdges.some(([c,d])=>sketchSegmentsIntersect(a,b,c,d)))))
   throw new Error(t('Separate touching or crossing contours in Costumes before importing.'));
  const parent=parents.find(other=>containsPoint(other.points,contour.points[0]));
  const before=parent?.winding??0;
  const winding=evenOdd?1-before:before+Math.sign(contour.area);
  let target=parent?.region;
  if(!before&&winding){target=[contour];regions.push(target);}
  if(before&&!winding){target?.push(contour);target=undefined;}
  parents.unshift({points:contour.points,winding,region:target});
 }
 return regions.sort((a,b)=>a[0].index-b[0].index).map(contours=>{
  const result=region(contours.map(contour=>contour.loop));
  const gaps=contours.flatMap(contour=>contour.closingEdge?[contour.closingEdge]:[]);
  if(gaps.length&&maxGapMm!==undefined)result.gapRepair={edges:gaps,limitMm:maxGapMm};
  costumeSketchProfile(result,width);
  return {...result,approximated:contours.some(contour=>contour.approximated)};
 });
}

export function readCostumeProfiles(source:string,options?:CostumeImportOptions){
 if(options&&(!Number.isFinite(options.widthMm)||options.widthMm<.01||options.widthMm>100000))
  throw new Error(t('Enter a width from 0.01 to 100000 mm.'));
 const invalidTolerance=(value:number|undefined)=>value!==undefined&&(!Number.isFinite(value)||value<.01||value>10);
 if(invalidTolerance(options?.toleranceMm))throw new Error(t('Enter a curve tolerance from 0.01 to 10 mm.'));
 if(invalidTolerance(options?.maxGapMm))throw new Error(t('Enter a maximum gap from 0.01 to 10 mm.'));
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
   const boundaries=path.subPaths.map(subpath=>boundary(subpath,options));
   profiles.push(...filledRegions(boundaries,style?.fillRule==='evenodd',options?.widthMm??40,options?.maxGapMm));
  } catch(error) {issues.add(error instanceof Error?error.message:String(error));}
 }
 return {profiles,issues:[...issues],strokes};
}
