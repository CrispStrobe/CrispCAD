// SPDX-License-Identifier: BSD-3-Clause
/**
 * Commands served by the optional exact B-rep kernel: `export step`,
 * `measure exact`, the exact features `fillet`, `chamfer` and `shell`, and
 * `recompute exact`. Core only parses, resolves targets and formats results;
 * the host owns the kernel (loaded lazily in a worker, or in Node) and runs
 * the request. There is no fallback: without an exact host the commands fail,
 * and a body without an exact construction is an error naming the feature.
 */
import type {CadDocument,Vec3} from './document.js';
import {newId} from './document.js';
import {createCadSession} from './session.js';
import type {CadSession} from './session.js';
import {staleExactFeatures} from './exact-feature.js';
import type {ExactFaceSelector,ExactFeatureDisplay,ExactFeatureOperation,ExactFeatureSettings} from './exact-feature.js';
import {checkEdgeReferences,formatEdgeReference,parseEdgeReference} from './exact-edge-references.js';
import type {ExactEdgeReference} from './exact-edge-references.js';
import type {KernelIdentity} from './session-commands.js';
import type {ExactBodyData} from './exact-body.js';
import type {ExactDrawingBody,ExactDrawingFailure,ExactSectionBody} from './exact-drawing.js';
import {MAX_STEP_IMPORT_BYTES} from './exact-body.js';
import {sha256Hex} from './hash.js';
import {commandNumber,commandTokens} from './command-arguments.js';
import {t} from './i18n.js';

export type ExactOperation='export-step'|'measure'|'feature-display'|'edges'|'import-step'|'drawing'|'section';
export interface ExactCommandRequest {
 readonly operation:ExactOperation;
 /** Snapshot taken when the command ran. */
 readonly document:CadDocument;
 /** Top-level bodies; empty means every printable body. For `feature-display`, the
  * exact-feature nodes whose display mesh to compute (empty: every stale one). For `edges`, the
  * bodies whose B-rep edges to list. For `drawing`, the bodies to draw (empty: every printable one). */
 readonly bodies:readonly string[];
 /** `import-step` only: the file (its name without a path, and its bytes). */
 readonly step?:{readonly name:string;readonly bytes:Uint8Array};
 /** `section` only: the world axis the cutting planes are normal to (0: X, 1: Y) and their positions. */
 readonly section?:{readonly axis:0|1;readonly positions:readonly number[]};
}
/** One body of an imported STEP file, as the exact kernel read and stored it. */
export interface ImportedExactBodyReport {readonly name:string;readonly color:string|null;readonly body:Omit<ExactBodyData,'origin'>}
export interface ExactKernelReport extends KernelIdentity {readonly smlib?:string;readonly licence?:string}
export interface ExactBodyMeasureReport {
 readonly id:string;readonly name:string;
 readonly volume:number;readonly area:number;
 readonly bounds:{readonly min:readonly number[];readonly max:readonly number[]};
 readonly centroid:readonly number[];
 readonly solids:number;
}
/** Measured where the kernel runs: loading (0 once loaded), the request, and WASM memory. */
export interface ExactTiming {readonly loadMs:number;readonly runMs:number;readonly memoryBytes:number}
export type ExactCommandResult=
 |{readonly operation:'measure';readonly kernel:ExactKernelReport;readonly bodies:readonly ExactBodyMeasureReport[];readonly timing?:ExactTiming}
 |{readonly operation:'export-step';readonly kernel:ExactKernelReport;readonly bodies:readonly {id:string;name:string}[];readonly step:string;readonly bytes:number;readonly timing?:ExactTiming}
 |{readonly operation:'feature-display';readonly kernel:ExactKernelReport;readonly features:readonly ExactFeatureDisplayReport[];readonly timing?:ExactTiming}
 |{readonly operation:'edges';readonly kernel:ExactKernelReport;readonly bodies:readonly ExactBodyEdgesReport[];readonly timing?:ExactTiming}
 |{readonly operation:'drawing';readonly kernel:ExactKernelReport;readonly bodies:readonly ExactDrawingBody[];readonly failures:readonly ExactDrawingFailure[];readonly timing?:ExactTiming}
 |{readonly operation:'section';readonly kernel:ExactKernelReport;readonly axis:0|1;readonly positions:readonly number[];readonly bodies:readonly ExactSectionBody[];readonly failures:readonly ExactDrawingFailure[];readonly timing?:ExactTiming}
 |{readonly operation:'import-step';readonly kernel:ExactKernelReport;readonly bodies:readonly ImportedExactBodyReport[];readonly notes:readonly string[];readonly timing?:ExactTiming};
