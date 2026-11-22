// SPDX-License-Identifier: BSD-3-Clause
import type {ManifoldToplevel} from 'manifold-3d';
import {offsetCurvedOutline} from './curved-sketch-offset.js';
import {evaluateSketch,offsetPositionExpression,sketchOutline,t} from '@brickwright/cad-core';
import type {CadDocument,FeatureScalar,PlanarSketch,SketchLoop,SketchProfile} from '@brickwright/cad-core';

export function offsetSketchProfile(module:ManifoldToplevel,sketch:PlanarSketch,context:Pick<CadDocument,'parametric'>,distance:number):SketchProfile{
 if(!Number.isFinite(distance)||Math.abs(distance)<.00001||Math.abs(distance)>100000)
  throw new Error(t('Offset magnitude must be between 0.00001 and 100000 mm.'));
 const before=evaluateSketch(sketch,context);
 const design=context.parametric??{version:1,parameters:{},bindings:[]};
 const shift=(value:FeatureScalar,delta:number)=>typeof value==='number'?value+delta:offsetPositionExpression(value,design,delta);
 const outline=(loop:Extract<SketchLoop,{kind:'outline'}>,delta:number)=>{
  if(loop.bulges?.some(Boolean))return {...loop,...offsetCurvedOutline(loop.points,loop.bulges,delta)};
  const section=new module.CrossSection([sketchOutline(loop.points)],'EvenOdd');
  try{
   // Bound miter growth at sharp corners. The resulting vertices stay editable.
   const offset=section.offset(delta,'Miter',8);
   try{
    const [points,...rest]=offset.toPolygons();
    if(!points||rest.length)throw new Error(t('This offset collapses or splits an outline. Try a smaller distance.'));
    const edited={...loop,points};
    delete edited.bulges;
    return edited;
   }finally{offset.delete();}
  }finally{section.delete();}
 };
 const profile=sketch.profile;
 let edited:SketchProfile;
 switch(profile.kind){
  case 'rectangle':edited={...profile,width:shift(profile.width,2*distance),depth:shift(profile.depth,2*distance)};break;
  case 'circle':edited={...profile,radius:shift(profile.radius,distance)};break;
  case 'outline':edited=outline(profile,distance);break;
  case 'region':{
   const outer=before.loopIds![0];
   edited={...profile,loops:profile.loops.map(loop=>{
    const delta=loop.id===outer?distance:-distance;
    return loop.kind==='circle'?{...loop,radius:shift(loop.radius,delta)}:outline(loop,delta);
   })};
   break;
  }
 }
 const after=evaluateSketch({...sketch,profile:edited},context);
 if(before.loopIds?.[0]!==after.loopIds?.[0])throw new Error(t('This offset changes which loop is the outside boundary. Try a smaller distance.'));
 return edited;
}
