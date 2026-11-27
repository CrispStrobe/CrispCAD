// SPDX-License-Identifier: BSD-3-Clause
/**
 * Atomic command scripts: several command lines that commit as one session
 * edit and one Undo step, or change nothing. The script runs through the
 * registry's headless runner on a private trial session (the approach of MCP
 * `cad_run_commands`); only a fully successful run is committed, as one
 * validated `apply` record. Nothing here evaluates JavaScript.
 */
import {t} from './i18n.js';
import {createCadSession} from './session.js';
import type {CadSession} from './session.js';
import {createDocumentCommand} from './session-commands.js';
import type {KernelIdentity} from './session-commands.js';
import {createCommandRunner} from './command-registry.js';
import type {CommandRunResult,CommandRunnerOptions} from './command-registry.js';
import type {ExactCommandFile} from './exact-commands.js';

/** History label of a committed script (translated by `translateHistoryLabel`). */
export const COMMAND_SCRIPT_LABEL='Run command script';

export interface CommandScriptOptions {
 /** Serves exact-kernel commands, as for `runScriptAsync`. */
 exact?:CommandRunnerOptions['exact'];
 /** Builds threaded screws for `part` and `fasten`, as for the runner. */
 generated?:CommandRunnerOptions['generated'];
 /** Serves `check` (the manufacturing check), as for `runScriptAsync`. */
 manufacturing?:CommandRunnerOptions['manufacturing'];
 signal?:AbortSignal;
 /** Answers `journal` lines (the host's journal of the real session). The script's own
  * lines are not journaled one by one: the committed script is one journal entry. */
 journal?:Pick<NonNullable<CommandRunnerOptions['journal']>,'summary'|'export'>;
 /** Wraps the single commit, for example `journal.withInvocation`. */
 record?:<T>(invocation:string,commit:()=>T)=>T;
 /** History label; defaults to `COMMAND_SCRIPT_LABEL`. */
 label?:string;
 maxLines?:number;
}
export interface CommandScriptResult {
 readonly results:readonly CommandRunResult[];
 /** True when the script committed a model edit (exactly one Undo step). */
 readonly edited:boolean;
 /** Canonical lines of the script, joined by "; " (the journal invocation). */
 readonly invocation:string;
 /** Files produced by `export step` lines; delivered only after the whole script succeeded. */
 readonly files:readonly ExactCommandFile[];
}

/** Lines that would run: not blank and not `//` comments. */
export function commandScriptLines(script:string):number{
 return script.split(/\r?\n/).filter(line=>{const text=line.trim();return text&&!text.startsWith('//');}).length;
}

/**
 * Runs `script` (one command per line; blank lines and `//` comments skipped)
 * atomically against `session`. Prompts are never shown: every command needs
 * its full arguments, or the default an empty Enter would give. On failure
 * the session is unchanged and the error message starts with `Line N:`.
 */
export async function runCommandScript(session:CadSession,script:string,options:CommandScriptOptions={}):Promise<CommandScriptResult>{
 const revision=session.state.revision,projectId=session.state.document.id;
 const trial=createCadSession(session.state.document,{kernels:session.kernels});
 let kernel:KernelIdentity|undefined;
 const unsubscribe=trial.subscribeCommands(record=>{if(record.command.kind==='apply'&&record.command.context?.kernel)kernel??=record.command.context.kernel;});
 try{
  if(session.modelSourceLive)trial.enableModelSource();
  trial.select(session.state.selection);
  const journal=options.journal?{withInvocation:<T,>(_line:string,run:()=>T)=>run(),summary:()=>options.journal!.summary(),export:(format?:'cadscript'|'replay')=>options.journal!.export(format)}:undefined;
  const runner=createCommandRunner(trial,{exact:options.exact,generated:options.generated,...(options.manufacturing?{manufacturing:options.manufacturing}:{}),signal:options.signal,...(journal?{journal}:{})});
  const results=await runner.runScriptAsync(script,{maxLines:options.maxLines});
  if(!results.length)throw new Error(t('Enter a command.'));
  options.signal?.throwIfAborted();
  if(session.state.revision!==revision||session.state.document.id!==projectId)throw new Error(t('The model changed while the script was running. Nothing was changed; run it again.'));
  const invocation=results.map(result=>result.invocation).join('; ');
  const files=results.flatMap(result=>result.file?[result.file]:[]);
  const before=session.state.document,after=trial.state.document;
  const command=createDocumentCommand(before,after,options.label??COMMAND_SCRIPT_LABEL,trial.state.selection,kernel);
  let edited=false;
  if(command.changes.length){
   const commit=()=>session.executeCommand(command);
   edited=options.record?options.record(invocation,commit):commit();
  }else session.select(trial.state.selection);
  return {results,edited,invocation,files};
 }finally{unsubscribe();trial.dispose();}
}
