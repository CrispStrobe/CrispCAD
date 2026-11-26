// SPDX-License-Identifier: BSD-3-Clause
import {commandHelp,commandRegistry,commandScriptLines,runCommandScript,createCommandJournal,EXACT_FEATURE_COMMANDS,findCommandSpec,formatExactResult,interactiveCommandNames,listModel,parseUpgradeLofts,parseExactCommand,parseExactFeatureCommand,parseRecomputeCommand,prepareCommand,recomputeExactFeatures,runExactFeatureCommand,t} from '@brickwright/cad-core';
import type {CadSession,Vec3,SessionCommandRecord,CommandSpec,CommandStep,CommandValue,PreparedCommand,JournalExportFormat,ExactCommandHost,ExactCommandFile} from '@brickwright/cad-core';
import type {CadCommand} from './index.js';
import {terminalArguments,terminalTokens} from './terminal-coordinates.js';
import {createTerminalAliases} from './terminal-aliases.js';
import type {TerminalAlias} from './terminal-aliases.js';

export interface TerminalStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export interface TerminalEntry {id:number;kind:'input'|'action'|'output'|'error';summary:string;text?:string}
export interface TerminalPrompt {command:string;message:string;point:boolean;plane?:'XY';base?:Vec3}
export interface TerminalState {entries:readonly TerminalEntry[];history:readonly string[];prompt?:TerminalPrompt;busy:boolean}
export interface TerminalCompletion {text:string;caret:number;label:string;description:string}
type Value=CommandValue;
type Step=CommandStep;
type Pending={name:string;steps:readonly Step[];values:Value[];revision:number;projectId:string;targets?:readonly string[];finish:(values:Value[])=>void;invocation:PreparedCommand['invocation']};
export type TerminalOptions={executeEditorCommand:(command:CadCommand)=>void|Promise<void>;openCodeWorkspace:()=>void;storage?:TerminalStorage;
 /** Serves `export step`, `measure exact`, `fillet`, `chamfer`, `shell` and `recompute exact`
  * (the editor's lazily loaded exact-kernel worker). */
 exact?:ExactCommandHost;
 /** Delivers a file a command produced, such as the STEP export. */
 saveFile?:(file:ExactCommandFile)=>Promise<void>};
/** Terminal help/completion order comes from the shared command registry. */
export const terminalCommands:readonly CommandSpec[]=commandRegistry.filter(entry=>entry.terminal);

export function completeTerminalCommand(text:string,customAliases:readonly TerminalAlias[]=[]):string[] {
 const query=text.toLowerCase().trim();if(/\s/.test(query))return [];
 return terminalCommands.filter(entry=>entry.name.startsWith(query)||entry.aliases.some(alias=>alias.startsWith(query))||customAliases.some(alias=>alias.command===entry.name&&alias.name.startsWith(query)))
  .sort((a,b)=>Number(!a.name.startsWith(query))-Number(!b.name.startsWith(query))||a.name.localeCompare(b.name)).map(entry=>entry.name);
}

const findCommand=(token:string)=>{const spec=findCommandSpec(token);return spec?.terminal?spec:undefined;};
const quoteArgument=(value:string)=>'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';