/**
 * One B-rep edge of a body, for picking: its number in `edges` listings (1-based, in kernel
 * order), curve kind, length, points from start to end in the body's parent frame (world for a
 * top-level body), and its stable reference, or why it has none (`unnamed`: a face without a
 * name, such as a fillet's round; `seam`: the seam of a closed surface).
 */
export interface ExactBodyEdge {
 readonly number:number;readonly curve:string;readonly length:number;
 readonly points:readonly (readonly number[])[];
 readonly reference?:ExactEdgeReference;readonly unreferable?:'unnamed'|'seam';
}
export interface ExactBodyEdgesReport {readonly id:string;readonly name:string;readonly edges:readonly ExactBodyEdge[]}
/** One exact feature's display mesh (tessellated at EXACT_DISPLAY_TOLERANCE) and exact volume. */
export interface ExactFeatureDisplayReport {readonly id:string;readonly name:string;readonly display:ExactFeatureDisplay;readonly volume:number}
/** Runs exact requests. Implemented by the editor's geometry client and the MCP host. */
export interface ExactCommandHost {run(request:ExactCommandRequest,signal?:AbortSignal):Promise<ExactCommandResult>}
export interface ExactCommandFile {readonly name:string;readonly mime:string;readonly text:string}
export interface ExactCommandOutput {readonly output:string;readonly file?:ExactCommandFile;readonly kernel:ExactKernelReport}

export const STEP_MIME='model/step';
const formatNumber=(value:number)=>String(Number(value.toPrecision(12))+0);
const formatPoint=(value:readonly number[])=>`[${value.map(formatNumber).join(', ')}]`;
const quote=(value:string)=>/^[A-Za-z0-9_-]+$/.test(value)?value:'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';

