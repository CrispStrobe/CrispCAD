// SPDX-License-Identifier: BSD-3-Clause
// Surface-blend inspection (Phase 6.5 of docs/CRISPCAD-CONVERGENCE.md): the fillets, rounds,
// chamfers and freeform blends of each body, measured on its exact B-rep (the `drawing` exact
// request), with the evidence that each is a blend: its boundary edges and how tangent the exact
// surfaces are across them. Original code; it reads the same exact model as the manufacturing
// check's edge-radius rule (manufacturing.ts), so both agree on what a blend is.
import {SURFACE_BLEND_REPORT_VERSION,authoredBlends,t} from '@brickwright/cad-core';
import type {CadDocument,ExactDrawingData,SurfaceBlend,SurfaceBlendBody,SurfaceBlendFailure,SurfaceBlendReport} from '@brickwright/cad-core';
import {buildExactModel,edgeBreaks,faceCentre,faceMark} from './manufacturing.js';
import type {ExactModel} from './manufacturing.js';

/** Normals closer than this across an edge are tangent (the manufacturing check's threshold). */
const TANGENT_DEG=.5;
const FREEFORM=new Set(['bspline','revolution','extrusion','offset','other']);
const DEG=Math.PI/180;

export interface SurfaceBlendInput {
 /** The model the bodies come from (for the exact fillets and chamfers it was modelled with). */
 readonly document:CadDocument;
 readonly exact:ExactDrawingData;
 /** Top-level bodies to report; empty: every body in `exact`. */
 readonly bodies?:readonly string[];
 /** `id · package version` of the exact kernel. */
 readonly kernel?:string;
 /** Add marks (triangles and outlines) to draw each blend. */
 readonly marks?:boolean;
}

function boundary(m:ExactModel,faces:readonly number[]){
 const own=new Set(faces),edges=[...new Set(faces.flatMap(f=>m.faceEdges[f]))].filter(e=>{
  const info=m.edges[e],adjacent=m.body.edges[e].faces;
  return info.kind!=='seam'&&adjacent.some(f=>!own.has(f));
 });
 const tangent=edges.filter(e=>m.edges[e].kind==='tangent');
 return {edges,tangent,maxDeviation:tangent.length?Math.max(...tangent.map(e=>m.edges[e].angleDeg)):undefined,approximate:edges.some(e=>m.edges[e].approximate)};
}
const continuity=(all:number,tangent:number):SurfaceBlend['continuity']=>all>0&&tangent===all?'G1':tangent>0?'partly':'none';
const area=(m:ExactModel,faces:readonly number[])=>faces.reduce((sum,f)=>sum+m.faceArea[f],0);

function bodyBlends(m:ExactModel,marks:boolean):SurfaceBlend[]{
 const {blends,chamfers}=edgeBreaks(m),out:SurfaceBlend[]=[],used=new Set<number>();
 const common=(faces:number[])=>({faces,areaMm2:area(m,faces),location:[...faceCentre(m,faces)],...(marks?{mark:faceMark(m,faces)}:{})});
 for(const b of blends){
  b.faces.forEach(f=>used.add(f));
  const edge=boundary(m,b.faces);
  out.push({kind:b.convex?'round':'fillet',surface:b.surface,radiusMm:b.radius,...common(b.faces),boundaryEdges:edge.edges.length,tangentEdges:edge.tangent.length,
   ...(edge.maxDeviation!==undefined?{maxTangentDeviationDeg:edge.maxDeviation}:{}),continuity:continuity(edge.edges.length,edge.tangent.length),approximate:edge.approximate});
 }
 for(const c of chamfers){
  used.add(c.face);
  const edge=boundary(m,[c.face]),angles=c.rails.map(e=>m.edges[e].angleDeg);
  // An equal-distance chamfer: both rails at the same angle; the setback along each original
  // face is the width over 2 sin(φ/2), φ the angle between the faces it replaced.
  const symmetric=c.widthMm!==undefined&&angles.length===2&&Math.abs(angles[0]-angles[1])<.01;
  const setback=symmetric?c.widthMm!/(2*Math.sin((angles[0]+angles[1])*DEG/2)):undefined;
  out.push({kind:'chamfer',surface:m.body.faces[c.face].surface,...(c.widthMm!==undefined?{widthMm:c.widthMm}:{}),anglesDeg:angles,...(setback!==undefined?{setbackMm:setback}:{}),
   ...common([c.face]),boundaryEdges:edge.edges.length,tangentEdges:edge.tangent.length,...(edge.maxDeviation!==undefined?{maxTangentDeviationDeg:edge.maxDeviation}:{}),
   continuity:continuity(edge.edges.length,edge.tangent.length),approximate:edge.approximate});
 }
 // Freeform blends: spline (or swept) faces tangent to a neighbour, such as a fillet's corner patch.
 m.body.faces.forEach((face,f)=>{
  if(used.has(f)||!FREEFORM.has(face.surface))return;
  const edge=boundary(m,[f]);
  if(!edge.tangent.length)return;
  out.push({kind:'freeform',surface:face.surface,...common([f]),boundaryEdges:edge.edges.length,tangentEdges:edge.tangent.length,...(edge.maxDeviation!==undefined?{maxTangentDeviationDeg:edge.maxDeviation}:{}),
   continuity:continuity(edge.edges.length,edge.tangent.length),approximate:edge.approximate});
 });
 return out;
}

const near=(a:number,b:number)=>Math.abs(a-b)<=1e-5*Math.max(1,Math.abs(b));
/** The blends of each body; read-only. */
export function inspectSurfaceBlends(input:SurfaceBlendInput):SurfaceBlendReport{
 const wanted=input.bodies?.length?new Set(input.bodies):undefined;
 const bodies:SurfaceBlendBody[]=input.exact.bodies.filter(b=>!wanted||wanted.has(b.id)).map(body=>{
  const m=buildExactModel(body),blends=bodyBlends(m,!!input.marks);
  const authored=input.document.roots.includes(body.id)?authoredBlends(input.document,body.id).map(a=>({...a,
   matched:a.operation==='fillet'?blends.filter(b=>(b.kind==='fillet'||b.kind==='round')&&b.radiusMm!==undefined&&near(b.radiusMm,a.sizeMm)).length
    :blends.filter(b=>b.kind==='chamfer'&&b.setbackMm!==undefined&&near(b.setbackMm,a.sizeMm)).length})):[];
  return {id:body.id,name:body.name,blends,authored,faces:body.faces.length,edges:body.edges.length};
 });
 const failures:SurfaceBlendFailure[]=input.exact.failures.filter(f=>!wanted||wanted.has(f.id)).map(f=>({id:f.id,name:f.name,message:t`no exact B-rep: ${f.message}`}));
 return {version:SURFACE_BLEND_REPORT_VERSION,bodies,failures,tangentDeg:TANGENT_DEG,...(input.kernel&&bodies.length?{kernel:input.kernel}:{})};
}
