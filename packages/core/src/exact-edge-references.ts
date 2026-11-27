// SPDX-License-Identifier: BSD-3-Clause
/**
 * Stable references to individual B-rep edges for exact fillets and chamfers (document version 44).
 *
 * Design (after the generated/modified naming in the CrispCAD kernel lab's
 * docs/internals/STABLE_NAMING.md; original code):
 *
 * - **Faces are named where they are made.** When the exact backend lowers the source of an exact
 *   feature that holds edge references, every face of every leaf construction (box, cylinder,
 *   sphere, extrusion, revolution, CAD Script object) is named `<leaf node id>:f<k>`, `k` being
 *   the face's position on the freshly built leaf. A pattern copy prefixes its faces with
 *   `<pattern id>#<copy>/`. The exact kernel keeps a name on the face and on its pieces through
 *   Booleans, transforms, mirrors and nested fillets, chamfers and shells; faces an operation
 *   makes anew (a fillet's round) have none.
 * - **An edge is named by the two faces it bounds**, sorted. Where several edges bound the same
 *   two faces (a face split by a cut meets another face more than once), the reference also
 *   records which one (`index`, 0-based, in the order of their sample centroids by x, then y, then
 *   z) and how many there were (`of`).
 * - **Resolution happens at every recompute**, on the exact B-rep of the current model. Upstream
 *   parameter edits move faces but keep their names, so the reference still finds its edge. If the
 *   two faces no longer share an edge, or now share a different number of edges than recorded,
 *   the reference is stale: the feature is not rebuilt and the error names the reference. Another
 *   edge is never picked silently.
 * - Node ids in face names are rewritten when a feature is pasted or duplicated with its source,
 *   and `exactFeatureKey` replaces them by their position in the source subtree, so a pasted
 *   feature keeps its display mesh.
 */
import {t} from './i18n.js';

/** The first document version whose exact features may select edges by reference. */
export const EXACT_EDGE_REFERENCE_DOCUMENT_VERSION=44;
/** At most this many edge references per feature (the kernel limits in packages/exact still apply). */
export const MAX_EXACT_EDGE_REFERENCES=256;
export const STALE_EDGE_REFERENCE_CODE='stale-edge-reference';

/** One edge: the names of the two faces it bounds (sorted), and which of several such edges. */
export interface ExactEdgeReference {faces:[string,string];index?:number;of?:number}
export interface ExactEdgeReferences {references:ExactEdgeReference[]}

const ID='[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}';
/** `<pattern id>#<copy>/` (at most 8 levels) then `<leaf node id>:f<k>`. */
const FACE_NAME=new RegExp(`^(?:${ID}#\\d{1,5}/){0,8}${ID}:f\\d{1,6}$`);
export const isExactFaceName=(name:unknown):name is string=>typeof name==='string'&&name.length<=1000&&FACE_NAME.test(name);
export const exactFaceName=(nodeId:string,face:number)=>`${nodeId}:f${face}`;
export const exactCopyFaceName=(patternId:string,copy:number,name:string)=>`${patternId}#${copy}/${name}`;

const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const isEdgeReferences=(v:unknown):v is ExactEdgeReferences=>record(v)&&Object.hasOwn(v,'references');

/** Validated, canonical (sorted faces, `index`/`of` only when there are several) references. */
export function checkEdgeReferences(value:unknown):ExactEdgeReferences{
 const bad=()=>{throw new Error(t('Choose edges by references to the two faces each one bounds.'));};
 if(!record(value)||Object.keys(value).some(key=>key!=='references')||!Array.isArray(value.references)||!value.references.length)bad();
 const refs=(value as {references:unknown[]}).references;
 if(refs.length>MAX_EXACT_EDGE_REFERENCES)throw new Error(t`Select at most ${MAX_EXACT_EDGE_REFERENCES} edges for one exact feature.`);
 const references=refs.map(ref=>{
  if(!record(ref)||Object.keys(ref).some(key=>!['faces','index','of'].includes(key))||!Array.isArray(ref.faces)||ref.faces.length!==2||!ref.faces.every(isExactFaceName)||ref.faces[0]===ref.faces[1])return bad();
  const faces=[...ref.faces as string[]].sort() as [string,string];
  if(ref.index===undefined&&ref.of===undefined)return {faces};
  const {index,of}=ref;
  if(!Number.isInteger(of)||!Number.isInteger(index)||(of as number)<2||(of as number)>10000||(index as number)<0||(index as number)>=(of as number))return bad();
  return {faces,index:index as number,of:of as number};
 });
 const keys=references.map(formatEdgeReference);
 if(new Set(keys).size!==keys.length)throw new Error(t('Each edge may be selected once.'));
 return {references};
}

/** Text form used by commands: `faceA+faceB`, with `@k/n` (1-based) when several edges match. */
export function formatEdgeReference(ref:ExactEdgeReference):string{
 return `${ref.faces[0]}+${ref.faces[1]}${ref.of?`@${(ref.index??0)+1}/${ref.of}`:''}`;
}
export function parseEdgeReference(text:string):ExactEdgeReference{
 const match=/^([^+@\s]+)\+([^+@\s]+)(?:@(\d{1,5})\/(\d{1,5}))?$/.exec(text.trim());
 if(!match)throw new Error(t`Not an edge reference: ${text}. Use an edge number from the edges command or faceA+faceB.`);
 const value={faces:[match[1],match[2]],...(match[3]?{index:Number(match[3])-1,of:Number(match[4])}:{})};
 return checkEdgeReferences({references:[value]}).references[0];
}

