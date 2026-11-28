// SPDX-License-Identifier: BSD-3-Clause
// Datums and geometric tolerances on exact assembly sheets (document version 52).
//
// A datum feature symbol (ISO 5459: the letter in a square frame, a leader and the datum triangle
// on the feature) or a feature control frame (ISO 1101: characteristic, tolerance with an optional
// Ø zone and material condition modifier, then up to three datum letters) is attached to an exact
// face or edge by its stable name (exact-edge-references.ts): `<node>:f<k>` for a face, `faceA+faceB`
// for the edge they share. Every drawing resolves the name on the exact B-rep of the model as it is
// now; the leader ends on the projected boundary of that face (or on that edge) in the sheet's view,
// at the point nearest to where the symbol sits. A name that no longer resolves (the face is gone,
// the two faces no longer meet, or meet at another number of edges) is drawn crossed out with the
// reason, and the sheet cannot be exported until it is repaired or removed: it is never attached to
// another face or edge.
import {edgeReferences,formatEdgeReference,isExactFaceName,parseEdgeReference,resolveEdgeReferences,splitExactFaceName,t} from '@brickwright/cad-core';
import type {CadDocument,DrawingDatum,DrawingInputs,DrawingToleranceFrame,EdgeNamingTopology,SketchPoint} from '@brickwright/cad-core';
import {dimensionText} from './drawing-annotation.js';
import {drawingViews} from './drawing-page.js';
import type {DrawingGdtPick,DrawingLayout,DrawingPath,DrawingText} from './drawing-page.js';
import {gdtSymbol,helveticaWidth,modifierCircle} from './drawing-symbols.js';
import type {ExactAssemblyProjection,ExactNamedTopology} from './exact-drawing-projection.js';

type Polyline=(readonly number[])[];
export type GdtResolution={body:string;polylines:Polyline[]}|{reason:'missing'|'count'|'mesh';found?:number};

const naming=new WeakMap<ExactNamedTopology,EdgeNamingTopology>();
function namingTopology(body:ExactNamedTopology):EdgeNamingTopology{
 let value=naming.get(body);
 if(!value){
  value={faces:body.faces.map(face=>({name:face.name})),edges:body.edges.map(edge=>({faces:edge.faces,points:points(edge.points)}))};
  naming.set(body,value);
 }
 return value;
}
const points=(flat:readonly number[]):Polyline=>{const out:number[][]=[];for(let i=0;i+2<flat.length;i+=3)out.push([flat[i],flat[i+1],flat[i+2]]);return out;};

/** The face or edge a target names, on the exact topology of the drawn bodies, or why it has none. */
export function resolveGdtTarget(topology:readonly ExactNamedTopology[],target:string):GdtResolution{
 if(isExactFaceName(target)){
  for(const body of topology){
   const faces=new Set(body.faces.flatMap((face,i)=>face.name===target?[i]:[]));
   if(!faces.size)continue;
   return {body:body.id,polylines:body.edges.filter(edge=>edge.faces.some(face=>faces.has(face))).map(edge=>points(edge.points))};
  }
  return {reason:'missing'};
 }
 const reference=parseEdgeReference(target);
 for(const body of topology){
  const names=new Set(body.faces.map(face=>face.name));
  if(!reference.faces.every(face=>names.has(face)))continue;
  try{
   const [index]=resolveEdgeReferences(namingTopology(body),[reference]);
   return {body:body.id,polylines:[points(body.edges[index].points)]};
  }catch(error){
   const stale=(error as {stale?:{reason:'missing'|'count';found:number}[]}).stale?.[0];
   return stale?{reason:stale.reason,found:stale.found}:{reason:'missing'};
  }
 }
 return {reason:'missing'};
}

/** "Plate face 3" (with pattern copies), or "Plate face 3 / Plate face 5" for an edge. */
export function describeGdtTarget(doc:CadDocument,target:string):string{
 const face=(name:string)=>{
  try{
   const {copies,node,face}=splitExactFaceName(name);
   const label=t`${doc.nodes[node]?.name??node} face ${face+1}`;
   return copies.length?label+' ('+copies.map(({pattern,copy})=>t`copy ${copy+1} of ${doc.nodes[pattern]?.name??pattern}`).join(', ')+')':label;
  }catch{return name;}
 };
 if(isExactFaceName(target))return face(target);
 try{const reference=parseEdgeReference(target);return t`edge of ${face(reference.faces[0])} and ${face(reference.faces[1])}`+(reference.of?` (${(reference.index??0)+1}/${reference.of})`:'');}
 catch{return target;}
}

