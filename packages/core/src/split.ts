// SPDX-License-Identifier: BSD-3-Clause
// Split a body at a plane (Phase 6.5 of docs/CRISPCAD-CONVERGENCE.md, document version 49).
// Original code. The operation follows the kernel lab's guide `split-by-plane` (a half-space cut
// returning the material on each side of `dot(point, normal) = offset`); not its implementation.
//
// A `split` node keeps one side of its source body. Splitting a body makes two split nodes on the
// same source, one per side, so both halves follow every later edit of the source. Manifold cuts
// the display mesh (`splitByPlane`); the exact kernel cuts the B-rep (`splitByPlane`), so the cut
// face is an exact plane and the other faces keep their surfaces.
import {t} from './i18n.js';
import type {CadDocument,Vec3} from './document.js';
import {FeatureEvaluationError,featureValue} from './features.js';
import type {FeatureScalar} from './features.js';
import type {CadSession} from './session.js';
import {commandTokens} from './command-arguments.js';

export const SPLIT_DOCUMENT_VERSION=49;
export type SplitSide='positive'|'negative';
export const SPLIT_SIDES:readonly SplitSide[]=Object.freeze(['positive','negative']);
/**
 * One side of a body cut by a plane, in the split node's parent frame (world for a top-level body):
 * the plane is `dot(point, n) = offset` with `n` the normalised `normal`, so `offset` is a signed
 * distance in millimetres along the normal. `positive` keeps the material where
 * `dot(point, n) >= offset`, `negative` the rest.
 */
export interface SplitFeature {
 kind:'split';
 splitVersion:1;
 source:string;
 normal:Vec3;
 offset:FeatureScalar;
 side:SplitSide;
}

