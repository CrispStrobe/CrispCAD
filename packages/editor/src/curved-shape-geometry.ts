// SPDX-License-Identifier: BSD-3-Clause
// Independently authored sampled analytic profiles, with actual mesh collision metadata.
import * as T from 'three';
import {checkGenerator,t} from '@brickwright/cad-core';
import type {GeneratorRecipe} from '@brickwright/cad-core';
export function curvedShapeGeometry(recipe:GeneratorRecipe):T.BufferGeometry {
 const r=checkGenerator(recipe),p=r.values,N=p.profileSegments,profile:[number,number][]=[];
 if(r.preset==='curved-cone'||r.preset==='paraboloid'){
  profile.push([0,0]);for(let i=0;i<=N;i++){const t=i/N;profile.push([p.diameter/2*(r.preset==='curved-cone'?(1-t)**p.exponent:Math.sqrt(1-t)),p.height*t]);}
 }else if(r.preset==='hemisphere'){
  profile.push([0,0]);for(let i=0;i<=N;i++)profile.push(i===N?[0,p.radius]:[p.radius*Math.cos(i*Math.PI/(2*N)),p.radius*Math.sin(i*Math.PI/(2*N))]);
 }else if(r.preset==='vase'){
  const smooth=(x:number)=>x*x*(3-2*x),radius=(z:number)=>z<=p.bellyHeight?(p.baseDiameter+(p.bodyDiameter-p.baseDiameter)*smooth(z/p.bellyHeight))/2:(p.bodyDiameter+(p.mouthDiameter-p.bodyDiameter)*smooth((z-p.bellyHeight)/(p.height-p.bellyHeight)))/2;
  // Shared sampling heights keep a radial wall thickness even at the floor and belly.
  const heights=[...new Set([p.baseThickness,p.bellyHeight,...Array.from({length:N+1},(_,i)=>p.height*i/N)])].sort((a,b)=>a-b);
  profile.push([0,0],...heights.map(z=>[radius(z),z] as [number,number]),...heights.filter(z=>z>=p.baseThickness).reverse().map(z=>[radius(z)-p.wallThickness,z] as [number,number]),[0,p.baseThickness]);
 }else throw new Error(t('Unsupported curved shape recipe'));
 const g=new T.LatheGeometry(profile.map(([r,z])=>new T.Vector2(r,z)),p.segments).rotateX(Math.PI/2);
 g.userData.collisionHint={kind:'radial-profile',segments:p.segments,sides:profile.length-1,layout:'rows',closed:true};
 g.computeBoundingBox();g.translate(...g.boundingBox!.getCenter(new T.Vector3()).negate().toArray() as [number,number,number]);return g;
}
