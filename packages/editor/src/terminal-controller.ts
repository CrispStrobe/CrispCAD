// SPDX-License-Identifier: BSD-3-Clause
import {identityTransform,newId,t} from '@brickwright/cad-core';
import type {CadSession,Vec3,SessionCommandRecord} from '@brickwright/cad-core';
import type {CadCommand} from './index.js';
import {paletteCommands} from './command-palette.js';
import {parseTerminalPoint,terminalArguments,terminalNumber,terminalTokens} from './terminal-coordinates.js';

export interface TerminalStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export interface TerminalEntry {id:number;kind:'input'|'action'|'output'|'error';summary:string;text?:string}
export interface TerminalPrompt {command:string;message:string;point:boolean;plane?:'XY';base?:Vec3}
export interface TerminalState {entries:readonly TerminalEntry[];history:readonly string[];prompt?:TerminalPrompt;busy:boolean}
export interface TerminalCompletion {text:string;caret:number;label:string;description:string}
type Value=number|Vec3|string[];
type Step={message:string;point?:boolean;plane?:'XY';completion?:'bodies'|'sketches';parse:(text:string,values:Value[])=>Value};
type Pending={name:string;steps:Step[];values:Value[];revision:number;projectId:string;targets?:string[];finish:(values:Value[])=>void};
export type TerminalOptions={executeEditorCommand:(command:CadCommand)=>void|Promise<void>;openCodeWorkspace:()=>void;storage?:TerminalStorage};
type Definition={name:string;aliases:readonly string[];description:string;usage:string};
const drafting:readonly Definition[]=[
 {name:'help',aliases:['?'],description:'Command help',usage:'help [command]'},
 {name:'list',aliases:['ls'],description:'List objects and sketches',usage:'list'},
 {name:'clear',aliases:['cls'],description:'Clear the terminal transcript',usage:'clear'},
 {name:'box',aliases:['b'],description:'Create a box',usage:'box [width,depth,height] [center]'},
 {name:'sphere',aliases:['sp'],description:'Create a sphere',usage:'sphere [radius] [center]'},
 {name:'cylinder',aliases:['cyl'],description:'Create a cylinder',usage:'cylinder [radius] [height] [center]'},
 {name:'line',aliases:['l'],description:'Draw an XY sketch line',usage:'line [start] [end]'},
 {name:'rectangle',aliases:['rect'],description:'Draw an XY sketch rectangle',usage:'rectangle [corner] [opposite]'},
 {name:'circle',aliases:['c'],description:'Draw an XY sketch circle',usage:'circle [center] [radius]'},
 {name:'extrude',aliases:['ex'],description:'Extrude a closed sketch',usage:'extrude [sketch ID or "name"] [height]'},
 {name:'move',aliases:['m'],description:'Move selected bodies between points',usage:'move [base] [destination]'},
 {name:'rotate',aliases:['ro'],description:'Rotate selected bodies by XYZ degrees',usage:'rotate [x,y,z]'},
 {name:'scale',aliases:['sc'],description:'Scale selected bodies by XYZ factors',usage:'scale [x,y,z]'},
 {name:'select',aliases:['sel'],description:'Select bodies by ID or exact name',usage:'select [all|none|"name"|id ...]'},
 {name:'code',aliases:['script'],description:'Open the persistent code workspace',usage:'code'},
 {name:'apply',aliases:[],description:'Replay a recorded model edit',usage:'apply <recorded JSON>'},
];
const aliases:Partial<Record<CadCommand,string[]>>={undo:['u'],redo:['re'],delete:['erase','del'],duplicate:['dup'],fit:['zoom'],union:['join']};
export const terminalCommands:readonly Definition[]=[...drafting,...paletteCommands.filter(entry=>!drafting.some(d=>d.name===entry.command)&&!['terminal','code-workspace'].includes(entry.command)).map(entry=>({name:entry.command,aliases:aliases[entry.command]??[],description:entry.label,usage:entry.command}))];

export function completeTerminalCommand(text:string):string[] {
 const query=text.toLowerCase().trim();if(/\s/.test(query))return [];
 return terminalCommands.filter(entry=>entry.name.startsWith(query)||entry.aliases.some(alias=>alias.startsWith(query)))
  .sort((a,b)=>Number(!a.name.startsWith(query))-Number(!b.name.startsWith(query))||a.name.localeCompare(b.name)).map(entry=>entry.name);
}

const findCommand=(token:string)=>terminalCommands.find(entry=>entry.name===token.toLowerCase()||entry.aliases.includes(token.toLowerCase()));
const quoteArgument=(value:string)=>'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';

