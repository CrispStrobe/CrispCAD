// SPDX-License-Identifier: BSD-3-Clause
import {constructionInputs,createCadSession,evaluateSketch,sketchDxfLayerFields,t} from '@brickwright/cad-core';
import type {CadDocument,CadSession,PlanarSketch,SketchLoop,SketchPoint,SketchProfile} from '@brickwright/cad-core';

function replacement(before:SketchLoop,incoming:SketchLoop):SketchLoop;
function replacement(before:SketchProfile,incoming:SketchProfile):SketchProfile;
function replacement(before:SketchProfile|SketchLoop,incoming:SketchProfile|SketchLoop):SketchProfile|SketchLoop {
 if(before.kind!==incoming.kind||before.kind==='rectangle')
  throw new Error(t('Choose an artwork profile of the same sketch type.'));
 if(before.kind==='region'&&incoming.kind==='region'){
  if(before.placements?.length||before.edgeMatches?.length)
   throw new Error(t('This sketch has constraints. Add the artwork as a new sketch.'));
  if(before.loops.length!==incoming.loops.length)throw new Error(t('The number of outline and hole loops must match.'));
  const loops=before.loops.map((loop,index)=>replacement(loop,incoming.loops[index]));
  return {...incoming,id:before.id,loops};
 }
 if(before.kind==='outline'&&(before.relations?.length||before.dxfWidths)||
    before.kind==='path'&&(before.anchors?.length||before.segmentConstraints?.length||before.dxfWidths)||
    before.kind==='circle'&&(typeof before.radius!=='number'||before.center?.some(axis=>typeof axis!=='number')))
  throw new Error(t('This sketch has constraints. Add the artwork as a new sketch.'));
 return {...incoming,id:before.id,...(before.kind==='region'?{}:sketchDxfLayerFields(before))};
}

function dependentBodies(document:CadDocument,sketchId:string):Set<string> {
 const uses=new Set(Object.values(document.nodes).filter(node=>
  'sketchId' in node&&node.sketchId===sketchId).map(node=>node.id));
 const byInput=new Map<string,string[]>();
 for(const node of Object.values(document.nodes))for(const input of constructionInputs(node)){
  const dependents=byInput.get(input)??[];dependents.push(node.id);byInput.set(input,dependents);
 }
 for(const id of uses)for(const dependent of byInput.get(id)??[])uses.add(dependent);
 return uses;
}

function contours(document:CadDocument,sketch:PlanarSketch):SketchPoint[][]{
 const result=evaluateSketch(sketch,document);
 return [result.contour,...(result.holes??[])];
}

function sketchBounds(contours:SketchPoint[][]){
 const vertices=contours.flat(),xs=vertices.map(([x])=>x),ys=vertices.map(([,y])=>y);
 const min:SketchPoint=[Math.min(...xs),Math.min(...ys)],max:SketchPoint=[Math.max(...xs),Math.max(...ys)];
 return {min,max,size:[max[0]-min[0],max[1]-min[1]] as SketchPoint};
}

export function artworkSketchTargets(document:CadDocument,kind:SketchProfile['kind']){
 return Object.values(document.sketches??{}).filter(sketch=>sketch.profile.kind===kind).map(sketch=>({
  id:sketch.id,name:sketch.name,plane:sketch.plane,artworkSourceId:sketch.artworkSourceId,...sketchBounds(contours(document,sketch)),
 }));
}

/** Evaluate the copy before publishing anything. The returned confirmation is bound to this revision. */
export async function prepareArtworkSketchRefresh(session:CadSession,evaluate:(draft:CadDocument)=>Promise<unknown>,
 id:string,incoming:SketchProfile,isOpen:()=>boolean=()=>true,artwork:{sourceId?:string;link?:boolean}={}){
 const {document,revision}=session.state;
 const before=document.sketches?.[id];
 if(!before)throw new Error(t('Sketch does not exist'));
 if(before.artworkSourceId!==undefined&&before.artworkSourceId!==artwork.sourceId)
  throw new Error(t('This sketch is linked to different artwork.'));
 const verifyCurrent=()=>{
  if(!isOpen()||session.state.document!==document||session.state.revision!==revision)
   throw new Error(t('The CAD design changed. Preview the sketch update again.'));
 };
 const used=dependentBodies(document,id);
 if(document.drawings?.some(sheet=>sheet.annotations?.some(note=>note.sketchId===id)||
     sheet.edgeDimensions?.some(note=>used.has(note.bodyId))||sheet.curveDimensions?.some(note=>
      used.has(note.bodyId)||typeof note.source==='object'&&note.source.sketchId===id)))
  throw new Error(t('This sketch has drawing dimensions. Add the artwork as a new sketch.'));
 const profile=replacement(before.profile,incoming);
 const patch={profile,...(artwork.link&&artwork.sourceId?{artworkSourceId:artwork.sourceId}:{})};
 const trial=createCadSession(document);
 try{
  trial.updateSketch(id,patch);
  await evaluate(trial.state.document);
  verifyCurrent();
  const after=trial.state.document.sketches![id];
  const prior=contours(document,before),next=contours(trial.state.document,after);
  const path=(loops:SketchPoint[][])=>loops.map(loop=>
   `M ${loop.map(([x,y])=>`${x} ${-y}`).join(' L ')}${profile.kind==='path'?'':' Z'}`).join(' ');
  const {min,max,size}=sketchBounds([...prior,...next]);
  const padding=Math.max(...size)*.07||1;
  return {affectedBodies:document.roots.filter(root=>used.has(root)).map(root=>document.nodes[root].name),
   before:path(prior),after:path(next),
   viewBox:`${min[0]-padding} ${-max[1]-padding} ${size[0]+2*padding} ${size[1]+2*padding}`,
   apply(){verifyCurrent();session.updateSketch(id,patch);}};
 }finally{trial.dispose();}
}
