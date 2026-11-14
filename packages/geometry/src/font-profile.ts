// SPDX-License-Identifier: BSD-3-Clause
// Original decoder for bundled Apache-2.0 typeface outlines. No system font access.
import sans from './fonts/droid_sans_regular.typeface.json' with {type:'json'};
import serif from './fonts/droid_serif_regular.typeface.json' with {type:'json'};
import mono from './fonts/droid_sans_mono_regular.typeface.json' with {type:'json'};
import {GeometryResourceLimitError} from './limits.js';
import {t} from '@brickwright/cad-core';
import type {CodeProfile} from '@brickwright/cad-core';
type Point=[number,number];
interface Typeface{resolution:number;glyphs:Record<string,{ha:number;o?:string}>}
const fonts:Record<string,Typeface>={sans,serif,mono};
/** A detached copy for hosts that render the same bundled lettering. */
export const getBundledFontData=(font:'sans'|'serif'|'mono')=>structuredClone(fonts[font]);
export function textProfileContours(p:Extract<CodeProfile,{kind:'text'}>):Point[][][]{
 const font=fonts[p.font],scale=p.size/font.resolution,glyphs:Point[][][]=[],all:Point[]=[];let offset=0;
 for(const character of [...p.text]){const glyph=font.glyphs[character];if(!glyph)throw new Error(t`The selected font has no glyph for “${character}”`);const contours:Point[][]=[];let contour:Point[]=[],last:Point=[0,0];const tokens=glyph.o?.trim().split(/\s+/)??[];let cursor=0;
  const coordinate=():Point=>[Number(tokens[cursor++])*scale+offset,Number(tokens[cursor++])*scale];
  const point=(v:Point)=>{contour.push(v);last=v;};
  const close=()=>{if(contour.length>1&&Math.hypot(contour[0][0]-contour.at(-1)![0],contour[0][1]-contour.at(-1)![1])<1e-9)contour.pop();if(contour.length>=3){if(all.length+contour.length>16384)throw new GeometryResourceLimitError(t('Evaluated profile exceeds 16384 vertices'));contours.push(contour);all.push(...contour);}contour=[];};
  while(cursor<tokens.length){const command=tokens[cursor++];if(command==='m'){close();point(coordinate());}else if(command==='l')point(coordinate());else if(command==='q'||command==='b'){const end=coordinate(),c1=coordinate(),c2=command==='b'?coordinate():undefined,start=last;for(let i=1;i<=p.curveSteps;i++){const u=i/p.curveSteps,v=1-u;point(command==='q'?[v*v*start[0]+2*v*u*c1[0]+u*u*end[0],v*v*start[1]+2*v*u*c1[1]+u*u*end[1]]:[v**3*start[0]+3*v*v*u*c1[0]+3*v*u*u*c2![0]+u**3*end[0],v**3*start[1]+3*v*v*u*c1[1]+3*v*u*u*c2![1]+u**3*end[1]]);}}else throw new Error(t('Unsupported bundled font outline'));}
  close();if(contours.length)glyphs.push(contours);offset+=glyph.ha*scale*p.spacing;
 }
 if(!all.length)return [];const min=[Math.min(...all.map(v=>v[0])),Math.min(...all.map(v=>v[1]))],max=[Math.max(...all.map(v=>v[0])),Math.max(...all.map(v=>v[1]))];
 const dx=p.halign==='center'?-(min[0]+max[0])/2:p.halign==='right'?-max[0]:-min[0],dy=p.valign==='top'?-max[1]:p.valign==='center'?-(min[1]+max[1])/2:p.valign==='bottom'?-min[1]:0;
 return glyphs.map(contours=>contours.map(contour=>contour.map(([x,y])=>[x+dx,y+dy])));
}
