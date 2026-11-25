// SPDX-License-Identifier: BSD-3-Clause
/**
 * One command vocabulary for every front end: terminal, command palette, MCP
 * and CLI. Each entry describes its canonical name, aliases, typed arguments
 * and whether it edits the model. Commands marked `headless` run here, over a
 * CadSession, with no DOM. View and panel commands stay in the editor, but
 * are described here so help, completion and the palette agree.
 *
 * Descriptions, labels and prompts are English i18n keys; translate with t().
 */
import {identityTransform,newId} from './document.js';
import type {Vec3} from './document.js';
import {t} from './i18n.js';
import type {CadSession} from './session.js';
import {commandArguments,commandNumber,commandTokens,parseCommandPoint} from './command-arguments.js';
import {EXACT_FEATURE_COMMANDS,formatExactResult,parseExactCommand,parseExactFeatureCommand,parseRecomputeCommand,recomputeExactFeatures,runExactFeatureCommand} from './exact-commands.js';
import type {ExactCommandFile,ExactCommandHost,ExactKernelReport} from './exact-commands.js';

export type CommandCategory='terminal'|'create'|'sketch'|'feature'|'selection'|'transform'|'history'|'edit'|'boolean'|'view'|'panel'|'replay'|'exchange'|'analysis';
export type CommandArgumentKind='point'|'vector'|'number'|'sketch'|'bodies'|'command'|'alias'|'json'|'keyword';
export interface CommandArgumentSpec {
 readonly name:string;
 readonly kind:CommandArgumentKind;
 readonly optional?:boolean;
 /** Points restricted to the XY workplane (Z must be zero). */
 readonly plane?:'XY';
 /** Allowed words for `keyword` arguments. */
 readonly values?:readonly string[];
 /** Inclusive numeric bounds in millimetres or as plain factors. */
 readonly min?:number;
 readonly max?:number;
 /** Accepts several values (selection targets). */
 readonly repeated?:boolean;
}
/** Availability flags known to the editor; used by the command palette. */
export type CommandAvailability='canWrapBody'|'canDrop'|'canEditMirror'|'canEditPattern'|'canUndo'|'canRedo'|'hasSelection'|'canDelete'|'canCombine'|'canExport'|'hasBodies'|'ready';
export interface CommandPaletteSpec {readonly label:string;readonly keywords?:string;readonly requires?:CommandAvailability;readonly order:number}
export interface CommandSpec {
 readonly name:string;
 readonly aliases:readonly string[];
 /** English i18n key. */
 readonly description:string;
 readonly usage:string;
 readonly category:CommandCategory;
 /** Running the command can change the model (and adds Undo steps). */
 readonly editsModel:boolean;
 readonly arguments:readonly CommandArgumentSpec[];
 /** Runs in core without an editor: MCP, CLI and tests. */
 readonly headless:boolean;
 /** Listed by terminal help and completion. */
 readonly terminal:boolean;
 /** The terminal routes this command through the editor's command bridge. */
 readonly editorBridge:boolean;
 readonly palette?:CommandPaletteSpec;
 /** Served by the optional exact B-rep kernel (lazily loaded; never a silent fallback). */
 readonly kernel?:'exact';
}

