// SPDX-License-Identifier: BSD-3-Clause
// Original geometric definitions using the existing MIT Three.js constructors.
import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';
import {t,checkGenerator} from '@brickwright/cad-core';
import type {GeneratorRecipe} from '@brickwright/cad-core';

/** Local origin remains the bounding-box centre, matching legacy mesh presets.
 * Collision layout metadata describes the generated mesh, never a display LOD. */
export function basicShapeGeometry(recipe:GeneratorRecipe):T.BufferGeometry {
 const r=checkGenerator(recipe),p=r.values,n=p.segments;
 let g:T.BufferGeometry;
 switch(r.preset){
  case 'rounded-box':g=p.radius===0?new T.BoxGeometry(p.width,p.depth,p.height):new RoundedBoxGeometry(p.width,p.depth,p.height,p.detail,p.radius);break;
  case 'capsule':{
   const radius=p.width/2,half=(p.length-p.width)/2,s=new T.Shape();
   s.moveTo(-half,-radius);s.lineTo(half,-radius);s.absarc(half,0,radius,-Math.PI/2,Math.PI/2,false);s.lineTo(-half,radius);s.absarc(-half,0,radius,Math.PI/2,3*Math.PI/2,false);s.closePath();
   g=new T.ExtrudeGeometry(s,{depth:p.height,bevelEnabled:false,curveSegments:n});break;
  }
  case 'tube':case 'washer':{
   const outer=p.outerDiameter/2,inner=outer-p.wallThickness;
   g=new T.LatheGeometry([[inner,0],[outer,0],[outer,p.height],[inner,p.height],[inner,0]].map(([x,y])=>new T.Vector2(x,y)),n).rotateX(Math.PI/2);
   g.userData.collisionHint={kind:'radial-profile',segments:n,sides:4,layout:'rows',closed:true};break;
  }
  case 'cone':g=new T.CylinderGeometry(0,p.diameter/2,p.height,n).rotateX(Math.PI/2);break;
  case 'frustum':g=new T.CylinderGeometry(p.topDiameter/2,p.bottomDiameter/2,p.height,n).rotateX(Math.PI/2);break;
  case 'polygon':g=new T.CylinderGeometry(p.diameter/2,p.diameter/2,p.height,p.sides).rotateX(Math.PI/2);break;
  case 'ellipse':g=new T.CylinderGeometry(1,1,p.height,n).rotateX(Math.PI/2).scale(p.width/2,p.depth/2,1);break;
  case 'wedge':g=new ConvexGeometry([[-p.width/2,-p.depth/2,0],[p.width/2,-p.depth/2,0],[-p.width/2,p.depth/2,0],[p.width/2,p.depth/2,0],[-p.width/2,p.depth/2,p.height],[p.width/2,p.depth/2,p.height]].map(v=>new T.Vector3(...v as [number,number,number])));break;
  case 'pyramid':g=new ConvexGeometry([[-p.width/2,-p.depth/2,0],[p.width/2,-p.depth/2,0],[-p.width/2,p.depth/2,0],[p.width/2,p.depth/2,0],[0,0,p.height]].map(v=>new T.Vector3(...v as [number,number,number])));break;
  case 'round-roof':{
   const s=new T.Shape();s.moveTo(-p.width/2,0);s.absellipse(0,0,p.width/2,p.height,Math.PI,0,true,0);s.lineTo(-p.width/2,0);s.closePath();
   g=new T.ExtrudeGeometry(s,{depth:p.length,bevelEnabled:false,curveSegments:n}).rotateX(Math.PI/2);break;
  }
  case 'torus':g=new T.TorusGeometry(p.majorRadius,p.tubeRadius,p.tubeSegments,n);g.userData.collisionHint={kind:'tube-grid',segments:n,sides:p.tubeSegments,layout:'columns',closed:true};break;
  default:throw new Error(t('Unsupported basic shape recipe'));
 }
 g.computeBoundingBox();g.translate(...g.boundingBox!.getCenter(new T.Vector3()).negate().toArray() as [number,number,number]);return g;
}
