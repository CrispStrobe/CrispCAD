// SPDX-License-Identifier: BSD-3-Clause
import {t} from './i18n.js';
import type {CadDocument} from './document.js';

export const drawingScales = ['1:5','1:2','1:1','2:1','5:1'] as const;
export type DrawingScale = typeof drawingScales[number];
export type DrawingSource = {featureId:string; sketchId:string; profileId:string};
export type DrawingInputs = {title:string; source:DrawingSource; scale:DrawingScale; hiddenLines:boolean};
export type DrawingSheet = DrawingInputs & {id:string};

const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
const id = (value:unknown):value is string => typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);

export function checkDrawingSheets(doc:CadDocument) {
 if(doc.drawings===undefined)return;
 const unique=new Set<string>();
 const invalid=()=>new Error(t('Invalid drawing sheets in this CAD project.'));
 if(doc.version<9||!Array.isArray(doc.drawings)||doc.drawings.length>64)throw invalid();
 for(const sheet of doc.drawings){
  if(!record(sheet)||!id(sheet.id)||unique.has(sheet.id)||typeof sheet.title!=='string'||
     !sheet.title.trim()||sheet.title.length>80||/[\u0000-\u001f]/.test(sheet.title)||
     !drawingScales.includes(sheet.scale as DrawingScale)||typeof sheet.hiddenLines!=='boolean'||!record(sheet.source)||
     !id(sheet.source.featureId)||!id(sheet.source.sketchId)||!id(sheet.source.profileId))throw invalid();
  unique.add(sheet.id);
 }
}

/** A drawing survives removal of its source so it can be repaired or restored by Undo. */
export function resolveDrawingSource(doc:CadDocument, source:DrawingSource){
 const node=Object.hasOwn(doc.nodes,source.featureId)?doc.nodes[source.featureId]:undefined;
 const sketch=doc.sketches&&Object.hasOwn(doc.sketches,source.sketchId)?doc.sketches[source.sketchId]:undefined;
 if(node?.kind!=='extrusion'||node.sketchId!==sketch?.id||sketch.profile.id!==source.profileId)return undefined;
 return {node,sketch};
}

export function drawingSourceFor(doc:CadDocument,featureId:string):DrawingSource|undefined{
 const node=Object.hasOwn(doc.nodes,featureId)?doc.nodes[featureId]:undefined;
 const sketch=node?.kind==='extrusion'?doc.sketches?.[node.sketchId]:undefined;
 return sketch?{featureId,sketchId:sketch.id,profileId:sketch.profile.id}:undefined;
}
