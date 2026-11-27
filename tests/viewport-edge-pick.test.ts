// SPDX-License-Identifier: BSD-3-Clause
// Picking B-rep edges in the 3D view: the hit test (nearest edge within the tap radius, never one
// behind the surface the tap meets) and the overlay's projection of edges to the screen.
import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import {createCadSession} from '@brickwright/cad-core';
import type {ExactBodyEdge} from '@brickwright/cad-core';
import {EDGE_PICK_MOUSE_PX,EDGE_PICK_TOUCH_PX,closestOnPolyline,createEdgeOverlay,depthAlong,pickEdgeAt} from '../packages/editor/src/viewport-edge-pick.js';
import type {ProjectedEdge} from '../packages/editor/src/viewport-edge-pick.js';
import {edgesInWorld} from '../packages/editor/src/exact-feature-panel.js';

const edge=(xy:[number,number][],depth:number,pickable=true):ProjectedEdge=>({xy,depth:xy.map(()=>depth),pickable});

describe('edge picking in the 3D view',()=>{
 it('finds the closest point of a polyline',()=>{
  expect(closestOnPolyline([[0,0],[10,0],[10,10]],5,3)).toEqual({distance:3,segment:0,t:.5});
  expect(closestOnPolyline([[0,0],[10,0],[10,10]],12,8).segment).toBe(1);
  expect(closestOnPolyline([[4,4]],7,8).distance).toBe(5);
 });

 it('picks the nearest pickable edge within the tap radius',()=>{
  const edges=[edge([[0,0],[100,0]],10),edge([[0,20],[100,20]],10),edge([[0,8],[100,8]],10,false)];
  expect(pickEdgeAt(edges,50,6,EDGE_PICK_TOUCH_PX)).toBe(0); // the unpickable edge at 8 is nearer
  expect(pickEdgeAt(edges,50,14,EDGE_PICK_TOUCH_PX)).toBe(1);
  expect(pickEdgeAt(edges,50,60,EDGE_PICK_TOUCH_PX)).toBe(-1);
  // A mouse gets a narrower target than a finger.
  expect(pickEdgeAt(edges,50,-15,EDGE_PICK_TOUCH_PX)).toBe(0);
  expect(pickEdgeAt(edges,50,-15,EDGE_PICK_MOUSE_PX)).toBe(-1);
 });

 it('never picks an edge behind the surface the tap meets',()=>{
  // A front edge at depth 50 and a hidden back edge at depth 70 project next to each other.
  const edges=[edge([[0,0],[100,0]],70),edge([[0,6],[100,6]],50)];
  expect(pickEdgeAt(edges,50,1,EDGE_PICK_TOUCH_PX)).toBe(0); // no surface under the tap
  expect(pickEdgeAt(edges,50,1,EDGE_PICK_TOUCH_PX,50,1)).toBe(1); // the face in front hides edge 0
  expect(pickEdgeAt([edges[0]],50,1,EDGE_PICK_TOUCH_PX,50,1)).toBe(-1);
  expect(pickEdgeAt([edges[0]],50,1,EDGE_PICK_TOUCH_PX,69.5,1)).toBe(0); // on the surface, within the slack
 });

 it('takes the depth under the cursor along a receding edge in perspective, so a mouse picks it',()=>{
  // An edge running away from the camera: its screen midpoint is nearer than its world midpoint.
  const camera=new THREE.PerspectiveCamera(40,1,.1,1000);camera.position.set(0,40,60);camera.lookAt(0,0,-20);camera.updateMatrixWorld();
  const overlay=createEdgeOverlay(new THREE.Scene(),[{points:[[0,0,40],[0,0,-80]],pickable:true}]);
  const screen=(p:THREE.Vector3)=>{const v=p.clone().project(camera);return [(v.x+1)*200,(1-v.y)*200];};
  const [x0,y0]=screen(new THREE.Vector3(0,0,40)),[x1,y1]=screen(new THREE.Vector3(0,0,-80)),x=(x0+x1)/2,y=(y0+y1)/2;
  const caster=new THREE.Raycaster();caster.setFromCamera(new THREE.Vector2(x/200-1,1-y/200),camera);
  const {origin,direction}=caster.ray,[projected]=overlay.project(camera,400,400,origin.clone(),direction.clone());
  expect(projected.perspective).toBeDefined();
  // Where the ray meets the edge (the surface under the cursor is there): the true depth.
  const onEdge=new THREE.Vector3();caster.ray.distanceSqToSegment(new THREE.Vector3(0,0,40),new THREE.Vector3(0,0,-80),undefined,onEdge);
  const depth=onEdge.clone().sub(origin).dot(direction),slack=.05;
  const linear=(projected.depth[0]+projected.depth[1])/2;
  expect(linear-depth).toBeGreaterThan(5*slack); // the screen-linear depth would hide it
  const screenT=Math.hypot(x-projected.xy[0][0],y-projected.xy[0][1])/Math.hypot(projected.xy[1][0]-projected.xy[0][0],projected.xy[1][1]-projected.xy[0][1]);
  expect(depthAlong(projected,0,screenT)).toBeCloseTo(depth,3);
  expect(pickEdgeAt([projected],x,y,EDGE_PICK_MOUSE_PX,depth,slack)).toBe(0);
  expect(pickEdgeAt([{...projected,perspective:undefined}],x,y,EDGE_PICK_MOUSE_PX,depth,slack)).toBe(-1);
 });

 it('projects edges to the screen with their depth along the view',()=>{
  const camera=new THREE.PerspectiveCamera(40,2,.1,1000);camera.position.set(0,0,100);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const scene=new THREE.Scene(),overlay=createEdgeOverlay(scene,[{points:[[-10,0,0],[10,0,0]],pickable:true},{points:[[0,-10,-20],[0,10,-20]],pickable:false}]);
  expect(scene.getObjectByName('edge-pick')).toBeDefined();
  const [a,b]=overlay.project(camera,800,400,camera.position.clone(),new THREE.Vector3(0,0,-1));
  expect(a.xy[0][1]).toBeCloseTo(200,6);expect(a.xy[0][0]).toBeLessThan(400);expect(a.xy[1][0]).toBeGreaterThan(400);
  expect(a.depth).toEqual([100,100]);expect(b.depth).toEqual([120,120]);expect(b.pickable).toBe(false);
  expect(pickEdgeAt([a,b],400,200,EDGE_PICK_TOUCH_PX)).toBe(0);
  overlay.paint(new Set([0]));overlay.dispose();
  expect(scene.getObjectByName('edge-pick')).toBeUndefined();
 });

 it('draws the edges of an exact feature\'s source where the feature is',()=>{
  const session=createCadSession();
  const block=session.add({kind:'box',size:[20,30,10]},{name:'Block'}),other=session.add({kind:'box',size:[5,5,5]},{name:'Other'});
  session.combine('union',[block,other]);
  const union=session.state.document.roots.find(id=>session.state.document.nodes[id].kind==='boolean')!;
  session.transform([{id:union,transform:{position:[5,0,0],rotation:[0,0,90],scale:[1,1,1]}}]);
  const doc=session.state.document;
  const listed:ExactBodyEdge[]=[{number:1,curve:'line',length:10,points:[[10,0,0],[10,0,10]]}];
  // A top-level body's edges are already in world coordinates.
  expect(edgesInWorld(doc,union,listed)[0]).toEqual([[10,0,0],[10,0,10]]);
  // An input's edges are in its parent's frame: the union's transform places them.
  const placed=edgesInWorld(doc,block,listed)[0];
  expect(placed[0][0]).toBeCloseTo(5,9);expect(placed[0][1]).toBeCloseTo(10,9);expect(placed[1][2]).toBeCloseTo(10,9);
 });
});