const paperPoint=(pick:DrawingGdtPick,view:number,p:readonly number[]):SketchPoint=>{
 const {horizontal,vertical}=drawingViews[view],{left,bottom}=pick.views[view];
 return [left+(p[horizontal]-pick.origin[horizontal])*pick.factor,bottom+(p[vertical]-pick.origin[vertical])*pick.factor];
};
function nearestOn(lines:SketchPoint[][],point:SketchPoint):{point:SketchPoint;distance:number}{
 let best:SketchPoint=lines[0]?.[0]??point,distance=Infinity;
 for(const line of lines)for(let i=0;i<line.length;i++){
  const a=line[i],b=line[Math.min(i+1,line.length-1)],dx=b[0]-a[0],dy=b[1]-a[1],span=dx*dx+dy*dy;
  const s=span?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/span)):0;
  const q:SketchPoint=[a[0]+s*dx,a[1]+s*dy],d=Math.hypot(point[0]-q[0],point[1]-q[1]);
  if(d<distance){distance=d;best=q;}
 }
 return {point:best,distance};
}

export type GdtCandidate={target:string;label:string;view:0|1|2;distance:number;lines:SketchPoint[][]};
/**
 * Faces and edges whose drawn outline passes within `tolerance` (paper mm) of `point`, nearest first.
 * At equal distance a face seen edge-on (a plane seen as a line, a hole seen as its circle) comes
 * first, then an edge, then a face seen at an angle or face-on.
 */
export function gdtCandidates(page:DrawingLayout,doc:CadDocument,point:SketchPoint,tolerance=3):GdtCandidate[]{
 const pick=page.gdt;
 if(!pick)return [];
 const found:(GdtCandidate&{rank:number})[]=[];
 for(const body of pick.topology){
  const references=edgeReferences(namingTopology(body));
  for(const view of [0,1,2] as const){
   const depth=drawingViews[view].depth;
   const projected=body.edges.map(edge=>points(edge.points).map(p=>paperPoint(pick,view,p)));
   const faces=new Map<string,{lines:SketchPoint[][];edgeOn:boolean}>();
   body.edges.forEach((edge,i)=>{for(const face of edge.faces){
    const name=body.faces[face]?.name;
    if(!name)continue;
    const entry=faces.get(name)??{lines:[],edgeOn:Math.abs(body.faces[face].normal[depth])<1e-6};
    entry.lines.push(projected[i]);faces.set(name,entry);
   }});
   for(const [name,{lines,edgeOn}] of faces){
    const {distance}=nearestOn(lines,point);
    if(distance<=tolerance)found.push({target:name,label:describeGdtTarget(doc,name),view,distance,lines,rank:edgeOn?0:2});
   }
   references.forEach((result,i)=>{
    if(!result.reference)return;
    const {distance}=nearestOn([projected[i]],point);
    if(distance>tolerance)return;
    const target=formatEdgeReference(result.reference);
    found.push({target,label:describeGdtTarget(doc,target),view,distance,lines:[projected[i]],rank:1});
   });
  }
 }
 found.sort((a,b)=>Math.round(a.distance*20)-Math.round(b.distance*20)||a.rank-b.rank||a.distance-b.distance);
 const seen=new Set<string>();
 return found.filter(item=>{const key=item.target;if(seen.has(key))return false;seen.add(key);return true;}).map(({rank:_rank,...item})=>item);
}

/** Paper lines of a target in a view (for highlighting it), or none when it does not resolve. */
export function gdtTargetLines(page:DrawingLayout,target:string,view:number):SketchPoint[][]{
 const pick=page.gdt;
 if(!pick)return [];
 const resolved=resolveGdtTarget(pick.topology,target);
 return 'polylines' in resolved?resolved.polylines.map(line=>line.map(p=>paperPoint(pick,view,p))):[];
}

