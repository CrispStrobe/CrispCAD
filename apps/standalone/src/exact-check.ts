// SPDX-License-Identifier: BSD-3-Clause
// Debug page for heavy exact jobs on a real device (docs/CRISPCAD-CONVERGENCE.md, "Heavy exact jobs
// on iPad"): the editor on a plate with many holes, in memory only (nothing is saved, the stored
// project is not touched), with the exact limits chosen in the URL:
//   exact-check.html?holes=200&exact-limits=tablet|desktop|none[&memory-mib=…&recycle-mib=…&timeout-s=…]
// Run the listed terminal commands and note what the terminal and the page report. The heartbeat
// below shows whether the page's main thread stayed responsive; if the tab reloads or shows
// "A problem repeatedly occurred", the browser killed it (most likely for memory).
import {setLocale} from '@brickwright/cad-core';
import {CAD_SCRIPT_REVISION,createCadSession} from '@brickwright/cad-core';
import './app.css';
import {createEditorSession,EXACT_LIMITS_DESKTOP,EXACT_LIMITS_TABLET,mountCadEditor} from '@brickwright/cad-editor';
import type {ExactLimits} from '@brickwright/cad-editor';
import {download} from './files.js';

setLocale('en');
const params=new URLSearchParams(location.search);
const holes=Math.min(400,Math.max(1,Math.floor(Number(params.get('holes')??200))||200));
const choice=params.get('exact-limits')??'tablet';
const NONE:ExactLimits={maxFeatureEdges:Infinity,maxShellFaces:Infinity,maxMemoryBytes:Infinity,recycleAboveBytes:Infinity,requestTimeoutMs:Infinity};
const base:ExactLimits=choice==='desktop'?EXACT_LIMITS_DESKTOP:choice==='none'?NONE:EXACT_LIMITS_TABLET;
// Single overrides, e.g. a low memory-mib to see the ceiling work, or recycle-mib=1 to see the worker
// end after every job: memory-mib, recycle-mib, timeout-s.
const override=(key:string,scale:number)=>{const value=Number(params.get(key));return value>0?value*scale:undefined;};
const limits:ExactLimits={...base,
 maxMemoryBytes:override('memory-mib',1048576)??base.maxMemoryBytes,
 recycleAboveBytes:override('recycle-mib',1048576)??base.recycleAboveBytes,
 requestTimeoutMs:override('timeout-s',1000)??base.requestTimeoutMs};

// The plate of experiments/exact-kernel/limits-bench.ts: 2 mm holes 6 mm apart, in a 4 mm plate.
// CAD Script, not a sketch region (regions hold at most 16 loops); Booleans take at most 64
// operands, so the cylinders are grouped in unions of 50. 16 segments keep the Manifold preview
// cheap; the exact kernel builds true cylinders whatever the segment count.
const cols=Math.ceil(Math.sqrt(holes*1.25)),rows=Math.ceil(holes/cols),w=cols*6+2,d=rows*6+2;
const cylinders=Array.from({length:holes},(_,i)=>`move([${4+i%cols*6-w/2}, ${4+Math.floor(i/cols)*6-d/2}, 0], cylinder(2, 8, 16))`);
const groups:string[]=[];
for(let i=0;i<cylinders.length;i+=50)groups.push(`union(${cylinders.slice(i,i+50).join(', ')})`);
const seed=createCadSession();
seed.addCode({version:CAD_SCRIPT_REVISION,language:'brickwright-cad-script',parameters:{},source:`return subtract(box(${w}, ${d}, 4), ${groups.join(', ')});`},'Plate',{position:[0,0,2]});
seed.rename(`Exact check · ${holes} holes`);
const document_=structuredClone(seed.state.document);
seed.dispose();

const session=createEditorSession(document_);
const editor=mountCadEditor(document.querySelector<HTMLElement>('#exact-check-editor')!,{
 wasmURL:new URL('../cad-assets/manifold.wasm',import.meta.url).href,session,exactLimits:limits,onExport:download,
});
editor.setTerminalVisible(true);

const mib=(bytes:number)=>Number.isFinite(bytes)?`${Math.round(bytes/1048576)} MiB`:'none';
const seconds=(ms:number)=>Number.isFinite(ms)?`${Math.round(ms/1000)} s`:'none';
document.querySelector('#exact-check-intro')!.textContent=`Plate with ${holes} holes (${holes+4} top-face edges, ${holes+6} faces). Exact limits: ${choice} — edges ${limits.maxFeatureEdges}, shell faces ${limits.maxShellFaces}, memory ceiling ${mib(limits.maxMemoryBytes)}, recycle above ${mib(limits.recycleAboveBytes)}, timeout ${seconds(limits.requestTimeoutMs)}. Nothing on this page is saved.`;
const steps=document.querySelector('#exact-check-steps')!;
for(const [label,command] of [['Fillet every hole rim','fillet 0.5 Plate --face +z'],['Undo, then shell (open top)','shell 0.5 Plate --open +z'],['Chamfer the hole rims','chamfer 0.5 Plate --face +z']] as const){
 const item=document.createElement('li'),code=document.createElement('code'),copy=document.createElement('button');
 code.textContent=command;copy.type='button';copy.textContent='Copy';
 copy.onclick=()=>{void navigator.clipboard?.writeText(command).then(()=>{copy.textContent='Copied';},()=>{copy.textContent='Select and copy';});};
 item.append(`${label}: `,code,' ',copy);steps.append(item);
}
// Main-thread heartbeat: the longest gap between 100 ms ticks since the page loaded.
const status=document.querySelector<HTMLOutputElement>('#exact-check-status')!,started=performance.now();
let last=performance.now(),longest=0;
setInterval(()=>{const now=performance.now();longest=Math.max(longest,now-last-100);last=now;
 status.textContent=`Page alive ${Math.round((now-started)/1000)} s · longest main-thread stall ${Math.round(longest)} ms · ${navigator.userAgent}`;},100);
(window as unknown as {exactCheck:unknown}).exactCheck={editor,limits,holes};
