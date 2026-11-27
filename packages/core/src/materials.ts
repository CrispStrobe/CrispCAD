// SPDX-License-Identifier: BSD-3-Clause
/**
 * Multi-material inspection (Phase 6.5 of docs/CRISPCAD-CONVERGENCE.md): a read-only report of
 * the material and colour of every printable body, with volume and mass per body, per material
 * and per colour (filament per colour for a multi-colour print), and the places where materials
 * meet in a way a printer or slicer cannot honour:
 *
 * - **fused**: a union or other Boolean whose operands carry different materials or colours. The
 *   result is one body with one material and colour; the operands' own are lost. Keep them as
 *   separate bodies to print them in different materials (the lab guide
 *   `multi-material-inspection` describes the same diagnostic; this is original code).
 * - **overlap**: two bodies of different materials or colours sharing volume. A slicer gives the
 *   shared volume to one of them, so the print differs from the model.
 *
 * Core holds the plain data, the report builder, the command parser and the text formatter. A
 * host supplies each body's volume (the Manifold mesh, or the exact kernel's B-rep when asked)
 * and the overlaps it measured. Nothing here touches the model: no history entry, no document
 * version.
 */
import type {CadDocument,SolidNode} from './document.js';
import {constructionInputs} from './document.js';
import type {CadSession} from './session.js';
import {commandTokens} from './command-arguments.js';
import {physicsMaterials} from './simulation.js';
import {defaultPartPhysics} from './physics.js';
import {t} from './i18n.js';

export const MATERIALS_REPORT_VERSION=1;
/** Filament diameter used for the per-colour filament length (mm). */
export const FILAMENT_DIAMETER_MM=1.75;
/** A body's volume as a host measured it. */
export interface MaterialVolume {
 readonly id:string;
 readonly volumeMm3:number;
 readonly geometry:'exact'|'mesh';
 /** Why the exact volume was not used, when it was asked for. */
 readonly reason?:string;
}
/** Two bodies of different material or colour sharing volume (measured by the host). */
export interface MaterialOverlap {readonly a:string;readonly b:string;readonly volumeMm3:number}
export interface MaterialsBodyReport {
 readonly id:string;readonly name:string;readonly color:string;
 /** The material preset id, `custom`, or `unassigned` (the default density, no material chosen). */
 readonly material:string;
 readonly materialName:string;
 readonly densityKgM3:number;
 readonly volumeMm3:number;
 readonly massG:number;
 readonly geometry:'exact'|'mesh';
 readonly reason?:string;
}
export interface MaterialsGroup {
 /** Material id, or `#rrggbb` for a colour group. */
 readonly key:string;
 readonly name:string;
 readonly bodies:readonly string[];
 readonly volumeMm3:number;
 readonly massG:number;
 /** Colour groups: filament of FILAMENT_DIAMETER_MM for the volume (m). */
 readonly filamentM?:number;
}
export interface MaterialsFinding {
 readonly kind:'fused'|'overlap';
 readonly text:string;
 /** The top-level body the finding is about (for a fused Boolean, the body it is in). */
 readonly bodies:readonly string[];
 /** Fused: the Boolean node and its operands with their own materials and colours. */
 readonly node?:string;
 readonly operands?:readonly {readonly id:string;readonly name:string;readonly material:string;readonly color:string}[];
 readonly volumeMm3?:number;
}
export interface MaterialsReport {
 readonly version:number;
 readonly bodies:readonly MaterialsBodyReport[];
 readonly byMaterial:readonly MaterialsGroup[];
 readonly byColor:readonly MaterialsGroup[];
 readonly findings:readonly MaterialsFinding[];
 readonly totalVolumeMm3:number;
 readonly totalMassG:number;
 /** Whether overlaps between bodies were measured. */
 readonly overlapsChecked:boolean;
 readonly kernel?:string;
 readonly disclaimer:string;
}
/** What a host is asked for: the bodies (empty: every printable one), exact volumes or not. */
export interface MaterialsRequest {readonly bodies:readonly string[];readonly exact:boolean}
/** Runs the inspection: meshes (and the exact kernel when asked) on the host's side. */
export interface MaterialsHost {inspect(document:CadDocument,request:MaterialsRequest,signal?:AbortSignal):Promise<MaterialsReport>}

