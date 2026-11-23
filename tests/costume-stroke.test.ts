// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {Vector2} from 'three';
import {sketchOutline} from '@brickwright/cad-core';
import type {SketchPoint} from '@brickwright/cad-core';
import {expandCostumeStroke} from '../packages/editor/src/costume-stroke.js';
import type {CostumeStroke} from '../packages/editor/src/costume-stroke.js';

const vectors=(points:SketchPoint[])=>points.map(([x,y])=>new Vector2(x,y));
const style:CostumeStroke={width:4,cap:'butt',join:'miter',miterLimit:4};
const area=(loop:Vector2[])=>Math.abs(loop.reduce((sum,point,index)=>sum+point.cross(loop[(index+1)%loop.length]),0)/2);

it.each([['butt',10,40],['square',14,56],['round',14,52.25]] as const)(
 'expands an open segment with %s caps', (cap,span,expectedArea)=>{
  const [loop]=expandCostumeStroke(vectors([[0,0],[10,0]]),false,{...style,cap});
  sketchOutline(loop.map(({x,y})=>[x,y]));
  expect(Math.max(...loop.map(p=>p.x))-Math.min(...loop.map(p=>p.x))).toBe(span);
  expect(area(loop)).toBeCloseTo(expectedArea,1);
 });

it('preserves the hole in a closed rectangle, and rejects an inward offset that has collapsed',()=>{
 const points=vectors([[0,0],[10,0],[10,10],[0,10]]);
 expect(expandCostumeStroke(points,true,style).map(area)).toEqual([196,36]);
 expect(expandCostumeStroke([...points].reverse(),true,style).map(area)).toEqual([196,36]);
 expect(()=>expandCostumeStroke(points,true,{...style,width:14})).toThrow(/too wide/);
});

it('bevels an outer miter over its limit and keeps the inside join',()=>{
 const points=vectors([[0,0],[10,0],[10,10]]);
 const [miter]=expandCostumeStroke(points,false,style);
 const [bevel]=expandCostumeStroke(points,false,{...style,miterLimit:1});
 expect(miter.some(p=>p.x===12&&p.y===-2)).toBe(true);
 expect(bevel.some(p=>p.x===12&&p.y===-2)).toBe(false);
 expect(bevel.some(p=>p.x===8&&p.y===2)).toBe(true);
});
