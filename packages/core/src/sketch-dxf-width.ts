// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';

export type DxfSegmentWidth=[number,number];
export type SketchDxfWidths={dxfWidths?:DxfSegmentWidth[]};
const width=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100000;
export const isDxfSegmentWidth=(value:unknown):value is DxfSegmentWidth=>
 Array.isArray(value)&&value.length===2&&width(value[0])&&width(value[1]);

export function checkSketchDxfWidths(profile:SketchDxfWidths&{points:unknown[]},closed:boolean){
 const {dxfWidths,points}=profile;
 if(dxfWidths===undefined)return;
 if(!Array.isArray(points)||!Array.isArray(dxfWidths)||dxfWidths.length!==points.length||
  !Array.from(dxfWidths).every(isDxfSegmentWidth)||(!closed&&dxfWidths.at(-1)?.some(Boolean))){
  throw new Error(t('DXF widths must be between 0 and 100000 mm. The final point of an open path has no width.'));
 }
}

/** DXF can encode an identical width on every active segment with one value. */
export function constantDxfWidth(widths:DxfSegmentWidth[],closed:boolean){
 const first=widths[0]?.[0];
 const active=closed?widths:widths.slice(0,-1);
 return first&&active.every(([a,b])=>a===first&&b===first)?first:undefined;
}
