// SPDX-License-Identifier: BSD-3-Clause
/**
 * "Check for manufacturing" (Phase 6.3): a read-only report of one body or several against the
 * rules of a process (FDM printing, 3-axis CNC milling, laser-cut sheet, injection moulding), with edge-radius rules
 * on top. Where a body has an exact B-rep, its checks are measured on that (face kinds and radii,
 * edge curves, exact wall distances); otherwise, and for the orientation-dependent FDM checks, on
 * the display mesh. Every check says which it used.
 *
 * Core holds the plain data, settings, the `check` command's parser and the text formatter; the
 * analysis is @brickwright/cad-geometry's (`checkManufacturing`), run by a host that can evaluate
 * meshes and, when asked, fetch the exact kernel's data. Nothing here touches the model: no
 * history entry, no document version.
 */
import type {CadDocument} from './document.js';
import type {CadSession} from './session.js';
import {commandNumber,commandTokens} from './command-arguments.js';
import {t} from './i18n.js';

export const MANUFACTURING_CHECK_VERSION=1;
export type ManufacturingProcess='fdm'|'cnc'|'laser'|'molding';
export const MANUFACTURING_PROCESSES:readonly ManufacturingProcess[]=Object.freeze(['fdm','cnc','laser','molding']);
/** Which sharp edges the edge-radius check refuses: none, convex (external), concave (internal) or both. */
export type EdgeBreakRule='none'|'external'|'internal'|'all';
export type ApproachAxis='+x'|'-x'|'+y'|'-y'|'+z'|'-z';
export const APPROACH_AXES:readonly ApproachAxis[]=Object.freeze(['+x','-x','+y','-y','+z','-z']);

export interface ManufacturingSettings {
 readonly process:ManufacturingProcess;
 /** Measure on the exact B-rep where a body has one (loads the exact kernel). */
 readonly exact:boolean;
 /** Minimum wall (mm). FDM default 2 × nozzle; CNC 0.8; laser: the sheet thickness (minimum web). */
 readonly minWallMm?:number;
 /** FDM. */
 readonly nozzleMm:number;
 readonly minHoleMm:number;
 readonly maxOverhangDeg:number;
 readonly maxBridgeMm:number;
 readonly bedSizeMm:{readonly x:number;readonly y:number;readonly z:number};
 /** CNC: end-mill diameter (mm), tool approach directions (setups) and the undercut area tolerated. */
 readonly toolDiameterMm:number;
 readonly approachAxes:readonly ApproachAxis[];
 readonly maxUndercutAreaMm2:number;
 /** CNC: a pocket deeper than this many tool diameters fails (a standard end mill reaches about 4 ×). */
 readonly maxPocketDepthRatio:number;
 /** CNC: list a suggested dogbone (centre and circle) for each internal corner that needs one. */
 readonly dogbones:boolean;
 /**
  * Injection moulding: the direction the mould opens (the two halves part along it), the minimum
  * draft of faces along it (degrees), the thickest wall (mm) and how far the wall may vary around
  * its nominal (median) thickness, as a fraction (0.4: from 0.6 × to 1.4 × nominal).
  */
 readonly pullAxis:ApproachAxis;
 readonly minDraftDeg:number;
 readonly maxWallMm?:number;
 readonly wallVariation:number;
 /** Edge radius: fillet radius bounds (mm) and which sharp edges are refused. */
 readonly minRadiusMm?:number;
 readonly maxRadiusMm?:number;
 readonly edgeBreak:EdgeBreakRule;
}

export const DEFAULT_MANUFACTURING_SETTINGS:Readonly<ManufacturingSettings>=Object.freeze({
 process:'cnc',exact:true,nozzleMm:.4,minHoleMm:2,maxOverhangDeg:45,maxBridgeMm:10,bedSizeMm:Object.freeze({x:220,y:220,z:250}),
 toolDiameterMm:6,approachAxes:Object.freeze(['+z']) as readonly ApproachAxis[],maxUndercutAreaMm2:1,maxPocketDepthRatio:4,dogbones:false,
 pullAxis:'+z',minDraftDeg:1,wallVariation:.4,edgeBreak:'none',
});

