// SPDX-License-Identifier: BSD-3-Clause
import * as T from 'three';
import {t} from '@brickwright/cad-core';
/** Split planar triangles at common X planes before bending. All faces share the
 * same indexed vertices; side walls are generated from the surface boundary. */
export function bentExtrusion(contour:T.Vector2[],depth:number,radius:number,steps=48):T.BufferGeometry{
 type Point=[number,number];const points:Point[]=[],vertices=new Map<string,number>(),faces:number[][]=[];
 const vertex=([x,y]:Point)=>{x=Math.fround(x);y=Math.fround(y);const key=`${x}/${y}`;let id=vertices.get(key);if(id===undefined){id=points.length;points.push([x,y]);vertices.set(key,id);}return id;};
 const area=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const clip=(polygon:Point[],x:number,greater:boolean)=>{const out:Point[]=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],inside=(p:Point)=>greater?p[0]>=x:p[0]<=x,ia=inside(a),ib=inside(b);if(ia)out.push(a);if(ia!==ib){const [lo,hi]=a[0]<b[0]?[a,b]:[b,a];out.push([x,lo[1]+(hi[1]-lo[1])*(x-lo[0])/(hi[0]-lo[0])]);}}return out;};
 const min=Math.min(...contour.map(p=>p.x)),max=Math.max(...contour.map(p=>p.x));
 for(const triangle of T.ShapeUtils.triangulateShape(contour,[])){const original=triangle.map(i=>contour[i].toArray() as Point);if(area(...original as [Point,Point,Point])<0)original.reverse();for(let strip=0;strip<steps;strip++){const lo=min+(max-min)*strip/steps,hi=min+(max-min)*(strip+1)/steps;if(Math.max(...original.map(p=>p[0]))<lo||Math.min(...original.map(p=>p[0]))>hi)continue;const polygon=clip(clip(original,lo,true),hi,false);for(let i=1;i+1<polygon.length;i++){const ids=[vertex(polygon[0]),vertex(polygon[i]),vertex(polygon[i+1])];if(new Set(ids).size===3&&area(points[ids[0]],points[ids[1]],points[ids[2]])>1e-12)faces.push(ids);}}}
 const edges=new Map<string,{a:number;b:number;count:number}>();for(const face of faces)for(let i=0;i<3;i++){const a=face[i],b=face[(i+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`,edge=edges.get(key);if(edge)edge.count++;else edges.set(key,{a,b,count:1});}
 if([...edges.values()].some(e=>e.count>2))throw new Error(t('Bent profile could not form a closed shell'));
 const positions:number[]=[],indices:number[]=[],n=points.length;for(const z of [0,depth])for(const [x,y]of points)positions.push((radius+z)*Math.sin(x/radius),y,(radius+z)*Math.cos(x/radius)-radius);
 for(const [a,b,c]of faces)indices.push(c,b,a,a+n,b+n,c+n);for(const {a,b,count}of edges.values())if(count===1)indices.push(a,b,b+n,a,b+n,a+n);
 let minZ=Infinity;for(let i=2;i<positions.length;i+=3)minZ=Math.min(minZ,positions[i]);for(let i=2;i<positions.length;i+=3)positions[i]-=minZ;
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);return g;
}
