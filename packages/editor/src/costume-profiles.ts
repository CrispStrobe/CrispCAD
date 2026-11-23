// SPDX-License-Identifier: BSD-3-Clause
import {CubicBezierCurve,EllipseCurve,LineCurve,QuadraticBezierCurve} from 'three';
import type {Curve,Path,Vector2} from 'three';
import {SVGLoader} from 'three/addons/loaders/SVGLoader.js';
import {evaluateSketchRegion,isSketchPoint,maxSketchRegionLoops,maxSketchOutlinePoints,newId,sketchOutline,sketchSegmentsIntersect,t} from '@brickwright/cad-core';
import type {SketchPoint,SketchProfile} from '@brickwright/cad-core';
import {localSvg} from './svg-icon.js';
import {expandCostumeStroke} from './costume-stroke.js';
import type {CostumeStroke} from './costume-stroke.js';

export type CostumeRegion = {
 loops: CostumeLoop[];
 size: SketchPoint;
 origin: SketchPoint;
 approximated?: boolean;
 gapRepair?: {edges:ClosingEdge[];limitMm:number};
};
export type CostumePlacement = {anchor:'lower-left'|'center';position:SketchPoint};
type ClosingEdge = readonly [SketchPoint,SketchPoint];
type CostumeLoop = {kind:'circle';center:SketchPoint;radius:number} | {kind:'outline';points:SketchPoint[]};
const tags = new Set(['svg','g','path','rect','circle','ellipse','polygon','polyline','line','defs','title','desc']);
const styles = new Set(['fill','fill-rule','fill-opacity','stroke','stroke-opacity','stroke-width','stroke-linejoin','stroke-linecap','stroke-miterlimit','stroke-dasharray','vector-effect','opacity','display','visibility']);
const near = (a:Vector2,b:Vector2) => a.distanceTo(b) < 1e-7;
const point = ({x,y}:Vector2):SketchPoint => [x,-y];

type CostumeImportOptions = {widthMm:number;toleranceMm?:number;maxGapMm?:number;strokeOnly?:boolean};

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

function fullCircle(path:Path,curve:Curve<Vector2>):curve is EllipseCurve {
 return path.curves.length===1&&curve instanceof EllipseCurve&&curve.xRadius>0&&
  Math.abs(curve.xRadius-curve.yRadius)<=curve.xRadius*1e-9&&
  Math.abs(curve.aEndAngle-curve.aStartAngle)>=Math.PI*2-1e-8;
}

