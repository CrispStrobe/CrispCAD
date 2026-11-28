// SPDX-License-Identifier: BSD-3-Clause
// Lowers the bodies of a CrispCAD document (GUI primitives, sketch features, mirror/pattern,
// Booleans and CAD Script objects) onto an ExactKernel. Placement and construction follow the
// Manifold evaluator in packages/geometry/src/kernel.ts; primitives and sketch curves are built
// exactly (segment counts are display resolution, not geometry).
//
// Nothing falls back to a mesh: an imported mesh or any construction without an exact lowering is
// an ExactKernelError naming the body and the feature.
import {t,compileCode,holeProfile,evaluateExactFeature,exactCopyFaceName,exactFaceName,isEdgeReferences,isExactFaceName,resolveEdgeReferences,splitExactFaceName,ExactEdgeReferenceError,evaluateExtrusion,evaluateMirror,evaluatePattern,evaluateSplit,evaluateRevolution,evaluateSketchRegion,featureValue,identityTransform,sketchBulgeMidpoint,sketchOutline} from '@brickwright/cad-core';
import type {CadDocument,PlanarSketch,SketchLoop,SketchPoint,SolidNode,Vec3} from '@brickwright/cad-core';
import {ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactKernel,ExactProfile,ExactSolid,PathSegment} from '@crispcad/exact-kernel';
import {lowerCodeShape,revolveProfile} from './lower-cad-script.js';
import {checkExactFeatureCost} from './feature-cost.js';
import {createBrepCache} from './step-import.js';
import type {BrepCache} from './step-import.js';
import type {ExactLimits} from './limits.js';

/** The pre-flight part of ExactLimits: what one exact feature may touch. */
export type ExactFeatureLimits=Pick<ExactLimits,'maxFeatureEdges'|'maxShellFaces'>&Partial<Pick<ExactLimits,'maxStepImportBytes'>>;

/** Where an exact lowering failed: the body, the node inside it and its feature kind. */
export interface ExactDiagnostic {
 code:ExactKernelError['code'];
 bodyId:string;
 nodeId:string;
 /** Document node kind (`mesh`, `code`, `extrusion`, …). */
 feature:string;
 /** `stale-edge-reference` when chosen edges no longer resolve (exact-edge-references.ts). */
 reason?:string;
 message:string;
}
export class ExactLoweringError extends ExactKernelError {
 constructor(readonly diagnostic:ExactDiagnostic,options?:{cause?:unknown}){super(diagnostic.code,diagnostic.message,options);this.name='ExactLoweringError';}
}

const unsupported=(message:string):never=>{throw new ExactKernelError('unsupported',message);};

function outlineProfile(k:ExactKernel,points:readonly SketchPoint[],bulges?:readonly number[]):ExactProfile{
 if(!bulges?.some(b=>b!==0)){
  sketchOutline([...points]); // same validity rules as the Manifold contour
  return k.profile.polygon([points]);
 }
 sketchOutline([...points],[...bulges]);
 const segments:PathSegment[]=points.map((point,i)=>{
  const next=points[(i+1)%points.length],bulge=bulges[i]??0;
  return bulge?{kind:'arc',via:sketchBulgeMidpoint(point,next,bulge),to:next}:{kind:'line',to:next};
 });
 return k.profile.path(points[0],segments);
}
const circleProfile=(k:ExactKernel,center:readonly [number,number],radius:number)=>{
 const circle=k.profile.circle(radius);
 return center[0]||center[1]?k.profile.translate(circle,[center[0],center[1]]):circle;
};

/** The closed sketch region as an exact planar profile (arcs and circles stay exact). */
export function sketchProfile(k:ExactKernel,sketch:PlanarSketch,doc:CadDocument):ExactProfile{
 const p=sketch.profile;
 switch(p.kind){
  case 'rectangle':return k.profile.rectangle(featureValue(p.width,doc),featureValue(p.depth,doc),true);
  case 'circle':return circleProfile(k,p.center??[0,0],featureValue(p.radius,doc));
  case 'outline':return outlineProfile(k,p.points,p.bulges);
  case 'region':{
   // Validates loops (containment, disjoint holes) exactly as the Manifold contour does.
   evaluateSketchRegion(p.loops,value=>featureValue(value,doc));
   const loop=(entry:SketchLoop)=>entry.kind==='circle'
    ?circleProfile(k,[featureValue(entry.center[0],doc),featureValue(entry.center[1],doc)],featureValue(entry.radius,doc))
    :outlineProfile(k,entry.points,entry.bulges);
   const loops=p.loops.map(loop).map(profile=>({profile,area:k.profile.area(profile)})).sort((a,b)=>b.area-a.area);
   return k.profile.subtract(loops[0].profile,...loops.slice(1).map(entry=>entry.profile));
  }
  case 'path':return unsupported('Close the sketch path before creating a solid.');
  default:return unsupported(`Sketch profile '${(p as {kind:string}).kind}' has no exact lowering.`);
 }
}

