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
import type {KernelIdentity} from './session-commands.js';
import {commandNumber,commandTokens} from './command-arguments.js';
import {t} from './i18n.js';

export type ExactOperation='export-step'|'measure'|'feature-display';
export interface ExactCommandRequest {
 readonly operation:ExactOperation;
 /** Snapshot taken when the command ran. */
 readonly document:CadDocument;
 /** Top-level bodies; empty means every printable body. For `feature-display`, the
  * exact-feature nodes whose display mesh to compute (empty: every stale one). */
 readonly bodies:readonly string[];
}
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
 |{readonly operation:'feature-display';readonly kernel:ExactKernelReport;readonly features:readonly ExactFeatureDisplayReport[];readonly timing?:ExactTiming};
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

/** Parse the arguments after `export` or `measure`; undefined when `export` opens the dialog. */
export function parseExactCommand(session:CadSession,name:string,tail:string):{operation:ExactOperation;bodies:string[];invocation:string}|undefined{
 const tokens=commandTokens(tail);
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
 if(result.operation==='measure'){
  const lines=result.bodies.map(body=>t`${body.name} (${body.id}): volume ${formatNumber(body.volume)} mm³ · area ${formatNumber(body.area)} mm² · bounds ${formatPoint(body.bounds.min)} – ${formatPoint(body.bounds.max)} · centroid ${formatPoint(body.centroid)}`);
  return {output:[t`Exact measures (${kernelLabel(result.kernel)}):`,...lines].join('\n')+timingLine(result.timing).join(''),kernel:result.kernel};
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
export interface ParsedExactFeatureCommand {readonly operation:ExactFeatureOperation;readonly settings:ExactFeatureSettings;readonly bodies:readonly string[];readonly invocation:string}

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
 * that outward normal. A shell removes each `--open` face and hollows the body inward.
 */
export function parseExactFeatureCommand(session:CadSession,name:string,tail:string):ParsedExactFeatureCommand{
 const operation=name as ExactFeatureOperation;
 if(!EXACT_FEATURE_COMMANDS.includes(name))throw new Error(t('Unknown editor command'));
 const usage=operation==='shell'?t('Usage: shell <thickness> [all|"name"|id ...] --open <normal> [--open <normal> ...].'):operation==='fillet'?t('Usage: fillet <radius> [all|"name"|id ...] [--face <normal>].'):t('Usage: chamfer <distance> [all|"name"|id ...] [--face <normal>].');
 const tokens=commandTokens(tail);
 if(!tokens.length||tokens[0].quoted)throw new Error(usage);
 const size=commandNumber(tokens[0].value);
 if(size<.01||size>10000)throw new Error(operation==='shell'?t('Wall thickness must be between 0.01 and 10000 mm'):t('Fillet and chamfer sizes must be between 0.01 and 10000 mm'));
 const targets:{value:string;quoted:boolean}[]=[],faces:Vec3[]=[],opens:Vec3[]=[];
 for(let i=1;i<tokens.length;i++){
  const token=tokens[i],flag=!token.quoted?token.value.toLowerCase():'';
  if(flag==='--face'||flag==='--open'){
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
export async function runExactFeatureCommand(session:CadSession,host:ExactCommandHost,parsed:ParsedExactFeatureCommand,options:{signal?:AbortSignal;record?:CommitWrapper}={}):Promise<ExactEditOutput>{
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
