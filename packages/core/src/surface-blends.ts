// SPDX-License-Identifier: BSD-3-Clause
/**
 * Surface-blend inspection (Phase 6.5 of docs/CRISPCAD-CONVERGENCE.md): a read-only report of the
 * blends of each body, measured on its exact B-rep: fillets (concave) and rounds (convex) with
 * their surface kind and radius, chamfers with their width, setback and angles, and freeform
 * blends (spline faces tangent to their neighbours). For each blend it gives the evidence that it
 * is one: how many of its boundary edges are tangent to the neighbouring face, and the largest
 * angle between the exact surface normals across them (G1 continuity within TANGENT_DEG). The
 * exact fillets and chamfers a body was modelled with are compared with what the B-rep holds.
 *
 * The lab's MCP guide `mcp-surface-blends` authors blends; this inspects them (original code).
 * Core holds the plain data, the `blends` command's parser and the text formatter; the analysis
 * is @brickwright/cad-geometry's (`inspectSurfaceBlends`) on the exact `drawing` data. Bodies
 * without an exact B-rep are listed with the reason: there is no mesh fallback, since a
 * tessellation cannot tell a fillet's radius. Nothing here touches the model.
 */
import type {CadDocument} from './document.js';
import {constructionInputs} from './document.js';
import type {CadSession} from './session.js';
import type {ManufacturingMark} from './manufacturing.js';
import {commandTokens} from './command-arguments.js';
import {featureValue} from './features.js';
import {t} from './i18n.js';

export const SURFACE_BLEND_REPORT_VERSION=1;
export type SurfaceBlendKind='fillet'|'round'|'chamfer'|'freeform';
export interface SurfaceBlend {
 readonly kind:SurfaceBlendKind;
 /** SMLib surface kind of the blend's faces ('cylinder', 'torus', 'sphere', 'plane', 'cone', 'bspline' …). */
 readonly surface:string;
 /** B-rep face indices (topology order). */
 readonly faces:readonly number[];
 readonly areaMm2:number;
 /** Fillets and rounds: the exact surface radius. */
 readonly radiusMm?:number;
 /** Chamfers: face width across, the angles to the two neighbours, and the setback (equal-distance chamfer). */
 readonly widthMm?:number;
 readonly anglesDeg?:readonly number[];
 readonly setbackMm?:number;
 /** Edges between the blend and other faces, and how many of them are tangent. */
 readonly boundaryEdges:number;
 readonly tangentEdges:number;
 /** Largest angle between the exact normals across a tangent boundary edge (degrees). */
 readonly maxTangentDeviationDeg?:number;
 /** G1 when every edge to a neighbour is tangent; 'partly' when some are; 'none' for a chamfer or a blend meeting sharp. */
 readonly continuity:'G1'|'partly'|'none';
 /** Normals came from the mesh on some edge (a freeform face). */
 readonly approximate:boolean;
 /** A point on the blend (world mm). */
 readonly location:readonly number[];
 readonly mark?:ManufacturingMark;
}
/** An exact fillet or chamfer the body was modelled with, and the blends in the B-rep that match it. */
export interface AuthoredBlend {
 readonly id:string;readonly name:string;
 readonly operation:'fillet'|'chamfer';
 readonly sizeMm:number;
 /** Blends of that radius (fillet) or setback (chamfer), within 1e-6 relative. */
 readonly matched:number;
}
export interface SurfaceBlendBody {
 readonly id:string;readonly name:string;
 readonly blends:readonly SurfaceBlend[];
 readonly authored:readonly AuthoredBlend[];
 readonly faces:number;readonly edges:number;
}
export interface SurfaceBlendFailure {readonly id:string;readonly name:string;readonly message:string}
export interface SurfaceBlendReport {
 readonly version:number;
 readonly bodies:readonly SurfaceBlendBody[];
 readonly failures:readonly SurfaceBlendFailure[];
 readonly kernel?:string;
 /** Tangency threshold between exact normals (degrees). */
 readonly tangentDeg:number;
}
export interface SurfaceBlendRequest {readonly bodies:readonly string[]}
/** Runs the inspection: the exact kernel's drawing data, then the analysis. */
export interface SurfaceBlendHost {inspect(document:CadDocument,request:SurfaceBlendRequest,signal?:AbortSignal):Promise<SurfaceBlendReport>}