/** Fixed-axis X, then Y, then Z rotation, as in Manifold and the viewport. */
function rotateXYZ(k:ExactKernel,solid:ExactSolid,degrees:readonly number[]):ExactSolid{
 let out=solid;
 ([[1,0,0],[0,1,0],[0,0,1]] as Vec3[]).forEach((axis,i)=>{if(degrees[i])out=k.rotate(out,axis,degrees[i]);});
 return out;
}

/** Leaf constructions: their faces are named `<id>:f<k>` when the result must carry face names. */
// An imported exact body is a leaf too: its B-rep never changes, so its face numbers are stable.
const LEAF_KINDS=new Set(['box','cylinder','sphere','hole','code','extrusion','revolution','exact-body']);
const nameLeafFaces=(k:ExactKernel,solid:ExactSolid,id:string)=>k.nameFaces(solid,k.topology(solid).faces.map(face=>exactFaceName(id,face.index)));
/** A pattern copy's faces get the prefix `<pattern>#<copy>/` (faces without our names are left). */
const nameCopyFaces=(k:ExactKernel,solid:ExactSolid,patternId:string,copy:number)=>k.nameFaces(solid,k.topology(solid).faces.map(face=>isExactFaceName(face.name)?exactCopyFaceName(patternId,copy,face.name):null));

/** "Plate face 3" (copy 2 of Pattern …) for a face name, for stale-reference messages. */
export function describeExactFace(doc:CadDocument,name:string):string{
 try{
  const {copies,node,face}=splitExactFaceName(name);
  const label=t`${doc.nodes[node]?.name??node} face ${face+1}`;
  return copies.length?label+' ('+copies.map(({pattern,copy})=>t`copy ${copy+1} of ${doc.nodes[pattern]?.name??pattern}`).join(', ')+')':label;
 }catch{return name;}
}

/**
 * Edge indices on `source` (lowered with face names) for an exact feature's edge references. A
 * reference that no longer resolves is an ExactEdgeReferenceError (stale), never another edge.
 */
export function resolveFeatureEdges(k:ExactKernel,doc:CadDocument,source:ExactSolid,references:Parameters<typeof resolveEdgeReferences>[1]):number[]{
 return resolveEdgeReferences(k.topology(source),references,face=>describeExactFace(doc,face));
}