function samplePath(path:Path,options?:CostumeImportOptions,strokeWidth=0){
 const {curves}=path,first=curves[0],last=curves.at(-1);
 if(!first||!last)throw new Error(t('The artwork has no usable area.'));
 if(curves.length>maxSketchOutlinePoints)throw new Error(t('This outline has too many vertices.'));
 if(curves.some((curve,index)=>index>0&&!near(curves[index-1].getPoint(1),curve.getPoint(0))))
  throw new Error(t('The outline contains disconnected edges.'));
 const end=last.getPoint(1);
 const approximated=curves.some(curve=>!(curve instanceof LineCurve));
 if(approximated&&options?.toleranceMm===undefined)throw new Error(strokeWidth?t('Enable curve approximation to preview curved strokes.'):t('Enable curve approximation to preview filled curves.'));
 let tolerance=1;
 if(approximated&&options?.toleranceMm!==undefined){
  // These sample positions also occur in the final polygon. Their span is a
  // lower bound on the source width used when converting the result to mm.
  const xs=curves.flatMap(curve=>[0,.25,.5,.75,1].map(value=>curve.getPoint(value).x));
  tolerance=(Math.max(...xs)-Math.min(...xs)||strokeWidth)*options.toleranceMm/options.widthMm;
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
 return {vertices,approximated};
}

function boundary(path:Path,options?:CostumeImportOptions) {
 const curves=path.curves,[first]=curves,last=curves.at(-1);
 if(!first||!last)throw new Error(t('The artwork has no usable area.'));
 if(curves.length>maxSketchOutlinePoints)throw new Error(t('This outline has too many vertices.'));
 const start=first.getPoint(0),end=last.getPoint(1);
 const open=!path.autoClose&&!near(start,end);
 if(open&&options?.maxGapMm===undefined)throw new Error(t('Close the path in Costumes before importing it.'));
 if(fullCircle(path,first)) {
  const loop:CostumeLoop={kind:'circle',center:[first.aX,-first.aY],radius:first.xRadius};
  return {loop,area:first.xRadius**2*Math.PI*(first.aClockwise?1:-1),approximated:false};
 }
 const {vertices,approximated}=samplePath(path,options);
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

export function costumeProfileBounds(source:CostumeRegion,width:number,placement?:CostumePlacement):{min:SketchPoint;max:SketchPoint} {
 if(!Number.isFinite(width)||width<.01||width>100000)throw new Error(t('Enter a width from 0.01 to 100000 mm.'));
 const {anchor,position}=placement??{anchor:'lower-left',position:[0,0]};
 if(!isSketchPoint(position)||!['lower-left','center'].includes(anchor))
  throw new Error(t('Enter sketch coordinates from −100000 to 100000 mm.'));
 const height=width*(source.size[1]/source.size[0]);
 const min:SketchPoint=anchor==='center'?[position[0]-width/2,position[1]-height/2]:position;
 const max:SketchPoint=[min[0]+width,min[1]+height];
 if(!isSketchPoint(min)||!isSketchPoint(max))throw new Error(t('The placed profile extends beyond the sketch coordinate limits.'));
 return {min,max};
}

export function costumeSketchProfile(source:CostumeRegion,width:number,placement?:CostumePlacement):SketchProfile {
 const {min}=costumeProfileBounds(source,width,placement);
 const scale=width/source.size[0];
 const repair=source.gapRepair;
 if(repair?.edges.some(([[ax,ay],[bx,by]])=>Math.hypot(bx-ax,by-ay)*scale>repair.limitMm))
  throw new Error(t('This outline gap exceeds the maximum at the selected width.'));
 const convert=([x,y]:SketchPoint):SketchPoint=>[min[0]+(x-source.origin[0])/source.size[0]*width,
  min[1]+(y-source.origin[1])/source.size[0]*width];
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

function strokeScale(node:SVGGraphicsElement):number {
 let matrix=new DOMMatrix();
 for(let element:Element|null=node;element;element=element.parentElement){
  const current=element,inline=(current as SVGElement).style;
  const attribute=(name:string)=>inline?.getPropertyValue(name)||current.getAttribute(name);
  if(['stroke-dasharray','vector-effect'].some(name=>{
   const value=attribute(name);
   return value&&value!=='none';
  })||/[a-z%]/i.test((attribute('stroke-width')??'').replace(/(?:px|mm|cm|in|pt|pc)$/i,'').replace(/e[-+]?\d+$/i,'')))
   throw new Error(t('Use a solid stroke with an absolute width and normal scaling.'));
  if(element.hasAttribute('transform')){
   const transform=(element as SVGGraphicsElement).transform?.baseVal.consolidate();
   if(!transform)throw new Error(t('This stroke has an unsupported transform.'));
   matrix=new DOMMatrix([transform.matrix.a,transform.matrix.b,transform.matrix.c,transform.matrix.d,0,0]).multiply(matrix);
  }
 }
 const scale=Math.hypot(matrix.a,matrix.b),otherScale=Math.hypot(matrix.c,matrix.d);
 const dot=matrix.a*matrix.c+matrix.b*matrix.d;
 if(!Number.isFinite(scale)||scale<=0||Math.abs(scale-otherScale)>scale*1e-8||Math.abs(dot)>scale*otherScale*1e-8)
  throw new Error(t('Stroke expansion needs a uniform scale without shear.'));
 return scale;
}

function strokeRegion(path:Path,stroke:CostumeStroke,options:CostumeImportOptions):CostumeRegion{
 const first=path.curves[0],last=path.curves.at(-1);
 if(!first||!last)throw new Error(t('The artwork has no usable area.'));
 let result:CostumeRegion;
 if(fullCircle(path,first)){
  const center:SketchPoint=[first.aX,-first.aY],half=stroke.width/2;
  const loops:CostumeLoop[]=[{kind:'circle',center,radius:first.xRadius+half}];
  if(first.xRadius>half)loops.push({kind:'circle',center,radius:first.xRadius-half});
  result=region(loops);
 }else{
  const closed=path.autoClose||near(first.getPoint(0),last.getPoint(1));
  const {vertices,approximated}=samplePath(path,options,stroke.width);
  const contours=expandCostumeStroke(vertices,closed,stroke);
  result=region(contours.map(contour=>({kind:'outline',points:contour.map(point)})));
  if(approximated)result.approximated=true;
 }
 costumeSketchProfile(result,options.widthMm);
 return result;
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
 const recordIssue=(error:unknown)=>issues.add(error instanceof Error?error.message:String(error));
 let strokes=false;
 const paths=new SVGLoader().parse(new XMLSerializer().serializeToString(xml)).paths;
 if(paths.length>100)throw new Error(t('This artwork contains too many paths.'));
 for(const path of paths){
  const data=path.userData,style=data?.style;
  const visibleStroke=style?.stroke&&!['none','transparent'].includes(style.stroke)&&
   Number(style.strokeOpacity)>0&&Number(style.strokeWidth)>0;
  if(visibleStroke)strokes=true;
  if(style?.visibility==='hidden')continue;
  try {
   if(path.subPaths.length>maxSketchRegionLoops)throw new Error(t('A region supports up to 16 loops.'));
   if(options?.strokeOnly){
    if(!data||!visibleStroke)continue;
    const cap=style.strokeLineCap,join=style.strokeLineJoin,miterLimit=Number(style.strokeMiterLimit);
    if(!['butt','round','square'].includes(cap)||!['miter','round','bevel'].includes(join)||!Number.isFinite(miterLimit)||miterLimit<1)
     throw new Error(t('This stroke cap, join, or miter limit is unsupported.'));
    const width=Number(style.strokeWidth)*strokeScale(data.node);
    for(const subpath of path.subPaths){
     try{profiles.push(strokeRegion(subpath,{width,cap,join,miterLimit},options));}
     catch(error){recordIssue(error);}
    }
    continue;
   }
   if(Number(style?.fillOpacity)===0||['none','transparent'].includes(style?.fill))continue;
   if(style?.fillRule&&!['evenodd','nonzero'].includes(style.fillRule))throw new Error(t('The SVG uses an unsupported fill rule.'));
   const boundaries=path.subPaths.map(subpath=>boundary(subpath,options));
   profiles.push(...filledRegions(boundaries,style?.fillRule==='evenodd',options?.widthMm??40,options?.maxGapMm));
  } catch(error) {recordIssue(error);}
 }
 return {profiles,issues:[...issues],strokes};
}
