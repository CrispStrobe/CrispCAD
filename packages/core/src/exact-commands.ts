// SPDX-License-Identifier: BSD-3-Clause
/**
 * Commands served by the optional exact B-rep kernel: `export step` and
 * `measure exact`. Core only parses, resolves targets and formats results;
 * the host owns the kernel (loaded lazily in a worker, or in Node) and runs
 * the request. There is no fallback: without an exact host the commands fail,
 * and a body without an exact construction is an error naming the feature.
 */
import type {CadDocument} from './document.js';
import type {CadSession} from './session.js';
import type {KernelIdentity} from './session-commands.js';
import {commandTokens} from './command-arguments.js';
import {t} from './i18n.js';

export type ExactOperation='export-step'|'measure';
export interface ExactCommandRequest {
 readonly operation:ExactOperation;
 /** Snapshot taken when the command ran. */
 readonly document:CadDocument;
 /** Top-level bodies; empty means every printable body. */
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
export type ExactCommandResult=
 |{readonly operation:'measure';readonly kernel:ExactKernelReport;readonly bodies:readonly ExactBodyMeasureReport[]}
 |{readonly operation:'export-step';readonly kernel:ExactKernelReport;readonly bodies:readonly {id:string;name:string}[];readonly step:string;readonly bytes:number};
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
/** Terminal/CLI text for a result, and the STEP file for an export. */
export function formatExactResult(result:ExactCommandResult,document:CadDocument):ExactCommandOutput{
 if(result.operation==='measure'){
  const lines=result.bodies.map(body=>t`${body.name} (${body.id}): volume ${formatNumber(body.volume)} mm³ · area ${formatNumber(body.area)} mm² · bounds ${formatPoint(body.bounds.min)} – ${formatPoint(body.bounds.max)} · centroid ${formatPoint(body.centroid)}`);
  return {output:[t`Exact measures (${kernelLabel(result.kernel)}):`,...lines].join('\n'),kernel:result.kernel};
 }
 const title=document.title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'-').trim().slice(0,230)||'design';
 const file={name:`${title}.step`,mime:STEP_MIME,text:result.step};
 return {output:t`STEP export: ${result.bodies.length} bodies, ${Math.ceil(result.bytes/1024)} KiB, exact B-rep (${kernelLabel(result.kernel)}).`,file,kernel:result.kernel};
}
