// SPDX-License-Identifier: BSD-3-Clause
import type {Vec3} from './document.js';
/** Original latitude/longitude ellipsoid mesh; poles share one index each. */
export function ellipsoidMesh(radius:Vec3,segments:number):{points:Vec3[];faces:number[][]}{
 const bands=2*Math.ceil(segments/4),points:Vec3[]=[[0,0,-radius[2]]],faces:number[][]=[];
 for(let row=1;row<bands;row++){
  const latitude=-Math.PI/2+Math.PI*row/bands,radial=Math.cos(latitude),z=radius[2]*Math.sin(latitude);
  for(let col=0;col<segments;col++){const angle=2*Math.PI*col/segments;points.push([radius[0]*radial*Math.cos(angle),radius[1]*radial*Math.sin(angle),z]);}
 }
 const top=points.length;points.push([0,0,radius[2]]);
 for(let col=0;col<segments;col++){
  const next=(col+1)%segments;faces.push([0,1+next,1+col]);
  for(let row=0;row<bands-2;row++){const a=1+row*segments+col,b=1+row*segments+next;faces.push([a,b,b+segments,a+segments]);}
  faces.push([top,1+(bands-2)*segments+col,1+(bands-2)*segments+next]);
 }
 return {points,faces};
}