export function createTerminalController(session:CadSession,options:TerminalOptions){
 let entries:TerminalEntry[]=[],history:string[]=[],serial=0,pending:Pending|undefined,busy=false,disposed=false,executing=false;
 let projectId=session.state.document.id,lastPoint:Vec3|undefined;
 const listeners=new Set<(state:TerminalState)=>void>();
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
 function remember(text:string){if(text.length>4096||/^apply\s/i.test(text))return;if(history.at(-1)!==text)history.push(text);history=history.slice(-100);try{options.storage?.setItem(historyKey(),JSON.stringify(history));}catch{}}
 const unsubscribeCommands=session.subscribeCommands((record:SessionCommandRecord)=>append('action',record.summary,record.text));
 const unsubscribe=session.subscribe(current=>{
  if(current.document.id!==projectId){projectId=current.document.id;pending=undefined;lastPoint=undefined;entries=[];loadHistory();emit();}
  else if(pending&&!executing&&current.revision!==pending.revision){pending=undefined;append('error',t('The model changed. Start the command again.'));}
  else if(pending?.targets&&!executing&&JSON.stringify(current.selection.filter(id=>current.document.roots.includes(id)))!==JSON.stringify(pending.targets)){pending=undefined;append('error',t('The selection changed. Start the command again.'));}
 });
 const positive=(text:string)=>{const value=terminalNumber(text);if(value<=0||value>100000)throw new Error(t('Enter a value greater than zero and at most 100000.'));return value;};
 const dimension=(text:string)=>{const value=terminalNumber(text);if(value<.01||value>100000)throw new Error(t('Dimension must be between 0.01 and 100000 mm'));return value;};
 const solidRadius=(text:string)=>{const value=dimension(text);if(value>50000)throw new Error(t('Radius must be between 0.01 and 50000 mm.'));return value;};
 function vector(text:string):Vec3 {const parts=text.split(',');if(parts.length!==3)throw new Error(t('Enter three values as X,Y,Z.'));return parts.map(terminalNumber) as Vec3;}
 function selected():string[]{const ids=session.state.selection.filter(id=>session.state.document.roots.includes(id));if(!ids.length)throw new Error(t('Select a top-level body'));return [...ids];}
 function resolveSelection(text:string):string[]{
  if(!text.trim())return selected();
  const tokens=terminalTokens(text),doc=session.state.document;
  if(tokens.length===1&&!tokens[0].quoted&&tokens[0].value.toLowerCase()==='all')return [...doc.roots];
  if(tokens.length===1&&!tokens[0].quoted&&tokens[0].value.toLowerCase()==='none')return [];
  return [...new Set(tokens.map(({value:token})=>{if(doc.roots.includes(token))return token;const matches=doc.roots.filter(id=>doc.nodes[id].name===token);if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${token}`);return matches[0];}))];
 }
 function complete(text:string,caret=text.length):TerminalCompletion[]{
  if(disposed||busy||text.length>4096)return [];
  caret=Math.max(0,Math.min(text.length,caret));
  const before=terminalTokens(text.slice(0,caret),true),last=before.at(-1),current=last?.end===caret?last:undefined;
  const prior=current?before.slice(0,-1):before,start=current?.start??caret;
  const end=terminalTokens(text,true).find(token=>token.start===start)?.end??caret;
  const prefix=current?.value??'',query=prefix.toLowerCase();
  let kind:'commands'|'bodies'|'sketches'|undefined,argumentsBefore=prior;
  if(pending){kind=pending.steps[pending.values.length].completion;}
  else if(!prior.length){kind='commands';}
  else{
   const name=findCommand(prior[0].value)?.name;argumentsBefore=prior.slice(1);
   if(name==='help'&&!argumentsBefore.length)kind='commands';
   else if(name==='extrude'&&!argumentsBefore.length)kind='sketches';
   else if(name==='select'&&!/^\s*\[/.test(text.slice(prior[0].end)))kind='bodies';
  }
  const choices:{value:string;label:string;description:string}[]=[];
  if(kind==='commands'){
   for(const name of completeTerminalCommand(prefix)){const command=findCommand(name)!;choices.push({value:name,label:name,description:t(command.description)});}
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
 const point=(message:string,plane?:'XY',fallback?:()=>Vec3):Step=>({message,point:true,plane,parse:text=>{
  const result=!text.trim()&&fallback?fallback():parseTerminalPoint(text,lastPoint);
  if(plane==='XY'&&Math.abs(result[2])>1e-8)throw new Error(t('This sketch command uses the XY plane; Z must be zero.'));
  return result;
 }});
 function begin(name:string,args:string[],steps:Step[],finish:(values:Value[])=>void,targets?:string[]){
  if(args.length>steps.length)throw new Error(t('Too many arguments. Use help for command syntax.'));
  pending={name,steps,values:[],revision:session.state.revision,projectId,finish,targets};
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
   try{active.finish(values);pending=undefined;if(step.point)lastPoint=[...value as Vec3];}
   finally{executing=false;}
  }else{active.values=values;if(step.point)lastPoint=[...value as Vec3];}
  emit();
 }
 function start(name:string,args:string[]){
  const center=()=>point(t('Center X,Y,Z — Enter places it on the workplane.'),undefined,()=>[0,0,0]);
  if(name==='box'){
   const dimensions:Step={message:t('Box dimensions: width,depth,height (mm).'),parse:text=>{const v=vector(text);v.forEach(n=>dimension(String(n)));return v;}};
   begin(name,args,[dimensions,{...center(),parse:(text,values)=>text.trim()?parseTerminalPoint(text,lastPoint):[0,0,(values[0] as Vec3)[2]/2]}],values=>session.add({kind:'box',size:values[0] as Vec3},{transform:{...identityTransform(),position:values[1] as Vec3}}));return;
  }
  if(name==='sphere'||name==='cylinder'){
   const steps:Step[]=[{message:t('Radius (mm).'),parse:solidRadius}];
   if(name==='cylinder')steps.push({message:t('Height (mm).'),parse:dimension});
   steps.push({...center(),parse:(text,values)=>text.trim()?parseTerminalPoint(text,lastPoint):[0,0,name==='sphere'?values[0] as number:(values[1] as number)/2]});
   begin(name,args,steps,values=>session.add(name==='sphere'?{kind:'sphere',radius:values[0] as number,segments:48}:{kind:'cylinder',radius:values[0] as number,height:values[1] as number,segments:48},{transform:{...identityTransform(),position:values.at(-1) as Vec3}}));return;
  }
  if(name==='line'||name==='rectangle'){
   begin(name,args,[point(t('First point: X,Y — type or pick on the XY workplane.'),'XY'),point(t('Next point: X,Y, @dX,dY or @distance<angle.'),'XY')],values=>{
    const [a,b]=values as Vec3[];
    if(name==='line')session.addSketch({id:newId(),kind:'path',points:[[a[0],a[1]],[b[0],b[1]]]},{name:t('Line'),plane:'XY'});
    else session.addSketch({id:newId(),kind:'outline',points:[[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]]]},{name:t('Rectangle'),plane:'XY'});
   });return;
  }
  if(name==='circle'){
   begin(name,args,[point(t('Center: X,Y — type or pick on the XY workplane.'),'XY'),{message:t('Radius (mm).'),parse:dimension}],values=>{const a=values[0] as Vec3;session.addSketch({id:newId(),kind:'circle',center:[a[0],a[1]],radius:values[1] as number,segments:64},{name:t('Circle'),plane:'XY'});});return;
  }
  if(name==='extrude'){
   begin(name,args,[{message:t('Closed sketch ID or exact name (use list to see sketches).'),completion:'sketches',parse:text=>{
    const quoted=/^["']/.test(text.trim()),parts=quoted?terminalArguments(text):[];
    if(quoted&&parts.length!==1)throw new Error(t('Choose one closed sketch by ID or unique name.'));
    const target=quoted?parts[0]:text.trim();
    const sketches=Object.values(session.state.document.sketches??{}),byId=sketches.find(sketch=>sketch.id===target),matches=byId?[byId]:sketches.filter(sketch=>sketch.name===target);
    if(matches.length!==1||matches[0].profile.kind==='path')throw new Error(t('Choose one closed sketch by ID or unique name.'));
    return [matches[0].id];
   }},{message:t('Height (mm).'),parse:dimension}],values=>session.extrudeSketch((values[0] as string[])[0],{distance:values[1] as number}));return;
  }
  if(name==='select'){begin(name,args.length?[args.join(' ')]:[],[{message:t('Select objects on the canvas, then Enter; or type all, none, an ID or a quoted name.'),completion:'bodies',parse:resolveSelection}],values=>session.select(values[0] as string[]));return;}
  if(name==='move'||name==='rotate'||name==='scale'){
   const ids=selected();
   const steps=name==='move'?[point(t('Base point: X,Y,Z — Enter uses the origin.'),undefined,()=>[0,0,0]),point(t('Destination: X,Y,Z or @dX,dY,dZ.'))]:[{message:name==='rotate'?t('Rotation delta: X,Y,Z in degrees.'):t('Scale factors: X,Y,Z, each greater than zero.'),parse:(text:string)=>{const v=vector(text);if(name==='scale')v.forEach(n=>positive(String(n)));return v;}}];
   begin(name,args,steps,values=>session.transform(ids.map(id=>{const transform=structuredClone(session.state.document.nodes[id].transform);if(name==='move')transform.position=transform.position.map((n,i)=>n+(values[1] as Vec3)[i]-(values[0] as Vec3)[i]) as Vec3;else if(name==='rotate')transform.rotation=transform.rotation.map((n,i)=>n+(values[0] as Vec3)[i]) as Vec3;else transform.scale=transform.scale.map((n,i)=>n*(values[0] as Vec3)[i]) as Vec3;return {id,transform};})),ids);return;
  }
  throw new Error(t('Unknown editor command'));
 }
 async function submit(raw:string){
  if(disposed||busy)return;let text=raw.trim();
  if(!pending&&!text)text=history.at(-1)??'';
  if(!pending&&!text)return;
  if(text.length>2*1024*1024){append('error',t('Command text exceeds the terminal limit.'));return;}
  busy=true;emit();
  try{
   if(pending){append('input',text||'↵');answer(text);return;}
   const match=/^(\S+)(?:\s+([\s\S]*))?$/.exec(text)!;
   const token=match[1].toLowerCase(),tail=match[2]??'';
   const definition=findCommand(token);
   if(!definition)throw new Error(t`Unknown command: ${token}. Type help.`);
   const name=definition.name;
   append('input',text.length>240?text.slice(0,237)+'…':text);remember(text);
   if(name==='apply'||name==='select'&&tail.trim().startsWith('[')){session.executeCommand(name+' '+tail);return;}
   const args=name==='select'?(tail.trim()?[tail]:[]):terminalArguments(tail);
   // A sketch name can itself begin with a quote. Keep its original quoting until the prompt parses it.
   if(name==='extrude'&&args.length){const first=terminalTokens(tail)[0];args[0]=tail.slice(first.start,first.end);}
   if(name==='help'){
    if(args.length>1)throw new Error(t('Too many arguments. Use help for command syntax.'));
    const entry=args.length?terminalCommands.find(entry=>entry.name===args[0].toLowerCase()||entry.aliases.includes(args[0].toLowerCase())):undefined;
    if(args.length&&!entry)throw new Error(t('Unknown editor command'));
    append('output',entry?`${entry.usage}\n${t(entry.description)}${entry.aliases.length?'\n'+t('Aliases')+': '+entry.aliases.join(', '):''}`:terminalCommands.map(entry=>`${entry.usage} — ${t(entry.description)}`).join('\n'));return;
   }
   if(name==='list'){
    if(args.length)throw new Error(t('Too many arguments. Use help for command syntax.'));
    const doc=session.state.document;append('output',[...doc.roots.map(id=>`${id}  ${doc.nodes[id].name}`),...Object.values(doc.sketches??{}).map(sketch=>`${sketch.id}  ${sketch.name} (${sketch.plane})`)].join('\n')||t('No objects or sketches.'));return;
   }
   if(name==='clear'){if(args.length)throw new Error(t('Too many arguments. Use help for command syntax.'));entries=[];emit();return;}
   if(name==='code'){if(args.length)throw new Error(t('Too many arguments. Use help for command syntax.'));options.openCodeWorkspace();return;}
   if(drafting.some(entry=>entry.name===name)){start(name,args);return;}
   if(args.length)throw new Error(t('Too many arguments. Use help for command syntax.'));
   await options.executeEditorCommand(name as CadCommand);
  }catch(error){append('error',error instanceof Error?error.message:String(error));}
  finally{busy=false;emit();}
 }
 return {
  get state(){return state();},submit,complete,
  reportError(error:unknown){append('error',error instanceof Error?error.message:String(error));},
  submitPoint(value:Vec3){if(!pending?.steps[pending.values.length].point)return;return submit(value.join(','));},
  cancel(){if(pending){pending=undefined;append('output',t('Command canceled.'));}},
  clear(){entries=[];emit();},
  subscribe(listener:(state:TerminalState)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
  dispose(){disposed=true;pending=undefined;unsubscribe();unsubscribeCommands();listeners.clear();}
 };
}
