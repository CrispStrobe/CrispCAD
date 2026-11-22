// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession} from '@brickwright/cad-core';
import type {PlanarSketch,SketchProfile} from '@brickwright/cad-core';
import {expect,it} from 'vitest';
import {collectSketchSnaps,nearestSketchSnap,sketchSnapReference} from '../packages/editor/src/sketch-snaps.js';

const sketch=(profile:SketchProfile):PlanarSketch=>({version:1,id:'guide',name:'Guide',plane:'XY',profile});
const document=createCadSession().state.document;
const rectangle=sketch({kind:'rectangle',id:'rectangle',width:40,depth:30});
const circle=sketch({kind:'circle',id:'circle',center:[17.5,15],radius:5,segments:12});

it('picks authored endpoints, midpoints, and circle centers at a bounded distance',()=>{
 const targets=collectSketchSnaps(sketchSnapReference(rectangle,document),sketchSnapReference(circle,document));
 expect(nearestSketchSnap([20.3,-15.2],targets,.5)).toEqual({kind:'Endpoint',point:[20,-15]});
 expect(nearestSketchSnap([.2,15],targets,.5)).toEqual({kind:'Midpoint',point:[0,15]});
 expect(nearestSketchSnap([17.6,15],targets,.5)).toEqual({kind:'Center',point:[17.5,15]});
 expect(nearestSketchSnap([2,15],targets,.5)).toBeUndefined();
});

it('uses analytic intersections of finite entities and never mesh vertices',()=>{
 const targets=collectSketchSnaps(sketchSnapReference(rectangle,document),sketchSnapReference(circle,document));
 expect(nearestSketchSnap([12.8,15.2],targets,.5)).toEqual({kind:'Intersection',point:[12.5,15]});
 expect(nearestSketchSnap([22.5,15],targets,.5)).toBeUndefined();
 const other=sketch({kind:'circle',id:'other',center:[23.5,15],radius:5,segments:12});
 const circles=collectSketchSnaps(sketchSnapReference(circle,document),sketchSnapReference(other,document));
 expect(nearestSketchSnap([20.5,19.1],circles,.5)).toEqual({kind:'Intersection',point:[20.5,19]});
 const shifted=sketch({kind:'outline',id:'shifted',points:[[10,10],[30,10],[30,20],[10,20]]});
 const lines=collectSketchSnaps(sketchSnapReference(rectangle,document),sketchSnapReference(shifted,document));
 expect(nearestSketchSnap([20.2,10.1],lines,.5)).toEqual({kind:'Intersection',point:[20,10]});
});

it('respects the direction of an authored arc when resolving its midpoint and intersections',()=>{
 const arc=sketch({kind:'outline',id:'arc',points:[[0,0],[10,0],[10,10],[0,10]],bulges:[1,0,0,0]});
 const band=sketch({kind:'outline',id:'band',points:[[4,-7],[6,-7],[6,7],[4,7]]});
 const targets=collectSketchSnaps(sketchSnapReference(arc,document),sketchSnapReference(band,document));
 const mid=nearestSketchSnap([5,-5],targets,.2);
 expect(mid?.kind).toBe('Midpoint');
 expect(mid?.point[1]).toBeCloseTo(-5);
 expect(nearestSketchSnap([4,-Math.sqrt(24)],targets,.1)?.kind).toBe('Intersection');
 expect(nearestSketchSnap([4,Math.sqrt(24)],targets,.1)).toBeUndefined();
});
