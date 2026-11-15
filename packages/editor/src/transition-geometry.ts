// SPDX-License-Identifier: BSD-3-Clause
// Original section meshes. Two rows (outer/inner) per section make collision
// reconstruction use actual vertices, rather than hardcoded design dimensions.
import * as T from 'three';import {checkGenerator,t} from '@brickwright/cad-core';import type {GeneratorRecipe} from '@brickwright/cad-core';
export function transitionGeometry(recipe:GeneratorRecipe,preview=false):T.BufferGeometry {
 const r=checkGenerator(recipe),p=r.values;
 if(r.preset==='dovetail'){
  const slope=(p.topWidth-p.baseWidth)/(2*p.height),offset=p.clearance*Math.hypot(1,slope),low=-p.clearance,high=p.height+p.clearance,a=p.baseWidth/2+slope*low+offset,b=p.baseWidth/2+slope*high+offset,s=new T.Shape();s.moveTo(-a,low);s.lineTo(a,low);s.lineTo(b,high);s.lineTo(-b,high);s.closePath();return new T.ExtrudeGeometry(s,{depth:p.length,bevelEnabled:false}).rotateX(Math.PI/2);
 }
 const positions:number[]=[],indices:number[]=[],bend=r.preset==='bent-tube';
 if(!bend&&r.preset!=='loft')throw new Error(t('Unsupported transition recipe'));
 const levels=preview?Math.min(12,bend?p.arcSegments:p.profileSegments):bend?p.arcSegments:p.profileSegments,N=preview?Math.min(24,p.segments):p.segments,angles=Array.from({length:N},(_,i)=>2*Math.PI*i/N);
 if(!bend){
  const corners=(w:number,d:number)=>{const a=Math.atan2(d,w);return [a,Math.PI-a,Math.PI+a,2*Math.PI-a];};
  angles.push(0,Math.PI/2,Math.PI,3*Math.PI/2,...corners(p.baseWidth,p.baseDepth));if(p.wallThickness>0)angles.push(...corners(p.baseWidth-2*p.wallThickness,p.baseDepth-2*p.wallThickness));
 }
 angles.sort((a,b)=>a-b);const unique=angles.filter((a,i)=>!i||a-angles[i-1]>1e-10),S=unique.length;unique.push(2*Math.PI);
 const rectangle=(w:number,d:number,a:number)=>1/Math.max(Math.abs(Math.cos(a))/(w/2),Math.abs(Math.sin(a))/(d/2));
 for(let level=0;level<=levels;level++)for(const inner of [false,true])for(const a of unique){
  const t=level/levels;
  if(bend){const theta=t*p.bendAngle*Math.PI/180,section=p.outerDiameter/2-(inner?p.wallThickness:0),radius=p.bendRadius+section*Math.cos(a);positions.push(radius*Math.cos(theta),radius*Math.sin(theta),section*Math.sin(a));}
  else {const wall=inner?p.wallThickness:0,R=inner&&p.wallThickness===0?0:(1-t)*rectangle(p.baseWidth-2*wall,p.baseDepth-2*wall,a)+t*(p.topDiameter/2-wall);positions.push(R*Math.cos(a),R*Math.sin(a),p.height*t);}
 }
 const at=(level:number,side:number,inner=0)=>level*2*(S+1)+inner*(S+1)+side;
 const quad=(a:number,b:number,c:number,d:number)=>indices.push(a,b,c,a,c,d);
 const hollow=bend||p.wallThickness>0;
 for(let level=0;level<levels;level++)for(let side=0;side<S;side++){
  quad(at(level,side),at(level,side+1),at(level+1,side+1),at(level+1,side));
  if(hollow)quad(at(level,side,1),at(level+1,side,1),at(level+1,side+1,1),at(level,side+1,1));
 }
 for(let side=0;side<S;side++){
  if(hollow){quad(at(0,side),at(0,side,1),at(0,side+1,1),at(0,side+1));quad(at(levels,side),at(levels,side+1),at(levels,side+1,1),at(levels,side,1));}
  else {indices.push(at(0,0,1),at(0,side+1),at(0,side),at(levels,0,1),at(levels,side),at(levels,side+1));}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);
 // The bend sweep's parameter order reverses the outer surface orientation.
 if(bend){for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];g.setIndex(indices);}
 g.userData.collisionHint={kind:'annular-grid',segments:levels,sides:S,layout:'rows',closed:false};return g;
}
