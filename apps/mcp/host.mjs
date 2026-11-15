// SPDX-License-Identifier: BSD-3-Clause
import {Worker} from 'node:worker_threads';
import {readFile,writeFile,open,rename,unlink,stat,lstat,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createCadSession,createDocument,compileCode,defaultCodeProgram,codeExamples,importOpenSCAD,getOpenSCADImportWarnings,importJSCAD,exportOpenSCAD,exportJSCAD,exportCodeSource,newId,serializeDocument,CODE_LIMITS,defaultGenerator,screwVariant,t,getLocale,hasModelAttribution,createModelAttributionSidecar,validateDocument} from '@brickwright/cad-core';
import {appendPortableRevision,readPortableHistory} from '@brickwright/cad-history';
import {createPresetDocument} from '@brickwright/cad-editor';
import {exportSTL} from '@brickwright/cad-geometry';

export const codeHelp={language:'brickwright-cad-script',version:1,example:defaultCodeProgram().source,syntax:['param name: mm|deg|scalar = expression;','let name = shape;','return shape;'],generatorRecipeTool:'cad_apply_model_source',generatorRecipeSyntax:'generated(id, metadata, recipe); roots([id]);',generatorRecipes:{cube:defaultGenerator('cube'),...Object.fromEntries(['hex-head-screw','socket-head-screw','countersunk-screw','pan-head-screw'].map(id=>[id,screwVariant(id)]))},functions:['torus(majorRadius, tubeRadius [, tubeSegments, ringSegments, tubeRotation, sweep, start])','ellipsoid(radiusX, radiusY, radiusZ [, segments])','roundedCylinder(radius, height, capHeight [, segments])','ellipticFrustum(rx0,ry0,rx1,ry1,height[,segments,startAngle,endAngle,angularSegments])','loft([[[x,y,z],...],...])','minRange(i,start,end,step[,predicate],value)','maxRange(i,start,end,step[,predicate],value)','frustum(bottom,top,height[,segments])','hull(a,...)','choose(condition,a,b)','forRange(i,start,end,step,shape)','forValues(i,[values],shape)','empty()','box(width,depth,height)','cylinder(radius,height[,segments])','sphere(radius[,segments])','extrude(height,[[x,y],...])','union(a,b,...)','subtract(base,cut,...)','intersect(a,b,...)','move([x,y,z],shape)','rotate([x,y,z],shape)','scale([x,y,z],shape)','repeat(count,[dx,dy,dz],shape)'],limits:CODE_LIMITS,notes:['// comments; unit-aware + - * / and parentheses','Named shapes and parameters can reference later declarations; cycles are refused','Code-local parameters are independent of global model parameters','One returned construction produces one rigid body','This is not JavaScript or .scad; imports, files, network and arbitrary script execution are unsupported']};
const source={type:'string',minLength:1,maxLength:32768},id={type:'string',minLength:1,maxLength:96},parameters={type:'object',additionalProperties:{type:'string',minLength:1,maxLength:256}},revision={type:'integer',minimum:1};
const spec=(name,description,properties={},required=[],readOnly=true)=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,openWorldHint:false}});
export const toolDefinitions=[
 spec('cad_code_help','Get the CAD Script grammar, modeling functions, limits and an example.'),
 spec('cad_convert_code','Convert supported OpenSCAD, JSCAD or native CAD source without changing the model.',{source,parameters,entryPoint:id,arguments:{type:'array',maxItems:64,items:{type:['number','string','boolean']}},inputFormat:{type:'string',enum:['cadcode','openscad','jscad']},outputFormat:{type:'string',enum:['cadcode','openscad','jscad']}},['source','inputFormat','outputFormat']),
 spec('cad_get_model_source','Read the current design source with stable object IDs and the current history revision.'),
 spec('cad_apply_model_source','Preflight and apply a complete declarative design edit as one saved history step.',{source:{type:'string',minLength:1,maxLength:65536},expectedRevision:revision,preview:{type:'boolean'}},['source','expectedRevision'],false),
 spec('cad_get_model','Get current revision and object metadata; call before changing the model.'),
 spec('cad_get_code_object','Read a coded feature, its source and evaluated local parameters.',{objectId:id},['objectId']),
 spec('cad_preview_code','Compile and evaluate source without modifying the model or its history.',{source,parameters},['source']),
 spec('cad_create_code_object','Create a coded body after geometry validation; append a saved iteration.',{source,parameters,name:{type:'string',minLength:1,maxLength:160},expectedRevision:revision},['source','expectedRevision'],false),
 spec('cad_update_code_object','Edit source/overrides of an existing coded body, preserving its identity, appearance and placement.',{objectId:id,source,parameters,expectedRevision:revision},['objectId','expectedRevision'],false),
 spec('cad_list_revisions','List saved revision metadata, latest first.',{beforeSerial:{type:'integer',minimum:1},limit:{type:'integer',minimum:1,maximum:100}}),
 spec('cad_restore_revision','Restore an old definition as a new iteration; retain all later work.',{revisionId:id,expectedRevision:revision},['revisionId','expectedRevision'],false),
 spec('cad_export_project','Return a complete history-inclusive .bcad archive as base64; large projects use the configured project file instead.'),
 spec('cad_export_stl','Return printable binary STL as base64. Recorded library sources automatically include a paired attribution JSON file; supply accurate modificationNotes describing changes since insertion (including when unchanged) and distribute both files together.',{modificationNotes:{type:'string',minLength:1,maxLength:4096}})
];
function validateArguments(definition,args){
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error(t('Tool arguments must be an object'));const schema=definition.inputSchema;
 for(const key of Object.keys(args))if(!Object.hasOwn(schema.properties,key))throw new Error(t`Unknown argument ${key}`);
 for(const key of schema.required)if(!Object.hasOwn(args,key))throw new Error(t`Missing argument ${key}`);
 for(const [key,value] of Object.entries(args)){const s=schema.properties[key];if(s.enum&&!s.enum.includes(value))throw new Error(t`Invalid ${key}`);if(s.type==='string'&&(typeof value!=='string'||value.length<(s.minLength??0)||value.length>(s.maxLength??Infinity)))throw new Error(t`Invalid ${key}`);
  if(s.type==='boolean'&&typeof value!=='boolean')throw new Error(t`Invalid ${key}`);
  if(s.type==='integer'&&(!Number.isSafeInteger(value)||value<(s.minimum??-Infinity)||value>(s.maximum??Infinity)))throw new Error(t`Invalid ${key}`);
  if(s.type==='array'&&(!Array.isArray(value)||value.length>s.maxItems||value.some(v=>!['number','boolean','string'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v)||typeof v==='string'&&v.length>1024)))throw new Error(t`Invalid ${key}`);
  if(s.type==='object'){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>64||Object.values(value).some(v=>typeof v!=='string'||!v.trim()||v.length>256))throw new Error(t`Invalid ${key}`);}
 }
}
function createWorkerClient(){let worker,sequence=0,disposed=false;const pending=new Map();
 const fail=error=>{const previous=worker;worker=undefined;void previous?.terminate();for(const p of pending.values())p.reject(error);pending.clear();};
 return {evaluate(document,signal){if(disposed)return Promise.reject(new Error(t('Geometry host closed')));if(signal?.aborted)return Promise.reject(new Error(t('Request cancelled')));
  if(!worker){worker=new Worker(new URL('./geometry-worker.mjs',import.meta.url),{execArgv:[],stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:256}});worker.stdout.on('data',data=>process.stderr.write(data));worker.stderr.on('data',data=>process.stderr.write(data));const current=worker;worker.on('message',data=>{if(worker!==current)return;const p=pending.get(data.id);if(!p)return;pending.delete(data.id);if(data.error)p.reject(Object.assign(new Error(data.error),{diagnostic:data.diagnostic}));else p.resolve(data.result);});worker.on('error',error=>{if(worker===current)fail(error);});worker.on('exit',()=>{if(worker===current)fail(new Error(t('Geometry worker exited')));});}
  const id=++sequence;return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};const abort=()=>fail(new Error(t('Request cancelled')));const timer=setTimeout(()=>fail(new Error(t('Geometry exceeded 30 seconds'))),30000);pending.set(id,{resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);}});signal?.addEventListener('abort',abort,{once:true});try{worker.postMessage({id,document,locale:getLocale()});}catch(error){fail(error);}});
 },dispose(){disposed=true;fail(new Error(t('Geometry host closed')));}};
}
export async function createCodeHost(options={}){
 const geometry=createWorkerClient();let projectPath=options.project?resolve(options.project):undefined,lockPath,lockHandle,archive,lastDisk,session,metadata,disposed=false;
 async function persist(bytes){if(!projectPath)return;let current;try{current=await readFile(projectPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  if((current===undefined)!==(lastDisk===undefined)||current&&lastDisk&&!current.equals(lastDisk))throw new Error(t('Project changed outside this session. Existing file and history were preserved.'));
  const temporary=`${projectPath}.${newId()}.tmp`;let file;try{file=await open(temporary,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=undefined;await rename(temporary,projectPath);lastDisk=Buffer.from(bytes);}finally{await file?.close();await unlink(temporary).catch(()=>{});}
 }
 try {
  if(projectPath){await mkdir(dirname(projectPath),{recursive:true});lockPath=`${projectPath}.mcp-lock`;lockHandle=await open(lockPath,'wx',0o600);await lockHandle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
   let info;try{info=await lstat(projectPath);}catch(error){if(error.code!=='ENOENT')throw error;}if(info){if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024*1024)throw new Error(t('Choose a regular history-inclusive .bcad file of at most 64 MiB'));lastDisk=await readFile(projectPath);archive=new Uint8Array(lastDisk);}
  }
  if(!archive)archive=await appendPortableRevision(undefined,createDocument('Coded project'),'Opened project');
  metadata=await readPortableHistory(archive);session=createCadSession(metadata.readDocument(metadata.project.headId));await geometry.evaluate(session.state.document);if(!lastDisk)await persist(archive);
 } catch(error){geometry.dispose();await lockHandle?.close();if(lockHandle)await unlink(lockPath).catch(()=>{});if(error.code==='EEXIST')throw new Error(t`Project already has an MCP writer lock: ${lockPath}. Stop that writer, or inspect a stale lock before removing it.`);throw error;}
 const program=(source,params={})=>({version:1,language:'brickwright-cad-script',source,parameters:structuredClone(params)});
 const cancelled=signal=>{if(signal?.aborted)throw new Error(t('Request cancelled'));};
 const summary=result=>({volumeMm3:result.volume,triangles:result.triangles,bodies:result.bodies.map(b=>({id:b.id,name:b.name,volumeMm3:b.volume,boundsMm:b.bounds}))});
 function info(){return {revision:metadata.project.serial,projectId:session.state.document.id,title:session.state.document.title,projectFile:projectPath??null,objects:session.state.document.roots.map(id=>{const n=session.state.document.nodes[id];return {id,name:n.name,kind:n.kind,transform:n.transform};})};}
 async function accept(doc,label,signal,parent){cancelled(signal);if(new TextEncoder().encode(serializeDocument(doc)).length>1024*1024)throw new Error(t('MCP editable model exceeds 1 MiB; the GUI supports larger projects'));const nextArchive=await appendPortableRevision(archive,doc,label,parent);const nextMetadata=await readPortableHistory(nextArchive);cancelled(signal);await persist(nextArchive);archive=nextArchive;metadata=nextMetadata;session.load(doc);}
 const definitions=toolDefinitions.map(definition=>({...definition,description:t(definition.description)}));
 const localizedHelp={...codeHelp,examples:codeExamples.map(e=>({id:e.id,title:e.title[getLocale()],source:e.source,parameters:{}})),notes:codeHelp.notes.map(note=>t(note))};
 return {definitions,async call(name,args={},signal){if(disposed)throw new Error(t('MCP host is closed'));const definition=toolDefinitions.find(t=>t.name===name);if(!definition)throw new Error(t('Unknown tool'));validateArguments(definition,args);cancelled(signal);
  if(name==='cad_convert_code'){const imported=args.inputFormat==='jscad'?importJSCAD(args.source,args.parameters??{},{entryPoint:args.entryPoint,arguments:args.arguments}):undefined;const p=imported?.program??(args.inputFormat==='openscad'?importOpenSCAD(args.source):program(args.source));if(!imported)p.parameters=structuredClone(args.parameters??{});compileCode(p);return {format:args.outputFormat,evaluatedSnapshot:!!imported||args.outputFormat!=='cadcode',warnings:imported?.warnings??getOpenSCADImportWarnings(p),outputs:imported?.outputs,source:args.outputFormat==='openscad'?exportOpenSCAD(p):args.outputFormat==='jscad'?exportJSCAD(p):exportCodeSource(p)};}
  if(name==='cad_code_help')return localizedHelp;if(name==='cad_get_model')return info();
  if(name==='cad_get_model_source')return {revision:metadata.project.serial,projectId:session.state.document.id,language:'brickwright-design',source:session.modelSource,maxEditableSourceCharacters:65536};
  if(name==='cad_get_code_object'){const n=session.state.document.nodes[args.objectId];if(n?.kind!=='code')throw new Error(t('Code object not found'));const compiled=compileCode(n.program);return {revision:metadata.project.serial,id:n.id,name:n.name,program:n.program,parameters:compiled.parameters,values:compiled.values,transform:n.transform};}
  if(name==='cad_list_revisions')return {revision:metadata.project.serial,revisions:metadata.revisions.filter(r=>!args.beforeSerial||r.serial<args.beforeSerial).sort((a,b)=>b.serial-a.serial).slice(0,args.limit??50).map(({id,parentId,serial,label,createdAt})=>({id,parentId,serial,label,createdAt}))};
  if(name==='cad_export_project'){if(archive.length>3*1024*1024)throw new Error(t('Use the configured project file for archives above 3 MiB; no history was removed'));return {name:'coded-project.bcad',mime:'application/json',base64:Buffer.from(archive).toString('base64'),revision:metadata.project.serial};}
  if(name==='cad_export_stl'){
   // Snapshot before worker IO: concurrent requests may advance the live project.
   const document=validateDocument(session.state.document),attributed=hasModelAttribution(document);
   if(attributed&&(typeof args.modificationNotes!=='string'||!args.modificationNotes.trim()||/[\u0000-\u001f]/.test(args.modificationNotes)))throw new Error(t('Recorded library sources require accurate modificationNotes describing changes since insertion, including when unchanged.'));
   const result=await geometry.evaluate(document,signal),bytes=exportSTL(result.bodies);
   if(bytes.length>3*1024*1024)throw new Error(attributed?t('Attributed STL exceeds the MCP 3 MiB limit; reduce model complexity or use the editor ZIP export.'):t('Open the project in the GUI to export meshes above 3 MiB'));
   const file={name:'coded-project.stl',mime:'model/stl',base64:Buffer.from(bytes).toString('base64')};
   if(!attributed)return file;
   const rootIds=document.roots.filter(id=>!document.nodes[id].reference);
   const sidecar=await createModelAttributionSidecar(document,{filename:file.name,format:'stl',bytes,rootIds,modificationNotes:args.modificationNotes});
   const sidecarBytes=new TextEncoder().encode(JSON.stringify(sidecar,null,2));
   if(bytes.length+sidecarBytes.length>3*1024*1024)throw new Error(t('STL and attribution exceed the MCP 3 MiB limit; no partial export was returned. Reduce model or source metadata size.'));
   cancelled(signal);
   return {format:'brickwright-attributed-stl',version:1,files:[file,{name:`${file.name}.attribution.json`,mime:'application/json',base64:Buffer.from(sidecarBytes).toString('base64')}],distribution:t('Distribute both files together. Retain any licence texts and notices required by the recorded grants.')};
  }
  if(name==='cad_preview_code'){const p=program(args.source,args.parameters),compiled=compileCode(p),trial=createCadSession();trial.addCode(p);return {...summary(await geometry.evaluate(trial.state.document,signal)),parameters:compiled.parameters,values:compiled.values,committed:false,revision:metadata.project.serial};}
  if(args.expectedRevision!==metadata.project.serial)throw new Error(t`Stale model revision. Current revision is ${metadata.project.serial}; read the model and retry.`);
  if(name==='cad_apply_model_source'){
   const expected=metadata.project.serial,trial=createCadSession(session.state.document);
   try{const prepared=trial.prepareModelSource(args.source,{regenerate:(recipe,name)=>createPresetDocument(recipe.preset,name,{recipe})}),result=await geometry.evaluate(prepared.document,signal);cancelled(signal);
    if(expected!==metadata.project.serial)throw new Error(t`Stale model revision. Current revision is ${metadata.project.serial}; read the model and retry.`);
    if(args.preview)return {revision:expected,committed:false,geometry:summary(result)};
    if(!trial.applyPreparedModelSource(prepared))return {...info(),committed:false,source:session.modelSource,geometry:summary(result)};await accept(trial.state.document,'Edit model source',signal);return {...info(),committed:true,source:session.modelSource,geometry:summary(result)};
   }finally{trial.dispose();}
  }
  const trial=createCadSession(session.state.document);let objectId=args.objectId;
  if(name==='cad_create_code_object')objectId=trial.addCode(program(args.source,args.parameters),args.name??'Code object');
  else if(name==='cad_update_code_object'){const n=trial.state.document.nodes[args.objectId];if(n?.kind!=='code')throw new Error(t('Code object not found'));trial.updateCode(n.id,{...n.program,...(args.source!==undefined?{source:args.source}:{}),...(args.parameters!==undefined?{parameters:structuredClone(args.parameters)}:{})});}
  else if(name==='cad_restore_revision')trial.load(metadata.readDocument(args.revisionId));else throw new Error(t('Unknown tool'));
  const result=await geometry.evaluate(trial.state.document,signal);await accept(trial.state.document,name==='cad_restore_revision'?'Restore coded project':trial.state.label,signal,name==='cad_restore_revision'?args.revisionId:undefined);return {...info(),objectId:objectId??null,geometry:summary(result)};
 },async dispose(){if(disposed)return;disposed=true;geometry.dispose();session?.dispose();await lockHandle?.close();if(lockHandle)await unlink(lockPath).catch(()=>{});}};
}