const finite=(v:unknown,limit:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;
/** Structural check of a `split` node (document.ts calls it for kind `split`). */
export function checkSplitShape(raw:Record<string,unknown>,version:number,hasNode:(id:unknown)=>boolean):boolean{
 if(version<SPLIT_DOCUMENT_VERSION||raw.splitVersion!==1||!hasNode(raw.source)||raw.source===raw.id)return false;
 if(!(SPLIT_SIDES as readonly unknown[]).includes(raw.side))return false;
 const n=raw.normal;
 if(!Array.isArray(n)||n.length!==3||!n.every(v=>finite(v,1e6))||!(Math.hypot(...n as number[])>1e-9))return false;
 if(typeof raw.offset==='number'?!finite(raw.offset,1e6):typeof raw.offset!=='string'||!raw.offset.trim()||raw.offset.length>500)return false;
 return true;
}

/** The plane of a split node: unit normal and signed offset in millimetres. */
export function evaluateSplit(node:SplitFeature&{id:string},doc:CadDocument):{normal:Vec3;offset:number}{
 try{
  const length=Math.hypot(...node.normal);
  if(!(length>1e-9))throw new Error(t('The split plane needs a non-zero normal'));
  const offset=featureValue(node.offset,doc);
  if(Math.abs(offset)>100000)throw new Error(t('Split offset must be between -100000 and 100000 mm'));
  return {normal:node.normal.map(v=>v/length) as Vec3,offset};
 }catch(error){
  throw new FeatureEvaluationError({source:'feature',id:node.id,message:error instanceof Error?error.message:String(error)});
 }
}

/** `x`, `-y`, `z` or `X,Y,Z` as a split normal. */
export function parseSplitNormal(text:string):Vec3{
 const word=text.trim().toLowerCase(),axis=/^([+-]?)([xyz])$/.exec(word);
 if(axis){const n:Vec3=[0,0,0];n['xyz'.indexOf(axis[2])]=axis[1]==='-'?-1:1;return n;}
 const parts=word.split(',');
 if(parts.length!==3)throw new Error(t('Give the split plane normal as x, y, z or X,Y,Z.'));
 const n=parts.map(Number) as Vec3;
 if(!n.every(Number.isFinite)||!(Math.hypot(...n)>1e-9))throw new Error(t('The split plane needs a non-zero normal'));
 return n;
}
/** The normal written back: an axis word where it is one, else X,Y,Z. */
export function formatSplitNormal(n:readonly number[]):string{
 const l=Math.hypot(...n),u=n.map(v=>v/l);
 for(let i=0;i<3;i++)if(Math.abs(Math.abs(u[i])-1)<1e-12)return (u[i]<0?'-':'')+'xyz'[i];
 return n.map(v=>String(Number(v.toPrecision(12))+0)).join(',');
}
export const splitSideName=(name:string,side:SplitSide)=>side==='positive'?t`${name} (+ side)`:t`${name} (− side)`;

const quote=(value:string)=>/^[A-Za-z0-9_-]+$/.test(value)?value:'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
const looksLikeNormal=(word:string)=>/^[+-]?[xyz]$/i.test(word)||word.split(',').length===3;
/**
 * `split ["name"|id] <x|y|z|-x|…|X,Y,Z> [offset] [both|positive|negative]`: split a top-level body
 * (default: the one selected body) at the plane `dot(point, n) = offset` (n the normalised normal,
 * offset in mm). Returns the canonical invocation and `run`, which makes the one commit.
 */
export function parseSplitCommand(session:CadSession,tail:string):{invocation:string;run():string}{
 const tokens=commandTokens(tail),doc=session.state.document,usage=t('Usage: split ["name"|id] <x|y|z|-x|-y|-z|X,Y,Z> [offset] [both|positive|negative].');
 if(!tokens.length)throw new Error(usage);
 let i=0,body:string|undefined;
 const first=tokens[0];
 const isBody=(value:string)=>doc.roots.includes(value)||doc.roots.some(id=>doc.nodes[id].name===value);
 if(first.quoted||!looksLikeNormal(first.value)||isBody(first.value)&&tokens.length>1&&looksLikeNormal(tokens[1].value)){
  const matches=doc.roots.includes(first.value)?[first.value]:doc.roots.filter(id=>doc.nodes[id].name===first.value);
  if(matches.length!==1)throw new Error(t`Choose one existing object ID or unique name: ${first.value}`);
  body=matches[0];i=1;
 }else{
  const selected=session.state.selection.filter(id=>doc.roots.includes(id));
  if(selected.length!==1)throw new Error(t('Select one top-level body to split'));
  body=selected[0];
 }
 if(i>=tokens.length)throw new Error(usage);
 const normal=parseSplitNormal(tokens[i++].value);
 let offset:FeatureScalar=0,keep:'both'|SplitSide='both';
 for(;i<tokens.length;i++){
  const word=tokens[i].value,lower=word.toLowerCase();
  if(!tokens[i].quoted&&(lower==='both'||lower==='positive'||lower==='negative'))keep=lower;
  else if(!tokens[i].quoted&&lower==='keep'&&i+1<tokens.length&&['both','positive','negative'].includes(tokens[i+1].value.toLowerCase()))keep=tokens[++i].value.toLowerCase() as 'both'|SplitSide;
  else if(offset===0&&Number.isFinite(Number(word))&&word.trim()!=='')offset=Number(word);
  else if(offset===0&&/^[A-Za-z_][A-Za-z0-9_+\-*/(). ]*$/.test(word)&&tokens[i].quoted)offset=word; // a parameter expression, quoted
  else throw new Error(usage);
 }
 const invocation=['split',quote(body),formatSplitNormal(normal),typeof offset==='number'?String(Number(offset.toPrecision(12))+0):quote(offset),...(keep==='both'?[]:[keep])].join(' ');
 return {invocation,run(){
  const name=session.state.document.nodes[body!].name,ids=session.splitBody(body!,{normal,offset,keep});
  const names=ids.map(id=>session.state.document.nodes[id].name);
  return t`Split ${name} at ${formatSplitNormal(normal)} = ${String(offset)} mm: ${names.join(', ')}.`;
 }};
}