const DATUM=5,DATUM_TEXT=3.5,FRAME=5,FRAME_TEXT=2.5;

/** The cells of a feature control frame: widths, and its overall width. */
export function toleranceFrameCells(frame:Pick<DrawingToleranceFrame,'tolerance'|'diameter'|'modifier'|'datums'>){
 const value=(frame.diameter?'Ø':'')+dimensionText(frame.tolerance);
 const tolerance=1.6+helveticaWidth(value,FRAME_TEXT)+(frame.modifier?.4+FRAME*.64:0);
 const cells=[FRAME+1,tolerance,...(frame.datums??[]).map(()=>FRAME)];
 return {value,cells,width:cells.reduce((a,b)=>a+b,0)};
}

type Drawn={paths:DrawingPath[];texts:DrawingText[]};
function drawDatum(datum:Pick<DrawingDatum,'letter'|'at'>,anchor:SketchPoint|undefined,out:Drawn){
 const [cx,cy]=datum.at,h=DATUM/2;
 out.paths.push({stroke:'annotation',closed:true,points:[[cx-h,cy-h],[cx+h,cy-h],[cx+h,cy+h],[cx-h,cy+h]]});
 out.texts.push({x:cx-helveticaWidth(datum.letter,DATUM_TEXT)/2,y:cy-DATUM_TEXT*.36,size:DATUM_TEXT,text:datum.letter});
 if(!anchor)return;
 const dx=cx-anchor[0],dy=cy-anchor[1],l=Math.hypot(dx,dy);
 if(l<1e-9)return;
 const ux=dx/l,uy=dy/l,apex:SketchPoint=[anchor[0]+ux*2.6,anchor[1]+uy*2.6];
 // The datum triangle stands on the feature, its apex towards the frame (ISO 5459: filled or open).
 out.paths.push({stroke:'annotation',closed:true,points:[[anchor[0]-uy*1.5,anchor[1]+ux*1.5],apex,[anchor[0]+uy*1.5,anchor[1]-ux*1.5]]});
 // The leader from the apex to the frame's border.
 const scale=h/Math.max(Math.abs(ux),Math.abs(uy)),border:SketchPoint=[cx-ux*scale,cy-uy*scale];
 if((border[0]-apex[0])*ux+(border[1]-apex[1])*uy>0)out.paths.push({stroke:'annotation',points:[apex,border]});
}
function drawFrame(frame:Pick<DrawingToleranceFrame,'characteristic'|'tolerance'|'diameter'|'modifier'|'datums'|'at'>,anchor:SketchPoint|undefined,out:Drawn){
 const {value,cells,width}=toleranceFrameCells(frame),[x0,yc]=frame.at,y0=yc-FRAME/2,y1=yc+FRAME/2;
 out.paths.push({stroke:'annotation',closed:true,points:[[x0,y0],[x0+width,y0],[x0+width,y1],[x0,y1]]});
 let x=x0;
 for(const [i,w] of cells.entries()){
  if(i)out.paths.push({stroke:'annotation',points:[[x,y0],[x,y1]]});
  if(i===0)for(const points of gdtSymbol(frame.characteristic,x+w/2,yc,FRAME))out.paths.push({stroke:'annotation',points});
  else if(i===1){
   out.texts.push({x:x+.8,y:yc-FRAME_TEXT*.36,size:FRAME_TEXT,text:value});
   if(frame.modifier){
    const mx=x+.8+helveticaWidth(value,FRAME_TEXT)+.4+FRAME*.32;
    out.paths.push({stroke:'annotation',points:modifierCircle(mx,yc,FRAME)});
    const size=FRAME_TEXT*.8;
    out.texts.push({x:mx-helveticaWidth(frame.modifier,size)/2,y:yc-size*.36,size,text:frame.modifier});
   }
  }else{
   const letter=frame.datums![i-2];
   out.texts.push({x:x+w/2-helveticaWidth(letter,FRAME_TEXT)/2,y:yc-FRAME_TEXT*.36,size:FRAME_TEXT,text:letter});
  }
  x+=w;
 }
 if(!anchor)return;
 // The leader leaves the nearer end of the frame and ends on the feature with an arrowhead.
 const start:SketchPoint=anchor[0]<x0+width/2?[x0,yc]:[x0+width,yc];
 const back=Math.atan2(start[1]-anchor[1],start[0]-anchor[0]);
 out.paths.push({stroke:'annotation',points:[start,anchor]});
 out.paths.push({stroke:'annotation',closed:true,points:[anchor,[anchor[0]+2.2*Math.cos(back-.3),anchor[1]+2.2*Math.sin(back-.3)],[anchor[0]+2.2*Math.cos(back+.3),anchor[1]+2.2*Math.sin(back+.3)]]});
}
/** Where a datum or frame is drawn (its frame), for the error cross. */
function extent(item:DrawingDatum|DrawingToleranceFrame){
 if('letter' in item)return {l:item.at[0]-DATUM/2,b:item.at[1]-DATUM/2,r:item.at[0]+DATUM/2,t:item.at[1]+DATUM/2};
 return {l:item.at[0],b:item.at[1]-FRAME/2,r:item.at[0]+toleranceFrameCells(item).width,t:item.at[1]+FRAME/2};
}

