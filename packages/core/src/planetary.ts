// SPDX-License-Identifier: BSD-3-Clause
// A planetary (epicyclic) gear set as a ready assembly: sun, planets and an internal ring gear,
// each an editable CAD Script involute gear (profiles adapted from kernelCAD, MIT; see
// gears/), on hinges over a fixed carrier plate, coupled by ideal gear meshes so the simulation
// turns them together. With the carrier held (a "star" arrangement) the ring turns at
// −zs/zr of the sun. Grouped as one assembly with an exploded view (document version 50).
//
// Turning carrier (any one member fixed): the carrier plate turns on its own hinge over a fixed
// frame, and sun, planets and ring hinge on the carrier, so the gear meshes keep their ratios in
// the carrier's frame (as with the carrier held). The fixed member is held by one more mesh: with
// the ring fixed, ω(ring hinge) = −ω(carrier hinge), so the ring stands still and the sun runs at
// (zs + zr)/zs of the carrier; with the sun fixed, ω(sun hinge) = −ω(carrier hinge) and the ring
// runs at (zs + zr)/zr of the carrier (Willis: (ωs − ωc)/(ωr − ωc) = −zr/zs). Motor A turns the
// carrier.
//
// Original code. The meshing phase of each planet follows from rolling the sun–planet pair around
// the sun; equal spacing needs (zs + zr) divisible by the number of planets.
import {t} from './i18n.js';
import {createCadSession} from './session.js';
import {identityTransform,newId} from './document.js';
import type {CadDocument} from './document.js';
import type {CodeProgram} from './code.js';
import {defaultPartPhysics} from './physics.js';
import {meshAlignDeg,pitchRadiusMm} from './gears/spurGearPairMath.js';
import {assertPlanetaryToothCompatibility} from './gears/spurGear.js';

export const PLANETARY_ID='planetary-gear-set';
export interface PlanetaryOptions {
 /** Teeth of the sun gear (default 12). */
 sunTeeth?:number;
 /** Teeth of each planet (default 12). The ring has sun + 2 × planet teeth. */
 planetTeeth?:number;
 /** Number of planets, 2–8 (default 3). */
 planets?:number;
 /** Module in mm (default 2). */
 module?:number;
 /** Face width in mm (default 6). */
 width?:number;
 /** Backlash in mm on each gear (default 0.2). */
 backlash?:number;
 /** The member that stands still (default the carrier; `ring` or `sun` make the carrier turn). */
 fixed?:PlanetaryFixed;
}
export type PlanetaryFixed='carrier'|'ring'|'sun';
export const PLANETARY_FIXED:readonly PlanetaryFixed[]=Object.freeze(['carrier','ring','sun']);
export interface PlanetaryLayout {sun:number;planet:number;ring:number;planets:number;module:number;width:number;backlash:number;centreDistance:number;ringOuterRadius:number;
 /** Ring speed per unit sun speed with the carrier held. */
 ratio:number;
 fixed:PlanetaryFixed;
 /** Absolute speeds of sun, carrier and ring per unit speed of the driven member (motor A: the
  * sun with the carrier held, else the carrier). */
 speeds:{sun:number;carrier:number;ring:number}}

/** Checks tooth counts and spacing; the ring has sun + 2 × planet teeth. */
export function planetaryLayout(options:PlanetaryOptions={}):PlanetaryLayout{
 const sun=options.sunTeeth??12,planet=options.planetTeeth??12,planets=options.planets??3,module=options.module??2,width=options.width??6,backlash=options.backlash??.2,fixed=options.fixed??'carrier';
 if(!PLANETARY_FIXED.includes(fixed))throw new Error(t('The fixed member is the carrier, the ring or the sun'));
 const ring=sun+2*planet;
 assertPlanetaryToothCompatibility({sunTeeth:sun,planetTeeth:planet,ringTeeth:ring});
 if(!Number.isInteger(planets)||planets<2||planets>8)throw new Error(t('A planetary set has 2 to 8 planets'));
 if(ring>400)throw new Error(t('The ring gear would have more than 400 teeth'));
 if(!(module>=.3&&module<=20))throw new Error(t('Module must be between 0.3 and 20 mm'));
 if(!(width>=.5&&width<=200))throw new Error(t('Face width must be between 0.5 and 200 mm'));
 if(!(backlash>=0&&backlash<=module/2))throw new Error(t('Backlash must be between 0 and half the module'));
 if((sun+ring)%planets)throw new Error(t`Equally spaced planets need sun + ring teeth (${sun+ring}) divisible by the number of planets (${planets})`);
 const centreDistance=pitchRadiusMm(module,sun)+pitchRadiusMm(module,planet);
 // Neighbouring planets must clear each other's tips.
 if(2*centreDistance*Math.sin(Math.PI/planets)<=module*(planet+2)+.5)throw new Error(t('The planets are too large to fit side by side; use fewer planets or fewer planet teeth'));
 const speeds=fixed==='carrier'?{sun:1,carrier:0,ring:-sun/ring}:fixed==='ring'?{sun:(sun+ring)/sun,carrier:1,ring:0}:{sun:0,carrier:1,ring:(sun+ring)/ring};
 return {sun,planet,ring,planets,module,width,backlash,centreDistance,ringOuterRadius:pitchRadiusMm(module,ring)+2.5*module+Math.max(3,2*module),ratio:-sun/ring,fixed,speeds};
}
function externalGear(teeth:number,l:PlanetaryLayout,bore:number):CodeProgram{
 return {version:1,language:'brickwright-cad-script',parameters:{},source:`// Involute spur gear (profile adapted from kernelCAD, MIT). Millimetres.
param gearModule: mm = ${l.module};
param teeth: scalar = ${teeth};
param faceWidth: mm = ${l.width};
param backlash: mm = ${l.backlash};
param boreRadius: mm = ${bore};
return extrudeProfile(faceWidth, subtract2d(spurGear2d(gearModule, teeth, 20, backlash), circle2d(boreRadius, 48)));
`};
}
function ringGear(l:PlanetaryLayout):CodeProgram{
 return {version:1,language:'brickwright-cad-script',parameters:{},source:`// Internal (ring) gear: a disc minus the involute tooth-space cutter (adapted from kernelCAD, MIT).
param gearModule: mm = ${l.module};
param teeth: scalar = ${l.ring};
param faceWidth: mm = ${l.width};
param backlash: mm = ${l.backlash};
param outerRadius: mm = ${+l.ringOuterRadius.toFixed(3)};
return extrudeProfile(faceWidth, subtract2d(circle2d(outerRadius, 192), internalSpurGear2d(gearModule, teeth, 20, backlash)));
`};
}
/** The planetary set as a document: plate (fixed carrier), sun, planets, ring; hinges with gear
 * meshes (the sun drives, hinge A); one group and an exploded view. */
