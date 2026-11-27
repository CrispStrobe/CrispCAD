// SPDX-License-Identifier: BSD-3-Clause
// Terminal/registry commands for hole-driven fastening (Phase 6.2): `hole`, `fasten`, `part` and
// the read-only `fasteners`. Shared by the terminal, the command palette, MCP and the CLI.
import {t} from './i18n.js';
import type {CadDocument,SolidNode,Vec3} from './document.js';
import type {CadSession} from './session.js';
import {commandNumber,commandTokens,parseCommandPoint} from './command-arguments.js';
import {CLEARANCE_FITS,COUNTERBORE_4762,HEAT_SET_INSERTS,HOLE_TYPES,ISO_10642,ISO_4017,ISO_4032,ISO_4762,ISO_7089,ISO_7380,METRIC_THREADS,PART_FAMILIES,PART_STANDARDS,STOCK_LENGTHS,THREADS,describeHole,familyThreads,frameFromAxis,nodeWorldFrame,partFamily,placeInFrame,planFastening,standardHole,standardPart,standardPartFragment} from './fasteners.js';
import type {ClearanceFit,FastenMode,FasteningPlan,GeneratedBuilder,HoleFeature,HoleType,MetricThread,PartDetail,ScrewFamily} from './fasteners.js';

export interface FasteningCommandOptions {
 /** Builds threaded screws (the editor's createPresetDocument); without it screws are envelopes. */
 generated?:GeneratedBuilder;
}
export interface PreparedFastening {invocation:string;run():string}