/** Top-level bodies named by ID or exact name; `all`; or, when empty, the selection. */
export function resolveExactTargets(session:CadSession,text:string):string[]{
 const doc=session.state.document,tokens=commandTokens(text);
 if(!tokens.length)return session.state.selection.filter(id=>doc.roots.includes(id));
 if(tokens.length===1&&!tokens[0].quoted&&tokens[0].value.toLowerCase()==='all')return [];
 return [...new Set(tokens.map(({value})=>{
  if(doc.roots.includes(value))return value;
  const matches=doc.roots.filter(id=>doc.nodes[id].name===value);
  if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${value}`);
  return matches[0];
 }))];
}

/** Parse the arguments after `export`, `measure` or `edges`; undefined when `export` opens the dialog. */
export function parseExactCommand(session:CadSession,name:string,tail:string):{operation:ExactOperation;bodies:string[];invocation:string}|undefined{
 const tokens=commandTokens(tail);
 if(name==='edges'){
  const bodies=resolveExactTargets(session,tail);
  if(!bodies.length)throw new Error(t('Usage: edges ["name"|id ...]. Name or select the bodies whose edges to list.'));
  return {operation:'edges',bodies,invocation:`edges ${bodies.map(quote).join(' ')}`};
 }
 if(name==='export'){
  if(!tokens.length)return undefined;
  if(tokens[0].quoted||tokens[0].value.toLowerCase()!=='step')throw new Error(t('Usage: export step [all|"name"|id ...].'));
 }else if(name==='measure'){
  if(!tokens.length||tokens[0].quoted||tokens[0].value.toLowerCase()!=='exact')throw new Error(t('Usage: measure exact [all|"name"|id ...].'));
 }else return undefined;
 const rest=tail.slice(tokens[0].end),bodies=resolveExactTargets(session,rest);
 const operation:ExactOperation=name==='export'?'export-step':'measure';
 return {operation,bodies,invocation:`${name} ${name==='export'?'step':'exact'}${bodies.length?' '+bodies.map(quote).join(' '):' all'}`};
}

const kernelLabel=(kernel:ExactKernelReport)=>`${kernel.id} · ${kernel.package} ${kernel.version}`;
const timingLine=(timing?:ExactTiming)=>timing?['\n'+t`Exact kernel: load ${Math.round(timing.loadMs)} ms · run ${Math.round(timing.runMs)} ms · WASM memory ${Math.round(timing.memoryBytes/1048576)} MiB`]:[];
/** Terminal/CLI text for a result, and the STEP file for an export. */
export function formatExactResult(result:ExactCommandResult,document:CadDocument):ExactCommandOutput{
 if(result.operation==='import-step')throw new Error(t('Import STEP files with import step.'));
 if(result.operation==='drawing'||result.operation==='section')throw new Error(t('Exact drawings are made in the drawing workspace.'));
 if(result.operation==='measure'){
  const lines=result.bodies.map(body=>t`${body.name} (${body.id}): volume ${formatNumber(body.volume)} mm³ · area ${formatNumber(body.area)} mm² · bounds ${formatPoint(body.bounds.min)} – ${formatPoint(body.bounds.max)} · centroid ${formatPoint(body.centroid)}`);
  return {output:[t`Exact measures (${kernelLabel(result.kernel)}):`,...lines].join('\n')+timingLine(result.timing).join(''),kernel:result.kernel};
 }
 if(result.operation==='edges'){
  const lines=result.bodies.flatMap(body=>[t`${body.name} (${body.id}): ${body.edges.length} edges`,...body.edges.map(edge=>{
   const ends=`${formatPoint(edge.points[0])} – ${formatPoint(edge.points[edge.points.length-1])}`;
   const note=edge.reference?'':edge.unreferable==='seam'?' · '+t('seam, cannot be selected'):' · '+t('on a face without a stable name, cannot be selected');
   return `  ${edge.number}: ${edge.curve} · ${formatNumber(edge.length)} mm · ${ends}${note}`;
  })]);
  return {output:[t`Exact edges (${kernelLabel(result.kernel)}):`,...lines,t('Fillet or chamfer chosen edges with: fillet <radius> "name" edges <number> ...')].join('\n')+timingLine(result.timing).join(''),kernel:result.kernel};
 }
 if(result.operation==='feature-display')return {output:[t`Exact display meshes (${kernelLabel(result.kernel)}):`,...featureLines(result)].join('\n')+timingLine(result.timing).join(''),kernel:result.kernel};
 const title=document.title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'-').trim().slice(0,230)||'design';
 const file={name:`${title}.step`,mime:STEP_MIME,text:result.step};
 return {output:t`STEP export: ${result.bodies.length} bodies, ${Math.ceil(result.bytes/1024)} KiB, exact B-rep (${kernelLabel(result.kernel)}).`+timingLine(result.timing).join(''),file,kernel:result.kernel};
}

/** Outward normals by name; `+z`/`top` etc. or an explicit X,Y,Z vector. */
const namedNormals:Record<string,Vec3>={'+x':[1,0,0],'-x':[-1,0,0],'+y':[0,1,0],'-y':[0,-1,0],'+z':[0,0,1],'-z':[0,0,-1],
 x:[1,0,0],y:[0,1,0],z:[0,0,1],right:[1,0,0],left:[-1,0,0],back:[0,1,0],front:[0,-1,0],top:[0,0,1],bottom:[0,0,-1]};
export function parseFaceNormal(text:string):Vec3{
 const value=text.trim().toLowerCase();
 if(Object.hasOwn(namedNormals,value))return [...namedNormals[value]] as Vec3;
 const parts=value.split(',');
 if(parts.length!==3)throw new Error(t('Give a face normal as +x, -x, +y, -y, +z, -z, top, bottom, front, back, left, right or X,Y,Z.'));
 const normal=parts.map(commandNumber) as Vec3;
 if(Math.hypot(...normal)<1e-9)throw new Error(t('Choose a face by a non-zero outward normal X,Y,Z.'));
 return normal;
}
const formatNormal=(normal:readonly number[])=>{
 const named=Object.entries(namedNormals).find(([name,value])=>name.length===2&&value.every((v,i)=>v===normal[i]));
 return named?named[0]:normal.map(formatNumber).join(',');
};
const faceSelector=(normal:Vec3):ExactFaceSelector=>({faceNormal:normal,outermost:true});
export const EXACT_FEATURE_COMMANDS:readonly string[]=Object.freeze(['fillet','chamfer','shell']);
export interface ParsedExactFeatureCommand {
 readonly operation:ExactFeatureOperation;readonly settings:ExactFeatureSettings;readonly bodies:readonly string[];readonly invocation:string;
 /** Edges given by number (from `edges`) or reference, still to be resolved on the body's current
  * B-rep: then `settings.edges` is a placeholder and `invocation` is completed by the run. */
 readonly pendingEdges?:readonly (number|ExactEdgeReference)[];
}

/** Top-level bodies by ID or exact name, `all` (every non-reference body), or the selection. */
function featureTargets(session:CadSession,tokens:readonly {value:string;quoted:boolean}[]):string[]{
 const doc=session.state.document;
 let ids:string[];
 if(!tokens.length)ids=session.state.selection.filter(id=>doc.roots.includes(id));
 else if(tokens.length===1&&!tokens[0].quoted&&tokens[0].value.toLowerCase()==='all')ids=doc.roots.filter(id=>!doc.nodes[id].reference);
 else ids=[...new Set(tokens.map(({value})=>{
  if(doc.roots.includes(value))return value;
  const matches=doc.roots.filter(id=>doc.nodes[id].name===value);
  if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${value}`);
  return matches[0];
 }))];
 if(!ids.length)throw new Error(t('Select a top-level body for the exact feature'));
 return ids;
}

