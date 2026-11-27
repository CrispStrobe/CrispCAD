// SPDX-License-Identifier: BSD-3-Clause
/**
 * Exact bodies imported from STEP (document version 45).
 *
 * The node keeps the body's B-rep in a defined form: one closed solid, written as AP214 STEP text
 * by the exact kernel that read it (`brep.text`, millimetres, in the body's local frame), so a
 * host with the kernel can rebuild it exactly for STEP export, exact measures and exact
 * fillet, chamfer and shell. It also keeps what a host without the kernel needs: the exact
 * kernel's tessellation of the solid (`display`, closed and consistently oriented, bounded like a
 * `mesh` node), which Manifold displays, simulates and prints, and the exact measures taken at
 * import. The B-rep never changes after import, so the display is never stale; the body's
 * transform places both.
 */
import {t} from './i18n.js';
import {geometrySignature} from './hash.js';
import {MAX_EXACT_DISPLAY_INDICES,MAX_EXACT_DISPLAY_POSITIONS} from './exact-feature.js';
import type {Vec3} from './document.js';

/** The first document version that may contain `exact-body` nodes. */
export const EXACT_BODY_DOCUMENT_VERSION=45;
/** STEP text of one body's B-rep, at most this many characters (the document holds 16 MiB in all). */
export const MAX_EXACT_BODY_BREP_CHARS=8*1024*1024;
/** Bodies one STEP import may add (the document holds 2,000 objects). */
export const MAX_STEP_IMPORT_BODIES=64;
/** STEP files above this size are refused before the kernel reads them. */
export const MAX_STEP_IMPORT_BYTES=16*1024*1024;
/**
 * The display mesh of a newly imported body: the exact features' chord tolerance (0.01 mm), but a
 * coarser normal angle. The chord tolerance alone keeps every point of the mesh within 0.01 mm of
 * the B-rep, far below what a display, a physics proxy or an FDM print resolves; the 10° angle of
 * EXACT_DISPLAY_TOLERANCE mainly multiplies the triangles of small round features (pins, fillets,
 * holes), where SMLib's mesher spent most of an import's time. Bodies imported before keep their
 * stored 0.01 mm / 10° display.
 */
export const STEP_IMPORT_DISPLAY_TOLERANCE={tolerance:.01,angleDeg:30} as const;

export interface ExactBodyBrep {
 /** AP214 STEP text with exactly one solid, written by the exact kernel. */
 format:'step';
 text:string;
}
/** Exact measures of the B-rep at import, in the body's local frame (before its transform). */
export interface ExactBodyMeasures {volume:number;area:number;min:Vec3;max:Vec3}
/** Where the body came from: the imported file and the body's place in it. */
export interface ExactBodyOrigin {
 /** File name as given (no path). */
 file:string;
 /** sha256 of the file's bytes. */
 sha256:string;
 bytes:number;
 /** 1-based index of the body in the file, and the file's number of bodies. */
 body:number;
 bodies:number;
}
export interface ExactBody {
 kind:'exact-body';
 bodyVersion:1;
 brep:ExactBodyBrep;
 measures:ExactBodyMeasures;
 /** The exact kernel's tessellation of the solid, local frame (STEP_IMPORT_DISPLAY_TOLERANCE since
  * 2026-11-27, EXACT_DISPLAY_TOLERANCE before; either is valid). */
 display:{positions:number[];indices:number[]};
 origin?:ExactBodyOrigin;
}
export type ExactBodyData=Omit<ExactBody,'kind'|'bodyVersion'>;

const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown,limit=1e9):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;
const point=(v:unknown):v is Vec3=>Array.isArray(v)&&v.length===3&&v.every(x=>finite(x,1e7));
const keysIn=(value:Record<string,unknown>,allowed:readonly string[])=>Object.keys(value).every(key=>allowed.includes(key));
const STEP_MAGIC='ISO-10303-21;';

/** Structural checks run during document validation. */
export function checkExactBodyShape(raw:Record<string,unknown>,version:number):boolean{
 if(version<EXACT_BODY_DOCUMENT_VERSION||raw.bodyVersion!==1)return false;
 const {brep,measures,display,origin}=raw;
 if(!record(brep)||!keysIn(brep,['format','text'])||brep.format!=='step'||typeof brep.text!=='string'||brep.text.length>MAX_EXACT_BODY_BREP_CHARS||!brep.text.startsWith(STEP_MAGIC))return false;
 if(!record(measures)||!keysIn(measures,['volume','area','min','max'])||!finite(measures.volume)||!(measures.volume>0)||!finite(measures.area,1e12)||!(measures.area>0)||!point(measures.min)||!point(measures.max)
  ||measures.min.some((v,i)=>v>(measures.max as Vec3)[i]))return false;
 if(!record(display)||!keysIn(display,['positions','indices']))return false;
 const {positions,indices}=display;
 if(!Array.isArray(positions)||positions.length<9||positions.length>MAX_EXACT_DISPLAY_POSITIONS||positions.length%3||!positions.every(v=>finite(v,1e6)))return false;
 const vertices=positions.length/3;
 if(!Array.isArray(indices)||indices.length<12||indices.length>MAX_EXACT_DISPLAY_INDICES||indices.length%3||!indices.every(i=>Number.isInteger(i)&&i>=0&&i<vertices))return false;
 if(origin!==undefined){
  if(!record(origin)||!keysIn(origin,['file','sha256','bytes','body','bodies'])||typeof origin.file!=='string'||!origin.file.length||origin.file.length>255||/[\\/\u0000-\u001f]/.test(origin.file)
   ||typeof origin.sha256!=='string'||!/^[0-9a-f]{64}$/.test(origin.sha256)||!Number.isSafeInteger(origin.bytes)||(origin.bytes as number)<1
   ||!Number.isInteger(origin.bodies)||(origin.bodies as number)<1||!Number.isInteger(origin.body)||(origin.body as number)<1||(origin.body as number)>(origin.bodies as number))return false;
 }
 return true;
}

/** A short signature of the body's B-rep: what exact features built on it depend on. */
export const exactBodyKey=(body:Pick<ExactBody,'brep'>)=>`step:${geometrySignature(body.brep.text)}`;

/** The node for one imported body (validated again when it is committed). */
export function exactBodyNode(data:ExactBodyData):ExactBody{
 const node:ExactBody={kind:'exact-body',bodyVersion:1,brep:{format:'step',text:data.brep.text},
  measures:{volume:data.measures.volume,area:data.measures.area,min:[...data.measures.min] as Vec3,max:[...data.measures.max] as Vec3},
  display:{positions:[...data.display.positions],indices:[...data.display.indices]},
  ...(data.origin?{origin:{...data.origin}}:{})};
 if(!checkExactBodyShape(node as unknown as Record<string,unknown>,EXACT_BODY_DOCUMENT_VERSION))throw new Error(t('The exact kernel returned an imported body that cannot be stored.'));
 return node;
}
