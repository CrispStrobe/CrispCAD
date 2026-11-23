// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';

export type SketchDxfLinetype={name:string; pattern:number[]};
export type SketchDxfLayerStyle={
 color?:number; trueColor?:number; flags?:number; plot?:boolean; lineweight?:number;
 linetype?:SketchDxfLinetype;
};
export type SketchDxfLayer={dxfLayer?:string; dxfLayerStyle?:SketchDxfLayerStyle};

export function isSketchDxfLayer(value:unknown):value is string{
 return typeof value==='string'&&value.length>0&&value.length<=255&&value===value.trim()&&
  !/[\u0000-\u001f\u007f<>/\\":;?*|=]/.test(value);
}

const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value:unknown,min:number,max:number):value is number=>
 typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max;
const lineweights=new Set([-3,-2,-1,0,5,9,13,15,18,20,25,30,35,40,50,53,60,70,80,90,100,106,120,140,158,200,211]);
export const isDxfLineweight=(value:unknown):value is number=>typeof value==='number'&&lineweights.has(value);
export const isDxfLinetype=(value:unknown):value is SketchDxfLinetype=>record(value)&&
 isSketchDxfLayer(value.name)&&!['BYLAYER','BYBLOCK','CONTINUOUS'].includes(value.name.toUpperCase())&&
 Array.isArray(value.pattern)&&value.pattern.length>0&&value.pattern.length<=256&&
 Array.from(value.pattern).every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e6)&&
 value.pattern.some(n=>n!==0);

export function checkSketchDxfLayer({dxfLayer,dxfLayerStyle:style}:SketchDxfLayer){
 if(dxfLayer!==undefined&&!isSketchDxfLayer(dxfLayer))throw new Error(t('Invalid DXF layer name.'));
 if(style!==undefined&&(!record(style)||
  style.color!==undefined&&(!integer(style.color,-255,255)||style.color===0)||
  style.trueColor!==undefined&&!integer(style.trueColor,0,0xffffff)||
  style.flags!==undefined&&!integer(style.flags,0,7)||
  style.plot!==undefined&&typeof style.plot!=='boolean'||
  style.lineweight!==undefined&&!isDxfLineweight(style.lineweight)||
  style.linetype!==undefined&&!isDxfLinetype(style.linetype)))throw new Error(t('Invalid DXF layer style.'));
}

export function sketchDxfLayerFields(source?:SketchDxfLayer):SketchDxfLayer{
 const {dxfLayer,dxfLayerStyle}=source??{};
 return {...(dxfLayer===undefined?{}:{dxfLayer}),...(dxfLayerStyle===undefined?{}:{dxfLayerStyle})};
}