/**
 * `fillet <radius> [targets] [--face <normal>]`, `chamfer <distance> [targets] [--face <normal>]`
 * and `shell <thickness> [targets] --open <normal> [--open <normal> ...]`. Without `--face`
 * every edge is rounded or bevelled; `--face` takes the edges of the outermost planar face with
 * that outward normal; `edges <number|reference> ...` (one body) takes chosen edges: numbers as the
 * `edges` command lists them now, recorded as stable references. A shell removes each `--open`
 * face and hollows the body inward.
 */
export function parseExactFeatureCommand(session:CadSession,name:string,tail:string):ParsedExactFeatureCommand{
 const operation=name as ExactFeatureOperation;
 if(!EXACT_FEATURE_COMMANDS.includes(name))throw new Error(t('Unknown editor command'));
 const usage=operation==='shell'?t('Usage: shell <thickness> [all|"name"|id ...] --open <normal> [--open <normal> ...].'):operation==='fillet'?t('Usage: fillet <radius> [all|"name"|id ...] [--face <normal>], or fillet <radius> "name" edges <number|reference> ....'):t('Usage: chamfer <distance> [all|"name"|id ...] [--face <normal>], or chamfer <distance> "name" edges <number|reference> ....');
 const tokens=commandTokens(tail);
 if(!tokens.length||tokens[0].quoted)throw new Error(usage);
 const size=commandNumber(tokens[0].value);
 if(size<.01||size>10000)throw new Error(operation==='shell'?t('Wall thickness must be between 0.01 and 10000 mm'):t('Fillet and chamfer sizes must be between 0.01 and 10000 mm'));
 const targets:{value:string;quoted:boolean}[]=[],faces:Vec3[]=[],opens:Vec3[]=[],edges:(number|ExactEdgeReference)[]=[];
 let edgeList=false;
 for(let i=1;i<tokens.length;i++){
  const token=tokens[i],flag=!token.quoted?token.value.toLowerCase():'';
  if(edgeList&&!flag.startsWith('--')){
   if(/^\d+$/.test(token.value)){const n=Number(token.value);if(n<1)throw new Error(t`Edge numbers start at 1: ${token.value}`);edges.push(n);}
   else edges.push(parseEdgeReference(token.value));
  }else if(flag==='edges'&&operation!=='shell'){edgeList=true;}
  else if(flag==='--face'||flag==='--open'){
   const next=tokens[++i];
   if(!next)throw new Error(usage);
   if(flag==='--face'&&operation==='shell'||flag==='--open'&&operation!=='shell')throw new Error(usage);
   (flag==='--face'?faces:opens).push(parseFaceNormal(next.value));
  }else if(flag.startsWith('--'))throw new Error(usage);
  else targets.push(token);
 }
 if(faces.length>1)throw new Error(t('Choose one face with --face; every edge is used without it.'));
 if(operation==='shell'&&!opens.length)throw new Error(usage);
 const bodies=featureTargets(session,targets);
 if(edgeList){
  if(!edges.length)throw new Error(usage);
  if(faces.length)throw new Error(t('Choose edges or a face, not both.'));
  if(bodies.length!==1)throw new Error(t('Choose the edges of one body at a time.'));
  const head=`${name} ${formatNumber(size)} ${quote(bodies[0])} edges`;
  if(edges.every(edge=>typeof edge!=='number')){
   const references=checkEdgeReferences({references:edges}).references;
   return {operation,settings:{operation,size,edges:{references}},bodies,invocation:`${head} ${references.map(formatEdgeReference).join(' ')}`};
  }
  return {operation,settings:{operation,size,edges:'all'},bodies,invocation:head,pendingEdges:edges};
 }
 const settings:ExactFeatureSettings=operation==='shell'?{operation,size,openFaces:opens.map(faceSelector)}:{operation,size,edges:faces.length?faceSelector(faces[0]):'all'};
 const options=operation==='shell'?opens.map(n=>` --open ${formatNormal(n)}`).join(''):faces.length?` --face ${formatNormal(faces[0])}`:'';
 return {operation,settings,bodies,invocation:`${name} ${formatNumber(size)} ${bodies.map(quote).join(' ')}${options}`};
}