function lowerNode(k:ExactKernel,doc:CadDocument,id:string,bodyId:string,cache:Map<string,ExactSolid>,limits?:ExactFeatureLimits,named=false,breps?:BrepCache):ExactSolid{
 const key=named?'named:'+id:id;
 const cached=cache.get(key);if(cached)return cached;
 const node=doc.nodes[id] as SolidNode;
 let solid:ExactSolid;
 try{
  switch(node.kind){
   case 'box':solid=k.box(node.size);break;
   case 'cylinder':solid=k.cylinder(node.radius,node.height);break;
   case 'sphere':solid=k.sphere(node.radius);break;
   // A standard hole: the same profile Manifold revolves; SMLib makes its walls true cylinders and cones.
   case 'hole':solid=k.revolve(k.profile.polygon([holeProfile(node)]),360);break;
   case 'code':{
    const lowered=lowerCodeShape(k,compileCode(node.program).shape);
    if(!lowered)throw new ExactKernelError('invalid-input','Code produces no printable solid.');
    solid=lowered;break;
   }
   case 'extrusion':{
    const {distance,start,plane}=evaluateExtrusion(node,doc);
    solid=k.extrude(sketchProfile(k,doc.sketches![node.sketchId],doc),distance);
    if(start)solid=k.translate(solid,[0,0,start]);
    if(plane==='XZ')solid=rotateXYZ(k,solid,[90,0,0]);
    else if(plane==='YZ')solid=rotateXYZ(k,solid,[90,0,90]);
    break;
   }
   case 'revolution':{
    const {plane,angle,axisOffset}=evaluateRevolution(node,doc);
    let profile=sketchProfile(k,doc.sketches![node.sketchId],doc);
    if(axisOffset)profile=k.profile.translate(profile,[-axisOffset,0]);
    solid=revolveProfile(k,profile,angle);
    if(plane==='XY')solid=rotateXYZ(k,solid,[-90,0,0]);
    else if(plane==='YZ')solid=rotateXYZ(k,solid,[0,0,90]);
    if(axisOffset)solid=k.translate(solid,plane==='YZ'?[0,axisOffset,0]:[axisOffset,0,0]);
    break;
   }
   case 'mirror':{
    const {axis,offset}=evaluateMirror(node,doc),normal:[number,number,number]=[0,0,0];
    normal[axis]=1;
    solid=k.mirror(lowerNode(k,doc,node.source,bodyId,cache,limits,named,breps),normal);
    if(offset){const position:[number,number,number]=[0,0,0];position[axis]=2*offset;solid=k.translate(solid,position);}
    break;
   }
   case 'split':{
    // The exact kernel cuts the B-rep: the cut face is an exact plane, the others keep their surfaces.
    const {normal,offset}=evaluateSplit(node,doc),source=lowerNode(k,doc,node.source,bodyId,cache,limits,named,breps);
    const empty=()=>new ExactKernelError('invalid-input',node.side==='positive'?t('Nothing of the body lies on the + side of the split plane'):t('Nothing of the body lies on the − side of the split plane'));
    let parts:[ExactSolid,ExactSolid];
    // The kernel refuses a plane that leaves one side empty; that is this node's error, in our words.
    try{parts=k.splitByPlane(source,normal,offset);}catch(error){if(error instanceof Error&&/nothing of the part lies/i.test(error.message))throw empty();throw error;}
    solid=node.side==='positive'?parts[0]:parts[1];
    if(k.solidCount(solid)<1||!(k.volume(solid)>1e-8))throw empty();
    break;
   }
   case 'pattern':{
    const pattern=evaluatePattern(node,doc),source=lowerNode(k,doc,node.source,bodyId,cache,limits,named,breps),copies=[source];
    if(pattern.mode==='linear'){
     for(let i=1;i<pattern.count;i++){const delta:[number,number,number]=[0,0,0];delta[pattern.axis]=i*pattern.spacing;copies.push(k.translate(source,delta));}
    }else{
     const step=pattern.sweep/(Math.abs(pattern.sweep)===360?pattern.count:pattern.count-1),axis:[number,number,number]=[0,0,0];
     axis[pattern.axis]=1;
     for(let i=1;i<pattern.count;i++)copies.push(k.rotate(source,axis,i*step,pattern.center));
    }
    // Copies share their source's face names; each copy's faces get their own.
    if(named)copies.forEach((copy,i)=>{copies[i]=nameCopyFaces(k,copy,id,i);});
    solid=k.union(copies[0],...copies.slice(1));
    break;
   }
   case 'boolean':{
    const operands=node.inputs.map(input=>lowerNode(k,doc,input,bodyId,cache,limits,named,breps));
    if(node.useHoleRoles){
     const solids=operands.filter((_,i)=>doc.nodes[node.inputs[i]].role!=='hole'),holes=operands.filter((_,i)=>doc.nodes[node.inputs[i]].role==='hole');
     if(!solids.length)unsupported('A combination of holes only has no solid to export.');
     const base=solids.length>1?k.union(solids[0],...solids.slice(1)):solids[0];
     solid=holes.length?k.subtract(base,...holes):base;
    }else solid=node.operation==='union'?k.union(operands[0],...operands.slice(1)):node.operation==='subtract'?k.subtract(operands[0],...operands.slice(1)):k.intersect(operands[0],...operands.slice(1));
    break;
   }
   case 'exact-feature':{
    // Always rebuilt on the exact source; the stored display mesh is never used here.
    // Edge references need face names on the source (only then are faces named: documents
    // without them lower exactly as before).
    const feature=evaluateExactFeature(node,doc),references=isEdgeReferences(feature.edges)?feature.edges.references:undefined;
    const source=lowerNode(k,doc,node.source,bodyId,cache,limits,named||!!references,breps);
    const edges=references?{edgeIndices:resolveFeatureEdges(k,doc,source,references)}:feature.edges as 'all'|{faceNormal:Vec3;outermost?:true}|undefined;
    // Refuse a job that is too large for this host before the kernel runs it (see limits.ts).
    if(limits)checkExactFeatureCost(source,feature.operation,edges,limits);
    solid=feature.operation==='fillet'?k.fillet(source,feature.size,edges)
     :feature.operation==='chamfer'?k.chamfer(source,feature.size,edges)
     :k.shell(source,feature.size,feature.openFaces);
    break;
   }
   case 'exact-body':
    // An imported STEP body: its stored B-rep, read by the kernel (cached between requests).
    solid=breps?breps.solid(node):createBrepCache(k,0).solid(node);break;
   case 'instance':{
    // A linked instance (document version 51): the source's construction without its placement
    // (only its scale), lowered once per request and shared by every instance of it. Faces keep
    // the source's leaf names, so a mate names an instance's face as it names the source's.
    const source=doc.nodes[node.source] as SolidNode,localKey=(named?'named:':'')+'local:'+node.source;
    let base=cache.get(localKey);
    if(!base){
     const local={...doc,nodes:{...doc.nodes,[source.id]:{...source,transform:{...identityTransform(),scale:[...source.transform.scale] as Vec3}}}};
     base=lowerNode(k,local,source.id,bodyId,new Map(),limits,named,breps);cache.set(localKey,base);
    }
    solid=base;break;
   }
   case 'mesh':return unsupported(node.surface?'Reference surfaces have no exact solid.':'Imported meshes have no exact B-rep; only bodies built from primitives, sketches, features and CAD Script can be exported or measured exactly.');
   default:return unsupported(`'${(node as {kind:string}).kind}' has no exact lowering.`);
  }
  if(named&&LEAF_KINDS.has(node.kind))solid=nameLeafFaces(k,solid,id);
  const {scale,rotation,position}=node.transform;
  if(scale.some(v=>v!==1))solid=k.scale(solid,scale);
  solid=rotateXYZ(k,solid,rotation);
  if(position.some(v=>v!==0))solid=k.translate(solid,position);
 }catch(error){
  if(error instanceof ExactLoweringError)throw error;
  const code=error instanceof ExactKernelError?error.code:'invalid-input';
  if(error instanceof ExactEdgeReferenceError)
   throw new ExactLoweringError({code:'invalid-input',bodyId,nodeId:id,feature:node.kind,reason:error.code,message:`${node.name}: ${error.message}`},{cause:error});
  let message=error instanceof Error?error.message:String(error);
  // The kernel's own guard on shell/offset steps (`guardSeconds`: 20 s by default; the editor's
  // exact worker derives it from the request budget): its message ends in a developer hint
  // (setGuardSeconds), so say what happened instead.
  const guard=/the kernel did not finish within ([\d.]+) s/.exec(message);
  if(guard)message=t`The exact kernel stopped this step at its own ${guard[1]} s limit, so it was not built. The model was not changed. Try a simpler body.`;
  throw new ExactLoweringError({code,bodyId,nodeId:id,feature:node.kind,message:`${node.name} (${node.kind}): ${message}`},{cause:error});
 }
 cache.set(key,solid);return solid;
}