/** Which mesh-drawn body (if any) holds a node, for the reason of a missing face. */
function meshBodyOf(doc:CadDocument,projection:ExactAssemblyProjection,node:string){
 for(const body of projection.exact.meshBodies){
  const stack=[body.id],seen=new Set<string>();
  while(stack.length){
   const id=stack.pop()!;
   if(seen.has(id)||!doc.nodes[id])continue;
   if(id===node)return body.name;
   seen.add(id);
   const n=doc.nodes[id] as {inputs?:string[];source?:string};
   if(Array.isArray(n.inputs))stack.push(...n.inputs);
   if(typeof n.source==='string')stack.push(n.source);
  }
 }
 return undefined;
}

/**
 * Draw the sheet's datums and tolerance frames, and keep the exact topology on the page for picking.
 * Unresolved references are crossed out, explained and listed in `page.annotationIssues`.
 */
export function addDrawingGdt(page:DrawingLayout,doc:CadDocument,sheet:DrawingInputs,projection:ExactAssemblyProjection,
 placements:readonly (readonly [unknown,number,number])[],factor:number){
 const pick:DrawingGdtPick={topology:projection.topology??[],origin:projection.origin,factor,views:placements.map(([,left,bottom])=>({left,bottom}))};
 page.gdt=pick;
 const items:(DrawingDatum|DrawingToleranceFrame)[]=[...sheet.datums??[],...sheet.tolerances??[]];
 for(const [i,item] of items.entries()){
  const resolved=resolveGdtTarget(pick.topology,item.target);
  const out:Drawn={paths:[],texts:[]};
  let anchor:SketchPoint|undefined;
  if('polylines' in resolved){
   const lines=resolved.polylines.map(line=>line.map(p=>paperPoint(pick,item.view,p)));
   anchor=nearestOn(lines,item.at).point;
  }
  if('letter' in item)drawDatum(item,anchor,out);else drawFrame(item,anchor,out);
  if(!anchor){
   page.annotationIssues.push(item.id);
   const box=extent(item),describe=describeGdtTarget(doc,item.target);
   out.paths.push({stroke:'error',points:[[box.l-1,box.b-1],[box.r+1,box.t+1]]},{stroke:'error',points:[[box.l-1,box.t+1],[box.r+1,box.b-1]]});
   const name='letter' in item?t`Datum ${item.letter}`:t`Tolerance ${i-(sheet.datums?.length??0)+1}`;
   const leaf=isExactFaceName(item.target)?splitExactFaceName(item.target).node:splitExactFaceName(parseEdgeReference(item.target).faces[0]).node;
   const mesh='reason' in resolved&&resolved.reason==='missing'?meshBodyOf(doc,projection,leaf):undefined;
   const reason='reason' in resolved&&resolved.reason==='count'?t`${describe}: the two faces now meet at ${resolved.found??0} edges`
    :mesh?t`${describe} is on ${mesh}, drawn from its mesh`:t`${describe} no longer exists`;
   out.texts.push({x:box.l,y:box.b-3.2,size:2,text:t`${name}: reference lost (${reason})`});
  }
  page.paths.push(...out.paths);page.texts.push(...out.texts);
 }
}