const arg=(name:string,kind:CommandArgumentKind,extra:Partial<CommandArgumentSpec>={}):CommandArgumentSpec=>({name,kind,...extra});
const xy=(name:string)=>arg(name,'point',{optional:true,plane:'XY'});
type Draft=Omit<CommandSpec,'terminal'|'editorBridge'|'palette'|'headless'>&{headless?:boolean};
// Terminal order is significant: help lists commands in this order.
const drafting:readonly Draft[]=[
 {name:'help',aliases:['?'],description:'Command help',usage:'help [command]',category:'terminal',editsModel:false,arguments:[arg('command','command',{optional:true})],headless:true},
 {name:'list',aliases:['ls'],description:'List objects and sketches',usage:'list',category:'terminal',editsModel:false,arguments:[],headless:true},
 {name:'clear',aliases:['cls'],description:'Clear the terminal transcript',usage:'clear',category:'terminal',editsModel:false,arguments:[]},
 {name:'alias',aliases:[],description:'List, inspect or define a custom command alias',usage:'alias [name [command]]',category:'terminal',editsModel:false,arguments:[arg('name','alias',{optional:true}),arg('command','command',{optional:true})]},
 {name:'unalias',aliases:[],description:'Remove a custom command alias',usage:'unalias <name>',category:'terminal',editsModel:false,arguments:[arg('name','alias')]},
 {name:'box',aliases:['b'],description:'Create a box',usage:'box [width,depth,height] [center]',category:'create',editsModel:true,arguments:[arg('size','vector',{min:.01,max:100000}),arg('center','point',{optional:true})],headless:true},
 {name:'sphere',aliases:['sp'],description:'Create a sphere',usage:'sphere [radius] [center]',category:'create',editsModel:true,arguments:[arg('radius','number',{min:.01,max:50000}),arg('center','point',{optional:true})],headless:true},
 {name:'cylinder',aliases:['cyl'],description:'Create a cylinder',usage:'cylinder [radius] [height] [center]',category:'create',editsModel:true,arguments:[arg('radius','number',{min:.01,max:50000}),arg('height','number',{min:.01,max:100000}),arg('center','point',{optional:true})],headless:true},
 {name:'line',aliases:['l'],description:'Draw an XY sketch line',usage:'line [start] [end]',category:'sketch',editsModel:true,arguments:[{...xy('start'),optional:false},{...xy('end'),optional:false}],headless:true},
 {name:'rectangle',aliases:['rect'],description:'Draw an XY sketch rectangle',usage:'rectangle [corner] [opposite]',category:'sketch',editsModel:true,arguments:[{...xy('corner'),optional:false},{...xy('opposite'),optional:false}],headless:true},
 {name:'circle',aliases:['c'],description:'Draw an XY sketch circle',usage:'circle [center] [radius]',category:'sketch',editsModel:true,arguments:[{...xy('center'),optional:false},arg('radius','number',{min:.01,max:100000})],headless:true},
 {name:'extrude',aliases:['ex'],description:'Extrude a closed sketch',usage:'extrude [sketch ID or "name"] [height]',category:'feature',editsModel:true,arguments:[arg('sketch','sketch'),arg('height','number',{min:.01,max:100000})],headless:true},
 {name:'move',aliases:['m'],description:'Move selected bodies between points',usage:'move [base] [destination]',category:'transform',editsModel:true,arguments:[arg('base','point',{optional:true}),arg('destination','point')],headless:true},
 {name:'rotate',aliases:['ro'],description:'Rotate selected bodies by XYZ degrees',usage:'rotate [x,y,z]',category:'transform',editsModel:true,arguments:[arg('degrees','vector')],headless:true},
 {name:'scale',aliases:['sc'],description:'Scale selected bodies by XYZ factors',usage:'scale [x,y,z]',category:'transform',editsModel:true,arguments:[arg('factors','vector',{min:0,max:100000})],headless:true},
 {name:'select',aliases:['sel'],description:'Select bodies by ID or exact name',usage:'select [all|none|"name"|id ...]',category:'selection',editsModel:false,arguments:[arg('targets','bodies',{optional:true,repeated:true})],headless:true},
 {name:'code',aliases:['script'],description:'Open the persistent code workspace',usage:'code',category:'panel',editsModel:false,arguments:[]},
 {name:'apply',aliases:[],description:'Replay a recorded model edit',usage:'apply <recorded JSON>',category:'replay',editsModel:true,arguments:[arg('record','json')],headless:true},
 {name:'export',aliases:[],description:'Export geometry',usage:'export [step [all|"name"|id ...]]',category:'exchange',editsModel:false,arguments:[arg('format','keyword',{optional:true,values:['step']}),arg('targets','bodies',{optional:true,repeated:true})],headless:true,kernel:'exact'},
 {name:'measure',aliases:[],description:'Measure volume, area and bounds exactly with the B-rep kernel',usage:'measure exact [all|"name"|id ...]',category:'analysis',editsModel:false,arguments:[arg('mode','keyword',{values:['exact']}),arg('targets','bodies',{optional:true,repeated:true})],headless:true,kernel:'exact'},
 {name:'fillet',aliases:[],description:'Round edges exactly with the B-rep kernel',usage:'fillet <radius> [all|"name"|id ...] [--face <normal>]',category:'feature',editsModel:true,arguments:[arg('radius','number',{min:.01,max:10000}),arg('targets','bodies',{optional:true,repeated:true}),arg('face','keyword',{optional:true,values:['--face']})],headless:true,kernel:'exact'},
 {name:'chamfer',aliases:[],description:'Bevel edges exactly with the B-rep kernel',usage:'chamfer <distance> [all|"name"|id ...] [--face <normal>]',category:'feature',editsModel:true,arguments:[arg('distance','number',{min:.01,max:10000}),arg('targets','bodies',{optional:true,repeated:true}),arg('face','keyword',{optional:true,values:['--face']})],headless:true,kernel:'exact'},
 {name:'shell',aliases:[],description:'Hollow a body to a wall thickness with open faces, exactly with the B-rep kernel',usage:'shell <thickness> [all|"name"|id ...] --open <normal> [--open <normal> ...]',category:'feature',editsModel:true,arguments:[arg('thickness','number',{min:.01,max:10000}),arg('targets','bodies',{optional:true,repeated:true}),arg('open','keyword',{values:['--open'],repeated:true})],headless:true,kernel:'exact'},
 {name:'recompute',aliases:[],description:'Recompute out-of-date exact fillets, chamfers and shells with the B-rep kernel',usage:'recompute exact [all|"name"|id ...]',category:'feature',editsModel:true,arguments:[arg('mode','keyword',{values:['exact']}),arg('targets','bodies',{optional:true,repeated:true})],headless:true,kernel:'exact'},
 {name:'journal',aliases:[],description:'Summarize or export the command journal',usage:'journal [export [cadscript|replay]]',category:'terminal',editsModel:false,arguments:[arg('action','keyword',{optional:true,values:['export']}),arg('format','keyword',{optional:true,values:['cadscript','replay']})],headless:true},
];
type PaletteDraft={command:string;label:string;alias?:string;requires?:CommandAvailability};
// Palette order is significant: it is the default palette listing.
const palette:readonly PaletteDraft[]=[
 {command:'shapes',label:'Find a shape',alias:'shape browser primitives'},
 {command:'model-library',label:'Model library',alias:'parts catalog'},
 {command:'sketch',label:'Sketch & extrude',alias:'profile DXF'},
 {command:'sketch-path',label:'Sketch path',alias:'open sketch line arc'},
 {command:'revolve',label:'Revolve',alias:'shaft sweep'},
 {command:'mirror',label:'Mirror body',alias:'reflect symmetry',requires:'canWrapBody'},
 {command:'edit-mirror',label:'Edit mirror',requires:'canEditMirror'},
 {command:'pattern',label:'Pattern body',alias:'linear circular repeat bolt circle',requires:'canWrapBody'},
 {command:'edit-pattern',label:'Edit pattern',requires:'canEditPattern'},
 {command:'exact-feature',label:'Fillet, chamfer or shell',alias:'round bevel hollow exact B-rep',requires:'canWrapBody'},
 {command:'parameters',label:'Parameters',alias:'named dimensions formulas'},
 {command:'code',label:'Code an object',alias:'CAD Script'},
 {command:'terminal',label:'CAD terminal',alias:'command line console'},
 {command:'code-workspace',label:'Code workspace',alias:'persistent CAD Script editor'},
 {command:'model-source',label:'Model source'},
 {command:'union',label:'Union',alias:'combine join',requires:'canCombine'},
 {command:'subtract',label:'Subtract',alias:'boolean cut difference',requires:'canCombine'},
 {command:'intersect',label:'Intersect',alias:'boolean overlap',requires:'canCombine'},
 {command:'drop',label:'Drop to workplane',alias:'ground',requires:'canDrop'},
 {command:'move',label:'Move',alias:'translate'},
 {command:'rotate',label:'Rotate'},
 {command:'scale',label:'Scale',alias:'resize'},
 {command:'select',label:'Select'},
 {command:'select-all',label:'Select all',requires:'hasBodies'},
 {command:'deselect',label:'Deselect',alias:'clear selection',requires:'hasSelection'},
 {command:'undo',label:'Undo',requires:'canUndo'},
 {command:'redo',label:'Redo',requires:'canRedo'},
 {command:'copy',label:'Copy',requires:'canDelete'},
 {command:'cut',label:'Cut',requires:'canDelete'},
 {command:'paste',label:'Paste'},
 {command:'duplicate',label:'Duplicate',requires:'canDelete'},
 {command:'delete',label:'Delete',requires:'canDelete'},
 {command:'fit',label:'Fit',alias:'frame selection'},
 {command:'home',label:'Home',alias:'isometric reset camera'},
 {command:'top',label:'Top view'},
 {command:'front',label:'Front view'},
 {command:'right',label:'Right view'},
 {command:'back',label:'Back view'},
 {command:'left',label:'Left view'},
 {command:'bottom',label:'Bottom view'},
 {command:'projection',label:'Toggle projection',alias:'perspective orthographic'},
 {command:'workplane',label:'Show workplane'},
 {command:'objects',label:'Objects'},
 {command:'properties',label:'Properties'},
 {command:'readout',label:'Show on-canvas parameters',alias:'transform values XYZ'},
 {command:'export',label:'Export geometry',alias:'STL 3MF',requires:'canExport'}
];
const bridgeAliases:Record<string,readonly string[]>={undo:['u'],redo:['re'],delete:['erase','del'],duplicate:['dup'],fit:['zoom'],union:['join']};
const bridgeCategory:Record<string,CommandCategory>={undo:'history',redo:'history',copy:'edit',cut:'edit',paste:'edit',duplicate:'edit',delete:'edit',drop:'transform',union:'boolean',subtract:'boolean',intersect:'boolean','select-all':'selection',deselect:'selection',fit:'view',home:'view',top:'view',front:'view',right:'view',back:'view',left:'view',bottom:'view',projection:'view',workplane:'view'};
/** Bridged commands that also have a pure headless executor below. */
const headlessBridge=new Set(['undo','redo','duplicate','delete','union','subtract','intersect','select-all','deselect']);
const bridgeEdits=new Set(['undo','redo','cut','paste','duplicate','delete','drop','union','subtract','intersect']);
/** Front-end toggles that open the surface they are typed into. */
const notInTerminal=new Set(['terminal','code-workspace']);