const positive=(value:unknown,max=1e5)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=max;
/** Settings with defaults filled in; throws a RangeError naming the first invalid value. */
export function resolveManufacturingSettings(input:Partial<ManufacturingSettings>={}):ManufacturingSettings{
 const d=DEFAULT_MANUFACTURING_SETTINGS;
 const s={...d,...Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined)),bedSizeMm:{...d.bedSizeMm,...input.bedSizeMm}} as ManufacturingSettings;
 if(!MANUFACTURING_PROCESSES.includes(s.process))throw new RangeError(t('Choose the process fdm, cnc, laser or molding.'));
 for(const [key,value] of [['nozzleMm',s.nozzleMm],['minHoleMm',s.minHoleMm],['maxBridgeMm',s.maxBridgeMm],['toolDiameterMm',s.toolDiameterMm],['bedSizeMm.x',s.bedSizeMm.x],['bedSizeMm.y',s.bedSizeMm.y],['bedSizeMm.z',s.bedSizeMm.z]] as const)
  if(!positive(value))throw new RangeError(t`${key} must be a positive number of millimetres.`);
 for(const [key,value] of [['minWallMm',s.minWallMm],['maxWallMm',s.maxWallMm],['minRadiusMm',s.minRadiusMm],['maxRadiusMm',s.maxRadiusMm]] as const)
  if(value!==undefined&&!positive(value))throw new RangeError(t`${key} must be a positive number of millimetres.`);
 if(!(typeof s.maxUndercutAreaMm2==='number'&&s.maxUndercutAreaMm2>=0&&Number.isFinite(s.maxUndercutAreaMm2)))throw new RangeError(t('The tolerated undercut area must be zero or more square millimetres.'));
 if(!(s.maxOverhangDeg>0&&s.maxOverhangDeg<90))throw new RangeError(t('The overhang angle must be between 0 and 90 degrees.'));
 if(!positive(s.maxPocketDepthRatio,1000))throw new RangeError(t('The pocket depth ratio must be a positive number of tool diameters.'));
 if(!(typeof s.minDraftDeg==='number'&&s.minDraftDeg>=0&&s.minDraftDeg<45))throw new RangeError(t('The draft angle must be from 0 to 45 degrees.'));
 if(!(typeof s.wallVariation==='number'&&s.wallVariation>0&&s.wallVariation<1))throw new RangeError(t('The wall variation must be a fraction between 0 and 1.'));
 if(!APPROACH_AXES.includes(s.pullAxis))throw new RangeError(t('The pull direction is +x, -x, +y, -y, +z or -z.'));
 if(s.minWallMm!==undefined&&s.maxWallMm!==undefined&&s.minWallMm>s.maxWallMm)throw new RangeError(t('The minimum wall is thicker than the maximum wall.'));
 if(s.minRadiusMm!==undefined&&s.maxRadiusMm!==undefined&&s.minRadiusMm>s.maxRadiusMm)throw new RangeError(t('The minimum radius is larger than the maximum radius.'));
 if(!['none','external','internal','all'].includes(s.edgeBreak))throw new RangeError(t('Edge breaks are none, external, internal or all.'));
 const axes=[...new Set(s.approachAxes)];
 if(!axes.length||axes.some(axis=>!APPROACH_AXES.includes(axis)))throw new RangeError(t('Tool approach axes are +x, -x, +y, -y, +z or -z.'));
 return Object.freeze({...s,exact:s.exact!==false,dogbones:s.dogbones===true,approachAxes:Object.freeze(axes),bedSizeMm:Object.freeze({...s.bedSizeMm})});
}

/** What to draw over the model for a finding (world millimetres): polylines, triangles, points. */
export interface ManufacturingMark {
 /** Each polyline flat x,y,z. */
 readonly lines:readonly (readonly number[])[];
 /** Flat x,y,z, three points per triangle. */
 readonly triangles:readonly number[];
 /** Flat x,y,z. */
 readonly points:readonly number[];
}
export interface ManufacturingFinding {
 readonly text:string;
 /** The measured value (mm, mm² or degrees, as the check's unit), when there is one. */
 readonly value?:number;
 readonly location:readonly [number,number,number];
 /** B-rep face and edge indices (into the kernel's `topology(solid)`), on exact geometry. */
 readonly faces?:readonly number[];
 readonly edges?:readonly number[];
 readonly mark:ManufacturingMark;
}
export type ManufacturingStatus='pass'|'warn'|'fail'|'info'|'not-checked';
export type ManufacturingGeometry='exact'|'mesh';
export interface ManufacturingCheck {
 /** Stable id, e.g. `cnc.internal-corners`, `edges.radius`, `fdm.min-wall`. */
 readonly id:string;
 readonly label:string;
 readonly status:ManufacturingStatus;
 readonly summary:string;
 /** Measured on the exact B-rep or on the mesh. */
 readonly geometry:ManufacturingGeometry;
 readonly value?:number;
 readonly limit?:number;
 readonly unit?:'mm'|'mm2'|'deg';
 readonly findings:readonly ManufacturingFinding[];
 /** Findings beyond those listed. */
 readonly more:number;
}
export interface ManufacturingBodyReport {
 readonly id:string;readonly name:string;
 /** Exact where the body's exact B-rep was measured; mesh otherwise (`reason` says why). */
 readonly geometry:ManufacturingGeometry;
 readonly reason?:string;
 readonly checks:readonly ManufacturingCheck[];
}
export interface ManufacturingReport {
 readonly version:typeof MANUFACTURING_CHECK_VERSION;
 readonly process:ManufacturingProcess;
 readonly settings:ManufacturingSettings;
 readonly bodies:readonly ManufacturingBodyReport[];
 /** The exact kernel that measured the exact checks, as `id · package version`. */
 readonly kernel?:string;
 readonly disclaimer:string;
}
/** A host that runs the check: the editor (its workers), the MCP host and the CLI. */
export interface ManufacturingHost {
 check(document:CadDocument,request:{readonly bodies:readonly string[];readonly settings:ManufacturingSettings},signal?:AbortSignal):Promise<ManufacturingReport>;
}