/** `recompute exact [targets]`: the stale exact features in the targets' construction (all: the model). */
export function parseRecomputeCommand(session:CadSession,tail:string):{features:string[];invocation:string}{
 const tokens=commandTokens(tail);
 if(!tokens.length||tokens[0].quoted||tokens[0].value.toLowerCase()!=='exact')throw new Error(t('Usage: recompute exact [all|"name"|id ...].'));
 const rest=commandTokens(tail.slice(tokens[0].end)),doc=session.state.document;
 const roots=!rest.length||rest.length===1&&!rest[0].quoted&&rest[0].value.toLowerCase()==='all'?[]:featureTargets(session,rest);
 return {features:staleExactFeatures(doc,roots),invocation:`recompute exact${roots.length?' '+roots.map(quote).join(' '):' all'}`};
}

export interface ExactEditOutput {readonly output:string;readonly edited:boolean;readonly kernel?:ExactKernelReport;readonly invocation:string}
type CommitWrapper=<T>(invocation:string,run:()=>T)=>T;
const plain:CommitWrapper=(_invocation,run)=>run();
function displayResult(result:ExactCommandResult){
 if(result.operation!=='feature-display')throw new Error(t('The exact kernel returned an unexpected result.'));
 return result;
}
const featureLines=(result:Extract<ExactCommandResult,{operation:'feature-display'}>)=>result.features.map(feature=>t`${feature.name} (${feature.id}): exact volume ${formatNumber(feature.volume)} mm³ · display ${feature.display.indices.length/3} triangles`);

/**
 * Add an exact fillet, chamfer or shell: the exact kernel computes the display mesh for a
 * candidate model first, then the session commits the node and its mesh as one Undo step inside
 * `withKernel`, so the recorded command carries the kernel identity.
 */
