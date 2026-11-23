// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {createCadSession} from '@brickwright/cad-core';
import type {SketchProfile} from '@brickwright/cad-core';
import {artworkSketchTargets,prepareArtworkSketchRefresh} from '../packages/editor/src/costume-refresh.js';

const outline=(width:number):SketchProfile=>({kind:'outline',id:'outline',points:[[0,0],[width,0],[width,10],[0,10]]});
const fixture=()=>{
 const session=createCadSession();
 const id=session.addSketch(outline(20),{name:'Artwork',plane:'YZ'});
 const solid=session.extrudeSketch(id,{distance:6});
 return {session,id,solid};
};

it('previews a replacement without changing history and applies it to the same sketch and solid',async()=>{
 const {session,id,solid}=fixture();
 const before=session.state;
 expect(artworkSketchTargets(before.document,'outline')).toMatchObject([{id,plane:'YZ',size:[20,10]}]);
 const review=await prepareArtworkSketchRefresh(session,async draft=>{
  expect(draft.sketches![id].profile).toEqual(outline(30));
  expect(draft.nodes[solid]).toEqual(before.document.nodes[solid]);
 },id,outline(30));
 expect(review.affectedBodies).toEqual([before.document.nodes[solid].name]);
 expect(review.before).not.toEqual(review.after);
 expect(session.state.document).toBe(before.document);
 review.apply();
 expect(session.state.document.sketches![id]).toMatchObject({id,plane:'YZ',profile:outline(30)});
 expect(session.state.document.nodes[solid]).toEqual(before.document.nodes[solid]);
 expect(session.state.revision).toBe(before.revision+1);
 session.undo();
 expect(session.state.document.sketches![id].profile).toEqual(outline(20));
});

it('keeps the design untouched on a geometry error and rejects confirmation after another edit',async()=>{
 const {session,id}=fixture();
 const before=session.state;
 await expect(prepareArtworkSketchRefresh(session,async()=>{throw Error('kernel refused');},id,outline(30)))
  .rejects.toThrow('kernel refused');
 expect(session.state.document).toBe(before.document);
 const review=await prepareArtworkSketchRefresh(session,async()=>{},id,outline(30));
 session.updateSketch(id,{name:'Renamed'});
 expect(()=>review.apply()).toThrow(/Preview the sketch update again/);
 expect(session.state.document.sketches![id].profile).toEqual(outline(20));
});

it('refuses to overwrite a constrained path or to switch its profile kind',async()=>{
 const {session}=fixture();
 const id=session.addSketch({kind:'path',id:'p',points:[[0,0],[10,0]],vertexIds:['a','b'],anchors:[{vertexId:'a',x:0,y:0}]});
 await expect(prepareArtworkSketchRefresh(session,async()=>{},id,{kind:'path',id:'new',points:[[0,0],[20,0]]}))
  .rejects.toThrow(/has constraints/);
 await expect(prepareArtworkSketchRefresh(session,async()=>{},id,outline(40))).rejects.toThrow(/same sketch type/);
});

it('binds a sketch in the same Undo step and refuses refreshes from a different source',async()=>{
 const {session,id}=fixture();
 const sourceId='12345678-1234-4234-8234-123456789abc';
 const before=session.state.document;
 const review=await prepareArtworkSketchRefresh(session,async()=>{},id,outline(30),undefined,{sourceId,link:true});
 expect(session.state.document).toBe(before);
 review.apply();
 expect(session.state.document.version).toBe(39);
 expect(session.state.document.sketches![id].artworkSourceId).toBe(sourceId);
 const reopened=createCadSession(JSON.parse(session.serialize()));
 expect(artworkSketchTargets(reopened.state.document,'outline')[0].artworkSourceId).toBe(sourceId);
 await expect(prepareArtworkSketchRefresh(reopened,async()=>{},id,outline(40))).rejects.toThrow(/different artwork/);
 (await prepareArtworkSketchRefresh(reopened,async()=>{},id,outline(40),undefined,{sourceId})).apply();
 expect(reopened.state.document.sketches![id].artworkSourceId).toBe(sourceId);
 session.undo();
 expect(session.state.document.sketches![id].artworkSourceId).toBeUndefined();
});


it('serializes a per-region link, preserves it on ordinary edits, and updates it only on Apply',async()=>{
 const session=createCadSession();
 const sourceId='12345678-1234-4234-8234-123456789abc';
 const artworkProfile={mode:'fill',signature:'25:10:20',sourceKey:'svg:panel',toleranceMm:.2} as const;
 const id=session.addSketch(outline(20),{artworkSourceId:sourceId,artworkProfile});
 expect(session.state.document.version).toBe(40);
 const reopened=createCadSession(JSON.parse(session.serialize()));
 reopened.updateSketch(id,{name:'Renamed'});
 expect(artworkSketchTargets(reopened.state.document)[0]).toMatchObject({id,kind:'outline',artworkProfile});
 const changed={...artworkProfile,signature:'38:11:22'};
 const review=await prepareArtworkSketchRefresh(reopened,async draft=>{
  expect(draft.sketches![id].artworkProfile).toEqual(changed);
 },id,outline(30),undefined,{sourceId,profile:changed});
 expect(reopened.state.document.sketches![id].artworkProfile).toEqual(artworkProfile);
 review.apply();
 expect(reopened.state.document.sketches![id].artworkProfile).toEqual(changed);
 reopened.undo();
 expect(reopened.state.document.sketches![id].artworkProfile).toEqual(artworkProfile);
 const missingOwner=JSON.parse(reopened.serialize());
 delete missingOwner.sketches[id].artworkSourceId;
 expect(()=>createCadSession(missingOwner)).toThrow(/Invalid sketch artwork link/);
 const oldVersion=JSON.parse(reopened.serialize());
 oldVersion.version=39;
 expect(()=>createCadSession(oldVersion)).toThrow(/Invalid sketch artwork link/);
});
