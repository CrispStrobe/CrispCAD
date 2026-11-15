// SPDX-License-Identifier: BSD-3-Clause
import * as T from 'three';
import {t} from '@brickwright/cad-core';
export type GridDisplay='snap'|number;
export function displayGridSpacing(display:GridDisplay,snap:number){const value=display==='snap'?snap:display;if(!Number.isFinite(value)||value!==0&&(value<.05||value>400))throw new Error(t('Choose a grid spacing from 0.05 to 400 mm, or Off'));return value;}
export function workplaneGridGeometry(spacing:number,center:string,line:string){const positions:number[]=[],colors:number[]=[],a=new T.Color(center),b=new T.Color(line);if(spacing>0){const count=Math.floor(200/spacing);for(let i=-count;i<=count;i++){const v=i*spacing,c=i===0?a:b;positions.push(-200,v,0,200,v,0,v,-200,0,v,200,0);for(let j=0;j<4;j++)colors.push(c.r,c.g,c.b);}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));return g;}
