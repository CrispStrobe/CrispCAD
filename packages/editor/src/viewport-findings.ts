// SPDX-License-Identifier: BSD-3-Clause
// The marks of a manufacturing finding drawn over the model (Check for manufacturing, Phase 6.3):
// the faces it names as a translucent patch, its edges and measuring lines as wide lines, and its
// points as dots. Drawn twice, like the edge picker: in front with depth test, and faintly through
// the body, so a mark on a hidden face is still found. Read-only; nothing here touches the model.
import * as THREE from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import type {ManufacturingMark} from '@brickwright/cad-core';

const COLOUR='#ff7a2f';

/** Bounding box of a mark, or undefined when it is empty. */
export function markBounds(mark:ManufacturingMark):{min:number[];max:number[]}|undefined{
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 const take=(flat:readonly number[])=>{for(let i=0;i+2<flat.length;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],flat[i+k]);max[k]=Math.max(max[k],flat[i+k]);}};
 mark.lines.forEach(take);take(mark.triangles);take(mark.points);
 return Number.isFinite(min[0])?{min,max}:undefined;
}

export function createFindingOverlay(scene:THREE.Scene,mark:ManufacturingMark){
 const group=new THREE.Group();group.name='manufacturing-finding';scene.add(group);
 const disposables:{dispose():void}[]=[];
 if(mark.triangles.length){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(mark.triangles,3));
  const front=new THREE.MeshBasicMaterial({color:COLOUR,transparent:true,opacity:.55,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  const behind=new THREE.MeshBasicMaterial({color:COLOUR,transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false,depthTest:false});
  const a=new THREE.Mesh(geometry,front),b=new THREE.Mesh(geometry,behind);a.renderOrder=61;b.renderOrder=58;group.add(b,a);
  disposables.push(geometry,front,behind);
 }
 const segments:number[]=[];
 for(const line of mark.lines)for(let i=0;i+5<line.length;i+=3)segments.push(...line.slice(i,i+6));
 if(segments.length){
  const geometry=new LineSegmentsGeometry();geometry.setPositions(segments);
  const front=new LineMaterial({color:COLOUR,linewidth:4,depthTest:true});
  const behind=new LineMaterial({color:COLOUR,linewidth:2,depthTest:false,transparent:true,opacity:.35,depthWrite:false});
  const a=new LineSegments2(geometry,front),b=new LineSegments2(geometry,behind);a.renderOrder=62;b.renderOrder=59;group.add(b,a);
  disposables.push(geometry,front,behind);
 }
 if(mark.points.length){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(mark.points,3));
  const material=new THREE.PointsMaterial({color:COLOUR,size:10,sizeAttenuation:false,depthTest:false,transparent:true});
  const points=new THREE.Points(geometry,material);points.renderOrder=63;group.add(points);
  disposables.push(geometry,material);
 }
 return {dispose(){scene.remove(group);disposables.forEach(d=>d.dispose());}};
}
export type FindingOverlay=ReturnType<typeof createFindingOverlay>;