const presetName=(id:string)=>{const preset=physicsMaterials.find(m=>m.id===id);return preset?t(preset.name):id==='custom'?t('Custom material'):t('No material set');};
/** A body's material, density and the name shown for it. */
export function bodyMaterial(node:SolidNode):{material:string;materialName:string;densityKgM3:number}{
 const p=node.physics,material=p?.material??'unassigned',density=p?.densityKgM3??defaultPartPhysics().densityKgM3;
 return {material,materialName:presetName(material),densityKgM3:density};
}
/** Printable top-level bodies: not reference helpers, not hole cutters. */
export const printableBodies=(doc:CadDocument)=>doc.roots.filter(id=>!doc.nodes[id].reference&&doc.nodes[id].role!=='hole');
const signature=(node:SolidNode)=>{const m=bodyMaterial(node);return `${m.material}|${m.densityKgM3}|${node.color.toLowerCase()}`;};

/** Booleans inside `root` whose operands differ in material or colour from the result. */
function fusedFindings(doc:CadDocument,root:string):MaterialsFinding[]{
 const findings:MaterialsFinding[]=[],seen=new Set<string>();
 const visit=(id:string)=>{
  if(seen.has(id))return;seen.add(id);
  const node=doc.nodes[id];if(!node)return;
  constructionInputs(node).forEach(visit);
  if(node.kind!=='boolean')return;
  // Hole cutters remove material: their colour and material never reach the print.
  const operands=node.inputs.map(input=>doc.nodes[input]).filter(n=>n&&!n.reference&&n.role!=='hole'&&!(node.operation==='subtract'&&n.id!==node.inputs[0]));
  // Fused: operands that differ among themselves, or an operand whose own chosen material is not
  // the result's. A colour the result was given later is not a finding.
  const result=doc.nodes[root],material=(n:SolidNode)=>{const m=bodyMaterial(n);return `${m.material}|${m.densityKgM3}`;};
  if(operands.length<2&&!operands.some(n=>n.physics?.material&&material(n)!==material(result)))return;
  if(new Set(operands.map(signature)).size<2&&!operands.some(n=>n.physics?.material&&material(n)!==material(result)))return;
  const describe=(n:SolidNode)=>{const m=bodyMaterial(n);return {id:n.id,name:n.name,material:m.material,color:n.color};};
  const list=operands.map(n=>`${n.name} (${bodyMaterial(n).materialName}, ${n.color})`).join(', ');
  findings.push({kind:'fused',node:id,bodies:[root],operands:operands.map(describe),
   text:t`${result.name} fuses ${list} into one body of ${bodyMaterial(result).materialName} (${result.color}); keep them as separate bodies to print them in their own materials or colours.`});
 };
 visit(root);
 return findings;
}

/** The report from the bodies' volumes and the overlaps the host measured (undefined: not checked). */
export function inspectMaterials(doc:CadDocument,volumes:readonly MaterialVolume[],options:{bodies?:readonly string[];overlaps?:readonly MaterialOverlap[];kernel?:string}={}):MaterialsReport{
 const wanted=options.bodies?.length?options.bodies:printableBodies(doc);
 for(const id of wanted)if(!doc.roots.includes(id))throw new RangeError(t`Unknown object id: ${id}`);
 const byId=new Map(volumes.map(v=>[v.id,v]));
 const bodies=wanted.filter(id=>!doc.nodes[id].reference&&doc.nodes[id].role!=='hole').map((id):MaterialsBodyReport=>{
  const node=doc.nodes[id],m=bodyMaterial(node),v=byId.get(id);
  if(!v)throw new RangeError(t`No volume was measured for ${node.name}.`);
  return {id,name:node.name,color:node.color.toLowerCase(),...m,volumeMm3:v.volumeMm3,massG:m.densityKgM3*v.volumeMm3*1e-6,geometry:v.geometry,...(v.reason?{reason:v.reason}:{})};
 });
 const group=(key:(b:MaterialsBodyReport)=>string,name:(b:MaterialsBodyReport)=>string,filament:boolean):MaterialsGroup[]=>{
  const groups=new Map<string,{name:string;bodies:string[];volumeMm3:number;massG:number}>();
  for(const b of bodies){const k=key(b),g=groups.get(k)??{name:name(b),bodies:[],volumeMm3:0,massG:0};g.bodies.push(b.id);g.volumeMm3+=b.volumeMm3;g.massG+=b.massG;groups.set(k,g);}
  return [...groups].map(([k,g])=>({key:k,...g,...(filament?{filamentM:g.volumeMm3/(Math.PI*(FILAMENT_DIAMETER_MM/2)**2)/1000}:{})})).sort((a,b)=>b.massG-a.massG);
 };
 const byMaterial=group(b=>b.material==='unassigned'||b.material==='custom'?`${b.material}@${b.densityKgM3}`:b.material,b=>b.material==='custom'||b.material==='unassigned'?`${b.materialName} (${b.densityKgM3} kg/m³)`:b.materialName,false);
 const byColor=group(b=>b.color,b=>b.color,true);
 const inReport=new Set(bodies.map(b=>b.id));
 const findings:MaterialsFinding[]=[...bodies.flatMap(b=>fusedFindings(doc,b.id))];
 for(const o of options.overlaps??[]){
  if(!inReport.has(o.a)||!inReport.has(o.b))continue;
  const a=doc.nodes[o.a],b=doc.nodes[o.b];
  if(signature(a)===signature(b))continue;
  findings.push({kind:'overlap',bodies:[o.a,o.b],volumeMm3:o.volumeMm3,text:t`${a.name} (${bodyMaterial(a).materialName}, ${a.color}) and ${b.name} (${bodyMaterial(b).materialName}, ${b.color}) share ${fmt(o.volumeMm3)} mm³; a slicer gives that volume to one of them.`});
 }
 return {version:MATERIALS_REPORT_VERSION,bodies,byMaterial,byColor,findings,
  totalVolumeMm3:bodies.reduce((s,b)=>s+b.volumeMm3,0),totalMassG:bodies.reduce((s,b)=>s+b.massG,0),
  overlapsChecked:options.overlaps!==undefined,...(options.kernel&&bodies.some(b=>b.geometry==='exact')?{kernel:options.kernel}:{}),
  disclaimer:t('Masses use each body’s density (a body without a material uses the default 1050 kg/m³); they are estimates for planning a print, not weighed values. Infill and supports are not included.')};
}