export function createTerminalController(session:CadSession,options:TerminalOptions){
 let entries:TerminalEntry[]=[],history:string[]=[],serial=0,pending:Pending|undefined,busy=false,disposed=false,executing=false;
 let projectId=session.state.document.id,lastPoint:Vec3|undefined;
 // The last multi-line script, repeated by empty Enter or `repeat` until another command runs.
 let lastScript:string|undefined;
 const listeners=new Set<(state:TerminalState)=>void>();
 const customAliases=createTerminalAliases(terminalCommands,options.storage);
 // Host-owned journal of accepted commands; never part of the document or its history.
 const journal=createCommandJournal(session);
 const resolveCommand=(token:string)=>findCommand(customAliases.resolve(token)??token);
 const historyKey=()=>`brickwright-cad:terminal-history:v1:${projectId}`;
 function loadHistory(){history=[];try{const value=JSON.parse(options.storage?.getItem(historyKey())??'[]');if(Array.isArray(value))history=value.filter(item=>typeof item==='string'&&item.length<=4096).slice(-100);}catch{}}
 loadHistory();
 const state=():TerminalState=>({entries:entries.map(entry=>({...entry})),history:[...history],busy,prompt:pending?{command:pending.name,message:pending.steps[pending.values.length].message,point:!!pending.steps[pending.values.length].point,plane:pending.steps[pending.values.length].plane,base:lastPoint&&[...lastPoint]}:undefined});
 const emit=()=>{if(!disposed)for(const listener of listeners)listener(state());};
 function append(kind:TerminalEntry['kind'],summary:string,text?:string){
  // Large imported meshes remain in the session; avoid duplicating them into a DOM transcript.
  const replay=text&&text.length<=2*1024*1024?text:undefined;
  entries.push({id:++serial,kind,summary:summary+(text&&!replay?' · '+t('Replay text exceeds the terminal limit.'):''),...(replay?{text:replay}:{})});
  let bytes=entries.reduce((sum,entry)=>sum+entry.summary.length+(entry.text?.length??0),0);
  while(entries.length>200||bytes>2*1024*1024&&entries.length>1){const entry=entries.shift()!;bytes-=entry.summary.length+(entry.text?.length??0);}
  emit();
 }
 function remember(text:string){lastScript=undefined;if(text.length>4096||/^apply\s/i.test(text))return;if(history.at(-1)!==text)history.push(text);history=history.slice(-100);try{options.storage?.setItem(historyKey(),JSON.stringify(history));}catch{}}
 const unsubscribeCommands=session.subscribeCommands((record:SessionCommandRecord)=>append('action',record.summary,record.text));
 const unsubscribe=session.subscribe(current=>{
  if(current.document.id!==projectId){projectId=current.document.id;pending=undefined;lastPoint=undefined;lastScript=undefined;entries=[];loadHistory();emit();}
  else if(pending&&!executing&&current.revision!==pending.revision){pending=undefined;append('error',t('The model changed. Start the command again.'));}
  else if(pending?.targets&&!executing&&JSON.stringify(current.selection.filter(id=>current.document.roots.includes(id)))!==JSON.stringify(pending.targets)){pending=undefined;append('error',t('The selection changed. Start the command again.'));}
 });
 function complete(text:string,caret=text.length):TerminalCompletion[]{
  if(disposed||busy||text.length>4096)return [];
  caret=Math.max(0,Math.min(text.length,caret));
  const before=terminalTokens(text.slice(0,caret),true),last=before.at(-1),current=last?.end===caret?last:undefined;
  const prior=current?before.slice(0,-1):before,start=current?.start??caret;
  const end=terminalTokens(text,true).find(token=>token.start===start)?.end??caret;
  const prefix=current?.value??'',query=prefix.toLowerCase();
  let kind:'commands'|'aliases'|'bodies'|'sketches'|undefined,argumentsBefore=prior;
  if(pending){kind=pending.steps[pending.values.length].completion;}
  else if(!prior.length){kind='commands';}
  else{
   const name=resolveCommand(prior[0].value)?.name;argumentsBefore=prior.slice(1);
   if(name==='help'&&!argumentsBefore.length)kind='commands';
   else if((name==='alias'||name==='unalias')&&!argumentsBefore.length)kind='aliases';
   else if(name==='alias'&&argumentsBefore.length===1)kind='commands';
   else if(name==='extrude'&&!argumentsBefore.length)kind='sketches';
   else if(name==='select'&&!/^\s*\[/.test(text.slice(prior[0].end)))kind='bodies';
  }
  const choices:{value:string;label:string;description:string}[]=[];
  if(kind==='commands'){
   for(const name of completeTerminalCommand(prefix,customAliases.list())){const command=findCommand(name)!;choices.push({value:name,label:name,description:t(command.description)});}
  }else if(kind==='aliases'){
   for(const alias of customAliases.list())if(alias.name.startsWith(query))choices.push({value:alias.name,label:alias.name,description:alias.command});
  }else if(kind){
   if(kind==='sketches'&&argumentsBefore.length)return [];
   if(kind==='bodies'&&argumentsBefore.some(token=>!token.quoted&&['all','none'].includes(token.value.toLowerCase())))return [];
   const doc=session.state.document;
   const entities=kind==='bodies'?doc.roots.map(id=>doc.nodes[id]):Object.values(doc.sketches??{});
   const names=new Map<string,number>();for(const entity of entities)names.set(entity.name,(names.get(entity.name)??0)+1);
   const ids=new Set(entities.map(entity=>entity.id));
   const used=new Set(argumentsBefore.map(token=>token.value));
   for(const entity of entities){
    if(kind==='sketches'&&'profile' in entity&&entity.profile.kind==='path')continue;
    if(used.has(entity.id)||used.has(entity.name))continue;
    if(entity.name.toLowerCase().startsWith(query)&&entity.name&&!/[\x00-\x1f\x7f]/.test(entity.name)&&names.get(entity.name)===1&&!ids.has(entity.name))choices.push({value:quoteArgument(entity.name),label:entity.name,description:entity.id});
    if(entity.id.toLowerCase().startsWith(query))choices.push({value:entity.id,label:entity.id,description:entity.name});
   }
   choices.sort((a,b)=>Number(!a.value.startsWith('"'))-Number(!b.value.startsWith('"'))||a.label.localeCompare(b.label));
   if(kind==='bodies'&&!argumentsBefore.length&&!current?.quoted){
    for(const keyword of ['all','none'])if(keyword.startsWith(query))choices.unshift({value:keyword,label:keyword,description:t(findCommand('select')!.description)});
   }
  }
  return choices.map(choice=>{
   const suffix=text.slice(end),gap=/^\s*/.exec(suffix)![0].length,replacement=choice.value+(suffix?'':' ');
   return {text:text.slice(0,start)+replacement+suffix,caret:start+replacement.length+gap,label:choice.label,description:choice.description};
  });
 }
 function begin(args:string[],command:PreparedCommand){
  if(args.length>command.steps.length)throw new Error(t('Too many arguments. Use help for command syntax.'));
  pending={name:command.name,steps:command.steps,values:[],revision:session.state.revision,projectId,finish:command.finish,invocation:command.invocation,targets:command.targets};
  for(const arg of args)answer(arg);
  emit();
 }
 function answer(text:string){
  const active=pending;if(!active)return;
  if(active.revision!==session.state.revision||active.projectId!==session.state.document.id){pending=undefined;throw new Error(t('The model changed. Start the command again.'));}
  const step=active.steps[active.values.length],value=step.parse(text,active.values);
  const values=[...active.values,value];
  if(values.length===active.steps.length){
   executing=true;
   try{journal.withInvocation(active.invocation(values),()=>active.finish(values));pending=undefined;if(step.point)lastPoint=[...value as Vec3];}
   finally{executing=false;}
  }else{active.values=values;if(step.point)lastPoint=[...value as Vec3];}
  emit();
 }
 function start(name:string,args:string[]){begin(args,prepareCommand(session,name,{lastPoint:()=>lastPoint}));}
 /** Custom aliases apply to the first word of each script line, as they do when typed. */
 const expandScriptAliases=(script:string)=>script.split(/\r?\n/).map(line=>{
  const match=/^(\s*)(\S+)([\s\S]*)$/.exec(line);if(!match||match[2].startsWith('//'))return line;
  const target=customAliases.resolve(match[2]);return target?match[1]+target+match[3]:line;
 }).join('\n');
 /** A multi-line script: all lines commit as one Undo step, or nothing changes. */
 async function runScript(script:string){
  lastScript=script;busy=true;
  const count=commandScriptLines(script),shown=script.split(/\r?\n/);
  append('input',(shown.length>24?[...shown.slice(0,23),'…']:shown).join('\n').slice(0,4000));
  try{
   const done=await runCommandScript(session,expandScriptAliases(script),{exact:options.exact,journal,record:(line,commit)=>journal.withInvocation(line,commit)});
   for(const result of done.results)if(result.output!==undefined)append('output',result.output);
   for(const file of done.files){
    if(!options.saveFile)throw new Error(t('This host has not provided file export'));
    await options.saveFile(file);
   }
   append('output',done.edited?t`Script: ${count} commands, committed as one Undo step.`:t`Script: ${count} commands; the model did not change.`);
  }catch(error){
   const message=error instanceof Error?error.message:String(error);
   append('error',error&&typeof error==='object'&&'line' in error?message+' '+t('The script changed nothing.'):message);
  }finally{busy=false;emit();}
 }
 async function submit(raw:string){
  if(disposed||busy)return;let text=raw.trim();
  if(!pending&&!text)text=lastScript??history.at(-1)??'';
  if(!pending&&!text)return;
  if(text.length>2*1024*1024){append('error',t('Command text exceeds the terminal limit.'));return;}
  if(!pending){
   const first=/^(\S+)([\s\S]*)$/.exec(text)!;
   if(resolveCommand(first[1].toLowerCase())?.name==='repeat'&&!/[\r\n]/.test(text)){
    const previous=lastScript??history.at(-1);
    if(first[2].trim()||!previous){append('input',text);append('error',first[2].trim()?t('Too many arguments. Use help for command syntax.'):t('Nothing to repeat.'));return;}
    text=previous;
   }
  }
  if(/[\r\n]/.test(text)){
   if(pending){append('error',t('Finish or cancel the current command before running a script.'));return;}
   return runScript(text);
  }
  busy=true;emit();
  try{
   if(pending){append('input',text||'↵');answer(text);return;}
   const match=/^(\S+)(?:\s+([\s\S]*))?$/.exec(text)!;
   const token=match[1].toLowerCase(),tail=match[2]??'';
   const definition=resolveCommand(token);
   if(!definition)throw new Error(t`Unknown command: ${token}. Type help.`);
   const name=definition.name;
   append('input',text.length>240?text.slice(0,237)+'…':text);if(name!=='apply')remember(text);
   if(name==='apply'||name==='select'&&tail.trim().startsWith('[')){session.executeCommand(name+' '+tail);return;}
   const args=name==='select'?(tail.trim()?[tail]:[]):terminalArguments(tail);
   // A sketch name can itself begin with a quote. Keep its original quoting until the prompt parses it.
   if(name==='extrude'&&args.length){const first=terminalTokens(tail)[0];args[0]=tail.slice(first.start,first.end);}
   if(name==='help'){
    if(args.length>1)throw new Error(t('Too many arguments. Use help for command syntax.'));
    const entry=args.length?resolveCommand(args[0]):undefined;
    if(args.length&&!entry)throw new Error(t('Unknown editor command'));
    append('output',commandHelp(entry,entry?customAliases.list().filter(alias=>alias.command===entry.name).map(alias=>alias.name):[],terminalCommands));return;
   }
   if(name==='alias'){
    if(args.length>2)throw new Error(t('Usage: alias [name [command]].'));
    if(args.length===0){const saved=customAliases.list();append('output',saved.length?saved.map(alias=>`${alias.name} → ${alias.command}`).join('\n'):t('No custom aliases. Use alias <name> <command> to add one.'));return;}
    if(args.length===1){const alias=customAliases.get(args[0]);append('output',`${alias.name} → ${alias.command}`);return;}
    const result=customAliases.set(args[0],args[1]);append('output',`${result.alias.name} → ${result.alias.command}`);
    if(!result.saved)append('error',t('Aliases are available for this session, but could not be saved.'));return;
   }
   if(name==='unalias'){
    if(args.length!==1)throw new Error(t('Usage: unalias <name>.'));
    const result=customAliases.remove(args[0]);append('output',t('Alias removed.')+' '+result.name);
    if(!result.saved)append('error',t('Aliases are available for this session, but could not be saved.'));return;
   }
   if(name==='list'){
    if(args.length)throw new Error(t('Too many arguments. Use help for command syntax.'));
    append('output',listModel(session));return;
   }
   if(name==='clear'){if(args.length)throw new Error(t('Too many arguments. Use help for command syntax.'));entries=[];emit();return;}
   if(name==='upgrade-lofts'){const command=parseUpgradeLofts(session,tail);append('output',journal.withInvocation(command.invocation,()=>command.run()));return;}
   if(name==='code'){if(args.length)throw new Error(t('Too many arguments. Use help for command syntax.'));options.openCodeWorkspace();return;}
   if(name==='journal'){
    if(!args.length){append('output',journal.summary());return;}
    if(args[0]!=='export'||args.length>2||args[1]!==undefined&&!['cadscript','replay'].includes(args[1]))throw new Error(t('Usage: journal [export [cadscript|replay]].'));
    append('output',journal.export((args[1]??'cadscript') as JournalExportFormat));return;
   }
   if(EXACT_FEATURE_COMMANDS.includes(name)||name==='recompute'){
    const parsed=name==='recompute'?undefined:parseExactFeatureCommand(session,name,tail),recompute=parsed?undefined:parseRecomputeCommand(session,tail);
    if(!options.exact)throw new Error(t('The exact kernel is not available in this host.'));
    append('output',t('Running on the exact kernel…'));
    const record=<T,>(line:string,commit:()=>T)=>journal.withInvocation(line,commit);
    const done=parsed?await runExactFeatureCommand(session,options.exact,parsed,{record}):await recomputeExactFeatures(session,options.exact,recompute!.features,{record,invocation:recompute!.invocation});
    append('output',done.output);
    return;
   }
   if(definition.kernel==='exact'){
    const exact=parseExactCommand(session,name,tail);
    if(exact){
     if(!options.exact)throw new Error(t('The exact kernel is not available in this host.'));
     const document=session.state.document;
     append('output',t('Running on the exact kernel…'));
     const formatted=formatExactResult(await options.exact.run({operation:exact.operation,document,bodies:exact.bodies}),document);
     append('output',formatted.output);
     if(formatted.file){
      if(!options.saveFile)throw new Error(t('This host has not provided file export'));
      await options.saveFile(formatted.file);
     }
     return;
    }
   }
   if(interactiveCommandNames.includes(name)){start(name,args);return;}
   if(args.length)throw new Error(t('Too many arguments. Use help for command syntax.'));
   await options.executeEditorCommand(name as CadCommand);
  }catch(error){append('error',error instanceof Error?error.message:String(error));}
  finally{busy=false;emit();}
 }
 return {
  get state(){return state();},submit,complete,
  /** Durable journal text; see exportCommandJournal. Never changes the model. */
  exportJournal(format:JournalExportFormat='cadscript'){return journal.export(format);},
  reportError(error:unknown){append('error',error instanceof Error?error.message:String(error));},
  submitPoint(value:Vec3){if(!pending?.steps[pending.values.length].point)return;return submit(value.join(','));},
  cancel(){if(pending){pending=undefined;append('output',t('Command canceled.'));}},
  clear(){entries=[];emit();},
  subscribe(listener:(state:TerminalState)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
  dispose(){disposed=true;pending=undefined;unsubscribe();unsubscribeCommands();journal.dispose();listeners.clear();}
 };
}
