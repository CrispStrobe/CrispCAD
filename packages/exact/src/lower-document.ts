// SPDX-License-Identifier: BSD-3-Clause
// Lowers the bodies of a CrispCAD document (GUI primitives, sketch features, mirror/pattern,
// Booleans and CAD Script objects) onto an ExactKernel. Placement and construction follow the
// Manifold evaluator in packages/geometry/src/kernel.ts; primitives and sketch curves are built
// exactly (segment counts are display resolution, not geometry).
//
// Nothing falls back to a mesh: an imported mesh or any construction without an exact lowering is
// an ExactKernelError naming the body and the feature.
import {compileCode,evaluateExactFeature,evaluateExtrusion,evaluateMirror,evaluatePattern,evaluateRevolution,evaluateSketchRegion,featureValue,identityTransform,sketchBulgeMidpoint,sketchOutline} from '@brickwright/cad-core';
import type {CadDocument,PlanarSketch,SketchLoop,SketchPoint,SolidNode,Vec3} from '@brickwright/cad-core';
import {ExactKernelError} from '@crispcad/exact-kernel';
import type {ExactKernel,ExactProfile,ExactSolid,PathSegment} from '@crispcad/exact-kernel';
import {lowerCodeShape,revolveProfile} from './lower-cad-script.js';

/** Where an exact lowering failed: the body, the node inside it and its feature kind. */
export interface ExactDiagnostic {
 code:ExactKernelError['code'];
 bodyId:string;
 nodeId:string;
 /** Document node kind (`mesh`, `code`, `extrusion`, …). */
 feature:string;
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

function lowerNode(k:ExactKernel,doc:CadDocument,id:string,bodyId:string,cache:Map<string,ExactSolid>):ExactSolid{
 const cached=cache.get(id);if(cached)return cached;
 const node=doc.nodes[id] as SolidNode;
 let solid:ExactSolid;
 try{
  switch(node.kind){
   case 'box':solid=k.box(node.size);break;
   case 'cylinder':solid=k.cylinder(node.radius,node.height);break;
   case 'sphere':solid=k.sphere(node.radius);break;
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
    solid=k.mirror(lowerNode(k,doc,node.source,bodyId,cache),normal);
    if(offset){const position:[number,number,number]=[0,0,0];position[axis]=2*offset;solid=k.translate(solid,position);}
    break;
   }
   case 'pattern':{
    const pattern=evaluatePattern(node,doc),source=lowerNode(k,doc,node.source,bodyId,cache),copies=[source];
    if(pattern.mode==='linear'){
     for(let i=1;i<pattern.count;i++){const delta:[number,number,number]=[0,0,0];delta[pattern.axis]=i*pattern.spacing;copies.push(k.translate(source,delta));}
    }else{
     const step=pattern.sweep/(Math.abs(pattern.sweep)===360?pattern.count:pattern.count-1),axis:[number,number,number]=[0,0,0];
     axis[pattern.axis]=1;
     for(let i=1;i<pattern.count;i++)copies.push(k.rotate(source,axis,i*step,pattern.center));
    }
    solid=k.union(copies[0],...copies.slice(1));
    break;
   }
   case 'boolean':{
    const operands=node.inputs.map(input=>lowerNode(k,doc,input,bodyId,cache));
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
    const feature=evaluateExactFeature(node,doc),source=lowerNode(k,doc,node.source,bodyId,cache);
    solid=feature.operation==='fillet'?k.fillet(source,feature.size,feature.edges)
     :feature.operation==='chamfer'?k.chamfer(source,feature.size,feature.edges)
     :k.shell(source,feature.size,feature.openFaces);
    break;
   }
   case 'mesh':return unsupported(node.surface?'Reference surfaces have no exact solid.':'Imported meshes have no exact B-rep; only bodies built from primitives, sketches, features and CAD Script can be exported or measured exactly.');
   default:return unsupported(`'${(node as {kind:string}).kind}' has no exact lowering.`);
  }
  const {scale,rotation,position}=node.transform;
  if(scale.some(v=>v!==1))solid=k.scale(solid,scale);
  solid=rotateXYZ(k,solid,rotation);
  if(position.some(v=>v!==0))solid=k.translate(solid,position);
 }catch(error){
  if(error instanceof ExactLoweringError)throw error;
  const code=error instanceof ExactKernelError?error.code:'invalid-input',message=error instanceof Error?error.message:String(error);
  throw new ExactLoweringError({code,bodyId,nodeId:id,feature:node.kind,message:`${node.name} (${node.kind}): ${message}`},{cause:error});
 }
 cache.set(id,solid);return solid;
}

/** One top-level body as an exact solid, in world millimetres. Call inside `k.scope` (or dispose
 * the result); intermediate solids are owned by the caller's scope. */
export function lowerDocumentBody(k:ExactKernel,doc:CadDocument,bodyId:string):ExactSolid{
 if(!doc.roots.includes(bodyId))throw new ExactKernelError('invalid-input',`${bodyId} is not a top-level body.`);
 return lowerNode(k,doc,bodyId,bodyId,new Map());
}

/** Any node as an exact solid in its parent's frame (its own transform applied). Call inside
 * `k.scope`. With `local`, the node's own transform is left out (the frame of its inputs). */
export function lowerDocumentNode(k:ExactKernel,doc:CadDocument,id:string,options:{local?:boolean}={}):ExactSolid{
 const node=doc.nodes[id];
 if(!node)throw new ExactKernelError('invalid-input',`${id} is not a node of this model.`);
 const source=options.local?{...doc,nodes:{...doc.nodes,[id]:{...node,transform:identityTransform()}}}:doc;
 const bodyId=doc.roots.find(root=>root===id)??id;
 return lowerNode(k,source,id,bodyId,new Map());
}
