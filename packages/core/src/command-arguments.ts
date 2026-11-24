// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import type {Vec3} from './document.js';

const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export function commandNumber(text:string):number {
 const value=text.trim();
 if(!decimal.test(value)||!Number.isFinite(Number(value)))throw new Error(t('Enter a finite number.'));
 return Number(value);
}

/** World millimetres, Z up. Polar angles are counterclockwise from +X in XY. */
export function parseCommandPoint(text:string,base?:Vec3):Vec3 {
 let value=text.trim();
 const relative=value.startsWith('@');
 if(relative){if(!base)throw new Error(t('A relative point needs a previous point.'));value=value.slice(1);}
 else if(value.startsWith('#'))value=value.slice(1);
 let point:Vec3;
 if(value.includes('<')){
  const parts=value.split('<');
  if(parts.length!==2)throw new Error(t('Use distance<angle for a polar point.'));
  const distance=commandNumber(parts[0]),angle=commandNumber(parts[1])*Math.PI/180;
  if(distance<0)throw new Error(t('Polar distance must be nonnegative.'));
  point=[distance*Math.cos(angle),distance*Math.sin(angle),0];
 }else{
  const parts=value.split(',');
  if(parts.length!==2&&parts.length!==3)throw new Error(t('Use X,Y or X,Y,Z in millimetres.'));
  point=[commandNumber(parts[0]),commandNumber(parts[1]),parts.length===3?commandNumber(parts[2]):0];
 }
 point=point.map(v=>Math.abs(v)<1e-12?0:v) as Vec3;
 if(relative)point=point.map((v,i)=>v+base![i]) as Vec3;
 if(point.some(v=>!Number.isFinite(v)||Math.abs(v)>100000))throw new Error(t('Coordinates must be within 100000 mm of the origin.'));
 return point.map(v=>Math.abs(v)<1e-12?0:v) as Vec3;
}

export interface CommandToken {value:string;start:number;end:number;quoted:boolean}

/** Retain quoting and source spans so completion and keyword parsing agree. */
export function commandTokens(text:string,allowIncomplete=false):CommandToken[] {
 const result:CommandToken[]=[];let token='',quote='',escaped=false,start=-1,quoted=false;
 const finish=(end:number)=>{if(start>=0)result.push({value:token,start,end,quoted});token='';start=-1;quoted=false;};
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(escaped){token+=char;escaped=false;continue;}
  if(quote){if(char==='\\'){escaped=true;continue;}if(char===quote){quote='';continue;}token+=char;continue;}
  if(char==='"'||char==="'"){if(start<0)start=i;quote=char;quoted=true;continue;}
  if(/\s/.test(char)){
   const next=text.slice(i).trimStart()[0];
   if(start>=0&&!quoted&&(token.endsWith(',')||token.endsWith('<')||next===','||next==='<'))continue;
   finish(i);
  }else{if(start<0)start=i;token+=char;}
 }
 if((quote||escaped)&&!allowIncomplete)throw new Error(t('Close the quoted argument.'));
 if(escaped)token+='\\';
 finish(text.length);
 return result;
}

/** Quotes keep object names together; commas may contain surrounding whitespace. */
export function commandArguments(text:string):string[] {return commandTokens(text).map(token=>token.value);}