/** The exact fillets and chamfers in a body's construction (evaluated sizes). */
export function authoredBlends(doc:CadDocument,root:string):{id:string;name:string;operation:'fillet'|'chamfer';sizeMm:number}[]{
 const out:{id:string;name:string;operation:'fillet'|'chamfer';sizeMm:number}[]=[],seen=new Set<string>();
 const visit=(id:string)=>{
  if(seen.has(id))return;seen.add(id);
  const node=doc.nodes[id];if(!node)return;
  constructionInputs(node).forEach(visit);
  if(node.kind==='exact-feature'&&(node.operation==='fillet'||node.operation==='chamfer')){
   try{out.push({id,name:node.name,operation:node.operation,sizeMm:featureValue(node.size,doc)});}catch{/* an unresolved size is reported by the model itself */}
  }
 };
 visit(root);return out;
}

const fmt=(value:number,digits=4)=>Number(value.toFixed(digits)).toLocaleString(undefined,{maximumFractionDigits:digits});
const quote=(value:string)=>/^[A-Za-z0-9_-]+$/.test(value)?value:'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
/** `blends [all|"name"|id ...]`: the bodies (empty: the selection, or every printable body). */
export function parseSurfaceBlendCommand(session:CadSession,tail:string):{bodies:string[];invocation:string}{
 const tokens=commandTokens(tail),doc=session.state.document;
 if(tokens.some(token=>!token.quoted&&token.value.startsWith('--')))throw new Error(t('Usage: blends [all|"name"|id ...].'));
 let bodies:string[];
 if(!tokens.length)bodies=session.state.selection.filter(id=>doc.roots.includes(id));
 else if(tokens.length===1&&!tokens[0].quoted&&tokens[0].value.toLowerCase()==='all')bodies=[];
 else bodies=[...new Set(tokens.map(({value})=>{
  if(doc.roots.includes(value))return value;
  const matches=doc.roots.filter(id=>doc.nodes[id].name===value);
  if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${value}`);
  return matches[0];
 }))];
 if(bodies.some(id=>doc.nodes[id].reference||doc.nodes[id].role==='hole'))throw new Error(t('Reference helpers and hole cutters have no blends to inspect.'));
 return {bodies,invocation:`blends ${bodies.length?bodies.map(quote).join(' '):'all'}`};
}
export const surfaceBlendLabel=(b:Pick<SurfaceBlend,'kind'|'radiusMm'|'setbackMm'|'widthMm'|'surface'>)=>
 b.kind==='fillet'?t`Fillet R${fmt(b.radiusMm??0)}`:b.kind==='round'?t`Round R${fmt(b.radiusMm??0)}`:b.kind==='chamfer'?(b.setbackMm!==undefined?t`Chamfer ${fmt(b.setbackMm)} mm`:t`Chamfer ${fmt(b.widthMm??0)} mm wide`):t`Freeform blend (${b.surface})`;
/** The report as text for the terminal and the CLI. */
export function formatSurfaceBlendReport(report:SurfaceBlendReport):string{
 const lines:string[]=[];
 for(const body of report.bodies){
  const counts=(['fillet','round','chamfer','freeform'] as const).map(kind=>[kind,body.blends.filter(b=>b.kind===kind).length] as const);
  lines.push(t`${body.name}: ${body.blends.length} blends (${counts[0][1]} fillets, ${counts[1][1]} rounds, ${counts[2][1]} chamfers, ${counts[3][1]} freeform) on ${body.faces} faces`);
  for(const b of body.blends){
   const continuity=b.continuity==='G1'?t`G1, ${b.tangentEdges} of ${b.boundaryEdges} edges tangent within ${fmt(b.maxTangentDeviationDeg??0,4)}°`:b.continuity==='partly'?t`${b.tangentEdges} of ${b.boundaryEdges} edges tangent`:t('meets its neighbours at an angle');
   const angles=b.anglesDeg?.length?' · '+b.anglesDeg.map(a=>fmt(a,2)+'°').join('/'):'';
   lines.push(`  ${surfaceBlendLabel(b)} · ${b.surface} · ${fmt(b.areaMm2,3)} mm² · ${continuity}${angles}${b.approximate?' · '+t('normals partly from the mesh'):''}`);
  }
  for(const a of body.authored)lines.push('  '+(a.operation==='fillet'?t`Modelled fillet ${a.name} R${fmt(a.sizeMm)}: ${a.matched} matching blends`:t`Modelled chamfer ${a.name} ${fmt(a.sizeMm)} mm: ${a.matched} matching chamfers`));
 }
 for(const f of report.failures)lines.push(t`${f.name}: not inspected (${f.message})`);
 return lines.join('\n')||t('No bodies to inspect.');
}