const freeze=<T extends object>(value:T):T=>{Object.freeze(value);for(const item of Object.values(value))if(item&&typeof item==='object'&&!Object.isFrozen(item))freeze(item);return value;};
const paletteSpec=(command:string):CommandPaletteSpec|undefined=>{
 const index=palette.findIndex(entry=>entry.command===command);if(index<0)return undefined;
 const entry=palette[index];
 return {label:entry.label,order:index,...(entry.alias?{keywords:entry.alias}:{}),...(entry.requires?{requires:entry.requires}:{})};
};
export const commandRegistry:readonly CommandSpec[]=freeze([
 ...drafting.map(({headless,...entry}):CommandSpec=>{const spec=paletteSpec(entry.name);return {...entry,headless:!!headless,terminal:true,editorBridge:false,...(spec?{palette:spec}:{})} as CommandSpec;}),
 ...palette.filter(entry=>!drafting.some(d=>d.name===entry.command)).map(({command,label}):CommandSpec=>{
  const spec=paletteSpec(command)!;
  return {name:command,aliases:bridgeAliases[command]??[],description:label,usage:command,category:bridgeCategory[command]??'panel',editsModel:bridgeEdits.has(command),arguments:[],headless:headlessBridge.has(command),terminal:!notInTerminal.has(command),editorBridge:true,palette:spec};
 }),
]);

