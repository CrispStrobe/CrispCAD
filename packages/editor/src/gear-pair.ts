// SPDX-License-Identifier: BSD-3-Clause
// A simulation-ready spur pair: two parametric CAD Script gears on hinges over a
// fixed plate, coupled by an ideal gear mesh at their pitch point.
import * as THREE from 'three';
import {createCadSession,defaultPartPhysics,externalCenterDistanceMm,externalSpeedRatio,identityTransform,meshAlignDeg,spurGearPolygon,t} from '@brickwright/cad-core';
import type {CadDocument,CodeProgram} from '@brickwright/cad-core';

export const GEAR_PAIR_ID='gear-pair';
export const gearPairCatalog=[
 {id:GEAR_PAIR_ID,name:'Gear pair',category:'Motion parts',description:'Two meshing involute spur gears, 12 and 24 teeth, module 2 mm, on axles over a fixed plate. The driver hinge (A) turns the driven gear at −1:2.',keywords:'spur gear pair transmission reduction involute mesh mechanism',color:'#a0b8c5'},
];
export const isGearPair=(id:string)=>gearPairCatalog.some(p=>p.id===id);

const MODULE=2,DRIVER=12,DRIVEN=24,WIDTH=6,BORE=2.5;
/** Editable CAD Script for one gear; the bore fits the axle hinge. */
export function gearProgram(teeth:number,module=MODULE,width=WIDTH,bore=BORE):CodeProgram{
 return {version:1,language:'brickwright-cad-script',parameters:{},source:`// Involute spur gear (profile adapted from kernelCAD, MIT). Millimetres.
param gearModule: mm = ${module};
param teeth: scalar = ${teeth};
param faceWidth: mm = ${width};
param backlash: mm = 0.2;
param boreRadius: mm = ${bore};
return extrudeProfile(faceWidth, subtract2d(spurGear2d(gearModule, teeth, 20, backlash), circle2d(boreRadius, 48)));
`};
}

export function createGearPairDocument():CadDocument{
 const s=createCadSession(),distance=externalCenterDistanceMm(MODULE,DRIVER,MODULE,DRIVEN);
 try{
  const plate=s.add({kind:'box',size:[distance+2*MODULE*DRIVEN/2+12,MODULE*DRIVEN+12,3]},{name:t('Gear plate'),transform:{...identityTransform(),position:[distance/2+(DRIVEN-DRIVER)*MODULE/4,0,-2.5]}});
  s.update(plate,{physics:{...defaultPartPhysics(),motion:'static'}});
  const driver=s.addCode(gearProgram(DRIVER),t('Driver gear')),driven=s.addCode(gearProgram(DRIVEN),t('Driven gear'));
  s.update(driven,{transform:{...identityTransform(),position:[distance,0,0],rotation:[0,0,meshAlignDeg(DRIVEN)]}});
  for(const id of [driver,driven])s.update(id,{physics:{...defaultPartPhysics(),intent:'gear',sourcePreset:GEAR_PAIR_ID}});
  const input=s.addJoint('hinge',plate,driver,[0,0,WIDTH/2],[0,0,1]),output=s.addJoint('hinge',plate,driven,[distance,0,WIDTH/2],[0,0,1]);
  s.meshGears(input,output,externalSpeedRatio(DRIVER,DRIVEN));
  const doc=structuredClone(s.state.document);doc.title=t('Gear pair');return doc;
 }finally{s.dispose();}
}

/** Lightweight thumbnail: both gear outlines as flat extrusions. */
export function gearPairPreview():THREE.BufferGeometry{
 const distance=externalCenterDistanceMm(MODULE,DRIVER,MODULE,DRIVEN);
 const shape=(teeth:number)=>new THREE.Shape(spurGearPolygon({module:MODULE,teeth,pressureAngleDeg:20,backlash:.2}).map(([x,y])=>new THREE.Vector2(x,y)));
 const a=new THREE.ExtrudeGeometry(shape(DRIVER),{depth:WIDTH,bevelEnabled:false}),b=new THREE.ExtrudeGeometry(shape(DRIVEN),{depth:WIDTH,bevelEnabled:false}).rotateZ(meshAlignDeg(DRIVEN)*Math.PI/180).translate(distance,0,0);
 const merged=new THREE.BufferGeometry(),parts=[a,b].map(g=>g.toNonIndexed());
 merged.setAttribute('position',new THREE.Float32BufferAttribute(parts.flatMap(g=>Array.from(g.getAttribute('position').array)),3));merged.computeVertexNormals();
 [a,b,...parts].forEach(g=>g.dispose());return merged;
}
