// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {createCadSession,parseDocument,validateDocument,evaluateSketch,designGraph,resolveSketchPath,sketchBulgeArc,trimSketchProfile,compileModelSource,generateModelSource} from '@brickwright/cad-core';
import {sketchSnapReference} from '../packages/editor/src/sketch-snaps.js';
import {readSketchPathDxf} from '../packages/editor/src/import-sketch-dxf.js';
import {exportSketchPathDxf} from '../packages/editor/src/sketch-dxf.js';
import type {SketchProfile,PlanarSketch} from '@brickwright/cad-core';

const profile:Extract<SketchProfile,{kind:'path'}>={kind:'path',id:'profile',points:[[0,0],[10,0],[10,8],[0,8]],bulges:[1,0,0,0]};
const sketch:PlanarSketch={version:1,id:'path',name:'Open guide',plane:'XY',profile};

it('retains open paths through serialization and model source while preventing solid generation',()=>{
 const session=createCadSession(),id=session.addSketch(profile,{name:'Guide'});
 expect(session.state.document.version).toBe(15);
 expect(session.state.document.roots).toEqual([]);
 expect(parseDocument(session.serialize())).toEqual(session.state.document);
 const document=session.state.document;
 expect(compileModelSource(generateModelSource(document),document).sketches[id]).toEqual(document.sketches![id]);
 expect(()=>validateDocument({...document,version:14})).toThrow('version 15');
 expect(()=>session.extrudeSketch(id)).toThrow('Close the sketch path');
 expect(()=>session.revolveSketch(id,{angle:360})).toThrow('Close the sketch path');
 expect(session.state.document).toBe(document);
});

it('trims a continuous path without closing it and retains the analytic radius',()=>{
 const trimmed=trimSketchProfile(sketch,{},[5,7],[5,-4],'left');
 if(trimmed.kind!=='path'||!trimmed.bulges)throw Error('fixture');
 expect(trimmed.points.slice(1)).toEqual([[10,0],[10,8],[5,8]]);
 expect(trimmed.points[0][0]).toBeCloseTo(5);
 expect(trimmed.points[0][1]).toBeCloseTo(-5);
 expect(trimmed.bulges.at(-1)).toBe(0);
 const arc=sketchBulgeArc(trimmed.points[0],trimmed.points[1],trimmed.bulges[0])!;
 expect(arc.radius).toBeCloseTo(5);
 expect(arc.center[0]).toBeCloseTo(5);
 expect(arc.center[1]).toBeCloseTo(0);
 const noGap={...sketch,profile:{kind:'path',id:'p',points:[[0,0],[10,1],[0,3],[10,4]]}} as PlanarSketch;
 expect(()=>trimSketchProfile(noGap,{},[5,-1],[5,5],'left')).toThrow('separate paths');
});

it('closes a path with stable sketch and profile IDs and restores it on Undo',()=>{
 const session=createCadSession(),id=session.addSketch(profile,{name:'Guide'});
 const before=session.serialize();
 session.closeSketchPath(id,profile,{name:'Closed guide',plane:'XY'});
 expect(session.state.document.sketches?.[id]).toMatchObject({name:'Closed guide',profile:{kind:'outline',id:'profile'}});
 const solid=session.extrudeSketch(id);
 expect(session.state.document.nodes[solid]).toMatchObject({kind:'extrusion',sketchId:id});
 session.undo();session.undo();
 expect(session.serialize()).toBe(before);
 session.removeSketchPath(id);
 expect(session.state.document.sketches?.[id]).toBeUndefined();
 session.undo();
 expect(session.serialize()).toBe(before);
});

it('exposes authored path vertices and arcs as guides without a closing segment',()=>{
 const reference=sketchSnapReference(sketch,createCadSession().state.document);
 expect(reference.contours).toEqual([]);
 expect(reference.openPath?.at(-1)).toEqual([0,8]);
 expect(reference.edges.map(edge=>edge.kind)).toEqual(['circle','line','line']);
 expect(reference.points).toContainEqual({kind:'Endpoint',point:[0,8]});
 expect(evaluateSketch(sketch,{}).edgeIds).toEqual(['profile:edge-0','profile:edge-1','profile:edge-2']);
 const invalid={...sketch,profile:{...profile,bulges:[1,0,0,.5]}};
 expect(()=>evaluateSketch(invalid,{})).toThrow('last point');
});

it('persists named point locks and regenerates snapping and DXF using current parameters',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{width:{expression:'24',unit:'mm'}},bindings:[]});
 const id=session.addSketch(profile,{name:'Anchored guide'});
 const locked={...profile,vertexIds:['a','b','c','d'],anchors:[{vertexId:'b',x:'width / 2',y:3}]};
 session.updateSketch(id,{profile:locked});
 const document=session.state.document;
 expect(document.version).toBe(16);
 expect(parseDocument(session.serialize())).toEqual(document);
 expect(compileModelSource(generateModelSource(document),document).sketches[id].profile).toEqual(locked);
 expect(designGraph(document).find(entry=>entry.key===`sketch:${id}`)?.dependencies).toEqual(['parameter:width']);
 expect(()=>validateDocument({...document,version:15})).toThrow('version 16');
 const design=structuredClone(document.parametric!);
 design.parameters.width.expression='32';
 session.setParametric(design);
 const current=session.state.document,saved=current.sketches![id];
 expect(sketchSnapReference(saved,current).points).toContainEqual({kind:'Endpoint',point:[16,3]});
 expect(readSketchPathDxf(new TextDecoder().decode(exportSketchPathDxf(current,saved).bytes)).points[1]).toEqual([16,3]);
 session.closeSketchPath(id,locked,{name:'Anchored guide',plane:'XY'});
 const closed=session.state.document.sketches![id].profile;
 expect(closed).toMatchObject({kind:'outline',points:[[0,0],[16,3],[10,8],[0,8]]});
 expect(closed).not.toHaveProperty('anchors');
 session.undo();
 expect(session.state.document.sketches![id].profile).toEqual(locked);

 const invalid={...locked,anchors:[{vertexId:'b',x:0,y:0}]};
 expect(()=>session.updateSketch(id,{profile:invalid})).toThrow('Consecutive');
 expect(()=>session.updateSketch(id,{profile:{...locked,anchors:[...locked.anchors,...locked.anchors]}})).toThrow('Invalid path point locks');
 expect(session.state.document).toBe(current);
});

it('retains surviving locks across trim and drops locks on removed vertices',()=>{
 const locked:typeof profile={...profile,bulges:undefined,vertexIds:['a','b','c','d'],
  anchors:[{vertexId:'a',x:0,y:0},{vertexId:'b',x:12,y:0}]};
 const first=trimSketchProfile({...sketch,profile:locked},{},[5,8],[5,-2],'left');
 if(first.kind!=='path')throw Error('fixture');
 expect(first.anchors).toEqual([{vertexId:'b',x:12,y:0}]);
 expect(first.vertexIds?.slice(1,3)).toEqual(['b','c']);
 expect(first.points).toEqual([[5,0],[10,0],[10,8],[5,8]]);
 expect(resolveSketchPath(first,{})[1]).toEqual([12,0]);
 const second=trimSketchProfile({...sketch,profile:first},{},[0,4],[20,4],'left');
 expect(second).not.toHaveProperty('anchors');
 expect(second).not.toHaveProperty('vertexIds');
});