/** Exact canonical name or fixed alias, case-insensitive. */
export function findCommandSpec(token:string):CommandSpec|undefined{
 const name=token.toLowerCase();
 return commandRegistry.find(entry=>entry.name===name||entry.aliases.includes(name));
}
/** Palette entries, in palette order. */
export function paletteCommandSpecs():CommandSpec[]{
 return commandRegistry.filter(entry=>entry.palette).sort((a,b)=>a.palette!.order-b.palette!.order);
}

export type CommandValue=number|Vec3|string[];
export interface CommandStep {
 readonly message:string;
 readonly point?:boolean;
 readonly plane?:'XY';
 readonly completion?:'bodies'|'sketches';
 parse(text:string,values:readonly CommandValue[]):CommandValue;
}
export interface PreparedCommand {
 readonly name:string;
 readonly steps:readonly CommandStep[];
 /** Selected bodies captured when a transform starts. */
 readonly targets?:readonly string[];
 /** Performs the session edit: one commit, one Undo step. */
 finish(values:readonly CommandValue[]):void;
 /** Canonical, absolute form of the accepted input (no relative points). */
 invocation(values:readonly CommandValue[]):string;
}
export interface CommandContext {lastPoint?:()=>Vec3|undefined}

const formatNumber=(value:number)=>String(Object.is(value,-0)?0:value);
const formatVector=(value:readonly number[])=>value.map(formatNumber).join(',');
const quoteWord=(value:string)=>/^[A-Za-z0-9_-]+$/.test(value)?value:'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';