const quote=(value:string)=>/^[A-Za-z0-9_.-]+$/.test(value)?value:'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
const fmt=(v:number)=>String(Number(v.toFixed(6)));
const vec=(v:readonly number[])=>v.map(fmt).join(',');
const thread=(word:string):MetricThread|undefined=>METRIC_THREADS.find(m=>m.toLowerCase()===word.toLowerCase());
function direction(text:string):Vec3{
 const parts=text.split(',');if(parts.length!==3)throw new Error(t('Enter three values as X,Y,Z.'));
 const v=parts.map(commandNumber) as Vec3;if(!(Math.hypot(...v)>1e-9))throw new Error(t('The hole axis must be a non-zero direction.'));
 return v;
}
function topLevelBody(doc:CadDocument,token:string):string{
 if(doc.roots.includes(token))return token;
 const matches=doc.roots.filter(id=>doc.nodes[id].name===token);
 if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${token}`);
 return matches[0];
}
const holeNodes=(doc:CadDocument)=>Object.values(doc.nodes).filter((n):n is SolidNode&HoleFeature=>n.kind==='hole');
/** Hole nodes below a node (itself included). */
function holesIn(doc:CadDocument,id:string,out=new Set<string>()):Set<string>{
 const node=doc.nodes[id];if(!node)return out;
 if(node.kind==='hole')out.add(id);
 if(node.kind==='boolean')node.inputs.forEach(input=>holesIn(doc,input,out));
 return out;
}

/** `hole <type> <thread> [close|normal|loose] [<depth>|through <thickness>] [at x,y,z] [axis x,y,z] [in body]` */
export function parseHoleCommand(session:CadSession,tail:string):PreparedFastening{
 const words=commandTokens(tail).map(token=>token.value),usage=t('Usage: hole <clearance|tapped|counterbore|countersink|heat-set> <M2…M20> [close|normal|loose] [<depth>|through <thickness>] [at X,Y,Z] [axis X,Y,Z] [in body].');
 if(words.length<2)throw new Error(usage);
 const type=words[0].toLowerCase() as HoleType;
 if(!(HOLE_TYPES as readonly string[]).includes(type))throw new Error(t`Unknown hole type ${words[0]}; choose clearance, tapped, counterbore, countersink or heat-set.`);
 const m=thread(words[1]);if(!m)throw new Error(t`Unknown thread ${words[1]}; stocked threads: ${METRIC_THREADS.join(', ')}.`);
 let fit:ClearanceFit|undefined,depth:number|undefined,through=false,at:Vec3=[0,0,0],axis:Vec3=[0,0,-1],target:string|undefined;
 for(let i=2;i<words.length;i++){
  const word=words[i].toLowerCase(),next=()=>{if(i+1>=words.length)throw new Error(usage);return words[++i];};
  if((CLEARANCE_FITS as readonly string[]).includes(word))fit=word as ClearanceFit;
  else if(word==='through'){through=true;depth=commandNumber(next());}
  else if(word==='depth')depth=commandNumber(next());
  else if(word==='at')at=parseCommandPoint(next());
  else if(word==='axis')axis=direction(next());
  else if(word==='in')target=topLevelBody(session.state.document,next());
  else if(depth===undefined&&/^[\d.]/.test(word))depth=commandNumber(word);
  else throw new Error(usage);
 }
 if(fit&&!['clearance','counterbore','countersink'].includes(type))throw new Error(t('Only clearance, counterbored and countersunk holes have a fit class.'));
 const hole=standardHole({type,thread:m,fit,depth,through});
 const invocation=['hole',type,m,...(hole.standard.fit?[hole.standard.fit]:[]),...(through?['through',fmt(hole.depth)]:[fmt(hole.depth)]),'at',vec(at),'axis',vec(axis),...(target?['in',quote(target)]:[])].join(' ');
 return {invocation,run(){
  const [id]=session.addStandardHoles([{hole,transform:placeInFrame(frameFromAxis(at,axis),0)}],target);
  return `${session.state.document.nodes[id].name}: ${describeHole(hole)}.`;
 }};
}

/** `part <family> <thread> [length] [at x,y,z] [axis x,y,z] [envelope|threaded]` */
export function parsePartCommand(session:CadSession,tail:string,options:FasteningCommandOptions={}):PreparedFastening{
 const words=commandTokens(tail).map(token=>token.value),usage=t('Usage: part <family> <M2…M20> [length] [at X,Y,Z] [axis X,Y,Z] [envelope|threaded]. Families: socket-head, button-head, countersunk, hex-bolt, set-screw, hex-nut, washer, heat-set-insert.');
 if(words.length<2)throw new Error(usage);
 const family=partFamily(words[0]);if(!family)throw new Error(t`Unknown part family ${words[0]}; families: ${PART_FAMILIES.join(', ')}.`);
 const m=thread(words[1]);if(!m)throw new Error(t`Unknown thread ${words[1]}; stocked threads: ${METRIC_THREADS.join(', ')}.`);
 let length:number|undefined,at:Vec3=[0,0,0],axis:Vec3=[0,0,-1],detail:PartDetail='threaded';
 for(let i=2;i<words.length;i++){
  const word=words[i].toLowerCase(),next=()=>{if(i+1>=words.length)throw new Error(usage);return words[++i];};
  if(word==='at')at=parseCommandPoint(next());else if(word==='axis')axis=direction(next());
  else if(word==='envelope'||word==='threaded')detail=word;
  else if(word==='length')length=commandNumber(next());
  else if(length===undefined&&/^[\d.]/.test(word))length=commandNumber(word);else throw new Error(usage);
 }
 const part=standardPart(family,m,length);
 const invocation=['part',family,m,...(part.length!==undefined?[fmt(part.length)]:[]),'at',vec(at),'axis',vec(axis),...(detail==='envelope'?['envelope']:[])].join(' ');
 return {invocation,run(){
  const {fragment,threaded}=standardPartFragment(part,{detail,generated:options.generated});
  session.insertPlaced([{fragment,transform:placeInFrame(frameFromAxis(at,axis),0)}],'Insert standard part');
  return part.designation+(['socket-head','button-head','countersunk','hex-bolt','set-screw'].includes(family)?threaded?t(' (threaded)'):t(' (envelope, no thread)'):'');
 }};
}

/** The plans `fasten` would carry out (also used by the editor's Fasten dialog). */
export function planFastenings(doc:CadDocument,holeIds:readonly string[],request:{family?:ScrewFamily|'heat-set-insert';mode?:FastenMode;length?:number}={}):FasteningPlan[]{
 if(!holeIds.length)throw new Error(t('The model has no standard holes to fasten. Add one with hole.'));
 return holeIds.map(id=>planFastening(id,doc.nodes[id] as SolidNode&HoleFeature,request));
}
/** Insert the parts of fastening plans in one Undo step; returns the terminal output. */
export function applyFastenings(session:CadSession,plans:readonly FasteningPlan[],options:FasteningCommandOptions&{detail?:PartDetail}={}):string{
 const doc=session.state.document,entries=[],lines:string[]=[];let envelopes=0;
 for(const plan of plans){
  const frame=nodeWorldFrame(doc,plan.holeId);
  for(const placed of plan.parts){
   const {fragment,threaded}=standardPartFragment(placed.part,{detail:options.detail,generated:options.generated});
   if(placed.role==='screw'&&!threaded)envelopes++;
   entries.push({fragment,transform:placeInFrame(frame,placed.z)});
  }
  lines.push(`${doc.nodes[plan.holeId].name}: ${plan.parts.map(p=>p.part.designation).join(' + ')}`+(plan.protrusion!==undefined?t` (bolt, ${fmt(plan.protrusion)} mm past the nut)`:''));
 }
 session.insertPlaced(entries,'Fasten holes');
 if(envelopes)lines.push(t`${envelopes} screws are envelopes without a modelled thread (envelope detail, or outside the thread generator's range).`);
 return lines.join('\n');
}

/** `fasten [hole|body|M3 ...] [family] [screw|bolt] [length <l>] [envelope|threaded]` */
export function parseFastenCommand(session:CadSession,tail:string,options:FasteningCommandOptions={}):PreparedFastening{
 const doc=session.state.document,tokens=commandTokens(tail),usage=t('Usage: fasten [hole|body|M3 ...] [socket-head|button-head|countersunk|hex-bolt|heat-set-insert] [screw|bolt] [length <mm>] [envelope|threaded].');
 const targets=new Set<string>(),words:string[]=[];
 let family:ScrewFamily|'heat-set-insert'|undefined,mode:FastenMode|undefined,length:number|undefined,detail:PartDetail='threaded';
 for(let i=0;i<tokens.length;i++){
  const {value,quoted}=tokens[i],word=value.toLowerCase(),f=quoted?undefined:partFamily(word);
  if(f&&f!=='hex-nut'&&f!=='washer'){family=f as ScrewFamily|'heat-set-insert';words.push(f);continue;}
  if(!quoted&&(word==='screw'||word==='bolt')){mode=word;words.push(word);continue;}
  if(!quoted&&(word==='envelope'||word==='threaded')){detail=word;continue;}
  if(!quoted&&word==='length'){if(i+1>=tokens.length)throw new Error(usage);length=commandNumber(tokens[++i].value);words.push('length',fmt(length));continue;}
  const m=quoted?undefined:thread(word);
  if(m){const matching=holeNodes(doc).filter(h=>h.standard.thread===m);if(!matching.length)throw new Error(t`The model has no ${m} standard holes.`);matching.forEach(h=>targets.add(h.id));continue;}
  if(doc.nodes[value]?.kind==='hole'){targets.add(value);continue;}
  const named=holeNodes(doc).filter(h=>h.name===value);
  if(named.length===1){targets.add(named[0].id);continue;}
  const body=topLevelBody(doc,value),inside=holesIn(doc,body);
  if(!inside.size)throw new Error(t`${doc.nodes[body].name} has no standard holes.`);
  inside.forEach(id=>targets.add(id));
 }
 const ids=targets.size?[...targets]:holeNodes(doc).map(h=>h.id);
 const plans=planFastenings(doc,ids,{family,mode,length});
 const invocation=['fasten',...ids.map(quote),...words,...(detail==='envelope'?['envelope']:[])].join(' ');
 return {invocation,run:()=>applyFastenings(session,plans,{...options,detail})};
}

/** `fasteners [M3]`: the ISO table rows the library uses (read-only). */
export function fastenerTable(tail:string):string{
 const words=commandTokens(tail).map(token=>token.value);
 if(words.length>1)throw new Error(t('Usage: fasteners [M2…M20].'));
 const threads=words.length?[thread(words[0])]:[...METRIC_THREADS];
 if(threads.some(m=>!m))throw new Error(t`Unknown thread ${words[0]}; stocked threads: ${METRIC_THREADS.join(', ')}.`);
 return (threads as MetricThread[]).map(m=>{
  const r=THREADS[m],lines=[`${m}×${r.pitch} — ${t('ISO 273 clearance')} ${r.clearance.close}/${r.clearance.normal}/${r.clearance.loose} (${t('close/normal/loose')}), ${t('tap drill')} ${r.tapDrill}, ${t('counterbore')} Ø${COUNTERBORE_4762[m].diameter}×${COUNTERBORE_4762[m].depth}`];
  const h=ISO_4762[m],b=ISO_7380[m],c=ISO_10642[m],x=ISO_4017[m],nut=ISO_4032[m],w=ISO_7089[m],ins=HEAT_SET_INSERTS[m];
  if(h)lines.push(`  ISO 4762: dk ${h.dk}, k ${h.k}, s ${h.s}; ${t('lengths')} ${STOCK_LENGTHS['socket-head'][m]!.join(', ')}`);
  if(b)lines.push(`  ISO 7380-1: dk ${b.dk}, k ${b.k}, s ${b.s}`);
  if(c)lines.push(`  ISO 10642: dk ${c.dk}, k ${c.k}, s ${c.s}, 90°`);
  if(x)lines.push(`  ISO 4017: s ${x.s}, k ${x.k}`);
  lines.push(`  ISO 4032: s ${nut.s}, m ${nut.m}; ISO 7089: d1 ${w.d1}, d2 ${w.d2}, h ${w.h}`);
  if(ins)lines.push(`  ${t('Heat-set insert')}: ${t('pocket')} Ø${ins.pocket}, ${t('outer')} Ø${ins.outer}, ${t('length')} ${ins.length}`);
  return lines.join('\n');
 }).join('\n')+'\n'+t('Families')+': '+PART_FAMILIES.map(f=>`${f} (${PART_STANDARDS[f]}: ${familyThreads(f).join(' ')})`).join('; ');
}
