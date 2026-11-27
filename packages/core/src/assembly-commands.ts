// SPDX-License-Identifier: BSD-3-Clause
// Terminal, palette, MCP and CLI commands for assemblies (document version 50): groups,
// suppression, configurations, exploded views, the mechanism check and the planetary preset.
// Each edit is one session call (one Undo step); `invocation` is the canonical form the journal
// records.
import {t} from './i18n.js';
import {commandNumber,commandTokens} from './command-arguments.js';
import type {CadSession} from './session.js';
import type {CadDocument,Vec3} from './document.js';
import {groupBodies,planExplodedView} from './assembly.js';
import type {ExplodeBodyBounds,MechanismReport,MechanismSettings} from './assembly.js';
import {formatMechanismReport} from './assembly.js';
import {createPlanetaryDocument,planetaryLayout} from './planetary.js';
import type {PlanetaryOptions} from './planetary.js';
import {newId} from './document.js';
import type {CadJoint} from './physics.js';

/** What assembly commands need from their host beyond the session: evaluated body bounds (for
 * `explode auto`) and the mechanism check (Manifold, in the geometry worker or thread). */
export interface AssemblyHost {
 bounds(doc:CadDocument,signal?:AbortSignal):Promise<ExplodeBodyBounds[]>;
 mechanism(doc:CadDocument,settings:MechanismSettings,signal?:AbortSignal):Promise<MechanismReport>;
}
export interface AssemblyCommand {
 invocation:string;
 /** Runs the command: at most one commit. Async commands make their commit inside `record` (the
  * journal's wrapper), after the host has answered. */
 run(session:CadSession,host?:AssemblyHost,signal?:AbortSignal,record?:<T>(line:string,commit:()=>T)=>T):Promise<string>|string;
 /** Needs the host (bounds or mechanism). */
 async?:true;
 edits:boolean;
}
export const ASSEMBLY_COMMANDS=['group','ungroup','groups','suppress','unsuppress','config','explode','mechanism','planetary'] as const;
const quote=(value:string)=>/^[A-Za-z0-9_.:-]+$/.test(value)?value:'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
const num=(value:number)=>String(+value.toFixed(6));