/** Interactive steps and executor for commands that take typed arguments. */
export function prepareCommand(session:CadSession,name:string,context:CommandContext={}):PreparedCommand{
 const lastPoint=()=>context.lastPoint?.();
 const positive=(text:string)=>{const value=commandNumber(text);if(value<=0||value>100000)throw new Error(t('Enter a value greater than zero and at most 100000.'));return value;};
 const dimension=(text:string)=>{const value=commandNumber(text);if(value<.01||value>100000)throw new Error(t('Dimension must be between 0.01 and 100000 mm'));return value;};
 const solidRadius=(text:string)=>{const value=dimension(text);if(value>50000)throw new Error(t('Radius must be between 0.01 and 50000 mm.'));return value;};
 function vector(text:string):Vec3 {const parts=text.split(',');if(parts.length!==3)throw new Error(t('Enter three values as X,Y,Z.'));return parts.map(commandNumber) as Vec3;}
 function selected():string[]{const ids=session.state.selection.filter(id=>session.state.document.roots.includes(id));if(!ids.length)throw new Error(t('Select a top-level body'));return [...ids];}
 function resolveSelection(text:string):string[]{
  if(!text.trim())return selected();
  const tokens=commandTokens(text),doc=session.state.document;
  if(tokens.length===1&&!tokens[0].quoted&&tokens[0].value.toLowerCase()==='all')return [...doc.roots];
  if(tokens.length===1&&!tokens[0].quoted&&tokens[0].value.toLowerCase()==='none')return [];
  return [...new Set(tokens.map(({value:token})=>{if(doc.roots.includes(token))return token;const matches=doc.roots.filter(id=>doc.nodes[id].name===token);if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${token}`);return matches[0];}))];
 }
 const point=(message:string,plane?:'XY',fallback?:()=>Vec3):CommandStep=>({message,point:true,plane,parse:text=>{
  const result=!text.trim()&&fallback?fallback():parseCommandPoint(text,lastPoint());
  if(plane==='XY'&&Math.abs(result[2])>1e-8)throw new Error(t('This sketch command uses the XY plane; Z must be zero.'));
  return result;
 }});
 const center=()=>point(t('Center X,Y,Z — Enter places it on the workplane.'),undefined,()=>[0,0,0]);
 const prepared=(steps:CommandStep[],finish:(values:readonly CommandValue[])=>void,invocation:(values:readonly CommandValue[])=>string,targets?:string[]):PreparedCommand=>({name,steps,finish,invocation:values=>name+(invocation(values)?' '+invocation(values):''),...(targets?{targets}:{})});
 if(name==='box'){
  const dimensions:CommandStep={message:t('Box dimensions: width,depth,height (mm).'),parse:text=>{const v=vector(text);v.forEach(n=>dimension(String(n)));return v;}};
  return prepared([dimensions,{...center(),parse:(text,values)=>text.trim()?parseCommandPoint(text,lastPoint()):[0,0,(values[0] as Vec3)[2]/2]}],
   values=>{session.add({kind:'box',size:values[0] as Vec3},{transform:{...identityTransform(),position:values[1] as Vec3}});},
   values=>`${formatVector(values[0] as Vec3)} ${formatVector(values[1] as Vec3)}`);
 }
 if(name==='sphere'||name==='cylinder'){
  const steps:CommandStep[]=[{message:t('Radius (mm).'),parse:solidRadius}];
  if(name==='cylinder')steps.push({message:t('Height (mm).'),parse:dimension});
  steps.push({...center(),parse:(text,values)=>text.trim()?parseCommandPoint(text,lastPoint()):[0,0,name==='sphere'?values[0] as number:(values[1] as number)/2]});
  return prepared(steps,
   values=>{session.add(name==='sphere'?{kind:'sphere',radius:values[0] as number,segments:48}:{kind:'cylinder',radius:values[0] as number,height:values[1] as number,segments:48},{transform:{...identityTransform(),position:values.at(-1) as Vec3}});},
   values=>values.map(value=>typeof value==='number'?formatNumber(value):formatVector(value as Vec3)).join(' '));
 }
 if(name==='line'||name==='rectangle'){
  return prepared([point(t('First point: X,Y — type or pick on the XY workplane.'),'XY'),point(t('Next point: X,Y, @dX,dY or @distance<angle.'),'XY')],values=>{
   const [a,b]=values as Vec3[];
   if(name==='line')session.addSketch({id:newId(),kind:'path',points:[[a[0],a[1]],[b[0],b[1]]]},{name:t('Line'),plane:'XY'});
   else session.addSketch({id:newId(),kind:'outline',points:[[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]]]},{name:t('Rectangle'),plane:'XY'});
  },values=>(values as Vec3[]).map(p=>formatVector(p.slice(0,2))).join(' '));
 }
 if(name==='circle'){
  return prepared([point(t('Center: X,Y — type or pick on the XY workplane.'),'XY'),{message:t('Radius (mm).'),parse:dimension}],values=>{const a=values[0] as Vec3;session.addSketch({id:newId(),kind:'circle',center:[a[0],a[1]],radius:values[1] as number,segments:64},{name:t('Circle'),plane:'XY'});},
   values=>`${formatVector((values[0] as Vec3).slice(0,2))} ${formatNumber(values[1] as number)}`);
 }
 if(name==='extrude'){
  return prepared([{message:t('Closed sketch ID or exact name (use list to see sketches).'),completion:'sketches',parse:text=>{
   const quoted=/^["']/.test(text.trim()),parts=quoted?commandArguments(text):[];
   if(quoted&&parts.length!==1)throw new Error(t('Choose one closed sketch by ID or unique name.'));
   const target=quoted?parts[0]:text.trim();
   const sketches=Object.values(session.state.document.sketches??{}),byId=sketches.find(sketch=>sketch.id===target),matches=byId?[byId]:sketches.filter(sketch=>sketch.name===target);
   if(matches.length!==1||matches[0].profile.kind==='path')throw new Error(t('Choose one closed sketch by ID or unique name.'));
   return [matches[0].id];
  }},{message:t('Height (mm).'),parse:dimension}],values=>{session.extrudeSketch((values[0] as string[])[0],{distance:values[1] as number});},
   values=>`${(values[0] as string[])[0]} ${formatNumber(values[1] as number)}`);
 }
 if(name==='select'){
  return prepared([{message:t('Select objects on the canvas, then Enter; or type all, none, an ID or a quoted name.'),completion:'bodies',parse:resolveSelection}],values=>session.select(values[0] as string[]),
   values=>(values[0] as string[]).length?(values[0] as string[]).map(quoteWord).join(' '):'none');
 }
 if(name==='move'||name==='rotate'||name==='scale'){
  const ids=selected();
  const steps=name==='move'?[point(t('Base point: X,Y,Z — Enter uses the origin.'),undefined,()=>[0,0,0]),point(t('Destination: X,Y,Z or @dX,dY,dZ.'))]:[{message:name==='rotate'?t('Rotation delta: X,Y,Z in degrees.'):t('Scale factors: X,Y,Z, each greater than zero.'),parse:(text:string)=>{const v=vector(text);if(name==='scale')v.forEach(n=>positive(String(n)));return v;}}];
  return prepared(steps,values=>session.transform(ids.map(id=>{const transform=structuredClone(session.state.document.nodes[id].transform);if(name==='move')transform.position=transform.position.map((n,i)=>n+(values[1] as Vec3)[i]-(values[0] as Vec3)[i]) as Vec3;else if(name==='rotate')transform.rotation=transform.rotation.map((n,i)=>n+(values[0] as Vec3)[i]) as Vec3;else transform.scale=transform.scale.map((n,i)=>n*(values[0] as Vec3)[i]) as Vec3;return {id,transform};})),
   values=>(values as Vec3[]).map(formatVector).join(' '),ids);
 }
 throw new Error(t('Unknown editor command'));
}
/** Commands that take typed arguments and prompt for missing ones. */
export const interactiveCommandNames:readonly string[]=Object.freeze(['box','sphere','cylinder','line','rectangle','circle','extrude','move','rotate','scale','select']);

/** Headless executors for bridged editor commands. Same session calls as the editor. */
const bridgeExecutors:Record<string,(session:CadSession)=>void>={
 undo:session=>session.undo(),redo:session=>session.redo(),
 duplicate:session=>session.duplicate(),delete:session=>session.remove(),
 union:session=>session.combine('union'),subtract:session=>session.combine('subtract'),intersect:session=>session.combine('intersect'),
 'select-all':session=>session.select(session.state.document.roots),deselect:session=>session.select([]),
};

/** `help` text for all commands or one; extra aliases are user-defined. */
export function commandHelp(spec?:CommandSpec,extraAliases:readonly string[]=[],commands:readonly CommandSpec[]=commandRegistry.filter(entry=>entry.terminal)):string{
 if(!spec)return commands.map(entry=>`${entry.usage} — ${t(entry.description)}`).join('\n');
 const names=[...spec.aliases,...extraAliases];
 return `${spec.usage}\n${t(spec.description)}${names.length?'\n'+t('Aliases')+': '+names.join(', '):''}`;
}
/** `list` text: bodies, then sketches. */
export function listModel(session:CadSession):string{
 const doc=session.state.document;
 return [...doc.roots.map(id=>`${id}  ${doc.nodes[id].name}`),...Object.values(doc.sketches??{}).map(sketch=>`${sketch.id}  ${sketch.name} (${sketch.plane})`)].join('\n')||t('No objects or sketches.');
}

export interface CommandRunResult {
 readonly command:string;
 /** Canonical input for interactive commands; otherwise the trimmed line. */
 readonly invocation:string;
 readonly output?:string;
 /** True when the model revision changed. */
 readonly edited:boolean;
 /** A file the command produced (`export step`). */
 readonly file?:ExactCommandFile;
 /** The kernel that served an exact command. */
 readonly kernel?:ExactKernelReport;
}
export interface CommandRunnerOptions {
 /** Records invocations and answers `journal`. */
 journal?:{withInvocation<T>(line:string,run:()=>T):T;summary():string;export(format?:'cadscript'|'replay'):string};
 /** Serves `export step`, `measure exact`, `fillet`, `chamfer`, `shell` and `recompute exact`;
  * only `runAsync`/`runScriptAsync` use it. */
 exact?:ExactCommandHost;
 signal?:AbortSignal;
}
export const COMMAND_LINE_LIMIT=256*1024;

/**
 * Runs complete command lines headlessly. There are no prompts: a missing
 * argument uses the same default an empty Enter would, or fails. Never
 * evaluates JavaScript; `apply` and `select [...]` accept data only.
 */
export function createCommandRunner(session:CadSession,options:CommandRunnerOptions={}){
 let lastPoint:Vec3|undefined;
 function parse(raw:string){
  const text=raw.trim();
  if(!text)throw new Error(t('Enter a command.'));
  if(text.length>COMMAND_LINE_LIMIT)throw new Error(t('Command text exceeds the terminal limit.'));
  const match=/^(\S+)(?:\s+([\s\S]*))?$/.exec(text)!;
  const spec=findCommandSpec(match[1]),tail=match[2]??'';
  if(!spec)throw new Error(t`Unknown command: ${match[1].toLowerCase()}. Type help.`);
  if(!spec.headless)throw new Error(t`${spec.name} needs the interactive editor.`);
  return {text,spec,tail};
 }
 /** Exact commands read the model; the request holds the snapshot taken now. */
 function exactRequest(spec:CommandSpec,tail:string){
  if(spec.kernel!=='exact'||EXACT_FEATURE_COMMANDS.includes(spec.name)||spec.name==='recompute')return undefined;
  const parsed=parseExactCommand(session,spec.name,tail);
  if(!parsed)throw new Error(t('Usage: export step [all|"name"|id ...].'));
  return parsed;
 }
 async function runAsync(raw:string):Promise<CommandRunResult>{
  const {spec,tail}=parse(raw);
  if(EXACT_FEATURE_COMMANDS.includes(spec.name)||spec.name==='recompute'){
   // Exact edits: the kernel computes the result first, then one commit records it with the kernel.
   const parsed=spec.name==='recompute'?undefined:parseExactFeatureCommand(session,spec.name,tail),recompute=parsed?undefined:parseRecomputeCommand(session,tail);
   if(!options.exact)throw new Error(t('The exact kernel is not available in this host.'));
   const before=session.state.revision,record=options.journal?<T,>(line:string,commit:()=>T)=>options.journal!.withInvocation(line,commit):undefined;
   const done=parsed?await runExactFeatureCommand(session,options.exact,parsed,{signal:options.signal,record}):await recomputeExactFeatures(session,options.exact,recompute!.features,{signal:options.signal,record,invocation:recompute!.invocation});
   return {command:spec.name,invocation:done.invocation,output:done.output,edited:session.state.revision!==before,...(done.kernel?{kernel:done.kernel}:{})};
  }
  const request=exactRequest(spec,tail);
  if(!request)return run(raw);
  if(!options.exact)throw new Error(t('The exact kernel is not available in this host.'));
  const document=session.state.document;
  const result=await options.exact.run({operation:request.operation,document,bodies:request.bodies},options.signal);
  const formatted=formatExactResult(result,document);
  return {command:spec.name,invocation:request.invocation,output:formatted.output,edited:false,kernel:formatted.kernel,...(formatted.file?{file:formatted.file}:{})};
 }
 function run(raw:string):CommandRunResult{
  const {text,spec,tail}=parse(raw);
  if(EXACT_FEATURE_COMMANDS.includes(spec.name)||spec.name==='recompute'||exactRequest(spec,tail))throw new Error(t`${spec.name} uses the exact kernel; run it in a host that loads it.`);
  const name=spec.name,before=session.state.revision;
  const done=(invocation:string,output?:string):CommandRunResult=>({command:name,invocation,...(output!==undefined?{output}:{}),edited:session.state.revision!==before});
  if(name==='apply'||name==='select'&&tail.trim().startsWith('[')){session.executeCommand(name+' '+tail);return done(text.length>240?name:text);}
  const args=name==='select'?(tail.trim()?[tail]:[]):commandArguments(tail);
  if(name==='extrude'&&args.length){const first=commandTokens(tail)[0];args[0]=tail.slice(first.start,first.end);}
  if(name==='help'){
   if(args.length>1)throw new Error(t('Too many arguments. Use help for command syntax.'));
   const entry=args.length?findCommandSpec(args[0]):undefined;
   if(args.length&&!entry)throw new Error(t('Unknown editor command'));
   return done(text,commandHelp(entry));
  }
  if(name==='list'){if(args.length)throw new Error(t('Too many arguments. Use help for command syntax.'));return done(text,listModel(session));}
  if(name==='journal'){
   if(!options.journal)throw new Error(t('No command journal is attached.'));
   if(!args.length)return done(text,options.journal.summary());
   if(args[0]!=='export'||args.length>2||args[1]!==undefined&&!['cadscript','replay'].includes(args[1]))throw new Error(t('Usage: journal [export [cadscript|replay]].'));
   return done(text,options.journal.export((args[1]??'cadscript') as 'cadscript'|'replay'));
  }
  const bridge=bridgeExecutors[name];
  if(bridge){if(args.length)throw new Error(t('Too many arguments. Use help for command syntax.'));bridge(session);return done(name);}
  const command=prepareCommand(session,name,{lastPoint:()=>lastPoint});
  if(args.length>command.steps.length)throw new Error(t('Too many arguments. Use help for command syntax.'));
  const values:CommandValue[]=[];
  for(let i=0;i<command.steps.length;i++){
   const step=command.steps[i];let value:CommandValue;
   if(i<args.length)value=step.parse(args[i],values);
   else{try{value=step.parse('',values);}catch{throw new Error(t`Missing arguments. Usage: ${spec.usage}`);}}
   values.push(value);if(step.point)lastPoint=[...value as Vec3];
  }
  const invocation=command.invocation(values);
  if(options.journal)options.journal.withInvocation(invocation,()=>command.finish(values));else command.finish(values);
  return done(invocation);
 }
 function scriptLines(script:string,limits:{maxLines?:number}){
  const commands=script.split(/\r?\n/).map((line,index)=>({line:line.trim(),number:index+1})).filter(entry=>entry.line&&!entry.line.startsWith('//'));
  if(commands.length>(limits.maxLines??256))throw new Error(t`A command script accepts at most ${limits.maxLines??256} commands.`);
  return commands;
 }
 const lineError=(error:unknown,number:number,results:CommandRunResult[])=>Object.assign(new Error(t`Line ${number}: ${error instanceof Error?error.message:String(error)}`),{line:number,results});
 return {
  run,
  /** Like `run`, and also serves exact-kernel commands through `options.exact`. */
  runAsync,
  /** Runs a script: one command per line; blank lines and `//` comments are skipped. Stops at the first error, reporting its line. */
  runScript(script:string,limits:{maxLines?:number}={}):CommandRunResult[]{
   const results:CommandRunResult[]=[];
   for(const entry of scriptLines(script,limits)){
    try{results.push(run(entry.line));}
    catch(error){throw lineError(error,entry.number,results);}
   }
   return results;
  },
  /** `runScript` with exact-kernel commands; each reads the model as of its own line. */
  async runScriptAsync(script:string,limits:{maxLines?:number}={}):Promise<CommandRunResult[]>{
   const results:CommandRunResult[]=[];
   for(const entry of scriptLines(script,limits)){
    try{results.push(await runAsync(entry.line));}
    catch(error){throw lineError(error,entry.number,results);}
   }
   return results;
  },
 };
}
export type CommandRunner=ReturnType<typeof createCommandRunner>;