export async function runExactFeatureCommand(session:CadSession,host:ExactCommandHost,given:ParsedExactFeatureCommand,options:{signal?:AbortSignal;record?:CommitWrapper}={}):Promise<ExactEditOutput>{
 const parsed=given.pendingEdges?await resolveEdgeNumbers(session,host,given,options.signal):given;
 const revision=session.state.revision,entries=parsed.bodies.map(source=>({source,settings:parsed.settings,id:newId()}));
 const trial=createCadSession(session.state.document);
 let candidate:CadDocument;
 try{trial.addExactFeatures(entries);candidate=trial.state.document;}finally{trial.dispose();}
 const result=displayResult(await host.run({operation:'feature-display',document:candidate,bodies:entries.map(entry=>entry.id)},options.signal));
 if(session.state.revision!==revision)throw new Error(t('The model changed while the exact kernel was running. Run the command again.'));
 const displays=new Map(result.features.map(feature=>[feature.id,feature.display]));
 (options.record??plain)(parsed.invocation,()=>session.withKernel(result.kernel,()=>session.addExactFeatures(entries.map(entry=>({...entry,display:displays.get(entry.id)})))));
 const label=parsed.operation==='fillet'?t('Exact fillet'):parsed.operation==='chamfer'?t('Exact chamfer'):t('Exact shell');
 return {output:[t`${label} (${kernelLabel(result.kernel)}):`,...featureLines(result)].join('\n')+timingLine(result.timing).join(''),edited:true,kernel:result.kernel,invocation:parsed.invocation};
}

/** Edge numbers (as `edges` lists them on the current model) become stable references. */
async function resolveEdgeNumbers(session:CadSession,host:ExactCommandHost,parsed:ParsedExactFeatureCommand,signal?:AbortSignal):Promise<ParsedExactFeatureCommand>{
 const revision=session.state.revision,body=parsed.bodies[0];
 const result=await host.run({operation:'edges',document:session.state.document,bodies:[body]},signal);
 if(result.operation!=='edges')throw new Error(t('The exact kernel returned an unexpected result.'));
 if(session.state.revision!==revision)throw new Error(t('The model changed while the exact kernel was running. Run the command again.'));
 const listed=result.bodies[0]?.edges??[];
 const references=parsed.pendingEdges!.map(edge=>{
  if(typeof edge!=='number')return edge;
  const found=listed[edge-1];
  if(!found)throw new Error(t`Edge ${edge} does not exist; the body has ${listed.length} edges (see the edges command).`);
  if(!found.reference)throw new Error(found.unreferable==='seam'?t`Edge ${edge} is a seam and cannot be rounded or bevelled.`:t`Edge ${edge} lies on a face without a stable name (for example a fillet's round) and cannot be selected. Choose another edge, or every edge or a face.`);
  return found.reference;
 });
 const checked=checkEdgeReferences({references}).references;
 return {operation:parsed.operation,settings:{...parsed.settings,edges:{references:checked}},bodies:parsed.bodies,invocation:`${parsed.invocation} ${checked.map(formatEdgeReference).join(' ')}`};
}

/** Recompute stale exact display meshes and commit them as one Undo step inside `withKernel`. */
export async function recomputeExactFeatures(session:CadSession,host:ExactCommandHost,features:readonly string[],options:{signal?:AbortSignal;record?:CommitWrapper;invocation?:string}={}):Promise<ExactEditOutput>{
 const invocation=options.invocation??'recompute exact all';
 if(!features.length)return {output:t('Every exact feature is up to date.'),edited:false,invocation};
 const revision=session.state.revision,document=session.state.document;
 const result=displayResult(await host.run({operation:'feature-display',document,bodies:[...features]},options.signal));
 if(session.state.revision!==revision)throw new Error(t('The model changed while the exact kernel was running. Recompute the exact features again.'));
 (options.record??plain)(invocation,()=>session.withKernel(result.kernel,()=>session.setExactFeatureDisplays(result.features.map(({id,display})=>({id,display})))));
 return {output:[t`Recomputed exact features (${kernelLabel(result.kernel)}):`,...featureLines(result)].join('\n')+timingLine(result.timing).join(''),edited:true,kernel:result.kernel,invocation};
}