const fmt=(value:number,digits=3)=>Number(value.toFixed(digits)).toLocaleString(undefined,{maximumFractionDigits:digits});
const quote=(value:string)=>/^[A-Za-z0-9_-]+$/.test(value)?value:'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
const usage=()=>t('Usage: materials [all|"name"|id ...] [--exact].');
/** `materials [all|"name"|id ...] [--exact]`: the bodies (empty: every printable one) and the canonical invocation. */
export function parseMaterialsCommand(session:CadSession,tail:string):{bodies:string[];exact:boolean;invocation:string}{
 const tokens=commandTokens(tail),doc=session.state.document;let exact=false;const targets:{value:string;quoted:boolean}[]=[];
 for(const token of tokens){
  if(!token.quoted&&token.value.toLowerCase()==='--exact')exact=true;
  else if(!token.quoted&&token.value.startsWith('--'))throw new Error(usage());
  else targets.push(token);
 }
 let bodies:string[];
 if(!targets.length||targets.length===1&&!targets[0].quoted&&targets[0].value.toLowerCase()==='all')bodies=[];
 else bodies=[...new Set(targets.map(({value})=>{
  if(doc.roots.includes(value))return value;
  const matches=doc.roots.filter(id=>doc.nodes[id].name===value);
  if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${value}`);
  return matches[0];
 }))];
 if(bodies.some(id=>doc.nodes[id].reference||doc.nodes[id].role==='hole'))throw new Error(t('Reference helpers and hole cutters have no material to report.'));
 if(!printableBodies(doc).length)throw new Error(t('The design has no solid bodies to export'));
 return {bodies,exact,invocation:`materials ${bodies.length?bodies.map(quote).join(' '):'all'}${exact?' --exact':''}`};
}
/** The report as text for the terminal and the CLI. */
export function formatMaterialsReport(report:MaterialsReport):string{
 const lines=[t`Materials: ${report.bodies.length} bodies, ${fmt(report.totalVolumeMm3)} mm³, ${fmt(report.totalMassG,2)} g`];
 for(const b of report.bodies)lines.push(`  ${b.name}: ${b.materialName} · ${b.color} · ${fmt(b.volumeMm3)} mm³ · ${fmt(b.massG,2)} g (${b.geometry==='exact'?t('exact'):t('mesh')}${b.reason?'; '+b.reason:''})`);
 lines.push(t('By material:'));
 for(const g of report.byMaterial)lines.push(`  ${g.name}: ${g.bodies.length} · ${fmt(g.volumeMm3)} mm³ · ${fmt(g.massG,2)} g`);
 lines.push(t`By colour (filament ${FILAMENT_DIAMETER_MM} mm):`);
 for(const g of report.byColor)lines.push(`  ${g.name}: ${g.bodies.length} · ${fmt(g.volumeMm3)} mm³ · ${fmt(g.massG,2)} g · ${fmt(g.filamentM??0,2)} m`);
 if(report.findings.length){lines.push(t`Findings (${report.findings.length}):`);for(const f of report.findings)lines.push('  '+f.text);}
 else lines.push(report.overlapsChecked?t('No fused or overlapping materials.'):t('No fused materials (overlaps not checked).'));
 return lines.join('\n');
}
