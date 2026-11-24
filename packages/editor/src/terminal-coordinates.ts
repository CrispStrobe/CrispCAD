// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {Vec3} from '@brickwright/cad-core';

const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export function terminalNumber(text:string):number {
 const value=text.trim();
 if(!decimal.test(value)||!Number.isFinite(Number(value)))throw new Error(t('Enter a finite number.'));
 return Number(value);
}

/** World millimetres, Z up. Polar angles are counterclockwise from +X in XY. */
export function parseTerminalPoint(text:string,base?:Vec3):Vec3 {
 let value=text.trim();
 const relative=value.startsWith('@');
 if(relative){if(!base)throw new Error(t('A relative point needs a previous point.'));value=value.slice(1);}
 else if(value.startsWith('#'))value=value.slice(1);
 let point:Vec3;
 if(value.includes('<')){
  const parts=value.split('<');
  if(parts.length!==2)throw new Error(t('Use distance<angle for a polar point.'));
  const distance=terminalNumber(parts[0]),angle=terminalNumber(parts[1])*Math.PI/180;
  if(distance<0)throw new Error(t('Polar distance must be nonnegative.'));
  point=[distance*Math.cos(angle),distance*Math.sin(angle),0];
 }else{
  const parts=value.split(',');
  if(parts.length!==2&&parts.length!==3)throw new Error(t('Use X,Y or X,Y,Z in millimetres.'));
  point=[terminalNumber(parts[0]),terminalNumber(parts[1]),parts.length===3?terminalNumber(parts[2]):0];
 }
 point=point.map(v=>Math.abs(v)<1e-12?0:v) as Vec3;
 if(relative)point=point.map((v,i)=>v+base![i]) as Vec3;
 if(point.some(v=>!Number.isFinite(v)||Math.abs(v)>100000))throw new Error(t('Coordinates must be within 100000 mm of the origin.'));
 return point.map(v=>Math.abs(v)<1e-12?0:v) as Vec3;
}

/** Quotes keep object names together; commas may contain surrounding whitespace. */
export function terminalArguments(text:string):string[] {
 const result:string[]=[];let token='',quote='',escaped=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(escaped){token+=char;escaped=false;continue;}
  if(quote){if(char==='\\'){escaped=true;continue;}if(char===quote){quote='';continue;}token+=char;continue;}
  if(char==='"'||char==="'"){quote=char;continue;}
  if(/\s/.test(char)){
   const next=text.slice(i).trimStart()[0];
   if(token.endsWith(',')||token.endsWith('<')||next===','||next==='<')continue;
   if(token){result.push(token);token='';}
  }else token+=char;
 }
 if(quote||escaped)throw new Error(t('Close the quoted argument.'));
 if(token)result.push(token);
 return result;
}
