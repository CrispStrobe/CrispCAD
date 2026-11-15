// SPDX-License-Identifier: BSD-3-Clause
import {checkGenerator,screwTipParameters} from './generators.js';import type {GeneratorRecipe} from './generators.js';import {t} from './i18n.js';
export interface ScrewRedesign {diameter?:number;length?:number;pitch?:number;turnsPerStart?:number}
/** Bake a resized screw into a circular design. Default pitch stays nominal;
 * XY's area-equivalent diameter is displayed explicitly before GUI acceptance. */
export function redesignScrew(recipe:GeneratorRecipe,scale:readonly number[],request:ScrewRedesign={}):GeneratorRecipe {
 const original=checkGenerator(recipe);if(original.preset!=='screw')throw new Error(t('Select a screw with retained parameters'));
 if(scale.length!==3||scale.some(v=>!Number.isFinite(v)||v<=0)||Object.values(request).filter(v=>v!==undefined).some(v=>!Number.isFinite(v)||v!<=0)||request.pitch!==undefined&&request.turnsPerStart!==undefined)throw new Error(t('Choose a positive diameter, length and either pitch or turns'));
 const next=structuredClone(original),p=next.values,old=original.values,major=old.diameter+2*old.threadDepth,diameter=request.diameter??major*Math.sqrt(scale[0]*scale[1]),length=request.length??old.length*scale[2],pitch=request.pitch??(request.turnsPerStart===undefined?old.pitch:length/(request.turnsPerStart*old.starts)),radial=diameter/major,axial=scale[2];
 // Preserve legacy direction while using the explicit head/flank contract.
 if(next.version===1){next.version=2;next.headStyle='cylindrical';next.driveStyle='slot';next.driveDepth=old.headHeight*.3;next.headAngle=90;next.threadAngle=60;next.orientation='legacy';}
 p.pitch=pitch;p.length=length;p.threadDepth=old.threadDepth*pitch/old.pitch;p.diameter=diameter-2*p.threadDepth;p.headDiameter=old.headDiameter*radial;p.headHeight=old.headHeight*axial;p.slotWidth=old.slotWidth*radial;
 next.rootOverlap=Math.min(.3,pitch*.15);
 next.driveDepth!*=next.headStyle==='countersunk'?radial:axial;
 const tip=screwTipParameters(original);next.tipStyle=original.tipStyle??'flat';next.tipLength=next.tipStyle==='flat'?Math.min(tip.length*axial,length*.5):tip.length*axial;next.tipDiameter=tip.diameter*radial;next.cupDepth=tip.depth*axial;
 return checkGenerator(next);
}