function bodiesFrom(session:CadSession,tokens:readonly {value:string;quoted:boolean}[]):string[]{
 const doc=session.state.document;
 if(!tokens.length){const ids=session.state.selection.filter(id=>doc.roots.includes(id));if(!ids.length)throw new Error(t('Select top-level bodies, or name them'));return ids;}
 if(tokens.length===1&&!tokens[0].quoted&&tokens[0].value.toLowerCase()==='all')return [...doc.roots];
 return [...new Set(tokens.map(({value})=>{if(doc.roots.includes(value))return value;const matches=doc.roots.filter(id=>doc.nodes[id].name===value);if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${value}`);return matches[0];}))];
}
function groupFrom(doc:CadDocument,value:string){
 const groups=doc.assembly?.groups??[],found=groups.find(g=>g.id===value)??(()=>{const named=groups.filter(g=>g.name===value);if(named.length>1)throw new Error(t`Several groups are called ${value}; use the group's id`);return named[0];})();
 if(!found)throw new Error(t`Unknown group: ${value}`);return found;
}
/** A joint by its motor port (A, B…), its id, or its number in the list (1-based). */
export function jointFrom(doc:CadDocument,value:string):CadJoint{
 const joints=doc.joints??[];
 const found=joints.find(j=>j.id===value)??joints.find(j=>j.control?.port===value.toUpperCase())??(/^\d+$/.test(value)?joints[Number(value)-1]:undefined);
 if(!found)throw new Error(t`Unknown joint: ${value}. Type mechanism to list the joints.`);
 return found;
}
export function listJoints(doc:CadDocument):string{
 const joints=doc.joints??[];if(!joints.length)return t('The design has no joints.');
 return joints.map((j,i)=>`${i+1}. ${j.control?.port?`[${j.control.port}] `:''}${j.kind} ${doc.nodes[j.bodyA]?.name??j.bodyA} – ${doc.nodes[j.bodyB]?.name??j.bodyB}${j.limits?` (${j.kind==='hinge'?j.limits.map(v=>num(v*180/Math.PI)+'°').join(' … '):j.limits.map(v=>num(v)+' mm').join(' … ')})`:''}${j.gearMesh?t` · gear mesh ${num(j.gearMesh.ratio)}`:''}  ${j.id}`).join('\n');
}
export function listGroups(doc:CadDocument):string{
 const a=doc.assembly,groups=a?.groups??[],off=new Set(a?.suppressed??[]);
 const lines:string[]=[];
 const body=(id:string,depth:number)=>lines.push(`${'  '.repeat(depth)}· ${doc.nodes[id].name}${off.has(id)?t(' (suppressed)'):''}  ${id}`);
 const visit=(id:string|undefined,depth:number)=>{for(const g of groups.filter(x=>x.parent===id)){lines.push(`${'  '.repeat(depth)}▸ ${g.name} (${groupBodies(a,g.id).length})  ${g.id}`);visit(g.id,depth+1);g.members.forEach(m=>body(m,depth+1));}};
 visit(undefined,0);
 const grouped=new Set(groups.flatMap(g=>g.members));
 doc.roots.filter(id=>!grouped.has(id)).forEach(id=>body(id,0));
 const views=a?.views??[],configs=a?.configurations??[];
 if(views.length)lines.push(t`Exploded views: ${views.map(v=>`${v.name} (${v.steps.length})`).join(', ')}`);
 if(configs.length)lines.push(t`Configurations: ${configs.map(c=>c.id===a?.active?`${c.name} ✓`:c.name).join(', ')}`);
 return lines.join('\n')||t('No objects or sketches.');
}
const vector=(text:string):Vec3=>{const parts=text.split(',');if(parts.length!==3)throw new Error(t('Enter three values as X,Y,Z.'));const v=parts.map(commandNumber) as Vec3;if(!(Math.hypot(...v)>1e-9))throw new Error(t('The explode axis must not be zero'));return v;};
const axisWord=(word:string):Vec3|undefined=>({'+x':[1,0,0],'-x':[-1,0,0],'+y':[0,1,0],'-y':[0,-1,0],'+z':[0,0,1],'-z':[0,0,-1],x:[1,0,0],y:[0,1,0],z:[0,0,1]} as Record<string,Vec3>)[word.toLowerCase()];

/** Parses one assembly command line (`name` is the command, `tail` its arguments). */
export function parseAssemblyCommand(session:CadSession,name:string,tail:string):AssemblyCommand{
 const tokens=commandTokens(tail),doc=session.state.document,words=tokens.map(x=>x.value),lower=words.map(w=>w.toLowerCase());
 if(name==='groups'){if(tokens.length)throw new Error(t('Usage: groups'));return {invocation:'groups',edits:false,run:s=>listGroups(s.state.document)};}
 if(name==='group'){
  if(!tokens.length)throw new Error(t('Usage: group "name" [bodies…] [in "group"]'));
  const inAt=lower.lastIndexOf('in'),parent=inAt>0&&inAt===tokens.length-2?groupFrom(doc,words[inAt+1]):undefined;
  const ids=bodiesFrom(session,tokens.slice(1,parent?inAt:undefined)),label=words[0];
  return {invocation:`group ${quote(label)} ${ids.map(quote).join(' ')}${parent?` in ${quote(parent.id)}`:''}`,edits:true,run:s=>{const id=s.groupBodies(label,ids,parent?{parent:parent.id}:{});return t`Grouped ${ids.length} bodies as ${label} (${id}).`;}};
 }
 if(name==='ungroup'){
  if(tokens.length!==1)throw new Error(t('Usage: ungroup "group"'));
  const group=groupFrom(doc,words[0]);
  return {invocation:`ungroup ${quote(group.id)}`,edits:true,run:s=>{s.ungroup(group.id);return t`Dissolved the group ${group.name}.`;}};
 }
 if(name==='suppress'||name==='unsuppress'){
  const ids=name==='unsuppress'&&lower.length===1&&lower[0]==='all'?[...(doc.assembly?.suppressed??[])]:bodiesFrom(session,tokens);
  if(!ids.length)throw new Error(t('No body is suppressed.'));
  return {invocation:`${name} ${ids.map(quote).join(' ')}`,edits:true,run:s=>{s.setSuppressed(ids,name==='suppress');return name==='suppress'?t`Suppressed ${ids.length} bodies: they are left out of the model until unsuppressed.`:t`${ids.length} bodies are back in the model.`;}};
 }
 if(name==='config'){
  const configs=doc.assembly?.configurations??[];
  if(!tokens.length)return {invocation:'config',edits:false,run:s=>{const a=s.state.document.assembly,list=a?.configurations??[];return list.length?list.map(c=>`${c.id===a?.active?'✓':' '} ${c.name}: ${Object.entries(c.parameters).map(([k,v])=>`${k} = ${v}`).join(', ')||t('no parameters')}${c.suppressed.length?t`; ${c.suppressed.length} suppressed`:''}`).join('\n'):t('No configurations. Save one with config save "name".');}};
  const action=lower[0],arg=words[1];
  if(!['save','use','delete'].includes(action)||tokens.length!==2)throw new Error(t('Usage: config [save|use|delete "name"]'));
  if(action==='save')return {invocation:`config save ${quote(arg)}`,edits:true,run:s=>{s.saveConfiguration(arg);return t`Saved the configuration ${arg}: the current parameters and suppressed bodies.`;}};
  const config=configs.find(c=>c.name===arg||c.id===arg);if(!config)throw new Error(t`Unknown configuration: ${arg}`);
  if(action==='use')return {invocation:`config use ${quote(config.name)}`,edits:true,run:s=>{s.useConfiguration(config.id);return t`Switched to the configuration ${config.name}.`;}};
  return {invocation:`config delete ${quote(config.name)}`,edits:true,run:s=>{s.removeConfiguration(config.id);return t`Deleted the configuration ${config.name}.`;}};
 }
 if(name==='explode'){
  const views=doc.assembly?.views??[];
  if(!tokens.length)return {invocation:'explode',edits:false,run:()=>views.length?views.map(v=>`${v.name} (${v.id}): ${v.steps.length} steps`).join('\n'):t('No exploded views. Make one with explode auto.')};
  if(lower[0]==='delete'){
   if(tokens.length!==2)throw new Error(t('Usage: explode delete "view"'));
   const view=views.find(v=>v.id===words[1]||v.name===words[1]);if(!view)throw new Error(t`Unknown exploded view: ${words[1]}`);
   return {invocation:`explode delete ${quote(view.id)}`,edits:true,run:s=>{s.removeExplodedView(view.id);return t`Deleted the exploded view ${view.name}.`;}};
  }
  if(lower[0]!=='auto')throw new Error(t('Usage: explode [auto [axis|radial] [+z|X,Y,Z] [spacing <mm>] [group "name"] [name "view"] | delete "view"]'));
  let mode:'axis'|'radial'='axis',axis:Vec3=[0,0,1],spacing:number|undefined,group:string|undefined,viewName:string|undefined;
  for(let i=1;i<tokens.length;i++){
   const w=lower[i];
   if(w==='axis'||w==='radial')mode=w;
   else if(w==='spacing'){spacing=commandNumber(words[++i]??'');if(!(spacing>0&&spacing<=100000))throw new Error(t('Explode spacing must be between 0 and 100000 mm'));}
   else if(w==='group'){group=groupFrom(doc,words[++i]??'').id;}
   else if(w==='name'){viewName=words[++i];if(!viewName)throw new Error(t('Name the exploded view'));}
   else if(axisWord(w))axis=axisWord(w)!;
   else if(words[i].includes(','))axis=vector(words[i]);
   else throw new Error(t`Unexpected explode argument: ${words[i]}`);
  }
  const invocation=`explode auto ${mode} ${axis.map(num).join(',')}${spacing!==undefined?` spacing ${num(spacing)}`:''}${group?` group ${quote(group)}`:''}${viewName?` name ${quote(viewName)}`:''}`;
  return {invocation,edits:true,async:true,run:async(s,host,signal,record)=>{
   if(!host)throw new Error(t('explode auto needs evaluated bodies; run it in the editor, over MCP or in the CLI.'));
   const before=s.state.revision,bounds=await host.bounds(s.state.document,signal);
   if(s.state.revision!==before)throw new Error(t('The model changed while planning the exploded view. Run explode auto again.'));
   const view=planExplodedView(s.state.document,bounds,{mode,axis,...(spacing!==undefined?{spacing}:{}),...(group?{group}:{}),...(viewName?{name:viewName}:{})},newId);
   (record??((_line,commit)=>commit()))(invocation,()=>s.setExplodedView(view));
   return t`Made the exploded view ${view.name} (${view.id}): ${view.steps.length} steps. Show it with the slider in Assembly › Exploded view.`;
  }};
 }
 if(name==='mechanism'){
  if(!tokens.length)return {invocation:'mechanism',edits:false,run:s=>listJoints(s.state.document)};
  const joint=jointFrom(doc,words[0]);let range:[number,number]|undefined,steps:number|undefined,clearance:number|undefined;
  for(let i=1;i<tokens.length;i++){
   const w=lower[i];
   if(w==='range'){range=[commandNumber(words[i+1]??''),commandNumber(words[i+2]??'')];i+=2;if(!(range[0]<=range[1]))throw new Error(t('Bad sweep range'));}
   else if(w==='steps'){steps=commandNumber(words[++i]??'');if(!Number.isInteger(steps)||steps<1||steps>720)throw new Error(t('Steps must be a whole number from 1 to 720'));}
   else if(w==='clearance'){clearance=commandNumber(words[++i]??'');if(!(clearance>0&&clearance<=100))throw new Error(t('Clearance must be between 0 and 100 mm'));}
   else throw new Error(t('Usage: mechanism [joint] [range <from> <to>] [steps <n>] [clearance <mm>]'));
  }
  const settings:MechanismSettings={joint:joint.id,...(range?{range}:{}),...(steps?{steps}:{}),...(clearance?{clearanceMm:clearance}:{})};
  const invocation=`mechanism ${joint.control?.port??joint.id}${range?` range ${num(range[0])} ${num(range[1])}`:''}${steps?` steps ${steps}`:''}${clearance?` clearance ${num(clearance)}`:''}`;
  return {invocation,edits:false,async:true,run:async(s,host,signal)=>{
   if(!host)throw new Error(t('The mechanism check is not available in this host.'));
   return formatMechanismReport(await host.mechanism(s.state.document,settings,signal));
  }};
 }
 if(name==='planetary'){
  const options:PlanetaryOptions={};const keys:Record<string,keyof PlanetaryOptions>={sun:'sunTeeth',planet:'planetTeeth',planets:'planets',module:'module',width:'width',backlash:'backlash'};
  for(let i=0;i<tokens.length;i+=2){const key=keys[lower[i]];if(!key||words[i+1]===undefined)throw new Error(t('Usage: planetary [sun <teeth>] [planet <teeth>] [planets <n>] [module <mm>] [width <mm>] [backlash <mm>]'));options[key]=commandNumber(words[i+1]);}
  const layout=planetaryLayout(options);
  const invocation=`planetary sun ${layout.sun} planet ${layout.planet} planets ${layout.planets} module ${num(layout.module)} width ${num(layout.width)} backlash ${num(layout.backlash)}`;
  return {invocation,edits:true,run:s=>{s.insert(createPlanetaryDocument(options),[0,0,0],{label:'Insert planetary gear set'});return t`Inserted a planetary gear set: sun ${layout.sun}, ${layout.planets} planets of ${layout.planet}, ring ${layout.ring} teeth, module ${num(layout.module)} mm. With the carrier held, the ring turns at ${num(layout.ratio)} × the sun (motor A).`;}};
 }
 throw new Error(t('Unknown editor command'));
}