/** The part of the exact kernel's topology that naming needs (see @crispcad/exact-kernel). */
export interface EdgeNamingTopology {
 readonly faces:readonly {readonly name:string|null}[];
 readonly edges:readonly {readonly faces:readonly number[];readonly points:readonly (readonly number[])[]}[];
}
type Pair=readonly [string,string];
/** The sorted pair of our face names an edge bounds, or why it has none. */
function edgeFaces(topology:EdgeNamingTopology,edge:EdgeNamingTopology['edges'][number]):Pair|'unnamed'|'seam'{
 if(edge.faces.length!==2)return 'seam';
 const [a,b]=edge.faces.map(i=>topology.faces[i]?.name);
 if(!isExactFaceName(a)||!isExactFaceName(b))return 'unnamed';
 if(a===b)return 'seam';
 return a<b?[a,b]:[b,a];
}
const centroid=(points:readonly (readonly number[])[])=>{
 const c=[0,0,0];for(const p of points)for(let i=0;i<3;i++)c[i]+=p[i]/points.length;
 return c.map(v=>Math.round(v*1e6)/1e6);
};
const byPosition=(topology:EdgeNamingTopology)=>(a:number,b:number)=>{
 const p=centroid(topology.edges[a].points),q=centroid(topology.edges[b].points);
 return p[0]-q[0]||p[1]-q[1]||p[2]-q[2]||a-b;
};
/** Edge indices grouped by the face pair they bound, each group in canonical order. */
function edgeGroups(topology:EdgeNamingTopology):Map<string,number[]>{
 const groups=new Map<string,number[]>();
 topology.edges.forEach((edge,i)=>{
  const pair=edgeFaces(topology,edge);
  if(typeof pair==='string')return;
  const key=pair.join('+');
  const group=groups.get(key);if(group)group.push(i);else groups.set(key,[i]);
 });
 const order=byPosition(topology);
 for(const group of groups.values())group.sort(order);
 return groups;
}

export type EdgeReferenceResult={reference:ExactEdgeReference}|{reference?:undefined;reason:'unnamed'|'seam'};
/** The stable reference of edge `index` of `topology`, or why it cannot have one. */
export function edgeReferenceAt(topology:EdgeNamingTopology,index:number,groups=edgeGroups(topology)):EdgeReferenceResult{
 const edge=topology.edges[index];
 if(!edge)throw new Error(t`Edge ${index+1} does not exist.`);
 const pair=edgeFaces(topology,edge);
 if(typeof pair==='string')return {reason:pair};
 const group=groups.get(pair.join('+'))!;
 return {reference:group.length>1?{faces:[pair[0],pair[1]],index:group.indexOf(index),of:group.length}:{faces:[pair[0],pair[1]]}};
}
/** Every edge's reference (or reason), indexed like `topology.edges`. */
export function edgeReferences(topology:EdgeNamingTopology):EdgeReferenceResult[]{
 const groups=edgeGroups(topology);
 return topology.edges.map((_,i)=>edgeReferenceAt(topology,i,groups));
}

export interface StaleEdgeReference {reference:ExactEdgeReference;reason:'missing'|'count';found:number}
/** A reference that no longer resolves (see the module header). */
export class ExactEdgeReferenceError extends Error {
 readonly code=STALE_EDGE_REFERENCE_CODE;
 constructor(readonly stale:readonly StaleEdgeReference[],message:string){super(message);this.name='ExactEdgeReferenceError';}
}

/**
 * Edge indices of `topology` for `references`, in order. Throws ExactEdgeReferenceError naming
 * each reference whose two faces no longer share an edge, or share another number of edges than
 * recorded. `describe` turns a face name into text for the message.
 */
export function resolveEdgeReferences(topology:EdgeNamingTopology,references:readonly ExactEdgeReference[],describe:(face:string)=>string=face=>face):number[]{
 const groups=edgeGroups(topology),stale:StaleEdgeReference[]=[],indices:number[]=[];
 for(const reference of references){
  const group=groups.get(reference.faces.join('+'))??[],expected=reference.of??1;
  if(group.length!==expected){stale.push({reference,reason:group.length?'count':'missing',found:group.length});continue;}
  indices.push(group[reference.index??0]);
 }
 if(stale.length){
  const lines=stale.map(({reference,reason,found})=>{
   const faces=`${describe(reference.faces[0])} / ${describe(reference.faces[1])}`;
   return reason==='missing'?t`the faces ${faces} no longer meet`:t`the faces ${faces} now meet at ${found} edges, not ${reference.of??1}`;
  });
  throw new ExactEdgeReferenceError(stale,t`${stale.length} of ${references.length} selected edges no longer exist after an upstream change (${lines.join('; ')}). Choose the edges again; nothing was rebuilt.`);
 }
 return indices;
}

const idPart=new RegExp(`(^|/)(${ID})(?=[#:])`,'g');
/** Rewrite the node ids inside face names (paste, duplicate, regenerate). Unknown ids stay. */
export function mapEdgeReferenceIds(references:ExactEdgeReferences,map:(id:string)=>string|undefined):ExactEdgeReferences{
 const face=(name:string)=>name.replace(idPart,(_,lead:string,id:string)=>lead+(map(id)??id));
 return checkEdgeReferences({references:references.references.map(ref=>({...ref,faces:ref.faces.map(face)}))});
}
/** The node ids a face name mentions (leaf last). */
export const exactFaceNameIds=(name:string):string[]=>[...name.matchAll(idPart)].map(match=>match[2]);
/** `<leaf>:f<k>` → the leaf node id and face number, with the copy path. */
export function splitExactFaceName(name:string):{copies:{pattern:string;copy:number}[];node:string;face:number}{
 const parts=name.split('/'),leaf=parts.pop()!,[node,face]=leaf.split(':');
 return {copies:parts.map(part=>{const [pattern,copy]=part.split('#');return {pattern,copy:Number(copy)};}),node,face:Number(face.slice(1))};
}
