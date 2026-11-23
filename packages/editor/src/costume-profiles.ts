// SPDX-License-Identifier: BSD-3-Clause
import {CubicBezierCurve,EllipseCurve,LineCurve,QuadraticBezierCurve} from 'three';
import type {Curve,Path,Vector2} from 'three';
import {SVGLoader} from 'three/addons/loaders/SVGLoader.js';
import {artworkProfileKeyPattern,geometrySignature,evaluateSketchRegion,isSketchPoint,maxSketchRegionLoops,maxSketchOutlinePoints,newId,sketchOutline,sketchPath,sketchSegmentsIntersect,t} from '@brickwright/cad-core';
import type {ArtworkProfileLink,SketchPoint,SketchProfile} from '@brickwright/cad-core';
import {localSvg} from './svg-icon.js';
import {expandCostumeStroke} from './costume-stroke.js';
import type {CostumeStroke} from './costume-stroke.js';
import {costumeArcSweep,costumeCenterlinePreview,ellipseSweep} from './costume-centerline.js';

export type CostumeRegion = {
 loops: CostumeLoop[];
 size: SketchPoint;
 origin: SketchPoint;
 approximated?: boolean;
 centerline?: {points:SketchPoint[];bulges?:number[];d:string};
 gapRepair?: {edges:ClosingEdge[];limitMm:number};
 artworkProfile?: ArtworkProfileLink;
 ambiguousSourceKey?: boolean;
};
export type CostumePlacement = {anchor:'lower-left'|'center';position:SketchPoint};
type ClosingEdge = readonly [SketchPoint,SketchPoint];
type CostumeLoop = {kind:'circle';center:SketchPoint;radius:number} | {kind:'outline';points:SketchPoint[]};
const tags = new Set(['svg','g','path','rect','circle','ellipse','polygon','polyline','line','defs','title','desc']);
const styles = new Set(['fill','fill-rule','fill-opacity','stroke','stroke-opacity','stroke-width','stroke-linejoin','stroke-linecap','stroke-miterlimit','stroke-dasharray','vector-effect','opacity','display','visibility']);
const near = (a:Vector2,b:Vector2) => a.distanceTo(b) < 1e-7;
const point = ({x,y}:Vector2):SketchPoint => [x,-y];

type CostumeImportOptions = {widthMm:number;toleranceMm?:number;maxGapMm?:number;strokeOnly?:boolean;centerlineOnly?:boolean};

