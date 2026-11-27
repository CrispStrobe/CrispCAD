// SPDX-License-Identifier: BSD-3-Clause
// Picking B-rep edges directly in the 3D view, for exact fillets and chamfers of chosen edges.
// The exact kernel lists the body's edges (sample points and stable references, the same listing
// the dialog's line drawing uses); this draws them over the body as wide lines and toggles the edge
// nearest to a tap or click. A touch gets a wider target than a mouse, so a finger on a tablet can
// pick an edge without a keyboard. An edge hidden behind the body (the ray from the tap meets a
// face clearly in front of it) is not picked; one may still be picked after turning the view.
import * as THREE from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';

/** Screen distance (CSS px) within which a tap picks an edge: wide for a finger, narrower for a mouse. */
export const EDGE_PICK_TOUCH_PX=24,EDGE_PICK_MOUSE_PX=10;

export interface PickableEdge {
 /** World points from start to end. */
 readonly points:readonly (readonly number[])[];
 /** False for edges without a stable reference (drawn dimmed, never picked). */
 readonly pickable:boolean;
}
/** One edge projected to the screen: CSS px from the canvas's top left and depth along the view. */
export interface ProjectedEdge {
 readonly xy:readonly (readonly [number,number])[];readonly depth:readonly number[];readonly pickable:boolean;
 /**
  * Projected through a perspective camera: along a segment, depth is not linear in screen
  * position (the near half of a receding edge covers more of the screen), but the inverse of the
  * depth along the camera's axis is. `viewDepth` holds that depth per point and `rayScale` turns it
  * into depth along the ray (1 / the cosine between the ray and the camera's axis).
  */
 readonly perspective?:{readonly viewDepth:readonly number[];readonly rayScale:number};
}
/** Depth at screen parameter `t` between the depths `a` and `b` of a segment's ends. */
export function depthAlong(edge:ProjectedEdge,segment:number,t:number):number{
 const j=Math.min(edge.depth.length-1,segment+1),p=edge.perspective;
 if(p){const a=p.viewDepth[segment],b=p.viewDepth[j];if(a>0&&b>0)return p.rayScale/((1-t)/a+t/b);}
 const a=edge.depth[segment],b=edge.depth[j];return a+(b-a)*t;
}

/** The closest point of the polyline `xy` to (x, y): its distance, segment and parameter on it. */
export function closestOnPolyline(xy:readonly (readonly [number,number])[],x:number,y:number):{distance:number;segment:number;t:number}{
 if(xy.length===1)return {distance:Math.hypot(xy[0][0]-x,xy[0][1]-y),segment:0,t:0};
 let best={distance:Infinity,segment:0,t:0};
 for(let i=0;i+1<xy.length;i++){
  const [ax,ay]=xy[i],[bx,by]=xy[i+1],dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;
  const t=length>0?Math.min(1,Math.max(0,((x-ax)*dx+(y-ay)*dy)/length)):0;
  const distance=Math.hypot(ax+t*dx-x,ay+t*dy-y);
  if(distance<best.distance)best={distance,segment:i,t};
 }
 return best;
}

/**
 * The edge a tap at (x, y) picks: the nearest pickable edge within `radius` px whose nearest point
 * is not behind the surface the tap meets. `surfaceDepth` is the depth of that surface along the
 * view (Infinity when the tap meets no body) and `slack` how far behind it an edge still counts as
 * on it (edges lie on the surface, and the surface under the finger is not exactly at the edge).
 * Returns the edge's index or -1.
 */
export function pickEdgeAt(edges:readonly ProjectedEdge[],x:number,y:number,radius:number,surfaceDepth=Infinity,slack=0):number{
 let best=-1,bestDistance=Infinity;
 edges.forEach((edge,i)=>{
  if(!edge.pickable||!edge.xy.length)return;
  const near=closestOnPolyline(edge.xy,x,y);
  if(near.distance>radius||near.distance>=bestDistance)return;
  const depth=depthAlong(edge,near.segment,near.t);
  if(depth>surfaceDepth+slack)return;
  best=i;bestDistance=near.distance;
 });
 return best;
}

const COLOURS={pickable:'#6fd3ff',picked:'#ffb347',unpickable:'#5c6f7c'};

/** The overlay of edges in the scene; `project` gives screen positions for hit tests. */
export function createEdgeOverlay(scene:THREE.Scene,edges:readonly PickableEdge[]){
 const group=new THREE.Group();group.name='edge-pick';
 group.matrixAutoUpdate=false;scene.add(group);
 // Two passes: the edges in front, wide and opaque; the hidden ones faint, through the body.
 const front=new LineMaterial({vertexColors:true,linewidth:3,depthTest:true,transparent:false});
 const hidden=new LineMaterial({vertexColors:true,linewidth:1.5,depthTest:false,transparent:true,opacity:.28,depthWrite:false});
 const positions:number[]=[],ranges:{start:number;count:number}[]=[];
 for(const edge of edges){
  const start=positions.length/6;
  for(let i=0;i+1<edge.points.length;i++)positions.push(...edge.points[i].slice(0,3),...edge.points[i+1].slice(0,3));
  ranges.push({start,count:positions.length/6-start});
 }
 const geometry=new LineSegmentsGeometry();geometry.setPositions(positions);
 const colours=new Float32Array(positions.length);
 const frontLines=new LineSegments2(geometry,front),hiddenLines=new LineSegments2(geometry,hidden);
 frontLines.renderOrder=60;hiddenLines.renderOrder=59;
 group.add(hiddenLines,frontLines);
 const colour=new THREE.Color();
 function paint(picked:ReadonlySet<number>){
  edges.forEach((edge,i)=>{
   colour.set(picked.has(i)?COLOURS.picked:edge.pickable?COLOURS.pickable:COLOURS.unpickable);
   const {start,count}=ranges[i];
   for(let s=start;s<start+count;s++)for(let v=0;v<2;v++)colours.set([colour.r,colour.g,colour.b],6*s+3*v);
  });
  geometry.setColors(colours);
 }
 paint(new Set());
 const point=new THREE.Vector3();
 return {
  paint,
  /** The edges in screen px (relative to the canvas) and depth along the ray direction from `origin`. */
  project(camera:THREE.Camera,width:number,height:number,origin:THREE.Vector3,direction:THREE.Vector3):ProjectedEdge[]{
   const perspective=(camera as THREE.PerspectiveCamera).isPerspectiveCamera===true;
   const eye=new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld),axis=camera.getWorldDirection(new THREE.Vector3());
   const rayScale=1/Math.max(1e-6,direction.clone().normalize().dot(axis));
   return edges.map(edge=>{
    const xy:[number,number][]=[],depth:number[]=[],viewDepth:number[]=[];
    for(const p of edge.points){
     point.set(p[0],p[1],p[2]);
     depth.push(point.clone().sub(origin).dot(direction));
     if(perspective)viewDepth.push(point.clone().sub(eye).dot(axis));
     point.project(camera);
     xy.push([(point.x+1)*width/2,(1-point.y)*height/2]);
    }
    return {xy,depth,pickable:edge.pickable,...(perspective?{perspective:{viewDepth,rayScale}}:{})};
   });
  },
  dispose(){scene.remove(group);geometry.dispose();front.dispose();hidden.dispose();},
 };
}
export type EdgeOverlay=ReturnType<typeof createEdgeOverlay>;