export const processLabel=(process:ManufacturingProcess)=>process==='fdm'?t('FDM printing'):process==='cnc'?t('CNC milling (3-axis)'):process==='molding'?t('Injection moulding'):t('Laser-cut sheet');

const quote=(value:string)=>/^[A-Za-z0-9_-]+$/.test(value)?value:'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
const formatNumber=(value:number)=>String(Number(value.toPrecision(12))+0);
const usage=()=>t('Usage: check fdm|cnc|laser|molding [all|"name"|id ...] [--tool <mm>] [--axes +z,+x] [--depth-ratio <n>] [--dogbones] [--pull +z] [--draft <deg>] [--min-wall <mm>] [--max-wall <mm>] [--variation <fraction>] [--nozzle <mm>] [--min-hole <mm>] [--min-radius <mm>] [--max-radius <mm>] [--edge-break none|external|internal|all] [--mesh].');

/**
 * `check <process> [targets] [options]`: the bodies (IDs or exact names, `all`, or without
 * targets the selected top-level bodies, else every body) and the settings. The invocation is
 * canonical: process, targets, then every option that differs from the default.
 */
export function parseManufacturingCommand(session:CadSession,tail:string):{bodies:string[];settings:ManufacturingSettings;invocation:string}{
 const tokens=commandTokens(tail);
 if(!tokens.length||tokens[0].quoted)throw new Error(usage());
 const process=tokens[0].value.toLowerCase() as ManufacturingProcess;
 if(!MANUFACTURING_PROCESSES.includes(process))throw new Error(usage());
 const given:{-readonly [K in keyof ManufacturingSettings]?:ManufacturingSettings[K]}={process};
 const targets:{value:string;quoted:boolean}[]=[];
 const value=(i:number)=>{const next=tokens[i];if(!next)throw new Error(usage());return next.value;};
 for(let i=1;i<tokens.length;i++){
  const token=tokens[i],flag=token.quoted?'':token.value.toLowerCase();
  if(flag==='--mesh')given.exact=false;
  else if(flag==='--tool')given.toolDiameterMm=commandNumber(value(++i));
  else if(flag==='--nozzle')given.nozzleMm=commandNumber(value(++i));
  else if(flag==='--min-wall')given.minWallMm=commandNumber(value(++i));
  else if(flag==='--min-hole')given.minHoleMm=commandNumber(value(++i));
  else if(flag==='--min-radius')given.minRadiusMm=commandNumber(value(++i));
  else if(flag==='--max-radius')given.maxRadiusMm=commandNumber(value(++i));
  else if(flag==='--edge-break')given.edgeBreak=value(++i).toLowerCase() as EdgeBreakRule;
  else if(flag==='--dogbones')given.dogbones=true;
  else if(flag==='--depth-ratio')given.maxPocketDepthRatio=commandNumber(value(++i));
  else if(flag==='--draft')given.minDraftDeg=commandNumber(value(++i));
  else if(flag==='--max-wall')given.maxWallMm=commandNumber(value(++i));
  else if(flag==='--variation')given.wallVariation=commandNumber(value(++i));
  else if(flag==='--pull'){const axis=value(++i).toLowerCase().trim();given.pullAxis=(/^[xyz]$/.test(axis)?'+'+axis:axis) as ApproachAxis;}
  else if(flag==='--axes')given.approachAxes=value(++i).toLowerCase().split(',').map(axis=>axis.trim()).filter(Boolean).map(axis=>/^[xyz]$/.test(axis)?'+'+axis:axis) as ApproachAxis[];
  else if(flag.startsWith('--'))throw new Error(usage());
  else targets.push(token);
 }
 let settings:ManufacturingSettings;
 try{settings=resolveManufacturingSettings(given);}catch(error){throw new Error(error instanceof Error?error.message:String(error));}
 const doc=session.state.document;
 let bodies:string[];
 if(!targets.length)bodies=session.state.selection.filter(id=>doc.roots.includes(id));
 else if(targets.length===1&&!targets[0].quoted&&targets[0].value.toLowerCase()==='all')bodies=[];
 else bodies=[...new Set(targets.map(({value})=>{
  if(doc.roots.includes(value))return value;
  const matches=doc.roots.filter(id=>doc.nodes[id].name===value);
  if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${value}`);
  return matches[0];
 }))];
 for(const id of bodies){
  if(doc.nodes[id].reference)throw new Error(t`${doc.nodes[id].name} is a reference body and is never exported or measured.`);
  if(doc.nodes[id].role==='hole')throw new Error(t`${doc.nodes[id].name} is a hole body; combine it with a solid first.`);
 }
 const d=DEFAULT_MANUFACTURING_SETTINGS,options:string[]=[];
 if(!settings.exact)options.push('--mesh');
 if(settings.toolDiameterMm!==d.toolDiameterMm)options.push(`--tool ${formatNumber(settings.toolDiameterMm)}`);
 if(settings.approachAxes.join(',')!==d.approachAxes.join(','))options.push(`--axes ${settings.approachAxes.join(',')}`);
 if(settings.maxPocketDepthRatio!==d.maxPocketDepthRatio)options.push(`--depth-ratio ${formatNumber(settings.maxPocketDepthRatio)}`);
 if(settings.dogbones)options.push('--dogbones');
 if(settings.pullAxis!==d.pullAxis)options.push(`--pull ${settings.pullAxis}`);
 if(settings.minDraftDeg!==d.minDraftDeg)options.push(`--draft ${formatNumber(settings.minDraftDeg)}`);
 if(settings.minWallMm!==undefined)options.push(`--min-wall ${formatNumber(settings.minWallMm)}`);
 if(settings.maxWallMm!==undefined)options.push(`--max-wall ${formatNumber(settings.maxWallMm)}`);
 if(settings.wallVariation!==d.wallVariation)options.push(`--variation ${formatNumber(settings.wallVariation)}`);
 if(settings.nozzleMm!==d.nozzleMm)options.push(`--nozzle ${formatNumber(settings.nozzleMm)}`);
 if(settings.minHoleMm!==d.minHoleMm)options.push(`--min-hole ${formatNumber(settings.minHoleMm)}`);
 if(settings.minRadiusMm!==undefined)options.push(`--min-radius ${formatNumber(settings.minRadiusMm)}`);
 if(settings.maxRadiusMm!==undefined)options.push(`--max-radius ${formatNumber(settings.maxRadiusMm)}`);
 if(settings.edgeBreak!==d.edgeBreak)options.push(`--edge-break ${settings.edgeBreak}`);
 return {bodies,settings,invocation:['check',process,bodies.length?bodies.map(quote).join(' '):'all',...options].join(' ')};
}

const statusWord=(status:ManufacturingStatus)=>status==='pass'?t('pass'):status==='warn'?t('warn'):status==='fail'?t('fail'):status==='info'?t('info'):t('not checked');
const geometryWord=(geometry:ManufacturingGeometry)=>geometry==='exact'?t('exact B-rep'):t('mesh');
const point=(p:readonly number[])=>`[${p.map(v=>formatNumber(Number(v.toFixed(3)))).join(', ')}]`;

/** Terminal/CLI text: a line per check and the first findings with their positions. */
export function formatManufacturingReport(report:ManufacturingReport,findingsPerCheck=5):string{
 const lines=[t`Manufacturing check: ${processLabel(report.process)}${report.kernel?` (${report.kernel})`:''}`];
 if(!report.bodies.length)lines.push(t('The design has no solid bodies to check'));
 for(const body of report.bodies){
  lines.push(`${body.name} (${body.id}): ${geometryWord(body.geometry)}${body.reason?` · ${body.reason}`:''}`);
  for(const check of body.checks){
   lines.push(`  ${statusWord(check.status).padEnd(5)} ${check.label} [${geometryWord(check.geometry)}]: ${check.summary}`);
   for(const finding of check.findings.slice(0,findingsPerCheck))lines.push(`        ${finding.text} @ ${point(finding.location)}`);
   const more=check.more+Math.max(0,check.findings.length-findingsPerCheck);
   if(more>0)lines.push('        '+t`… and ${more} more`);
  }
 }
 lines.push(report.disclaimer);
 return lines.join('\n');
}

/** The worst status of a report (fail over warn over pass). */
export function manufacturingVerdict(report:ManufacturingReport):'pass'|'warn'|'fail'{
 const all=report.bodies.flatMap(body=>body.checks.map(check=>check.status));
 return all.includes('fail')?'fail':all.includes('warn')?'warn':'pass';
}