function secondDerivativeBound(curve:Curve<Vector2>):number {
 const secondDifference=(a:Vector2,b:Vector2,c:Vector2)=>a.clone().add(c).addScaledVector(b,-2).length();
 if(curve instanceof QuadraticBezierCurve)return 2*secondDifference(curve.v0,curve.v1,curve.v2);
 if(curve instanceof CubicBezierCurve)return 6*Math.max(
  secondDifference(curve.v0,curve.v1,curve.v2),secondDifference(curve.v1,curve.v2,curve.v3));
 if(curve instanceof EllipseCurve)return Math.max(curve.xRadius,curve.yRadius)*ellipseSweep(curve)**2;
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
function bounds(points:SketchPoint[]){
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 const origin:SketchPoint=[Math.min(...xs),Math.min(...ys)];
 const size:SketchPoint=[Math.max(...xs)-origin[0],Math.max(...ys)-origin[1]];
 return {origin,size};
}
function region(loops:CostumeLoop[]):CostumeRegion {
 const polygonBounds=bounds(loops.flatMap(displayPoints));
 if(polygonBounds.size.some(value=>!Number.isFinite(value)||value<=0))throw new Error(t('The artwork has no usable area.'));
 return {loops,...polygonBounds};
}

const scaleSpan=(source:CostumeRegion)=>source.centerline?Math.max(...source.size):source.size[0];

export function costumeProfileBounds(source:CostumeRegion,width:number,placement?:CostumePlacement):{min:SketchPoint;max:SketchPoint} {
 if(!Number.isFinite(width)||width<.01||width>100000)throw new Error(source.centerline?
  t('Enter a span from 0.01 to 100000 mm.'):t('Enter a width from 0.01 to 100000 mm.'));
 const {anchor,position}=placement??{anchor:'lower-left',position:[0,0]};
 if(!isSketchPoint(position)||!['lower-left','center'].includes(anchor))
  throw new Error(t('Enter sketch coordinates from −100000 to 100000 mm.'));
 const span=scaleSpan(source);
 const [scaledWidth,height]=source.size.map(value=>value/span*width);
 const min:SketchPoint=anchor==='center'?[position[0]-scaledWidth/2,position[1]-height/2]:position;
 const max:SketchPoint=[min[0]+scaledWidth,min[1]+height];
 if(!isSketchPoint(min)||!isSketchPoint(max))throw new Error(t('The placed profile extends beyond the sketch coordinate limits.'));
 return {min,max};
}

export function costumeSketchProfile(source:CostumeRegion,width:number,placement?:CostumePlacement):SketchProfile {
 const {min}=costumeProfileBounds(source,width,placement);
 const span=scaleSpan(source),scale=width/span;
 const repair=source.gapRepair;
 if(repair?.edges.some(([[ax,ay],[bx,by]])=>Math.hypot(bx-ax,by-ay)*scale>repair.limitMm))
  throw new Error(t('This outline gap exceeds the maximum at the selected width.'));
 const convert=([x,y]:SketchPoint):SketchPoint=>[min[0]+(x-source.origin[0])/span*width,
  min[1]+(y-source.origin[1])/span*width];
 if(source.centerline){
  const points=source.centerline.points.map(convert),bulges=source.centerline.bulges;
  sketchPath(points,bulges);
  return {kind:'path',id:newId(),points,...(bulges?{bulges:[...bulges]}:{})};
 }
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

const isOpenPath=(path:Path)=>{
 const first=path.curves[0],last=path.curves.at(-1);
 return Boolean(first&&last&&!path.autoClose&&!near(first.getPoint(0),last.getPoint(1)));
};

function centerlineRegion(path:Path,options:CostumeImportOptions,fromPrecisionArc:boolean):CostumeRegion{
 const {curves}=path;
 if(curves.length>=maxSketchOutlinePoints)throw new Error(t('This outline has too many vertices.'));
 if(curves.some((curve,index)=>index>0&&!near(curves[index-1].getPoint(1),curve.getPoint(0))))
  throw new Error(t('The outline contains disconnected edges.'));
 const sweeps=curves.map(curve=>costumeArcSweep(curve,fromPrecisionArc));
 const needsApproximation=curves.some((curve,index)=>!(curve instanceof LineCurve)&&sweeps[index]===undefined);
 if(needsApproximation&&options.toleranceMm===undefined)
  throw new Error(t('Enable curve approximation to preview Bézier and elliptical centerlines.'));
 const sampleBounds=bounds(curves.flatMap(curve=>[0,.25,.5,.75,1].map(fraction=>point(curve.getPoint(fraction)))));
 const tolerance=Math.max(...sampleBounds.size)*(options.toleranceMm??1)/options.widthMm;
 const points:SketchPoint[]=[],bulges:number[]=[];
 for(const [index,curve] of curves.entries()){
  const sweep=sweeps[index];
  const steps=sweep===undefined?costumeCurveSteps(curve,tolerance):Math.ceil(Math.abs(sweep)/Math.PI);
  if(points.length+steps>=maxSketchOutlinePoints)throw new Error(t('Increase the curve tolerance to stay within 256 vertices per outline.'));
  for(let i=0;i<steps;i++){
   points.push(point(curve.getPoint(i/steps)));
   bulges.push(sweep===undefined?0:Math.tan(-sweep/(4*steps)));
  }
 }
 points.push(point(curves.at(-1)!.getPoint(1)));bulges.push(0);
 const authoredBulges=bulges.some(value=>value!==0)?bulges:undefined;
 const {extrema,d}=costumeCenterlinePreview(points,authoredBulges);
 const profileBounds=bounds(extrema);
 if(!Number.isFinite(Math.max(...profileBounds.size))||Math.max(...profileBounds.size)<=0)
  throw new Error(t('The artwork has no usable area.'));
 const result:CostumeRegion={...profileBounds,loops:[],approximated:needsApproximation,centerline:{points,bulges:authoredBulges,d}};
 costumeSketchProfile(result,options.widthMm);
 return result;
}

function paperData(node:Element){
 const data=node.getAttribute('data-paper-data');
 if(!data)return undefined;
 try{return JSON.parse(data);}catch{return undefined;}
}

function profileSourceKey(node:Element):string|undefined {
 const precisionId=paperData(node)?.bwPrecisionShapeId;
 if(typeof precisionId==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(precisionId))
  return `paper:${precisionId}`;
 const id=node.getAttribute('id');
 const key=id&&`svg:${id}`;
 return key&&artworkProfileKeyPattern.test(key)?key:undefined;
}

/** Prefer the source identity. An absent or duplicated key needs an explicit choice. */
export function matchCostumeProfile(profiles:readonly CostumeRegion[],saved:ArtworkProfileLink):number|undefined {
 const matches=profiles.flatMap((profile,index)=>{
  const candidate=profile.artworkProfile;
  if(!candidate||candidate.mode!==saved.mode)return [];
  const matched=saved.sourceKey?candidate.sourceKey===saved.sourceKey:candidate.signature===saved.signature;
  return matched?[index]:[];
 });
 if(matches.length!==1)return undefined;
 const index=matches[0];
 return saved.sourceKey&&profiles[index].ambiguousSourceKey?undefined:index;
}

export function readCostumeProfiles(source:string,options?:CostumeImportOptions){
 if(options&&(!Number.isFinite(options.widthMm)||options.widthMm<.01||options.widthMm>100000))
  throw new Error(options.centerlineOnly?t('Enter a span from 0.01 to 100000 mm.'):t('Enter a width from 0.01 to 100000 mm.'));
 const invalidTolerance=(value:number|undefined)=>value!==undefined&&(!Number.isFinite(value)||value<.01||value>10);
 if(invalidTolerance(options?.toleranceMm))throw new Error(t('Enter a curve tolerance from 0.01 to 10 mm.'));
 if(invalidTolerance(options?.maxGapMm))throw new Error(t('Enter a maximum gap from 0.01 to 10 mm.'));
 const xml=localSvg(source,tags);
 for(const node of xml.querySelectorAll('*')){
  if(node.hasAttribute('class')||node.hasAttribute('clip-path')||node.hasAttribute('mask')||node.hasAttribute('filter')||
     node.localName==='svg'&&node!==xml.documentElement)throw new Error(t('Remove styles, clipping, masks, or nested SVG before importing.'));
  const declarations=(node.getAttribute('style')||'').split(';').filter(part=>part.trim()).map(part=>part.split(':').map(value=>value.trim()));
  // Paper exports this neutral blend mode on its painting layer.
  if(declarations.some(([name,value])=>name==='mix-blend-mode'?value!=='normal':
     !styles.has(name)||!value||value.includes('!important')))
   throw new Error(t('The SVG uses unsupported styling.'));
  const values=new Map(declarations.map(([name,value])=>[name,value]));
  const style=(name:string)=>values.get(name)??node.getAttribute(name);
  if(style('visibility')==='hidden'||style('display')==='none'||style('opacity')==='0'){
   if(node===xml.documentElement)return {profiles:[],issues:[],strokes:false,centerlines:false};
   node.remove();
  }
 }
 const profiles:CostumeRegion[]=[],issues=new Set<string>();
 const recordIssue=(error:unknown)=>issues.add(error instanceof Error?error.message:String(error));
 let strokes=false,centerlines=false;
 const paths=new SVGLoader().parse(new XMLSerializer().serializeToString(xml)).paths;
 if(paths.length>100)throw new Error(t('This artwork contains too many paths.'));
 const mode=options?.centerlineOnly?'centerline':options?.strokeOnly?'stroke':'fill';
 const keys=paths.map(path=>path.userData?.node&&profileSourceKey(path.userData.node));
 const keyCounts=new Map<string,number>();
 for(const key of keys)if(key)keyCounts.set(key,(keyCounts.get(key)??0)+1);
 for(const [pathIndex,path] of paths.entries()){
  const sourceKey=path.subPaths.length===1?keys[pathIndex]:undefined;
  const collect=(profile:CostumeRegion)=>{
   const centerline=profile.centerline;
   const coordinates=centerline?[centerline.points,centerline.bulges]:profile.loops;
   const signature=geometrySignature(JSON.stringify(coordinates,(_key,value)=>
    typeof value==='number'?Number(value.toPrecision(12)):value));
   profile.artworkProfile={mode,signature,...(sourceKey?{sourceKey}:{}),
    ...(options?.toleranceMm===undefined?{}:{toleranceMm:options.toleranceMm}),
    ...(mode!=='fill'||options?.maxGapMm===undefined?{}:{maxGapMm:options.maxGapMm})};
   if(sourceKey&&(keyCounts.get(sourceKey)??0)>1)profile.ambiguousSourceKey=true;
   profiles.push(profile);
  };
  const data=path.userData,style=data?.style;
  const visibleStroke=style?.stroke&&!['none','transparent'].includes(style.stroke)&&
   Number(style.strokeOpacity)>0&&Number(style.strokeWidth)>0;
  if(style?.visibility==='hidden')continue;
  if(visibleStroke)strokes=true;
  const visibleFill=Number(style?.fillOpacity)!==0&&!['none','transparent'].includes(style?.fill);
  const openPaths=(visibleStroke||visibleFill)?path.subPaths.filter(isOpenPath):[];
  if(openPaths.length)centerlines=true;
  try {
   if(path.subPaths.length>maxSketchRegionLoops)throw new Error(t('A region supports up to 16 loops.'));
   if(options?.centerlineOnly){
    if(!data||!openPaths.length)continue;
    const authoredArc=paperData(data.node)?.bwPrecisionArc===true;
    for(const subpath of openPaths){
     try{collect(centerlineRegion(subpath,options,authoredArc));}catch(error){recordIssue(error);}
    }
    continue;
   }
   if(options?.strokeOnly){
    if(!data||!visibleStroke)continue;
    const cap=style.strokeLineCap,join=style.strokeLineJoin,miterLimit=Number(style.strokeMiterLimit);
    if(!['butt','round','square'].includes(cap)||!['miter','round','bevel'].includes(join)||!Number.isFinite(miterLimit)||miterLimit<1)
     throw new Error(t('This stroke cap, join, or miter limit is unsupported.'));
    const width=Number(style.strokeWidth)*strokeScale(data.node);
    for(const subpath of path.subPaths){
     try{collect(strokeRegion(subpath,{width,cap,join,miterLimit},options));}
     catch(error){recordIssue(error);}
    }
    continue;
   }
   if(!visibleFill)continue;
   if(style?.fillRule&&!['evenodd','nonzero'].includes(style.fillRule))throw new Error(t('The SVG uses an unsupported fill rule.'));
   const boundaries=path.subPaths.map(subpath=>boundary(subpath,options));
   filledRegions(boundaries,style?.fillRule==='evenodd',options?.widthMm??40,options?.maxGapMm).forEach(collect);
  } catch(error) {recordIssue(error);}
 }
 return {profiles,issues:[...issues],strokes,centerlines};
}
