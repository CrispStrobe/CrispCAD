// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
export interface GeneratorRecipe {version:1;preset:'screw'|'thread'|'nut'|'heart'|'text'|'name-tag';values:Record<string,number>;text?:string;font?:'block'|'sans'|'serif'|'mono'}
export interface GeneratorField {key:string;label:string;value:number;min:number;max:number;step:number}
export function generatorFields(preset:string):GeneratorField[]{
 const field=(key:string,label:string,value:number,min:number,max:number,step=.1)=>({key,label,value,min,max,step});
 if(['screw','thread','nut'].includes(preset))return [field('diameter','Core diameter (mm)',10,2,80),field('length',preset==='nut'?'Nut height (mm)':'Thread length (mm)',preset==='nut'?8:20,1,200),field('pitch','Thread pitch (mm)',2,.5,10),field('threadDepth','Thread depth (mm)',1,.2,5),field('starts','Thread starts',1,1,2,1),field('hand','Handedness',1,-1,1,2),...(preset==='screw'?[field('headDiameter','Head diameter (mm)',18,3,120),field('headHeight','Head height (mm)',5,1,30),field('slotWidth','Drive slot width (mm)',2,.5,10)]:preset==='nut'?[field('clearance','Radial clearance (mm)',.25,.05,1)]:[])];
 if(preset==='text'||preset==='name-tag')return [field('textHeight','Text height (mm)',9,3,40),field('textDepth','Raised text depth (mm)',2,.5,8),...(preset==='name-tag'?[field('baseThickness','Base thickness (mm)',3,1,10),field('cornerRadius','Corner radius (mm)',3,.5,8),field('padding','Text padding (mm)',4,2,12),field('holeRadius','Hanging hole radius (mm)',2,1,5)]:[])];
 if(preset==='heart')return [field('width','Heart width (mm)',34,5,150),field('height','Heart height (mm)',32,5,150),field('thickness','Thickness (mm)',5,1,30),field('roundness','Lobe roundness',1,.6,1.4,.05),field('cleft','Cleft height (mm)',10,2,15,.5),field('bend','Bend angle (°)',0,-90,90,5)];
 return [];
}
export function checkGenerator(value:unknown):GeneratorRecipe {
 const r=value as GeneratorRecipe;if(!r||r.version!==1||!['screw','thread','nut','heart','text','name-tag'].includes(r.preset)||!r.values||typeof r.values!=='object'||Array.isArray(r.values))throw new Error(t('Invalid shape generator'));
 const fields=generatorFields(r.preset);
 if(Object.keys(r.values).length!==fields.length||fields.some(f=>!Object.hasOwn(r.values,f.key)||!Number.isFinite(r.values[f.key])||r.values[f.key]<f.min||r.values[f.key]>f.max))throw new Error(t('Shape parameters exceed their supported range'));
 if(r.preset==='text'||r.preset==='name-tag'){if(typeof r.text!=='string'||!r.text.trim()||[...r.text].length>48||/[\u0000-\u001f]/.test(r.text)||!['block','sans','serif','mono'].includes(r.font??''))throw new Error(t('Enter 1–48 printable characters and choose a supported font'));if(r.font==='block'&&(/[^A-Z0-9 .-]/i.test(r.text)||r.text.length>24))throw new Error(t('The block font supports up to 24 letters A–Z, digits, spaces, dots and hyphens'));}
 else if(r.preset!=='heart'){
  const p=r.values;if(!Number.isInteger(p.starts)||![-1,1].includes(p.hand)||p.length/(p.pitch*p.starts)>16||p.threadDepth>p.diameter/3)throw new Error(t('Thread parameters require 1–2 starts, a valid hand, at most 16 turns, and depth ≤ one third of the core diameter'));
  if(r.preset==='screw'&&(p.headDiameter<=p.diameter+2*p.threadDepth||p.slotWidth>=p.headDiameter*.7))throw new Error(t('The screw head must exceed the thread diameter, and its slot must fit inside the head'));
 }
 else if(Math.abs(r.values.bend)>.001&&r.values.thickness>=Math.abs(r.values.width/(r.values.bend*Math.PI/180))*.7)throw new Error(t('Reduce the heart thickness or bend angle to avoid a folded solid'));
 return r;
}
export function defaultGenerator(preset:string):GeneratorRecipe|undefined {const fields=generatorFields(preset);return fields.length?checkGenerator({version:1,preset,values:Object.fromEntries(fields.map(f=>[f.key,f.value])),...(['text','name-tag'].includes(preset)?{text:'BRICKWRIGHT',font:'sans' as const}:{})}):undefined;}
