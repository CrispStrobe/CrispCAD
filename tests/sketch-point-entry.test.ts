// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {formatSketchPoints,parseSketchOutline,parseSketchPoint,sketchDraggedBulge} from '../packages/editor/src/sketch-point-entry.js';

it('resolves relative outline points and preserves signed arc bulges',()=>{
 const outline=parseSketchOutline(['5, 10','@40, 0, -0.5','@-10, 30','5, 40']);
 expect(outline).toEqual({points:[[5,10],[45,10],[35,40],[5,40]],bulges:[0,-0.5,0,0]});
 expect(parseSketchOutline(formatSketchPoints(outline.points,outline.bulges))).toEqual(outline);
});

it('keeps an absolute origin for each loop and rejects malformed coordinates',()=>{
 expect(()=>parseSketchOutline(['@1, 2','0,0','2,0'])).toThrow('first point as absolute');
 expect(()=>parseSketchPoint('@1, 2')).toThrow('Enter coordinates');
 expect(()=>parseSketchOutline(['1, 2, Infinity'])).toThrow('finite bulge');
 expect(()=>parseSketchOutline(['1e400, 2'])).toThrow('Enter coordinates');
 expect(()=>parseSketchOutline(Array(257).fill('0,0'))).toThrow('3–256');
});

it('applies a signed sagitta drag perpendicular to the chord with grid snapping',()=>{
 expect(sketchDraggedBulge([0,0],[40,0],0,[8,-10],1)).toBe(.5);
 expect(sketchDraggedBulge([0,0],[40,0],.5,[0,10],1)).toBe(0);
 expect(sketchDraggedBulge([0,0],[0,40],0,[-10,10],1)).toBe(-.5);
 expect(sketchDraggedBulge([0,0],[40,0],0,[0,-4.4],1)).toBe(.2);
 expect(sketchDraggedBulge([0,0],[40,0],0,[0,-4.4],0)).toBe(.22);
});