/** Change an exact feature's settings and commit the recomputed display mesh with them (one Undo step). */
export async function editExactFeatureWithKernel(session:CadSession,host:ExactCommandHost,id:string,settings:ExactFeatureSettings,options:{signal?:AbortSignal}={}):Promise<ExactEditOutput>{
 const revision=session.state.revision,trial=createCadSession(session.state.document);
 let candidate:CadDocument;
 try{trial.editExactFeature(id,settings);candidate=trial.state.document;}finally{trial.dispose();}
 const result=displayResult(await host.run({operation:'feature-display',document:candidate,bodies:[id]},options.signal));
 if(session.state.revision!==revision)throw new Error(t('The model changed while the exact kernel was running. Run the command again.'));
 session.withKernel(result.kernel,()=>session.editExactFeature(id,settings,result.features[0].display));
 return {output:[t`Edited exact feature (${kernelLabel(result.kernel)}):`,...featureLines(result)].join('\n')+timingLine(result.timing).join(''),edited:true,kernel:result.kernel,invocation:''};
}

/** `import step [file]`: the file to import, or undefined to choose one (the editor's picker). */
export function parseImportCommand(tail:string):{file?:string}{
 const tokens=commandTokens(tail);
 if(!tokens.length||tokens[0].quoted||tokens[0].value.toLowerCase()!=='step'||tokens.length>2)throw new Error(t('Usage: import step [file].'));
 return tokens[1]?{file:tokens[1].value}:{};
}

/** A STEP file's name for the model: no path, printable, at most 255 characters. */
export function stepFileName(name:string):string{
 const base=name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(-255);
 if(!base)throw new Error(t('Give the STEP file a name.'));
 return base;
}

/**
 * `import step`: the exact kernel reads the file strictly (every body a closed solid, or nothing
 * is imported), then the session adds one `exact-body` per body in one Undo step inside
 * `withKernel`, so the recorded command carries the kernel identity. Bodies keep the file's
 * coordinates. The file's sha256, size and the body's place in it are kept as each body's origin.
 */
export async function runStepImport(session:CadSession,host:ExactCommandHost,file:{name:string;bytes:Uint8Array},options:{signal?:AbortSignal;record?:CommitWrapper}={}):Promise<ExactEditOutput&{ids:string[]}>{
 const name=stepFileName(file.name);
 if(!/\.(step|stp)$/i.test(name))throw new Error(t('Import STEP accepts .step and .stp files.'));
 if(!file.bytes.byteLength)throw new Error(t('The STEP file is empty.'));
 if(file.bytes.byteLength>MAX_STEP_IMPORT_BYTES)throw new Error(t`The STEP file is larger than ${MAX_STEP_IMPORT_BYTES/1048576} MiB.`);
 const revision=session.state.revision,sha256=await sha256Hex(file.bytes);
 const result=await host.run({operation:'import-step',document:session.state.document,bodies:[],step:{name,bytes:file.bytes}},options.signal);
 if(result.operation!=='import-step')throw new Error(t('The exact kernel returned an unexpected result.'));
 if(session.state.revision!==revision)throw new Error(t('The model changed while the exact kernel was reading the STEP file. Import it again.'));
 const invocation=`import step ${/^[\w.-]+$/.test(name)?name:quote(name)}`,count=result.bodies.length;
 const entries=result.bodies.map((body,i)=>({name:body.name,color:body.color,body:{...body.body,origin:{file:name,sha256,bytes:file.bytes.byteLength,body:i+1,bodies:count}}}));
 const ids=(options.record??plain)(invocation,()=>session.withKernel(result.kernel,()=>session.addExactBodies(entries)));
 const lines=result.bodies.map((body,i)=>t`${body.name} (${ids[i]}): exact volume ${formatNumber(body.body.measures.volume)} mm³ · area ${formatNumber(body.body.measures.area)} mm² · bounds ${formatPoint(body.body.measures.min)} – ${formatPoint(body.body.measures.max)} · display ${body.body.display.indices.length/3} triangles`);
 const notes=result.notes.map(note=>t`Repaired while reading: ${note}`);
 return {output:[t`Imported ${count} exact bodies from ${name} (${kernelLabel(result.kernel)}):`,...lines,...notes].join('\n')+timingLine(result.timing).join(''),edited:true,kernel:result.kernel,invocation,ids};
}