/** One top-level body as an exact solid, in world millimetres. Call inside `k.scope` (or dispose
 * the result); intermediate solids are owned by the caller's scope. */
export function lowerDocumentBody(k:ExactKernel,doc:CadDocument,bodyId:string,options:{limits?:ExactFeatureLimits;breps?:BrepCache}={}):ExactSolid{
 if(!doc.roots.includes(bodyId))throw new ExactKernelError('invalid-input',`${bodyId} is not a top-level body.`);
 return lowerNode(k,doc,bodyId,bodyId,new Map(),options.limits,false,options.breps);
}

/** Any node as an exact solid in its parent's frame (its own transform applied). Call inside
 * `k.scope`. With `local`, the node's own transform is left out (the frame of its inputs). */
export function lowerDocumentNode(k:ExactKernel,doc:CadDocument,id:string,options:{local?:boolean;limits?:ExactFeatureLimits;named?:boolean;breps?:BrepCache}={}):ExactSolid{
 const node=doc.nodes[id];
 if(!node)throw new ExactKernelError('invalid-input',`${id} is not a node of this model.`);
 const source=options.local?{...doc,nodes:{...doc.nodes,[id]:{...node,transform:identityTransform()}}}:doc;
 const bodyId=doc.roots.find(root=>root===id)??id;
 return lowerNode(k,source,id,bodyId,new Map(),options.limits,options.named,options.breps);
}
