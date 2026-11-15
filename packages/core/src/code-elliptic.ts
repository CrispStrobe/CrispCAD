// SPDX-License-Identifier: BSD-3-Clause
import type {Vec3} from './document.js';
import {t} from './i18n.js';
/** Original bounded angular sampling; equal endpoints describe a full turn. */
export function ellipticSampling(segments:number,startAngle=0,endAngle=360){
 const start=startAngle*Math.PI/180,turn=2*Math.PI;let span=(endAngle-startAngle)*Math.PI/180%turn;if(span<=0)span+=turn;
 const closed=span===turn,count=closed?segments:Math.floor(segments*span/turn);return {start,span,closed,count};
}
/** Original linear-size mesh; explicit diagonals also retain twisted radial cut faces. */
export function ellipticFrustumMesh(start:readonly number[],end:readonly number[],height:number,segments:number,startAngle=0,endAngle=360,angularSegments?:number):{points:Vec3[];faces:number[][]}{
 const sampling=ellipticSampling(segments,startAngle,endAngle),closed=sampling.closed,count=angularSegments??sampling.count;
 if(count<1)throw new Error(t('Elliptical sector needs at least one angular segment'));
 const points:Vec3[]=[],faces:number[][]=[],length=count+(closed?0:1);
 const ring=(r:readonly number[],z:number)=>{
  if(!r[0]&&!r[1]){const tip=points.length;points.push([0,0,z]);return {ids:Array(length).fill(tip) as number[],center:tip,tip:true};}
  const ids=Array.from({length},(_,i)=>{const angle=closed&&startAngle===0?i*2*Math.PI/count:sampling.start+i*sampling.span/count,id=points.length;points.push([r[0]*Math.cos(angle),r[1]*Math.sin(angle),z]);return id;});const center=points.length;points.push([0,0,z]);return {ids,center,tip:false};
 };
 const bottom=ring(start,-height/2),top=ring(end,height/2),face=(a:number,b:number,c:number)=>{if(a!==b&&b!==c&&a!==c)faces.push([a,b,c]);};
 for(let i=0;i<count;i++){
  const next=closed?(i+1)%count:i+1,a=bottom.ids[i],b=bottom.ids[next],c=top.ids[i],d=top.ids[next];
  if(!bottom.tip){face(bottom.center,b,a);face(a,b,c);}
  if(!top.tip){face(top.center,c,d);face(c,b,d);}
 }
 if(!closed){face(bottom.center,bottom.ids[0],top.center);face(bottom.ids[0],top.ids[0],top.center);face(bottom.center,top.center,bottom.ids[count]);face(bottom.ids[count],top.center,top.ids[count]);}
 return {points,faces};
}
