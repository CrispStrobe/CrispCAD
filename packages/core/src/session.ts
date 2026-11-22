import {initializeDrawingOutlineIds,isDrawingArc,isDrawingVertex,resolveDrawingSource,retainDrawingVertexIds} from './drawing-sheet.js';
import type {DrawingInputs} from './drawing-sheet.js';
import {upgradeSimulation,jointAtWorldFrame,materialPhysics,simulationTracers} from './simulation.js';
import type {SimulationSettings} from './simulation.js';
// SPDX-License-Identifier: BSD-3-Clause
import {generateModelSource,compileModelSource,updateModelSource,sameModelValue} from './model-source.js';
import {t} from './i18n.js';
import type {ModelProvenanceRecord} from './model-provenance.js';
import {assertProvenanceUpgrade,pruneModelProvenance} from './model-provenance.js';
import {constructionInputs,isCube,constrainCubeEdit,constrainCubeTransform, checkDocument, createDocument, freezeDocument, identityTransform, newId, parseDocument, pruneDocument, serializeDocument, validateDocument } from './document.js';
import type { CadDocument, Primitive, SolidNode, Transform, Vec3 } from './document.js';
import type {CadJoint} from './physics.js';
import { defaultPartPhysics, allocateMotorPort } from './physics.js';
import { applyParametricBindings, assertDrivenEdit } from './parameters.js';
import type {CodeProgram} from './code.js';
import {closePathProfile,evaluateSketch,isSketchFeature} from './features.js';
import type {PlanarSketch,SketchProfile,FeatureScalar,RevolutionFeature,MirrorFeature,PatternFeature,PatternSettings} from './features.js';
import type { ParametricDesign } from './parameters.js';
import {mergeFragmentParameters,selectionFragment,uniqueObjectName,offsetPositionExpression} from './fragments.js';
function copyAssemblyJoints(joints:readonly CadJoint[],ids:Map<string,string>,existing:readonly CadJoint[]):CadJoint[]{const result:CadJoint[]=[];for(const joint of joints){const next={...structuredClone(joint),id:newId(),bodyA:ids.get(joint.bodyA)!,bodyB:ids.get(joint.bodyB)!};if(next.control&&[...existing,...result].some(j=>j.control?.port===next.control!.port))next.control={port:allocateMotorPort([...existing,...result])};result.push(next);}return result;}
type RevolutionInputs=Pick<RevolutionFeature,'angle'|'axisOffset'>;
type SketchPatch=Partial<Pick<PlanarSketch,'name'|'plane'|'profile'>>;
function upgradeModelFeatures(doc:CadDocument,version:12|13|14|15|16){
  if(doc.version>=version)return;
  assertProvenanceUpgrade(doc);
  if(doc.version<6&&Object.hasOwn(doc,'modelSource'))throw new Error(t('Legacy modelSource data cannot be overwritten'));
  upgradeSimulation(doc);
  doc.version=version;
}
function appendRevolution(doc:CadDocument,id:string,sketchId:string,inputs:RevolutionInputs,position:Vec3){
  upgradeModelFeatures(doc,12);
  doc.nodes[id]={id,kind:'revolution',featureVersion:1,sketchId,angle:inputs.angle,
    ...(inputs.axisOffset===undefined?{}:{axisOffset:inputs.axisOffset}),
    name:uniqueObjectName(t('Revolution'),new Set(doc.roots.map(key=>doc.nodes[key].name))),
    color:'#eea52b',transform:{...identityTransform(),position}};
  doc.roots.push(id);
  return [id];
}
const operationGuard=(kind:'mirror'|'pattern')=>kind==='mirror'?{
  selection:t('Select one top-level body to mirror'),
  joints:t('Detach this body’s joints before mirroring'),
  tracers:t('Remove this body’s motion tracers before mirroring')
}:{
  selection:t('Select one top-level body to pattern'),
  joints:t('Detach this body’s joints before patterning'),
  tracers:t('Remove this body’s motion tracers before patterning')
};
function appendBodyOperation(doc:CadDocument,id:string,operation:MirrorFeature|PatternFeature){
  const {kind,source}=operation,body=doc.nodes[source],index=doc.roots.indexOf(source),guard=operationGuard(kind);
  if(index<0||body.reference)throw new Error(guard.selection);
  if(doc.joints?.some(j=>j.bodyA===source||j.bodyB===source))throw new Error(guard.joints);
  if(doc.tracers?.some(trace=>trace.bodyId===source))throw new Error(guard.tracers);
  upgradeModelFeatures(doc,kind==='mirror'?13:14);
  const material=body.physics;
  const name=kind==='mirror'?t`Mirror of ${body.name}`:t`Pattern of ${body.name}`;
  doc.nodes[id]={...operation,id,name:uniqueObjectName(name,new Set(doc.roots.map(key=>doc.nodes[key].name))),
    color:body.color,transform:identityTransform(),...(body.role?{role:body.role}:{}),
    ...(material?{physics:{version:1,motion:material.motion,densityKgM3:material.densityKgM3,
      friction:material.friction,restitution:material.restitution,intent:'rigid',...(material.material?{material:material.material}:{})}}:{})
  };
  doc.roots[index]=id;
  return [id];
}
function guardBodyOperationEdit(doc:CadDocument,id:string,kind:'mirror'|'pattern'){
  guardConstructionEdit(doc,id);
  const guard=operationGuard(kind);
  const contains=(key:string,seen=new Set<string>()):boolean=>{
    if(key===id)return true;
    if(seen.has(key))return false;
    seen.add(key);
    return constructionInputs(doc.nodes[key]).some(child=>contains(child,seen));
  };
  if(doc.joints?.some(j=>contains(j.bodyA)||contains(j.bodyB)))throw new Error(guard.joints);
  if(doc.tracers?.some(trace=>contains(trace.bodyId)))throw new Error(guard.tracers);
}
export interface SessionState { document: CadDocument; selection: readonly string[]; revision: number; canUndo: boolean; canRedo: boolean; label: string }
const cloneNode = (node: SolidNode): SolidNode => ({ ...node,
  ...(node.provenance!==undefined?{provenance:structuredClone(node.provenance)}:{}),
  transform: { position: [...node.transform.position], rotation: [...node.transform.rotation], scale: [...node.transform.scale] },
  ...(node.kind === 'box' ? { size: [...node.size] } : {}),
  ...(node.kind === 'boolean' ? { inputs: [...node.inputs] } : {}),
}) as SolidNode;
const equivalent = (a: SolidNode, b: SolidNode) => {
  if (a.kind === 'mesh' && b.kind === 'mesh') {
    if (a.positions!==b.positions&&(a.positions.length!==b.positions.length||!a.positions.every((v,i)=>v===b.positions[i]))||a.indices!==b.indices&&(a.indices.length!==b.indices.length||!a.indices.every((v,i)=>v===b.indices[i]))) return false;
    return sameModelValue({ ...a, positions: null, indices: null },{ ...b, positions: null, indices: null });
  }
  return sameModelValue(a,b);
};
type Snapshot = { document: CadDocument; selection: string[]; label: string };
function guardConstructionEdit(doc:CadDocument,id:string){
  for(const root of Object.values(doc.nodes)){if(!root.generator||root.id===id)continue;const visited=new Set<string>();const contains=(key:string):boolean=>{if(key===id)return true;if(visited.has(key))return false;visited.add(key);const n=doc.nodes[key];return constructionInputs(n).some(contains);};if(contains(root.id))throw new Error(t`Edit ${root.name} through its shape parameters, or detach its generator first`);}
}
function editSketch(d:CadDocument,id:string,patch:Partial<Pick<PlanarSketch,'name'|'plane'|'profile'>>) {
  const sketch=d.sketches?.[id];if(!sketch)throw new Error(t('Sketch does not exist'));
  const uses=(key:string):boolean=>{const n=d.nodes[key];return isSketchFeature(n)?n.sketchId===id:constructionInputs(n).some(uses);};
  if(d.joints?.some(j=>uses(j.bodyA)||uses(j.bodyB)))throw new Error(t('Detach joints before editing their sketches'));
  const next={...sketch,...structuredClone(patch)};
  if(next.profile.id!==sketch.profile.id||next.profile.kind!==sketch.profile.kind)throw new Error(t('Keep sketch profile identity and kind when editing'));
  if(patch.profile)retainDrawingVertexIds(sketch.profile,next.profile,newId);
  d.sketches![id]=next;
}
export function createCadSession(initial: CadDocument = createDocument()) {
  let document = freezeDocument(validateDocument(initial)); let selection: string[] = []; let revision = 0; let label = 'Opened';let liveModelSource=false;
  const undo: Snapshot[] = []; const redo: Snapshot[] = []; const listeners = new Set<(state: SessionState) => void>();
  const state = (): SessionState => ({ document, selection: Object.freeze([...selection]), revision, canUndo: !!undo.length, canRedo: !!redo.length, label });
  const emit = () => { for (const listener of [...listeners]) listener(state()); };
  const snapshot = (): Snapshot => ({ document, selection: [...selection], label });
  function commit(title: string, edit: (draft: CadDocument) => string[] | void) {
    const draft = { ...document, ...(document.version>=8&&document.tracers?{tracers:structuredClone(document.tracers)}:{}), roots: [...document.roots], ...(document.joints ? {joints: structuredClone(document.joints)} : {}), ...(document.parametric ? {parametric:structuredClone(document.parametric)} : {}), ...(document.sketches?{sketches:structuredClone(document.sketches)}:{}), nodes: Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [id, cloneNode(node)])) };
    const nextSelection = edit(draft);
    applyParametricBindings(draft);
    if(liveModelSource||draft.version>=6&&draft.modelSource){assertProvenanceUpgrade(draft);draft.version=Math.max(6,draft.version) as CadDocument['version'];draft.modelSource={version:1,language:'brickwright-design',source:updateModelSource(draft.modelSource?.source,draft)};}
    checkDocument(draft);
    for (const [id, node] of Object.entries(draft.nodes)) {
      const previous = document.nodes[id];
      if (previous && equivalent(node, previous)) draft.nodes[id] = previous;
    }
    const header=(doc:CadDocument)=>{const {nodes,...rest}=doc;return JSON.stringify(rest);};
    if (header(draft)===header(document) && Object.keys(draft.nodes).length===Object.keys(document.nodes).length && Object.entries(draft.nodes).every(([id,node])=>document.nodes[id]===node)) return;
    const validated = freezeDocument(draft);
    undo.push(snapshot()); if (undo.length > 100) undo.shift(); redo.length = 0;
    document = validated; selection = nextSelection ?? selection.filter(id => !!document.nodes[id]); label = title; revision++; emit();
  }
  type SourceOptions={expectedRevision?:number;regenerate?:(recipe:NonNullable<SolidNode['generator']>,name:string)=>CadDocument};
  type PreparedSource={readonly document:CadDocument;readonly revision:number};
  const preparedSources=new WeakSet<PreparedSource>();
  const sourceReady=()=>{if(document.version<6&&Object.hasOwn(document,'modelSource'))throw new Error(t('Legacy modelSource data cannot be overwritten'));assertProvenanceUpgrade(document);};
  function prepareModelSource(source:string,options:SourceOptions={}):PreparedSource{
    sourceReady();if(options.expectedRevision!==undefined&&options.expectedRevision!==revision)throw new Error(t('The design changed while editing source. Reload or merge your draft.'));
    let candidate=compileModelSource(source,document,{regenerate:options.regenerate});
    for(const [id,before] of Object.entries(document.nodes)){
      const after=candidate.nodes[id];if(!after)continue;
      if(document.version>=5&&before.provenance?.some(ref=>!after.provenance?.includes(ref)))throw new Error(t('Keep source attribution on retained geometry'));
    }
    for(const node of Object.values(candidate.nodes))if(node.kind==='boolean'&&node.inputs.some(id=>candidate.nodes[id]?.reference))throw new Error(t('Reference helpers cannot be combined into printable solids'));
    const changedRecipes:string[]=[];
    const structural=(node:SolidNode)=>{const {name,color,transform,physics,provenance,generator,...geometry}=node;return geometry;};
    for(const [id,before] of Object.entries(document.nodes)){
      const after=candidate.nodes[id];if(!before.generator||!after?.generator)continue;
      const descendants=new Set<string>();const walk=(key:string)=>{if(descendants.has(key))return;descendants.add(key);const n=document.nodes[key];constructionInputs(n).forEach(walk);};walk(id);
      for(const child of descendants)if(child!==id&&!sameModelValue(document.nodes[child],candidate.nodes[child]))throw new Error(t('Edit generated construction through its recipe, or detach the generator'));
      if(!sameModelValue(structural(before),structural(after)))throw new Error(t('Edit generated construction through its recipe, or detach the generator'));
      if(!sameModelValue(before.generator,after.generator))changedRecipes.push(id);
    }
    for(const [id,node] of Object.entries(candidate.nodes))if(node.generator&&!document.nodes[id]?.generator)changedRecipes.push(id);
    // Explicitly detaching a recipe also clears its template-physics marker.
    for(const [id,before] of Object.entries(document.nodes))if(before.generator&&candidate.nodes[id]&&!candidate.nodes[id].generator&&candidate.nodes[id].physics)candidate.nodes[id].physics={...candidate.nodes[id].physics!,sourcePreset:undefined};
    if(changedRecipes.length){
      if(!options.regenerate)throw new Error(t('Generator source edits need the shape reconstruction callback'));
      const withoutSource={...candidate};delete withoutSource.modelSource;const trial=createCadSession(withoutSource);
      try{for(const id of changedRecipes)trial.replaceGenerated(id,options.regenerate(candidate.nodes[id].generator!,candidate.nodes[id].name));candidate=structuredClone(trial.state.document);}finally{trial.dispose();}
    }
    candidate.modelSource={version:1,language:'brickwright-design',source:updateModelSource(source,candidate)};
    const prepared=Object.freeze({document:freezeDocument(validateDocument(candidate)),revision});preparedSources.add(prepared);return prepared;
  }
  const session = {
    get state() { return state(); },
    // Labels describe the actions restored by each undo/redo, without copying geometry.
    get history() { return {past:undo.map((_,i)=>undo[i+1]?.label??label),future:[...redo].reverse().map(step=>step.label)}; },
    get modelSource(){return document.version>=6&&document.modelSource?document.modelSource.source:generateModelSource(document);},
    enableModelSource(){sourceReady();liveModelSource=true;},
    prepareModelSource,
    applyPreparedModelSource(prepared:PreparedSource){
      if(!preparedSources.has(prepared)||prepared.revision!==revision)throw new Error(t('The design changed while editing source. Reload or merge your draft.'));
      const before=revision;commit('Edit model source',d=>{for(const key of Object.keys(d))delete (d as any)[key];Object.assign(d,structuredClone(prepared.document));return selection.filter(id=>!!d.nodes[id]);});preparedSources.delete(prepared);return revision!==before;
    },
    applyModelSource(source:string,options:SourceOptions={}){return session.applyPreparedModelSource(prepareModelSource(source,options));},
    subscribe(listener: (state: SessionState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select(ids: readonly string[]) { selection = [...new Set(ids)].filter(id => Object.hasOwn(document.nodes, id)); emit(); },
    /** Record reviewed source metadata for existing geometry; no fetching or insertion. */
    attachProvenance(ids:readonly string[],record:ModelProvenanceRecord) {commit('Record model provenance',d=>{
      if(!ids.length||!ids.every(id=>Object.hasOwn(d.nodes,id)))throw new Error('Select existing objects for model provenance');
      assertProvenanceUpgrade(d);
      const source=structuredClone(record),existing=d.provenance?.records.find(r=>r.id===source.id);
      if(existing&&JSON.stringify(existing)!==JSON.stringify(source))throw new Error('Source record identity already exists with different metadata');
      d.version=Math.max(d.version,5) as CadDocument['version'];d.provenance={version:1,records:[...(d.provenance?.records??[]),...(existing?[]:[source])]};
      for(const id of ids)d.nodes[id].provenance=[...new Set([...(d.nodes[id].provenance??[]),source.id])];
    });},
    rename(title: string) { commit('Rename design', d => { d.title = title; }); },
    /** One atomic assembly edit, preserving project identity and all prior Undo.
     * A fully mutable candidate keeps extension code away from frozen snapshots. */
    editAssembly(title:string,edit:(draft:CadDocument)=>void,options:{expectedRevision?:number}={}){
      if(options.expectedRevision!==undefined&&options.expectedRevision!==revision)throw new Error(t('The design changed before this edit could be applied.'));
      const candidate=structuredClone(document),result=edit(candidate);
      if(result!==undefined)throw new Error('Assembly edits must finish synchronously');
      if(candidate.id!==document.id)throw new Error('Assembly edits must keep the project identity');
      commit(title,d=>{for(const key of Object.keys(d))delete (d as any)[key];Object.assign(d,candidate);});
    },
    saveDrawingSheet(inputs:DrawingInputs,sheetId?:string){
      const id=sheetId??newId();
      commit(sheetId?'Edit drawing sheet':'Add drawing sheet',d=>{
        const source=resolveDrawingSource(d,inputs.source);
        if(!source)throw new Error(t('Choose an available drawing source.'));
        const sheets=d.drawings??[];
        if(sheetId&&!sheets.some(sheet=>sheet.id===id))throw new Error(t('Drawing sheet does not exist.'));
        const sheet={...structuredClone(inputs),id};
        const outlineAnnotations=sheet.annotations?.filter(annotation=>
          [annotation.from,annotation.to].some(anchor=>isDrawingVertex(anchor)||isDrawingArc(anchor)))??[];
        const outlineDimensions=outlineAnnotations.filter(annotation=>annotation.sketchId===source.sketch.id);
        if(outlineDimensions.length){
          const links=initializeDrawingOutlineIds(source.sketch.profile,newId);
          for(const annotation of outlineDimensions){
            annotation.from=links.get(annotation.from)??annotation.from;
            if(annotation.to)annotation.to=links.get(annotation.to)??annotation.to;
          }
        }
        const aligned=sheet.annotations?.some(annotation=>annotation.kind==='aligned');
        const curved=sheet.annotations?.some(annotation=>annotation.kind==='radius'||annotation.kind==='arc-length');
        const version=curved?20:aligned?19:outlineAnnotations.length?18:sheet.section?.jog!==undefined?17:sheet.annotations!==undefined?11:sheet.section?10:9;
        if(d.version<version)d.version=version;
        d.drawings=sheetId?sheets.map(item=>item.id===id?sheet:item):[...sheets,sheet];
      });
      return id;
    },
    removeDrawingSheet(id:string){
      commit('Remove drawing sheet',d=>{
        if(!d.drawings?.some(sheet=>sheet.id===id))throw new Error(t('Drawing sheet does not exist.'));
        d.drawings=d.drawings.filter(sheet=>sheet.id!==id);
      });
    },
    setParametric(design: ParametricDesign) {commit('Edit parameters',d=>{if(d.version===1)d.version=2;d.parametric=structuredClone(design);});},
    detachGenerator(id:string){commit('Detach shape generator',d=>{if(!d.nodes[id]?.generator)throw new Error(t('No generator to detach'));if(isCube(d.nodes[id]))throw new Error(t('Cube edges are linked; use a Box for independent dimensions'));delete d.nodes[id].generator;if(d.nodes[id].physics)d.nodes[id].physics={...d.nodes[id].physics!,sourcePreset:undefined};});},
    replaceGenerated(id:string,fragment:CadDocument,options:{resetScale?:boolean;label?:string}={}){
      const source=validateDocument(fragment);if(source.roots.length!==1||source.joints?.length||source.parametric||source.sketches||(source.version>=5&&source.provenance))throw new Error(t('Expected one generated body'));
      commit(options.label??'Edit shape parameters',d=>{
        if(d.version>=5)assertProvenanceUpgrade(source);
        const previous=d.nodes[id];if(!previous)throw new Error(t('Object does not exist'));if(options.resetScale&&d.parametric?.bindings.some(b=>b.nodeId===id&&['scaleX','scaleY','scaleZ'].includes(b.property)))throw new Error(t('Detach driving scale expressions before rebuilding'));
        if(options.resetScale){const seen=new Set<string>(),visitParents=(key:string)=>{if(seen.has(key))return;seen.add(key);for(const parent of Object.values(d.nodes))if(constructionInputs(parent).includes(key)){if(parent.transform.scale.some(v=>Math.abs(v-1)>1e-9))throw new Error(t('Reset parent scaling before rebuilding this body'));visitParents(parent.id);}};visitParents(id);}
        const descendants=new Set<string>();const walk=(key:string)=>{if(descendants.has(key))return;descendants.add(key);const n=d.nodes[key];constructionInputs(n).forEach(walk);};walk(id);
        if(d.parametric?.bindings.some(b=>descendants.has(b.nodeId)&&b.nodeId!==id))throw new Error(t('Detach driving expressions on the construction operands before regenerating'));
        const connected=(key:string,seen=new Set<string>()):boolean=>{if(key===id)return true;if(seen.has(key))return false;seen.add(key);const n=d.nodes[key];return constructionInputs(n).some(child=>connected(child,seen));};
        if(d.joints?.some(j=>connected(j.bodyA)||connected(j.bodyB)))throw new Error(t('Detach joints before regenerating their bodies'));
        const map=new Map(Object.keys(source.nodes).map(key=>[key,key===source.roots[0]?id:newId()]));
        for(const [key,node] of Object.entries(source.nodes)){const next=cloneNode(node);next.id=map.get(key)!;if(next.kind==='boolean')next.inputs=next.inputs.map(input=>map.get(input)!);if(next.kind==='mirror'||next.kind==='pattern')next.source=map.get(next.source)!;d.nodes[next.id]=next;}
        const retained=d.version>=5?[...new Set([...descendants].flatMap(key=>document.nodes[key]?.provenance??[]))]:[];
        if(d.version<5&&Object.hasOwn(previous,'provenance'))d.nodes[id].provenance=structuredClone(previous.provenance);
        const next=d.nodes[id];if(retained.length)next.provenance=retained;next.name=previous.name;next.color=previous.color;if(previous.role)next.role=previous.role;next.transform=structuredClone(previous.transform);if(options.resetScale)next.transform.scale=[1,1,1];
        if(previous.physics&&next.physics)next.physics={...next.physics,densityKgM3:previous.physics.densityKgM3,friction:previous.physics.friction,restitution:previous.physics.restitution,motion:previous.physics.motion};
        if(d.version===1)d.version=2;pruneDocument(d);return [id];
      });
    },
    addCode(program:CodeProgram,name='Code object',options:{position?:Vec3}={}){const id=newId();commit('Add code object',d=>{d.version=Math.max(d.version,4) as CadDocument['version'];d.nodes[id]={id,kind:'code',program:structuredClone(program),name:uniqueObjectName(name,new Set(d.roots.map(key=>d.nodes[key].name))),color:'#76b7ce',transform:{...identityTransform(),position:options.position??[0,0,0]}};d.roots.push(id);return [id];});return id;},
    updateCode(id:string,program:CodeProgram){commit('Edit code object',d=>{const node=d.nodes[id];if(node?.kind!=='code')throw new Error(t('Select a code object'));guardConstructionEdit(d,id);const next={...node,program:structuredClone(program)};if(next.physics&&!sameModelValue(node.program,program)){next.physics={...next.physics};delete next.physics.collisionAssembly;}d.nodes[id]=next;});},
    addSketch(profile:SketchProfile,options:{name?:string;plane?:PlanarSketch['plane']}={}) {const id=newId();commit('Add sketch',d=>{if(profile.kind==='path')upgradeModelFeatures(d,profile.anchors!==undefined||profile.vertexIds!==undefined?16:15);else if(d.version<3)d.version=3;d.sketches??={};d.sketches[id]={version:1,id,name:options.name??'Sketch',plane:options.plane??'XY',profile:structuredClone(profile)};});return id;},
    extrudeSketch(sketchId:string,options:{distance?:FeatureScalar;symmetric?:boolean}={}) {const id=newId();commit('Extrude sketch',d=>{
      d.version=Math.max(d.version,3) as CadDocument['version'];d.nodes[id]={id,kind:'extrusion',featureVersion:1,sketchId,distance:options.distance??10,symmetric:options.symmetric??false,name:uniqueObjectName(t('Extrusion'),new Set(d.roots.map(key=>d.nodes[key].name))),color:'#eea52b',transform:identityTransform()};d.roots.push(id);return [id];});return id;},
    addSketchExtrusion(profile:SketchProfile,options:{name?:string;plane?:PlanarSketch['plane'];distance?:FeatureScalar;symmetric?:boolean;position?:Vec3}={}) {
      const sketchId=newId(),id=newId();
      commit('Add sketch extrusion',d=>{d.version=Math.max(d.version,3) as CadDocument['version'];d.sketches??={};d.sketches[sketchId]={version:1,id:sketchId,name:options.name??'Sketch',plane:options.plane??'XY',profile:structuredClone(profile)};
        d.nodes[id]={id,kind:'extrusion',featureVersion:1,sketchId,distance:options.distance??10,symmetric:options.symmetric??false,name:uniqueObjectName(t('Extrusion'),new Set(d.roots.map(id=>d.nodes[id].name))),color:'#eea52b',transform:{...identityTransform(),position:options.position??[0,0,0]}};d.roots.push(id);return [id];});return id;
    },
    revolveSketch(sketchId:string,options:RevolutionInputs&{position?:Vec3}) {
      const id=newId();
      commit('Revolve sketch',d=>appendRevolution(d,id,sketchId,options,options.position??[0,0,0]));
      return id;
    },
    addSketchRevolution(profile:SketchProfile,options:RevolutionInputs&{name:string;plane:PlanarSketch['plane'];position?:Vec3}) {
      const id=newId(),sketchId=newId();
      commit('Revolve sketch',d=>{
        d.sketches??={};
        d.sketches[sketchId]={version:1,id:sketchId,name:options.name,plane:options.plane,profile:structuredClone(profile)};
        return appendRevolution(d,id,sketchId,options,options.position??[0,0,0]);
      });
      return id;
    },
    editRevolution(id:string,inputs:RevolutionInputs&{sketch?:SketchPatch}) {
      commit('Edit sketch revolution',d=>{
        const node=d.nodes[id];
        if(node?.kind!=='revolution')throw new Error(t('Object is not a revolution'));
        guardConstructionEdit(d,id);
        if(inputs.sketch)editSketch(d,node.sketchId,inputs.sketch);
        node.angle=inputs.angle;
        if(inputs.axisOffset===undefined)delete node.axisOffset;
        else node.axisOffset=inputs.axisOffset;
      });
    },
    closeSketchPath(id:string,profile:Extract<SketchProfile,{kind:'path'}>,options:Pick<PlanarSketch,'name'|'plane'>) {
      commit('Close sketch path',d=>{
        const sketch=d.sketches?.[id];
        if(sketch?.profile.kind!=='path'||sketch.profile.id!==profile.id)throw new Error(t('Select an open sketch path'));
        evaluateSketch({...sketch,...options,profile},d);
        const outline=closePathProfile(profile,d);
        d.sketches![id]={...sketch,name:options.name,plane:options.plane,profile:outline};
      });
    },
    removeSketchPath(id:string){
      commit('Delete sketch path',d=>{
        if(d.sketches?.[id]?.profile.kind!=='path')throw new Error(t('Select an open sketch path'));
        delete d.sketches[id];
      });
    },
    updateSketch(id:string,patch:Partial<Pick<PlanarSketch,'name'|'plane'|'profile'>>) {commit('Edit sketch',d=>{
      if(patch.profile?.kind==='path'&&(patch.profile.anchors!==undefined||patch.profile.vertexIds!==undefined))upgradeModelFeatures(d,16);
      editSketch(d,id,patch);
    });},
    editExtrusion(id:string,inputs:{sketch?:Partial<Pick<PlanarSketch,'name'|'plane'|'profile'>>;distance:FeatureScalar;symmetric:boolean}) {commit('Edit sketch extrusion',d=>{
      const n=d.nodes[id];if(n?.kind!=='extrusion')throw new Error(t('Object is not an extrusion'));guardConstructionEdit(d,id);
      if(inputs.sketch)editSketch(d,n.sketchId,inputs.sketch);n.distance=inputs.distance;n.symmetric=inputs.symmetric;
    });},
    mirrorBody(source:string,inputs:Pick<MirrorFeature,'plane'|'offset'>) {
      const id=newId();
      commit('Mirror body',d=>appendBodyOperation(d,id,{kind:'mirror',source,plane:inputs.plane,offset:inputs.offset}));
      return id;
    },
    editMirror(id:string,inputs:Pick<MirrorFeature,'plane'|'offset'>) {
      commit('Edit mirror',d=>{
        const node=d.nodes[id];
        if(node?.kind!=='mirror')throw new Error(t('Select a mirrored body'));
        guardBodyOperationEdit(d,id,node.kind);
        node.plane=inputs.plane;
        node.offset=inputs.offset;
      });
    },
    patternBody(source:string,settings:PatternSettings) {
      const id=newId();
      commit('Pattern body',d=>appendBodyOperation(d,id,{kind:'pattern',source,pattern:structuredClone(settings)}));
      return id;
    },
    editPattern(id:string,settings:PatternSettings) {
      commit('Edit pattern',d=>{
        const node=d.nodes[id];
        if(node?.kind!=='pattern')throw new Error(t('Select a patterned body'));
        guardBodyOperationEdit(d,id,node.kind);
        node.pattern=structuredClone(settings);
      });
    },
    fragment(ids:readonly string[]=selection){return selectionFragment(document,ids);},
    insert(fragment: CadDocument, offset: [number, number, number] = [0, 0, 0],options:{mergeParameters?:boolean;label?:string}={}) {
      const source = validateDocument(fragment); const ids = new Map(Object.keys(source.nodes).map(id => [id, newId()]));
      if(source.parametric&&!options.mergeParameters)throw new Error(t('Enable parameter namespace merging when inserting a parametric model'));
      commit(options.label??'Add shape', d => {
        if(Math.max(d.version,source.version)>=5){assertProvenanceUpgrade(d);assertProvenanceUpgrade(source);}
        if(source.version>=8&&d.version<8)upgradeSimulation(d);
        // A first assembly may provide its world defaults. Existing scene settings,
        // including an intentionally configured empty scene, remain host-owned.
        if(!d.roots.length&&d.simulation===undefined&&source.version>=8&&source.simulation)d.simulation=structuredClone(source.simulation);
        d.version=Math.max(d.version,source.version) as CadDocument['version'];
        const provenanceIds=new Map((source.version>=5?source.provenance?.records??[]:[]).map(r=>[r.id,newId()]));
        if(source.version>=5&&source.provenance)d.provenance={version:1,records:[...(d.provenance?.records??[]),...source.provenance.records.map(r=>({...structuredClone(r),id:provenanceIds.get(r.id)!}))]};
        const sketches=new Map(Object.keys(source.sketches??{}).map(id=>[id,newId()]));
        for(const [id,sketch] of Object.entries(source.sketches??{})){d.sketches??={};const next=structuredClone(sketch);next.id=sketches.get(id)!;next.profile.id=newId();d.sketches[next.id]=next;}
        const names=new Set(d.roots.map(id=>d.nodes[id].name));
        for (const [id, original] of Object.entries(source.nodes)) { const node = cloneNode(original); if(source.version>=5&&node.provenance)node.provenance=node.provenance.map(ref=>provenanceIds.get(ref)!); node.id = ids.get(id)!; if(isSketchFeature(node))node.sketchId=sketches.get(node.sketchId)!; if (node.kind === 'boolean') node.inputs = node.inputs.map(input => ids.get(input)!); if(node.kind==='mirror'||node.kind==='pattern')node.source=ids.get(node.source)!; if (source.roots.includes(id)) node.transform.position = node.transform.position.map((v, i) => v + offset[i]) as [number, number, number]; d.nodes[node.id] = node; }
        const roots = source.roots.map(id => ids.get(id)!); d.roots.push(...roots);
        for(const id of roots){d.nodes[id].name=uniqueObjectName(d.nodes[id].name,names);names.add(d.nodes[id].name);}
        if(options.mergeParameters)mergeFragmentParameters(d,source,ids,offset,sketches);
        if(source.version>=8&&source.tracers?.length){if(d.version<8)upgradeSimulation(d);d.tracers=[...(d.tracers??[]),...source.tracers.map(trace=>({...structuredClone(trace),id:newId(),bodyId:ids.get(trace.bodyId)!}))];}
        if (source.joints?.length) d.joints = [...(d.joints ?? []), ...copyAssemblyJoints(source.joints,ids,d.joints??[])];
        return roots;
      });
    },
    add(shape: Primitive | Extract<SolidNode, { kind: 'mesh' }>, options: Partial<Pick<SolidNode, 'name' | 'color' | 'transform'>> = {}) {
      const id = newId();
      commit(`Add ${shape.kind}`, d => {
        d.nodes[id] = { ...structuredClone(shape), id, name: uniqueObjectName(options.name ?? `${shape.kind[0].toUpperCase()}${shape.kind.slice(1)}`,new Set(d.roots.map(id=>d.nodes[id].name))), color: options.color ?? '#eea52b', transform: structuredClone(options.transform ?? identityTransform()) } as SolidNode;
        d.roots.push(id); return [id];
      }); return id;
    },
    update(id: string, patch: Partial<SolidNode>) { commit('Edit object', d => {
      if (!d.nodes[id]) throw new Error(t('Object does not exist'));
      guardConstructionEdit(d,id);
      if(d.version>=5&&'provenance' in patch)throw new Error('Use attachProvenance to record sources');
      if('program' in patch)throw new Error(t('Use updateCode to edit a code program'));
      if('generator' in patch)throw new Error(t('Use shape regeneration to change generator inputs'));
      // Kind and identity cannot be changed by inspector edits.
      if ((patch.id && patch.id !== id) || (patch.kind && patch.kind !== d.nodes[id].kind)) throw new Error(t('Cannot change object identity or kind'));
      const next = constrainCubeEdit(d.nodes[id],{ ...d.nodes[id], ...structuredClone(patch) } as SolidNode);
      assertDrivenEdit(d,next); d.nodes[id] = next;
    }); },
    transform(updates: Array<{ id: string; transform: Transform }>) { commit('Transform selection', d => { for (const { id, transform } of updates) { if (!d.nodes[id]) throw new Error(t('Object does not exist'));guardConstructionEdit(d,id); const next={...d.nodes[id],transform:constrainCubeTransform(d.nodes[id],structuredClone(transform))};assertDrivenEdit(d,next);d.nodes[id]=next; } }); },
    setRole(role:'solid'|'hole',ids:readonly string[]=selection){commit('Change solid/hole role',d=>{const chosen=[...new Set(ids)];if(!chosen.length||!chosen.every(id=>d.roots.includes(id)))throw new Error(t('Select a top-level body'));if(chosen.some(id=>d.nodes[id].reference))throw new Error(t('Reference helpers cannot be hole cutters'));if(role==='hole'&&d.joints?.some(j=>chosen.includes(j.bodyA)||chosen.includes(j.bodyB)))throw new Error(t('Detach the selected bodies’ joints before changing them to holes'));d.version=Math.max(d.version,7) as CadDocument['version'];for(const id of chosen)d.nodes[id]={...d.nodes[id],role};pruneDocument(d);});},
    combine(operation: 'union' | 'subtract' | 'intersect', ids: readonly string[] = selection) {
      const chosen = [...new Set(ids)]; const id = newId();
      commit(operation === 'subtract' ? 'Subtract (first selected is the base)' : operation, d => {
        if (chosen.length < 2 || !chosen.every(x => d.roots.includes(x))) throw new Error(t('Select at least two top-level bodies'));
        if (chosen.some(x => d.nodes[x].reference)) throw new Error(t('Reference helpers cannot be combined into printable solids'));
        if (d.joints?.some(j => chosen.includes(j.bodyA) || chosen.includes(j.bodyB))) throw new Error(t('Detach the selected bodies’ joints before combining them'));
        const holes=operation==='union'?chosen.filter(id=>d.nodes[id].role==='hole'):[],solids=chosen.filter(id=>!holes.includes(id)),useHoleRoles=holes.length>0;
        const materialIds=solids.length?solids:chosen,first=materialIds[0];
        const material = d.nodes[first].physics ?? defaultPartPhysics();
        if(materialIds.some(x=>{const p=d.nodes[x].physics??defaultPartPhysics();return p.densityKgM3!==material.densityKgM3||p.friction!==material.friction||p.restitution!==material.restitution||p.motion!==material.motion;}))throw new Error(t('Combined solids must share density, contact material and motion type. Keep different materials as separate bodies.'));
        d.nodes[id] = { id, kind: 'boolean', operation, inputs: chosen,...(useHoleRoles?{useHoleRoles:true,...(!solids.length?{role:'hole' as const}:{})}:{}), name: operation[0].toUpperCase() + operation.slice(1), color: d.nodes[first].color, transform: identityTransform(), physics:{...material,intent:'rigid',parameters:undefined,sourcePreset:undefined,collisionHint:undefined} };
        if(useHoleRoles)d.version=Math.max(d.version,7) as CadDocument['version'];
        const at = Math.min(...chosen.map(x => d.roots.indexOf(x)));
        d.roots = d.roots.filter(x => !chosen.includes(x)); d.roots.splice(at, 0, id); return [id];
      }); return id;
    },
    separate(id: string) { commit('Separate operands', d => {
      const node = d.nodes[id]; if (node?.kind !== 'boolean' || !d.roots.includes(id)) throw new Error(t('Select a top-level operation'));
      if(d.joints?.some(j=>j.bodyA===id||j.bodyB===id))throw new Error(t('Detach this body’s joints before separating its operands'));
      if (JSON.stringify(node.transform) !== JSON.stringify(identityTransform())) throw new Error(t('Reset the operation transform before separating its operands'));
      if(d.version>=5&&node.provenance)for(const child of node.inputs)d.nodes[child].provenance=[...new Set([...(d.nodes[child].provenance??[]),...node.provenance])];
      d.roots.splice(d.roots.indexOf(id), 1, ...node.inputs); delete d.nodes[id];pruneModelProvenance(d);if(d.parametric)d.parametric.bindings=d.parametric.bindings.filter(b=>b.nodeId!==id); return [...node.inputs];
    }); },
    duplicate(ids: readonly string[] = selection) { commit('Duplicate', d => {
      const roots = ids.filter(id => d.roots.includes(id)); if (!roots.length) throw new Error(t('Select a top-level body'));
      const sourceBindings=d.parametric?.bindings.slice()??[];
      const copied: string[] = []; const copiedSketches=new Map<string,string>(); const allCopied = new Map<string,string>();
      for (const root of roots) {
        const map = new Map<string, string>();
        const copy = (id: string): string => {
          if (map.has(id)) return map.get(id)!;
          const next = newId(); map.set(id, next); const n = cloneNode(d.nodes[id]); n.id = next;
          if (n.kind === 'boolean') n.inputs = n.inputs.map(copy);
          if(n.kind==='mirror'||n.kind==='pattern')n.source=copy(n.source);
          if(isSketchFeature(n)){let sketchId=copiedSketches.get(n.sketchId);if(!sketchId){sketchId=newId();copiedSketches.set(n.sketchId,sketchId);const sketch=structuredClone(d.sketches![n.sketchId]);sketch.id=sketchId;sketch.profile.id=newId();d.sketches![sketchId]=sketch;}n.sketchId=sketchId;}
          d.nodes[next] = n; return next;
        };
        const id = copy(root); const n = d.nodes[id]; n.name=uniqueObjectName(n.name.replace(/(?: copy| Kopie)(?: \d+)?$/,'')+t(' copy'),new Set(d.roots.map(id=>d.nodes[id].name))); n.transform.position[0] += 10; d.roots.push(id); copied.push(id); for(const [old,next] of map)allCopied.set(old,next);
        if(d.parametric)d.parametric.bindings.push(...sourceBindings.filter(b=>map.has(b.nodeId)).map(b=>({...b,nodeId:map.get(b.nodeId)!,expression:b.nodeId===root&&b.property==='positionX'?offsetPositionExpression(b.expression,d.parametric!,10):b.expression})));
      }
      if(d.version>=8&&d.tracers){const sourceTraces=d.tracers.slice();d.tracers.push(...sourceTraces.filter(trace=>allCopied.has(trace.bodyId)).map(trace=>({...structuredClone(trace),id:newId(),bodyId:allCopied.get(trace.bodyId)!})));}
      if(d.joints)d.joints.push(...copyAssemblyJoints(d.joints.filter(j=>roots.includes(j.bodyA)&&roots.includes(j.bodyB)),allCopied,d.joints));
      return copied;
    }); },
    remove(ids: readonly string[] = selection,title='Delete') { commit(title, d => {
      if (!ids.some(id => d.roots.includes(id))) throw new Error(t('Select a top-level body'));
      d.roots = d.roots.filter(id => !ids.includes(id)); if(d.joints)d.joints=d.joints.filter(j=>d.roots.includes(j.bodyA)&&d.roots.includes(j.bodyB)); pruneDocument(d); return [];
    }); },
    setInitialVelocity(bodyId:string,linear:Vec3,angular:Vec3){commit('Set initial velocity',d=>{upgradeSimulation(d);if(!d.roots.includes(bodyId))throw new Error(t('Select a top-level body'));d.nodes[bodyId].physics={...(d.nodes[bodyId].physics??defaultPartPhysics()),initialVelocityMmS:[...linear],initialAngularVelocityDps:[...angular]};});},
    setSimulation(settings:SimulationSettings){commit('Configure simulation',d=>{upgradeSimulation(d);d.simulation=structuredClone(settings);});},
    applyPhysicsMaterial(materialId:string,ids:readonly string[]=selection){commit('Change physics material',d=>{if(!ids.length)throw new Error(t('Select a top-level body'));for(const id of ids){if(!d.roots.includes(id)||d.nodes[id].reference||d.nodes[id].role==='hole')throw new Error(t('Select a top-level body'));d.nodes[id].physics=materialPhysics(d.nodes[id].physics??defaultPartPhysics(),materialId);}});},
    addJoint(kind:CadJoint['kind'],bodyA:string,bodyB:string,anchor:Vec3,axis:Vec3,options:{limits?:[number,number];coneAngle?:number}={}){let id='';commit('Add connector',d=>{upgradeSimulation(d);const joint=jointAtWorldFrame(d,kind,bodyA,bodyB,anchor,axis,options);if(['hinge','slider'].includes(kind))joint.control={port:allocateMotorPort(d.joints??[])};id=joint.id;(d.joints??=[]).push(joint);});return id;},
    moveJoint(id:string,anchor:Vec3,axis:Vec3){commit('Move connector',d=>{const joint=d.joints?.find(j=>j.id===id);if(!joint)throw new Error(t('Unknown connector'));const next=jointAtWorldFrame(d,joint.kind,joint.bodyA,joint.bodyB,anchor,axis);for(const key of ['anchorA','anchorB','axisA','axisB'] as const)joint[key]=next[key];});},
    updateJoint(id:string,patch:Partial<Pick<CadJoint,'limits'|'coneAngle'|'collideConnected'>>){commit('Edit connector',d=>{const joint=d.joints?.find(j=>j.id===id);if(!joint)throw new Error(t('Unknown connector'));Object.assign(joint,structuredClone(patch));});},
    removeJoint(id:string){commit('Remove connector',d=>{d.joints=d.joints?.filter(j=>j.id!==id);});},
    addTracer(bodyId:string,point:Vec3,color='#ef8354'){let id='';commit('Add motion tracer',d=>{upgradeSimulation(d);id=newId();(d.tracers??=[]).push({id,bodyId,point:[...point],color});});return id;},
    removeTracer(id:string){commit('Remove motion tracer',d=>{if(d.version>=8)d.tracers=d.tracers?.filter(trace=>trace.id!==id);});},
    setMotorPort(jointId:string,port:string|null){commit('Configure motor port',d=>{const joint=d.joints?.find(j=>j.id===jointId);if(!joint||!['hinge','slider'].includes(joint.kind))throw new Error(t('Unknown hinge joint'));if(port===null)delete joint.control;else joint.control={port};});},
    detachJoints(ids: readonly string[] = selection) { commit('Detach joints',d=>{if(d.joints)d.joints=d.joints.filter(j=>!ids.includes(j.bodyA)&&!ids.includes(j.bodyB));}); },
    undo() { const prev = undo.pop(); if (!prev) return; redo.push(snapshot()); ({ document, selection, label } = prev); revision++; emit(); },
    redo() { const next = redo.pop(); if (!next) return; undo.push(snapshot()); ({ document, selection, label } = next); revision++; emit(); },
    load(next: CadDocument | string) {
      const validated = freezeDocument(typeof next === 'string' ? parseDocument(next) : validateDocument(next));
      document = validated;liveModelSource=false; selection = []; undo.length = 0; redo.length = 0; label = 'Opened'; revision++; emit();
    },
    serialize() { return serializeDocument(document); },
    dispose() { listeners.clear(); undo.length = 0; redo.length = 0; },
  };
  return session;
}
export type CadSession = ReturnType<typeof createCadSession>;