export function createPlanetaryDocument(options:PlanetaryOptions={}):CadDocument{
 const l=planetaryLayout(options),s=createCadSession();
 try{
  const bore=Math.min(2.5,.25*l.module*Math.min(l.sun,l.planet));
  const turning=l.fixed!=='carrier',size=2*l.ringOuterRadius+8;
  // A turning carrier sits on a fixed frame below it (0.5 mm apart) and turns on its own hinge.
  const frame=turning?s.add({kind:'box',size:[size+6,size+6,3]},{name:t('Frame'),transform:{...identityTransform(),position:[0,0,-6]}}):undefined;
  if(frame)s.update(frame,{physics:{...defaultPartPhysics(),motion:'static'}});
  const plate=s.add({kind:'box',size:[size,size,3]},{name:t('Carrier plate'),transform:{...identityTransform(),position:[0,0,-2.5]}});
  s.update(plate,{physics:{...defaultPartPhysics(),motion:turning?'dynamic':'static'}});
  const gear=(program:CodeProgram,name:string,x:number,y:number,rotation:number)=>{const id=s.addCode(program,name);s.update(id,{transform:{...identityTransform(),position:[x,y,0],rotation:[0,0,rotation]},physics:{...defaultPartPhysics(),intent:'gear',sourcePreset:PLANETARY_ID}});return id;};
  const sun=gear(externalGear(l.sun,l,bore),t('Sun gear'),0,0,0);
  const planets:string[]=[];
  for(let i=0;i<l.planets;i++){
   const phi=360*i/l.planets,rad=phi*Math.PI/180;
   // Planet 0 at +X meshes like an external pair; rolling that pair φ around the sun turns the planet by φ·(1 + zs/zp).
   planets.push(gear(externalGear(l.planet,l,bore),t`Planet gear ${i+1}`,l.centreDistance*Math.cos(rad),l.centreDistance*Math.sin(rad),meshAlignDeg(l.planet)+phi*(1+l.sun/l.planet)));
  }
  // The ring presents a tooth where planet 0 has a space (+X): a tooth at 0° for an even planet, a space for an odd one.
  const ring=gear(ringGear(l),t('Ring gear'),0,0,l.planet%2===0?0:180/l.ring);
  const z=l.width/2,axis:[number,number,number]=[0,0,1];
  const carrierHinge=frame?s.addJoint('hinge',frame,plate,[0,0,z],axis):undefined;
  const sunHinge=s.addJoint('hinge',plate,sun,[0,0,z],axis);
  const planetHinges=planets.map(id=>{const p=s.state.document.nodes[id].transform.position;return s.addJoint('hinge',plate,id,[p[0],p[1],z],axis);});
  const ringHinge=s.addJoint('hinge',plate,ring,[0,0,z],axis);
  // Gear meshes: each planet follows the sun (ω_sun = −zp/zs · ω_planet), the ring follows planet 1 (ω_planet = zr/zp · ω_ring).
  // (meshGears clears the second hinge's own mesh, so the ring is meshed first.)
  // The fixed member follows the carrier backwards in the carrier's frame, so it stands still.
  if(carrierHinge)s.meshGears(carrierHinge,l.fixed==='ring'?ringHinge:sunHinge,-1);
  s.meshGears(ringHinge,planetHinges[0],l.ring/l.planet);
  for(const hinge of planetHinges)s.meshGears(hinge,sunHinge,-l.planet/l.sun);
  s.groupBodies(t('Planetary gear set'),[...(frame?[frame]:[]),plate,sun,...planets,ring]);
  s.setExplodedView({id:newId(),name:t('Exploded view'),steps:[
   {id:newId(),bodies:[ring],direction:[0,0,1],distance:3*l.width+10},
   {id:newId(),bodies:planets,direction:[0,0,1],distance:2*l.width+5},
   {id:newId(),bodies:[sun],direction:[0,0,1],distance:l.width+2},
  ]});
  const doc=structuredClone(s.state.document);doc.title=t('Planetary gear set');return doc;
 }finally{s.dispose();}
}
