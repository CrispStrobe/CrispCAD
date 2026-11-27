// SPDX-License-Identifier: BSD-3-Clause
import {Worker} from 'node:worker_threads';
import {readFile,writeFile,open,rename,unlink,stat,lstat,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {CAD_SCRIPT_REVISION,compileBlocksToCadScript,exportBlocksOpenSCAD,exportBlocksJSCAD,createCadSession,createDocument,compileCode,defaultCodeProgram,codeExamples,importOpenSCAD,getOpenSCADImportWarnings,importJSCAD,exportOpenSCAD,exportJSCAD,exportCodeSource,newId,serializeDocument,CODE_LIMITS,basicGeneratorPresets,enclosureGeneratorPresets,curvedGeneratorPresets,transitionGeneratorPresets,defaultGenerator,screwVariant,redesignScrew,t,getLocale,hasModelAttribution,createModelAttributionSidecar,validateDocument,commandRegistry,createCommandRunner,createCommandJournal,resolveManufacturingSettings,formatManufacturingReport,manufacturingVerdict} from '@brickwright/cad-core';
import {appendPortableRevision,readPortableHistory} from '@brickwright/cad-history';
import {createPresetDocument} from '@brickwright/cad-editor';
import {drawingSheetCut,drawingSheetFor,renderDrawingSheet,sectionPlanes,writeDrawing} from '@brickwright/cad-editor/drawing';
import {exportSTL} from '@brickwright/cad-geometry';
import {exactKernelIdentity} from '@brickwright/cad-exact/identity';
import {formatMechanismReport,groupBodies,explodeOffsets,jointFrom,listGroups} from '@brickwright/cad-core';
import {formatExactResult,runStepImport,fastenerTable,THREADS,STOCK_LENGTHS,HEAT_SET_INSERTS,COUNTERBORE_4762,inspectMaterials,printableBodies,formatMaterialsReport,formatSurfaceBlendReport,formatStepEvidence} from '@brickwright/cad-core';

export const codeHelp={language:'brickwright-cad-script',version:CAD_SCRIPT_REVISION,example:defaultCodeProgram().source,syntax:['param name: mm|deg|scalar = expression;','let name = shape;','return shape;'],generatorRecipeTool:'cad_apply_model_source',generatorRecipeSyntax:'generated(id, metadata, recipe); roots([id]);',generatorRecipes:{...Object.fromEntries([...basicGeneratorPresets,...enclosureGeneratorPresets,...curvedGeneratorPresets,...transitionGeneratorPresets,'cube','ruler','screw','thread','nut','heart','text','name-tag'].map(id=>[id,defaultGenerator(id)])),...Object.fromEntries(['hex-head-screw','socket-head-screw','countersunk-screw','pan-head-screw','set-screw','wood-screw'].map(id=>[id,screwVariant(id)]))},functions:['torus(majorRadius, tubeRadius [, tubeSegments, ringSegments, tubeRotation, sweep, start])','ellipsoid(radiusX, radiusY, radiusZ [, segments])','roundedCylinder(radius, height, capHeight [, segments])','ellipticFrustum(rx0,ry0,rx1,ry1,height[,segments,startAngle,endAngle,angularSegments])','loft([[[x,y,z],...],...]) or loft([...], {pairing: \"closest\"}) — pairing \"closest\" re-starts each section at the vertex and direction closest to the previous one (as OpenCASCADE ThruSections); needs document version 46','smoothLoft([[[x,y,z],...],...]) — smooth (cubic) surface through three or more loft sections; needs document version 43','minRange(i,start,end,step[,predicate],value)','maxRange(i,start,end,step[,predicate],value)','frustum(bottom,top,height[,segments])','hull(a,...)','choose(condition,a,b)','forRange(i,start,end,step,shape)','forValues(i,[values],shape)','empty()','box(width,depth,height)','cylinder(radius,height[,segments])','sphere(radius[,segments])','extrude(height,[[x,y],...])','spurGear2d(module, teeth[, pressureAngleDeg=20, backlash=0]) — involute spur gear profile, tooth 0 on +X; mesh at centre distance module*(z1+z2)/2','internalSpurGear2d(module, teeth[, pressureAngleDeg=20, backlash=0]) — ring-gear tooth-space cutter to subtract from a disc','union(a,b,...)','subtract(base,cut,...)','intersect(a,b,...)','move([x,y,z],shape)','rotate([x,y,z],shape)','scale([x,y,z],shape)','repeat(count,[dx,dy,dz],shape)'],limits:CODE_LIMITS,notes:['// comments; unit-aware + - * / and parentheses','Named shapes and parameters can reference later declarations; cycles are refused','Code-local parameters are independent of global model parameters','One returned construction produces one rigid body','This is not JavaScript or .scad; imports, files, network and arbitrary script execution are unsupported']};
const source={type:'string',minLength:1,maxLength:32768},id={type:'string',minLength:1,maxLength:96},parameters={type:'object',additionalProperties:{type:'string',minLength:1,maxLength:256}},revision={type:'integer',minimum:1};
const spec=(name,description,properties={},required=[],readOnly=true)=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,openWorldHint:false}});
export const toolDefinitions=[
 spec('cad_code_help','Get the CAD Script grammar, modeling functions, limits and an example.'),
 spec('cad_convert_code','Convert supported OpenSCAD, JSCAD or native CAD source without changing the model.',{source,parameters,entryPoint:id,arguments:{type:'array',maxItems:64,items:{type:['number','string','boolean']}},inputFormat:{type:'string',enum:['cadcode','openscad','jscad']},outputFormat:{type:'string',enum:['cadcode','openscad','jscad']}},['source','inputFormat','outputFormat']),
 spec('cad_compile_blocks','Compile a block/pseudocode modelling program (JSON, format brickwright-cad-blocks) to parametric CAD Script, OpenSCAD or JSCAD without changing the model. Pass CAD Script output to cad_create_code_object.',{program:{type:'string',minLength:2,maxLength:262144},outputFormat:{type:'string',enum:['cadcode','openscad','jscad']}},['program','outputFormat']),
 spec('cad_get_model_source','Read the current design source with stable object IDs and the current history revision.'),
 spec('cad_apply_model_source','Preflight and apply a complete declarative design edit as one saved history step.',{source:{type:'string',minLength:1,maxLength:65536},expectedRevision:revision,preview:{type:'boolean'}},['source','expectedRevision'],false),
 spec('cad_redesign_screw','Rebuild a resized screw at a chosen pitch or turns per start, resetting its local scale as one saved edit.',{objectId:id,diameter:{type:'number',exclusiveMinimum:0},length:{type:'number',exclusiveMinimum:0},pitch:{type:'number',exclusiveMinimum:0},turnsPerStart:{type:'number',exclusiveMinimum:0},expectedRevision:revision,preview:{type:'boolean'}},['objectId','expectedRevision'],false),
 spec('cad_get_model','Get current revision and object metadata; call before changing the model.'),
 spec('cad_get_code_object','Read a coded feature, its source and evaluated local parameters.',{objectId:id},['objectId']),
 spec('cad_preview_code','Compile and evaluate source without modifying the model or its history.',{source,parameters},['source']),
 spec('cad_create_code_object','Create a coded body after geometry validation; append a saved iteration.',{source,parameters,name:{type:'string',minLength:1,maxLength:160},expectedRevision:revision},['source','expectedRevision'],false),
 spec('cad_update_code_object','Edit source/overrides of an existing coded body, preserving its identity, appearance and placement.',{objectId:id,source,parameters,expectedRevision:revision},['objectId','expectedRevision'],false),
 spec('cad_list_revisions','List saved revision metadata, latest first.',{beforeSerial:{type:'integer',minimum:1},limit:{type:'integer',minimum:1,maximum:100}}),
 spec('cad_restore_revision','Restore an old definition as a new iteration; retain all later work.',{revisionId:id,expectedRevision:revision},['revisionId','expectedRevision'],false),
 spec('cad_check_printability','Screen the current model for FDM printing: watertight mesh, sampled minimum wall thickness, overhangs/bridges, bed fit and the best of six axis orientations. Sampled screening only, not a print guarantee.',{nozzleMm:{type:'number',exclusiveMinimum:0,maximum:5},maxOverhangDeg:{type:'number',exclusiveMinimum:0,maximum:89},maxBridgeMm:{type:'number',exclusiveMinimum:0,maximum:1000},minWallMm:{type:'number',exclusiveMinimum:0,maximum:100},bedXMm:{type:'number',exclusiveMinimum:0,maximum:10000},bedYMm:{type:'number',exclusiveMinimum:0,maximum:10000},bedZMm:{type:'number',exclusiveMinimum:0,maximum:10000}}),
 spec('cad_check_manufacturing','Check the current model for manufacturing (read-only, no history entry): process fdm (wall thickness, hole size, overhangs, orientation, bed fit), cnc (3-axis milling: internal corner radius against the end mill, undercuts per setup, wall thickness) or laser (flat sheet of one thickness, minimum web, hole size), plus an edge-radius check (fillet radius bounds, sharp edges refused). Bodies with an exact B-rep are measured on it with the optional exact kernel (face radii, edge curves, exact wall distances); others on their mesh, and each check says which (geometry: exact|mesh). Findings carry B-rep face/edge indices and world locations. exact:false skips the exact kernel.',{process:{type:'string',enum:['fdm','cnc','laser']},objectIds:{type:'array',maxItems:64,items:{type:'string'}},exact:{type:'boolean'},toolDiameterMm:{type:'number',exclusiveMinimum:0,maximum:1000},approachAxes:{type:'array',minItems:1,maxItems:6,items:{type:'string',enum:['+x','-x','+y','-y','+z','-z']}},maxUndercutAreaMm2:{type:'number',minimum:0,maximum:1e9},minWallMm:{type:'number',exclusiveMinimum:0,maximum:1000},nozzleMm:{type:'number',exclusiveMinimum:0,maximum:5},minHoleMm:{type:'number',exclusiveMinimum:0,maximum:1000},minRadiusMm:{type:'number',exclusiveMinimum:0,maximum:10000},maxRadiusMm:{type:'number',exclusiveMinimum:0,maximum:10000},edgeBreak:{type:'string',enum:['none','external','internal','all']},includeMarks:{type:'boolean'}},['process']),
 spec('cad_check_mechanism','Check a mechanism (read-only, no history entry): sweep one hinge or slider (by motor port A, B…, joint id or number) through its limits, a full turn for a hinge without limits, or range [from, to] in degrees or mm, with the gears it drives through gear meshes, and report every pair of bodies that collides at a sampled pose (first and last value, overlap volume) and, with clearanceMm, pairs closer than that. Pairs a joint connects are exempt. Sampled poses only, not continuous proof.',{joint:{type:'string',minLength:1,maxLength:96},range:{type:'array',minItems:2,maxItems:2,items:{type:'number'}},steps:{type:'integer',minimum:1,maximum:720},clearanceMm:{type:'number',exclusiveMinimum:0,maximum:100}},['joint']),
 spec('cad_assembly','Read the assembly (read-only): groups with their bodies (a STEP import keeps the file\'s product structure as groups), suppressed bodies, configurations, exploded views and joints. With view and factor (0–1), also each body\'s exploded offset in mm. Edit with cad_run_commands: group, ungroup, suppress, unsuppress, config save|use|delete, explode auto|delete, planetary.',{view:{type:'string',minLength:1,maxLength:160},factor:{type:'number',minimum:0,maximum:1}}),
 spec('cad_inspect','Measure the current model: per body volume, surface area, bounds, size, centroid, triangle count and closed-mesh topology, plus each object\'s kind, name, placement and code parameters. Optionally limit to objectIds.',{objectIds:{type:'array',maxItems:64,items:{type:'string'}}}),
 spec('cad_check_interference','Find solid bodies of the current model that overlap (common volume above minVolumeMm3, default 0.001) and, with clearanceMm, pairs closer than that gap. Bounding boxes prefilter the pairs.',{minVolumeMm3:{type:'number',exclusiveMinimum:0,maximum:1e9},clearanceMm:{type:'number',minimum:0,maximum:100}}),
 spec('cad_render','Render the current model headlessly to PNG images from canonical views (iso, top, front, right, back, left, bottom). Orthographic, flat-shaded in body colours; for visual review, not measurement.',{views:{type:'array',maxItems:4,items:{type:'string'}},size:{type:'integer',minimum:64,maximum:1024}}),
 spec('cad_list_commands','List the shared CAD command vocabulary (terminal, palette, CLI): names, aliases, usage, typed arguments, whether a command edits the model and whether it runs headlessly in cad_run_commands.',{headlessOnly:{type:'boolean'}}),
 spec('cad_run_commands','Run CAD terminal commands headlessly, one per line (at most 64; // comments allowed), against a copy of the current model. The script starts with an empty selection; select bodies before move/rotate/scale. All edits are validated and saved as one history step; preview saves nothing. Returns command outputs and a journal export. fillet, chamfer, shell and recompute exact run on the optional exact B-rep kernel. View and panel commands are refused.',{commands:{type:'string',minLength:1,maxLength:65536},expectedRevision:revision,preview:{type:'boolean'}},['commands','expectedRevision'],false),
 spec('cad_fastener_table','Read the ISO fastener tables the standard holes and parts use: ISO 261 pitch, ISO 273 clearance holes (close, normal, loose), tap drills, ISO 4762/7380/10642/4017 heads, ISO 4032 nuts, ISO 7089 washers, counterbores, heat-set inserts and stocked screw lengths. thread limits it to one size.',{thread:{type:'string',enum:['M2','M2.5','M3','M4','M5','M6','M8','M10','M12','M16','M20']}}),
 spec('cad_add_hole','Add a standard hole (document version 47) as one saved step: clearance (ISO 273 close/normal/loose), tapped (tap drill), counterbore (for ISO 4762 heads), countersink (90°, for ISO 10642 heads) or heat-set insert pocket. position is the mouth on the face, axis points into the material (default 0,0,-1). depth is the blind depth, or with through the material thickness. targetId cuts that top-level body. Exact STEP export, measures and drawings see true cylinders and cones. preview saves nothing.',{type:{type:'string',enum:['clearance','tapped','counterbore','countersink','heat-set']},thread:{type:'string',enum:['M2','M2.5','M3','M4','M5','M6','M8','M10','M12','M16','M20']},fit:{type:'string',enum:['close','normal','loose']},depth:{type:'number',exclusiveMinimum:0,maximum:2000},through:{type:'boolean'},position:{type:'array',maxItems:3},axis:{type:'array',maxItems:3},targetId:id,expectedRevision:revision,preview:{type:'boolean'}},['type','thread','expectedRevision'],false),
 spec('cad_fasten','Place ISO fasteners in standard holes as one saved step: the screw a hole is made for (counterbore: ISO 4762, countersink: ISO 10642, through clearance: ISO 4017 bolt with ISO 7089 washers and ISO 4032 nut, tapped: the longest stocked screw that fits, heat-set pocket: the insert). Bolts take the shortest stocked length reaching two pitches past the nut. targets are hole or body ids or names, or a thread such as M3; none fastens every standard hole. detail envelope inserts unthreaded solids. preview saves nothing.',{targets:{type:'array',maxItems:64},family:{type:'string',enum:['socket-head','button-head','countersunk','hex-bolt','heat-set-insert']},mode:{type:'string',enum:['screw','bolt']},length:{type:'number',exclusiveMinimum:0,maximum:1000},detail:{type:'string',enum:['threaded','envelope']},expectedRevision:revision,preview:{type:'boolean'}},['expectedRevision'],false),
 spec('cad_insert_part','Insert one standard part with ISO dimensions as one saved step: socket-head (ISO 4762), button-head (ISO 7380-1), countersunk (ISO 10642), hex-bolt (ISO 4017), set-screw (ISO 4026), hex-nut (ISO 4032), washer (ISO 7089) or heat-set-insert. Screws need a stocked length (cad_fastener_table). Screws are threaded where the thread generator reaches, else envelopes. position and axis place the bearing plane (default origin, axis 0,0,-1: shank downwards). preview saves nothing.',{family:{type:'string',enum:['socket-head','button-head','countersunk','hex-bolt','set-screw','hex-nut','washer','heat-set-insert']},thread:{type:'string',enum:['M2','M2.5','M3','M4','M5','M6','M8','M10','M12','M16','M20']},length:{type:'number',exclusiveMinimum:0,maximum:1000},position:{type:'array',maxItems:3},axis:{type:'array',maxItems:3},detail:{type:'string',enum:['threaded','envelope']},expectedRevision:revision,preview:{type:'boolean'}},['family','thread','expectedRevision'],false),
 spec('cad_split_body','Split a top-level body at a plane (document version 49) as one saved step: the plane is every point whose distance along the normal is offset (mm); the + side is where the normal points. keep both (default: the body becomes its two sides, positive first), positive or negative. Both sides follow later edits of the source; the exact path cuts the B-rep, so the cut face is an exact plane.',{objectId:id,normal:{type:'array',minItems:3,maxItems:3,items:{type:'number'}},offset:{type:'number',minimum:-100000,maximum:100000},keep:{type:'string',enum:['both','positive','negative']},expectedRevision:revision,preview:{type:'boolean'}},['objectId','normal','expectedRevision'],false),
 spec('cad_inspect_materials','Multi-material inspection for printing (read-only): each body\'s material, colour, volume and mass; totals per material and per colour (with filament length at 1.75 mm); and findings: Booleans that fuse operands of different materials or colours into one body, and bodies of different materials or colours that share volume. exact:true takes volumes from the exact B-rep where a body has one (loads the exact kernel).',{objectIds:{type:'array',maxItems:64,items:{type:'string'}},exact:{type:'boolean'}}),
 spec('cad_surface_blends','Inspect surface blends on the exact B-rep (read-only; loads the exact kernel): per body the fillets (concave) and rounds (convex) with their surface radius, chamfers with width, angles and setback, and freeform blends; for each its boundary edges, how many are tangent and the largest normal deviation across them (G1 evidence), and the modelled exact fillets/chamfers with the blends matching their size. Bodies without an exact B-rep are listed in failures. includeMarks adds triangles and outlines to draw each blend.',{objectIds:{type:'array',maxItems:64,items:{type:'string'}},includeMarks:{type:'boolean'}}),
 spec('cad_step_evidence','STEP evidence for review (read-only; loads the exact kernel): with base64 (a STEP file), what the kernel reads in it; without, the model\'s bodies (objectIds, default all) written as one STEP file and read back, with the read-back volume and area compared to the model\'s (round trip within 1e-6). Per body: validity, exact volume, area, bounding box, centroid, principal moments, faces by surface kind with areas, edges by curve kind with lengths, closed and free edges, shortest edge and smallest face; for the file: bytes, SHA-256 and header (schema, originating system). Nothing is imported.',{base64:{type:'string',minLength:4,maxLength:4*1024*1024},name:{type:'string',minLength:1,maxLength:255},objectIds:{type:'array',maxItems:64,items:{type:'string'}}}),
 spec('cad_export_project','Return a complete history-inclusive .bcad archive as base64; large projects use the configured project file instead.'),
 spec('cad_export_step','Return an exact STEP (AP214) file as base64, built with the optional exact B-rep kernel (SMLib, loaded on first use). One solid per body; objectIds limits the bodies (default: every solid body). Bodies without an exact construction, such as imported meshes or minkowski, fail with a diagnostic naming the body and feature; no mesh is ever written as STEP. Recorded library sources are refused (STL with attribution only).',{objectIds:{type:'array',maxItems:64,items:{type:'string'}}}),
 spec('cad_import_step','Import a STEP file (AP203, AP214 or AP242 B-rep) as exact bodies with the optional exact B-rep kernel (SMLib, loaded on first use): one body per solid in the file, at the file\'s coordinates in millimetres, each keeping its exact B-rep (exact STEP export, measures, fillet, chamfer, shell) and the kernel\'s display mesh. The file is refused as a whole, never imported in part: text that is not STEP, malformed or cut short, no solid, a body the kernel cannot read, an open surface, more than 64 bodies. Saved as one history step; preview saves nothing. base64 holds the file\'s bytes.',{name:{type:'string',minLength:1,maxLength:255},base64:{type:'string',minLength:4,maxLength:4194304},expectedRevision:revision,preview:{type:'boolean'}},['name','base64','expectedRevision'],false),
 spec('cad_drawing','Render a drawing sheet (read-only, no history entry) as PDF, SVG or DXF and return it as base64. sheet names a saved sheet by id or title; without it, an A4 assembly sheet of every solid body (top, front and right views, isometric view) at the largest scale that fits. exact (default: the saved sheet\'s choice, true for the default sheet) takes edges, circles, ellipses and silhouettes from the exact B-rep kernel (loaded on first use); bodies it cannot build are drawn from their mesh and named in notes. autoDimensions (exact sheets) adds the overall size, hole positions, hole callouts (ISO 129 style, from standard holes), diameters and radii without overlaps. DXF is in paper millimetres (R2000 with ARC, CIRCLE and ELLIPSE entities, or R12 with ellipses as polylines within 0.01 mm); SVG is in millimetres at actual size; PDF includes parts list pages. scale and hiddenLines override the sheet for this rendering only.',{format:{type:'string',enum:['pdf','svg','dxf']},sheet:{type:'string',minLength:1,maxLength:96},exact:{type:'boolean'},autoDimensions:{type:'boolean'},scale:{type:'string',enum:['1:5','1:2','1:1','2:1','5:1']},hiddenLines:{type:'boolean'},dxfVersion:{type:'string',enum:['R2000','R12']}},['format']),
 spec('cad_measure_exact','Measure bodies exactly with the optional B-rep kernel: volume, surface area, bounding box and centroid from the exact solid, not a mesh. objectIds limits the bodies.',{objectIds:{type:'array',maxItems:64,items:{type:'string'}}}),
 spec('cad_export_stl','Return printable binary STL as base64. Recorded library sources automatically include a paired attribution JSON file; supply accurate modificationNotes describing changes since insertion (including when unchanged) and distribute both files together.',{modificationNotes:{type:'string',minLength:1,maxLength:4096}})
];
function validateArguments(definition,args){
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error(t('Tool arguments must be an object'));const schema=definition.inputSchema;
 for(const key of Object.keys(args))if(!Object.hasOwn(schema.properties,key))throw new Error(t`Unknown argument ${key}`);
 for(const key of schema.required)if(!Object.hasOwn(args,key))throw new Error(t`Missing argument ${key}`);
 for(const [key,value] of Object.entries(args)){const s=schema.properties[key];if(s.enum&&!s.enum.includes(value))throw new Error(t`Invalid ${key}`);if(s.type==='string'&&(typeof value!=='string'||value.length<(s.minLength??0)||value.length>(s.maxLength??Infinity)))throw new Error(t`Invalid ${key}`);
  if(s.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)||value<(s.minimum??-Infinity)||value>(s.maximum??Infinity)||s.exclusiveMinimum!==undefined&&value<=s.exclusiveMinimum))throw new Error(t`Invalid ${key}`);
  if(s.type==='boolean'&&typeof value!=='boolean')throw new Error(t`Invalid ${key}`);
  if(s.type==='integer'&&(!Number.isSafeInteger(value)||value<(s.minimum??-Infinity)||value>(s.maximum??Infinity)))throw new Error(t`Invalid ${key}`);
  if(s.type==='array'&&(!Array.isArray(value)||value.length>s.maxItems||value.some(v=>!['number','boolean','string'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v)||typeof v==='string'&&v.length>1024)))throw new Error(t`Invalid ${key}`);
  if(s.type==='object'){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>64||Object.values(value).some(v=>typeof v!=='string'||!v.trim()||v.length>256))throw new Error(t`Invalid ${key}`);}
 }
}
/** Exact-kernel thread, started on the first exact request (60 s budget: the first call loads 9.4 MB of WebAssembly). */
function createExactWorkerClient(){let worker,sequence=0,disposed=false;const pending=new Map();
 const fail=error=>{const previous=worker;worker=undefined;void previous?.terminate();for(const p of pending.values())p.reject(error);pending.clear();};
 return {run(request,signal){if(disposed)return Promise.reject(new Error(t('Geometry host closed')));if(signal?.aborted)return Promise.reject(new Error(t('Request cancelled')));
  if(!worker){worker=new Worker(new URL('./exact-worker.mjs',import.meta.url),{execArgv:[],stdout:true,stderr:true});worker.stdout.on('data',data=>process.stderr.write(data));worker.stderr.on('data',data=>process.stderr.write(data));const current=worker;worker.on('message',data=>{if(worker!==current)return;const p=pending.get(data.id);if(!p)return;pending.delete(data.id);if(data.error)p.reject(Object.assign(new Error(data.error),data.diagnostic?{diagnostic:data.diagnostic}:{}));else p.resolve(data.result);});worker.on('error',error=>{if(worker===current)fail(error);});worker.on('exit',()=>{if(worker===current)fail(new Error(t('Geometry worker exited')));});}
  const id=++sequence;return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};const abort=()=>fail(new Error(t('Request cancelled')));const timer=setTimeout(()=>fail(new Error(t('The exact kernel exceeded 60 seconds; the request was stopped.'))),60000);pending.set(id,{resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);}});signal?.addEventListener('abort',abort,{once:true});try{worker.postMessage({id,locale:getLocale(),request:{operation:request.operation,document:request.document,bodies:[...request.bodies],...(request.step?{step:{name:request.step.name,bytes:request.step.bytes}}:{})}});}catch(error){fail(error);}});
 },dispose(){disposed=true;fail(new Error(t('Geometry host closed')));}};
}
function createWorkerClient(){let worker,sequence=0,disposed=false;const pending=new Map();
 const fail=error=>{const previous=worker;worker=undefined;void previous?.terminate();for(const p of pending.values())p.reject(error);pending.clear();};
 return {evaluate(document,signal,printability,analysis){if(disposed)return Promise.reject(new Error(t('Geometry host closed')));if(signal?.aborted)return Promise.reject(new Error(t('Request cancelled')));
  if(!worker){worker=new Worker(new URL('./geometry-worker.mjs',import.meta.url),{execArgv:[],stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:256}});worker.stdout.on('data',data=>process.stderr.write(data));worker.stderr.on('data',data=>process.stderr.write(data));const current=worker;worker.on('message',data=>{if(worker!==current)return;const p=pending.get(data.id);if(!p)return;pending.delete(data.id);if(data.error)p.reject(Object.assign(new Error(data.error),{diagnostic:data.diagnostic}));else p.resolve(data.result);});worker.on('error',error=>{if(worker===current)fail(error);});worker.on('exit',()=>{if(worker===current)fail(new Error(t('Geometry worker exited')));});}
  const id=++sequence;return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};const abort=()=>fail(new Error(t('Request cancelled')));const timer=setTimeout(()=>fail(new Error(t('Geometry exceeded 30 seconds'))),30000);pending.set(id,{resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);}});signal?.addEventListener('abort',abort,{once:true});try{worker.postMessage({id,document,locale:getLocale(),...(printability?{printability}:{}),...(analysis?{analysis}:{})});}catch(error){fail(error);}});
 },dispose(){disposed=true;fail(new Error(t('Geometry host closed')));}};
}
export async function createCodeHost(options={}){
 const geometry=createWorkerClient(),exact=createExactWorkerClient(),kernels=[exactKernelIdentity];let projectPath=options.project?resolve(options.project):undefined,lockPath,lockHandle,archive,lastDisk,session,metadata,disposed=false;
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
 } catch(error){geometry.dispose();exact.dispose();await lockHandle?.close();if(lockHandle)await unlink(lockPath).catch(()=>{});if(error.code==='EEXIST')throw new Error(t`Project already has an MCP writer lock: ${lockPath}. Stop that writer, or inspect a stale lock before removing it.`);throw error;}
 // New programs are written in the current revision (ruled lofts); the session stores programs without a loft as revision 1.
 const program=(source,params={})=>({version:CAD_SCRIPT_REVISION,language:'brickwright-cad-script',source,parameters:structuredClone(params)});
 const cancelled=signal=>{if(signal?.aborted)throw new Error(t('Request cancelled'));};
 // Check for manufacturing: exact data from the exact thread when asked (a body or kernel that fails is
 // checked on its mesh, and the report says why), then the analysis beside the meshes.
 const manufacturing={async check(document,{bodies,settings},signal){
  let exactData,exactUnavailable;
  if(settings.exact){try{const result=await exact.run({operation:'drawing',document,bodies:[]},signal);if(result.operation!=='drawing')throw new Error(t('The exact kernel returned an unexpected result.'));exactData={bodies:result.bodies,failures:result.failures};}catch(error){if(signal?.aborted)throw error;exactUnavailable=error instanceof Error?error.message:String(error);}}
  cancelled(signal);
  const kernel=`${exactKernelIdentity.id} · ${exactKernelIdentity.package} ${exactKernelIdentity.version}`;
  return (await geometry.evaluate(document,signal,undefined,{kind:'manufacturing',options:{settings,bodies:[...bodies],...(exactData?{exact:exactData,kernel}:{}),...(exactUnavailable?{exactUnavailable}:{})}})).report;
 }};
 const exactLabel=`${exactKernelIdentity.id} · ${exactKernelIdentity.package} ${exactKernelIdentity.version}`;
 // Materials and mass: volumes and overlaps beside the meshes; exact volumes from the exact thread when
 // asked, body by body where some have no exact B-rep (those keep their mesh volume, with the reason).
 const materials={async inspect(document,{bodies,exact:useExact},signal){
  const measures=await geometry.evaluate(document,signal,undefined,{kind:'materials'});cancelled(signal);
  let volumes=measures.volumes;
  if(useExact){
   const wanted=bodies.length?bodies:printableBodies(document),measured=new Map(),reasons=new Map();
   try{const result=await exact.run({operation:'measure',document,bodies:[...wanted]},signal);for(const b of result.bodies)measured.set(b.id,b.volume);}
   catch(error){if(signal?.aborted)throw error;for(const id of wanted){try{const result=await exact.run({operation:'measure',document,bodies:[id]},signal);measured.set(id,result.bodies[0].volume);}catch(inner){if(signal?.aborted)throw inner;reasons.set(id,t`no exact B-rep: ${inner instanceof Error?inner.message:String(inner)}`);}}}
   volumes=volumes.map(v=>measured.has(v.id)?{id:v.id,volumeMm3:measured.get(v.id),geometry:'exact'}:reasons.has(v.id)?{...v,reason:reasons.get(v.id)}:v);
  }
  cancelled(signal);
  return inspectMaterials(document,volumes,{bodies,...(measures.overlaps?{overlaps:measures.overlaps}:{}),kernel:exactLabel});
 }};
 // Surface blends: the exact drawing data from the exact thread, analysed beside it in the geometry thread.
 const blends={async inspect(document,{bodies},signal,marks=false){
  const result=await exact.run({operation:'drawing',document,bodies:[]},signal);cancelled(signal);
  if(result.operation!=='drawing')throw new Error(t('The exact kernel returned an unexpected result.'));
  return (await geometry.evaluate(document,signal,undefined,{kind:'blends',options:{document,exact:{bodies:result.bodies,failures:result.failures},bodies:[...bodies],kernel:exactLabel,marks}})).report;
 }};
 // Assemblies: body bounds (explode auto) and the mechanism check, beside the meshes in the geometry thread.
 const assembly={
  async bounds(document,signal){return (await geometry.evaluate(document,signal)).bodies.map(b=>({id:b.id,bounds:b.bounds}));},
  async mechanism(document,settings,signal){return (await geometry.evaluate(document,signal,undefined,{kind:'mechanism',options:settings})).report;},
 };
 const summary=result=>({volumeMm3:result.volume,triangles:result.triangles,bodies:result.bodies.map(b=>({id:b.id,name:b.name,volumeMm3:b.volume,boundsMm:b.bounds}))});
 function info(){return {revision:metadata.project.serial,projectId:session.state.document.id,title:session.state.document.title,projectFile:projectPath??null,objects:session.state.document.roots.map(id=>{const n=session.state.document.nodes[id];return {id,name:n.name,kind:n.kind,transform:n.transform};})};}
 async function accept(doc,label,signal,parent){cancelled(signal);if(new TextEncoder().encode(serializeDocument(doc)).length>1024*1024)throw new Error(t('MCP editable model exceeds 1 MiB; the GUI supports larger projects'));const nextArchive=await appendPortableRevision(archive,doc,label,parent);const nextMetadata=await readPortableHistory(nextArchive);cancelled(signal);await persist(nextArchive);archive=nextArchive;metadata=nextMetadata;session.load(doc);}
 const definitions=toolDefinitions.map(definition=>({...definition,description:t(definition.description)}));
 const localizedHelp={...codeHelp,examples:codeExamples.map(e=>({id:e.id,title:e.title[getLocale()],source:e.source,parameters:{}})),notes:codeHelp.notes.map(note=>t(note))};
 return {definitions,async call(name,args={},signal){if(disposed)throw new Error(t('MCP host is closed'));const definition=toolDefinitions.find(t=>t.name===name);if(!definition)throw new Error(t('Unknown tool'));validateArguments(definition,args);cancelled(signal);
  if(name==='cad_convert_code'){const imported=args.inputFormat==='jscad'?importJSCAD(args.source,args.parameters??{},{entryPoint:args.entryPoint,arguments:args.arguments}):undefined;const p=imported?.program??(args.inputFormat==='openscad'?importOpenSCAD(args.source):program(args.source));if(!imported)p.parameters=structuredClone(args.parameters??{});compileCode(p);return {format:args.outputFormat,evaluatedSnapshot:!!imported||args.outputFormat!=='cadcode',warnings:imported?.warnings??getOpenSCADImportWarnings(p),outputs:imported?.outputs,source:args.outputFormat==='openscad'?exportOpenSCAD(p):args.outputFormat==='jscad'?exportJSCAD(p):exportCodeSource(p)};}
  if(name==='cad_compile_blocks'){let parsed;try{parsed=JSON.parse(args.program);}catch{throw new Error(t('The block program is not valid JSON'));}
   if(args.outputFormat==='cadcode'){const compiled=compileBlocksToCadScript(parsed),checked=compileCode(compiled.program);return {format:'cadcode',source:compiled.source,parameters:checked.parameters,...(compiled.parts.length>1?{parts:compiled.parts.map(part=>({color:part.color??null,source:part.source}))}:{})};}
   return {format:args.outputFormat,source:args.outputFormat==='openscad'?exportBlocksOpenSCAD(parsed):exportBlocksJSCAD(parsed)};}
  if(name==='cad_list_commands')return {commands:commandRegistry.filter(c=>!args.headlessOnly||c.headless).map(c=>({name:c.name,aliases:c.aliases,description:t(c.description),usage:c.usage,category:c.category,editsModel:c.editsModel,headless:c.headless,arguments:c.arguments}))};
  if(name==='cad_fastener_table')return {text:fastenerTable(args.thread??''),threads:args.thread?{[args.thread]:THREADS[args.thread]}:THREADS,stockLengths:STOCK_LENGTHS,heatSetInserts:HEAT_SET_INSERTS,counterbores:COUNTERBORE_4762};
  if(name==='cad_code_help')return localizedHelp;if(name==='cad_get_model')return info();
  if(name==='cad_get_model_source')return {revision:metadata.project.serial,projectId:session.state.document.id,language:'brickwright-design',source:session.modelSource,maxEditableSourceCharacters:65536};
  if(name==='cad_get_code_object'){const n=session.state.document.nodes[args.objectId];if(n?.kind!=='code')throw new Error(t('Code object not found'));const compiled=compileCode(n.program);return {revision:metadata.project.serial,id:n.id,name:n.name,program:n.program,parameters:compiled.parameters,values:compiled.values,transform:n.transform};}
  if(name==='cad_list_revisions')return {revision:metadata.project.serial,revisions:metadata.revisions.filter(r=>!args.beforeSerial||r.serial<args.beforeSerial).sort((a,b)=>b.serial-a.serial).slice(0,args.limit??50).map(({id,parentId,serial,label,createdAt})=>({id,parentId,serial,label,createdAt}))};
  if(name==='cad_export_project'){if(archive.length>3*1024*1024)throw new Error(t('Use the configured project file for archives above 3 MiB; no history was removed'));return {name:'coded-project.bcad',mime:'application/json',base64:Buffer.from(archive).toString('base64'),revision:metadata.project.serial};}
  if(name==='cad_check_printability'){const {bedXMm,bedYMm,bedZMm,...rest}=args,bed=Object.fromEntries([['x',bedXMm],['y',bedYMm],['z',bedZMm]].filter(([,v])=>v!==undefined));const revision=metadata.project.serial,{report}=await geometry.evaluate(validateDocument(session.state.document),signal,{...rest,bedSizeMm:bed});cancelled(signal);return {revision,...report};}
  if(name==='cad_check_mechanism'){
   const document=validateDocument(session.state.document),revision=metadata.project.serial,joint=jointFrom(document,args.joint);
   const report=await assembly.mechanism(document,{joint:joint.id,...(args.range?{range:args.range}:{}),...(args.steps?{steps:args.steps}:{}),...(args.clearanceMm?{clearanceMm:args.clearanceMm}:{})},signal);cancelled(signal);
   return {revision,...report,text:formatMechanismReport(report)};
  }
  if(name==='cad_assembly'){
   const document=session.state.document,a=document.assembly,revision=metadata.project.serial;
   const view=args.view?a?.views?.find(v=>v.id===args.view||v.name===args.view):undefined;
   if(args.view&&!view)throw new Error(t`Unknown exploded view: ${args.view}`);
   return {revision,version:document.version,groups:(a?.groups??[]).map(g=>({...g,bodies:groupBodies(a,g.id)})),suppressed:a?.suppressed??[],activeConfiguration:a?.active??null,configurations:a?.configurations??[],views:a?.views??[],
    joints:(document.joints??[]).map((j,i)=>({number:i+1,id:j.id,port:j.control?.port??null,kind:j.kind,bodyA:j.bodyA,bodyB:j.bodyB,...(j.limits?{limits:j.limits}:{}),...(j.gearMesh?{gearMesh:j.gearMesh}:{})})),
    ...(view?{explode:{view:view.id,factor:args.factor??1,offsets:Object.fromEntries(explodeOffsets(document,view.id,args.factor??1))}}:{}),text:listGroups(document)};
  }
  if(name==='cad_check_manufacturing'){
   const document=validateDocument(session.state.document),revision=metadata.project.serial,ids=args.objectIds??[];
   if(ids.some(id=>!document.roots.includes(id)))throw new Error(t('Unknown object id'));
   const {process,objectIds,includeMarks,...rest}=args,settings=resolveManufacturingSettings({process,...rest});
   const report=await manufacturing.check(document,{bodies:ids,settings},signal);cancelled(signal);
   // Marks (triangles and lines to draw) are large; they are left out unless asked for.
   const bodies=includeMarks?report.bodies:report.bodies.map(body=>({...body,checks:body.checks.map(check=>({...check,findings:check.findings.map(({mark,...finding})=>finding)}))}));
   return {revision,verdict:manufacturingVerdict(report),...report,bodies,text:formatManufacturingReport(report)};
  }
  if(name==='cad_inspect_materials'){
   const document=validateDocument(session.state.document),revision=metadata.project.serial,ids=args.objectIds??[];
   if(ids.some(id=>!document.roots.includes(id)))throw new Error(t('Unknown object id'));
   const report=await materials.inspect(document,{bodies:ids,exact:!!args.exact},signal);cancelled(signal);
   return {revision,...report,text:formatMaterialsReport(report)};
  }
  if(name==='cad_surface_blends'){
   const document=validateDocument(session.state.document),revision=metadata.project.serial,ids=args.objectIds??[];
   if(ids.some(id=>!document.roots.includes(id)))throw new Error(t('Unknown object id'));
   const report=await blends.inspect(document,{bodies:ids},signal,!!args.includeMarks);cancelled(signal);
   return {revision,...report,text:formatSurfaceBlendReport(report)};
  }
  if(name==='cad_step_evidence'){
   const document=validateDocument(session.state.document),revision=metadata.project.serial,ids=args.objectIds??[];
   if(ids.some(id=>!document.roots.includes(id)))throw new Error(t('Unknown object id'));
   if(args.base64!==undefined&&(!/^[A-Za-z0-9+/]+={0,2}$/.test(args.base64)||args.base64.length%4))throw new Error(t('Invalid base64'));
   if(args.base64!==undefined&&ids.length)throw new Error(t('Give either a STEP file (base64) or objectIds for a round trip, not both.'));
   const step=args.base64!==undefined?{name:args.name??'file.step',bytes:new Uint8Array(Buffer.from(args.base64,'base64'))}:undefined;
   const result=await exact.run({operation:'step-evidence',document,bodies:ids,...(step?{step}:{})},signal);cancelled(signal);
   if(result.operation!=='step-evidence')throw new Error(t('The exact kernel returned an unexpected result.'));
   return {revision,kernel:result.kernel,...result.evidence,text:formatStepEvidence(result.evidence)};
  }
  if(name==='cad_inspect'){const document=validateDocument(session.state.document),revision=metadata.project.serial,ids=args.objectIds;if(ids&&ids.some(id=>!document.roots.includes(id)))throw new Error(t('Unknown object id'));const {bodies}=await geometry.evaluate(document,signal,undefined,{kind:'inspect'});cancelled(signal);
   const objects=document.roots.filter(id=>!ids||ids.includes(id)).map(id=>{const n=document.nodes[id],compiled=n.kind==='code'?compileCode(n.program):undefined;return {id,name:n.name,kind:n.kind,transform:n.transform,...(n.reference?{reference:true}:{}),...(n.role==='hole'?{hole:true}:{}),...(compiled?{parameters:Object.fromEntries(Object.entries(compiled.values).map(([k,v])=>[k,v]))}:{}),...(n.generator?{generator:n.generator.preset}:{})};});
   return {revision,objects,bodies:bodies.filter(b=>!ids||ids.includes(b.id)),joints:(document.joints??[]).map(j=>({id:j.id,kind:j.kind,bodyA:j.bodyA,bodyB:j.bodyB,...(j.gearMesh?{gearMesh:j.gearMesh}:{})}))};}
  if(name==='cad_check_interference'){const revision=metadata.project.serial,result=await geometry.evaluate(validateDocument(session.state.document),signal,undefined,{kind:'interference',options:{...(args.minVolumeMm3!==undefined?{minVolumeMm3:args.minVolumeMm3}:{}),...(args.clearanceMm!==undefined?{clearanceMm:args.clearanceMm}:{})}});cancelled(signal);return {revision,...result};}
  if(name==='cad_render'){const views=args.views??['iso'];if(!views.length||views.some(v=>!['iso','top','front','right','back','left','bottom'].includes(v)))throw new Error(t('Invalid views'));const revision=metadata.project.serial,{views:rendered}=await geometry.evaluate(validateDocument(session.state.document),signal,undefined,{kind:'render',options:{views,size:args.size??512}});cancelled(signal);return {revision,images:rendered.map(r=>({view:r.view,mimeType:'image/png',data:r.png}))};}
  if(name==='cad_export_step'||name==='cad_measure_exact'){
   const document=validateDocument(session.state.document),revision=metadata.project.serial,ids=args.objectIds??[];
   if(ids.some(id=>!document.roots.includes(id)))throw new Error(t('Unknown object id'));
   if(name==='cad_export_step'&&hasModelAttribution(document))throw new Error(t('Recorded library sources export as STL with attribution; exact STEP export is not available for them yet.'));
   const result=await exact.run({operation:name==='cad_export_step'?'export-step':'measure',document,bodies:ids},signal);cancelled(signal);
   if(result.operation==='measure')return {revision,kernel:result.kernel,bodies:result.bodies};
   const {file}=formatExactResult(result,document),base64=Buffer.from(file.text).toString('base64');
   if(base64.length>3*1024*1024)throw new Error(t('STEP export exceeds the MCP 3 MiB limit; export fewer bodies or use the editor.'));
   return {revision,kernel:result.kernel,bodies:result.bodies,name:file.name,mime:file.mime,base64};
  }
  if(name==='cad_drawing'){
   // Snapshot first: the sheet, the meshes, the exact data and the section all describe this revision.
   const document=validateDocument(session.state.document),revision=metadata.project.serial;
   const {sheet,saved}=drawingSheetFor(document,args.sheet,{...(args.scale?{scale:args.scale}:{}),...(args.hiddenLines!==undefined?{hiddenLines:args.hiddenLines}:{}),...(args.exact!==undefined?{exactEdges:args.exact}:{}),...(args.autoDimensions!==undefined?{autoDimensions:args.autoDimensions}:{})});
   const result=await geometry.evaluate(document,signal);cancelled(signal);
   let exactData;
   if(sheet.exactEdges){
    const drawn=await exact.run({operation:'drawing',document,bodies:[]},signal);cancelled(signal);
    if(drawn.operation!=='drawing')throw new Error(t('The exact kernel returned an unexpected result.'));
    exactData={bodies:drawn.bodies,failures:drawn.failures};
   }
   const cut=drawingSheetCut(document,sheet);let section;
   if(cut){
    section=(await geometry.evaluate(document,signal,undefined,{kind:'slice',options:{cut}})).section;cancelled(signal);
    if(sheet.exactEdges){
     const cutFaces=await exact.run({operation:'section',document,bodies:[],section:sectionPlanes(cut)},signal);cancelled(signal);
     if(cutFaces.operation!=='section')throw new Error(t('The exact kernel returned an unexpected result.'));
     section={...section,exact:{axis:cutFaces.axis,positions:cutFaces.positions,bodies:cutFaces.bodies,failures:cutFaces.failures}};
    }
   }
   const render=renderDrawingSheet(document,sheet,{geometry:result,...(exactData?{exact:exactData}:{}),...(section?{section}:{})},{fit:!saved&&!args.scale});
   const file=writeDrawing(render,sheet.title,args.format,args.dxfVersion??'R2000'),base64=Buffer.from(file.bytes).toString('base64');
   if(base64.length>3*1024*1024)throw new Error(t('The drawing exceeds the MCP 3 MiB limit; draw it in the editor.'));
   return {revision,sheet:sheet.title,scale:render.scale,exact:!!sheet.exactEdges,pages:args.format==='pdf'?render.pages.length:1,notes:render.notes,name:file.name,mime:file.mime,bytes:file.bytes.length,base64};
  }
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
  if(name==='cad_redesign_screw'){
   const expected=metadata.project.serial,n=session.state.document.nodes[args.objectId];if(n?.generator?.preset!=='screw')throw new Error(t('Select a screw with retained parameters'));
   const request=Object.fromEntries(['diameter','length','pitch','turnsPerStart'].filter(key=>args[key]!==undefined).map(key=>[key,args[key]])),recipe=redesignScrew(n.generator,n.transform.scale,request),trial=createCadSession(session.state.document);
   try{trial.replaceGenerated(n.id,createPresetDocument('screw',n.name,{recipe}),{resetScale:true,label:'Redesign thread'});const result=await geometry.evaluate(trial.state.document,signal);cancelled(signal);if(expected!==metadata.project.serial)throw new Error(t`Stale model revision. Current revision is ${metadata.project.serial}; read the model and retry.`);if(args.preview)return {revision:expected,objectId:n.id,committed:false,recipe,geometry:summary(result)};await accept(trial.state.document,'Redesign thread',signal);return {...info(),objectId:n.id,committed:true,recipe,source:session.modelSource,geometry:summary(result)};}finally{trial.dispose();}
  }
  if(name==='cad_import_step'){
   // The kernel reads the file in its own thread; the edit is checked and saved like any other.
   if(!/^[A-Za-z0-9+/]+={0,2}$/.test(args.base64)||args.base64.length%4)throw new Error(t('Invalid base64'));
   const expected=metadata.project.serial,trial=createCadSession(session.state.document,{kernels});
   try{
    const done=await runStepImport(trial,exact,{name:args.name,bytes:new Uint8Array(Buffer.from(args.base64,'base64'))},{signal});cancelled(signal);
    const result=await geometry.evaluate(validateDocument(trial.state.document),signal);cancelled(signal);
    if(expected!==metadata.project.serial)throw new Error(t`Stale model revision. Current revision is ${metadata.project.serial}; read the model and retry.`);
    if(args.preview)return {revision:expected,committed:false,objectIds:done.ids,output:done.output,kernel:done.kernel,geometry:summary(result)};
    await accept(trial.state.document,'Import STEP',signal);return {...info(),committed:true,objectIds:done.ids,output:done.output,kernel:done.kernel,geometry:summary(result)};
   }finally{trial.dispose();}
  }
  if(name==='cad_split_body'){
   // A thin wrapper over the registry command `split`: one validated, saved step.
   if(args.normal.length!==3||args.normal.some(v=>typeof v!=='number'))throw new Error(t`Invalid ${'normal'}`);
   const quoteWord=value=>/^[A-Za-z0-9_-]+$/.test(value)?value:'"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
   args={commands:['split',quoteWord(args.objectId),args.normal.join(','),String(args.offset??0),...(args.keep&&args.keep!=='both'?[args.keep]:[])].join(' '),expectedRevision:args.expectedRevision,...(args.preview?{preview:true}:{})};name='cad_run_commands';
  }
  if(name==='cad_add_hole'||name==='cad_fasten'||name==='cad_insert_part'){
   // Thin wrappers over the registry commands `hole`, `fasten` and `part`: one validated, saved step.
   const point=(value,fallback)=>{if(value===undefined)return fallback;if(value.length!==3||value.some(v=>typeof v!=='number'))throw new Error(t`Invalid ${'position'}`);return value.join(',');};
   const quoteWord=value=>/^[A-Za-z0-9_.-]+$/.test(value)?value:'"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
   let line;
   if(name==='cad_add_hole')line=['hole',args.type,args.thread,...(args.fit?[args.fit]:[]),...(args.depth!==undefined?args.through?['through',args.depth]:[args.depth]:[]),'at',point(args.position,'0,0,0'),'axis',point(args.axis,'0,0,-1'),...(args.targetId?['in',quoteWord(args.targetId)]:[])].join(' ');
   else if(name==='cad_fasten'){if(args.targets?.some(v=>typeof v!=='string'))throw new Error(t`Invalid ${'targets'}`);line=['fasten',...(args.targets??[]).map(quoteWord),...(args.family?[args.family]:[]),...(args.mode?[args.mode]:[]),...(args.length!==undefined?['length',args.length]:[]),...(args.detail==='envelope'?['envelope']:[])].join(' ');}
   else line=['part',args.family,args.thread,...(args.length!==undefined?[args.length]:[]),'at',point(args.position,'0,0,0'),'axis',point(args.axis,'0,0,-1'),...(args.detail==='envelope'?['envelope']:[])].join(' ');
   args={commands:line,expectedRevision:args.expectedRevision,...(args.preview?{preview:true}:{})};name='cad_run_commands';
  }
  if(name==='cad_run_commands'){
   // The registry runs data-only commands on a private trial session: no JavaScript, files or view state.
   const expected=metadata.project.serial,trial=createCadSession(session.state.document,{kernels}),journal=createCommandJournal(trial);
   try{
    let fileBytes=0;
    const results=(await createCommandRunner(trial,{journal,exact,manufacturing,materials,blends,assembly,signal,generated:(recipe,title)=>createPresetDocument(recipe.preset,title,{recipe})}).runScriptAsync(args.commands,{maxLines:64})).map(r=>{
     const file=r.file&&{name:r.file.name,mime:r.file.mime,base64:Buffer.from(r.file.text).toString('base64')};
     if(file&&(fileBytes+=file.base64.length)>3*1024*1024)throw new Error(t('Command files exceed the MCP 3 MiB limit; export fewer bodies per command.'));
     return {command:r.command,invocation:r.invocation,edited:r.edited,...(r.output!==undefined?{output:r.output}:{}),...(file?{file}:{}),...(r.kernel?{kernel:r.kernel}:{})};
    });
    const exported=journal.export();cancelled(signal);
    if(serializeDocument(trial.state.document)===serializeDocument(session.state.document))return {revision:expected,committed:false,results,journal:exported};
    const result=await geometry.evaluate(validateDocument(trial.state.document),signal);cancelled(signal);
    if(expected!==metadata.project.serial)throw new Error(t`Stale model revision. Current revision is ${metadata.project.serial}; read the model and retry.`);
    if(args.preview)return {revision:expected,committed:false,results,journal:exported,geometry:summary(result)};
    await accept(trial.state.document,'Run commands',signal);return {...info(),committed:true,results,journal:exported,geometry:summary(result)};
   }finally{journal.dispose();trial.dispose();}
  }
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
 },async dispose(){if(disposed)return;disposed=true;geometry.dispose();exact.dispose();session?.dispose();await lockHandle?.close();if(lockHandle)await unlink(lockPath).catch(()=>{});}};
}
