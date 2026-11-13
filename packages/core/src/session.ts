// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import type {ModelProvenanceRecord} from './model-provenance.js';
import {assertProvenanceUpgrade,pruneModelProvenance} from './model-provenance.js';
import { checkDocument, createDocument, freezeDocument, identityTransform, newId, parseDocument, pruneDocument, serializeDocument, validateDocument } from './document.js';
import type { CadDocument, Primitive, SolidNode, Transform, Vec3 } from './document.js';
import { defaultPartPhysics } from './physics.js';
import { applyParametricBindings, assertDrivenEdit } from './parameters.js';
import type {CodeProgram} from './code.js';
import type {PlanarSketch,SketchProfile,FeatureScalar} from './features.js';
import type { ParametricDesign } from './parameters.js';
import {mergeFragmentParameters,selectionFragment,uniqueObjectName,offsetPositionExpression} from './fragments.js';
export interface SessionState { document: CadDocument; selection: readonly string[]; revision: number; canUndo: boolean; canRedo: boolean; label: string }
const cloneNode = (node: SolidNode): SolidNode => ({ ...node,
  ...(node.provenance!==undefined?{provenance:structuredClone(node.provenance)}:{}),
  transform: { position: [...node.transform.position], rotation: [...node.transform.rotation], scale: [...node.transform.scale] },
  ...(node.kind === 'box' ? { size: [...node.size] } : {}),
  ...(node.kind === 'boolean' ? { inputs: [...node.inputs] } : {}),
}) as SolidNode;
const equivalent = (a: SolidNode, b: SolidNode) => {
  if (a.kind === 'mesh' && b.kind === 'mesh') {
    if (a.positions !== b.positions || a.indices !== b.indices) return false;
    return JSON.stringify({ ...a, positions: null, indices: null }) === JSON.stringify({ ...b, positions: null, indices: null });
  }
  return JSON.stringify(a) === JSON.stringify(b);
};
type Snapshot = { document: CadDocument; selection: string[]; label: string };
function guardConstructionEdit(doc:CadDocument,id:string){
  for(const root of Object.values(doc.nodes)){if(!root.generator||root.id===id)continue;const visited=new Set<string>();const contains=(key:string):boolean=>{if(key===id)return true;if(visited.has(key))return false;visited.add(key);const n=doc.nodes[key];return n.kind==='boolean'&&n.inputs.some(contains);};if(contains(root.id))throw new Error(t`Edit ${root.name} through its shape parameters, or detach its generator first`);}
}
function editSketch(d:CadDocument,id:string,patch:Partial<Pick<PlanarSketch,'name'|'plane'|'profile'>>) {
  const sketch=d.sketches?.[id];if(!sketch)throw new Error(t('Sketch does not exist'));
  const uses=(key:string):boolean=>{const n=d.nodes[key];return n.kind==='extrusion'?n.sketchId===id:n.kind==='boolean'&&n.inputs.some(uses);};
  if(d.joints?.some(j=>uses(j.bodyA)||uses(j.bodyB)))throw new Error(t('Detach joints before editing their sketches'));
  const next={...sketch,...structuredClone(patch)};if(next.profile.id!==sketch.profile.id||next.profile.kind!==sketch.profile.kind)throw new Error(t('Keep sketch profile identity and kind when editing'));d.sketches![id]=next;
}
export function createCadSession(initial: CadDocument = createDocument()) {
  let document = freezeDocument(validateDocument(initial)); let selection: string[] = []; let revision = 0; let label = 'Opened';
  const undo: Snapshot[] = []; const redo: Snapshot[] = []; const listeners = new Set<(state: SessionState) => void>();
  const state = (): SessionState => ({ document, selection: Object.freeze([...selection]), revision, canUndo: !!undo.length, canRedo: !!redo.length, label });
  const emit = () => { for (const listener of [...listeners]) listener(state()); };
  const snapshot = (): Snapshot => ({ document, selection: [...selection], label });
  function commit(title: string, edit: (draft: CadDocument) => string[] | void) {
    const draft = { ...document, roots: [...document.roots], ...(document.joints ? {joints: structuredClone(document.joints)} : {}), ...(document.parametric ? {parametric:structuredClone(document.parametric)} : {}), ...(document.sketches?{sketches:structuredClone(document.sketches)}:{}), nodes: Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [id, cloneNode(node)])) };
    const nextSelection = edit(draft);
    applyParametricBindings(draft);
    checkDocument(draft);
    for (const [id, node] of Object.entries(draft.nodes)) {
      const previous = document.nodes[id];
      if (previous && equivalent(node, previous)) draft.nodes[id] = previous;
    }
    if (JSON.stringify(draft.provenance) === JSON.stringify(document.provenance) && draft.version === document.version && JSON.stringify(draft.sketches)===JSON.stringify(document.sketches) && JSON.stringify(draft.parametric) === JSON.stringify(document.parametric) && draft.title === document.title && JSON.stringify(draft.roots) === JSON.stringify(document.roots) && JSON.stringify(draft.joints) === JSON.stringify(document.joints) && Object.keys(draft.nodes).length === Object.keys(document.nodes).length && Object.entries(draft.nodes).every(([id, node]) => document.nodes[id] === node)) return;
    const validated = freezeDocument(draft);
    undo.push(snapshot()); if (undo.length > 100) undo.shift(); redo.length = 0;
    document = validated; selection = nextSelection ?? selection.filter(id => !!document.nodes[id]); label = title; revision++; emit();
  }
  const session = {
    get state() { return state(); },
    subscribe(listener: (state: SessionState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select(ids: readonly string[]) { selection = [...new Set(ids)].filter(id => Object.hasOwn(document.nodes, id)); emit(); },
    /** Record reviewed source metadata for existing geometry; no fetching or insertion. */
    attachProvenance(ids:readonly string[],record:ModelProvenanceRecord) {commit('Record model provenance',d=>{
      if(!ids.length||!ids.every(id=>Object.hasOwn(d.nodes,id)))throw new Error('Select existing objects for model provenance');
      assertProvenanceUpgrade(d);
      const source=structuredClone(record),existing=d.provenance?.records.find(r=>r.id===source.id);
      if(existing&&JSON.stringify(existing)!==JSON.stringify(source))throw new Error('Source record identity already exists with different metadata');
      d.version=5;d.provenance={version:1,records:[...(d.provenance?.records??[]),...(existing?[]:[source])]};
      for(const id of ids)d.nodes[id].provenance=[...new Set([...(d.nodes[id].provenance??[]),source.id])];
    });},
    rename(title: string) { commit('Rename design', d => { d.title = title; }); },
    setParametric(design: ParametricDesign) {commit('Edit parameters',d=>{if(d.version===1)d.version=2;d.parametric=structuredClone(design);});},
    detachGenerator(id:string){commit('Detach shape generator',d=>{if(!d.nodes[id]?.generator)throw new Error(t('No generator to detach'));delete d.nodes[id].generator;if(d.nodes[id].physics)d.nodes[id].physics={...d.nodes[id].physics!,sourcePreset:undefined};});},
    replaceGenerated(id:string,fragment:CadDocument){
      const source=validateDocument(fragment);if(source.roots.length!==1||source.joints?.length||source.parametric||source.sketches||(source.version===5&&source.provenance))throw new Error(t('Expected one generated body'));
      commit('Edit shape parameters',d=>{
        if(d.version===5)assertProvenanceUpgrade(source);
        const previous=d.nodes[id];if(!previous)throw new Error(t('Object does not exist'));
        const descendants=new Set<string>();const walk=(key:string)=>{if(descendants.has(key))return;descendants.add(key);const n=d.nodes[key];if(n.kind==='boolean')n.inputs.forEach(walk);};walk(id);
        if(d.parametric?.bindings.some(b=>descendants.has(b.nodeId)&&b.nodeId!==id))throw new Error(t('Detach driving expressions on the construction operands before regenerating'));
        const connected=(key:string,seen=new Set<string>()):boolean=>{if(key===id)return true;if(seen.has(key))return false;seen.add(key);const n=d.nodes[key];return n?.kind==='boolean'&&n.inputs.some(child=>connected(child,seen));};
        if(d.joints?.some(j=>connected(j.bodyA)||connected(j.bodyB)))throw new Error(t('Detach joints before regenerating their bodies'));
        const map=new Map(Object.keys(source.nodes).map(key=>[key,key===source.roots[0]?id:newId()]));
        for(const [key,node] of Object.entries(source.nodes)){const next=cloneNode(node);next.id=map.get(key)!;if(next.kind==='boolean')next.inputs=next.inputs.map(input=>map.get(input)!);d.nodes[next.id]=next;}
        const retained=d.version===5?[...new Set([...descendants].flatMap(key=>document.nodes[key]?.provenance??[]))]:[];
        if(d.version<5&&Object.hasOwn(previous,'provenance'))d.nodes[id].provenance=structuredClone(previous.provenance);
        const next=d.nodes[id];if(retained.length)next.provenance=retained;next.name=previous.name;next.color=previous.color;next.transform=structuredClone(previous.transform);
        if(previous.physics&&next.physics)next.physics={...next.physics,densityKgM3:previous.physics.densityKgM3,friction:previous.physics.friction,restitution:previous.physics.restitution,motion:previous.physics.motion};
        if(d.version===1)d.version=2;pruneDocument(d);return [id];
      });
    },
    addCode(program:CodeProgram,name='Code object',options:{position?:Vec3}={}){const id=newId();commit('Add code object',d=>{d.version=Math.max(d.version,4) as CadDocument['version'];d.nodes[id]={id,kind:'code',program:structuredClone(program),name:uniqueObjectName(name,new Set(d.roots.map(key=>d.nodes[key].name))),color:'#76b7ce',transform:{...identityTransform(),position:options.position??[0,0,0]}};d.roots.push(id);return [id];});return id;},
    updateCode(id:string,program:CodeProgram){commit('Edit code object',d=>{if(d.nodes[id]?.kind!=='code')throw new Error(t('Select a code object'));guardConstructionEdit(d,id);d.nodes[id]={...d.nodes[id],program:structuredClone(program)};});},
    addSketch(profile:SketchProfile,options:{name?:string;plane?:PlanarSketch['plane']}={}) {const id=newId();commit('Add sketch',d=>{d.version=Math.max(d.version,3) as CadDocument['version'];d.sketches??={};d.sketches[id]={version:1,id,name:options.name??'Sketch',plane:options.plane??'XY',profile:structuredClone(profile)};});return id;},
    extrudeSketch(sketchId:string,options:{distance?:FeatureScalar;symmetric?:boolean}={}) {const id=newId();commit('Extrude sketch',d=>{
      d.version=Math.max(d.version,3) as CadDocument['version'];d.nodes[id]={id,kind:'extrusion',featureVersion:1,sketchId,distance:options.distance??10,symmetric:options.symmetric??false,name:uniqueObjectName(t('Extrusion'),new Set(d.roots.map(key=>d.nodes[key].name))),color:'#eea52b',transform:identityTransform()};d.roots.push(id);return [id];});return id;},
    addSketchExtrusion(profile:SketchProfile,options:{name?:string;plane?:PlanarSketch['plane'];distance?:FeatureScalar;symmetric?:boolean;position?:Vec3}={}) {
      const sketchId=newId(),id=newId();
      commit('Add sketch extrusion',d=>{d.version=Math.max(d.version,3) as CadDocument['version'];d.sketches??={};d.sketches[sketchId]={version:1,id:sketchId,name:options.name??'Sketch',plane:options.plane??'XY',profile:structuredClone(profile)};
        d.nodes[id]={id,kind:'extrusion',featureVersion:1,sketchId,distance:options.distance??10,symmetric:options.symmetric??false,name:uniqueObjectName(t('Extrusion'),new Set(d.roots.map(id=>d.nodes[id].name))),color:'#eea52b',transform:{...identityTransform(),position:options.position??[0,0,0]}};d.roots.push(id);return [id];});return id;
    },
    updateSketch(id:string,patch:Partial<Pick<PlanarSketch,'name'|'plane'|'profile'>>) {commit('Edit sketch',d=>{editSketch(d,id,patch);});},
    editExtrusion(id:string,inputs:{sketch?:Partial<Pick<PlanarSketch,'name'|'plane'|'profile'>>;distance:FeatureScalar;symmetric:boolean}) {commit('Edit sketch extrusion',d=>{
      const n=d.nodes[id];if(n?.kind!=='extrusion')throw new Error(t('Object is not an extrusion'));guardConstructionEdit(d,id);
      if(inputs.sketch)editSketch(d,n.sketchId,inputs.sketch);n.distance=inputs.distance;n.symmetric=inputs.symmetric;
    });},
    fragment(ids:readonly string[]=selection){return selectionFragment(document,ids);},
    insert(fragment: CadDocument, offset: [number, number, number] = [0, 0, 0],options:{mergeParameters?:boolean;label?:string}={}) {
      const source = validateDocument(fragment); const ids = new Map(Object.keys(source.nodes).map(id => [id, newId()]));
      if(source.parametric&&!options.mergeParameters)throw new Error(t('Enable parameter namespace merging when inserting a parametric model'));
      commit(options.label??'Add shape', d => {
        if(Math.max(d.version,source.version)===5){assertProvenanceUpgrade(d);assertProvenanceUpgrade(source);}
        d.version=Math.max(d.version,source.version) as CadDocument['version'];
        const provenanceIds=new Map((source.version===5?source.provenance?.records??[]:[]).map(r=>[r.id,newId()]));
        if(source.version===5&&source.provenance)d.provenance={version:1,records:[...(d.provenance?.records??[]),...source.provenance.records.map(r=>({...structuredClone(r),id:provenanceIds.get(r.id)!}))]};
        const sketches=new Map(Object.keys(source.sketches??{}).map(id=>[id,newId()]));
        for(const [id,sketch] of Object.entries(source.sketches??{})){d.sketches??={};const next=structuredClone(sketch);next.id=sketches.get(id)!;next.profile.id=newId();d.sketches[next.id]=next;}
        const names=new Set(d.roots.map(id=>d.nodes[id].name));
        for (const [id, original] of Object.entries(source.nodes)) { const node = cloneNode(original); if(source.version===5&&node.provenance)node.provenance=node.provenance.map(ref=>provenanceIds.get(ref)!); node.id = ids.get(id)!; if(node.kind==='extrusion')node.sketchId=sketches.get(node.sketchId)!; if (node.kind === 'boolean') node.inputs = node.inputs.map(input => ids.get(input)!); if (source.roots.includes(id)) node.transform.position = node.transform.position.map((v, i) => v + offset[i]) as [number, number, number]; d.nodes[node.id] = node; }
        const roots = source.roots.map(id => ids.get(id)!); d.roots.push(...roots);
        for(const id of roots){d.nodes[id].name=uniqueObjectName(d.nodes[id].name,names);names.add(d.nodes[id].name);}
        if(options.mergeParameters)mergeFragmentParameters(d,source,ids,offset,sketches);
        if (source.joints?.length) d.joints = [...(d.joints ?? []), ...source.joints.map(j => ({...structuredClone(j),id:newId(),bodyA:ids.get(j.bodyA)!,bodyB:ids.get(j.bodyB)!}))];
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
      if(d.version===5&&'provenance' in patch)throw new Error('Use attachProvenance to record sources');
      if('program' in patch)throw new Error(t('Use updateCode to edit a code program'));
      if(patch.generator)throw new Error(t('Use shape regeneration to change generator inputs'));
      // Kind and identity cannot be changed by inspector edits.
      if ((patch.id && patch.id !== id) || (patch.kind && patch.kind !== d.nodes[id].kind)) throw new Error(t('Cannot change object identity or kind'));
      const next = { ...d.nodes[id], ...structuredClone(patch) } as SolidNode;
      assertDrivenEdit(d,next); d.nodes[id] = next;
    }); },
    transform(updates: Array<{ id: string; transform: Transform }>) { commit('Transform selection', d => { for (const { id, transform } of updates) { if (!d.nodes[id]) throw new Error(t('Object does not exist'));guardConstructionEdit(d,id); const next={...d.nodes[id],transform:structuredClone(transform)};assertDrivenEdit(d,next);d.nodes[id]=next; } }); },
    combine(operation: 'union' | 'subtract' | 'intersect', ids: readonly string[] = selection) {
      const chosen = [...new Set(ids)]; const id = newId();
      commit(operation === 'subtract' ? 'Subtract (first selected is the base)' : operation, d => {
        if (chosen.length < 2 || !chosen.every(x => d.roots.includes(x))) throw new Error(t('Select at least two top-level bodies'));
        if (chosen.some(x => d.nodes[x].reference)) throw new Error(t('Reference helpers cannot be combined into printable solids'));
        if (d.joints?.some(j => chosen.includes(j.bodyA) || chosen.includes(j.bodyB))) throw new Error(t('Detach the selected bodies’ joints before combining them'));
        const material = d.nodes[chosen[0]].physics ?? defaultPartPhysics();
        if(chosen.some(x=>{const p=d.nodes[x].physics??defaultPartPhysics();return p.densityKgM3!==material.densityKgM3||p.friction!==material.friction||p.restitution!==material.restitution||p.motion!==material.motion;}))throw new Error(t('Combined solids must share density, contact material and motion type. Keep different materials as separate bodies.'));
        d.nodes[id] = { id, kind: 'boolean', operation, inputs: chosen, name: operation[0].toUpperCase() + operation.slice(1), color: d.nodes[chosen[0]].color, transform: identityTransform(), physics:{...material,intent:'rigid',parameters:undefined,sourcePreset:undefined,collisionHint:undefined} };
        const at = Math.min(...chosen.map(x => d.roots.indexOf(x)));
        d.roots = d.roots.filter(x => !chosen.includes(x)); d.roots.splice(at, 0, id); return [id];
      }); return id;
    },
    separate(id: string) { commit('Separate operands', d => {
      const node = d.nodes[id]; if (node?.kind !== 'boolean' || !d.roots.includes(id)) throw new Error(t('Select a top-level operation'));
      if(d.joints?.some(j=>j.bodyA===id||j.bodyB===id))throw new Error(t('Detach this body’s joints before separating its operands'));
      if (JSON.stringify(node.transform) !== JSON.stringify(identityTransform())) throw new Error(t('Reset the operation transform before separating its operands'));
      if(d.version===5&&node.provenance)for(const child of node.inputs)d.nodes[child].provenance=[...new Set([...(d.nodes[child].provenance??[]),...node.provenance])];
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
          if(n.kind==='extrusion'){let sketchId=copiedSketches.get(n.sketchId);if(!sketchId){sketchId=newId();copiedSketches.set(n.sketchId,sketchId);const sketch=structuredClone(d.sketches![n.sketchId]);sketch.id=sketchId;sketch.profile.id=newId();d.sketches![sketchId]=sketch;}n.sketchId=sketchId;}
          d.nodes[next] = n; return next;
        };
        const id = copy(root); const n = d.nodes[id]; n.name=uniqueObjectName(n.name.replace(/(?: copy| Kopie)(?: \d+)?$/,'')+t(' copy'),new Set(d.roots.map(id=>d.nodes[id].name))); n.transform.position[0] += 10; d.roots.push(id); copied.push(id); for(const [old,next] of map)allCopied.set(old,next);
        if(d.parametric)d.parametric.bindings.push(...sourceBindings.filter(b=>map.has(b.nodeId)).map(b=>({...b,nodeId:map.get(b.nodeId)!,expression:b.nodeId===root&&b.property==='positionX'?offsetPositionExpression(b.expression,d.parametric!,10):b.expression})));
      }
      if(d.joints)d.joints.push(...d.joints.filter(j=>roots.includes(j.bodyA)&&roots.includes(j.bodyB)).map(j=>({...structuredClone(j),id:newId(),bodyA:allCopied.get(j.bodyA)!,bodyB:allCopied.get(j.bodyB)!})));
      return copied;
    }); },
    remove(ids: readonly string[] = selection,title='Delete') { commit(title, d => {
      if (!ids.some(id => d.roots.includes(id))) throw new Error(t('Select a top-level body'));
      d.roots = d.roots.filter(id => !ids.includes(id)); if(d.joints)d.joints=d.joints.filter(j=>d.roots.includes(j.bodyA)&&d.roots.includes(j.bodyB)); pruneDocument(d); return [];
    }); },
    detachJoints(ids: readonly string[] = selection) { commit('Detach joints',d=>{if(d.joints)d.joints=d.joints.filter(j=>!ids.includes(j.bodyA)&&!ids.includes(j.bodyB));}); },
    undo() { const prev = undo.pop(); if (!prev) return; redo.push(snapshot()); ({ document, selection, label } = prev); revision++; emit(); },
    redo() { const next = redo.pop(); if (!next) return; undo.push(snapshot()); ({ document, selection, label } = next); revision++; emit(); },
    load(next: CadDocument | string) {
      const validated = freezeDocument(typeof next === 'string' ? parseDocument(next) : validateDocument(next));
      document = validated; selection = []; undo.length = 0; redo.length = 0; label = 'Opened'; revision++; emit();
    },
    serialize() { return serializeDocument(document); },
    dispose() { listeners.clear(); undo.length = 0; redo.length = 0; },
  };
  return session;
}
export type CadSession = ReturnType<typeof createCadSession>;
