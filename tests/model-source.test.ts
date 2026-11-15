// SPDX-License-Identifier: BSD-3-Clause
import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {createCadSession,generateModelSource,compileModelSource,updateModelSource,validateDocument,modelSourceEntityAt,modelSourceEntityRange,defaultCodeProgram} from '@brickwright/cad-core';
const base=()=>{const session=createCadSession();const id=session.add({kind:'box',size:[10,20,30]});return {session,id};};
it('round-trips retained features, formula bindings, embedded native source and metadata',()=>{
 const {session,id}=base();session.setParametric({version:1,parameters:{width:{unit:'mm',expression:'40'}},bindings:[{nodeId:id,property:'width',expression:'width'}]});session.addSketchExtrusion({kind:'rectangle',id:'profile',width:'width',depth:10},{distance:'width/2'});session.addCode(defaultCodeProgram());
 const source=generateModelSource(session.state.document),candidate=compileModelSource(source,session.state.document);expect(candidate.version).toBe(6);expect(source).toContain('expr("width")');expect(source).toContain('cad`');expect(validateDocument(candidate).nodes).toEqual(session.state.document.nodes);expect(candidate.sketches).toEqual(session.state.document.sketches);expect(candidate.parametric).toEqual(session.state.document.parametric);
});
it('patches existing argument values and appends new calls while retaining unrelated comments and quotes',()=>{
 const {session,id}=base(),source=generateModelSource(session.state.document).replace('size: [10, 20, 30]', 'size: [10, /* depth note */ 20, 30]')+'// keep my footer\n';session.update(id,{size:[40,20,30]});const patched=updateModelSource(source,session.state.document);expect(patched).toContain('size: [40, /* depth note */ 20, 30]');expect(patched).toContain('// keep my footer');
 const second=session.add({kind:'sphere',radius:4,segments:24}),next=updateModelSource(patched,session.state.document);expect(next).toContain(`sphere("${second}"`);expect(validateDocument(compileModelSource(next,session.state.document)).roots).toEqual([id,second]);
 const range=modelSourceEntityRange(next,id)!;expect(modelSourceEntityAt(next,range[0]+2)).toBe(id);
});
it('recomputes GUI dimensions from source expressions rather than baking a parameter edit',()=>{
 const {session,id}=base();session.setParametric({version:1,parameters:{width:{unit:'mm',expression:'40'}},bindings:[{nodeId:id,property:'width',expression:'width'}]});
 const source=generateModelSource(session.state.document).replace('expression: "40"','expression: "60"'),candidate=compileModelSource(source,session.state.document);expect((candidate.nodes[id] as any).size[0]).toBe(60);expect(candidate.parametric!.bindings[0].expression).toBe('width');expect(validateDocument(candidate).modelSource!.source).toBe(source);
});
it('rejects executable JavaScript, forged source, duplicate records and project identity changes',()=>{
 const {session}=base(),doc=session.state.document,source=generateModelSource(doc);
 for(const text of [source+'fetch("x");',source+'while(true){}',source+'box("extra",{size:[1,2,3],name:process.exit()});',source.replace('size: [10, 20, 30]','size: [1,2,3], size: [4,5,6]'),source.replace(doc.id,'other-project')])expect(()=>validateDocument(compileModelSource(text,doc)),text).toThrow();
 const candidate=compileModelSource(source,doc);(candidate.nodes[doc.roots[0]] as any).size[0]=50;expect(()=>validateDocument(candidate)).toThrow('stale');
});
it('gives source edits and GUI edits one transaction each, with undo/redo and stale draft protection',()=>{
 const {session,id}=base();session.enableModelSource();const start=session.state.revision,source=session.modelSource;
 session.update(id,{size:[40,20,30]});expect(session.state.revision).toBe(start+1);expect(session.modelSource).toContain('size: [40, 20, 30]');
 const edited=session.modelSource.replace('size: [40, 20, 30]','size: [60, 20, 30]'),prepared=session.prepareModelSource(edited,{expectedRevision:session.state.revision});expect((session.state.document.nodes[id] as any).size[0]).toBe(40);
 session.applyPreparedModelSource(prepared);expect(session.state.revision).toBe(start+2);expect((session.state.document.nodes[id] as any).size[0]).toBe(60);session.undo();expect((session.state.document.nodes[id] as any).size[0]).toBe(40);session.redo();expect(session.modelSource).toContain('size: [60, 20, 30]');
 const stale=session.prepareModelSource(session.modelSource);session.rename('changed');expect(()=>session.applyPreparedModelSource(stale)).toThrow('changed');
 expect(()=>session.applyPreparedModelSource({document:session.state.document,revision:session.state.revision})).toThrow();expect(source).toContain('size: [10, 20, 30]');
});
it('keeps source valid through duplicate/delete, booleans and clipboard fragments',()=>{
 const {session,id}=base();session.enableModelSource();session.select([id]);session.duplicate();const copied=session.state.selection[0];expect(session.modelSource).toContain(copied);validateDocument(session.state.document);
 const fragment=session.fragment([copied]);expect(fragment.roots).toEqual([copied]);validateDocument(fragment);const combined=session.combine('union',[id,copied]);expect(session.modelSource).toContain('combine(');validateDocument(session.state.document);session.separate(combined);validateDocument(session.state.document);session.remove([copied]);expect(session.modelSource).not.toContain(`box("${copied}"`);
});
it('retains source through portable history revisions and restores comments with the graph',async()=>{
 const {openHistoryStore}=await import('@brickwright/cad-history'),{session,id}=base();session.enableModelSource();const first=session.modelSource+'// my model note\n';session.applyModelSource(first);const store=await openHistoryStore('model-source-'+crypto.randomUUID());const a=await store.append(session.state.document,'Source note');session.update(id,{size:[20,20,30]});await store.append(session.state.document,'GUI size');
 const imported=await store.importArchive(await store.exportArchive(session.state.document.id));expect((await store.readDocument(imported.headId)).modelSource!.source).toContain('// my model note');session.load(await store.readDocument(a.id));expect(session.modelSource).toContain('size: [10, 20, 30]');expect(session.modelSource).toContain('// my model note');await store.close();
});
it('regenerates a changed recipe through the same host builder and rejects protected child edits',async()=>{
 const {createPresetDocument}=await import('../packages/editor/src/shapes.js');const session=createCadSession(createPresetDocument('heart'));session.enableModelSource();const id=session.state.document.roots[0],node=session.state.document.nodes[id];const before=session.modelSource,edited=before.replace('width: 34','width: 40');
 expect(()=>session.prepareModelSource(edited)).toThrow('callback');session.applyModelSource(edited,{regenerate:recipe=>createPresetDocument(recipe.preset,'BRICKWRIGHT',{recipe})});expect(session.state.document.nodes[id].generator!.values.width).toBe(40);validateDocument(session.state.document);
 const child=Object.keys(session.state.document.nodes).find(key=>key!==id&&session.state.document.nodes[key].kind==='sphere');if(child){const record=modelSourceEntityRange(session.modelSource,child)!;const text=session.modelSource.slice(...record),changed=text.replace(/radius: ([0-9.]+)/,'radius: 99');expect(()=>session.prepareModelSource(session.modelSource.slice(0,record[0])+changed+session.modelSource.slice(record[1]))).toThrow('generated');}
});
it('keeps inactive conditional parameter dependencies when copying a source-backed object',()=>{
 const {session,id}=base();session.setParametric({version:1,parameters:{flag:{unit:'scalar',expression:'true'},wide:{unit:'mm',expression:'40'},narrow:{unit:'mm',expression:'20'}},bindings:[{nodeId:id,property:'width',expression:'flag ? wide : narrow'}]});session.enableModelSource();session.rename('Conditional source');const fragment=session.fragment([id]);expect(fragment.parametric!.parameters.narrow).toBeDefined();const copied=createCadSession(fragment),p=structuredClone(fragment.parametric!);p.parameters.flag.expression='false';copied.setParametric(p);expect((copied.state.document.nodes[id] as any).size[0]).toBe(20);validateDocument(copied.state.document);
});
it('retains literal native source containing template delimiters without executing interpolation',()=>{
 const {session}=base(),program=defaultCodeProgram();program.source+='\n// literal ` and ${globalThis.invalid = true} and \\ backslash\n';const id=session.addCode(program),source=generateModelSource(session.state.document);expect((compileModelSource(source,session.state.document).nodes[id] as any).program.source).toBe(program.source);expect((globalThis as any).invalid).toBeUndefined();
});
it('represents a screw as one editable generator recipe and can detach it explicitly in source',async()=>{
 const {createPresetDocument}=await import('../packages/editor/src/shapes.js');const session=createCadSession(createPresetDocument('screw')),id=session.state.document.roots[0],source=session.modelSource;
 expect(source).toContain('generated(');expect(source).not.toContain('asset(');expect(source.split('\n').length).toBeLessThan(100);const before=Object.keys(session.state.document.nodes).length,range=modelSourceEntityRange(source,id)!;
 session.applyModelSource(source.slice(0,range[0])+`generated(${JSON.stringify(id)}, {}, null);`+source.slice(range[1]));expect(session.state.document.nodes[id].generator).toBeUndefined();expect(Object.keys(session.state.document.nodes)).toHaveLength(before);expect(session.modelSource).not.toContain('generated(');validateDocument(session.state.document);
});
it('creates a generated part from source through the qualified host factory',async()=>{
 const {createPresetDocument}=await import('../packages/editor/src/shapes.js'),{defaultGenerator}=await import('@brickwright/cad-core'),session=createCadSession(),recipe=defaultGenerator('heart')!;
 const source=session.modelSource.replace('roots([]);',`generated("my_heart", {name: "My heart"}, ${JSON.stringify(recipe)});\nroots(["my_heart"]);`);
 expect(()=>session.prepareModelSource(source)).toThrow('callback');session.applyModelSource(source,{regenerate:r=>createPresetDocument(r.preset,'BRICKWRIGHT',{recipe:r})});expect(session.state.document.nodes.my_heart.generator!.preset).toBe('heart');expect(session.state.document.nodes.my_heart.name).toBe('My heart');validateDocument(session.state.document);
});
it('merges independent GUI/source edits and new parts while preserving draft comments',async()=>{
 const {mergeModelSource}=await import('@brickwright/cad-core'),{session,id}=base(),source=session.modelSource,draft=source.replace('size: [10, 20, 30]','size: [60, 20, 30]')+'\n// pending comment';session.transform([{id,transform:{position:[17,0,0],rotation:[0,0,0],scale:[1,1,1]}}]);session.add({kind:'sphere',radius:3,segments:24});
 const merged=mergeModelSource(source,draft,session.modelSource);expect(merged).toContain('position: [17,');expect(merged).toContain('size: [60, 20, 30]');expect(merged).toContain('pending comment');session.applyModelSource(merged);expect(session.state.document.roots).toHaveLength(2);expect((session.state.document.nodes[id] as any).size[0]).toBe(60);
 const before=session.modelSource,different=before.replace('size: [60, 20, 30]','size: [70, 20, 30]');session.update(id,{size:[80,20,30]});expect(()=>mergeModelSource(before,different,session.modelSource)).toThrow('same value');
 const other=createCadSession();expect(()=>mergeModelSource(before,different,other.modelSource)).toThrow('another project');
});
it('keeps mesh buffers in the project and retains attribution across the v6 source workflow',async()=>{
 const {createPresetDocument}=await import('../packages/editor/src/shapes.js'),{readFileSync}=await import('node:fs'),{hasModelAttribution}=await import('@brickwright/cad-core');
 const legacy=createPresetDocument('wedge');delete legacy.nodes[legacy.roots[0]].generator;const session=createCadSession(legacy),id=session.state.document.roots[0],asset=JSON.parse(readFileSync('library/seed-catalogue.json','utf8')).assets[0];
 session.attachProvenance([id],{id:'tracked',asset,selectedFile:asset.original,modificationNotes:'Synthetic attachment for source regression.'});session.enableModelSource();session.rename('Mesh source');const text=session.modelSource;expect(text).toContain('asset(');expect(text).not.toContain('positions:');const copy=compileModelSource(text,session.state.document);expect((copy.nodes[id] as any).positions).toEqual((session.state.document.nodes[id] as any).positions);expect(hasModelAttribution(copy)).toBe(true);
 const retained=session.prepareModelSource(text.replace(/\s*provenance: \["tracked"\],?\n/, '\n'));expect(retained.document.nodes[id].provenance).toContain('tracked');validateDocument(session.fragment([id]));
});
it('refuses opaque legacy-field upgrades and source operations that consume reference helpers',()=>{
 const {session,id}=base(),legacy:any=structuredClone(session.state.document);legacy.modelSource={privateLegacyField:'keep'};const old=createCadSession(legacy);expect(()=>old.enableModelSource()).toThrow('Legacy');expect(old.state.document).toEqual(legacy);
 const source=session.modelSource.replace('roots([',`box("helper", {size:[1,1,1],reference:true});\ncombine("combined",{operation:"union",inputs:["${id}","helper"]});\nroots([`).replace(`roots(["${id}"]);`,'roots(["combined"]);');expect(()=>session.prepareModelSource(source)).toThrow('Reference helpers');
});
